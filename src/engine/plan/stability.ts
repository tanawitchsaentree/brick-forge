import type { Library, Vec3 } from "./library";
import type { Node } from "./ldraw";
import type { Edge } from "./graph";

// Layer D: does a partial build stand? A static-equilibrium check in the spirit of
// StableLego (Liu et al., RA-L 2024) and BrickSim (Wen et al., 2026), made convex so
// it runs without a commercial solver:
//
//   unknowns x: contact forces at every joint (bounded where the joint is weak)
//   for every part:   Σ forces + weight = 0,   Σ moments = 0      (A x = b, 6 rows a part)
//   solve             min ‖A x − b‖² + λ‖x‖²   s.t.  l ≤ x ≤ u     (box-constrained least squares, FISTA)
//
// A part whose rows can't be balanced (residual left over) falls or swings; how close
// the forces run to their bounds is the margin. Joints:
//   stud      4 contact points at the stud's rim (StableLego's knob contacts), each an axial
//             force: compression free, tension ≥ −T (T = 0.98 N, StableLego's clutch), plus a
//             lateral force at the stud (interlock, free)
//   pin, axleFree, bar, hinge   lateral forces at two points along the axis (so it takes bending),
//             axial friction and turning friction bounded (0 for a smooth pin)
//   axle      as a pin, but it can't turn: axial torque free
//   ball      force free, torque bounded (a friction ball joint, ≈ 4 N·cm)
//   ground    the table pushes up on parts at the lowest level (compression only)
// Units: N and cm. Masses from the part's box: ≈ 0.47 mg per mm³ (a 2×4 brick, 2.32 g).
// Numbers marked "assumption" in docs/engine/assembly-planning.md are to be measured.

const LDU_CM = 0.04;
const G = 9.81;
const T_STUD = 0.98; // N per contact point (StableLego)
const RIM = 6 * LDU_CM;
const PIN_AXIAL = { friction: 2, smooth: 0.3 }; // N (assumption)
const PIN_TORQUE = { friction: 0.5, smooth: 0 }; // N·cm (assumption)
const BALL_TORQUE = 4; // N·cm (assumption, Joint-8 style)
const DENSITY = 0.47e-3 * 1000; // g per cm³ of box (≈ 0.47 mg/mm³)

export interface StabilityResult {
  stable: boolean;
  /** Per part: unbalanced force (N) and moment (N·cm) left, and how close its joints run to their limits (0..1+). */
  residual: number[];
  utilization: number[];
  worst: number; // index into the given nodes, or −1
  iterations: number;
}

type Col = { rows: number[]; vals: number[]; lo: number; hi: number };

