import type { PlacedBrick } from "../grid";
import { PARTS, type Rot } from "../parts";
import { analyzeStability } from "../stability";
import { rateDifficulty, type Difficulty } from "../difficulty";
import { deltaE, hexToLab, rng, type Lab } from "./math";
import { RECIPES, type Recipe, type Shape } from "./recipes";

/** One line of stock the generator can use. `qty` may be Infinity in dream mode. */
export interface Stock {
  partId: string;
  color: number;
  qty: number;
  w: number; // studs along x at rot 0
  d: number;
  h: 1 | 3; // plates
  tile: boolean;
  /** 45° slope 2×N: back row has studs, the front row slopes down toward +z at rot 0. */
  slope?: boolean;
}

export interface ColorInfo {
  code: number;
  name: string;
  hex: string;
}

export interface Need {
  partId: string;
  color: number;
  need: number;
  have: number;
}

export interface Idea {
  recipe: string;
  title: string;
  math: string;
  size: number;
  seed: number;
  bricks: PlacedBrick[];
  palette: { role: string; color: number }[];
  pieces: number;
  owned: number;
  coverage: number;
  substituted: number;
  missing: number;
  dropped: number;
  slopes: number;
  /** Load ÷ capacity at the weakest joint (≤ 1 holds). */
  stress: number;
  massG: number;
  mm: [number, number, number]; // width, depth, height
  /** Pieces this build uses vs. what the library has (the shopping list is need − have). */
  needs: Need[];
  difficulty: Difficulty;
  score: number;
  W: number;
  D: number;
}

/** A solved-for target: per-cell roles plus the colour each role should be. */
export interface Grid {
  W: number;
  D: number;
  L: number; // layers
  lh: 1 | 3; // plates per layer
  role: Int8Array; // [layer][z][x], −1 empty
  /** Layer that rests on something already there (a car body on its chassis); default 0, the baseplate. */
  floor?: number;
  /** Cells taken by fixed decor (eyes, horns…): solid for the slope/tile rules, so whatever is under them keeps its studs. */
  keep?: Uint8Array;
  /** Plates from the baseplate to layer 0 (a car body starts on its chassis, not the ground). */
  y0?: number;
}

// ------------------------------------------------------------ colour roles

/**
 * Give each role a colour from the stock: plenty of it, close to the hue the
 * role prefers (ΔE in CIELAB), and distinct from colours already chosen.
 */
function assignColors(recipe: Recipe, volume: Map<number, number>, labs: Map<number, Lab>, rand: () => number) {
  const max = Math.max(1, ...[...volume.values()].filter(Number.isFinite));
  const chosen: number[] = [];
  for (const role of recipe.roles) {
    const want = role.prefer ? hexToLab(role.prefer) : null;
    let best = -1, bestScore = -Infinity;
    for (const [code, vol] of volume) {
      const lab = labs.get(code)!;
      const fresh = !chosen.includes(code);
      const contrast = chosen.length ? Math.min(...chosen.map((c) => deltaE(lab, labs.get(c)!))) / 100 : 0.5;
      const plenty = Number.isFinite(vol) ? Math.sqrt(vol / max) : 1;
      const score =
        plenty * 1.2 -
        (want ? (deltaE(lab, want) / 100) * 2.6 : 0) + // a role that names a hue (snow, leaves) should get it
        Math.min(contrast, 0.6) * 0.8 +
        (fresh ? 0.6 : 0) +
        rand() * 0.25;
      if (score > bestScore) [best, bestScore] = [code, score];
    }
    chosen.push(best);
  }
  return chosen;
}

// ------------------------------------------------------------------ solver

interface Placed {
  stock: Stock;
  x: number;
  z: number;
  layer: number;
  w: number;
  d: number;
  rot: Rot;
}

class DSU {
  parent: number[] = [];
  add() {
    this.parent.push(this.parent.length);
    return this.parent.length - 1;
  }
  find(i: number): number {
    while (this.parent[i] !== i) i = this.parent[i] = this.parent[this.parent[i]];
    return i;
  }
  union(a: number, b: number) {
    this.parent[this.find(a)] = this.find(b);
  }
}

// Directions a slope can face (the way it goes down), with the rotation that
// makes a rot-0 slope (descending toward +z) face that way.
const SLOPE_DIRS: { dx: number; dz: number; rot: Rot }[] = [
  { dx: 0, dz: 1, rot: 0 },
  { dx: -1, dz: 0, rot: 1 },
  { dx: 0, dz: -1, rot: 2 },
  { dx: 1, dz: 0, rot: 3 },
];

