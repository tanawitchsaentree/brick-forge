import { PARTS, footprint } from "./parts";
import { dims, gridOf, studsOf, type PlacedBrick } from "./grid";
import { apply, worldBox, worldCenter } from "./pose";
import { PLATE_H, PLATE_MM, STUD_MM } from "./units";
import { connections } from "./connect";

// Will it hold together? A clutch-moment check in the spirit of Luo et al.,
// "Legolization" (SIGGRAPH Asia 2015). They solve one linear program over every
// force; this is the fast tree version, good enough to run on every edit:
//
//  1. Parts are joined wherever a stud of one sits in the underside of another
//     (on the same grid: the baseplate's, or a posed segment's), or by a ball
//     joint between segments. Positions and levers are in world space.
//  2. BFS from the baseplate gives every part a depth; a part rests on all
//     neighbours that are closer to the ground (a DAG, so loads can split).
//  3. Walking from the top down, each part carries its own weight plus what
//     it received, W at centre of mass c, over the union of its support studs:
//       • c over that stud area            → pure compression, ratio 0
//       • c out past the edge by distance e → it tips about that edge:
//             demand  M = W · e
//             supply  C = t · Σ dᵢ   (each stud's clutch t times its lever dᵢ behind the edge)
//       • a part held only from *above* also pulls straight down: W / (n · t)
//     ratio = demand / supply; above 1 the joint lets go. The load then flows
//     on to each support in proportion to its share of the studs.
//
// Constants: an ABS brick 2×4 weighs 2.32 g (≈ 0.097 g per stud × plate of
// volume); a stud holds ≈ 1 N before it pops (a conservative clutch).

const GRAMS_PER_CELL = 0.097; // 1 stud × 1 stud × 1 plate of hollow brick
const CLUTCH_N = 1.0; // pull-out force per stud
const G = 9.81;
const MIN_LEVER = 0.3; // studs: even a stud on the pivot edge resists over its own radius
// A friction ball joint (Joint-8) holds about 4 N·cm before it swings: ≈ 5 N·stud.
const JOINT_HOLD = 5;

export interface Joint {
  a: string; // supported part
  b: string | "ground"; // what it hangs from
  studs: number;
  ratio: number;
  /** What it carries (grams) and how far out (studs) from what holds it. */
  loadG?: number;
  arm?: number;
}

export interface Stability {
  ratio: Map<string, number>; // per part: load on its joint ÷ what the joint can take
  floating: Set<string>; // not connected to the ground at all
  worst: number;
  weak: Joint[]; // joints at more than 70 % of capacity, worst first
  massG: number;
  com: [number, number, number] | null; // centre of mass, in studs (x, z) and plates (y)
}

interface Node {
  b: PlacedBrick;
  w: number;
  d: number;
  h: number;
  mass: number;
  cx: number;
  cy: number; // plates
  cz: number;
}

/** What a part rests on: stud contacts (world x/z of each stud centre) or a ball joint at a point. */
interface Contact {
  studs: [number, number][];
  joint?: [number, number];
}

export function analyzeStability(bricks: PlacedBrick[]): Stability {
  return bricks.some((b) => (b.seg ?? 0) > 0) ? analyzeRig(bricks) : analyzeParts(bricks);
}

