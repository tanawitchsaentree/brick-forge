import { PARTS, footprint, resolvePartId, type Rot } from "../parts";
import { invKey, type Inventory } from "../inventory";
import type { PlacedBrick } from "../grid";
import { poseAtOrigin, type Mat4 } from "../pose";

// The part pool answers semantic requests ("a 2×4 plate", "a 45° slope 2
// wide", "a window") with concrete parts. In "mine" mode it prefers what the
// user owns — including unusual parts that fit the same role — and only then
// falls back to the standard part (which then shows up on the shopping list).

export type Mode = "any" | "mine";
export type RectKind = "brick" | "plate" | "tile";

/** Canonical plain parts, keyed by "short×long" studs. */
const PLAIN: Record<RectKind, Record<string, string>> = {
  brick: {
    "1x1": "3005", "1x2": "3004", "1x3": "3622", "1x4": "3010", "1x6": "3009", "1x8": "3008", "1x10": "6111", "1x12": "6112",
    "2x2": "3003", "2x3": "3002", "2x4": "3001", "2x6": "2456", "2x8": "3007", "2x10": "3006",
  },
  plate: {
    "1x1": "3024", "1x2": "3023", "1x3": "3623", "1x4": "3710", "1x6": "3666", "1x8": "3460", "1x10": "4477", "1x12": "60479",
    "2x2": "3022", "2x3": "3021", "2x4": "3020", "2x6": "3795", "2x8": "3034", "2x10": "3832", "2x12": "2445",
    "3x3": "11212", "4x4": "3031", "4x6": "3032", "4x8": "3035", "4x10": "3030", "4x12": "3029",
    "6x6": "3958", "6x8": "3036", "6x10": "3033", "6x12": "3028", "8x8": "41539",
  },
  tile: {
    "1x1": "3070b", "1x2": "3069b", "1x3": "63864", "1x4": "2431", "1x6": "6636", "1x8": "4162",
    "2x2": "3068b", "2x3": "26603", "2x4": "87079", "2x6": "69729", "6x6": "10202",
  },
};

/** The plain part covering a×b studs (a along x), with the rotation that lays it that way. */
export function plain(kind: RectKind, a: number, b: number): { id: string; rot: Rot } | null {
  const raw = PLAIN[kind][`${Math.min(a, b)}x${Math.max(a, b)}`];
  const id = raw && resolvePartId(raw);
  if (!id) return null;
  const p = PARTS[id];
  return { id, rot: p.w === a && p.d === b ? 0 : 1 };
}

/** Every canonical plain part (for prefetching geometry). */
export const plainIds = () => (Object.keys(PLAIN) as RectKind[]).flatMap((k) => Object.values(PLAIN[k]).map((id) => resolvePartId(id))).filter((x): x is string => !!x);

export const sizesOf = (kind: RectKind) => Object.keys(PLAIN[kind]).map((k) => k.split("x").map(Number) as [number, number]);

export class Pool {
  private left = new Map<string, number>();
  private taken = new Map<string, number>();

  constructor(
    readonly mode: Mode,
    inv: Inventory,
  ) {
    for (const [k, q] of Object.entries(inv)) this.left.set(k, q);
  }

  /** A copy with the same stock left (for trial builds). */
  fork(): Pool {
    const p = new Pool(this.mode, {});
    for (const [k, q] of this.left) p.left.set(k, q);
    return p;
  }

  owned(id: string, color: number) {
    return this.left.get(invKey(id, color)) ?? 0;
  }

  /** Use one of a part (owned stock first). */
  take(id: string, color: number) {
    const k = invKey(id, color);
    const n = this.left.get(k);
    if (n) {
      this.left.set(k, n - 1);
      this.taken.set(k, (this.taken.get(k) ?? 0) + 1);
    }
  }

  /** Put one back (a placement that was undone). */
  give(id: string, color: number) {
    const k = invKey(id, color);
    const t = this.taken.get(k);
    if (!t) return;
    this.taken.set(k, t - 1);
    this.left.set(k, (this.left.get(k) ?? 0) + 1);
  }

  /**
   * First candidate the user still owns in this colour (mine mode), else the
   * first candidate that exists at all. Candidates are tried in order, so
   * callers list the ideal part first and acceptable stand-ins after.
   */
  pick(candidates: string[], color: number): string | null {
    const ids = candidates.map((c) => resolvePartId(c)).filter((x): x is string => !!x);
    if (this.mode === "mine") {
      const mine = ids.find((id) => this.owned(id, color) > 0);
      if (mine) return mine;
    }
    return ids[0] ?? null;
  }

