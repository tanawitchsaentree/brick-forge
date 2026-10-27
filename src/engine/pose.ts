import { PARTS, footprint, partOrigin, type PartDef } from "./parts";
import type { PlacedBrick } from "./grid";
import { PLATE_H } from "./units";

// Rigid transforms for parts that don't sit on the baseplate's grid: a tail
// tilted down on a ball joint, a cheek panel clipped on sideways. A posed
// part is still placed on a grid (x, y, z, rot), but that grid is its
// segment's own; `pose` carries it into the world. Matrices are 4×4,
// column-major (the layout three.js uses), in world units: 1 = one stud,
// y up (a plate is PLATE_H).

export type Mat4 = number[];

export const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function mul(a: Mat4, b: Mat4): Mat4 {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  return o;
}

export const chain = (...ms: Mat4[]) => ms.reduce(mul, IDENTITY);

export const translate = (x: number, y: number, z: number): Mat4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
export const scale = (x: number, y: number, z: number): Mat4 => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];

/** Rotation about x (roll for a body facing +x). */
export function rotX(a: number): Mat4 {
  const c = Math.cos(a), s = Math.sin(a);
  return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
}
/** Rotation about y (turning, seen from above: positive is counter-clockwise). */
export function rotY(a: number): Mat4 {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}
/** Rotation about z (pitch for a body facing +x: positive lifts the nose). */
export function rotZ(a: number): Mat4 {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

export function apply(m: Mat4, p: [number, number, number]): [number, number, number] {
  const [x, y, z] = p;
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

/** Inverse of a rigid transform (rotation + translation). */
export function invertRigid(m: Mat4): Mat4 {
  const t = [m[12], m[13], m[14]];
  const o: Mat4 = [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, 0, 0, 0, 1];
  o[12] = -(o[0] * t[0] + o[4] * t[1] + o[8] * t[2]);
  o[13] = -(o[1] * t[0] + o[5] * t[1] + o[9] * t[2]);
  o[14] = -(o[2] * t[0] + o[6] * t[1] + o[10] * t[2]);
  return o;
}

/**
 * Where a part's local frame (x ∈ [0, w], y ∈ [0, h·PLATE_H], z ∈ [0, d],
 * the frame its LDraw geometry is loaded into) sits in the world: its grid
 * placement, then its segment's pose.
 */
export function partMatrix(b: PlacedBrick): Mat4 {
  if (b.place) return b.place;
  const part = PARTS[b.partId];
  const { w, d } = footprint(part, b.rot);
  const grid = chain(translate(b.x + w / 2, b.y * PLATE_H, b.z + d / 2), rotY((-b.rot * Math.PI) / 2), translate(-part.w / 2, 0, -part.d / 2));
  return b.pose ? mul(b.pose, grid) : grid;
}

/**
 * Pose that puts a part's LDraw origin at `at` (in some frame `frame`),
 * turned by `rot` (in that frame) — for parts placed by their geometry
 * (a ball's centre, a plate's top face) rather than by their bounding box.
 * Use with x = y = z = 0, rot = 0.
 */
export function poseAtOrigin(part: PartDef, frame: Mat4, at: [number, number, number], rot: Mat4 = IDENTITY): Mat4 {
  const [ox, oy, oz] = partOrigin(part);
  return chain(frame, translate(...at), rot, translate(-ox, -oy, -oz));
}

/** A point given in a part's LDraw coordinates (LDU, y down), in world units. */
export function ldrawPoint(b: PlacedBrick, p: [number, number, number]): [number, number, number] {
  const [ox, oy, oz] = partOrigin(PARTS[b.partId]);
  return apply(partMatrix(b), [ox + p[0] / 20, oy - p[1] / 20, oz - p[2] / 20]);
}

/** World-space centre of a part's bounding box. */
export function worldCenter(b: PlacedBrick): [number, number, number] {
  const part = PARTS[b.partId];
  return apply(partMatrix(b), [part.w / 2, (part.h * PLATE_H) / 2, part.d / 2]);
}

/** World-space axis-aligned bounds of a part (studs; y in world units). */
export function worldBox(b: PlacedBrick) {
  const part = PARTS[b.partId];
  const m = partMatrix(b);
  const H = part.h * PLATE_H;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const x of [0, part.w]) for (const y of [0, H]) for (const z of [0, part.d]) {
    const p = apply(m, [x, y, z]);
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], p[i]);
      hi[i] = Math.max(hi[i], p[i]);
    }
  }
  return { lo, hi };
}
