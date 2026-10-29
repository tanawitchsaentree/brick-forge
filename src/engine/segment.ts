import { CELL, CELL_Y, unkey, vkey, type Voxels } from "./shape";
import type { Mat4 } from "./pose";

// The skeleton of a shape: segments, each with its own axis.
//
// An animal or a robot isn't built on one grid: a tail points down and
// back, a head tilts, a leg angles out. Designers build each part straight on
// its own grid and turn the whole part (on hinges, ball joints, angled
// plates). So a shape is cut into segments that are each close to a straight
// box, and each gets a frame from its principal axes:
//
//   • PCA: the eigenvectors of a segment's covariance matrix (3 × 3, by
//     Jacobi rotations) are its axes; the largest eigenvalue's is its length.
//   • Where to cut: along the length, the cross-section area profile A(t);
//     a waist (A dips below half of the bigger side's peak) is a neck, a
//     tail's root, a wrist. And the centre line c(t): if it bends away from
//     the straight line between its ends by more than a part of the width,
//     the cut goes at the bend.
//   • Cut recursively until every segment is straight; tiny segments merge
//     into the neighbour they touch most.
//
// A segment keeps the world grid unless it's really turned: its axes more
// than a few degrees off, and its box along them clearly smaller than along
// the world's (the minimum-volume bounding box). A house keeps the world grid.

export interface Segment {
  cells: number[];
  /** Local → world rotation (columns: local x, y, z in world), or null for the world grid. */
  frame: Mat4 | null;
  /** Centroid (world units). */
  centre: [number, number, number];
  /** Angle of the frame off the world grid, degrees. */
  tilt: number;
}

type V3 = [number, number, number];
const centreOf = (k: number): V3 => {
  const [x, y, z] = unkey(k);
  return [(x + 0.5) * CELL, (y + 0.5) * CELL_Y, (z + 0.5) * CELL];
};
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Eigen-decomposition of a symmetric 3×3 (Jacobi rotations): values and unit vectors, largest first. */
export function eigen3(m: number[][]): { values: number[]; vectors: V3[] } {
  const a = m.map((r) => [...r]);
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
    if (off < 1e-12) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(a[p][q]) < 1e-15) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = a[k][p], akq = a[k][q];
        a[k][p] = c * akp - s * akq;
        a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p][k], aqk = a[q][k];
        a[p][k] = c * apk - s * aqk;
        a[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k][p], vkq = v[k][q];
        v[k][p] = c * vkp - s * vkq;
        v[k][q] = s * vkp + c * vkq;
      }
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[j][j] - a[i][i]);
  return { values: order.map((i) => a[i][i]), vectors: order.map((i) => norm([v[0][i], v[1][i], v[2][i]])) };
}

/** Mean and principal axes of a set of cells. */
export function pca(cells: number[]) {
  const pts = cells.map(centreOf);
  const mean: V3 = [0, 0, 0];
  for (const p of pts) for (let i = 0; i < 3; i++) mean[i] += p[i] / pts.length;
  const c = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of pts) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) c[i][j] += ((p[i] - mean[i]) * (p[j] - mean[j])) / pts.length;
  return { mean, ...eigen3(c), pts };
}

/**
 * The frame designers would build a segment in: local y is the principal
 * axis closest to the world's up (so studs face as near up as the segment
 * allows), local z the longest of the others, x completes a right-handed set.
 */
function frameOf(axes: V3[]): { frame: Mat4; tilt: number } {
  const up: V3 = [0, 1, 0];
  const yi = [0, 1, 2].sort((i, j) => Math.abs(dot(axes[j], up)) - Math.abs(dot(axes[i], up)))[0];
  let y = axes[yi];
  if (dot(y, up) < 0) y = [-y[0], -y[1], -y[2]];
  const rest = [0, 1, 2].filter((i) => i !== yi); // largest eigenvalue first
  let z = axes[rest[0]];
  const x = norm(cross(y, z));
  z = norm(cross(x, y));
  // Off the world grid by the largest angle between a local axis and its nearest world axis.
  const worst = Math.max(...[x, y, z].map((a) => Math.acos(Math.min(1, Math.max(...a.map(Math.abs))))));
  return { frame: [x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, 0, 0, 0, 1], tilt: (worst * 180) / Math.PI };
}

/** Cells reachable from each other (6-neighbours): the pieces a set falls into. */
function pieces(cells: number[]): number[][] {
  const left = new Set(cells);
  const out: number[][] = [];
  for (const s of cells) {
    if (!left.has(s)) continue;
    left.delete(s);
    const part = [s];
    for (let i = 0; i < part.length; i++) {
      const [x, y, z] = unkey(part[i]);
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const k = vkey(x + dx, y + dy, z + dz);
        if (left.has(k)) {
          left.delete(k);
          part.push(k);
        }
      }
    }
    out.push(part);
  }
  return out;
}

export interface SegmentOptions {
  /** Smallest segment, in cells. */
  minCells?: number;
  /** Frames within this many degrees of the world grid keep the world grid. */
  snapDeg?: number;
  /** A waist: cross-section below this share of the smaller side's peak. */
  waist?: number;
  /** A bend: centre line off its chord by more than this share of the mean width. */
  bend?: number;
  /** Its own frame only when its box along its axes is below this share of the world-aligned box. */
  box?: number;
}

