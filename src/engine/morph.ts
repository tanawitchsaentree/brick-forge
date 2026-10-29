import { CELL, CELL_Y, RES, RES_Y, partCells, unkey, vkey, type Voxels } from "./shape";
import type { PlacedBrick } from "./grid";
import { mul, partMatrix, translate } from "./pose";

// New target shapes from real ones, the way designers vary a design: stretch
// a body by whole studs through its middle (the ends, wheels and nose, stay
// as they were), or cross two designs of a kind by blending their solids.
// The sculptor then builds the new shape from the forms designers use.

export interface Box {
  lo: [number, number, number];
  hi: [number, number, number]; // inclusive
}

export function bounds(v: Voxels): Box {
  const lo: [number, number, number] = [Infinity, Infinity, Infinity], hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const k of v.cells.keys()) {
    const c = unkey(k);
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], c[a]);
      hi[a] = Math.max(hi[a], c[a]);
    }
  }
  return { lo, hi };
}

/** The longer horizontal axis (0 = x, 2 = z): a vehicle's length. */
export function lengthAxis(v: Voxels): 0 | 2 {
  const { lo, hi } = bounds(v);
  return hi[0] - lo[0] >= hi[2] - lo[2] ? 0 : 2;
}

/**
 * Longer or shorter by `studs` along `axis`, cut through the middle: cells
 * past the cut move out, and the slice at the cut repeats to fill the gap
 * (or slices around the cut go when shortening).
 */
export function stretch(v: Voxels, axis: 0 | 1 | 2, studs: number): Voxels {
  const shape = stretchCells(v, axis, studs);
  if (!v.studs) return shape;
  // Studs move with the surface they're on (a stud cell is a cell outside it).
  const marks: Voxels = { cells: new Map([...v.studs].map((k) => [k, 0])) };
  const moved = stretchCells(marks, axis, studs, uniformSlice(v, axis));
  return { cells: shape.cells, studs: new Set([...moved.cells.keys()].filter((k) => !shape.cells.has(k))) };
}

function stretchCells(v: Voxels, axis: 0 | 1 | 2, studs: number, at?: number): Voxels {
  const n = Math.round(studs * (axis === 1 ? RES_Y * 2.5 : RES)); // y: 1 stud ≈ 2.5 plates
  if (!n) return v;
  const cut = at ?? uniformSlice(v, axis);
  const cells = new Map<number, number>();
  for (const [k, color] of v.cells) {
    const c = unkey(k);
    if (n > 0) {
      if (c[axis] > cut) c[axis] += n;
      cells.set(vkey(c[0], c[1], c[2]), color);
      if (c[axis] === cut)
        for (let i = 1; i <= n; i++) {
          const d = [...c] as [number, number, number];
          d[axis] = cut + i;
          cells.set(vkey(d[0], d[1], d[2]), color);
        }
    } else {
      const gone = -n;
      const from = cut - Math.floor(gone / 2);
      if (c[axis] >= from && c[axis] < from + gone) continue;
      if (c[axis] >= from + gone) c[axis] -= gone;
      cells.set(vkey(c[0], c[1], c[2]), color);
    }
  }
  return { cells };
}

/**
 * Where a body can be lengthened without changing its character: the slice
 * (within the middle 60 %) most like its neighbours, e.g. a car's doors
 * rather than its cockpit or wheel arches. Repeating it changes the least.
 */
