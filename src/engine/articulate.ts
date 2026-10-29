import { PARTS } from "./parts";
import type { Why } from "./grid";
import { CELL, CELL_Y, unkey, vkey, type Voxels } from "./shape";
import { segment, type Segment, type SegmentOptions } from "./segment";
import { sculpt, type SculptOptions, type SculptResult } from "./sculpt";
import { mul, partMatrix, translate, type Mat4 } from "./pose";

// Articulated building: a shape with turned parts (a tail, a neck, a leg at an
// angle) is cut into straight segments (engine/segment.ts); the world-aligned
// ones are sculpted together on the world grid, and every turned segment on
// its own grid: its solid is resampled into its frame, sculpted straight
// there, and the parts turned back with the frame's rotation R:
//
//   local point  p = Rᵀ · world point          (R orthonormal: R⁻¹ = Rᵀ)
//   part in world  = R · (part in the segment's frame)
//
// Where a turned segment meets the one it hangs from, a joint goes in: a ball
// joint and its socket at the centre of the contact, along the segment's axis,
// the way designers hang a tail or a head.

type V3 = [number, number, number];
const apply3 = (m: Mat4, p: V3): V3 => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2], m[1] * p[0] + m[5] * p[1] + m[9] * p[2], m[2] * p[0] + m[6] * p[1] + m[10] * p[2]];
const transpose = (m: Mat4): Mat4 => [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, 0, 0, 0, 1];
const centre = (k: number): V3 => {
  const [x, y, z] = unkey(k);
  return [(x + 0.5) * CELL, (y + 0.5) * CELL_Y, (z + 0.5) * CELL];
};
const cellOf = (p: V3) => vkey(Math.floor(p[0] / CELL), Math.floor(p[1] / CELL_Y), Math.floor(p[2] / CELL));

/** Rotation about a unit axis (Rodrigues). */
function rotAbout(axis: V3, deg: number): Mat4 {
  const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t), [x, y, z] = axis, k = 1 - c;
  return [c + x * x * k, y * x * k + z * s, z * x * k - y * s, 0, x * y * k - z * s, c + y * y * k, z * y * k + x * s, 0, x * z * k + y * s, y * z * k - x * s, c + z * z * k, 0, 0, 0, 0, 1];
}

/**
 * How well a frame matches the grid the shape was built on: in the right
 * frame every stud × plate unit is crisp, all full or all empty; turned off
 * it, units come out half full. Crispness = mean |2f − 1| over the units the
 * shape touches (f = filled share of the unit) — minimising the grid's entropy.
 */
function crispness(seg: Segment, R: Mat4): number {
  const Rt = transpose(R);
  const units = new Map<number, number>();
  for (const k of seg.cells) {
    const p = apply3(Rt, centre(k));
    const u = vkey(Math.floor(p[0]), Math.floor(p[1] / 0.4), Math.floor(p[2]));
    units.set(u, (units.get(u) ?? 0) + 1);
  }
  const full = (1 / CELL) * (0.4 / CELL_Y) * (1 / CELL); // world cells per unit
  let s = 0;
  for (const n of units.values()) s += Math.abs(2 * Math.min(1, n / full) - 1);
  return s / units.size;
}

/** The frame near the PCA frame (±15°, in 5° steps about each axis) where the segment is crispest. */
function alignFrame(seg: Segment): Mat4 {
  let best = seg.frame!, bestC = crispness(seg, best);
  for (let pass = 0; pass < 2; pass++) {
    const start = best;
    for (const axis of [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as V3[])
      for (const deg of [-15, -10, -5, 5, 10, 15].map((d) => d / (pass + 1))) {
        const R = mul(rotAbout(apply3(start, axis), deg), start);
        const c = crispness(seg, R);
        if (c > bestC) {
          bestC = c;
          best = R;
        }
      }
  }
  return best;
}

/** A segment's solid (and its studs) in its own frame. */
function toLocal(seg: Segment, target: Voxels): Voxels {
  const R = seg.frame!, Rt = transpose(R);
  const own = new Set(seg.cells);
  const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const k of seg.cells) {
    const p = apply3(Rt, centre(k));
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], p[a]);
      hi[a] = Math.max(hi[a], p[a]);
    }
  }
  const cells = new Map<number, number>();
  const step: V3 = [CELL, CELL_Y, CELL];
  const i0 = lo.map((v, a) => Math.floor(v / step[a]) - 1), i1 = hi.map((v, a) => Math.ceil(v / step[a]) + 1);
  for (let j = i0[1]; j <= i1[1]; j++)
    for (let k = i0[2]; k <= i1[2]; k++)
      for (let i = i0[0]; i <= i1[0]; i++) {
        const w = cellOf(apply3(R, [(i + 0.5) * CELL, (j + 0.5) * CELL_Y, (k + 0.5) * CELL]));
        if (own.has(w)) cells.set(vkey(i, j, k), target.cells.get(w)!);
      }
  // Studs just outside the segment's surface, carried into its frame.
  const studs = new Set<number>();
  for (const s of target.studs ?? []) {
    const p = apply3(Rt, centre(s));
    if (p.every((v, a) => v >= lo[a] - 1 && v <= hi[a] + 1)) {
      const c = vkey(Math.floor(p[0] / CELL), Math.floor(p[1] / CELL_Y), Math.floor(p[2] / CELL));
      if (!cells.has(c)) studs.add(c);
    }
  }
  return { cells, studs };
}

