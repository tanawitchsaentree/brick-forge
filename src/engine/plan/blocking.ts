import { apX, type Library, type Mesh, type Vec3 } from "./library";
import type { Node } from "./ldraw";
import type { Edge } from "./graph";

// Layer C, geometry: which parts block which, along which directions (a directional
// blocking graph, Wilson & Latombe 1994, restricted to the directions the connectors
// allow — a LEGO part comes off along its studs' or pins' axis, so a handful of
// directions per part instead of the sphere of them).
//
// Part i, moved along d to infinity, is blocked by j when i's box swept along d
// meets j's box. Boxes are shrunk a little (parts touch face to face), and pairs whose
// boxes already overlap where they stand are not counted: a pin in a beam, a figure
// in a hollow cabin — the box is too coarse to say, and a false block would deadlock
// the plan. Blocking only ever shrinks as parts come off, so it is worked out once on
// the whole model (per part and direction) and reused by the planner.

interface OBB { c: Vec3; u: Vec3[]; e: Vec3 } // centre, unit axes, half extents

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** Separating-axis test for two oriented boxes. */
function overlaps(A: OBB, B: OBB): boolean {
  const t = sub(B.c, A.c);
  const axes: Vec3[] = [...A.u, ...B.u];
  for (const a of A.u) for (const b of B.u) {
    const c = cross(a, b);
    if (Math.hypot(...c) > 1e-6) axes.push(c);
  }
  for (const L of axes) {
    const ra = A.e[0] * Math.abs(dot(A.u[0], L)) + A.e[1] * Math.abs(dot(A.u[1], L)) + A.e[2] * Math.abs(dot(A.u[2], L));
    const rb = B.e[0] * Math.abs(dot(B.u[0], L)) + B.e[1] * Math.abs(dot(B.u[1], L)) + B.e[2] * Math.abs(dot(B.u[2], L));
    if (Math.abs(dot(t, L)) > ra + rb) return false;
  }
  return true;
}

