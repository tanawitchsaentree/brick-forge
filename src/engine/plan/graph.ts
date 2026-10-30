import { apR, apX, type Library, type Snap, type Vec3 } from "./library";
import type { Node } from "./ldraw";

// Layer A: the typed connection multigraph. Every male connector is matched with
// the female ones of other parts that are coaxial, the same section and overlapping
// along the axis; the pair's type follows from the sections (docs/engine/assembly-planning.md):
//
//   stud     a stud (round, r 6, ≤ 8 long, closed top) in an anti-stud, tube or hole — clutch, rigid
//   pin      a round pin (r 6, longer) in a round hole — turns about the axis
//   axle     an axle in an axle hole — slides, can't turn
//   axleFree an axle in a round hole — slides and turns
//   bar      a bar (r 4) in a bar holder or a clip — turns (and slides)
//   hinge    hinge fingers on one axis — turns
//   ball     a ball in a socket — turns every way
//   gear     two gears in mesh (no contact constraint, a functional relation)
//   fit      a part inside another's box without a known connector (tyre on rim, glass in frame): held
//   contact  parts that touch without a known connector: one rests on the other (fallbacks, both)
//
// Each edge carries the axis and the sense parts can come apart along: `b` moves
// relative to `a` along +axis (sense 1), either way (0), or any direction (ball,
// clip: they snap off).

export type EdgeType = "stud" | "pin" | "axle" | "axleFree" | "bar" | "hinge" | "ball" | "gear" | "fit" | "contact";
export interface Edge {
  a: number; // the male side (or the first part)
  b: number;
  type: EdgeType;
  axis: Vec3; // world, unit
  sense: 1 | 0 | "any";
  /** Connectors joined (studs of one stud joint) and where (world): for loads and stability. */
  n: number;
  at: Vec3[];
  /** Turning about the axis, sliding along it. */
  dof: { rot: boolean; slide: boolean };
  friction: boolean;
  /** How far the connectors overlap along the axis (LDU): the length to slide before they part. */
  depth?: number;
}