/** Sample a shape at every cell centre. */
export function sampleShape(shape: Shape, lh: 1 | 3): Grid {
  const { W, D } = shape;
  const L = Math.max(1, Math.ceil(shape.H / (lh * 0.4) - 1e-6));
  const role = new Int8Array(W * D * L);
  for (let l = 0; l < L; l++)
    for (let z = 0; z < D; z++)
      for (let x = 0; x < W; x++) role[l * W * D + z * W + x] = shape.at(x + 0.5, (l + 0.5) * lh * 0.4, z + 0.5);
  return { W, D, L, lh, role };
}

/** How the solver weighs parts: Easy builds with fewer, bigger pieces; Hard allows more small ones. */
export type Level = "easy" | "medium" | "hard";
const AREA_WEIGHT: Record<Level, number> = { easy: 16, medium: 10, hard: 7 };

/**
 * Fill a grid with parts, bottom layer up. Multi-height packing: in a grid of
 * plate layers (lh = 1), a brick (3 plates) goes wherever three layers of the
 * same role are free, plates fill the rest — plate-fine shapes without plate-
 * many pieces. Per layer:
 *  • 45° slopes wherever the shape steps in by one stud per brick height;
 *  • pass 1 (MRV): cells over air, fewest supported placements first, each with
 *    the part that best reaches back onto a support (arms, tails, overhangs);
 *  • pass 2: everything else in bonded scan order, alternating the grain each
 *    layer and favouring parts that bridge several parts below;
 *  • tiles only where nothing sits on top; a nearby colour if one runs out.
 * Finally, anything not connected to the ground through studs is dropped.
 */