export function checkStability(lib: Library, nodes: Node[], edges: Edge[], opts: { iters?: number; tol?: number; extraLoad?: { part: number; newtons: number } } = {}): StabilityResult {
  const idx = new Map(nodes.map((n, k) => [n.i, k]));
  const cm = (p: Vec3): Vec3 => [p[0] * LDU_CM, p[1] * LDU_CM, p[2] * LDU_CM];
  const centre: Vec3[] = [], mass: number[] = [];
  let floor = -Infinity;
  const bottoms: { lo: Vec3; hi: Vec3 }[] = [];
  for (const n of nodes) {
    const [lo, hi] = lib.part(n.id)!.box;
    const pts: Vec3[] = [];
    for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) {
      const R = n.xf.R, t = n.xf.t;
      pts.push([R[0] * x + R[1] * y + R[2] * z + t[0], R[3] * x + R[4] * y + R[5] * z + t[1], R[6] * x + R[7] * y + R[8] * z + t[2]]);
    }
    const wlo = [0, 1, 2].map((k) => Math.min(...pts.map((p) => p[k]))) as Vec3, whi = [0, 1, 2].map((k) => Math.max(...pts.map((p) => p[k]))) as Vec3;
    bottoms.push({ lo: wlo, hi: whi });
    floor = Math.max(floor, whi[1]); // LDraw: +y is down, the lowest part has the largest y
    centre.push(cm([(wlo[0] + whi[0]) / 2, (wlo[1] + whi[1]) / 2, (wlo[2] + whi[2]) / 2]));
    const vol = (hi[0] - lo[0]) * (hi[1] - lo[1]) * (hi[2] - lo[2]) * LDU_CM ** 3;
    mass.push((DENSITY * vol) / 1000); // kg
  }
  const cols: Col[] = [];
  // A force f (unit direction dir) on part k at point p: 3 force rows and 3 moment rows (p − c) × dir.
  const forceCol = (lo: number, hi: number) => {
    const c: Col = { rows: [], vals: [], lo, hi };
    cols.push(c);
    return c;
  };
  const addForce = (c: Col, k: number, p: Vec3, dir: Vec3, sign: number) => {
    const r: Vec3 = [p[0] - centre[k][0], p[1] - centre[k][1], p[2] - centre[k][2]];
    const m: Vec3 = [r[1] * dir[2] - r[2] * dir[1], r[2] * dir[0] - r[0] * dir[2], r[0] * dir[1] - r[1] * dir[0]];
    for (let q = 0; q < 3; q++) {
      if (dir[q]) c.rows.push(6 * k + q), c.vals.push(sign * dir[q]);
      if (m[q]) c.rows.push(6 * k + 3 + q), c.vals.push(sign * m[q]);
    }
  };
  const addTorque = (c: Col, k: number, axis: Vec3, sign: number) => {
    for (let q = 0; q < 3; q++) if (axis[q]) c.rows.push(6 * k + 3 + q), c.vals.push(sign * axis[q]);
  };
  // A joint force on b, its reaction on a.
  const pair = (a: number, b: number, p: Vec3, dir: Vec3, lo: number, hi: number) => {
    const c = forceCol(lo, hi);
    addForce(c, b, p, dir, 1);
    addForce(c, a, p, dir, -1);
    return c;
  };
  const perp = (n: Vec3): [Vec3, Vec3] => {
    const t: Vec3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u: Vec3 = [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]];
    const m = Math.hypot(...u);
    const u1: Vec3 = [u[0] / m, u[1] / m, u[2] / m];
    const v: Vec3 = [n[1] * u1[2] - n[2] * u1[1], n[2] * u1[0] - n[0] * u1[2], n[0] * u1[1] - n[1] * u1[0]];
    return [u1, v];
  };
  const studCols: { col: number; part: number[] }[] = [];
  for (const e of edges) {
    const a = idx.get(e.a), b = idx.get(e.b);
    if (a === undefined || b === undefined || e.type === "gear") continue;
    const n = e.axis;
    const [u, v] = perp(n);
    for (const at of e.at) {
      const p = cm(at);
      if (e.type === "stud" || e.type === "contact") {
        // b sits on a along n (b leaves along +n): compression pushes b along +n.
        const pts: Vec3[] = e.type === "stud" ? [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([s, t]) => [p[0] + RIM * (s * u[0] + t * v[0]), p[1] + RIM * (s * u[1] + t * v[1]), p[2] + RIM * (s * u[2] + t * v[2])] as Vec3) : [p];
        for (const q of pts) {
          studCols.push({ col: cols.length, part: [a, b] });
          pair(a, b, q, n, e.type === "stud" ? -T_STUD : 0, Infinity);
        }
        pair(a, b, p, u, -Infinity, Infinity);
        pair(a, b, p, v, -Infinity, Infinity);
        continue;
      }
      if (e.type === "fit") {
        // Held every way at one point, with a modest moment (a tyre's grip, glass in a groove).
        for (const d of [n, u, v]) pair(a, b, p, d, -Infinity, Infinity);
        for (const d of [n, u, v]) {
          const c = forceCol(-BALL_TORQUE, BALL_TORQUE);
          addTorque(c, b, d, 1);
          addTorque(c, a, d, -1);
        }
        continue;
      }
      if (e.type === "ball") {
        for (const d of [n, u, v]) pair(a, b, p, d, -Infinity, Infinity);
        for (const d of [n, u, v]) {
          const c = forceCol(-BALL_TORQUE, BALL_TORQUE);
          addTorque(c, b, d, 1);
          addTorque(c, a, d, -1);
        }
        continue;
      }
      // Pins, axles, bars, hinges: lateral forces at two points along the axis.
      const h = 4 * LDU_CM;
      for (const s of [-1, 1]) {
        const q: Vec3 = [p[0] + s * h * n[0], p[1] + s * h * n[1], p[2] + s * h * n[2]];
        pair(a, b, q, u, -Infinity, Infinity);
        pair(a, b, q, v, -Infinity, Infinity);
      }
      const ax = e.friction ? PIN_AXIAL.friction : PIN_AXIAL.smooth;
      pair(a, b, p, n, e.type === "hinge" ? -Infinity : -ax, e.type === "hinge" ? Infinity : ax);
      const tq = e.type === "axle" ? Infinity : e.friction ? PIN_TORQUE.friction : PIN_TORQUE.smooth;
      if (tq > 0) {
        const c = forceCol(-tq, tq);
        addTorque(c, b, n, 1);
        addTorque(c, a, n, -1);
      }
    }
  }
  // The table: under every part that reaches the floor, compression at its bottom corners.
  nodes.forEach((_, k) => {
    const bx = bottoms[k];
    if (bx.hi[1] < floor - 2) return;
    for (const x of [bx.lo[0], bx.hi[0]]) for (const z of [bx.lo[2], bx.hi[2]]) {
      const c = forceCol(0, Infinity);
      addForce(c, k, cm([x, bx.hi[1], z]), [0, -1, 0], 1); // up is −y
    }
    for (const d of [[1, 0, 0], [0, 0, 1]] as Vec3[]) addForce(forceCol(-Infinity, Infinity), k, cm([(bx.lo[0] + bx.hi[0]) / 2, bx.hi[1], (bx.lo[2] + bx.hi[2]) / 2]), d, 1);
  });
  // b: the weights (and a test load), moved to the right-hand side.
  const rows = 6 * nodes.length;
  const rhs = new Float64Array(rows);
  nodes.forEach((_, k) => (rhs[6 * k + 1] = -mass[k] * G)); // weight acts along +y (down)
  if (opts.extraLoad) {
    const k = idx.get(opts.extraLoad.part);
    if (k !== undefined) rhs[6 * k + 1] -= opts.extraLoad.newtons;
  }
  const nc = cols.length;
  const x = new Float64Array(nc), r = new Float64Array(rows);
  /** r = b − A·x */
  const residualOf = () => {
    r.set(rhs);
    for (let j = 0; j < nc; j++) {
      const c = cols[j], v = x[j];
      if (v) for (let q = 0; q < c.rows.length; q++) r[c.rows[q]] -= c.vals[q] * v;
    }
    return r;
  };
  const colDot = (j: number, v: Float64Array) => {
    const c = cols[j];
    let s = 0;
    for (let q = 0; q < c.rows.length; q++) s += c.vals[q] * v[c.rows[q]];
    return s;
  };
  const D = cols.map((c) => Math.sqrt(c.vals.reduce((s, v) => s + v * v, 0)) || 1);
  // Active set on the bounds, CGLS (column-scaled) on the free unknowns: a joint that wants more
  // than it can give is pinned at its limit, then the rest re-balance; a pinned one that wants
  // back inside is let go. Stops when nothing moves.
  const state = new Int8Array(nc); // 0 free, −1 at lo, +1 at hi
  const maxIt = opts.iters ?? 1500;
  let it = 0;
  const s = new Float64Array(nc), p = new Float64Array(nc), q = new Float64Array(rows);
  for (let outer = 0; outer < 40; outer++) {
    residualOf();
    let gamma = 0;
    for (let j = 0; j < nc; j++) {
      s[j] = state[j] ? 0 : colDot(j, r) / D[j];
      p[j] = s[j];
      gamma += s[j] * s[j];
    }
    const g0 = gamma;
    for (let k = 0; k < maxIt && gamma > 1e-24 && gamma > 1e-18 * g0; k++, it++) {
      q.fill(0);
      for (let j = 0; j < nc; j++) {
        const pj = p[j];
        if (!pj) continue;
        const c = cols[j], w = pj / D[j];
        for (let t = 0; t < c.rows.length; t++) q[c.rows[t]] += c.vals[t] * w;
      }
      let qq = 0;
      for (let t = 0; t < rows; t++) qq += q[t] * q[t];
      if (!qq) break;
      const alpha = gamma / qq;
      for (let j = 0; j < nc; j++) if (p[j]) x[j] += (alpha * p[j]) / D[j];
      for (let t = 0; t < rows; t++) r[t] -= alpha * q[t];
      let gn = 0;
      for (let j = 0; j < nc; j++) {
        s[j] = state[j] ? 0 : colDot(j, r) / D[j];
        gn += s[j] * s[j];
      }
      const beta = gn / gamma;
      gamma = gn;
      for (let j = 0; j < nc; j++) p[j] = s[j] + beta * p[j];
    }
    let changed = 0;
    for (let j = 0; j < nc; j++) {
      const c = cols[j];
      if (!state[j]) {
        if (x[j] < c.lo - 1e-9) (x[j] = c.lo), (state[j] = -1), changed++;
        else if (x[j] > c.hi + 1e-9) (x[j] = c.hi), (state[j] = 1), changed++;
      }
    }
    if (!changed) {
      residualOf();
      for (let j = 0; j < nc; j++) {
        if (!state[j]) continue;
        const g = colDot(j, r); // > 0: the residual wants x_j bigger
        if ((state[j] < 0 && g > 1e-9) || (state[j] > 0 && g < -1e-9)) (state[j] = 0), changed++;
      }
    }
    if (!changed) break;
  }
  const Ax = () => {
    residualOf();
    for (let t = 0; t < rows; t++) r[t] = -r[t];
    return r;
  };
  const rr = Ax();
  const residual = nodes.map((_, k) => Math.hypot(rr[6 * k], rr[6 * k + 1], rr[6 * k + 2]) + Math.hypot(rr[6 * k + 3], rr[6 * k + 4], rr[6 * k + 5]) / 2);
  const utilization = nodes.map(() => 0);
  for (const s of studCols) {
    const f = x[s.col];
    if (f < 0) for (const k of s.part) utilization[k] = Math.max(utilization[k], -f / T_STUD);
  }
  // Unstable: a part left with more than 5 % of its weight (or 5 mN) unbalanced.
  let worst = -1, wv = 0;
  residual.forEach((v, k) => {
    const rel = v / Math.max(mass[k] * G, 0.005);
    if (rel > 0.05 && rel > wv) (wv = rel), (worst = k);
  });
  return { stable: worst < 0, residual, utilization, worst, iterations: it };
}
