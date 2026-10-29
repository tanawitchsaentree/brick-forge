import { PARTS, type Rot } from "./parts";
import type { PlacedBrick, Why } from "./grid";
import { RES, RES_Y, partCells, studCells, vkey, unkey, type Voxels } from "./shape";
import { components, connections, studsOf } from "./connect";
import { apply, mul, partMatrix, translate, type Mat4 } from "./pose";
import { PLATE_H } from "./units";
import { toGrid } from "./ldrawImport";

// The sculptor: builds a target solid out of real parts, choosing each part by
// how well its measured shape fits the target there (engine/shape.ts).
//
// Space is cut into units of 1 stud × 1 stud × 1 plate; each unit's solid is a
// 32-bit mask of its 4×2×4 cells, so a part's fit anywhere is a few popcounts.
//
// What it builds with are forms: a part in one orientation at one offset
// inside a unit. Upright parts on the grid are forms, and so is every way
// LEGO's designers use a part off the grid (a tile on a car's flank, studs
// sideways; a wheel on its pin; a jumper's half-stud shift), learned from the
// corpus (learnForms). A placement scores
//
//   fit   = (target cells it fills) − AIR·(cells it fills that should be empty)
//   finish = Σ studs left showing: +STUD_OK where the target shows studs, −STUD_BAD on smooth surface
//   gain  = fit + finish − PIECE + HOLD·min(4, studs engaged) − FLOAT·(held by nothing)
//           + PRIOR·log(1 + how often designers use this form) − REPEAT·(stacked on its twin)
//
// Every placement keeps these terms and its margin over the runner-up (Why):
// no part is there without a reason that can be read back.
//   rank  = gain / (target cells covered)^GAMMA
//
// Parts never overlap. "Engaged" counts studs in both directions and any
// orientation: the new part's studs into placed parts, placed parts' studs
// into it (the same rule as engine/connect.ts, on cells).

const UX = RES, UY = RES_Y, UZ = RES;
const unitOf = (x: number, y: number, z: number) => [Math.floor(x / UX), Math.floor(y / UY), Math.floor(z / UZ)] as const;
const bitOf = (x: number, y: number, z: number) => (((x % UX) + UX) % UX) + UX * ((((z % UZ) + UZ) % UZ) + UZ * (((y % UY) + UY) % UY));
const ukey = vkey;