export function solveGrid(
  grid: Grid,
  stock: Stock[],
  roleColors: number[],
  labs: Map<number, Lab>,
  grainShift = 0,
  level: Level = "medium",
) {
  const { W, D, L, lh, role } = grid;
  const floor = grid.floor ?? 0;
  const N = W * D;
  let target = 0;
  for (const r of role) if (r >= 0) target++;

  const left = stock.map((s) => s.qty);
  // Parts in layers: a brick is 1 layer in a brick grid, 3 in a plate grid; plates only fit plate grids.
  const layersOf = (s: Stock) => s.h / lh;
  const usable = stock.map((s, i) => ({ s, i, hl: layersOf(s) })).filter(({ hl }) => Number.isInteger(hl) && hl >= 1);
  usable.sort((a, b) => b.s.w * b.s.d * b.hl - a.s.w * a.s.d * a.hl);
  const plainBy = new Map<number, typeof usable>();
  const slopeBy = new Map<number, typeof usable>();
  for (const u of usable) {
    const m = u.s.slope ? slopeBy : plainBy;
    m.set(u.s.color, [...(m.get(u.s.color) ?? []), u]);
  }
  const similarCache = new Map<number, number[]>();
  const similar = (c: number) => {
    let list = similarCache.get(c);
    if (!list) {
      const lab = labs.get(c) ?? [50, 0, 0];
      list = [...plainBy.keys()].filter((k) => k !== c).sort((a, b) => deltaE(lab, labs.get(a)!) - deltaE(lab, labs.get(b)!));
      similarCache.set(c, list);
    }
    return list;
  };

  const owner = new Int32Array(N * L).fill(-1);
  const placed: (Placed & { hl: number })[] = [];
  const dsu = new DSU();
  const GROUND = dsu.add();
  let substituted = 0, missing = 0;
  const at = (l: number, x: number, z: number) => (x < 0 || z < 0 || x >= W || z >= D || l < 0 || l >= L ? -1 : role[l * N + z * W + x]);
  // Solid for the "is it covered / open on top" questions: body cells, plus cells decor will occupy.
  const keep = grid.keep;
  const solid = (l: number, x: number, z: number) =>
    at(l, x, z) >= 0 || (!!keep && x >= 0 && z >= 0 && x < W && z < D && l >= 0 && l < L && keep[l * N + z * W + x] === 1);
  const grounded = (o: number) => o >= 0 && dsu.find(o + 1) === dsu.find(GROUND);
  const free = (l: number, x: number, z: number, r: number) =>
    x >= 0 && z >= 0 && x < W && z < D && l < L && owner[l * N + z * W + x] === -1 && role[l * N + z * W + x] === r;

  const place = (u: (typeof usable)[number], l: number, x0: number, z0: number, w: number, d: number, rot: Rot) => {
    left[u.i]--;
    const id = placed.length;
    placed.push({ stock: u.s, x: x0, z: z0, layer: l, w, d, rot, hl: u.hl });
    const node = dsu.add();
    for (let k = 0; k < d; k++)
      for (let i = 0; i < w; i++) {
        for (let j = 0; j < u.hl; j++) owner[(l + j) * N + (z0 + k) * W + (x0 + i)] = id;
        const c = l * N + (z0 + k) * W + (x0 + i);
        if (l === floor) dsu.union(node, GROUND);
        else if (l > 0 && owner[c - N] >= 0) dsu.union(node, owner[c - N] + 1);
      }
  };

  /** Can a w×d part, hl layers tall, of role r go at (l, x0, z0)? Returns the parts below it (for bonding), or null. */
  const fits = (l: number, x0: number, z0: number, w: number, d: number, hl: number, r: number, tile: boolean) => {
    if (x0 < 0 || z0 < 0 || x0 + w > W || z0 + d > D || l + hl > L) return null;
    const below = new Set<number>();
    for (let k = 0; k < d; k++)
      for (let i = 0; i < w; i++) {
        for (let j = 0; j < hl; j++) {
          const c = (l + j) * N + (z0 + k) * W + (x0 + i);
          if (owner[c] !== -1 || role[c] !== r) return null;
        }
        if (tile && solid(l + hl, x0 + i, z0 + k)) return null; // tiles only on top
        if (l > 0) {
          const o = owner[l * N + (z0 + k) * W + (x0 + i) - N];
          if (o >= 0) below.add(o);
        }
      }
    return below;
  };

  for (let l = 0; l < L; l++) {
    // ---- slopes: a brick-tall pair; inner (studded) column covered above, outer open on top and in front
    const hs = 3 / lh;
    if (Number.isInteger(hs) && slopeBy.size) {
      for (const dir of SLOPE_DIRS) {
        const column = (x: number, z: number, r: number) => {
          for (let j = 0; j < hs; j++) if (!free(l + j, x, z, r)) return false;
          return true;
        };
        const isPair = (x: number, z: number) => {
          const ox = x + dir.dx, oz = z + dir.dz;
          const r = at(l, x, z);
          if (r < 0 || !column(x, z, r) || !column(ox, oz, r)) return false;
          if (solid(l + hs, ox, oz) || !solid(l + hs, x, z)) return false;
          for (let j = 0; j < hs; j++) if (solid(l + j, ox + dir.dx, oz + dir.dz)) return false;
          return true;
        };
        const along = dir.dx === 0; // the run goes along x when the slope faces ±z
        for (let a = 0; a < (along ? D : W); a++) {
          let b = 0;
          while (b < (along ? W : D)) {
            const xz = (t: number): [number, number] => (along ? [t, a] : [a, t]);
            if (!isPair(...xz(b))) {
              b++;
              continue;
            }
            const r = at(l, ...xz(b));
            let run = 0;
            while (b + run < (along ? W : D) && isPair(...xz(b + run)) && at(l, ...xz(b + run)) === r) run++;
            let done = 0;
            for (const u of slopeBy.get(roleColors[r]) ?? []) {
              while (left[u.i] > 0 && u.s.w <= run - done) {
                const s0 = b + done;
                const xs = along ? [s0, s0 + u.s.w - 1] : dir.dx > 0 ? [a, a + 1] : [a - 1, a];
                const zs = along ? (dir.dz > 0 ? [a, a + 1] : [a - 1, a]) : [s0, s0 + u.s.w - 1];
                place(u, l, xs[0], zs[0], xs[1] - xs[0] + 1, zs[1] - zs[0] + 1, dir.rot);
                done += u.s.w;
              }
            }
            b += Math.max(run, 1);
          }
        }
      }
    }

    // ---- plain parts
    const flip = (l + grainShift) % 2 === 1;
    type Pick = { u: (typeof usable)[number]; w: number; d: number; rot: Rot; x0: number; z0: number; score: number; below: number; held: boolean };

    /**
     * Best part of `color` covering cell (x, z). Normally it starts at the cell
     * (scan order fills everything before it); with `anywhere`, any placement
     * that contains the cell is tried — that's how an overhang finds a part
     * long enough to reach back onto something below.
     */
    const bestCover = (x: number, z: number, r: number, color: number, anywhere: boolean) => {
      let best: Pick | null = null;
      for (const u of plainBy.get(color) ?? []) {
        if (left[u.i] <= 0) continue;
        const orients: [number, number, Rot][] = u.s.w === u.s.d ? [[u.s.w, u.s.d, 0]] : [[u.s.w, u.s.d, 0], [u.s.d, u.s.w, 1]];
        for (const [w, d, rot] of orients) {
          const xs = anywhere ? Array.from({ length: w }, (_, i) => x - i) : [flip ? x - w + 1 : x];
          const zs = anywhere ? Array.from({ length: d }, (_, k) => z - k) : [z];
          for (const x0 of xs)
            for (const z0 of zs) {
              const below = fits(l, x0, z0, w, d, u.hl, r, u.s.tile);
              if (!below) continue;
              const grain = (w >= d) === !flip ? 1 : 0;
              // Held = resting on something already connected to the ground. A part that
              // isn't only survives if a later layer ties it in, so it scores far lower.
              const held = l === floor || [...below].some(grounded);
              const unsupported = l > floor && !held ? 60 : 0;
              const score = w * d * u.hl * AREA_WEIGHT[level] + below.size * 4 + grain * 2 + (u.s.tile ? 1 : 0) - unsupported;
              if (!best || score > best.score) best = { u, w, d, rot, x0, z0, score, below: below.size, held };
            }
        }
      }
      return best;
    };

    const fill = (x: number, z: number, anywhere: boolean) => {
      const cell = l * N + z * W + x;
      const r = role[cell];
      if (r < 0 || owner[cell] !== -1) return;
      const want = roleColors[r];
      let pick = bestCover(x, z, r, want, anywhere);
      let swapped = false;
      if (!pick) {
        for (const alt of similar(want)) if ((pick = bestCover(x, z, r, alt, anywhere))) break;
        swapped = !!pick;
      }
      if (anywhere) {
        if (!pick || !pick.held) return; // pass 1 only commits overhangs that reach a grounded support
      } else if (!pick) {
        missing++;
        owner[cell] = -2;
        return;
      }
      if (swapped) substituted += pick.w * pick.d * pick.u.hl;
      place(pick.u, l, pick.x0, pick.z0, pick.w, pick.d, pick.rot);
    };

    // Pass 1 (MRV): the cell with the fewest supported placements goes first.
    if (l > floor) {
      const supportedOptions = (x: number, z: number, r: number) => {
        let n = 0;
        for (const u of plainBy.get(roleColors[r]) ?? []) {
          if (left[u.i] <= 0) continue;
          for (const [w, d] of u.s.w === u.s.d ? [[u.s.w, u.s.d]] : [[u.s.w, u.s.d], [u.s.d, u.s.w]])
            for (let x0 = x - w + 1; x0 <= x; x0++)
              for (let z0 = z - d + 1; z0 <= z; z0++) {
                const below = fits(l, x0, z0, w, d, u.hl, r, u.s.tile);
                if (below && [...below].some(grounded)) n++;
              }
        }
        return n;
      };
      const hanging: [number, number, number][] = [];
      for (let z = 0; z < D; z++)
        for (let x = 0; x < W; x++) {
          const c = l * N + z * W + x;
          // "Hanging": nothing below, or only parts not yet connected to the ground.
          if (role[c] < 0 || owner[c] !== -1 || grounded(owner[c - N])) continue;
          hanging.push([supportedOptions(x, z, role[c]), x, z]);
        }
      hanging.sort((a, b) => (a[0] || 1e9) - (b[0] || 1e9));
      for (const [, x, z] of hanging) fill(x, z, true);
    }
    // Pass 2: everything else, in bonded scan order.
    for (let z = 0; z < D; z++)
      for (let xx = 0; xx < W; xx++) fill(flip ? W - 1 - xx : xx, z, false);
  }

  const kept = placed.filter((_, i) => dsu.find(i + 1) === dsu.find(GROUND));
  const keptCells = kept.reduce((a, p) => a + p.w * p.d * p.hl, 0);
  return {
    kept,
    lost: placed.filter((_, i) => dsu.find(i + 1) !== dsu.find(GROUND)),
    dropped: placed.length - kept.length,
    target,
    keptCells,
    substituted,
    missing,
    slopes: kept.filter((p) => p.stock.slope).length,
  };
}