  /**
   * Owned parts that can stand in for a plain a×b part of this kind: same
   * footprint and height, studs on every cell (tiles: none) — e.g. a "Brick
   * 1×2 with Grille" for a plain 1×2 brick. This is how odd parts in a
   * collection get used.
   */
  standIns(kind: RectKind, a: number, b: number, color: number): string[] {
    if (this.mode !== "mine") return [];
    const h = kind === "brick" ? 3 : 1;
    const out: string[] = [];
    for (const [k, q] of this.left) {
      if (q <= 0) continue;
      const i = k.lastIndexOf(":");
      if (Number(k.slice(i + 1)) !== color) continue;
      const p = PARTS[k.slice(0, i)];
      if (!p || p.h !== h || p.approx || p.shape.type !== "ldraw") continue;
      if (Math.min(p.w, p.d) !== Math.min(a, b) || Math.max(p.w, p.d) !== Math.max(a, b)) continue;
      if (!p.tags?.includes(kind)) continue;
      if (p.studs.length !== (kind === "tile" ? 0 : p.w * p.d)) continue;
      out.push(p.id);
    }
    return out;
  }
}

/** A grid of its own for an off-grid part (a side panel), stable for a given uid. */
function offGrid(uid: string) {
  let h = 2166136261;
  for (const c of uid) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return -1 - (h >>> 1);
}

/** A placed part plus the module it belongs to. */
export interface Part extends PlacedBrick {
  group: string;
}

/**
 * Places parts on the stud grid with collision checks, and knows how LEGO
 * designers fill space: rectangles with the fewest parts, walls in running
 * bond, rows of slopes. Every part is tagged with the module being built.
 */
export class Builder {
  parts: Part[] = [];
  /** Placements that collided or named a missing part (design bugs show up here). */
  failed: { id: string; x: number; y: number; z: number; group: string }[] = [];
  private occ = new Set<string>();
  private group = "Base";
  private n = 0;

  /**
   * One grid: the baseplate's, or (with `seg`) a posed segment's — a tail
   * section, a leg — whose parts carry `pose` into the world. `prefix`
   * keeps part ids unique across segments.
   */
  constructor(
    readonly pool: Pool,
    readonly seg?: { id: number; pose: Mat4 },
    private prefix = "a",
  ) {}

  /** The module parts are being tagged with. */
  get moduleName() {
    return this.group;
  }

  /** Build `fn` as a named module (an instruction chapter, a row in the parts tree). */
  module(name: string, fn: () => void) {
    const prev = this.group;
    this.group = name;
    fn();
    this.group = prev;
  }

  private cells(id: string, x: number, y: number, z: number, rot: Rot) {
    const part = PARTS[id];
    const { w, d } = footprint(part, rot);
    const out: string[] = [];
    for (let i = 0; i < w; i++) for (let k = 0; k < d; k++) for (let j = 0; j < part.h; j++) out.push(`${x + i},${y + j},${z + k}`);
    return out;
  }

  isFree(x: number, y: number, z: number) {
    return !this.occ.has(`${x},${y},${z}`);
  }

  /** Place a part by id (min corner x/z, bottom y in plates). Returns false if it would collide. */
  put(raw: string | string[], x: number, y: number, z: number, rot: Rot, color: number): boolean {
    const id = Array.isArray(raw) ? this.pool.pick(raw, color) : this.pool.pick([raw], color);
    const fail = () => {
      this.failed.push({ id: String(raw), x, y, z, group: this.group });
      return false;
    };
    if (!id || !PARTS[id]) return fail();
    const cells = this.cells(id, x, y, z, rot);
    if (cells.some((c) => this.occ.has(c))) return fail();
    cells.forEach((c) => this.occ.add(c));
    this.parts.push({ uid: `${this.prefix}${this.n++}`, partId: id, x, y, z, rot, color, group: this.group, ...this.segFields() });
    this.pool.take(id, color);
    return true;
  }

  private segFields() {
    return this.seg ? { seg: this.seg.id, pose: this.seg.pose } : {};
  }

  /** A point to roll back to (see rollback). */
  mark() {
    return this.parts.length;
  }

  /** Undo every grid placement since `mark` (exact parts must not be among them). */
  rollback(mark: number) {
    for (const p of this.parts.splice(mark)) {
      for (const c of this.cells(p.partId, p.x, p.y, p.z, p.rot)) this.occ.delete(c);
      this.pool.give(p.partId, p.color);
    }
  }