interface WSnap extends Snap {
  part: number;
  end: Vec3; // far end of the axis segment
  mid: Vec3;
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

const studLike = (s: Snap) => s.kind === "cyl" && s.shape === "R" && Math.abs(s.radius - 6) <= 0.6 && s.length <= 8 && s.caps === "one";

function worldSnaps(lib: Library, nodes: Node[]): WSnap[] {
  const out: WSnap[] = [];
  for (const n of nodes) {
    const info = lib.part(n.id);
    if (!info) continue;
    for (const s of info.snaps) {
      const axis = apR(n.xf.R, s.axis);
      const k = Math.hypot(...axis) || 1;
      const ax: Vec3 = [axis[0] / k, axis[1] / k, axis[2] / k];
      let pos = apX(n.xf, s.pos);
      if (s.center) pos = add(pos, ax, -s.length / 2);
      const end = add(pos, ax, s.length);
      out.push({ ...s, axis: ax, pos, end, mid: add(pos, ax, s.length / 2), part: n.i });
    }
  }
  return out;
}

/** Overlap along `axis` of segments [p0,p1] and [q0,q1]. */
function overlap(axis: Vec3, p0: Vec3, p1: Vec3, q0: Vec3, q1: Vec3) {
  const a = [dot(axis, p0), dot(axis, p1)].sort((x, y) => x - y), b = [dot(axis, q0), dot(axis, q1)].sort((x, y) => x - y);
  return Math.min(a[1], b[1]) - Math.max(a[0], b[0]);
}
const lineDist = (p: Vec3, axis: Vec3, q: Vec3) => {
  const d = sub(q, p);
  const t = dot(d, axis);
  return Math.hypot(d[0] - axis[0] * t, d[1] - axis[1] * t, d[2] - axis[2] * t);
};

export function connectionGraph(lib: Library, nodes: Node[]): Edge[] {
  const snaps = worldSnaps(lib, nodes);
  const CELL = 20;
  const key = (p: Vec3) => `${Math.floor(p[0] / CELL)},${Math.floor(p[1] / CELL)},${Math.floor(p[2] / CELL)}`;
  const females = new Map<string, WSnap[]>();
  for (const s of snaps) if (s.gender === "F" || s.kind === "finger" || s.kind === "ball") (females.get(key(s.mid)) ?? females.set(key(s.mid), []).get(key(s.mid))!).push(s);
  const near = (p: Vec3, r: number) => {
    const out: WSnap[] = [];
    const R = Math.ceil(r / CELL);
    const [cx, cy, cz] = [Math.floor(p[0] / CELL), Math.floor(p[1] / CELL), Math.floor(p[2] / CELL)];
    for (let x = cx - R; x <= cx + R; x++) for (let y = cy - R; y <= cy + R; y++) for (let z = cz - R; z <= cz + R; z++) for (const s of females.get(`${x},${y},${z}`) ?? []) out.push(s);
    return out;
  };
  const edges = new Map<string, Edge>();
  let depth = 0;
  const addEdge = (a: number, b: number, type: EdgeType, axis: Vec3, sense: Edge["sense"], at: Vec3, dof: Edge["dof"], friction = false) => {
    const k = `${a}|${b}|${type}`;
    const e = edges.get(k);
    if (e) e.depth = Math.max(e.depth ?? 0, depth);
    if (e) {
      e.n++;
      e.at.push(at);
      // Several connectors of one pair disagreeing on the sense (a pin's capped half and its
      // through-length, two halves in one part): either way along the axis.
      if (e.sense === 1 && (sense === 0 || dot(axis, e.axis) < 0.98)) e.sense = 0;
      return;
    }
    edges.set(k, { a, b, type, axis, sense, n: 1, at: [at], dof, friction, depth });
  };
  const fric = nodes.map((n) => /friction|with ridges/i.test(lib.part(n.id)?.name ?? ""));
  for (const m of snaps) {
    if (m.gender !== "M" || m.kind !== "cyl") continue;
    for (const f of near(m.mid, m.length / 2 + 40)) {
      if (f.part === m.part) continue;
      if (f.kind === "ball" || f.kind === "finger") continue;
      if (Math.abs(dot(m.axis, f.axis)) < 0.98) continue;
      if (lineDist(m.pos, m.axis, f.pos) > 1.5) continue;
      const ov = overlap(m.axis, m.pos, m.end, f.pos, f.end);
      if (ov < Math.min(2, 0.4 * Math.min(m.length, f.length || m.length))) continue;
      depth = ov;
      if (f.kind === "clip") {
        if (Math.abs(m.radius - f.radius) > 1) continue;
        addEdge(m.part, f.part, "bar", m.axis, "any", m.mid, { rot: true, slide: true }, true);
        continue;
      }
      // Sections: a round male takes a round or square female of its radius; an axle takes an axle hole, or turns in a round one.
      if (Math.abs(m.radius - f.radius) > 1) continue;
      if (m.shape === "R" && f.shape === "A") continue;
      // The sense they part along: from the capped connector's start toward its far end.
      const capped = m.caps === "one" ? m : f.caps === "one" ? f : null;
      const sense: Edge["sense"] = capped ? 1 : 0;
      const axis = capped ? capped.axis : m.axis;
      let type: EdgeType;
      if (studLike(m)) type = "stud";
      else if (m.shape === "A") type = f.shape === "A" ? "axle" : "axleFree";
      else if (Math.abs(m.radius - 4) <= 1) type = "bar";
      else type = "pin";
      const dof = { stud: { rot: false, slide: false }, pin: { rot: true, slide: false }, axle: { rot: false, slide: true }, axleFree: { rot: true, slide: true }, bar: { rot: true, slide: true } }[type as "stud"]!;
      addEdge(m.part, f.part, type, axis, sense, m.mid, dof, fric[m.part] || fric[f.part]);
    }
  }
  // Hinge fingers: two finger sets on one axis, opposite genders, same radius.
  const fingers = snaps.filter((s) => s.kind === "finger");
  for (const p of fingers)
    for (const q of near(p.mid, p.length / 2 + 40)) {
      if (q.kind !== "finger" || q.part <= p.part || q.gender === p.gender || Math.abs(q.radius - p.radius) > 0.6) continue;
      if (Math.abs(dot(p.axis, q.axis)) < 0.98 || lineDist(p.pos, p.axis, q.pos) > 1.5 || overlap(p.axis, p.pos, p.end, q.pos, q.end) < 1) continue;
      addEdge(p.part, q.part, "hinge", p.axis, 0, p.mid, { rot: true, slide: false }, true);
    }
  // Ball joints: a ball and a socket of one size at one point.
  const balls = snaps.filter((s) => s.kind === "ball");
  for (const p of balls)
    for (const q of near(p.mid, 20)) {
      if (q.kind !== "ball" || q.part === p.part || p.gender !== "M" || q.gender !== "F" || Math.abs(q.radius - p.radius) > 1) continue;
      if (Math.hypot(...sub(p.pos, q.pos)) > 2) continue;
      addEdge(p.part, q.part, "ball", p.axis, "any", p.pos, { rot: true, slide: false }, true);
    }
  // Gears in mesh: parallel axes, one plane, centres (z₁ + z₂) · 1.25 LDU apart (Technic module: 8 + 24 teeth = 2 studs).
  const gears = nodes
    .map((n) => {
      const name = lib.part(n.id)?.name ?? "";
      const z = +(name.match(/Gear\s+(\d+)\s+Tooth/i)?.[1] ?? 0);
      if (!z || /Bevel|Worm|Rack|Turntable|Differential/i.test(name)) return null;
      const hole = lib.part(n.id)!.snaps.find((s) => s.kind === "cyl" && s.gender === "F" && s.shape === "A") ?? lib.part(n.id)!.snaps.find((s) => s.kind === "cyl");
      if (!hole) return null;
      const axis = apR(n.xf.R, hole.axis);
      return { i: n.i, z, c: n.xf.t, axis };
    })
    .filter((g): g is NonNullable<typeof g> => !!g);
  for (let x = 0; x < gears.length; x++)
    for (let y = x + 1; y < gears.length; y++) {
      const g = gears[x], h = gears[y];
      if (Math.abs(dot(g.axis, h.axis)) < 0.98) continue;
      const d = sub(h.c, g.c);
      if (Math.abs(dot(d, g.axis)) > 6) continue;
      const dist = Math.hypot(...d), want = (g.z + h.z) * 1.25;
      if (Math.abs(dist - want) > 3) continue;
      addEdge(g.i, h.i, "gear", g.axis, "any", add(g.c, d, 0.5), { rot: true, slide: false });
    }
  return [...edges.values()];
}

/** Parts no connector reaches: joined to what their boxes touch (the "contact" fallback). */
export function contactFallback(lib: Library, nodes: Node[], edges: Edge[], tol = 1): Edge[] {
  const linked = new Set<number>();
  for (const e of edges) if (e.type !== "gear") linked.add(e.a), linked.add(e.b);
  const pairs = new Set<string>();
  const boxes = nodes.map((n) => {
    const [lo, hi] = lib.part(n.id)!.box;
    const lo2: Vec3 = [Infinity, Infinity, Infinity], hi2: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) {
      const p = apX(n.xf, [x, y, z]);
      for (let k = 0; k < 3; k++) (lo2[k] = Math.min(lo2[k], p[k])), (hi2[k] = Math.max(hi2[k], p[k]));
    }
    return [lo2, hi2] as const;
  });
  // Spatial hash of the boxes (4-stud cells) for the candidates.
  const CELL = 80, hash = new Map<string, number[]>();
  const cells = (lo: Vec3, hi: Vec3, f: (k: string) => void) => {
    for (let x = Math.floor((lo[0] - tol) / CELL); x <= Math.floor((hi[0] + tol) / CELL); x++)
      for (let y = Math.floor((lo[1] - tol) / CELL); y <= Math.floor((hi[1] + tol) / CELL); y++)
        for (let z = Math.floor((lo[2] - tol) / CELL); z <= Math.floor((hi[2] + tol) / CELL); z++) f(`${x},${y},${z}`);
  };
  boxes.forEach(([lo, hi], i) => cells(lo, hi, (k) => (hash.get(k) ?? hash.set(k, []).get(k)!).push(i)));
  const out: Edge[] = [];
  for (const n of nodes) {
    if (linked.has(n.i)) continue;
    const [lo, hi] = boxes[n.i];
    const seen = new Set<number>();
    cells(lo, hi, (k) => {
      for (const j of hash.get(k) ?? []) {
        if (j === n.i || seen.has(j) || pairs.has(`${j}|${n.i}`)) continue;
        seen.add(j);
        pairs.add(`${n.i}|${j}`);
        const [lo2, hi2] = boxes[j];
        if ([0, 1, 2].every((q) => lo[q] <= hi2[q] + tol && lo2[q] <= hi[q] + tol)) {
          const c: Vec3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
          const c2: Vec3 = [(lo2[0] + hi2[0]) / 2, (lo2[1] + hi2[1]) / 2, (lo2[2] + hi2[2]) / 2];
          const inside = (p: Vec3, l: Vec3, h: Vec3) => [0, 1, 2].every((q) => p[q] > l[q] && p[q] < h[q]);
          // One inside the other (a tyre on its rim, glass in its frame): a fit, held every way.
          if (inside(c, lo2, hi2) || inside(c2, lo, hi)) out.push({ a: j, b: n.i, type: "fit", axis: [0, -1, 0], sense: "any", n: 1, at: [c], dof: { rot: false, slide: false }, friction: true });
          // Else resting: the upper one (smaller y) is b, pushed up by a.
          else {
            const [a, b] = c[1] < c2[1] ? [j, n.i] : [n.i, j];
            out.push({ a, b, type: "contact", axis: [0, -1, 0], sense: "any", n: 1, at: [c[1] < c2[1] ? [c[0], hi[1], c[2]] : [c2[0], hi2[1], c2[2]]], dof: { rot: false, slide: false }, friction: false });
          }
        }
      }
    });
  }
  return out;
}
