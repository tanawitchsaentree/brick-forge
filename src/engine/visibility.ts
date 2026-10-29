import { CELL, CELL_Y, unkey, vkey, type Voxels } from "./shape";

// What of a solid can be seen: its exposed cell faces, z-buffered from a fixed
// set of orthographic views (the 6 axis directions and 4 three-quarter views,
// 30° up at azimuths 45° + k·90°). Pure voxel geometry: deterministic, no
// renderer, the same in Node (the benchmark) and the browser (the sculptor).
//
// A face is visible if it wins at least one pixel in at least one view; its
// weight is the most pixels it wins in any one view (its projected area, in
// pixels of PX mm). Faces are splatted as S×S sample points, so a face seen at
// an angle still covers its footprint and nothing behind it shows through.

const MM_X = CELL * 8, MM_Y = CELL_Y * 8, MM_Z = CELL * 8; // cell size in mm (a stud is 8 mm)
const PX = 0.5; // pixel, mm
const S = 4; // samples per face edge

export type View = [number, number, number]; // unit vector from the model toward the camera

const E = Math.PI / 6;
export const VIEWS: View[] = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  ...[0, 1, 2, 3].map((k): View => {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    return [Math.cos(a) * Math.cos(E), Math.sin(E), Math.sin(a) * Math.cos(E)];
  }),
];

const NORMALS: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

export interface Visibility {
  /** Exposed face → most pixels it wins in one view (0 = never seen). Face key = cell key · 6 + normal index. */
  face: Map<number, number>;
  /** Visible area per face normal index, summed over views (pixels): how much of each side shows. */
  byNormal: number[];
  /** Is a point (in cell units) visible from any view, within a cell of depth? */
  sees: (x: number, y: number, z: number) => number;
}

/** A view's image axes (u, v) and depth axis (toward the camera). */
function basis(d: View) {
  const up: [number, number, number] = Math.abs(d[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0];
  const u = norm(cross(up, d)), v = cross(d, u);
  return { u, v, d };
}
const cross = (a: number[], b: number[]): [number, number, number] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: [number, number, number]): [number, number, number] => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export function visibility(v: Voxels, views: View[] = VIEWS): Visibility {
  const cells = v.cells;
  // Exposed faces: a filled cell next to an empty one.
  const faces: { key: number; c: [number, number, number]; n: number }[] = [];
  for (const k of cells.keys()) {
    const [x, y, z] = unkey(k);
    NORMALS.forEach(([nx, ny, nz], n) => {
      if (!cells.has(vkey(x + nx, y + ny, z + nz))) faces.push({ key: k * 6 + n, c: [x, y, z], n });
    });
  }
  const face = new Map<number, number>();
  const byNormal = [0, 0, 0, 0, 0, 0];
  const buffers: { b: ReturnType<typeof basis>; depth: Map<number, number> }[] = [];
  for (const d of views) {
    const b = basis(d);
    const depth = new Map<number, number>(); // pixel → nearest depth
    const owner = new Map<number, number>(); // pixel → face index
    faces.forEach((f, i) => {
      const nrm = NORMALS[f.n];
      if (dot(nrm, d) <= 1e-6) return; // facing away
      for (let a = 0; a < S; a++)
        for (let c = 0; c < S; c++) {
          const p = facePoint(f.c, f.n, (a + 0.5) / S, (c + 0.5) / S);
          const px = pixel(p, b), dep = dot(p, d);
          const old = depth.get(px);
          if (old === undefined || dep > old + 1e-6) {
            depth.set(px, dep);
            owner.set(px, i);
          }
        }
    });
    const won = new Map<number, number>();
    for (const i of owner.values()) won.set(i, (won.get(i) ?? 0) + 1);
    for (const [i, n] of won) {
      const k = faces[i].key;
      face.set(k, Math.max(face.get(k) ?? 0, n));
      byNormal[faces[i].n] += n;
    }
    buffers.push({ b, depth });
  }
  for (const f of faces) if (!face.has(f.key)) face.set(f.key, 0);
  // A point outside the solid is seen if, in some view, nothing nearer covers its pixel.
  const sees = (x: number, y: number, z: number) => {
    const p: [number, number, number] = [(x + 0.5) * MM_X, (y + 0.5) * MM_Y, (z + 0.5) * MM_Z];
    let best = 0;
    for (const { b, depth } of buffers) {
      const dep = depth.get(pixel(p, b));
      if (dep === undefined || dot(p, b.d) >= dep - Math.max(MM_X, MM_Y)) best++;
    }
    return best; // number of views it's seen from
  };
  return { face, byNormal, sees };
}

/** A point on a cell's face (s, t in 0..1 across it), in mm. */
function facePoint([x, y, z]: [number, number, number], n: number, s: number, t: number): [number, number, number] {
  const [nx, ny, nz] = NORMALS[n];
  const fx = nx ? (nx > 0 ? 1 : 0) : s, fy = ny ? (ny > 0 ? 1 : 0) : nx ? s : t, fz = nz ? (nz > 0 ? 1 : 0) : t;
  return [(x + fx) * MM_X, (y + fy) * MM_Y, (z + fz) * MM_Z];
}

function pixel(p: [number, number, number], b: ReturnType<typeof basis>) {
  const i = Math.floor(dot(p, b.u) / PX), j = Math.floor(dot(p, b.v) / PX);
  return (i + 8192) * 16384 + (j + 8192);
}
