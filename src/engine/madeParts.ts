import { registerPart, type PartDef } from "./parts";
import type { PlacedBrick } from "./grid";
import { CELL, CELL_Y, RES, RES_Y, installShapeBits, partCells, unkey, vkey, type Voxels } from "./shape";
import { translate } from "./pose";

// Parts made to measure: where the sculptor leaves target cells no real part
// fits, the cells are grouped into blobs and each blob becomes a part of its
// own, its exact shape written out as LDraw faces (a 3D-printable piece).
// The shape is registered too, so the made part counts like any other.

export interface MadeSpec {
  part: PartDef;
  /** LDraw lines of the part in its own frame (origin at its min corner). */
  ldraw: string;
  brick: PlacedBrick;
}

const NB: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/**
 * Target cells no placed part fills, as 6-connected blobs, from solid gaps
 * only: a unit (stud × plate) counts when at least half of what it should
 * hold is missing. Thinner gaps are the ordinary seams between parts; made
 * parts there would wrap the model in a skin.
 */
export function residualBlobs(target: Voxels, bricks: PlacedBrick[], minCells: number): number[][] {
  const filled = new Set<number>();
  for (const b of bricks) partCells(b, (x, y, z) => filled.add(vkey(x, y, z)));
  const unit = (k: number) => {
    const [x, y, z] = unkey(k);
    return vkey(Math.floor(x / RES), Math.floor(y / RES_Y), Math.floor(z / RES));
  };
  const want = new Map<number, number>(), miss = new Map<number, number>();
  for (const k of target.cells.keys()) {
    const u = unit(k);
    want.set(u, (want.get(u) ?? 0) + 1);
    if (!filled.has(k)) miss.set(u, (miss.get(u) ?? 0) + 1);
  }
  const left = new Set([...target.cells.keys()].filter((k) => !filled.has(k) && miss.get(unit(k))! * 2 >= want.get(unit(k))!));
  const blobs: number[][] = [];
  for (const start of left) {
    if (!left.has(start)) continue;
    const blob = [start];
    left.delete(start);
    for (let i = 0; i < blob.length; i++) {
      const [x, y, z] = unkey(blob[i]);
      for (const [dx, dy, dz] of NB) {
        const k = vkey(x + dx, y + dy, z + dz);
        if (left.has(k)) {
          left.delete(k);
          blob.push(k);
        }
      }
    }
    if (blob.length < minCells) continue;
    // Compact gaps only (a part, not a skin): the blob fills ≥ 40 % of its box.
    const cs = blob.map(unkey);
    // Box volume by a loop (spreading a big blob's cells into Math.max overflowed the stack).
    const vol = [0, 1, 2].reduce((v, a) => {
      let lo = Infinity, hi = -Infinity;
      for (const c of cs) (lo = Math.min(lo, c[a])), (hi = Math.max(hi, c[a]));
      return v * (hi - lo + 1);
    }, 1);
    if (blob.length >= vol * 0.4) blobs.push(blob);
  }
  return blobs;
}

/** A blob as a part: faces where a cell has no neighbour in the blob. */
export function makeBlobPart(blob: number[], id: string, color: number): MadeSpec {
  const cells = blob.map(unkey);
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const [x, y, z] of cells) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); z0 = Math.min(z0, z);
    x1 = Math.max(x1, x); y1 = Math.max(y1, y); z1 = Math.max(z1, z);
  }
  const nx = x1 - x0 + 1, ny = y1 - y0 + 1, nz = z1 - z0 + 1;
  const inside = new Set(blob);
  // Part-local world coords (studs, y up) → LDraw (y down, z toward the viewer): ×20, −y, −z.
  const L = (x: number, y: number, z: number) => `${+(x * CELL * 20).toFixed(3)} ${+(-y * CELL_Y * 20).toFixed(3)} ${+(-z * CELL * 20).toFixed(3)}`;
  const lines: string[] = [`0 Made to measure (${blob.length} cells)`, `0 Name: ${id}.dat`, "0 BFC NOCERTIFY"];
  for (const [x, y, z] of cells) {
    const i = x - x0, j = y - y0, k = z - z0;
    for (const [dx, dy, dz] of NB) {
      if (inside.has(vkey(x + dx, y + dy, z + dz))) continue;
      // The face of cell (i, j, k) toward (dx, dy, dz): four corners.
      const c = (a: number, b: number, e: number) => L(i + a, j + b, k + e);
      const q =
        dx === 1 ? [c(1, 0, 0), c(1, 1, 0), c(1, 1, 1), c(1, 0, 1)]
        : dx === -1 ? [c(0, 0, 0), c(0, 0, 1), c(0, 1, 1), c(0, 1, 0)]
        : dy === 1 ? [c(0, 1, 0), c(0, 1, 1), c(1, 1, 1), c(1, 1, 0)]
        : dy === -1 ? [c(0, 0, 0), c(1, 0, 0), c(1, 0, 1), c(0, 0, 1)]
        : dz === 1 ? [c(0, 0, 1), c(1, 0, 1), c(1, 1, 1), c(0, 1, 1)]
        : [c(0, 0, 0), c(0, 1, 0), c(1, 1, 0), c(1, 0, 0)];
      lines.push(`4 16 ${q.join(" ")}`);
    }
  }
  const part: PartDef = {
    id,
    name: `Made to measure ${Math.ceil(nx / RES)}×${Math.ceil(nz / RES)}`,
    label: "Made",
    category: "Made",
    w: Math.ceil(nx / RES),
    d: Math.ceil(nz / RES),
    h: Math.ceil(ny / RES_Y),
    shape: { type: "ldraw" },
    studs: [],
    origin: [0, 0, 0],
    approx: true,
    made: lines.join("\n"),
  };
  registerPart(part);
  // Its shape: exactly the blob's cells, in its own frame.
  const bits = new Uint8Array(Math.ceil((part.w * RES * part.h * RES_Y * part.d * RES) / 8));
  const sx = part.w * RES, sz = part.d * RES;
  for (const [x, y, z] of cells) {
    const n = (x - x0) + sx * ((z - z0) + sz * (y - y0));
    bits[n >> 3] |= 1 << (n & 7);
  }
  installShapeBits(id, { nx: sx, ny: part.h * RES_Y, nz: sz, bits });
  const brick: PlacedBrick = { uid: id, partId: id, x: 0, y: 0, z: 0, rot: 0, color, place: translate(x0 * CELL, y0 * CELL_Y, z0 * CELL) };
  return { part, ldraw: part.made!, brick };
}