// Narrow phase: rays from one part's vertices along the motion, against the other's
// triangles (and back), each part's triangles in a bounding-volume tree. Vertex–face
// contact only (edge–edge is missed); hits closer than NEAR are touching, not blocking.
const NEAR = 2;
interface BVH { lo: Float32Array; hi: Float32Array; left: Int32Array; right: Int32Array; start: Int32Array; count: Int32Array; order: Int32Array; tris: Float32Array }
function buildBVH(tris: Float32Array): BVH {
  const nt = tris.length / 9;
  const order = Int32Array.from({ length: nt }, (_, k) => k);
  const cen = new Float32Array(nt * 3);
  for (let k = 0; k < nt; k++) for (let a = 0; a < 3; a++) cen[k * 3 + a] = (tris[k * 9 + a] + tris[k * 9 + 3 + a] + tris[k * 9 + 6 + a]) / 3;
  const lo: number[] = [], hi: number[] = [], left: number[] = [], right: number[] = [], start: number[] = [], count: number[] = [];
  const build = (s0: number, s1: number): number => {
    const id = left.length;
    left.push(-1), right.push(-1), start.push(s0), count.push(s1 - s0);
    const l = [Infinity, Infinity, Infinity], h = [-Infinity, -Infinity, -Infinity];
    for (let q = s0; q < s1; q++) {
      const t = order[q];
      for (let v = 0; v < 3; v++) for (let a = 0; a < 3; a++) {
        const x = tris[t * 9 + v * 3 + a];
        if (x < l[a]) l[a] = x;
        if (x > h[a]) h[a] = x;
      }
    }
    lo.push(...l), hi.push(...h);
    if (s1 - s0 > 8) {
      const ax = [0, 1, 2].reduce((b, a) => (h[a] - l[a] > h[b] - l[b] ? a : b), 0);
      const sub = Array.from(order.subarray(s0, s1)).sort((p, q) => cen[p * 3 + ax] - cen[q * 3 + ax]);
      order.set(sub, s0);
      const m = (s0 + s1) >> 1;
      const L = build(s0, m), R = build(m, s1);
      left[id] = L, right[id] = R, count[id] = 0;
    }
    return id;
  };
  if (nt) build(0, nt);
  return { lo: new Float32Array(lo), hi: new Float32Array(hi), left: Int32Array.from(left), right: Int32Array.from(right), start: Int32Array.from(start), count: Int32Array.from(count), order, tris };
}
/** Does the ray o + t·d (t > NEAR) hit a triangle of the tree? */
function rayHits(b: BVH, o: number[], d: number[], tMax = Infinity): boolean {
  if (!b.left.length) return false;
  const inv = d.map((v) => (Math.abs(v) < 1e-12 ? 1e12 : 1 / v));
  const stack = [0];
  while (stack.length) {
    const n = stack.pop()!;
    let t0 = -Infinity, t1 = Infinity;
    for (let a = 0; a < 3; a++) {
      let ta = (b.lo[n * 3 + a] - o[a]) * inv[a], tb = (b.hi[n * 3 + a] - o[a]) * inv[a];
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta), t1 = Math.min(t1, tb);
    }
    if (t1 < Math.max(t0, NEAR) || t0 > tMax) continue;
    if (b.left[n] >= 0) {
      stack.push(b.left[n], b.right[n]);
      continue;
    }
    for (let q = b.start[n]; q < b.start[n] + b.count[n]; q++) {
      const t = b.order[q] * 9, T = b.tris;
      // Möller–Trumbore
      const e1 = [T[t + 3] - T[t], T[t + 4] - T[t + 1], T[t + 5] - T[t + 2]], e2 = [T[t + 6] - T[t], T[t + 7] - T[t + 1], T[t + 8] - T[t + 2]];
      const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
      const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
      const nrm = Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]);
      if (Math.abs(det) < 1e-3 * nrm) continue; // grazing: the ray runs along the face
      const s = [o[0] - T[t], o[1] - T[t + 1], o[2] - T[t + 2]];
      const u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) / det;
      if (u < 0 || u > 1) continue;
      const qv = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
      const v = (d[0] * qv[0] + d[1] * qv[1] + d[2] * qv[2]) / det;
      if (v < 0 || u + v > 1) continue;
      const tt = (e2[0] * qv[0] + e2[1] * qv[1] + e2[2] * qv[2]) / det;
      if (tt > NEAR && tt < tMax) return true;
    }
  }
  return false;
}

export interface Blocking {
  /** Directions part i might come off along: its connectors' axes, then the six world axes (unit vectors). */
  dirs: Vec3[][];
  /** Ways part i can come off along direction k of dirs[i]: each the parts that must be gone first. */
  ways(i: number, k: number): number[][];
  /** Parts in the way along direction k whichever way out it takes. */
  blockers(i: number, k: number): number[];
  /** Ways out for a whole group moved along d (sub-assemblies). */
  groupWays(group: number[], d: Vec3): number[][];
  /** Does edge e let `moving` (one of its ends) leave the other end along d? */
  permits(e: Edge, moving: number, d: Vec3): boolean;
}