// --------------------------------------------------------------- scoring

function toIdea(
  meta: { recipe: string; title: string; math: string; size: number; seed: number },
  grid: Grid,
  res: ReturnType<typeof solveGrid>,
  palette: Idea["palette"],
  owned: Map<string, number>,
  decor: Omit<PlacedBrick, "uid">[] = [],
): Idea {
  const ox = Math.floor((32 - grid.W) / 2), oz = Math.floor((32 - grid.D) / 2);
  const bricks: PlacedBrick[] = res.kept.map((p, i) => ({
    uid: `gen-${meta.recipe}-${i}`,
    partId: p.stock.partId,
    x: ox + p.x,
    y: (grid.y0 ?? 0) + p.layer * grid.lh,
    z: oz + p.z,
    rot: p.rot,
    color: p.stock.color,
  }));
  // Fixed features (eyes, teeth, wheels…) go in as placed, in the same frame.
  decor.forEach((d, i) => bricks.push({ ...d, uid: `gen-${meta.recipe}-d${i}`, x: d.x + ox, z: d.z + oz }));
  let st = analyzeStability(bricks);
  // Safety net: a feature that ended up with nothing to grip is left out, so
  // every design that leaves the generator can actually be built.
  if (st.floating.size) {
    const loose = st.floating;
    for (let i = bricks.length - 1; i >= 0; i--) if (loose.has(bricks[i].uid) && bricks[i].uid.includes("-d")) bricks.splice(i, 1);
    st = analyzeStability(bricks);
  }
  const counts = new Map<string, number>();
  for (const b of bricks) counts.set(`${b.partId}:${b.color}`, (counts.get(`${b.partId}:${b.color}`) ?? 0) + 1);
  const needs: Need[] = [...counts].map(([k, need]) => {
    const i = k.lastIndexOf(":");
    return { partId: k.slice(0, i), color: Number(k.slice(i + 1)), need, have: Math.min(need, owned.get(k) ?? 0) };
  });
  const coverage = res.target ? res.keptCells / res.target : 0;
  const swapped = res.target ? res.substituted / res.target : 0;
  const stable = st.worst <= 1 ? 1 : 1 / Math.min(st.worst, 10);
  let maxY = 0;
  for (const b of bricks) maxY = Math.max(maxY, b.y + (PARTS[b.partId]?.h ?? 0));
  return {
    ...meta,
    W: grid.W,
    D: grid.D,
    bricks,
    palette,
    pieces: bricks.length,
    owned: [...owned.values()].reduce((a, b) => a + b, 0),
    coverage,
    substituted: res.substituted,
    missing: res.missing,
    dropped: res.dropped,
    slopes: res.slopes,
    stress: st.worst,
    massG: st.massG,
    mm: [grid.W * 8, grid.D * 8, maxY * 3.2],
    needs,
    difficulty: rateDifficulty(bricks, st.worst),
    score: coverage ** 3 * (1 - swapped) ** 2 * stable * (1 + Math.log2(1 + bricks.length) / 10),
  };
}

