import { MAX_HEIGHT, PLATE_H } from "./units";
import { worldBox } from "./pose";
import { PARTS, footprint, rotateCell, type PartDef, type Rot } from "./parts";

export interface PlacedBrick {
  uid: string;
  partId: string;
  x: number; // min corner, studs
  y: number; // bottom, plates
  z: number; // min corner, studs
  rot: Rot;
  color: number; // LDraw color code
  /**
   * Posed parts (see pose.ts): x/y/z/rot are on the grid of segment `seg`,
   * and `pose` carries that grid into the world. Parts without a pose are on
   * the baseplate's grid.
   */
  seg?: number;
  pose?: number[];
  /**
   * Parts placed by their geometry (a ball plate by its ball, a tooth hanging
   * off a jaw): `place` is the whole part-local → world matrix, and `fp` the
   * cells the part takes on its segment's grid at x/y/z (for collisions, studs
   * and load), since its bounding box would say otherwise.
   */
  place?: number[];
  fp?: { w: number; d: number; h: number; studs: boolean };
  /** Official build step (from an imported model's STEP lines): instructions follow these. */
  step?: number;
  /** Why the engine chose this part here (engine/sculpt.ts): the terms of its score. */
  why?: Why;
  /** Parts sharing a joint id are clicked together: a ball in its socket, a panel on side studs. */
  joints?: string[];
}

/** Grid a part's cells live on: the baseplate's, or its segment's. */
export const gridOf = (b: PlacedBrick) => b.seg ?? 0;

/** Cells a part takes on its grid: its footprint, or its declared one. */
export function dims(b: PlacedBrick) {
  if (b.fp) return { w: b.fp.w, d: b.fp.d, h: b.fp.h };
  const part = PARTS[b.partId];
  return { ...footprint(part, b.rot), h: part.h };
}

/** Stud cells on top of a part, as "dx,dz" offsets. */
export function studsOf(b: PlacedBrick): Set<string> {
  if (!b.fp) return studOffsets(PARTS[b.partId], b.rot);
  const s = new Set<string>();
  if (b.fp.studs) for (let i = 0; i < b.fp.w; i++) for (let k = 0; k < b.fp.d; k++) s.add(`${i},${k}`);
  return s;
}

/** What to hand the renderer: grid placement plus pose, or the exact matrix. */
export const renderPlacement = (b: PlacedBrick) =>
  b.place ? { x: 0, y: 0, z: 0, rot: 0 as Rot, pose: b.place } : { x: b.x, y: b.y, z: b.z, rot: b.rot, pose: b.pose };

/** Occupancy map: one cell = 1 stud x 1 stud x 1 plate. */
export type Occupancy = Map<string, PlacedBrick>;

const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

export function* cells(part: PartDef, rot: Rot, x: number, y: number, z: number) {
  const { w, d } = footprint(part, rot);
  for (let i = 0; i < w; i++)
    for (let k = 0; k < d; k++)
      for (let j = 0; j < part.h; j++) yield [x + i, y + j, z + k] as const;
}

export function buildOccupancy(bricks: PlacedBrick[]): Occupancy {
  const occ: Occupancy = new Map();
  // Posed parts are off the baseplate's grid; editing collides with grid parts only.
  for (const b of bricks)
    if (!b.pose && !b.place) for (const [x, y, z] of cells(PARTS[b.partId], b.rot, b.x, b.y, b.z))
      occ.set(key(x, y, z), b);
  return occ;
}

const studCache = new Map<string, Set<string>>();

/** Stud cells of a rotated part, as "dx,dz" offsets inside its footprint. */
export function studOffsets(part: PartDef, rot: Rot): Set<string> {
  const k = `${part.id}:${rot}`;
  let set = studCache.get(k);
  if (!set) {
    set = new Set(part.studs.map(([i, j]) => rotateCell(part, rot, i, j).join(",")));
    studCache.set(k, set);
  }
  return set;
}

function hasStudAt(b: PlacedBrick, x: number, z: number) {
  return studOffsets(PARTS[b.partId], b.rot).has(`${x - b.x},${z - b.z}`);
}

export const OUTSIDE = "Outside build area";

export type PlaceResult = { ok: true } | { ok: false; reason: string };

/**
 * A part can be placed when it is inside the build volume, overlaps nothing,
 * and connects to something: the baseplate, a stud of the part below, or
 * the underside of a part above (through one of its own studs).
 */
export function canPlace(
  occ: Occupancy, part: PartDef, rot: Rot, x: number, y: number, z: number,
): PlaceResult {
  const { w, d } = footprint(part, rot);
  // No baseplate edge: the table goes on in every direction. Only the height is bounded.
  if (y < 0 || y + part.h > MAX_HEIGHT) return { ok: false, reason: OUTSIDE };

  for (const [cx, cy, cz] of cells(part, rot, x, y, z))
    if (occ.has(key(cx, cy, cz))) return { ok: false, reason: "Overlaps another part" };

  if (y === 0) return { ok: true };

  const own = studOffsets(part, rot);
  for (let i = 0; i < w; i++)
    for (let k = 0; k < d; k++) {
      const below = occ.get(key(x + i, y - 1, z + k));
      if (below && hasStudAt(below, x + i, z + k)) return { ok: true };
      if (own.has(`${i},${k}`) && occ.has(key(x + i, y + part.h, z + k))) return { ok: true };
    }
  return { ok: false, reason: "Not connected to anything" };
}

/** Bounding box of the model in grid units, or null if empty. */
export function bounds(bricks: PlacedBrick[]) {
  if (bricks.length === 0) return null;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const b of bricks) {
    if (b.pose || b.place) {
      const { lo, hi } = worldBox(b);
      minX = Math.min(minX, lo[0]); maxX = Math.max(maxX, hi[0]);
      minY = Math.min(minY, lo[1] / PLATE_H); maxY = Math.max(maxY, hi[1] / PLATE_H);
      minZ = Math.min(minZ, lo[2]); maxZ = Math.max(maxZ, hi[2]);
      continue;
    }
    const p = PARTS[b.partId];
    const { w, d } = footprint(p, b.rot);
    minX = Math.min(minX, b.x); maxX = Math.max(maxX, b.x + w);
    minY = Math.min(minY, b.y); maxY = Math.max(maxY, b.y + p.h);
    minZ = Math.min(minZ, b.z); maxZ = Math.max(maxZ, b.z + d);
  }
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

/** The reasons behind one placement: every term of the sculptor's score, and what it beat. */
export interface Why {
  /** structure: fills the shape · kept: the original designer's part · made: made to measure · fixed: placed by hand. */
  role: "structure" | "kept" | "made";
  /** Target cells it fills, and cells it fills that should be empty. */
  cover: number;
  air: number;
  /** Studs left showing: + where the design shows studs, − on a smooth surface. */
  finish: number;
  /** Studs engaged with parts already placed (both ways). */
  engaged: number;
  /** log(1 + how often designers place this part this way). */
  prior: number;
  /** Stacked on an identical copy of itself (penalised). */
  repeat: boolean;
  /** The score it won with (per cell covered), and by how much over the runner-up. */
  rank: number;
  margin: number;
  runnerUp?: string;
  /** Placed as part of a designer technique (two or more parts together). */
  motif?: string;
  /** Built in a turned segment's own frame (engine/articulate.ts): its angle off the world grid, degrees. */
  frame?: number;
  /** The search that refined the build: regions tried and changes kept. */
  searched?: { tries: number; kept: number };
}
