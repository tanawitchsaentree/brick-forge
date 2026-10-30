import { PARTS, type Rot } from "./parts";
import type { PlacedBrick, Why } from "./grid";
import { RES, RES_Y, partCells, studCells, vkey, unkey, type Voxels } from "./shape";
import { components, connections, studsOf } from "./connect";
import { apply, mul, partMatrix, translate, type Mat4 } from "./pose";
import { PLATE_H } from "./units";
import { toGrid } from "./ldrawImport";
import { CATEGORIES, categoryOf } from "./category";

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

/** A single-part form's identity, as formOf's `sig` writes it (to find a designer's part among the forms). */
export function sigOf(f: Form) {
  const units = [...f.units].sort((a, b) => a.dy - b.dy || a.dz - b.dz || a.dx - b.dx);
  return `${f.partId}|${units.map((u) => `${u.dx},${u.dy},${u.dz}:${u.mask}`).join(";")}`;
}

/** A placed part's form identity (null if it fills no cells). */
export const formSigOf = (b: PlacedBrick) => formOf(b)?.sig ?? null;

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
/**
 * Which parts the sculptor may use: structure, not printed, at most 8 × 8 studs and
 * 9 plates (the benchmark's rule since it began). `long` (Phase 2, docs/engine/phase2.md)
 * also lets in plain plates, bricks and tiles up to 16 studs long: the size cut took
 * 16–22 % of Creator to Expert volume, nearly all of it plain long plates and bricks,
 * which the sculptor then rebuilt from small ones.
 */
export function keepPart(id: string, hasShape: (id: string) => boolean, o: { long?: boolean } = {}) {
  const p = PARTS[id];
  if (!p || !hasShape(id) || !isStructure(id) || p.printed) return false;
  if (p.w <= 8 && p.d <= 8 && p.h <= 9) return true;
  return !!o.long && /^(Plate|Brick|Tile)$/.test(p.category) && p.w <= 16 && p.d <= 16 && p.h <= 9;
}
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

/**
 * The terms of a placement's score, kept apart so their weights can be learned
 * from designers (docs/engine/phase1.md). With the constants below as weights
 * and the gates on, the score is exactly the hand-tuned one.
 *
 *   cover, air      target cells it fills / cells it fills that should be empty
 *   studOk, studBad its studs left showing where the target shows studs / on a smooth surface
 *   pieces          parts it is (1 + a motif's extra parts)
 *   engaged         min(4, studs engaged with placed parts, either way)
 *   float           1 if nothing holds it and it isn't on the bottom layer
 *   logUse          log(1 + times designers used this form)
 *   repeat          1 if stacked exactly on an identical copy of itself
 *   belowMinCover   1 if cover < MIN_COVER (the old gate, as a feature)
 *   fitNonPos       1 if cover − AIR·air ≤ 0 (the other old gate)
 *   size            cells of the form
 *   cat_*           one-hot of the part's category (engine/category.ts)
 *   stackAbove      target cells still empty right above the part's top units: what
 *                   it leaves to fill on top of it (a plate at the foot of a brick-tall
 *                   region leaves two plates' worth; a brick that reaches the top, none)
 */
export const FEATURES = ["cover", "air", "studOk", "studBad", "pieces", "engaged", "float", "logUse", "repeat", "belowMinCover", "fitNonPos", "size", ...CATEGORIES.map((c) => `cat_${c}`), "stackAbove"] as const;
export type Feature = (typeof FEATURES)[number];
export interface Weights {
  version?: string;
  gamma: number;
  /** Keep the old hard gates (fit > 0, cover ≥ MIN_COVER). Off: they are only features. */
  gates: boolean;
  weights: Partial<Record<Feature, number>>;
}
/** The hand-tuned score as weights: the regression reference (same builds, voxel for voxel). */
export function constantWeights(o: { AIR?: number; PIECE?: number; HOLD?: number; FLOAT?: number; PRIOR?: number; GAMMA?: number; STUD_OK?: number; STUD_BAD?: number; REPEAT?: number } = {}): Weights {
  return {
    version: "constants",
    gamma: o.GAMMA ?? 0.7,
    gates: true,
    weights: { cover: 1, air: -(o.AIR ?? 3), studOk: o.STUD_OK ?? 0, studBad: -(o.STUD_BAD ?? 40), pieces: -(o.PIECE ?? 60), engaged: o.HOLD ?? 2, float: -(o.FLOAT ?? 300), logUse: o.PRIOR ?? 3, repeat: -(o.REPEAT ?? 25) },
  };
}