/** The part-by-part analysis; `anchors` are parts held fixed (a section's joint toward the ground). */
function analyzeParts(bricks: PlacedBrick[], anchors?: Set<string>): Stability {
  const nodes: Node[] = bricks.map((b) => {
    const { w, d, h } = dims(b);
    const [cx, cy, cz] = b.pose || b.place ? worldCenter(b) : [b.x + w / 2, (b.y + h / 2) * PLATE_H, b.z + d / 2];
    return { b, w, d, h, mass: w * d * h * GRAMS_PER_CELL, cx, cy: cy / PLATE_H, cz };
  });

  // Which part fills each cell (per segment grid), to find who sits on whom.
  const cellKey = (b: PlacedBrick, x: number, y: number, z: number) => `${gridOf(b)}|${x},${y},${z}`;
  const cell = new Map<string, number>();
  nodes.forEach((n, i) => {
    for (let x = 0; x < n.w; x++)
      for (let z = 0; z < n.d; z++)
        for (let y = 0; y < n.h; y++) cell.set(cellKey(n.b, n.b.x + x, n.b.y + y, n.b.z + z), i);
  });

  // Joints: lower part's studs pushing into the upper part's underside, and ball joints.
  const GROUND = -1;
  const links = new Map<number, Map<number, Contact>>(); // i → j → contact
  const contact = (p: number, q: number) => {
    let m = links.get(p);
    if (!m) links.set(p, (m = new Map()));
    let c = m.get(q);
    if (!c) m.set(q, (c = { studs: [] }));
    return c;
  };
  const link = (i: number, j: number, s: [number, number]) => {
    contact(i, j).studs.push(s);
    if (j !== GROUND) contact(j, i).studs.push(s);
  };
  // World x/z of a stud centre on a part's grid.
  const studAt = (b: PlacedBrick, x: number, y: number, z: number): [number, number] => {
    if (!b.pose) return [x + 0.5, z + 0.5];
    const p = apply(b.pose, [x + 0.5, y * PLATE_H, z + 0.5]);
    return [p[0], p[2]];
  };
  nodes.forEach((n, i) => {
    const studs = studsOf(n.b);
    for (let x = 0; x < n.w; x++)
      for (let z = 0; z < n.d; z++) {
        const gx = n.b.x + x, gz = n.b.z + z;
        if ((n.b.y === 0 && !n.b.seg && !n.b.place) || anchors?.has(n.b.uid)) link(i, GROUND, [gx + 0.5, gz + 0.5]); // the baseplate's studs (or a fixed joint)
        if (!studs.has(`${x},${z}`)) continue;
        const above = cell.get(cellKey(n.b, gx, n.b.y + n.h, gz));
        if (above !== undefined && above !== i) link(above, i, studAt(n.b, gx, n.b.y + n.h, gz));
      }
  });
  // Exact and posed parts (a real design's SNOT, half-stud offsets, wheels on
  // pins) don't sit cell on cell, so the grid can't see what holds them; the
  // engine's own test can (engine/connect.ts: a stud inside another part's
  // body, a pin in a hole, a clip on a bar). Without it they all read as loose.
  if (bricks.some((b) => b.place || b.pose))
    for (const l of connections(bricks)) {
      if (links.get(l.a)?.has(l.b)) continue;
      const at: [number, number] = [nodes[l.a].cx, nodes[l.a].cz];
      for (let k = 0; k < Math.max(1, l.studs); k++) link(l.a, l.b, at);
    }
  // An exact part stands on the baseplate when its bottom is at the model's
  // lowest point, close to the baseplate: tyres and round feet touch it without
  // studs (a car on its wheels is standing, not loose).
  const exactLow = bricks.map((b) => (b.place ? worldBox(b).lo[1] : Infinity));
  const floor = Math.min(...exactLow, ...bricks.map((b) => (b.place || b.pose ? Infinity : b.y * PLATE_H)));
  if (floor < 0.5)
    nodes.forEach((n, i) => {
      if (exactLow[i] < floor + 0.1) link(i, GROUND, [n.cx, n.cz]);
    });
  const byJoint = new Map<string, number[]>();
  nodes.forEach((n, i) => {
    for (const j of n.b.joints ?? []) byJoint.set(j, [...(byJoint.get(j) ?? []), i]);
  });
  for (const ends of byJoint.values())
    for (const i of ends)
      for (const j of ends) {
        if (i === j) continue;
        // The ball's centre: between the two halves.
        contact(i, j).joint = [(nodes[i].cx + nodes[j].cx) / 2, (nodes[i].cz + nodes[j].cz) / 2];
      }

  // BFS from the ground: depth = joints to the baseplate.
  const depth = new Map<number, number>([[GROUND, 0]]);
  const queue = [GROUND];
  const groundLinks = new Map<number, Contact>();
  nodes.forEach((_, i) => {
    const g = links.get(i)?.get(GROUND);
    if (g) groundLinks.set(i, g);
  });
  while (queue.length) {
    const i = queue.shift()!;
    const next = i === GROUND ? groundLinks.keys() : (links.get(i)?.keys() ?? []);
    for (const j of next) {
      if (j === GROUND || depth.has(j)) continue;
      depth.set(j, depth.get(i)! + 1);
      queue.push(j);
    }
  }

  const floating = new Set<string>();
  // Supports: every neighbour closer to the ground, with the contact shared with it.
  const supports = new Map<number, [number, Contact][]>();
  nodes.forEach((n, i) => {
    if (!depth.has(i)) return void floating.add(n.b.uid);
    supports.set(
      i,
      [...(links.get(i) ?? [])].filter(([j]) => depth.get(j)! < depth.get(i)!),
    );
  });

  // Accumulate loads from the top down.
  const load = nodes.map((n) => ({ m: n.mass, x: n.cx * n.mass, y: n.cy * n.mass, z: n.cz * n.mass }));
  const order = [...supports.keys()].sort((a, b) => depth.get(b)! - depth.get(a)!);
  const ratio = new Map<string, number>();
  const joints: Joint[] = [];
  const weight = (c: Contact) => c.studs.length + (c.joint ? 4 : 0);

  for (const i of order) {
    const sup = supports.get(i)!;
    // A joint plate is clamped between the parts above and below it, so it
    // resists turning on both faces, not only on the side nearer the ground.
    // Likewise the parts clamping a joint plate (the brick over it, the plates
    // under and beside it) lock together into one block around the joint:
    // a part resting on one grips with all its studs.
    // And inside a bonded body a part is also held by its neighbours at the
    // same level (bonded to the same parts below — a loop a tree can't see),
    // not only by the one it hangs from; a cantilever chain has none.
    const onJoint = sup.some(([j]) => j !== GROUND && nodes[j].b.joints?.length);
    const clamp = nodes[i].b.joints?.length || onJoint
      ? [...(links.get(i) ?? [])].filter(([j]) => j !== GROUND && depth.has(j))
      : [...(links.get(i) ?? [])].filter(([j]) => j === GROUND || depth.get(j)! <= depth.get(i)!);
    const studs = clamp.flatMap(([, c]) => c.studs);
    const balls = sup.flatMap(([, c]) => (c.joint ? [c.joint] : []));
    const L = load[i];
    const W = (L.m / 1000) * G; // newtons
    const c = [L.x / L.m, L.z / L.m];

    // Union of the support points, and how far the load's centre sits outside it.
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [sx, sz] of studs) {
      x0 = Math.min(x0, sx - 0.5); x1 = Math.max(x1, sx + 0.5);
      z0 = Math.min(z0, sz - 0.5); z1 = Math.max(z1, sz + 0.5);
    }
    for (const [bx, bz] of balls) {
      x0 = Math.min(x0, bx); x1 = Math.max(x1, bx);
      z0 = Math.min(z0, bz); z1 = Math.max(z1, bz);
    }
    const nx = Math.min(Math.max(c[0], x0), x1), nz = Math.min(Math.max(c[1], z0), z1);
    const ex = c[0] - nx, ez = c[1] - nz;
    const e = Math.hypot(ex, ez);
    let r = 0;
    if (e > 1e-6) {
      // Tipping about the edge nearest the load: studs behind it resist with lever dᵢ,
      // a ball joint with its friction.
      const ux = ex / e, uz = ez / e;
      const lever = studs.reduce((s, [sx, sz]) => s + Math.max((nx - sx) * ux + (nz - sz) * uz, MIN_LEVER), 0);
      r = (W * e) / (CLUTCH_N * lever + JOINT_HOLD * balls.length);
    }
    // Held only from above (hanging) by studs: they also take the whole weight in tension.
    const fromAbove = !balls.length && sup.every(([j]) => j !== GROUND && nodes[j].cy > nodes[i].cy);
    if (fromAbove && studs.length) r += W / (studs.length * CLUTCH_N);
    ratio.set(nodes[i].b.uid, r);
    const main = sup.reduce((a, b) => (weight(b[1]) > weight(a[1]) ? b : a));
    joints.push({ a: nodes[i].b.uid, b: main[0] === GROUND ? "ground" : nodes[main[0]].b.uid, studs: studs.length, ratio: r, loadG: L.m, arm: e });

    // Pass the load on, split by each support's share of the contact. A load
    // centred within its supports reaches each one as a plain push at that
    // support (two hips each carry half the body over themselves); a load out
    // past them (tipping) carries its lever along.
    const total = sup.reduce((s, [, c]) => s + weight(c), 0);
    for (const [j, cj] of sup) {
      if (j === GROUND) continue;
      const f = weight(cj) / total;
      const P = load[j];
      let px = L.x / L.m, pz = L.z / L.m;
      if (e <= 1e-6) {
        const pts = cj.joint ? [...cj.studs, cj.joint] : cj.studs;
        px = pts.reduce((s, q) => s + q[0], 0) / pts.length;
        pz = pts.reduce((s, q) => s + q[1], 0) / pts.length;
      }
      P.m += L.m * f; P.x += px * L.m * f; P.y += L.y * f; P.z += pz * L.m * f;
    }
  }

  const massG = nodes.reduce((s, n) => s + n.mass, 0);
  const com: Stability["com"] = massG
    ? [
        nodes.reduce((s, n) => s + n.cx * n.mass, 0) / massG,
        nodes.reduce((s, n) => s + n.cy * n.mass, 0) / massG,
        nodes.reduce((s, n) => s + n.cz * n.mass, 0) / massG,
      ]
    : null;
  const worst = Math.max(0, ...ratio.values(), floating.size ? Infinity : 0);
  return {
    ratio,
    floating,
    worst,
    weak: joints.filter((j) => j.ratio > 0.7).sort((a, b) => b.ratio - a.ratio),
    massG,
    com,
  };
}

