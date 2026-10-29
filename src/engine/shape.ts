import { PARTS, type PartDef, type Rot } from "./parts";
import type { PlacedBrick } from "./grid";
import { apply, invertRigid, partMatrix } from "./pose";
import { PLATE_H } from "./units";

// Shapes as solid voxels finer than the stud grid: RES cells per stud across,
// RES_Y per plate up. A part's shape is scanned once from its real geometry
// (scene/shapeScan.ts → public/shapes.json); a model's shape is the union of
// its parts'. This is what "which part answers which shape" is measured on:
// a slope, a curve, a wedge are the cells they fill, not names.

export const RES = 4; // cells per stud (x, z)
export const RES_Y = 2; // cells per plate (y)
export const CELL = 1 / RES; // studs
export const CELL_Y = PLATE_H / RES_Y; // world units

/** A part's solid in its local frame (x, y, z cell counts; bits x-fastest, then z, then y). */
export interface PartShape {
  nx: number;
  ny: number;
  nz: number;
  bits: Uint8Array;
}

export const shapeIndex = (s: { nx: number; nz: number }, x: number, y: number, z: number) => x + s.nx * (z + s.nz * y);
export const filled = (s: PartShape, x: number, y: number, z: number) => {
  const i = shapeIndex(s, x, y, z);
  return (s.bits[i >> 3] >> (i & 7)) & 1;
};

const SHAPES = new Map<string, PartShape>();

export function installShapes(table: Record<string, [number, number, number, string]>) {
  for (const [id, [nx, ny, nz, b64]] of Object.entries(table)) {
    const bin = atob(b64);
    const bits = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bits[i] = bin.charCodeAt(i);
    SHAPES.set(id, { nx, ny, nz, bits });
  }
}

/** A shape known without scanning (a part made to measure). */
export function installShapeBits(id: string, s: PartShape) {
  SHAPES.set(id, s);
}

/** The scanned shape, or the part's box when it hasn't been scanned. */
export function partShape(part: PartDef): PartShape {
  let s = SHAPES.get(part.id);
  if (!s) {
    const nx = part.w * RES, ny = part.h * RES_Y, nz = part.d * RES;
    s = { nx, ny, nz, bits: new Uint8Array(Math.ceil((nx * ny * nz) / 8)).fill(255) };
    SHAPES.set(part.id, s);
  }
  return s;
}

export const hasShape = (id: string) => SHAPES.has(id);

/** World voxels (a sparse set of cell keys) and per-cell colour. */
export interface Voxels {
  cells: Map<number, number>; // key → colour
  /** Cells just outside the surface where a stud shows (studs not covered by anything): its finish. */
  studs?: Set<number>;
}

const K = 1 << 10; // cells per axis in a key (models up to 256 studs across)
export const vkey = (x: number, y: number, z: number) => (x + 512) + K * ((z + 512) + K * (y + 512));
export const unkey = (k: number): [number, number, number] => [(k % K) - 512, Math.floor(k / (K * K)) - 512, (Math.floor(k / K) % K) - 512];

/**
 * The cells a placed part fills. Grid parts map cell for cell (quarter turns);
 * posed and exact parts are sampled: each world cell near the part takes its
 * centre back into the part's frame.
 */
export function partCells(b: PlacedBrick, out: (x: number, y: number, z: number) => void) {
  const part = PARTS[b.partId];
  if (!part) return;
  const s = partShape(part);
  if (!b.place && !b.pose) {
    for (let y = 0; y < s.ny; y++)
      for (let z = 0; z < s.nz; z++)
        for (let x = 0; x < s.nx; x++) {
          if (!filled(s, x, y, z)) continue;
          // Local (x, z) → footprint cell for the quarter turn (clockwise from above, like Rot).
          const [fx, fz] = turn(x, z, s.nx, s.nz, b.rot);
          out(b.x * RES + fx, b.y * RES_Y + y, b.z * RES + fz);
        }
    return;
  }
  const m = partMatrix(b);
  const inv = invertRigid(m);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const size = [s.nx * CELL, s.ny * CELL_Y, s.nz * CELL];
  for (const cx of [0, size[0]]) for (const cy of [0, size[1]]) for (const cz of [0, size[2]]) {
    const p = apply(m, [cx, cy, cz]);
    for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p[a]); hi[a] = Math.max(hi[a], p[a]); }
  }
  for (let y = Math.floor(lo[1] / CELL_Y); y < Math.ceil(hi[1] / CELL_Y); y++)
    for (let z = Math.floor(lo[2] / CELL); z < Math.ceil(hi[2] / CELL); z++)
      for (let x = Math.floor(lo[0] / CELL); x < Math.ceil(hi[0] / CELL); x++) {
        const q = apply(inv, [(x + 0.5) * CELL, (y + 0.5) * CELL_Y, (z + 0.5) * CELL]);
        const i = Math.floor(q[0] / CELL), j = Math.floor(q[1] / CELL_Y), k = Math.floor(q[2] / CELL);
        if (i < 0 || j < 0 || k < 0 || i >= s.nx || j >= s.ny || k >= s.nz) continue;
        if (filled(s, i, j, k)) out(x, y, z);
      }
}

/** Part-local cell (x, z) on a w×d (cells) part → its footprint cell after `rot` quarter turns. */
export function turn(x: number, z: number, nx: number, nz: number, rot: Rot): [number, number] {
  switch (rot) {
    case 0: return [x, z];
    case 1: return [nz - 1 - z, x];
    case 2: return [nx - 1 - x, nz - 1 - z];
    default: return [z, nx - 1 - x];
  }
}

/** A model's solid, and where its studs show. */
export function voxelize(bricks: PlacedBrick[]): Voxels {
  const cells = new Map<number, number>();
  for (const b of bricks) partCells(b, (x, y, z) => cells.set(vkey(x, y, z), b.color));
  const studs = new Set<number>();
  for (const b of bricks)
    for (const k of studCells(b)) if (!cells.has(k)) studs.add(k);
  return { cells, studs };
}

const DIRS: [number, number, number][] = [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];

/** The cell each of a part's studs reaches into (any direction). */
export function studCells(b: PlacedBrick): number[] {
  const part = PARTS[b.partId];
  if (!part) return [];
  const list = part.connectors ?? part.studs.map(([i, k]): [number, number, number, number] => [i + 0.5, part.h * PLATE_H, k + 0.5, 0]);
  const m = partMatrix(b);
  return list.map(([x, y, z, d]) => {
    const u = DIRS[d];
    const p = apply(m, [x + u[0] * 0.1, y + u[1] * 0.1, z + u[2] * 0.1]);
    return vkey(Math.floor(p[0] / CELL), Math.floor(p[1] / CELL_Y), Math.floor(p[2] / CELL));
  });
}

/** Intersection over union of two solids. */
export function iou(a: Voxels, b: Voxels): number {
  let both = 0;
  for (const k of a.cells.keys()) if (b.cells.has(k)) both++;
  const union = a.cells.size + b.cells.size - both;
  return union ? both / union : 1;
}