/** Small seeded random numbers (the search must be repeatable). */
function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function popcount(v: number) {
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/**
 * Unit masks in a dense array over a box (the target plus a margin), with a
 * map for anything outside: the sculptor reads these millions of times.
 */
class Grid {
  private a: Int32Array;
  private out = new Map<number, number>();
  constructor(private x0: number, private y0: number, private z0: number, private nx: number, private ny: number, private nz: number) {
    this.a = new Int32Array(nx * ny * nz);
  }
  private at(x: number, y: number, z: number) {
    const i = x - this.x0, j = y - this.y0, k = z - this.z0;
    return i < 0 || j < 0 || k < 0 || i >= this.nx || j >= this.ny || k >= this.nz ? -1 : i + this.nx * (k + this.nz * j);
  }
  get(x: number, y: number, z: number): number {
    const n = this.at(x, y, z);
    return n < 0 ? this.out.get(ukey(x, y, z)) ?? 0 : this.a[n];
  }
  or(x: number, y: number, z: number, m: number) {
    const n = this.at(x, y, z);
    if (n < 0) this.out.set(ukey(x, y, z), (this.out.get(ukey(x, y, z)) ?? 0) | m);
    else this.a[n] |= m;
  }
  andNot(x: number, y: number, z: number, m: number) {
    const n = this.at(x, y, z);
    if (n < 0) this.out.set(ukey(x, y, z), (this.out.get(ukey(x, y, z)) ?? 0) & ~m);
    else this.a[n] &= ~m;
  }
  /** By unit key (for the less frequent callers). */
  getK(k: number) {
    const [x, y, z] = unkey(k);
    return this.get(x, y, z);
  }
  orK(k: number, m: number) {
    const [x, y, z] = unkey(k);
    this.or(x, y, z, m);
  }
}

/** A part in one orientation and offset, relative to the unit grid. */
export interface Form {
  partId: string;
  /** Upright on the grid: placed as an ordinary grid part. */
  rot?: Rot;
  /** Off the grid: part-local → world matrix with the form's unit (0,0,0) at the origin. */
  base?: Mat4;
  units: { dx: number; dy: number; dz: number; mask: number }[];
  /** Cells its studs reach into (where another part must be for them to engage), by unit and bit, and as cells from the unit origin. */
  probes: { dx: number; dy: number; dz: number; bit: number; cx: number; cy: number; cz: number }[];
  /** Times designers used it (the prior). */
  use: number;
  /**
   * A motif: more parts placed with the first as one technique (a tile on its
   * plate, a bracket and the tile it turns sideways), each with its matrix
   * from the unit origin and the units (indices into `units`) it fills.
   */
  extra?: { partId: string; base: Mat4; at: number[] }[];
}

const DIRS: [number, number, number][] = [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
const CX = 1 / RES, CY = PLATE_H / RES_Y;

/** Units, masks and stud probes of a placed part, relative to the unit holding its lowest cell. */
function formOf(b: PlacedBrick) {
  return formOfMany([b]);
}

/** The same for parts placed together: their units (with which part fills each) and the studs left free. */
function formOfMany(list: PlacedBrick[]) {
  const cells: [number, number, number][] = [];
  const who: number[] = [];
  list.forEach((b, i) =>
    partCells(b, (x, y, z) => {
      cells.push([x, y, z]);
      who.push(i);
    }),
  );
  if (!cells.length) return null;
  let mx = Infinity, my = Infinity, mz = Infinity;
  for (const [x, y, z] of cells) {
    mx = Math.min(mx, x);
    my = Math.min(my, y);
    mz = Math.min(mz, z);
  }
  const [ox, oy, oz] = unitOf(mx, my, mz);
  const units = new Map<string, { dx: number; dy: number; dz: number; mask: number; by: Set<number> }>();
  const own = new Set<string>();
  cells.forEach(([x, y, z], n) => {
    own.add(`${x},${y},${z}`);
    const [ux, uy, uz] = unitOf(x, y, z);
    const k = `${ux - ox},${uy - oy},${uz - oz}`;
    const u = units.get(k) ?? { dx: ux - ox, dy: uy - oy, dz: uz - oz, mask: 0, by: new Set<number>() };
    u.mask |= 1 << bitOf(x, y, z);
    u.by.add(who[n]);
    units.set(k, u);
  });
  const probes = list.flatMap((b) => {
    const m = partMatrix(b);
    return studsOf(PARTS[b.partId]).flatMap(([x, y, z, d]) => {
      const u = DIRS[d];
      const p = apply(m, [x + u[0] * 0.1, y + u[1] * 0.1, z + u[2] * 0.1]);
      const c = [Math.floor(p[0] / CX), Math.floor(p[1] / CY), Math.floor(p[2] / CX)] as const;
      if (own.has(`${c[0]},${c[1]},${c[2]}`)) return []; // engaged inside the motif
      const [ux, uy, uz] = unitOf(c[0], c[1], c[2]);
      return [{ dx: ux - ox, dy: uy - oy, dz: uz - oz, bit: bitOf(c[0], c[1], c[2]), cx: c[0] - ox * UX, cy: c[1] - oy * UY, cz: c[2] - oz * UZ }];
    });
  });
  const sorted = [...units.values()].sort((a, b) => a.dy - b.dy || a.dz - b.dz || a.dx - b.dx);
  return {
    origin: [ox, oy, oz] as const,
    units: sorted.map(({ dx, dy, dz, mask }) => ({ dx, dy, dz, mask })),
    by: sorted.map((u) => u.by),
    probes,
    sig: `${list.map((b) => b.partId).join("+")}|${sorted.map((u) => `${u.dx},${u.dy},${u.dz}:${u.mask}`).join(";")}`,
  };
}

/** Upright grid forms of a part (its distinct quarter turns). */
export function gridForms(partId: string, use = 0): Form[] {
  const out = new Map<string, Form>();
  for (const rot of [0, 1, 2, 3] as Rot[]) {
    const f = formOf({ uid: "", partId, x: 0, y: 0, z: 0, rot, color: 0 });
    // A grid part's lowest cell is at its own min corner, so its unit origin is (0, 0, 0).
    if (!f || out.has(f.sig)) continue;
    out.set(f.sig, { partId, rot, units: f.units, probes: f.probes, use });
  }
  return [...out.values()];
}

/**
 * The forms designers use, from real models: every part as it was placed,
 * reduced to its orientation and offset within a unit, counted.
 */
export function learnForms(models: PlacedBrick[][], keep: (id: string) => boolean): Form[] {
  const forms = new Map<string, Form>();
  for (const bricks of models)
    for (const b of bricks) {
      if (!keep(b.partId)) continue;
      const f = formOf(b);
      if (!f) continue;
      const known = forms.get(f.sig);
      if (known) {
        known.use++;
        continue;
      }
      const [ox, oy, oz] = f.origin;
      const upright = !b.place && !b.pose;
      const base = upright ? undefined : mul(translate(-ox, -oy * PLATE_H, -oz), partMatrix(b));
      forms.set(f.sig, { partId: b.partId, ...(upright ? { rot: b.rot } : { base }), units: f.units, probes: f.probes, use: 1 });
    }
  return [...forms.values()];
}

/**
 * What a part is for, by its category: structure builds a shape; detail
 * (flowers, minifigure accessories, signs, pins) only goes where it means
 * something, so the sculptor never uses it to fill gaps.
 */
const STRUCTURE = /^(Brick|Plate|Tile|Slope|Wedge|Bracket|Hinge|Cylinder|Cone|Dish|Arch|Panel|Window|Windscreen|Car|Wheel|Tyre|Wing|Round|Bar|Tap|Support|Turntable|Container|Door|Glass)/;
export const isStructure = (id: string) => {
  const p = PARTS[id];
  return !!p && STRUCTURE.test(p.category) && !/Technic (Pin|Bush|Axle)/.test(p.name);
};
/** Technic is its own system: beams, liftarms, panels and the pins and axles that join them are its structure. */
export const isTechnicStructure = (id: string) => {
  const p = PARTS[id];
  return !!p && (isStructure(id) || /^Technic/.test(p.category) || /^Technic/.test(p.name));
};

/** Forms as plain arrays for a JSON file (public/forms.json) and back. */
export type PackedForm = [string, number, number[] | null, number[], number[], number, [string, number[], number[]][]?];
export function packForms(forms: Form[]): PackedForm[] {
  return forms.map((f) => [
    f.partId,
    f.rot ?? -1,
    f.base ? f.base.map((v) => Math.round(v * 1e4) / 1e4) : null,
    f.units.flatMap((u) => [u.dx, u.dy, u.dz, u.mask]),
    f.probes.flatMap((p) => [p.dx, p.dy, p.dz, p.bit, p.cx, p.cy, p.cz]),
    f.use,
    ...(f.extra ? [f.extra.map((e): [string, number[], number[]] => [e.partId, e.base.map((v) => Math.round(v * 1e4) / 1e4), e.at])] : []),
  ] as PackedForm);
}
export function unpackForms(packed: PackedForm[]): Form[] {
  const quads = <T>(a: number[], f: (a: number, b: number, c: number, d: number) => T) => {
    const out: T[] = [];
    for (let i = 0; i < a.length; i += 4) out.push(f(a[i], a[i + 1], a[i + 2], a[i + 3]));
    return out;
  };
  const sevens = (a: number[]) => {
    const out: Form["probes"] = [];
    for (let i = 0; i < a.length; i += 7) out.push({ dx: a[i], dy: a[i + 1], dz: a[i + 2], bit: a[i + 3], cx: a[i + 4], cy: a[i + 5], cz: a[i + 6] });
    return out;
  };
  return packed.map(([partId, rot, base, units, probes, use, extra]) => ({
    partId,
    ...(rot >= 0 ? { rot: rot as Rot } : { base: base! }),
    units: quads(units, (dx, dy, dz, mask) => ({ dx, dy, dz, mask })),
    probes: sevens(probes),
    use,
    ...(extra ? { extra: extra.map(([partId, base, at]) => ({ partId, base, at })) } : {}),
  }));
}

/**
 * Techniques designers repeat, from real models: two parts where one's studs
 * hold the other (a tile on a plate, a bracket and its sideways tile, a
 * hinge's halves), as one form, counted. `links` are each model's stud links
 * (engine/connect.ts).
 */
export function learnMotifs(models: PlacedBrick[][], links: { a: number; b: number; studs: number }[][], keep: (id: string) => boolean, minUse = 4): Form[] {
  const motifs = new Map<string, Form>();
  models.forEach((bricks, mi) => {
    for (const l of links[mi]) {
      if (!l.studs) continue;
      const pair = [bricks[l.a], bricks[l.b]];
      if (!pair.every((b) => keep(b.partId))) continue;
      const f = formOfMany(pair);
      if (!f) continue;
      const known = motifs.get(f.sig);
      if (known) {
        known.use++;
        continue;
      }
      const [ox, oy, oz] = f.origin;
      const shift = translate(-ox, -oy * PLATE_H, -oz);
      const [first, second] = pair.map((b) => mul(shift, partMatrix(b)));
      motifs.set(f.sig, {
        partId: pair[0].partId,
        base: first,
        units: f.units,
        probes: f.probes,
        use: 1,
        extra: [{ partId: pair[1].partId, base: second, at: f.by.flatMap((s, i) => (s.has(1) ? [i] : [])) }],
      });
    }
  });
  return [...motifs.values()].filter((m) => m.use >= minUse);
}

export interface SculptOptions {
  forms: Form[];
  /** Parts already in place (kept from a parent design): built around, and part of the result. */
  fixed?: PlacedBrick[];
  AIR?: number;
  PIECE?: number;
  HOLD?: number;
  FLOAT?: number;
  PRIOR?: number;
  GAMMA?: number;
  /** Fewest target cells a part must fill to be worth a piece. */
  MIN_COVER?: number;
  /** Per stud left showing: bonus where the target shows studs, penalty on its smooth surfaces. */
  STUD_OK?: number;
  STUD_BAD?: number;
  /** Penalty for stacking a part exactly on an identical copy of itself. */
  REPEAT?: number;
  /** Search after the first pass (large-neighbourhood search): this long, in ms (0 = off). */
  REFINE_MS?: number;
  /** Random seed for the search. */
  SEED?: number;
  /** Merge neighbouring plain parts into one bigger part (off: on the benchmark it cost held-together, see docs/engine.md). */
  MERGE?: boolean;
  /** Try at most this many forms (the most used first). */
  MAX_FORMS?: number;
  /** Cap studs left showing on smooth surfaces with tiles (default on). */
  CAP?: boolean;
  /** Swap plates whose studs all show on smooth surfaces for tiles (default on). */
  FINISH?: boolean;
  /** Bridge loose groups to the model afterwards (default on), with these plates. */
  REPAIR?: boolean;
  BRIDGES?: Form[];
}

export interface SculptResult {
  bricks: PlacedBrick[];
  /** Time per stage (ms). */
  phase?: Record<string, number>;
  /** Target cells left unfilled (where a made part would go). */
  residual: number;
  ms: number;
}

export function sculpt(target: Voxels, opts: SculptOptions): SculptResult {
  const t0 = performance.now();
  const phase: Record<string, number> = {};
  // Defaults tuned on the reconstruction benchmark (docs/engine.md).
  const AIR = opts.AIR ?? 3, PIECE = opts.PIECE ?? 60, HOLD = opts.HOLD ?? 2, FLOAT = opts.FLOAT ?? 300, PRIOR = opts.PRIOR ?? 3, GAMMA = opts.GAMMA ?? 0.7, MIN_COVER = opts.MIN_COVER ?? 16, STUD_OK = opts.STUD_OK ?? 0, STUD_BAD = opts.STUD_BAD ?? 40, REPEAT = opts.REPEAT ?? 25;
  const studs = target.studs;
  const want = new Map<number, number>();
  const votes = new Map<number, Map<number, number>>();
  let y0 = Infinity, y1 = -Infinity;
  for (const [k, color] of target.cells) {
    const [x, y, z] = unkey(k);
    const [ux, uy, uz] = unitOf(x, y, z);
    const uk = ukey(ux, uy, uz);
    want.set(uk, (want.get(uk) ?? 0) | (1 << bitOf(x, y, z)));
    const v = votes.get(uk) ?? new Map<number, number>();
    v.set(color, (v.get(color) ?? 0) + 1);
    votes.set(uk, v);
    y0 = Math.min(y0, uy);
    y1 = Math.max(y1, uy);
  }
  // The forms designers use most come first, and each spot tries at most
  // MAX_FORMS of them: most of a vocabulary is rarely used, and a seam
  // between kept parts doesn't need all of it.
  const forms = [...opts.forms].sort((a, b) => b.use - a.use).slice(0, opts.MAX_FORMS ?? Infinity);
  const prior = forms.map((f) => PRIOR * Math.log1p(f.use));
  // Dense grids over the target's units plus a margin parts can reach into.
  const M = 12;
  let ux0 = Infinity, uz0 = Infinity, ux1 = -Infinity, uz1 = -Infinity;
  for (const k of want.keys()) {
    const [x, , z] = unkey(k);
    ux0 = Math.min(ux0, x); ux1 = Math.max(ux1, x); uz0 = Math.min(uz0, z); uz1 = Math.max(uz1, z);
  }
  const grid = () => new Grid(ux0 - M, y0 - M, uz0 - M, ux1 - ux0 + 1 + 2 * M, y1 - y0 + 1 + 2 * M, uz1 - uz0 + 1 + 2 * M);
  const wantG = grid();
  for (const [k, m] of want) wantG.orK(k, m);
  const taken = grid(); // unit → bits filled by placed parts
  const probed = grid(); // unit → bits placed parts' studs reach into
  const probeCount = new Map<number, number>(); // (unit, bit) → studs reaching it, so a part can be taken out
  const addProbe = (x: number, y: number, z: number, bit: number) => {
    const k = ukey(x, y, z) * 32 + bit;
    probeCount.set(k, (probeCount.get(k) ?? 0) + 1);
    probed.or(x, y, z, 1 << bit);
  };
  const dropProbe = (x: number, y: number, z: number, bit: number) => {
    const k = ukey(x, y, z) * 32 + bit;
    const n = (probeCount.get(k) ?? 1) - 1;
    if (n > 0) probeCount.set(k, n);
    else {
      probeCount.delete(k);
      probed.andNot(x, y, z, 1 << bit);
    }
  };
  const bricks: (PlacedBrick | null)[] = [];
  for (const b of opts.fixed ?? []) {
    partCells(b, (x, y, z) => {
      const [ux, uy, uz] = unitOf(x, y, z);
      taken.or(ux, uy, uz, 1 << bitOf(x, y, z));
    });
    for (const c of studCells(b)) {
      const [x, y, z] = unkey(c);
      const [ux, uy, uz] = unitOf(x, y, z);
      addProbe(ux, uy, uz, bitOf(x, y, z));
    }
    bricks.push(b);
  }

  // Who fills each unit, to see a part stacked on an identical copy of itself.
  const owner = new Map<number, number>();
  const placedAt: { fi: number; x: number; y: number; z: number; at: number[]; alive: boolean }[] = [];

  let nEval = 0, nBest = 0;
  const evaluate = (fi: number, ox: number, oy: number, oz: number, why?: Why) => {
    nEval++;
    const f = forms[fi];
    let fit = 0, engaged = 0, cover = 0, air = 0, same = 0, bottom = 0;
    for (const u of f.units) {
      const x = ox + u.dx, y = oy + u.dy, z = oz + u.dz;
      const t = wantG.get(x, y, z), have = taken.get(x, y, z);
      if (have & u.mask) return null; // overlaps a placed part
      const c = popcount(u.mask & t & ~have);
      const a = popcount(u.mask & ~t);
      cover += c;
      air += a;
      fit += c - AIR * a;
      engaged += popcount(u.mask & probed.get(x, y, z)); // placed studs into it
      if (u.dy === 0) {
        bottom++;
        const o = owner.get(ukey(ox + u.dx, oy - 1, oz + u.dz));
        const p = o === undefined ? null : placedAt[o];
        if (p && forms[p.fi].partId === f.partId && p.x === ox && p.z === oz && forms[p.fi].units.length === f.units.length) same++;
      }
    }
    if (fit <= 0 || cover < MIN_COVER) return null;
    // The same part stacked exactly on itself: two plates where one brick or a different part would do.
    const repeat = bottom > 0 && same === bottom;
    let finish = 0;
    for (const p of f.probes) {
      if (taken.get(ox + p.dx, oy + p.dy, oz + p.dz) & (1 << p.bit)) engaged++; // its studs into placed parts
      // A stud left in the open: right where the target shows studs, wrong on a smooth surface.
      const cell = vkey(ox * UX + p.cx, oy * UY + p.cy, oz * UZ + p.cz);
      if (studs && !target.cells.has(cell)) finish += studs.has(cell) ? STUD_OK : -STUD_BAD;
    }
    const grounded = oy === y0;
    const gain = fit + finish - PIECE * (1 + (f.extra?.length ?? 0)) + HOLD * Math.min(4, engaged) - (engaged || grounded ? 0 : FLOAT) + prior[fi] - (repeat ? REPEAT : 0);
    // Ranked per cell covered (set-cover greedy): one part that fits well beats
    // several precise small ones, each of which costs a piece.
    const rank = gain / cover ** GAMMA;
    if (why) Object.assign(why, { role: "structure", cover, air, finish, engaged, prior: prior[fi], repeat, rank });
    return rank;
  };

  // A form covers an anchor with one of its bottom units.
  const bottoms = forms.map((f) => f.units.filter((u) => u.dy === 0));
  type Cand = { fi: number; x: number; z: number; s: number; second: number; secondFi: number };
  const bestFor = (anchor: number, y: number): Cand | null => {
    const [ax, , az] = unkey(anchor);
    nBest++;
    const here = taken.getK(anchor);
    const open = (want.get(anchor)! & ~here) >>> 0;
    if (popcount(open) < 4) return null; // a sliver: left to neighbours
    let best: Cand | null = null;
    for (let fi = 0; fi < forms.length; fi++)
      for (const u of bottoms[fi]) {
        // Cheap tests first: it must reach into the open cells here, and not into a part already here.
        if (!(u.mask & open) || u.mask & here) continue;
        let s = evaluate(fi, ax - u.dx, y, az - u.dz);
        if (s === null) continue;
        if (noise) s *= 1 + noise * (rand() - 0.5);
        if (!best || s > best.s) {
          const prev = best as Cand | null;
          best = { fi, x: ax - u.dx, z: az - u.dz, s, second: prev ? prev.s : -Infinity, secondFi: prev ? prev.fi : -1 };
        } else if (s > best.second && forms[fi].partId !== forms[best.fi].partId) Object.assign(best, { second: s, secondFi: fi });
      }
    return best;
  };
  const place = ({ fi, x, z, s, second, secondFi }: Cand, y: number) => {
    const why = {} as Why;
    evaluate(fi, x, y, z, why);
    why.margin = Number.isFinite(second) ? s - second : Infinity;
    if (secondFi >= 0) why.runnerUp = forms[secondFi].partId;
    const rec = { fi, x, y, z, at: [bricks.length], alive: true };
    placedAt.push(rec);
    const f = forms[fi];
    const tally = new Map<number, number>();
    for (const u of f.units)
      for (const [c, n] of votes.get(ukey(x + u.dx, y + u.dy, z + u.dz)) ?? []) tally.set(c, (tally.get(c) ?? 0) + n);
    const color = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 71;
    const uid = `s${bricks.length}`;
    if (f.base) bricks.push({ uid, partId: f.partId, x: 0, y: 0, z: 0, rot: 0, color, place: mul(translate(x, y * PLATE_H, z), f.base), why });
    else bricks.push({ uid, partId: f.partId, x, y, z, rot: f.rot!, color, why });
    // A motif's other parts, each in the colour of what it covers.
    f.extra?.forEach((e, n) => {
      const t = new Map<number, number>();
      for (const i of e.at) {
        const u = f.units[i];
        for (const [c, k] of votes.get(ukey(x + u.dx, y + u.dy, z + u.dz)) ?? []) t.set(c, (t.get(c) ?? 0) + k);
      }
      const c = [...t].sort((a, b) => b[1] - a[1])[0]?.[0] ?? color;
      rec.at.push(bricks.length);
      bricks.push({ uid: `${uid}.${n + 1}`, partId: e.partId, x: 0, y: 0, z: 0, rot: 0, color: c, place: mul(translate(x, y * PLATE_H, z), e.base), why: { ...why, motif: `${PARTS[f.partId]?.name} + ${PARTS[e.partId]?.name}` } });
    });
    if (f.extra) why.motif = `${PARTS[f.partId]?.name} + ${f.extra.map((e) => PARTS[e.partId]?.name).join(" + ")}`;
    for (const u of f.units) {
      taken.or(x + u.dx, y + u.dy, z + u.dz, u.mask);
      owner.set(ukey(x + u.dx, y + u.dy, z + u.dz), placedAt.length - 1);
    }
    for (const p of f.probes) addProbe(x + p.dx, y + p.dy, z + p.dz, p.bit);
    return f.units.map((u) => ukey(x + u.dx, y + u.dy, z + u.dz));
  };
  /** Take a placement out again (for the search). */
  const unplace = (pi: number) => {
    const r = placedAt[pi];
    const f = forms[r.fi];
    for (const u of f.units) {
      taken.andNot(r.x + u.dx, r.y + u.dy, r.z + u.dz, u.mask);
      const k = ukey(r.x + u.dx, r.y + u.dy, r.z + u.dz);
      if (owner.get(k) === pi) owner.delete(k);
    }
    for (const p of f.probes) dropProbe(r.x + p.dx, r.y + p.dy, r.z + p.dz, p.bit);
    for (const i of r.at) bricks[i] = null;
    r.alive = false;
  };
  /** A placement's worth as things stand now (same terms as evaluate, on the final state). */
  const worth = (pi: number) => {
    const r = placedAt[pi];
    const f = forms[r.fi];
    let cover = 0, air = 0, engaged = 0;
    for (const u of f.units) {
      const t = wantG.get(r.x + u.dx, r.y + u.dy, r.z + u.dz);
      cover += popcount(u.mask & t);
      air += popcount(u.mask & ~t);
      engaged += popcount(u.mask & probed.get(r.x + u.dx, r.y + u.dy, r.z + u.dz));
    }
    let finish = 0;
    for (const p of f.probes) {
      if (taken.get(r.x + p.dx, r.y + p.dy, r.z + p.dz) & (1 << p.bit)) engaged++;
      else {
        const cell = vkey(r.x * UX + p.cx, r.y * UY + p.cy, r.z * UZ + p.cz);
        if (studs) finish += studs.has(cell) ? STUD_OK : -STUD_BAD;
      }
    }
    const held = engaged > 0 || r.y === y0;
    return cover - AIR * air + finish - PIECE * (1 + (f.extra?.length ?? 0)) + HOLD * Math.min(4, engaged) - (held ? 0 : FLOAT) + prior[r.fi];
  };

  // Layer by layer, best placement first; a candidate is re-scored only when
  // the part just placed took one of its units (or its anchor). `inside`
  // limits anchors to a region (the search refills regions); `noise` breaks
  // ties differently each time so the search tries other answers.
  let noise = 0;
  let rand = mulberry(opts.SEED ?? 1);
  const fill = (inside?: (x: number, y: number, z: number) => boolean, ys = [y0, y1]) => {
    const made: number[] = [];
    for (let y = ys[0]; y <= ys[1]; y++) {
      const cands = new Map<number, Cand | null>();
      for (const k of want.keys()) {
        const [x, ky, z] = unkey(k);
        if (ky === y && (!inside || inside(x, y, z))) cands.set(k, bestFor(k, y));
      }
      for (;;) {
        let top: Cand | null = null;
        for (const c of cands.values()) if (c && (!top || c.s > top.s)) top = c;
        if (!top) break;
        made.push(placedAt.length);
        const took = new Set(place(top, y));
        for (const [k, c] of cands) {
          if (!c) continue;
          const f = forms[c.fi];
          if (took.has(k) || f.units.some((u) => took.has(ukey(c.x + u.dx, y + u.dy, c.z + u.dz)))) cands.set(k, bestFor(k, y));
        }
      }
    }
    return made;
  };
  const tFill = performance.now();
  fill();
  phase.fill = performance.now() - tFill;
  phase.bestFor = nBest;
  phase.evaluate = nEval;
  phase.anchors = want.size;

  // Large-neighbourhood search: take out the parts in a region where the
  // build looks worst (small parts, studs left on smooth surfaces, parts held
  // by nothing, twins stacked on twins), rebuild it with a little noise, and
  // keep the change only if the region and its neighbours are worth more.
  const tSearch = performance.now();
  const budget = opts.REFINE_MS ?? 0;
  let tries = 0, kept = 0;
  while (budget > 0 && performance.now() - tSearch < budget) {
    tries++;
    const alive = placedAt.map((r, i) => (r.alive ? i : -1)).filter((i) => i >= 0);
    if (!alive.length) break;
    // Pick a region around a bad placement (worse worth per unit = likelier).
    let pick = alive[Math.floor(rand() * alive.length)];
    for (let k = 0; k < 4; k++) {
      const c = alive[Math.floor(rand() * alive.length)];
      if (worth(c) / forms[placedAt[c].fi].units.length < worth(pick) / forms[placedAt[pick].fi].units.length) pick = c;
    }
    const P = placedAt[pick];
    const R = { x0: P.x - 2, x1: P.x + 3, y0: P.y - 1, y1: P.y + 2, z0: P.z - 2, z1: P.z + 3 };
    const inR = (x: number, y: number, z: number) => x >= R.x0 && x <= R.x1 && y >= R.y0 && y <= R.y1 && z >= R.z0 && z <= R.z1;
    const touches = (pi: number, pad: number) =>
      forms[placedAt[pi].fi].units.some((u) => {
        const x = placedAt[pi].x + u.dx, y = placedAt[pi].y + u.dy, z = placedAt[pi].z + u.dz;
        return x >= R.x0 - pad && x <= R.x1 + pad && y >= R.y0 - pad && y <= R.y1 + pad && z >= R.z0 - pad && z <= R.z1 + pad;
      });
    const inside = alive.filter((i) => forms[placedAt[i].fi].units.every((u) => inR(placedAt[i].x + u.dx, placedAt[i].y + u.dy, placedAt[i].z + u.dz)));
    if (!inside.length) continue;
    const near = alive.filter((i) => !inside.includes(i) && touches(i, 1));
    const before = [...inside, ...near].reduce((a, i) => a + worth(i), 0);
    // Out, and rebuild with noise.
    const old = inside.map((i) => ({ ...placedAt[i] }));
    inside.forEach(unplace);
    noise = 0.15;
    const added = fill((x, y, z) => inR(x, y, z), [R.y0, R.y1]);
    noise = 0;
    const after = [...added, ...near].reduce((a, i) => a + worth(i), 0);
    if (after > before + 1e-6) {
      kept++;
      continue;
    }
    // Worse: put the old parts back.
    added.forEach(unplace);
    for (const o of old) place({ fi: o.fi, x: o.x, z: o.z, s: 0, second: -Infinity, secondFi: -1 }, o.y);
  }

  let residual = 0;
  for (const k of want.keys()) residual += popcount((want.get(k)! & ~taken.getK(k)) >>> 0);
  const built = bricks.filter((b): b is PlacedBrick => b !== null);
  if (opts.FINISH !== false) finishTops(built, taken, studs);
  if (budget > 0) for (const b of built) if (b.why) b.why.searched = { tries, kept };
  let tp = performance.now();
  if (opts.REPAIR !== false) bridge(built, taken, opts.BRIDGES ?? gridForms("3023").concat(gridForms("3710"), gridForms("3022"), gridForms("3020"), gridForms("3623")));
  if (opts.MERGE) consolidate(built);
  phase.bridge = performance.now() - tp;
  tp = performance.now();
  if (opts.CAP !== false && studs) capStuds(built, taken, wantG, studs, forms.filter((f) => !f.extra && PARTS[f.partId]?.category === "Tile" && f.units.length <= 4));
  if (opts.MERGE) consolidate(built);
  phase.cap = performance.now() - tp;
  return { bricks: built, residual, ms: performance.now() - t0, phase };
}

/** Plates and the tile of the same size (same solid, a smooth top). */
const TILE_OF: Record<string, string> = {
  "3024": "3070b", "3023b": "3069b", "3023": "3069b", "3623": "63864", "3710": "2431", "3666": "6636", "3460": "4162",
  "3022": "3068b", "3021": "26603", "3020": "87079", "3795": "69729", "4073": "98138", "6141": "98138",
};

/**
 * The finishing pass: a plate whose studs all show, on a surface the design
 * keeps smooth, becomes the tile of its size. Same solid, nothing above it to
 * hold, and the top reads as the designer's would.
 */
function finishTops(bricks: PlacedBrick[], taken: Grid, studs: Set<number> | undefined) {
  for (const b of bricks) {
    const tile = TILE_OF[b.partId];
    if (!tile || !PARTS[tile]) continue;
    const cells = studCells(b);
    if (!cells.length) continue;
    const free = cells.every((c) => {
      const [x, y, z] = unkey(c);
      const [ux, uy, uz] = unitOf(x, y, z);
      return !(taken.get(ux, uy, uz) & (1 << bitOf(x, y, z)));
    });
    if (!free || cells.some((c) => studs?.has(c))) continue;
    b.partId = tile;
    if (b.why) b.why.motif = "finish: a tile, not a plate, where the surface is smooth";
  }
}

/** Plain parts by family and size: "Plate 2 x 4" → id, for merging neighbours into one part. */
let PLAIN: Map<string, string> | null = null;
const plainId = (family: string, w: number, d: number) => {
  if (!PLAIN) {
    PLAIN = new Map();
    for (const p of Object.values(PARTS)) {
      const m = p.name.match(/^(Brick|Plate|Tile) (\d+) ?× ?(\d+)( with Groove)?$/);
      if (!m || p.printed) continue;
      const key = `${m[1]}:${Math.min(+m[2], +m[3])}x${Math.max(+m[2], +m[3])}`;
      // Prefer the plain number (no suffix letters beyond the current mould).
      if (!PLAIN.has(key) || p.id.length < PLAIN.get(key)!.length) PLAIN.set(key, p.id);
    }
  }
  return PLAIN.get(`${family}:${Math.min(w, d)}x${Math.max(w, d)}`);
};
const familyOf = (id: string) => PARTS[id]?.name.match(/^(Brick|Plate|Tile) \d+ ?× ?\d+( with Groove)?$/)?.[1];

/**
 * Consolidation: two neighbouring plain parts of one family, height and
 * colour that together make a rectangle a single part covers become that
 * part. The same solid in fewer pieces, as a designer would build it.
 */
function consolidate(bricks: PlacedBrick[]) {
  // Exact placements that are really upright on the grid become grid parts (so they can merge).
  for (const b of bricks) {
    if (!b.place || !familyOf(b.partId)) continue;
    const g = toGrid(b);
    if (g) {
      Object.assign(b, g);
      delete b.place;
    }
  }
  for (let merged = true; merged; ) {
    merged = false;
    const grid = bricks.filter((b) => !b.place && !b.pose && familyOf(b.partId));
    const at = new Map<string, PlacedBrick[]>();
    for (const b of grid) {
      const k = `${b.y}:${familyOf(b.partId)}:${PARTS[b.partId].h}:${b.color}`;
      (at.get(k) ?? at.set(k, []).get(k)!).push(b);
    }
    for (const list of at.values())
      for (let i = 0; i < list.length && !merged; i++)
        for (let j = i + 1; j < list.length && !merged; j++) {
          const a = list[i], c = list[j];
          const fa = footprintOf(a), fc = footprintOf(c);
          let x0: number, z0: number, w: number, d: number;
          if (fa.z === fc.z && fa.d === fc.d && (fa.x + fa.w === fc.x || fc.x + fc.w === fa.x)) {
            x0 = Math.min(fa.x, fc.x); z0 = fa.z; w = fa.w + fc.w; d = fa.d;
          } else if (fa.x === fc.x && fa.w === fc.w && (fa.z + fa.d === fc.z || fc.z + fc.d === fa.z)) {
            x0 = fa.x; z0 = Math.min(fa.z, fc.z); w = fa.w; d = fa.d + fc.d;
          } else continue;
          const id = plainId(familyOf(a.partId)!, w, d);
          if (!id) continue;
          const p = PARTS[id];
          // Lay it along whichever axis matches its own w × d.
          const rot: Rot = p.w === w && p.d === d ? 0 : 1;
          Object.assign(a, { partId: id, x: x0, z: z0, rot });
          if (a.why) a.why.motif = `merged: one ${p.name} instead of two parts`;
          bricks.splice(bricks.indexOf(c), 1);
          merged = true;
        }
  }
}

const footprintOf = (b: PlacedBrick) => {
  const p = PARTS[b.partId];
  const turned = b.rot % 2 === 1;
  return { x: b.x, z: b.z, w: turned ? p.d : p.w, d: turned ? p.w : p.d };
};

/**
 * The capping pass: every stud left showing where the design is smooth gets
 * a tile over it, as a designer finishes a surface: the tile form (any way
 * designers place tiles, sideways included) that takes the stud and fills the
 * least space outside the shape. Studs the design shows are left alone.
 */
function capStuds(bricks: PlacedBrick[], taken: Grid, want: Grid, studs: Set<number>, tiles: Form[]) {
  const exposed: number[] = [];
  for (const b of bricks)
    for (const c of studCells(b)) {
      const [x, y, z] = unkey(c);
      const [ux, uy, uz] = unitOf(x, y, z);
      if (!(taken.get(ux, uy, uz) & (1 << bitOf(x, y, z))) && !studs.has(c)) exposed.push(c);
    }
  for (const c of exposed) {
    const [x, y, z] = unkey(c);
    const [ux, uy, uz] = unitOf(x, y, z);
    if (taken.get(ux, uy, uz) & (1 << bitOf(x, y, z))) continue; // capped by a tile already placed
    const bit = 1 << bitOf(x, y, z);
    let best: { f: Form; x: number; y: number; z: number; air: number } | null = null;
    for (const f of tiles)
      for (const u of f.units) {
        if (!(u.mask & bit)) continue;
        const ox = ux - u.dx, oy = uy - u.dy, oz = uz - u.dz;
        let air = 0, clash = false;
        for (const v of f.units) {
          const X = ox + v.dx, Y = oy + v.dy, Z = oz + v.dz;
          if (taken.get(X, Y, Z) & v.mask) {
            clash = true;
            break;
          }
          air += popcount(v.mask & ~want.get(X, Y, Z));
        }
        if (!clash && (!best || air < best.air)) best = { f, x: ox, y: oy, z: oz, air };
      }
    if (!best) continue;
    const { f } = best;
    const owner = bricks.find((b) => studCells(b).includes(c));
    const why: Why = { role: "structure", cover: 0, air: best.air, finish: 1, engaged: 1, prior: 0, repeat: false, rank: 0, margin: Infinity, motif: "finish: a tile over a stud that would show on a smooth surface" };
    const color = owner?.color ?? 71;
    if (f.base) bricks.push({ uid: `c${bricks.length}`, partId: f.partId, x: 0, y: 0, z: 0, rot: 0, color, place: mul(translate(best.x, best.y * PLATE_H, best.z), f.base), why });
    else bricks.push({ uid: `c${bricks.length}`, partId: f.partId, x: best.x, y: best.y, z: best.z, rot: f.rot!, color, why });
    for (const v of f.units) taken.or(best.x + v.dx, best.y + v.dy, best.z + v.dz, v.mask);
  }
}

/**
 * Ties loose groups to the main model: for each group studs don't connect to
 * the rest, the plate (smallest, least out of shape) whose studs lock into
 * both, or that both lock into from below, the way a builder bridges a gap.
 * Each bridge says so in its reasons.
 */
function bridge(bricks: PlacedBrick[], taken: Grid, plates: Form[]) {
  for (let pass = 0; pass < 6; pass++) {
    const groups = components(bricks.length, connections(bricks));
    if (groups.length < 2) return;
    const main = new Set(groups[0]);
    // Cells (by unit mask) and stud cells of the main model and of each loose group.
    const cellsOf = (idx: number[]) => {
      const m = new Map<number, number>();
      for (const i of idx)
        partCells(bricks[i], (x, y, z) => {
          const [ux, uy, uz] = unitOf(x, y, z);
          const k = ukey(ux, uy, uz);
          m.set(k, (m.get(k) ?? 0) | (1 << bitOf(x, y, z)));
        });
      return m;
    };
    const studsIn = (idx: number[]) => {
      const m = new Map<number, number>();
      for (const i of idx)
        for (const c of studCells(bricks[i])) {
          const [x, y, z] = unkey(c);
          const [ux, uy, uz] = unitOf(x, y, z);
          const k = ukey(ux, uy, uz);
          m.set(k, (m.get(k) ?? 0) | (1 << bitOf(x, y, z)));
        }
      return m;
    };
    const mainCells = cellsOf([...main]), mainStuds = studsIn([...main]);
    let fixed = 0;
    for (const g of groups.slice(1)) {
      const gc = cellsOf(g), gs = studsIn(g);
      let best: { f: Form; x: number; y: number; z: number; air: number } | null = null;
      const hits = (m: Map<number, number>, f: Form, x: number, y: number, z: number, viaProbes: boolean) =>
        viaProbes
          ? f.probes.some((p) => ((m.get(ukey(x + p.dx, y + p.dy, z + p.dz)) ?? 0) >> p.bit) & 1)
          : f.units.some((u) => (m.get(ukey(x + u.dx, y + u.dy, z + u.dz)) ?? 0) & u.mask);
      // Anchor around the group: the units its studs reach (bridge on top) and just under it (bridge below).
      const anchors = new Set<number>();
      for (const k of gs.keys()) anchors.add(k);
      for (const k of gc.keys()) {
        const [x, y, z] = unkey(k);
        anchors.add(ukey(x, y - 1, z));
      }
      for (const a of anchors) {
        const [ax, ay, az] = unkey(a);
        for (const f of plates)
          for (const u of f.units) {
            const x = ax - u.dx, y = ay - u.dy, z = az - u.dz;
            if (f.units.some((v) => taken.get(x + v.dx, y + v.dy, z + v.dz) & v.mask)) continue;
            // On top: both groups' studs into it. Below: its studs into both.
            const ok = (hits(gs, f, x, y, z, false) && hits(mainStuds, f, x, y, z, false)) || (hits(gc, f, x, y, z, true) && hits(mainCells, f, x, y, z, true));
            if (!ok) continue;
            const size = f.units.length;
            if (!best || size < best.air) best = { f, x, y, z, air: size };
          }
      }
      if (!best) continue;
      const { f, x, y, z } = best;
      const color = bricks[g[0]].color;
      bricks.push({
        uid: `b${bricks.length}`, partId: f.partId, x, y, z, rot: f.rot!, color,
        why: { role: "structure", cover: 0, air: 0, finish: 0, engaged: 2, prior: 0, repeat: false, rank: 0, margin: Infinity, motif: "bridge: ties a loose group to the model" },
      });
      for (const u of f.units) taken.or(x + u.dx, y + u.dy, z + u.dz, u.mask);
      fixed++;
    }
    if (!fixed) return;
  }
}