/** One designer decision, replayed (`SculptOptions.REPLAY`). Candidate 0 is the designer's. */
export interface Decision {
  brick: number;
  partId: string;
  /** Its form is among the forms tried (the MAX_FORMS most used of the table). */
  known: boolean;
  /** It shares cells with parts already placed (voxelised designer parts can touch), and how many. */
  overlap: boolean;
  shared?: number;
  /** Which old gates would drop it. */
  gate?: { fitNonPos: boolean; belowMinCover: boolean };
  /** Layer scope: the first `pos` candidates are the designer's (any of them is right). */
  pos?: number;
  /** Candidates the current score ranks above the designer's (ties count against it), out of how many. */
  better?: number;
  candidates?: number;
  feats?: number[][];
  cover?: number[];
}

export interface SculptOptions {
  forms: Form[];
  /** Score with these weights (learned, or constantWeights() for the reference) instead of the constants. */
  WEIGHTS?: Weights;
  /**
   * Replay a designer's build instead of sculpting: parts in layer order (then
   * step), and at each one sampled, the designer's form and the candidates at
   * its anchor (top K by the current score, plus R feasible ones at random).
   */
  REPLAY?: {
    bricks: PlacedBrick[]; K: number; R: number; seed: number; sample: (i: number) => boolean; keep: (id: string) => boolean; emit: (d: Decision) => void;
    /**
     * "anchor" (default): candidates at the designer's anchor only. "layer": what
     * the greedy decoder actually compares, the best candidates at every open
     * anchor of the layer, against all the designer's parts still to come in it
     * (several right answers: `pos` of them, first in the list).
     */
    scope?: "anchor" | "layer";
  };
  /** Parts already in place (kept from a parent design): built around, and part of the result. */
  fixed?: PlacedBrick[];
  AIR?: number;
  PIECE?: number;
  HOLD?: number;
  FLOAT?: number;
  PRIOR?: number;
  GAMMA?: number;
  /**
   * Least share of its own volume a part must fill with target cells (program v2 S4,
   * the sliver rule; 0 = off). A 1×1 sent after the corner of an off-grid designer
   * part fills a quarter of itself and is left out.
   */
  MIN_FILL?: number;
  /**
   * Program v2 S8: a part that engages no stud and isn't on the bottom layer isn't
   * placed at all. FLOAT only demoted it, and the greedy took the best candidate at
   * an anchor even when its score was negative: 53.5 % of unconnected parts sat on
   * or under a part with no stud between them.
   */
  NO_FLOAT?: boolean | "onSmooth";
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
  /** The merge pass (Phase 2): neighbouring plain parts that make a stock rectangle become one, connections kept. */
  MERGE_PASS?: boolean;
  /** Try at most this many forms (the most used first). */
  MAX_FORMS?: number;
  /** capStuds picks its tile with the sculptor's air and use prior, not air alone (program v2 S7). */
  CAP_PRIOR?: boolean;
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
  const MIN_FILL = opts.MIN_FILL ?? 0, NO_FLOAT = opts.NO_FLOAT ?? false;
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
  const W = opts.WEIGHTS;
  const wv = W ? FEATURES.map((n) => W.weights[n] ?? 0) : [];
  // The raw terms of a placement (no gates, no weights), or null if it overlaps a
  // placed part. Written into one scratch object (evaluate runs millions of times;
  // a new object each time cost 45 % of the sculptor's time): copy it to keep it.
  type Terms = { cover: number; air: number; ok: number; bad: number; engaged: number; repeat: boolean; grounded: boolean; shared: number; below: number; x: number; y: number; z: number };
  const scratch: Terms = { cover: 0, air: 0, ok: 0, bad: 0, engaged: 0, repeat: false, grounded: false, shared: 0, below: 0, x: 0, y: 0, z: 0 };
  // `full`: all terms even where a gate drops it (the replay); otherwise it stops
  // at the gate, before the stud loop, as the sculptor always did (that loop is
  // most of the time of a placement that would be dropped anyway).
  // `shareOk`: cells a placed part already fills count as neither cover nor air
  // instead of ruling it out (a designer's part replayed: voxelised at a quarter
  // stud, neighbours that touch can share a few cells).
  const terms = (fi: number, ox: number, oy: number, oz: number, full = false, shareOk = false): Terms | null => {
    const f = forms[fi];
    let engaged = 0, cover = 0, air = 0, same = 0, bottom = 0, shared = 0, below = 0;
    for (const u of f.units) {
      const x = ox + u.dx, y = oy + u.dy, z = oz + u.dz;
      const t = wantG.get(x, y, z), have = taken.get(x, y, z);
      if (have & u.mask) {
        if (!shareOk) return null; // overlaps a placed part
        shared += popcount(u.mask & have);
      }
      cover += popcount(u.mask & t & ~have);
      air += popcount(u.mask & ~t & ~have);
      engaged += popcount(u.mask & probed.get(x, y, z)); // placed studs into it
      if (u.dy === 0) {
        bottom++;
        if (taken.get(x, oy - 1, z)) below++; // something right under it
        const o = owner.get(ukey(ox + u.dx, oy - 1, oz + u.dz));
        const p = o === undefined ? null : placedAt[o];
        if (p && forms[p.fi].partId === f.partId && p.x === ox && p.z === oz && forms[p.fi].units.length === f.units.length) same++;
      }
    }
    if (!full && (W ? (W.gates ? cover + (W.weights.air ?? 0) * air <= 0 || cover < MIN_COVER : cover <= 0) : cover - AIR * air <= 0 || cover < MIN_COVER)) return null;
    if (!full && MIN_FILL && cover < MIN_FILL * (cover + air)) return null; // a sliver: mostly outside the target
    let ok = 0, bad = 0;
    for (const p of f.probes) {
      if (taken.get(ox + p.dx, oy + p.dy, oz + p.dz) & (1 << p.bit)) engaged++; // its studs into placed parts
      // A stud left in the open: right where the target shows studs, wrong on a smooth surface.
      const cell = vkey(ox * UX + p.cx, oy * UY + p.cy, oz * UZ + p.cz);
      if (studs && !target.cells.has(cell)) studs.has(cell) ? ok++ : bad++;
    }
    // The same part stacked exactly on itself: two plates where one brick or a different part would do.
    scratch.cover = cover;
    scratch.air = air;
    scratch.ok = ok;
    scratch.bad = bad;
    scratch.engaged = engaged;
    scratch.repeat = bottom > 0 && same === bottom;
    scratch.grounded = oy === y0;
    scratch.shared = shared;
    scratch.below = below;
    scratch.x = ox;
    scratch.y = oy;
    scratch.z = oz;
    return scratch;
  };
  // Per form, computed once (and for forms a replay adds).
  const formSize: number[] = [], formCat: number[] = [];
  const formInfo = (fi: number) => {
    if (formSize[fi] === undefined) {
      formSize[fi] = forms[fi].units.reduce((a, u) => a + popcount(u.mask), 0);
      formCat[fi] = CATEGORIES.indexOf(categoryOf(forms[fi].partId));
    }
  };
  /** The feature vector of a placement, in FEATURES order. */
  const tops: { dx: number; dy: number; dz: number; mask: number }[][] = [];
  const topsOf = (fi: number) =>
    (tops[fi] ??= forms[fi].units.filter((u) => !forms[fi].units.some((w) => w.dx === u.dx && w.dz === u.dz && w.dy === u.dy + 1)));
  const featsOf = (fi: number, t: Terms) => {
    formInfo(fi);
    let above = 0;
    for (const u of topsOf(fi)) above += popcount(wantG.get(t.x + u.dx, t.y + u.dy + 1, t.z + u.dz) & ~taken.get(t.x + u.dx, t.y + u.dy + 1, t.z + u.dz));
    const v = [t.cover, t.air, t.ok, t.bad, 1 + (forms[fi].extra?.length ?? 0), Math.min(4, t.engaged), t.engaged || t.grounded ? 0 : 1, Math.log1p(forms[fi].use), t.repeat ? 1 : 0, t.cover < MIN_COVER ? 1 : 0, t.cover - AIR * t.air <= 0 ? 1 : 0, formSize[fi]];
    for (let c = 0; c < CATEGORIES.length; c++) v.push(formCat[fi] === c ? 1 : 0);
    v.push(above);
    return v;
  };
  const iLog = FEATURES.indexOf("logUse"), iRep = FEATURES.indexOf("repeat");
  /** The score of a placement from its terms: the hand-tuned one, or weighted features. Null if a gate drops it. */
  const score = (fi: number, t: Terms) => {
    const f = forms[fi];
    // S8: nothing holds it. "onSmooth": only when it rests on parts with no stud into it
    // (on a tile); one hanging over open space may still be held from above later.
    if (NO_FLOAT && !t.engaged && !t.grounded && (NO_FLOAT !== "onSmooth" || t.below > 0)) return null;
    if (!W) {
      const fit = t.cover - AIR * t.air;
      if (fit <= 0 || t.cover < MIN_COVER) return null;
      const finish = t.ok * STUD_OK - t.bad * STUD_BAD;
      const gain = fit + finish - PIECE * (1 + (f.extra?.length ?? 0)) + HOLD * Math.min(4, t.engaged) - (t.engaged || t.grounded ? 0 : FLOAT) + prior[fi] - (t.repeat ? REPEAT : 0);
      // Ranked per cell covered (set-cover greedy): one part that fits well beats
      // several precise small ones, each of which costs a piece.
      return gain / t.cover ** GAMMA;
    }
    if (W.gates ? t.cover + (W.weights.air ?? 0) * t.air <= 0 || t.cover < MIN_COVER : t.cover <= 0) return null;
    const v = featsOf(fi, t);
    // Integer terms first, then the prior, then the repeat term, then the rest: in
    // this order constantWeights() gives the hand-tuned score bit for bit.
    let gain = 0;
    for (let i = 0; i < v.length; i++) if (i !== iLog && i !== iRep && i < 9) gain += wv[i] * v[i];
    gain += wv[iLog] * v[iLog];
    gain += wv[iRep] * v[iRep];
    for (let i = 9; i < v.length; i++) gain += wv[i] * v[i];
    return gain / t.cover ** W.gamma;
  };
  const evaluate = (fi: number, ox: number, oy: number, oz: number, why?: Why) => {
    nEval++;
    const t = terms(fi, ox, oy, oz);
    if (!t) return null;
    const rank = score(fi, t);
    if (rank === null) return null;
    const finish = t.ok * STUD_OK - t.bad * STUD_BAD;
    if (why) Object.assign(why, { role: "structure", cover: t.cover, air: t.air, finish, engaged: t.engaged, prior: prior[fi], repeat: t.repeat, rank });
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

  /**
   * A designer's build, replayed through this sculptor's own state (Phase 1,
   * docs/engine/phase1.md): parts in layer order, then step, then file order.
   * At each sampled part, its form at its own position and every candidate at
   * the same anchor that this sculptor would consider: the top K by the current
   * score are the negatives, plus R feasible ones at random. Then the designer's
   * part is put in place, so the next decision sees the designer's build so far.
   */
  const replay = (R: NonNullable<SculptOptions["REPLAY"]>) => {
    const rr = mulberry(R.seed);
    const table = forms.length; // candidates come from the table, not from parts the replay adds
    const index = new Map<string, number>();
    forms.forEach((f, i) => !f.extra && !index.has(sigOf(f)) && index.set(sigOf(f), i));
    const order = R.bricks
      .map((b, i) => ({ b, i, f: formOf(b) }))
      .filter((o): o is { b: PlacedBrick; i: number; f: NonNullable<ReturnType<typeof formOf>> } => !!o.f)
      .sort((p, q) => p.f.origin[1] - q.f.origin[1] || (p.b.step ?? 0) - (q.b.step ?? 0) || p.i - q.i);
    // Each designer part's form: from the table, or added (so it can be placed).
    const fiOf = order.map(({ b, f: fd }) => {
      const at = index.get(fd.sig);
      if (at !== undefined) return at;
      forms.push({ partId: b.partId, units: fd.units, probes: fd.probes, use: 0 });
      prior.push(PRIOR * Math.log1p(0));
      bottoms.push(fd.units.filter((u) => u.dy === 0));
      return forms.length - 1;
    });
    // Anchors per layer (the units the decoder fills from).
    const anchorsAt = new Map<number, number[]>();
    for (const k of want.keys()) {
      const [x, y, z] = unkey(k);
      anchorsAt.set(y, [...(anchorsAt.get(y) ?? []), x, z]);
    }
    /** Layer scope: the designer's remaining parts in this layer against the best placements at every anchor. */
    const layerDecision = (n: number): Decision => {
      const { b, i, f: fd } = order[n];
      const oy = fd.origin[1];
      const pos: { fi: number; t: Terms; x: number; z: number }[] = [];
      for (let m = n; m < order.length && order[m].f.origin[1] === oy; m++) {
        const c = fiOf[m];
        if (c >= table || !R.keep(order[m].b.partId)) continue; // only forms the decoder could choose
        const [x, , z] = order[m].f.origin;
        const t = terms(c, x, oy, z, true, true);
        if (t && t.cover > 0) pos.push({ fi: c, t: { ...t }, x, z });
      }
      const d: Decision = { brick: i, partId: b.partId, known: fiOf[n] < table, overlap: false };
      if (!pos.length) return d;
      const isPos = (c: number, x: number, z: number) => pos.some((p) => p.fi === c && p.x === x && p.z === z);
      // Per anchor, its best few by the current score (as the decoder's bestFor would see them).
      const pool: { fi: number; t: Terms; s: number | null }[] = [];
      const ax = anchorsAt.get(oy) ?? [];
      for (let a = 0; a < ax.length; a += 2) {
        const here = taken.get(ax[a], oy, ax[a + 1]);
        const open = (wantG.get(ax[a], oy, ax[a + 1]) & ~here) >>> 0;
        if (popcount(open) < 4) continue;
        const local: { fi: number; t: Terms; s: number | null }[] = [];
        for (let c = 0; c < table; c++)
          for (const u of bottoms[c]) {
            if (!(u.mask & open) || u.mask & here) continue;
            const x = ax[a] - u.dx, z = ax[a + 1] - u.dz;
            if (isPos(c, x, z)) continue;
            const t = terms(c, x, oy, z, true);
            if (!t || t.cover <= 0) continue;
            local.push({ fi: c, t: { ...t }, s: score(c, t) });
          }
        local.sort((p, q) => (q.s ?? -Infinity) - (p.s ?? -Infinity) || p.fi - q.fi);
        pool.push(...local.slice(0, 3));
        // One more at random from this anchor (gated ones included), for diversity.
        if (local.length > 3) pool.push(local[3 + Math.floor(rr() * (local.length - 3))]);
      }
      const ranked = pool.filter((c) => c.s !== null).sort((p, q) => q.s! - p.s! || p.fi - q.fi);
      const top = ranked.slice(0, R.K);
      const rest = pool.filter((c) => !top.includes(c));
      const extra: typeof pool = [];
      for (let k = 0; k < R.R && rest.length; k++) extra.push(rest.splice(Math.floor(rr() * rest.length), 1)[0]);
      const best = Math.max(...pos.map((p) => score(p.fi, p.t) ?? -Infinity));
      d.pos = pos.length;
      d.candidates = pool.length;
      d.better = pool.filter((c) => c.s !== null && c.s >= best).length;
      const all = [...pos, ...top, ...extra];
      d.feats = all.map((c) => featsOf(c.fi, c.t));
      d.cover = all.map((c) => c.t.cover);
      return d;
    };
    for (let n = 0; n < order.length; n++) {
      const { b, i, f: fd } = order[n];
      const [ox, oy, oz] = fd.origin;
      const fi = fiOf[n];
      const known = fi < table;
      if (R.scope === "layer") {
        if (R.keep(b.partId) && R.sample(i)) R.emit(layerDecision(n));
      } else if (R.keep(b.partId) && R.sample(i)) {
        const t0r = terms(fi, ox, oy, oz, true, true);
        const t = t0r && { ...t0r };
        const d: Decision = { brick: i, partId: b.partId, known, overlap: !t || t.shared > 0, shared: t?.shared };
        if (t) {
          d.gate = { fitNonPos: t.cover - AIR * t.air <= 0, belowMinCover: t.cover < MIN_COVER };
          const u0 = fd.units.find((u) => u.dy === 0)!;
          const ax = ox + u0.dx, az = oz + u0.dz;
          const here = taken.get(ax, oy, az);
          const open = (wantG.get(ax, oy, az) & ~here) >>> 0;
          const cands: { fi: number; t: Terms; s: number | null }[] = [];
          for (let c = 0; c < table; c++)
            for (const u of bottoms[c]) {
              if (!(u.mask & open) || u.mask & here) continue;
              const x = ax - u.dx, z = az - u.dz;
              if (c === fi && x === ox && z === oz) continue; // the designer's own
              const tc = terms(c, x, oy, z, true);
              if (!tc || tc.cover <= 0) continue;
              cands.push({ fi: c, t: { ...tc }, s: score(c, tc) });
            }
          const ds = t.cover > 0 ? score(fi, t) : null;
          d.candidates = cands.length;
          d.better = cands.filter((c) => c.s !== null && (ds === null || c.s >= ds)).length;
          // Negatives: the K best by the current score, then R more at random from the rest (gated ones included).
          const ranked = cands.filter((c) => c.s !== null).sort((p, q) => q.s! - p.s! || p.fi - q.fi);
          const top = ranked.slice(0, R.K);
          const rest = cands.filter((c) => !top.includes(c));
          const extra: typeof cands = [];
          for (let k = 0; k < R.R && rest.length; k++) extra.push(rest.splice(Math.floor(rr() * rest.length), 1)[0]);
          if (t.cover > 0) {
            const all = [{ fi, t }, ...top, ...extra];
            d.feats = all.map((c) => featsOf(c.fi, c.t));
            d.cover = all.map((c) => c.t.cover);
          }
        }
        R.emit(d);
      }
      // The designer's part, in place.
      const rec = { fi, x: ox, y: oy, z: oz, at: [] as number[], alive: true };
      placedAt.push(rec);
      for (const u of forms[fi].units) {
        taken.or(ox + u.dx, oy + u.dy, oz + u.dz, u.mask);
        owner.set(ukey(ox + u.dx, oy + u.dy, oz + u.dz), placedAt.length - 1);
      }
      for (const p of forms[fi].probes) addProbe(ox + p.dx, oy + p.dy, oz + p.dz, p.bit);
    }
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
  if (opts.REPLAY) {
    replay(opts.REPLAY);
    return { bricks: [], residual: 0, ms: performance.now() - t0, phase };
  }

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
  if (opts.MERGE_PASS) Object.assign(phase, mergePass(built));
  if (opts.FINISH !== false) finishTops(built, taken, studs);
  if (budget > 0) for (const b of built) if (b.why) b.why.searched = { tries, kept };
  let tp = performance.now();
  if (opts.REPAIR !== false) bridge(built, taken, opts.BRIDGES ?? gridForms("3023").concat(gridForms("3710"), gridForms("3022"), gridForms("3020"), gridForms("3623")));
  if (opts.MERGE) consolidate(built);
  phase.bridge = performance.now() - tp;
  tp = performance.now();
  if (opts.CAP !== false && studs) capStuds(built, taken, wantG, studs, forms.filter((f) => !f.extra && PARTS[f.partId]?.category === "Tile" && f.units.length <= 4), opts.CAP_PRIOR ? { AIR, PRIOR } : undefined);
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

/**
 * The merge pass (Phase 2, docs/engine/phase2.md): the greedy fills a region with
 * its biggest part first and leaves strips that only small parts fit, so its
 * builds are 1×1 and 1×2 heavy where a designer used one plate. Here neighbouring
 * plain parts of one family, height and colour, side by side on one level, that
 * together make a rectangle of a stock size become that one part, again and again
 * until nothing merges.
 *
 * Unlike `consolidate` (MERGE, rejected at step 13 for losing precision), it only
 * merges parts already on the grid, and it keeps a merge only if the new part
 * still connects to every part either of the two connected to (engine/connect.ts),
 * so it never loosens the build.
 */
function mergePass(bricks: PlacedBrick[]) {
  const links = connections(bricks);
  const nb = new Map<PlacedBrick, Set<PlacedBrick>>(bricks.map((b) => [b, new Set()]));
  for (const l of links) {
    nb.get(bricks[l.a])!.add(bricks[l.b]);
    nb.get(bricks[l.b])!.add(bricks[l.a]);
  }
  let merges = 0, refused = 0;
  for (let merged = true; merged; ) {
    merged = false;
    const at = new Map<string, PlacedBrick[]>();
    // Grid parts, and exact ones that sit exactly on the grid (learned forms come
    // out as matrices even when upright): those get their grid placement here, and
    // keep their matrix unless they merge.
    const gridOf = new Map<PlacedBrick, Pick<PlacedBrick, "x" | "y" | "z" | "rot">>();
    for (const b of bricks) {
      if (b.pose) continue;
      const fam = familyOf(b.partId);
      if (!fam) continue;
      const g = b.place ? toGrid(b) : { x: b.x, y: b.y, z: b.z, rot: b.rot };
      if (!g) continue;
      gridOf.set(b, g);
      const k = `${g.y}:${fam}:${PARTS[b.partId].h}:${b.color}`;
      (at.get(k) ?? at.set(k, []).get(k)!).push(b);
    }
    for (const list of at.values())
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i], c = list[j];
          if (!a || !c) continue;
          const fa = footprintOf({ ...a, ...gridOf.get(a)! }), fc = footprintOf({ ...c, ...gridOf.get(c)! });
          let x0: number, z0: number, w: number, d: number;
          if (fa.z === fc.z && fa.d === fc.d && (fa.x + fa.w === fc.x || fc.x + fc.w === fa.x)) {
            x0 = Math.min(fa.x, fc.x); z0 = fa.z; w = fa.w + fc.w; d = fa.d;
          } else if (fa.x === fc.x && fa.w === fc.w && (fa.z + fa.d === fc.z || fc.z + fc.d === fa.z)) {
            x0 = fa.x; z0 = Math.min(fa.z, fc.z); w = fa.w; d = fa.d + fc.d;
          } else continue;
          const id = plainId(familyOf(a.partId)!, w, d);
          if (!id) continue;
          const p = PARTS[id];
          const rot: Rot = p.w === w && p.d === d ? 0 : 1;
          const next: PlacedBrick = { ...a, uid: a.uid, partId: id, x: x0, y: gridOf.get(a)!.y, z: z0, rot };
          delete next.place;
          gridOf.set(next, { x: x0, y: next.y, z: z0, rot });
          // Everything either part held on to, the new one must hold on to.
          const around = [...new Set([...nb.get(a)!, ...nb.get(c)!])].filter((o) => o !== a && o !== c);
          if (around.length) {
            const local = [next, ...around];
            const held = new Set(connections(local).filter((l) => l.a === 0 || l.b === 0).map((l) => (l.a === 0 ? l.b : l.a)));
            if (held.size < around.length) {
              refused++;
              continue;
            }
          }
          if (next.why) next.why = { ...next.why, motif: `merged: one ${p.name} instead of two parts`, repeat: false };
          // Swap a for the merged part, drop c, and carry the neighbours over.
          bricks[bricks.indexOf(a)] = next;
          bricks.splice(bricks.indexOf(c), 1);
          const ns = new Set(around);
          nb.delete(a);
          nb.delete(c);
          nb.set(next, ns);
          for (const o of around) {
            const s2 = nb.get(o)!;
            s2.delete(a);
            s2.delete(c);
            s2.add(next);
          }
          list[i] = next;
          list[j] = undefined as unknown as PlacedBrick;
          merges++;
          merged = true;
        }
  }
  return { merges, refused };
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
// `prior` (CAP_PRIOR, program v2 S7): choose the tile as the sculptor would,
// AIR · air − PRIOR · log(1 + use), not by air alone. By air alone it took the
// part that spills least, a corner round tile: 207 of them on the bench where
// designers used 12.
function capStuds(bricks: PlacedBrick[], taken: Grid, want: Grid, studs: Set<number>, tiles: Form[], prior?: { AIR: number; PRIOR: number }) {
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
    let best: { f: Form; x: number; y: number; z: number; air: number; cost: number } | null = null;
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
        const cost = prior ? prior.AIR * air - prior.PRIOR * Math.log1p(f.use) : air;
        if (!clash && (!best || cost < best.cost)) best = { f, x: ox, y: oy, z: oz, air, cost };
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
        if (y >= 1) anchors.add(ukey(x, y - 1, z)); // not under the table: the ground is layer 0
      }
      for (const a of anchors) {
        const [ax, ay, az] = unkey(a);
        for (const f of plates)
          for (const u of f.units) {
            const x = ax - u.dx, y = ay - u.dy, z = az - u.dz;
            if (f.units.some((v) => y + v.dy < 0)) continue; // a bridging plate never goes below the ground
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