/** Solve with a few grain offsets and keep the sturdiest result. */
function bestOfGrains(grid: Grid, stock: Stock[], roleColors: number[], labs: Map<number, Lab>, level: Level = "medium") {
  let best: ReturnType<typeof solveGrid> | null = null;
  let bestStress = Infinity;
  for (const shift of [0, 1]) {
    const res = solveGrid(grid, stock, roleColors, labs, shift, level);
    if (grid.L === 1) return res; // flat: grain doesn't change strength
    const ox = 0;
    const st = analyzeStability(
      res.kept.map((p, i) => ({ uid: String(i), partId: p.stock.partId, x: ox + p.x, y: p.layer * grid.lh, z: p.z, rot: p.rot, color: p.stock.color })),
    );
    if (!best || st.worst < bestStress) [best, bestStress] = [res, st.worst];
    if (st.worst <= 0.7) break;
  }
  return best!;
}

// --------------------------------------------------------------- public API

export interface GenerateOptions {
  only?: string[];
  /** Ignore quantities: design at full size and report what to buy. */
  dream?: boolean;
  /** For dream mode: the library, to tell have from need. */
  owned?: [string, number][];
}

/**
 * For every recipe, find the largest size the stock can build well (or, in
 * dream mode, the largest that fits the baseplate), and score the result.
 */
