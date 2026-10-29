import * as THREE from "three";
import type { PartDef } from "../engine/parts";
import { CELL, CELL_Y, RES, RES_Y, shapeIndex } from "../engine/shape";
import { PLATE_H } from "../engine/units";
import { loadTemplate } from "./ldraw";

// Scans a part's real geometry into solid cells (engine/shape.ts). LDraw
// meshes aren't closed (hollow undersides, open studs), so "inside" is the
// outer hull from three directions: under the top surface seen from above,
// and between the first surfaces seen from either side along x and along z.
// The side views keep what a top view can't: an inverted slope's underside,
// an arch's opening, a round brick's curve.

const solid = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });

export async function scanPart(part: PartDef): Promise<{ nx: number; ny: number; nz: number; bits: Uint8Array }> {
  const template = await loadTemplate(part);
  const meshes: THREE.Mesh[] = [];
  const root = template.clone(true);
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      const c = new THREE.Mesh(m.geometry, solid);
      c.matrixWorld.copy(m.matrixWorld);
      c.matrixAutoUpdate = false;
      meshes.push(c);
    }
  });
  const W = part.w, H = part.h * PLATE_H, D = part.d;
  const nx = part.w * RES, ny = part.h * RES_Y, nz = part.d * RES;
  const ray = new THREE.Raycaster();
  const first = (o: THREE.Vector3, d: THREE.Vector3) => {
    ray.set(o, d);
    ray.far = 100;
    const h = ray.intersectObjects(meshes, false);
    return h.length ? h[0].distance : null;
  };
  const down = new THREE.Vector3(0, -1, 0);
  const px = new THREE.Vector3(1, 0, 0), nxv = new THREE.Vector3(-1, 0, 0);
  const pz = new THREE.Vector3(0, 0, 1), nzv = new THREE.Vector3(0, 0, -1);
  const M = 1; // rays start this far outside the box
  // Top surface per column (y, clamped to the box: studs don't count as body).
  const top = new Float32Array(nx * nz).fill(-1);
  for (let k = 0; k < nz; k++)
    for (let i = 0; i < nx; i++) {
      const t = first(new THREE.Vector3((i + 0.5) * CELL, H + M, (k + 0.5) * CELL), down);
      if (t !== null) top[i + nx * k] = Math.min(H, H + M - t);
    }
  // Close the height map (3×3 dilate, then erode): a ray down a hollow stud or
  // a pin hole would otherwise cut a tunnel through the part.
  const pass = (src: Float32Array, pick: (a: number, b: number) => number) => {
    const out = new Float32Array(src.length);
    for (let k = 0; k < nz; k++)
      for (let i = 0; i < nx; i++) {
        let v = src[i + nx * k];
        for (let dk = -1; dk <= 1; dk++)
          for (let di = -1; di <= 1; di++) {
            const a = i + di, c = k + dk;
            if (a >= 0 && c >= 0 && a < nx && c < nz) v = pick(v, src[a + nx * c]);
          }
        out[i + nx * k] = v;
      }
    return out;
  };
  const closed = pass(pass(top, Math.max), Math.min);
  // Only raise columns (never lower a real edge), and never fill an empty column.
  for (let n = 0; n < top.length; n++) if (top[n] >= 0) top[n] = Math.max(top[n], closed[n]);

  // Side extents per row along x (at y, z) and along z (at x, y).
  const xr = new Float32Array(ny * nz * 2).fill(NaN);
  for (let j = 0; j < ny; j++)
    for (let k = 0; k < nz; k++) {
      const y = (j + 0.5) * CELL_Y, z = (k + 0.5) * CELL;
      const a = first(new THREE.Vector3(-M, y, z), px), b = first(new THREE.Vector3(W + M, y, z), nxv);
      if (a !== null && b !== null) {
        xr[(j * nz + k) * 2] = a - M;
        xr[(j * nz + k) * 2 + 1] = W + M - b;
      }
    }
  const zr = new Float32Array(ny * nx * 2).fill(NaN);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const y = (j + 0.5) * CELL_Y, x = (i + 0.5) * CELL;
      const a = first(new THREE.Vector3(x, y, -M), pz), b = first(new THREE.Vector3(x, y, D + M), nzv);
      if (a !== null && b !== null) {
        zr[(j * nx + i) * 2] = a - M;
        zr[(j * nx + i) * 2 + 1] = D + M - b;
      }
    }
  const s = { nx, ny, nz, bits: new Uint8Array(Math.ceil((nx * ny * nz) / 8)) };
  for (let j = 0; j < ny; j++)
    for (let k = 0; k < nz; k++)
      for (let i = 0; i < nx; i++) {
        const x = (i + 0.5) * CELL, y = (j + 0.5) * CELL_Y, z = (k + 0.5) * CELL;
        const t = top[i + nx * k];
        if (t < 0 || y > t) continue;
        const x0 = xr[(j * nz + k) * 2], x1 = xr[(j * nz + k) * 2 + 1];
        if (!(x >= x0 && x <= x1)) continue;
        const z0 = zr[(j * nx + i) * 2], z1 = zr[(j * nx + i) * 2 + 1];
        if (!(z >= z0 && z <= z1)) continue;
        const n = shapeIndex(s, i, j, k);
        s.bits[n >> 3] |= 1 << (n & 7);
      }
  return s;
}
