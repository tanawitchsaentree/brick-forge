import { PARTS, type PartDef } from "./parts";
import type { PlacedBrick } from "./grid";
import { apply, invertRigid, partMatrix, type Mat4 } from "./pose";
import { PLATE_H } from "./units";

// Which parts hold which, for any placement (on the grid, posed, or exact):
// a stud is plugged into the part whose body it sits inside. Two parts never
// share solid space in a real model, so a stud inside another part's box is
// in that part's underside (or a SNOT brick's side, a hinge's clip). Works for
// studs pointing any way, which is what grid-cell matching can't see.

const DIRS: [number, number, number][] = [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
const INTO = 0.1; // studs: half a stud's height, the probe point inside the receiving part
const SLACK = 0.03;

export interface Link {
  a: number; // index of the part with the stud (or the one fitted inside)
  b: number; // index of the part it's plugged into
  /** Studs plugged in; 0 for a fit (pin in a hole, tyre on a rim, bar in a clip). */
  studs: number;
  dir: number; // the stud's direction (world, 0..5), or -1 when tilted / a fit
}

// Interior sample points of a part's box (fractions of each side): a part
// whose inside reaches into another's box is fitted into it, since solid
// parts can't overlap. Stacked parts only touch, so they never trigger this.
const FIT = [0.25, 0.5, 0.75];
/** Parts that join by touching (knuckles, clips, bars): linked when their boxes meet. */
const JOINT = /Hinge|Clip|Bar\b|Handle|Turntable|Click|Pin|Axle|Ball|Socket|Tow Ball|Coupling/i;
const TOUCH = 0.06;

/** Part-local box (studs): the real geometry where the footprint was rounded. */
export function localBox(part: PartDef): [number, number, number] {
  return part.geo ?? [part.w, part.h * PLATE_H, part.d];
}

/** Studs of a part: from the catalog, or its stud cells (built-in parts). */
export function studsOf(part: PartDef): [number, number, number, number][] {
  if (part.connectors) return part.connectors;
  return part.studs.map(([i, k]) => [i + 0.5, part.h * PLATE_H, k + 0.5, 0]);
}

const dirOf = (v: number[]) => DIRS.findIndex((d) => d[0] * v[0] + d[1] * v[1] + d[2] * v[2] > 0.99);

export function connections(bricks: PlacedBrick[]): Link[] {
  const mats = bricks.map((b) => partMatrix(b));
  const inv = mats.map((m) => invertRigid(m));
  const boxes = bricks.map((b) => localBox(PARTS[b.partId]));
  // Spatial hash of world AABBs (2-stud cells) to find candidates fast.
  const CELL = 2;
  const hash = new Map<string, number[]>();
  const aabb = bricks.map((_, i) => {
    const [x, y, z] = boxes[i];
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const cx of [0, x]) for (const cy of [0, y]) for (const cz of [0, z]) {
      const p = apply(mats[i], [cx, cy, cz]);
      for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
    }
    for (let gx = Math.floor(lo[0] / CELL); gx <= Math.floor(hi[0] / CELL); gx++)
      for (let gy = Math.floor(lo[1] / CELL); gy <= Math.floor(hi[1] / CELL); gy++)
        for (let gz = Math.floor(lo[2] / CELL); gz <= Math.floor(hi[2] / CELL); gz++) {
          const k = `${gx},${gy},${gz}`;
          (hash.get(k) ?? hash.set(k, []).get(k)!).push(i);
        }
    return { lo, hi };
  });
  const links = new Map<string, Link>();
  bricks.forEach((b, i) => {
    const m: Mat4 = mats[i];
    for (const [x, y, z, d] of studsOf(PARTS[b.partId])) {
      const u = DIRS[d];
      const probe = apply(m, [x + u[0] * INTO, y + u[1] * INTO, z + u[2] * INTO]);
      const k = `${Math.floor(probe[0] / CELL)},${Math.floor(probe[1] / CELL)},${Math.floor(probe[2] / CELL)}`;
      for (const j of hash.get(k) ?? []) {
        if (j === i) continue;
        const { lo, hi } = aabb[j];
        if (probe.some((v, a) => v < lo[a] - SLACK || v > hi[a] + SLACK)) continue;
        const q = apply(inv[j], probe);
        const box = boxes[j];
        if (q.some((v, a) => v < -SLACK || v > box[a] + SLACK)) continue;
        const key = `${i}>${j}`;
        const l = links.get(key);
        if (l) l.studs++;
        else {
          const w = apply(m, [x + u[0], y + u[1], z + u[2]]), o = apply(m, [x, y, z]);
          links.set(key, { a: i, b: j, studs: 1, dir: dirOf([w[0] - o[0], w[1] - o[1], w[2] - o[2]]) });
        }
        break; // a stud goes into one part
      }
    }
  });
  // Fits: pairs whose boxes interpenetrate.
  bricks.forEach((_, i) => {
    const near = new Set<number>();
    const { lo, hi } = aabb[i];
    for (let gx = Math.floor(lo[0] / CELL); gx <= Math.floor(hi[0] / CELL); gx++)
      for (let gy = Math.floor(lo[1] / CELL); gy <= Math.floor(hi[1] / CELL); gy++)
        for (let gz = Math.floor(lo[2] / CELL); gz <= Math.floor(hi[2] / CELL); gz++) for (const j of hash.get(`${gx},${gy},${gz}`) ?? []) if (j > i) near.add(j);
    for (const j of near) {
      if (links.has(`${i}>${j}`) || links.has(`${j}>${i}`)) continue;
      if (aabb[j].lo.some((v, a) => v > hi[a] + TOUCH) || aabb[j].hi.some((v, a) => v < lo[a] - TOUCH)) continue;
      // Boxes meet: some corner or face centre of one within TOUCH of the other's box.
      const touching = (p: number, q: number) => {
        const box = boxes[p], qb = boxes[q];
        for (const fx of [0, 0.5, 1]) for (const fy of [0, 0.5, 1]) for (const fz of [0, 0.5, 1]) {
          const v = apply(inv[q], apply(mats[p], [box[0] * fx, box[1] * fy, box[2] * fz]));
          if (v.every((c, a) => c > -TOUCH && c < qb[a] + TOUCH)) return true;
        }
        return false;
      };
      const fits = (p: number, q: number) => {
        const box = boxes[p], qb = boxes[q];
        for (const fx of FIT) for (const fy of FIT) for (const fz of FIT) {
          const v = apply(inv[q], apply(mats[p], [box[0] * fx, box[1] * fy, box[2] * fz]));
          if (v.every((c, a) => c > SLACK && c < qb[a] - SLACK)) return true;
        }
        return false;
      };
      if (fits(i, j) || fits(j, i)) links.set(`${i}>${j}`, { a: i, b: j, studs: 0, dir: -1 });
      else if ((JOINT.test(PARTS[bricks[i].partId].name) || JOINT.test(PARTS[bricks[j].partId].name)) && touching(i, j)) links.set(`${i}>${j}`, { a: i, b: j, studs: 0, dir: -1 });
    }
  });
  return [...links.values()];
}

/** Connected groups (by stud links); the biggest first. */
export function components(n: number, links: Link[]): number[][] {
  const parent = [...Array(n).keys()];
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  for (const l of links) parent[find(l.a)] = find(l.b);
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) (groups.get(find(i)) ?? groups.set(find(i), []).get(find(i))!).push(i);
  return [...groups.values()].sort((a, b) => b.length - a.length);
}