export function uniformSlice(v: Voxels, axis: 0 | 1 | 2): number {
  const { lo, hi } = bounds(v);
  const slices = new Map<number, Set<string>>();
  for (const [k, c] of v.cells) {
    const p = unkey(k);
    const key = `${axis === 0 ? p[1] : p[0]},${axis === 2 ? p[1] : p[2]},${c}`;
    (slices.get(p[axis]) ?? slices.set(p[axis], new Set()).get(p[axis])!).add(key);
  }
  const diff = (a: Set<string> | undefined, b: Set<string> | undefined) => {
    if (!a || !b) return Infinity;
    let d = 0;
    for (const x of a) if (!b.has(x)) d++;
    for (const x of b) if (!a.has(x)) d++;
    return d / Math.max(1, a.size + b.size);
  };
  const len = hi[axis] - lo[axis];
  let best = Math.floor((lo[axis] + hi[axis]) / 2), bestD = Infinity;
  for (let i = Math.ceil(lo[axis] + len * 0.2); i <= lo[axis] + len * 0.8; i++) {
    // Uniform over a stud's worth either side, not just one neighbour.
    let d = 0;
    for (let j = -RES; j < RES; j++) d += diff(slices.get(i + j), slices.get(i + j + 1));
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Fraction of solid cells within `r` of each cell (a smooth version of the solid). */
function density(v: Voxels, box: Box, r: number) {
  const nx = box.hi[0] - box.lo[0] + 1, ny = box.hi[1] - box.lo[1] + 1, nz = box.hi[2] - box.lo[2] + 1;
  const grid = new Float32Array(nx * ny * nz);
  const at = (x: number, y: number, z: number) => x + nx * (z + nz * y);
  for (const k of v.cells.keys()) {
    const [x, y, z] = unkey(k);
    const i = x - box.lo[0], j = y - box.lo[1], l = z - box.lo[2];
    if (i >= 0 && j >= 0 && l >= 0 && i < nx && j < ny && l < nz) grid[at(i, j, l)] = 1;
  }
  // Separable box blur, one axis at a time.
  const blur = (src: Float32Array, dims: [number, number, number], axis: number) => {
    const out = new Float32Array(src.length);
    const [sx, sy, sz] = dims;
    for (let y = 0; y < sy; y++)
      for (let z = 0; z < sz; z++)
        for (let x = 0; x < sx; x++) {
          let s = 0, c = 0;
          for (let d = -r; d <= r; d++) {
            const p = [x, y, z];
            p[axis] += d;
            if (p[0] < 0 || p[1] < 0 || p[2] < 0 || p[0] >= sx || p[1] >= sy || p[2] >= sz) continue;
            s += src[p[0] + sx * (p[2] + sz * p[1])];
            c++;
          }
          out[x + sx * (z + sz * y)] = s / c;
        }
    return out;
  };
  const dims: [number, number, number] = [nx, ny, nz];
  return { grid: blur(blur(blur(grid, dims, 0), dims, 1), dims, 2), nx, ny, nz };
}

/** `b` rescaled into `a`'s bounding box (each axis on its own). */
function fitInto(b: Voxels, into: Box): Voxels {
  const bb = bounds(b);
  const cells = new Map<number, number>();
  const size = (bx: Box, a: number) => bx.hi[a] - bx.lo[a] + 1;
  const s = [0, 1, 2].map((a) => size(into, a) / size(bb, a));
  for (let y = into.lo[1]; y <= into.hi[1]; y++)
    for (let z = into.lo[2]; z <= into.hi[2]; z++)
      for (let x = into.lo[0]; x <= into.hi[0]; x++) {
        const src = [x, y, z].map((v, a) => Math.floor((v - into.lo[a]) / s[a]) + bb.lo[a]);
        const c = b.cells.get(vkey(src[0], src[1], src[2]));
        if (c !== undefined) cells.set(vkey(x, y, z), c);
      }
  const studs = new Set<number>();
  for (const k of b.studs ?? []) {
    const c = unkey(k).map((v, a) => Math.round((v - bb.lo[a]) * s[a]) + into.lo[a]);
    studs.add(vkey(c[0], c[1], c[2]));
  }
  return { cells, studs };
}

/**
 * A cross of two designs: `b` fitted into `a`'s box, then their smoothed
 * solids mixed (t = how much of b) and cut at half. Colours from whichever
 * parent has the cell, a's first when t < ½.
 */
export function blend(a: Voxels, b: Voxels, t: number): Voxels {
  const box = bounds(a);
  const bf = fitInto(b, box);
  const R = 2;
  const da = density(a, box, R), db = density(bf, box, R);
  const cells = new Map<number, number>();
  for (let j = 0; j < da.ny; j++)
    for (let l = 0; l < da.nz; l++)
      for (let i = 0; i < da.nx; i++) {
        const n = i + da.nx * (l + da.nz * j);
        if ((1 - t) * da.grid[n] + t * db.grid[n] < 0.5) continue;
        const k = vkey(i + box.lo[0], j + box.lo[1], l + box.lo[2]);
        const ca = a.cells.get(k), cb = bf.cells.get(k);
        const color = t < 0.5 ? (ca ?? cb) : (cb ?? ca);
        cells.set(k, color ?? nearestColor(a, bf, k));
      }
  // Studs show where either parent shows them on the blended surface.
  const studs = new Set([...(a.studs ?? []), ...(bf.studs ?? [])].filter((k) => !cells.has(k)));
  return { cells, studs };
}

function nearestColor(a: Voxels, b: Voxels, k: number): number {
  const [x, y, z] = unkey(k);
  for (let r = 1; r < 6; r++)
    for (const [dx, dy, dz] of [[r, 0, 0], [-r, 0, 0], [0, r, 0], [0, -r, 0], [0, 0, r], [0, 0, -r]]) {
      const kk = vkey(x + dx, y + dy, z + dz);
      const c = a.cells.get(kk) ?? b.cells.get(kk);
      if (c !== undefined) return c;
    }
  return 71;
}

/** The cell offset that seats a solid on the baseplate (see seat). */
export function seatOffset(v: Voxels, plate = 32): [number, number, number] {
  const { lo, hi } = bounds(v);
  const dx = Math.round(((plate * RES) - (hi[0] + lo[0] + 1)) / 2 / RES) * RES;
  const dz = Math.round(((plate * RES) - (hi[2] + lo[2] + 1)) / 2 / RES) * RES;
  const dy = -lo[1] + (((lo[1] % RES_Y) + RES_Y) % RES_Y); // keep the plate phase
  return [dx, dy, dz];
}

/**
 * The parent's own parts, rebuilt the way a designer lengthens a model: the
 * part ahead of the cut stays, the part behind it moves back by the stretch,
 * and the gap is filled with copies of the parts in the stretch's length just
 * before the cut (the most uniform section: a car's doors, a wall), so the
 * new section is built like the old. Parts across the cut stay where they
 * were when they still fit the new shape. When shortening, the parts in the
 * removed section go and the rest close up. What's left between them (seams)
 * is for the sculptor.
 */
export function stretchParts(parts: PlacedBrick[], v: Voxels, axis: 0 | 1 | 2, studs: number): PlacedBrick[] {
  const n = Math.round(studs * (axis === 1 ? RES_Y * 2.5 : RES));
  const cut = uniformSlice(v, axis);
  const shiftBy = (b: PlacedBrick, d: number) => moveCells(b, axis === 0 ? d : 0, axis === 1 ? d : 0, axis === 2 ? d : 0);
  const out: PlacedBrick[] = [];
  const taken = new Set<number>();
  const cellsOf = (b: PlacedBrick) => {
    const c: number[] = [];
    partCells(b, (x, y, z) => c.push(vkey(x, y, z)));
    return c;
  };
  const add = (b: PlacedBrick) => {
    const c = cellsOf(b);
    if (!c.length || c.some((k) => taken.has(k))) return false;
    c.forEach((k) => taken.add(k));
    out.push(b);
    return true;
  };
  const span = (b: PlacedBrick) => {
    let lo = Infinity, hi = -Infinity;
    partCells(b, (x, y, z) => {
      const c = [x, y, z][axis];
      lo = Math.min(lo, c);
      hi = Math.max(hi, c);
    });
    return [lo, hi];
  };
  const slab: PlacedBrick[] = [];
  for (const b of parts) {
    const [lo, hi] = span(b);
    if (lo === Infinity) continue;
    if (n > 0) {
      if (lo > cut) add(shiftBy(b, n)); // behind the cut: moves back
      else if (hi <= cut) {
        add(shiftBy(b, 0)); // ahead of the cut: stays
        if (lo > cut - n) slab.push(b); // and if it's in the section before the cut, it's copied into the gap
      } else if (hi - cut <= n) add(shiftBy(b, 0)); // across the cut: stays if it still fits
    } else {
      const gone = -n, from = cut - Math.floor(gone / 2);
      if (hi >= from && lo < from + gone) continue;
      add(shiftBy(b, lo >= from + gone ? -gone : 0));
    }
  }
  // The new section: the slab again, one stretch further on.
  for (const b of slab) add({ ...shiftBy(b, n), uid: `${b.uid}+` });
  return out;
}

/** A part moved by whole cells (as an exact placement). */
export function moveCells(b: PlacedBrick, dx: number, dy: number, dz: number): PlacedBrick {
  return { ...b, x: 0, y: 0, z: 0, rot: 0, pose: undefined, seg: undefined, place: mul(translate(dx * CELL, dy * CELL_Y, dz * CELL), partMatrix(b)) };
}

/** On the baseplate: centred on a 32×32 plate (in whole studs), bottom at y = 0. */
export function seat(v: Voxels, plate = 32): Voxels {
  const [dx, dy, dz] = seatOffset(v, plate);
  const move = (k: number) => {
    const [x, y, z] = unkey(k);
    return vkey(x + dx, y + dy, z + dz);
  };
  const cells = new Map<number, number>();
  for (const [k, c] of v.cells) cells.set(move(k), c);
  return { cells, studs: v.studs && new Set([...v.studs].map(move)) };
}

/**
 * Bigger, for higher tiers: every cell becomes s×s×s, then the staircase that
 * makes is smoothed away (blur and cut at half), so slopes and curves have a
 * surface to follow rather than steps. Studs scale with the surface.
 */
export function scaleUp(v: Voxels, s: number): Voxels {
  if (s <= 1) return v;
  const box = bounds(v);
  const lo = box.lo;
  const big = new Map<number, number>();
  const size = [0, 1, 2].map((a) => Math.ceil((box.hi[a] - lo[a] + 1) * s));
  for (let y = 0; y < size[1]; y++)
    for (let z = 0; z < size[2]; z++)
      for (let x = 0; x < size[0]; x++) {
        const c = v.cells.get(vkey(lo[0] + Math.floor(x / s), lo[1] + Math.floor(y / s), lo[2] + Math.floor(z / s)));
        if (c !== undefined) big.set(vkey(x, y, z), c);
      }
  const raw: Voxels = { cells: big };
  const bb = bounds(raw);
  const d = density(raw, bb, Math.max(1, Math.round(s)));
  const cells = new Map<number, number>();
  for (let j = 0; j < d.ny; j++)
    for (let l = 0; l < d.nz; l++)
      for (let i = 0; i < d.nx; i++) {
        if (d.grid[i + d.nx * (l + d.nz * j)] < 0.5) continue;
        const k = vkey(i + bb.lo[0], j + bb.lo[1], l + bb.lo[2]);
        cells.set(k, big.get(k) ?? nearestColor(raw, raw, k));
      }
  const studs = new Set<number>();
  for (const k of v.studs ?? []) {
    const [x, y, z] = unkey(k);
    // The stud cell sits just outside the surface; scaled, it lands outside it too.
    const n = [(x - lo[0]) * s, (y - lo[1]) * s, (z - lo[2]) * s].map(Math.round);
    for (let dy = 0; dy < s; dy++) {
      const kk = vkey(n[0], n[1] + dy, n[2]);
      if (!cells.has(kk)) {
        studs.add(kk);
        break;
      }
    }
  }
  return { cells, studs };
}

/**
 * Coarser, for Junior: each stud × plate unit is all or nothing (filled when
 * at least half its cells are), so plain bricks and plates fit the shape.
 * Colours by majority per unit; studs show on every exposed top.
 */
export function blockify(v: Voxels): Voxels {
  const count = new Map<number, Map<number, number>>();
  for (const [k, c] of v.cells) {
    const [x, y, z] = unkey(k);
    const u = vkey(Math.floor(x / RES), Math.floor(y / RES_Y), Math.floor(z / RES));
    const m = count.get(u) ?? new Map<number, number>();
    m.set(c, (m.get(c) ?? 0) + 1);
    count.set(u, m);
  }
  const cells = new Map<number, number>();
  const full = RES * RES * RES_Y;
  const units = new Set<number>();
  for (const [u, m] of count) {
    const n = [...m.values()].reduce((a, b) => a + b, 0);
    if (n * 2 < full) continue;
    units.add(u);
    const color = [...m].sort((a, b) => b[1] - a[1])[0][0];
    const [ux, uy, uz] = unkey(u);
    for (let y = 0; y < RES_Y; y++)
      for (let z = 0; z < RES; z++) for (let x = 0; x < RES; x++) cells.set(vkey(ux * RES + x, uy * RES_Y + y, uz * RES + z), color);
  }
  const studs = new Set<number>();
  for (const u of units) {
    const [ux, uy, uz] = unkey(u);
    if (units.has(vkey(ux, uy + 1, uz))) continue;
    studs.add(vkey(ux * RES + RES / 2, (uy + 1) * RES_Y, uz * RES + RES / 2)); // the stud at the unit's centre
  }
  return { cells, studs };
}