// ------------------------------------------------------------------ rigs
//
// A posed model (a dinosaur) is rigid sections on ball joints. Per part, a
// tree of stud links can't see that a torso on four legs is held by all four
// (the load would follow whichever leg is fewest links from the ground), so
// rigs are solved as rigid bodies:
//
//  • Sections are ordered from the ground (feet on the baseplate) outward
//    through their joints. Every section collects its own weight plus what
//    hangs off it (each child's weight, applied at the child's joint).
//  • A section held by one joint loads it with torque W·e (e: horizontal
//    distance from the load's centre to the ball) against the joint's
//    friction; that joint passes W on as a push at the ball.
//  • A section held by several (a torso on its legs) shares W between them
//    by the lever rule — the least-squares forces whose moments balance the
//    load; anything left over (the centre of mass outside the feet) is torque
//    shared by those joints.
//  • Inside each section, the part-by-part clutch check still runs, anchored
//    at its joints, for overhangs (a crest, a frill).

const groupOf = (b: PlacedBrick) => (b as PlacedBrick & { group?: string }).group ?? "";

function analyzeRig(bricks: PlacedBrick[]): Stability {
  const all = analyzeParts(bricks); // connectivity (floating), masses, the baseplate parts
  const mass = (b: PlacedBrick) => {
    const { w, d, h } = dims(b);
    return w * d * h * GRAMS_PER_CELL;
  };
  const centre = (b: PlacedBrick) => (b.pose || b.place ? worldCenter(b) : [b.x + dims(b).w / 2, 0, b.z + dims(b).d / 2]);
  // Sections: posed grids (seg > 0). Baseplate parts (feet) count as ground.
  const secOf = (b: PlacedBrick) => ((b.seg ?? 0) > 0 ? b.seg! : 0);
  const secs = new Map<number, PlacedBrick[]>();
  for (const b of bricks) if (!all.floating.has(b.uid)) secs.set(secOf(b), [...(secs.get(secOf(b)) ?? []), b]);
  // Joints between sections: id → the two halves.
  const byJoint = new Map<string, PlacedBrick[]>();
  for (const b of bricks) for (const j of b.joints ?? []) byJoint.set(j, [...(byJoint.get(j) ?? []), b]);
  type Link = { id: string; mine: PlacedBrick; other: PlacedBrick; to: number; at: [number, number] };
  const linksOf = new Map<number, Link[]>();
  for (const [id, ends] of byJoint) {
    if (ends.length !== 2) continue;
    const [a, c] = ends;
    const sa = secOf(a), sc = secOf(c);
    if (sa === sc) continue;
    const pa = centre(a), pc = centre(c);
    const at: [number, number] = [(pa[0] + pc[0]) / 2, (pa[2] + pc[2]) / 2];
    linksOf.set(sa, [...(linksOf.get(sa) ?? []), { id, mine: a, other: c, to: sc, at }]);
    linksOf.set(sc, [...(linksOf.get(sc) ?? []), { id, mine: c, other: a, to: sa, at }]);
  }
  // Order sections from the ground (section 0 = the baseplate's parts).
  const depth = new Map<number, number>([[0, 0]]);
  const queue = [0];
  while (queue.length) {
    const s = queue.shift()!;
    for (const l of linksOf.get(s) ?? []) if (!depth.has(l.to)) {
      depth.set(l.to, depth.get(s)! + 1);
      queue.push(l.to);
    }
  }
  // Loads, from the outermost sections in.
  const load = new Map<number, { m: number; x: number; z: number }>();
  for (const [s, parts] of secs) {
    if (s === 0) continue;
    let m = 0, x = 0, z = 0;
    for (const b of parts) {
      const w = mass(b), c = centre(b);
      m += w; x += w * c[0]; z += w * c[2];
    }
    load.set(s, { m, x, z });
  }
  // Baseplate parts (feet) on their own, part by part; the legs' load on them
  // is the ankle joints' torque, solved below with the sections.
  const base = analyzeParts(bricks.filter((b) => secOf(b) === 0 && !all.floating.has(b.uid)));
  const ratio = new Map(base.ratio);
  const joints: Joint[] = [...base.weak];
  const order = [...load.keys()].filter((s) => depth.has(s)).sort((a, b) => depth.get(b)! - depth.get(a)!);
  for (const s of order) {
    const L = load.get(s)!;
    if (L.m <= 0) continue;
    const W = (L.m / 1000) * G;
    const cx = L.x / L.m, cz = L.z / L.m;
    const held = (linksOf.get(s) ?? []).filter((l) => depth.get(l.to)! < depth.get(s)!);
    if (!held.length) continue;
    // Forces F_i at the joints with ΣF = W and ΣF·p = W·c, least squares (a 3×3 solve).
    const n = held.length;
    let F = held.map(() => W / n);
    if (n > 1) {
      const P = held.map((l) => [1, l.at[0], l.at[1]]);
      const A = [0, 1, 2].map((r) => [0, 1, 2].map((c) => P.reduce((a, p) => a + p[r] * p[c], 0) + (r === c ? 1e-6 : 0)));
      const rhs = [W, W * cx, W * cz];
      const lam = solve3(A, rhs);
      F = P.map((p) => Math.max(0, p[0] * lam[0] + p[1] * lam[1] + p[2] * lam[2]));
      const sum = F.reduce((a, f) => a + f, 0) || 1;
      F = F.map((f) => (f * W) / sum);
    }
    // What the forces don't balance is torque at the joints (shared).
    const mx = W * cx - held.reduce((a, l, i) => a + F[i] * l.at[0], 0);
    const mz = W * cz - held.reduce((a, l, i) => a + F[i] * l.at[1], 0);
    const torque = Math.hypot(mx, mz) / n;
    held.forEach((l, i) => {
      const r = torque / JOINT_HOLD;
      for (const b of [l.mine, l.other]) ratio.set(b.uid, Math.max(ratio.get(b.uid) ?? 0, r));
      joints.push({ a: l.mine.uid, b: l.other.uid, studs: 0, ratio: r, loadG: L.m, arm: W ? torque / W : 0 });
      // The parent carries this share as a push at the ball.
      const P = load.get(l.to);
      const g = (F[i] / G) * 1000;
      if (P) {
        P.m += g; P.x += g * l.at[0]; P.z += g * l.at[1];
      }
    });
  }
  // Inside each section: overhangs on their own studs (a frill, a crest, a
  // sail), held at the joint toward the ground. What hangs off the section is
  // the joints' business (above): inside one bonded body the front's and the
  // back's loads cancel through the body, which a tree of parts can't see.
  for (const [s, parts] of secs) {
    if (s === 0 || !depth.has(s)) continue;
    const anchors = new Set((linksOf.get(s) ?? []).filter((l) => depth.get(l.to)! < depth.get(s)!).map((l) => l.mine.uid));
    const inner = analyzeParts(parts, anchors);
    // The section's own body (its main module, packed as one bonded piece) is
    // rigid; what's mounted on it — a sail, a frill, horns — is checked.
    const count = new Map<string, number>();
    for (const b of parts) count.set(groupOf(b), (count.get(groupOf(b)) ?? 0) + 1);
    const main = [...count].sort((a, b) => b[1] - a[1])[0]?.[0];
    const mounted = new Set(parts.filter((b) => groupOf(b) !== main).map((b) => b.uid));
    for (const [uid, r] of inner.ratio) if (mounted.has(uid) && Number.isFinite(r)) ratio.set(uid, Math.max(ratio.get(uid) ?? 0, r));
    joints.push(...inner.weak.filter((j) => j.b !== "ground" && mounted.has(j.a)));
  }
  const worst = Math.max(0, ...ratio.values(), all.floating.size ? Infinity : 0);
  return {
    ratio,
    floating: all.floating,
    worst,
    weak: joints.filter((j) => j.ratio > 0.7).sort((a, b) => b.ratio - a.ratio),
    massG: all.massG,
    com: all.com,
  };
}