export function blocking(lib: Library, nodes: Node[], edges: Edge[], shrink = 2.5): Blocking {
  const obbs: OBB[] = nodes.map((n) => {
    const [lo, hi] = lib.part(n.id)!.box;
    const R = n.xf.R;
    const u: Vec3[] = [0, 1, 2].map((k) => {
      const v: Vec3 = [R[k], R[3 + k], R[6 + k]];
      const m = Math.hypot(...v) || 1;
      return [v[0] / m, v[1] / m, v[2] / m] as Vec3;
    });
    const scale = [0, 1, 2].map((k) => Math.hypot(R[k], R[3 + k], R[6 + k]) || 1);
    const e = [0, 1, 2].map((k) => Math.max(0.5, ((hi[k] - lo[k]) / 2) * scale[k] - shrink)) as Vec3;
    const c = apX(n.xf, [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2]);
    return { c, u, e };
  });
  const aabb = obbs.map((o) => {
    const r = [0, 1, 2].map((k) => o.e[0] * Math.abs(o.u[0][k]) + o.e[1] * Math.abs(o.u[1][k]) + o.e[2] * Math.abs(o.u[2][k]));
    return { lo: o.c.map((v, k) => v - r[k]) as Vec3, hi: o.c.map((v, k) => v + r[k]) as Vec3 };
  });
  const world = { lo: [0, 1, 2].map((k) => Math.min(...aabb.map((b) => b.lo[k]))), hi: [0, 1, 2].map((k) => Math.max(...aabb.map((b) => b.hi[k]))) };
  // Narrow phase per pair, in the static part's frame.
  const bvhs = new Map<string, BVH | null>();
  const bvhOf = (id: string) => {
    if (!bvhs.has(id)) {
      const m: Mesh | null = lib.mesh(id);
      bvhs.set(id, m ? buildBVH(m.tris) : null);
    }
    return bvhs.get(id)!;
  };
  const inv = nodes.map((n) => {
    // Inverse of R (rotation, maybe mirrored/scaled): general 3×3 inverse.
    const [a, b, c, d, e, f, g, h, k] = n.xf.R;
    const det = a * (e * k - f * h) - b * (d * k - f * g) + c * (d * h - e * g);
    return [(e * k - f * h) / det, (c * h - b * k) / det, (b * f - c * e) / det, (f * g - d * k) / det, (a * k - c * g) / det, (c * d - a * f) / det, (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det];
  });
  const toLocal = (j: number, p: number[]) => {
    const t = nodes[j].xf.t, R = inv[j];
    const x = p[0] - t[0], y = p[1] - t[1], z = p[2] - t[2];
    return [R[0] * x + R[1] * y + R[2] * z, R[3] * x + R[4] * y + R[5] * z, R[6] * x + R[7] * y + R[8] * z];
  };
  const dirLocal = (j: number, d: number[]) => {
    const R = inv[j];
    return [R[0] * d[0] + R[1] * d[1] + R[2] * d[2], R[3] * d[0] + R[4] * d[1] + R[5] * d[2], R[6] * d[0] + R[7] * d[1] + R[8] * d[2]];
  };
  /** Does part i, first shifted by `off`, then moved along d (up to tMax), run into part j? */
  const meshBlocks = (i: number, j: number, d: Vec3, off: Vec3 = [0, 0, 0], tMax = Infinity) => {
    const mi = lib.mesh(nodes[i].id), mj = lib.mesh(nodes[j].id);
    const bi = bvhOf(nodes[i].id), bj = bvhOf(nodes[j].id);
    if (!mi || !mj || !bi || !bj) return true;
    const dj = dirLocal(j, d);
    for (let q = 0; q < mi.verts.length; q += 3) {
      const w = apX(nodes[i].xf, [mi.verts[q], mi.verts[q + 1], mi.verts[q + 2]]);
      if (rayHits(bj, toLocal(j, [w[0] + off[0], w[1] + off[1], w[2] + off[2]]), dj, tMax)) return true;
    }
    const di = dirLocal(i, [-d[0], -d[1], -d[2]]);
    for (let q = 0; q < mj.verts.length; q += 3) {
      const w = apX(nodes[j].xf, [mj.verts[q], mj.verts[q + 1], mj.verts[q + 2]]);
      if (rayHits(bi, toLocal(i, [w[0] - off[0], w[1] - off[1], w[2] - off[2]]), di, tMax)) return true;
    }
    return false;
  };
  const CELL = 40;
  const hash = new Map<string, number[]>();
  const cellsOf = (lo: number[], hi: number[], f: (k: string) => void) => {
    for (let x = Math.floor(lo[0] / CELL); x <= Math.floor(hi[0] / CELL); x++)
      for (let y = Math.floor(lo[1] / CELL); y <= Math.floor(hi[1] / CELL); y++)
        for (let z = Math.floor(lo[2] / CELL); z <= Math.floor(hi[2] / CELL); z++) f(`${x},${y},${z}`);
  };
  aabb.forEach((b, i) => cellsOf(b.lo, b.hi, (k) => (hash.get(k) ?? hash.set(k, []).get(k)!).push(i)));
  const startOverlap = new Map<number, Set<number>>();
  const overlapAtStart = (i: number) => {
    let s = startOverlap.get(i);
    if (s) return s;
    s = new Set();
    const seen = new Set<number>();
    cellsOf(aabb[i].lo, aabb[i].hi, (k) => {
      for (const j of hash.get(k) ?? []) if (j !== i && !seen.has(j) && (seen.add(j), true) && overlaps(obbs[i], obbs[j])) s!.add(j);
    });
    startOverlap.set(i, s);
    return s;
  };

  const byPart = nodes.map(() => [] as Edge[]);
  for (const e of edges) {
    byPart[e.a].push(e);
    byPart[e.b].push(e);
  }
  const permits = (e: Edge, moving: number, d: Vec3) => {
    if (e.sense === "any") return true;
    const s = moving === e.b ? 1 : -1; // b leaves a along +axis; a leaves b along −axis
    const c = dot(e.axis, d) * s;
    return e.sense === 1 ? c > 0.99 : Math.abs(c) > 0.99;
  };
  const AXES: Vec3[] = [[0, -1, 0], [0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
  const dirs = nodes.map((n) => {
    const cand: Vec3[] = [];
    const push = (v: Vec3) => {
      if (!cand.some((c) => dot(c, v) > 0.999)) cand.push(v);
    };
    for (const e of byPart[n.i]) {
      if (e.sense === "any") continue;
      const s = n.i === e.b ? 1 : -1;
      push([e.axis[0] * s, e.axis[1] * s, e.axis[2] * s]);
      if (e.sense === 0) push([-e.axis[0] * s, -e.axis[1] * s, -e.axis[2] * s]);
    }
    AXES.forEach(push); // and the six axes, for when only free joints are left
    return cand; // which of them are open depends on the joints still there (the planner's check)
  });

  /**
   * The first leg of the way out along d: far enough to clear every joint. Studs let go after
   * their height; a pin, axle or bar only once the part has slid its own length along the
   * axis (a pin in two beams must leave both).
   */
  const depthAlong = (group: number[], d: Vec3) => {
    const inG = new Set(group);
    let L = 0;
    for (const i of group)
      for (const e of byPart[i]) {
        if (e.sense === "any" || inG.has(e.a === i ? e.b : e.a) || Math.abs(dot(e.axis, d)) < 0.99) continue;
        if (e.type === "stud") L = Math.max(L, e.depth ?? 4);
        else {
          const o = obbs[i];
          const along = 2 * (o.e[0] * Math.abs(dot(o.u[0], d)) + o.e[1] * Math.abs(dot(o.u[1], d)) + o.e[2] * Math.abs(dot(o.u[2], d))) + 2 * 2.5;
          L = Math.max(L, along, e.depth ?? 20);
        }
      }
    return L;
  };

  /**
   * Parts met by `group` moving along d for `len` (Infinity: out of the model) after a shift
   * `off`. Joint partners that let it go along d don't count on the first leg (they are the
   * joint); on the second leg, clear of its joints, everything counts.
   */
  const sweepSet = (group: number[], d: Vec3, len: number, off: Vec3, firstLeg: boolean) => {
    const inGroup = new Set(group);
    const out = new Set<number>();
    for (const i of group) {
      const o0 = obbs[i];
      const o: OBB = { c: [o0.c[0] + off[0], o0.c[1] + off[1], o0.c[2] + off[2]], u: o0.u, e: o0.e };
      const blo = aabb[i].lo.map((v, q) => v + off[q]), bhi = aabb[i].hi.map((v, q) => v + off[q]);
      const reach = [0, 1, 2].reduce((m, k) => (d[k] > 1e-6 ? Math.min(m, (world.hi[k] - blo[k]) / d[k]) : d[k] < -1e-6 ? Math.min(m, (world.lo[k] - bhi[k]) / d[k]) : m), Infinity);
      const L = Math.min(len, Number.isFinite(reach) ? Math.max(0, reach) + 1 : 1);
      // The swept box: stretched along its own axis when d is one; else its swept AABB (conservative).
      const k = o.u.findIndex((u) => Math.abs(dot(u, d)) > 0.99);
      let swept: OBB;
      if (k >= 0) {
        const e = [...o.e] as Vec3;
        e[k] += L / 2;
        swept = { c: [o.c[0] + (d[0] * L) / 2, o.c[1] + (d[1] * L) / 2, o.c[2] + (d[2] * L) / 2], u: o.u, e };
      } else {
        const lo = blo.map((v, q) => Math.min(v, v + d[q] * L)), hi = bhi.map((v, q) => Math.max(v, v + d[q] * L));
        swept = { c: lo.map((v, q) => (v + hi[q]) / 2) as Vec3, u: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], e: lo.map((v, q) => (hi[q] - v) / 2) as Vec3 };
      }
      const lo = [0, 1, 2].map((q) => Math.min(blo[q], blo[q] + d[q] * L)), hi = [0, 1, 2].map((q) => Math.max(bhi[q], bhi[q] + d[q] * L));
      const start = firstLeg ? overlapAtStart(i) : new Set<number>();
      const joined = new Set<number>();
      if (firstLeg) for (const e of byPart[i]) if (permits(e, i, d)) joined.add(e.a === i ? e.b : e.a);
      const seen = new Set<number>();
      cellsOf(lo, hi, (key) => {
        for (const j of hash.get(key) ?? []) {
          if (inGroup.has(j) || seen.has(j)) continue;
          seen.add(j);
          if (joined.has(j) || out.has(j)) continue;
          // Broad phase by boxes; then the meshes decide (boxes overlapping where they stand
          // — a figure in a hollow cabin — are left to the meshes too).
          if ((start.has(j) || overlaps(swept, obbs[j])) && meshBlocks(i, j, d, off, L)) out.add(j);
        }
      });
    }
    return out;
  };
  /**
   * Ways out along d: slide out of the joints (their depth, plus a margin), then away along d
   * or any of the six axes (Assemble Them All's short translations, depth two). Each way is
   * the set of parts that would have to be gone first.
   */
  const waysOut = (group: number[], d: Vec3): number[][] => {
    const depth = depthAlong(group, d);
    if (!depth) return [[...sweepSet(group, d, Infinity, [0, 0, 0], true)].sort((a, b) => a - b)];
    const leg = depth + 1;
    const first = sweepSet(group, d, leg, [0, 0, 0], true);
    const off: Vec3 = [d[0] * leg, d[1] * leg, d[2] * leg];
    const ways: number[][] = [];
    for (const e of [d, ...AXES]) {
      if (dot(e, d) < -0.99) continue; // not straight back in
      if (e !== d && dot(e, d) > 0.999) continue;
      const second = sweepSet(group, e, Infinity, off, false);
      ways.push([...new Set([...first, ...second])].sort((a, b) => a - b));
    }
    // Keep the ways no other way is a subset of.
    return ways.filter((w, k) => !ways.some((v, q) => q !== k && v.length < w.length && v.every((x) => w.includes(x))));
  };

  const cache = new Map<string, number[][]>();
  return {
    dirs,
    permits,
    ways(i, k) {
      const key = `${i}:${k}`;
      let b = cache.get(key);
      if (!b) cache.set(key, (b = waysOut([i], dirs[i][k])));
      return b;
    },
    blockers(i, k) {
      // The union of every way's blockers' intersection: parts in the way whichever way it goes.
      const w = this.ways(i, k);
      return w.length ? w.reduce((a, b) => a.filter((x) => b.includes(x))) : [];
    },
    groupWays: (group, d) => waysOut(group, d),
  };
}

export function interlocks(nodes: Node[], blk: Blocking): Edge[] {
  const all = nodes.map((_, i) => {
    let common: Set<number> | null = null;
    blk.dirs[i].forEach((_, k) => {
      const b = new Set(blk.blockers(i, k));
      common = common ? new Set([...common].filter((j) => b.has(j))) : b;
    });
    return common ?? new Set<number>();
  });
  const out: Edge[] = [];
  all.forEach((s, i) => {
    for (const j of s) if (j > i && all[j].has(i)) out.push({ a: i, b: j, type: "fit", axis: [0, -1, 0], sense: "any", n: 1, at: [nodes[i].xf.t], dof: { rot: false, slide: false }, friction: true });
  });
  return out;
}