/** Cut a shape into straight segments, each with its frame. */
export function segment(v: Voxels, opts: SegmentOptions = {}): Segment[] {
  const MIN = opts.minCells ?? 160, SNAP = opts.snapDeg ?? 12, WAIST = opts.waist ?? 0.55, BEND = opts.bend ?? 0.6, BOX = opts.box ?? 0.75;
  const done: number[][] = [];
  const queue = pieces([...v.cells.keys()]);
  while (queue.length) {
    const cells = queue.pop()!;
    if (cells.length < MIN * 2) {
      done.push(cells);
      continue;
    }
    const { mean, vectors, pts } = pca(cells);
    const axis = vectors[0];
    const t = pts.map((p) => dot([p[0] - mean[0], p[1] - mean[1], p[2] - mean[2]], axis));
    const t0 = Math.min(...t), t1 = Math.max(...t);
    const STEP = CELL * 2;
    const n = Math.max(1, Math.ceil((t1 - t0) / STEP));
    const area = new Array(n).fill(0);
    const cen = Array.from({ length: n }, () => [0, 0, 0]);
    t.forEach((ti, i) => {
      const b = Math.min(n - 1, Math.floor((ti - t0) / STEP));
      area[b]++;
      for (let k = 0; k < 3; k++) cen[b][k] += pts[i][k];
    });
    for (let b = 0; b < n; b++) if (area[b]) for (let k = 0; k < 3; k++) cen[b][k] /= area[b];
    // Smoothed area, then the best waist in the middle 70 %.
    const sm = area.map((_, b) => (area[Math.max(0, b - 1)] + area[b] + area[Math.min(n - 1, b + 1)]) / 3);
    let cut = -1, score = 0;
    for (let b = Math.floor(n * 0.15); b < Math.ceil(n * 0.85); b++) {
      const left = Math.max(...sm.slice(0, b + 1)), right = Math.max(...sm.slice(b));
      const r = sm[b] / Math.min(left, right);
      if (r < WAIST && 1 - r > score) {
        score = 1 - r;
        cut = b;
      }
    }
    // Or the bend: the slice centre farthest from the chord between the ends.
    if (cut < 0 && n >= 6) {
      const a = cen[0] as V3, z = cen[n - 1] as V3;
      const chord = norm([z[0] - a[0], z[1] - a[1], z[2] - a[2]]);
      const width = Math.sqrt(cells.length / Math.max(1, n)) * CELL;
      let far = 0;
      for (let b = 1; b < n - 1; b++) {
        if (!area[b]) continue;
        const d: V3 = [cen[b][0] - a[0], cen[b][1] - a[1], cen[b][2] - a[2]];
        const along = dot(d, chord);
        const off = Math.hypot(d[0] - chord[0] * along, d[1] - chord[1] * along, d[2] - chord[2] * along);
        if (off > far) {
          far = off;
          cut = b;
        }
      }
      if (far < BEND * width) cut = -1;
    }
    if (cut < 0) {
      done.push(cells);
      continue;
    }
    const tc = t0 + (cut + 0.5) * STEP;
    const lo = cells.filter((_, i) => t[i] < tc), hi = cells.filter((_, i) => t[i] >= tc);
    if (lo.length < MIN || hi.length < MIN) {
      done.push(cells);
      continue;
    }
    queue.push(...pieces(lo), ...pieces(hi));
  }
  // Tiny bits join the segment they touch most.
  const segs = done.filter((c) => c.length >= MIN);
  const owner = new Map<number, number>();
  segs.forEach((c, i) => c.forEach((k) => owner.set(k, i)));
  for (const c of done.filter((c) => c.length < MIN)) {
    const votes = new Map<number, number>();
    for (const k of c) {
      const [x, y, z] = unkey(k);
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const o = owner.get(vkey(x + dx, y + dy, z + dz));
        if (o !== undefined) votes.set(o, (votes.get(o) ?? 0) + 1);
      }
    }
    const to = [...votes].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (to === undefined) segs.push(c);
    else segs[to].push(...c);
  }
  return segs.map((cells) => {
    const { mean, vectors, pts } = pca(cells);
    const { frame, tilt } = frameOf(vectors);
    // Its own frame only if the shape really is turned: the box along its axes
    // is clearly smaller than the box along the world's (the minimum-volume
    // box). A boxy house has no real axes (its eigenvalues are near equal), so
    // it keeps the world grid however PCA happens to turn.
    const box = (axes: V3[]) =>
      axes.reduce((v, a) => {
        const t = pts.map((p) => dot(p, a));
        return v * (Math.max(...t) - Math.min(...t) + CELL);
      }, 1);
    const axes: V3[] = [[frame[0], frame[1], frame[2]], [frame[4], frame[5], frame[6]], [frame[8], frame[9], frame[10]]];
    const turned = tilt >= SNAP && box(axes) < BOX * box([[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
    return { cells, frame: turned ? frame : null, centre: mean, tilt: turned ? tilt : 0 };
  });
}