/** Ball and socket parts for joints (the smallest of each the catalog has). */
let JOINT: { ball: string; socket: string } | null | undefined;
function jointParts() {
  if (JOINT !== undefined) return JOINT;
  const find = (re: RegExp) =>
    Object.values(PARTS)
      .filter((p) => re.test(p.name) && !p.printed)
      .sort((a, b) => a.w * a.d * a.h - b.w * b.d * b.h)[0]?.id;
  const ball = find(/^Plate 1 ?× ?2 with Ball Joint/), socket = find(/^Plate 1 ?× ?2 with Socket Joint/);
  return (JOINT = ball && socket ? { ball, socket } : null);
}

export interface ArticulatedResult extends SculptResult {
  segments: Segment[];
  joints: number;
}

export function sculptArticulated(target: Voxels, opts: SculptOptions & { segment?: SegmentOptions; JOINTS?: boolean }): ArticulatedResult {
  const t0 = performance.now();
  const segs = segment(target, opts.segment);
  const turned = segs.filter((s) => s.frame);
  if (!turned.length) return { ...sculpt(target, opts), segments: segs, joints: 0 };
  // The world-aligned segments, together, on the world grid (with any fixed parts).
  const worldCells = new Map<number, number>();
  for (const s of segs) if (!s.frame) for (const k of s.cells) worldCells.set(k, target.cells.get(k)!);
  const studs = target.studs;
  const base = worldCells.size ? sculpt({ cells: worldCells, studs }, opts) : { bricks: opts.fixed ?? [], residual: 0, ms: 0 };
  const bricks = [...base.bricks];
  let residual = base.residual;
  // Each turned segment on its own grid, then turned into place.
  for (const s of turned) {
    s.frame = alignFrame(s);
    const local = toLocal(s, target);
    if (!local.cells.size) continue;
    const r = sculpt(local, { ...opts, fixed: [] });
    residual += r.residual;
    for (const b of r.bricks) {
      const place = mul(s.frame!, partMatrix(b));
      const why = b.why ? { ...b.why, frame: Math.round(s.tilt) } : undefined;
      bricks.push({ ...b, uid: `${b.uid}@${Math.round(s.centre[0] * 10)}`, x: 0, y: 0, z: 0, rot: 0, pose: undefined, place, why });
    }
  }
  // Joints: where each turned segment touches the segment it hangs from.
  let joints = 0;
  const jp = jointParts();
  const owner = new Map<number, number>();
  segs.forEach((s, i) => s.cells.forEach((k) => owner.set(k, i)));
  if (jp && opts.JOINTS !== false)
    segs.forEach((s, i) => {
      if (!s.frame) return;
      const touch = new Map<number, V3[]>();
      for (const k of s.cells) {
        const [x, y, z] = unkey(k);
        for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
          const o = owner.get(vkey(x + dx, y + dy, z + dz));
          if (o !== undefined && o !== i) (touch.get(o) ?? touch.set(o, []).get(o)!).push(centre(k));
        }
      }
      const best = [...touch].sort((a, b) => b[1].length - a[1].length)[0];
      if (!best) return;
      const pts = best[1];
      const c: V3 = [0, 1, 2].map((a) => pts.reduce((v, p) => v + p[a], 0) / pts.length) as V3;
      const parent = segs[best[0]];
      const why: Why = {
        role: "structure", cover: 0, air: 0, finish: 0, engaged: 2, prior: 0, repeat: false, rank: 0, margin: Infinity,
        motif: `joint: ball and socket turn this segment ${Math.round(s.tilt)}° off ${parent.frame ? "the next segment" : "the body"}`,
      };
      // Centre each joint part on the contact, along the segment's frame.
      for (const id of [jp.ball, jp.socket]) {
        const p = PARTS[id];
        const half = mul(s.frame!, translate(-p.w / 2, -(p.h * 0.4) / 2, -p.d / 2));
        bricks.push({ uid: `j${joints}-${id}`, partId: id, x: 0, y: 0, z: 0, rot: 0, color: 72, place: mul(translate(c[0], c[1], c[2]), half), why });
      }
      joints++;
    });
  return { bricks, residual, ms: performance.now() - t0, segments: segs, joints };
}