  /** Mark cells as taken without a part (room for a jaw, a joint's swing). */
  block(x: number, y: number, z: number, w = 1, h = 1, d = 1) {
    for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) for (let k = 0; k < d; k++) this.occ.add(`${x + i},${y + j},${z + k}`);
  }

  /**
   * Place a part by its geometry: LDraw origin at `at` (this grid's frame,
   * world units), turned by `rot`. `cell`/`fp` are the grid cells it takes
   * (checked and reserved; its studs clutch like a grid part's), `joints`
   * what it clicks onto off-grid.
   */
  exact(
    raw: string | string[],
    at: [number, number, number],
    rot: Mat4,
    color: number,
    opts: { cell?: [number, number, number]; fp?: { w: number; d: number; h: number; studs: boolean }; joints?: string[] } = {},
  ): Part | null {
    const id = this.pool.pick(Array.isArray(raw) ? raw : [raw], color);
    const [x, y, z] = opts.cell ?? [0, 0, 0];
    const fail = () => {
      this.failed.push({ id: String(raw), x, y, z, group: this.group });
      return null;
    };
    if (!id || !PARTS[id]) return fail();
    const fp = opts.cell ? (opts.fp ?? { w: 1, d: 1, h: 1, studs: true }) : undefined;
    if (fp) {
      for (let i = 0; i < fp.w; i++) for (let j = 0; j < fp.h; j++) for (let k = 0; k < fp.d; k++) if (!this.isFree(x + i, y + j, z + k)) return fail();
      this.block(x, y, z, fp.w, fp.h, fp.d);
    }
    const frame = this.seg?.pose ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const uid = `${this.prefix}${this.n++}`;
    const p: Part = {
      uid,
      partId: id,
      x, y, z,
      rot: 0,
      color,
      group: this.group,
      ...this.segFields(),
      place: poseAtOrigin(PARTS[id], frame, at, rot),
      // Off-grid parts (no cell) still need a grid of their own, apart from everyone else's.
      ...(fp ? { fp } : { seg: offGrid(uid) }),
      ...(opts.joints ? { joints: opts.joints } : {}),
    };
    this.parts.push(p);
    this.pool.take(id, color);
    return p;
  }

  /**
   * Fill the free cells of a w×d rectangle, one layer of `kind`, with as few
   * parts as possible: largest area first, then the grain direction, scanning
   * cell by cell (cells already taken — by an eye, a tail — are skipped).
   */
  rect(kind: RectKind, x0: number, z0: number, w: number, d: number, y: number, color: number, grainX = true) {
    const sizes = sizesOf(kind).flatMap(([a, b]) => (a === b ? [[a, b]] : [[a, b], [b, a]]) as [number, number][]);
    sizes.sort((p, q) => q[0] * q[1] - p[0] * p[1] || (grainX ? q[0] - p[0] : q[1] - p[1]));
    const h = kind === "brick" ? 3 : 1;
    const fits = (x: number, z: number, a: number, b: number) => {
      if (x + a > x0 + w || z + b > z0 + d) return false;
      for (let i = 0; i < a; i++) for (let k = 0; k < b; k++) for (let j = 0; j < h; j++) if (!this.isFree(x + i, y + j, z + k)) return false;
      return true;
    };
    for (let z = z0; z < z0 + d; z++)
      for (let x = x0; x < x0 + w; x++) {
        if (!this.isFree(x, y, z)) continue;
        for (const [a, b] of sizes) {
          if (!fits(x, z, a, b)) continue;
          const p = plain(kind, a, b);
          if (!p) continue;
          const alt = this.pool.standIns(kind, a, b, color);
          if (this.put([...alt, p.id], x, y, z, alt.length ? ((PARTS[alt[0]].w === a ? 0 : 1) as Rot) : p.rot, color)) break;
        }
      }
  }

  /**
   * A straight 1-wide run (a wall course) of length `len` along x or z,
   * cut into 1×4 / 1×3 / 1×2 / 1×1 parts. `shift` shortens the first part so
   * joints don't line up with the course below (running bond).
   */
  run(kind: RectKind, x0: number, z0: number, len: number, alongX: boolean, y: number, color: number, shift = 0) {
    const h = kind === "brick" ? 3 : 1;
    const at = (t: number) => (alongX ? [x0 + t, z0] : [x0, z0 + t]) as [number, number];
    const free = (t: number) => {
      const [x, z] = at(t);
      for (let j = 0; j < h; j++) if (!this.isFree(x, y + j, z)) return false;
      return true;
    };
    // Split the run into free stretches (windows and doors interrupt it), then
    // cover each stretch with the longest parts that fit.
    let t = 0;
    let first = true;
    while (t < len) {
      if (!free(t)) {
        t++;
        continue;
      }
      let end = t;
      while (end + 1 < len && free(end + 1)) end++;
      let u = t;
      while (u <= end) {
        const room = end - u + 1;
        const n = first && shift > 0 ? Math.min(shift, room) : [4, 3, 2, 1].find((p) => p <= room)!;
        first = false;
        const [x, z] = at(u);
        const p = plain(kind, alongX ? n : 1, alongX ? 1 : n);
        if (p) this.put(p.id, x, y, z, p.rot, color);
        u += n;
      }
      t = end + 1;
    }
  }

  /**
   * A row of 45° slopes along a run, facing (descending toward) one side.
   * Slopes are 2 deep; widths 4/3/2/1 cover the run with as few as possible.
   */
  slopes(x0: number, z0: number, len: number, y: number, face: "+x" | "-x" | "+z" | "-z", color: number, ids = SLOPES) {
    const alongX = face === "+z" || face === "-z";
    const rot: Rot = face === "+z" ? 0 : face === "+x" ? 3 : face === "-z" ? 2 : 1;
    let t = 0;
    while (t < len) {
      const n = [4, 3, 2, 1].find((k) => k <= len - t && ids[k])!;
      const x = alongX ? x0 + t : x0, z = alongX ? z0 : z0 + t;
      this.put(ids[n], x, y, z, rot, color);
      t += n;
    }
  }
}

/** 45° slopes 2 deep, by width. */
export const SLOPES: Record<number, string> = { 1: "3040", 2: "3039", 3: "3038", 4: "3037" };
/** 45° double slopes (roof ridge), by width. */
export const RIDGE: Record<number, string> = { 1: "3044", 2: "3043" };