/** Solve a 3×3 system (Cramer's rule; A is well conditioned here). */
function solve3(A: number[][], b: number[]): number[] {
  const det = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(A) || 1e-12;
  return [0, 1, 2].map((k) => det(A.map((row, r) => row.map((v, c) => (c === k ? b[r] : v)))) / D);
}

/** Physical size in millimetres of a set of parts. */
export function sizeMM(bricks: PlacedBrick[]) {
  if (!bricks.length) return null;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const b of bricks) {
    if (b.pose || b.place) {
      const { lo, hi } = worldBox(b);
      x0 = Math.min(x0, lo[0]); x1 = Math.max(x1, hi[0]);
      z0 = Math.min(z0, lo[2]); z1 = Math.max(z1, hi[2]);
      y0 = Math.min(y0, lo[1] / PLATE_H); y1 = Math.max(y1, hi[1] / PLATE_H);
      continue;
    }
    const part = PARTS[b.partId];
    const { w, d } = footprint(part, b.rot);
    x0 = Math.min(x0, b.x); x1 = Math.max(x1, b.x + w);
    z0 = Math.min(z0, b.z); z1 = Math.max(z1, b.z + d);
    y0 = Math.min(y0, b.y); y1 = Math.max(y1, b.y + part.h);
  }
  return { w: (x1 - x0) * STUD_MM, d: (z1 - z0) * STUD_MM, h: (y1 - y0) * PLATE_MM };
}

/** Heat colour for a load ratio: green (relaxed) → amber → red (failing). */
export function stressColor(r: number | undefined, floating: boolean): string {
  if (floating) return "#c026d3";
  const t = Math.min(Math.max(r ?? 0, 0), 1.2) / 1.2;
  // Two-segment ramp through amber, in perceptually even-ish steps.
  const stops = [
    [0.13, 0.62, 0.36],
    [0.96, 0.69, 0.13],
    [0.86, 0.15, 0.15],
  ];
  const [a, b, k] = t < 0.5 ? [stops[0], stops[1], t * 2] : [stops[1], stops[2], (t - 0.5) * 2];
  const mix = a.map((v, i) => Math.round((v + (b[i] - v) * k) * 255));
  return `#${mix.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