export function generateIdeas(stock: Stock[], colors: ColorInfo[], seed: number, opts: GenerateOptions = {}): Idea[] {
  const labs = new Map(colors.map((c) => [c.code, hexToLab(c.hex)]));
  const owned = new Map(opts.owned ?? stock.filter((s) => Number.isFinite(s.qty)).map((s) => [`${s.partId}:${s.color}`, s.qty] as [string, number]));
  const vol = (pred: (s: Stock) => boolean) => {
    const m = new Map<number, number>();
    for (const s of stock) if (pred(s)) m.set(s.color, (m.get(s.color) ?? 0) + s.qty * s.w * s.d * s.h);
    return m;
  };
  const brickVol = [...vol((s) => s.h === 3).values()].reduce((a, b) => a + b, 0);
  const plateVol = [...vol((s) => s.h === 1).values()].reduce((a, b) => a + b, 0);
  const ideas: Idea[] = [];

  for (const recipe of RECIPES) {
    if (opts.only && !opts.only.includes(recipe.id)) continue;
    const lh: 1 | 3 = recipe.layers === "plate" ? 1 : opts.dream || brickVol >= plateVol * 0.5 ? 3 : 1;
    // Colour choice weighs what the user owns, even when dreaming.
    const volume = opts.dream ? ownedVolume(owned, stock, lh) : vol((s) => s.h === lh);
    if (volume.size === 0) continue;
    const rand = rng(seed * 7919 + recipe.id.length * 104729);
    const roleColors = assignColors(recipe, volume, labs, rand);
    const recipeSeed = Math.floor(rand() * 1e6);
    const palette = recipe.roles.map((r, i) => ({ role: r.name, color: roleColors[i] }));
    const meta = (size: number) => ({ recipe: recipe.id, title: recipe.title, math: recipe.math, size, seed });

    let best: Idea | null = null;
    for (const size of recipe.sizes) {
      const shape = recipe.build(size, recipeSeed);
      if (shape.W > 32 || shape.D > 32) continue;
      const grid = sampleShape(shape, lh);
      const res = bestOfGrains(grid, stock, roleColors, labs);
      if (res.target === 0) continue;
      const idea = toIdea(meta(size), grid, res, palette, owned);
      if (!best || idea.score > best.score) best = idea;
      const swapped = res.substituted / res.target;
      // Stop at the first (largest) size that is complete in its own colours and
      // holds together; otherwise keep shrinking and keep the best-scoring one.
      if (idea.stress <= 1 && (opts.dream || (idea.coverage >= 0.94 && swapped <= 0.12))) break;
    }
    if (best && best.pieces >= 3) ideas.push(best);
  }
  return ideas.sort((a, b) => b.score - a.score);
}

/** Owned volume per colour for one layer height (dream mode colour choice). */
function ownedVolume(owned: Map<string, number>, stock: Stock[], lh: 1 | 3) {
  const dims = new Map(stock.map((s) => [s.partId, s]));
  const m = new Map<number, number>();
  for (const [k, q] of owned) {
    const i = k.lastIndexOf(":");
    const s = dims.get(k.slice(0, i));
    if (!s || s.h !== lh) continue;
    const c = Number(k.slice(i + 1));
    m.set(c, (m.get(c) ?? 0) + q * s.w * s.d * s.h);
  }
  // Nothing owned at this height: let every stocked colour compete equally.
  if (!m.size) for (const s of stock) if (s.h === lh) m.set(s.color, 1);
  return m;
}

/** Solve a ready-made grid (photo mosaics, imported models) where every role is already a colour. */
export function generateFromGrid(
  grid: Grid,
  roleColors: number[],
  stock: Stock[],
  colors: ColorInfo[],
  meta: { recipe: string; title: string; math: string },
  owned: [string, number][] = [],
  decor: Omit<PlacedBrick, "uid">[] = [],
  level: Level = "medium",
): Idea {
  const labs = new Map(colors.map((c) => [c.code, hexToLab(c.hex)]));
  const ownedMap = new Map(owned.length ? owned : stock.filter((s) => Number.isFinite(s.qty)).map((s) => [`${s.partId}:${s.color}`, s.qty] as [string, number]));
  const res = bestOfGrains(grid, stock, roleColors, labs, level);
  const palette = roleColors.map((c, i) => ({ role: `#${i + 1}`, color: c }));
  return toIdea({ ...meta, size: grid.W, seed: 0 }, grid, res, palette, ownedMap, decor);
}
