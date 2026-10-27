import { Builder, plain, sizesOf, type Pool, type RectKind } from "./pool";
import { IDENTITY, apply, chain, rotY, rotZ, translate, worldCenter, type Mat4 } from "../pose";
import { dims, studsOf } from "../grid";
import { PLATE_H } from "../units";

// Dinosaurs the way LEGO Creator builds them (31151 T. rex, 31159 Fierce
// Dinosaurs), reverse-engineered into a skeleton grammar:
//
//   dinosaur = torso ⊕ head(+ jaw) ⊕ neck* ⊕ tail₁…tailₙ ⊕ legs ⊕ arms? ⊕ features
//
//  • Every section is a rigid brick-built body on its own grid, joined to the
//    next by a friction ball joint (Plate 1×2 with Ball 14417 → Socket 14704),
//    so a tail can droop, a head look down, a jaw hang open — at real angles,
//    with the ball's centre the exact pivot.
//  • A body is lofted: per stud column a width and a height, filled with the
//    fewest bricks and plates (in running bond), and dressed on top with
//    curved slopes along both edges — the rounded backs of the Creator sets —
//    in a darker top colour over a pale belly (countershading).
//  • Legs are two sections (thigh, shin) solved by two-bone IK: the hip is on
//    the torso, the ankle on a foot clicked to the baseplate, the knee goes
//    forward (dinosaurs walk on their toes). So the hip height falls out of
//    the leg lengths, and four-legged species lean by their leg ratio.
//  • Joints alternate sides of each other along a leg (hip ball out, knee ball
//    in, ankle ball out) so the leg stays one stud from the body.
//
// Proportions are per species, in torso lengths — the body plans below — and
// scaled by size; the seed nudges them and picks colours.

type V3 = [number, number, number];
const DEG = Math.PI / 180;

const BALL = "14417"; // Plate 1×2 with Ball Joint-8 on Side
const SOCKET = "14704"; // Plate 1×2 with Socket Joint-8 with Friction Centre
const CURVED_1x2 = "11477"; // Slope Brick Curved 2×1, descends along its 2
const CURVED_2x2 = "15068"; // Slope Brick Curved 2×2×⅔
const CHEESE_1x2 = "85984"; // Slope 31 1×2×⅔ (1 deep)
const CHEESE_1x1 = "54200"; // Slope 31 1×1×⅔
const CONE = "4589"; // Cone 1×1
const RIDGE_2x2 = "3043"; // Slope 45 2×2 Double
const RIDGE_1x2 = "3044b"; // Slope 45 2×1 Double
const TOOTH_DOWN = "15070"; // Plate 1×1 with Tooth Perpendicular (hangs off the front)
const TEETH_UP = "15209"; // Tile 1×2 with 2 Teeth Vertical
const TOOTH_INLINE = "49668"; // Plate 1×1 with Tooth In-line (horn, spike, claw)
const CLAWS = "27261"; // Plate 1×2 with 3 Rocky Claws
const EYE = "lb-eye"; // brick with side stud + round tile eye

const BLACK = 0, WHITE = 15, DBG = 72, DARK_PINK = 5;

// ------------------------------------------------------------------ joints

/** Which way a joint's ball or socket faces, in its section's frame. */
type Dir = "+x" | "-x" | "+z" | "-z";
const TURN: Record<Dir, Mat4> = { "+z": IDENTITY, "+x": rotY(Math.PI / 2), "-x": rotY(-Math.PI / 2), "-z": rotY(Math.PI) };
const STEP: Record<Dir, V3> = { "+x": [1, 0, 0], "-x": [-1, 0, 0], "+z": [0, 0, 1], "-z": [0, 0, -1] };

/**
 * A 1×2 joint plate on grid layer `layer`, its ball (or socket) facing `dir`.
 * Facing ±x it sits in column x = `col` across z ∈ [c−1, c+1); facing ±z in
 * column z = `col` along x ∈ [c−1, c+1). The ball's centre is one stud out
 * from the plate's centre, half a plate down (LDraw: 0, 4, −20).
 */
function jointPlate(dir: Dir, col: number, layer: number, c: number) {
  const alongX = dir === "+z" || dir === "-z";
  const at: V3 = alongX ? [c, (layer + 1) * PLATE_H, col + 0.5] : [col + 0.5, (layer + 1) * PLATE_H, c];
  const s = STEP[dir];
  return {
    at,
    centre: [at[0] + s[0], at[1] - 0.2, at[2] + s[2]] as V3,
    cell: (alongX ? [c - 1, layer, col] : [col, layer, c - 1]) as V3,
    fp: alongX ? { w: 2, d: 1, h: 1, studs: true } : { w: 1, d: 2, h: 1, studs: true },
  };
}

interface Ball {
  id: string;
  world: V3;
}

/** The sections of one model and the joints between them. */
class Rig {
  readonly root: Builder;
  readonly segs: Builder[] = [];
  private nSeg = 1;
  private nJoint = 0;

  constructor(readonly pool: Pool) {
    this.root = new Builder(pool, undefined, "r");
  }

  section(pose: Mat4) {
    const id = this.nSeg++;
    const b = new Builder(this.pool, { id, pose }, `s${id}.`);
    this.segs.push(b);
    return b;
  }

  /** A ball on section `b`; returns where its centre is in the world. */
  ball(b: Builder, dir: Dir, col: number, layer: number, c: number, color = DBG): Ball {
    const j = jointPlate(dir, col, layer, c);
    const id = `j${this.nJoint++}`;
    b.exact(BALL, j.at, TURN[dir], color, { cell: j.cell, fp: j.fp, joints: [id] });
    return { id, world: apply(b.seg?.pose ?? IDENTITY, j.centre) };
  }

  /**
   * A new section hanging off `ball`: its socket at (dir, col, layer, c) on
   * its own grid, the section turned by `rot` in the world about the ball.
   */
  attach(ball: Ball, rot: Mat4, name: string, dir: Dir, col: number, layer: number, c: number, color = DBG): Builder {
    const j = jointPlate(dir, col, layer, c);
    const s = this.section(chain(translate(...ball.world), rot, translate(-j.centre[0], -j.centre[1], -j.centre[2])));
    s.module(name, () => s.exact(SOCKET, j.at, TURN[dir], color, { cell: j.cell, fp: j.fp, joints: [ball.id] }));
    return s;
  }

  /** A socket on a section that already exists (a foot on the baseplate). */
  socket(b: Builder, ball: Ball, dir: Dir, col: number, layer: number, c: number, color = DBG) {
    const j = jointPlate(dir, col, layer, c);
    b.exact(SOCKET, j.at, TURN[dir], color, { cell: j.cell, fp: j.fp, joints: [ball.id] });
  }

  /** Where a socket at (dir, col, layer, c) would have its centre on a grid (to line up a foot). */
  static socketCentre(dir: Dir, col: number, layer: number, c: number) {
    return jointPlate(dir, col, layer, c).centre;
  }
}

// ------------------------------------------------------------------- bodies

/** One stud column of a lofted body: z ∈ [z0, z1), y ∈ [y0, y1) plates. */
interface Col {
  z0: number;
  z1: number;
  y0: number;
  y1: number;
}

/** A body's columns, from per-column half-width and bottom/top heights (centred on z = 0). */
function columns(n: number, f: (i: number, t: number) => { hw: number; y0: number; y1: number }): Col[] {
  return Array.from({ length: n }, (_, i) => {
    const { hw, y0, y1 } = f(i, n > 1 ? i / (n - 1) : 0);
    return { z0: -hw, z1: hw, y0, y1 };
  });
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Fill a body with plain bricks and plates, bonded like a wall: at each free
 * cell, the largest part that bridges two different parts of the course below
 * (running bond, so the body is one piece), else the largest that fits.
 * Bricks where three plates of the same colour stack, plates elsewhere; grain
 * alternates by course. Cells already taken (joints, eyes) are skipped.
 */
interface Strategy {
  endsFirst: boolean;
  flip: boolean; // start the direction alternation the other way
  grainFlip: boolean;
  bond: boolean; // prefer bridging parts
  /** Half-brick start: on alternate layers the first column only takes 1-long parts, shifting every seam by a stud. */
  offset: boolean;
}

function fill(b: Builder, x0: number, cols: Col[], color: (x: number, y: number, z: number) => number, st: Strategy) {
  const inside = (x: number, y: number, z: number) => {
    const c = cols[x - x0];
    return !!c && z >= c.z0 && z < c.z1 && y >= c.y0 && y < c.y1;
  };
  const yMin = Math.min(...cols.map((c) => c.y0)), yMax = Math.max(...cols.map((c) => c.y1));
  const zMin = Math.min(...cols.map((c) => c.z0)), zMax = Math.max(...cols.map((c) => c.z1));
  const sized = (kind: RectKind, grainX: boolean) =>
    sizesOf(kind)
      .flatMap(([a, c]) => (a === c ? [[a, c]] : [[a, c], [c, a]]) as [number, number][])
      .filter(([a, c]) => kind === "plate" || a * c <= 8) // bricks up to 2×4: bodies stay shaped, not slabs
      .sort((p, q) => q[0] * q[1] - p[0] * p[1] || (grainX ? q[0] - p[0] : q[1] - p[1]));
  // Which part fills each cell (this body's parts; anything else placed earlier counts as one).
  const owner = new Map<string, number>();
  let nOwn = 0;
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const ownerAt = (x: number, y: number, z: number) => owner.get(key(x, y, z)) ?? (b.isFree(x, y, z) ? undefined : -1);
  // A layer holding something placed first (a joint plate, a tooth) is plates
  // only, all across: bricks never straddle it, so every column keeps the
  // same courses and the bond can run through.
  const plateOnly = new Set<number>();
  for (let y = yMin; y < yMax; y++)
    for (let x = x0; x < x0 + cols.length && !plateOnly.has(y); x++)
      for (let z = zMin; z < zMax; z++) if (inside(x, y, z) && !b.isFree(x, y, z)) {
        plateOnly.add(y);
        break;
      }
  for (let y = yMin; y < yMax; y++) {
    const grainX = (Math.floor(y / 3) % 2 === 0) !== st.grainFlip;
    // Column by column (each stud column is one section of the loft), and in
    // alternate directions layer by layer — parts anchored at their far end on
    // the way back — so end columns get reached into from both sides.
    // End columns first, each reaching inward (they have one neighbour to bond
    // to); the rest alternate direction by layer.
    const back = (y % 2 === 1) !== st.flip;
    const n = cols.length, last = x0 + n - 1;
    const inner = Array.from({ length: Math.max(0, n - 2) }, (_, i) => (back ? last - 1 - i : x0 + 1 + i));
    const all = Array.from({ length: n }, (_, i) => (back ? last - i : x0 + i));
    const order: [number, boolean][] =
      st.endsFirst && n > 1 ? [[x0, false], [last, true], ...inner.map((x): [number, boolean] => [x, back])] : all.map((x): [number, boolean] => [x, back]);
    for (const [x, rev] of order)
      for (let z = zMin; z < zMax; z++) {
        if (!inside(x, y, z) || !b.isFree(x, y, z)) continue;
        const col = color(x, y, z);
        const fits = (sx: number, a: number, d: number, h: number) => {
          for (let i = 0; i < a; i++)
            for (let k = 0; k < d; k++)
              for (let j = 0; j < h; j++)
                if (!inside(sx + i, y + j, z + k) || !b.isFree(sx + i, y + j, z + k) || color(sx + i, y + j, z + k) !== col) return false;
          return true;
        };
        const bridges = (sx: number, a: number, d: number) => {
          const under = new Set<number>();
          for (let i = 0; i < a; i++) for (let k = 0; k < d; k++) {
            const o = ownerAt(sx + i, y - 1, z + k);
            if (o !== undefined) under.add(o);
          }
          return under.size >= 2;
        };
        const brickOk = !plateOnly.has(y) && !plateOnly.has(y + 1) && !plateOnly.has(y + 2);
        const options: { kind: RectKind; sx: number; a: number; d: number; h: number }[] = [];
        for (const [kind, h] of [["brick", 3], ["plate", 1]] as const)
          if (kind === "plate" || brickOk)
            for (const [a, d] of sized(kind, grainX)) {
              if (st.offset && y % 2 === 1 && x === order[0][0] && a > 1) continue;
              const sx = rev ? x - a + 1 : x;
              if (fits(sx, a, d, h)) options.push({ kind, sx, a, d, h });
            }
        // Prefer a bridging part (bricks first, then plates); else the biggest.
        const pick = (st.bond ? options.find((o) => bridges(o.sx, o.a, o.d)) : undefined) ?? options[0];
        if (!pick) continue;
        const p = plain(pick.kind, pick.a, pick.d);
        if (!p || !b.put(p.id, pick.sx, y, z, p.rot, col)) continue;
        nOwn++;
        for (let i = 0; i < pick.a; i++) for (let k = 0; k < pick.d; k++) for (let j = 0; j < pick.h; j++) owner.set(key(pick.sx + i, y + j, z + k), nOwn);
      }
  }
}

/** Parts of a grid not joined (stud to stud) to its largest piece. */
function loose(b: Builder): number {
  const parts = b.parts.filter((p) => !p.place || p.fp);
  const cell = new Map<string, number>();
  parts.forEach((p, i) => {
    const { w, d, h } = dims(p);
    for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) for (let y = 0; y < h; y++) cell.set(`${p.x + x},${p.y + y},${p.z + z}`, i);
  });
  const up = parts.map((_, i) => i);
  const find = (i: number): number => (up[i] === i ? i : (up[i] = find(up[i])));
  parts.forEach((p, i) => {
    const { h } = dims(p);
    for (const s of studsOf(p)) {
      const [dx, dz] = s.split(",").map(Number);
      const j = cell.get(`${p.x + dx},${p.y + h},${p.z + dz}`);
      if (j !== undefined && j !== i) up[find(i)] = find(j);
    }
  });
  const size = new Map<number, number>();
  parts.forEach((_, i) => size.set(find(i), (size.get(find(i)) ?? 0) + 1));
  return parts.length - Math.max(0, ...size.values());
}

const STRATEGIES: Strategy[] = [
  { endsFirst: false, flip: false, grainFlip: false, bond: true, offset: false },
  { endsFirst: true, flip: false, grainFlip: false, bond: true, offset: false },
  { endsFirst: false, flip: false, grainFlip: false, bond: true, offset: true },
  { endsFirst: false, flip: true, grainFlip: false, bond: true, offset: true },
  { endsFirst: false, flip: true, grainFlip: false, bond: true, offset: false },
  { endsFirst: true, flip: true, grainFlip: true, bond: true, offset: false },
  { endsFirst: false, flip: false, grainFlip: true, bond: true, offset: true },
  { endsFirst: false, flip: true, grainFlip: true, bond: true, offset: false },
  { endsFirst: true, flip: false, grainFlip: true, bond: false, offset: true },
  { endsFirst: false, flip: false, grainFlip: false, bond: false, offset: false },
];

/**
 * Fill a body and make sure it comes out as one piece: if a strategy leaves
 * any part unbonded, undo and try the next; keep the first that holds (or,
 * failing all, the one with the fewest loose parts).
 */
function core(b: Builder, x0: number, cols: Col[], color: (x: number, y: number, z: number) => number) {
  const m = b.mark();
  let best = { loose: Infinity, k: 0 };
  for (let k = 0; k < STRATEGIES.length; k++) {
    fill(b, x0, cols, color, STRATEGIES[k]);
    const n = loose(b);
    if (n === 0) return;
    if (n < best.loose) best = { loose: n, k };
    b.rollback(m);
  }
  fill(b, x0, cols, color, STRATEGIES[best.k]);
}

/**
 * Round the top of a body: curved slopes down both side edges (2×2 where two
 * columns match, 1×2 otherwise), plate + tile between them, so every column
 * ends 2 plates above its core. Runs of matching columns share their plates,
 * which also ties the columns together on top.
 *
 * With a `spine` colour the middle stays studded (two plates, no tiles) for
 * features to stand on — a sail, back plates, armour — and narrow bodies get
 * 1-deep cheese slopes on their edges so the spine is two studs wide.
 */
function roundTop(b: Builder, x0: number, cols: Col[], color: number, flat = false, spine?: number) {
  const same = (p: Col, q: Col) => p.z0 === q.z0 && p.z1 === q.z1 && p.y1 === q.y1;
  for (let i = 0; i < cols.length; ) {
    let n = 1;
    while (i + n < cols.length && same(cols[i], cols[i + n])) n++;
    const c = cols[i], x = x0 + i, y = c.y1;
    const w = c.z1 - c.z0;
    let lo = c.z0, hi = c.z1;
    const edge = spine !== undefined && w === 4 ? 1 : 2; // edge depth
    if (!flat && w >= 3) {
      for (let k = 0; k < n; ) {
        const two = k + 1 < n;
        const id = edge === 1 ? (two ? CHEESE_1x2 : CHEESE_1x1) : two ? CURVED_2x2 : CURVED_1x2;
        b.put(id, x + k, y, c.z0, 2, color);
        b.put(id, x + k, y, c.z1 - edge, 0, color);
        k += two ? 2 : 1;
      }
      lo = c.z0 + edge;
      hi = c.z1 - edge;
    }
    if (hi > lo) {
      b.rect("plate", x, lo, n, hi - lo, y, spine ?? color);
      b.rect(spine === undefined ? "tile" : "plate", x, lo, n, hi - lo, y + 1, spine ?? color);
    }
    i += n;
  }
}

/**
 * Which layer a joint plate goes in, for a column `height` plates tall: on
 * the 4-layer rhythm plate · joint · brick course (layers 1, 5, 9…) so a body
 * keeps whole brick courses between its joints, with at least two layers
 * over the joint. `pick` 0 = lowest, 1 = highest; `low` allows layer 0 for
 * thin bodies (a tail tip).
 */
function jointLayer(height: number, pick: 0 | 1, low = false) {
  const ok = [1, 5, 9, 13].filter((l) => l <= height - 3);
  if (!ok.length) return low ? 0 : 1;
  return pick ? ok[ok.length - 1] : ok[0];
}

// ------------------------------------------------------------- body plans

export type Species =
  | "rex"
  | "raptor"
  | "spino"
  | "dilopho"
  | "parasaur"
  | "trike"
  | "stego"
  | "ankylo"
  | "brachio";

export const SPECIES: { id: Species; label: string; latin: string }[] = [
  { id: "rex", label: "T. rex", latin: "Tyrannosaurus rex" },
  { id: "raptor", label: "Raptor", latin: "Velociraptor" },
  { id: "spino", label: "Spinosaurus", latin: "Spinosaurus aegyptiacus" },
  { id: "dilopho", label: "Dilophosaurus", latin: "Dilophosaurus wetherilli" },
  { id: "parasaur", label: "Parasaurolophus", latin: "Parasaurolophus walkeri" },
  { id: "trike", label: "Triceratops", latin: "Triceratops horridus" },
  { id: "stego", label: "Stegosaurus", latin: "Stegosaurus stenops" },
  { id: "ankylo", label: "Ankylosaurus", latin: "Ankylosaurus magniventris" },
  { id: "brachio", label: "Brachiosaurus", latin: "Brachiosaurus altithorax" },
];

/**
 * A body plan, in studs and plates at medium size. Lengths are joint to
 * joint; heights are core plates (each body adds 2 for its rounded top).
 */
export interface Plan {
  title: string;
  biped: boolean;
  torso: { L: number; hw: number; H: number; pitch: number };
  neck?: { n: number; L: number; hw: number; H: number; bend: number };
  head: { L: number; hw: number; H: number; snout: number; bend: number; jawOpen: number; teeth: boolean };
  tail: { n: number; L: number; hw: number; H: number; taper: number; bend: number[] };
  /** Leg column sizes: thigh/shin thickness (x) and joint-to-joint length (plates). */
  hind: { thigh: [number, number]; shin: [number, number]; foot: number; claws: boolean };
  fore?: { thigh: [number, number]; shin: [number, number]; foot: number; claws: boolean };
  arms?: { len: number; reach: number };
  colors: { main: number[]; belly: number[]; accent: number[] };
  features: Feature[];
}

export type Feature = "sail" | "crests" | "frill" | "horns" | "plates" | "spikes" | "armor" | "club" | "crestTube" | "stripe";

/** The hand-built body plans: the anchors the learning engine starts from and is measured against. */
export const PLANS: Record<Species, Plan> = {
  rex: {
    title: "T. rex",
    biped: true,
    torso: { L: 8, hw: 3, H: 9, pitch: 12 },
    head: { L: 7, hw: 2, H: 6, snout: 3, bend: -18, jawOpen: 28, teeth: true },
    tail: { n: 3, L: 5, hw: 2, H: 6, taper: 0.66, bend: [-10, 4, 6] },
    hind: { thigh: [4, 11], shin: [2, 11], foot: 4, claws: true },
    arms: { len: 5, reach: 40 },
    colors: { main: [288, 72, 70, 4], belly: [19, 28, 71], accent: [330, 28, 72] },
    features: ["stripe"],
  },
  raptor: {
    title: "Raptor",
    biped: true,
    torso: { L: 6, hw: 2, H: 6, pitch: 8 },
    neck: { n: 1, L: 3, hw: 1, H: 4, bend: 35 },
    head: { L: 5, hw: 1, H: 4, snout: 2, bend: -35, jawOpen: 24, teeth: true },
    tail: { n: 3, L: 5, hw: 1, H: 4, taper: 0.75, bend: [-4, 3, 4] },
    hind: { thigh: [3, 10], shin: [2, 10], foot: 3, claws: true },
    arms: { len: 6, reach: 30 },
    colors: { main: [4, 25, 378, 28], belly: [14, 19, 15], accent: [320, 484, 72] },
    features: ["stripe"],
  },
  spino: {
    title: "Spinosaurus",
    biped: true,
    torso: { L: 9, hw: 2, H: 8, pitch: 10 },
    head: { L: 8, hw: 1, H: 4, snout: 4, bend: -12, jawOpen: 18, teeth: true },
    tail: { n: 3, L: 5, hw: 2, H: 6, taper: 0.66, bend: [-8, 3, 5] },
    hind: { thigh: [3, 10], shin: [2, 10], foot: 4, claws: true },
    arms: { len: 6, reach: 30 },
    colors: { main: [72, 378, 484], belly: [71, 19], accent: [4, 25, 191] },
    features: ["sail"],
  },
  dilopho: {
    title: "Dilophosaurus",
    biped: true,
    torso: { L: 7, hw: 2, H: 7, pitch: 10 },
    neck: { n: 1, L: 3, hw: 1, H: 5, bend: 28 },
    head: { L: 5, hw: 1, H: 4, snout: 2, bend: -30, jawOpen: 30, teeth: true },
    tail: { n: 3, L: 5, hw: 2, H: 5, taper: 0.66, bend: [-6, 3, 4] },
    hind: { thigh: [3, 10], shin: [2, 10], foot: 3, claws: true },
    arms: { len: 5, reach: 35 },
    colors: { main: [10, 2, 27], belly: [14, 226], accent: [4, 25] },
    features: ["crests"],
  },
  parasaur: {
    title: "Parasaurolophus",
    biped: true,
    torso: { L: 8, hw: 3, H: 9, pitch: 6 },
    neck: { n: 1, L: 3, hw: 1, H: 5, bend: 30 },
    head: { L: 5, hw: 1, H: 4, snout: 2, bend: -26, jawOpen: 0, teeth: false },
    tail: { n: 3, L: 5, hw: 2, H: 6, taper: 0.66, bend: [-6, 2, 3] },
    hind: { thigh: [4, 11], shin: [2, 10], foot: 4, claws: false },
    arms: { len: 7, reach: 25 },
    colors: { main: [191, 25, 1, 378], belly: [226, 19, 15], accent: [4, 320, 272] },
    features: ["crestTube", "stripe"],
  },
  trike: {
    title: "Triceratops",
    biped: false,
    torso: { L: 10, hw: 3, H: 9, pitch: -2 },
    head: { L: 6, hw: 2, H: 6, snout: 2, bend: -14, jawOpen: 0, teeth: false },
    tail: { n: 2, L: 4, hw: 2, H: 6, taper: 0.6, bend: [-10, -4] },
    hind: { thigh: [3, 7], shin: [3, 6], foot: 3, claws: false },
    fore: { thigh: [3, 6], shin: [3, 6], foot: 3, claws: false },
    colors: { main: [28, 1, 70, 330], belly: [19, 15], accent: [25, 4, 191] },
    features: ["frill", "horns"],
  },
  stego: {
    title: "Stegosaurus",
    biped: false,
    torso: { L: 10, hw: 3, H: 8, pitch: -8 },
    neck: { n: 1, L: 3, hw: 1, H: 4, bend: -6 },
    head: { L: 4, hw: 1, H: 3, snout: 2, bend: -4, jawOpen: 0, teeth: false },
    tail: { n: 2, L: 5, hw: 2, H: 6, taper: 0.6, bend: [-6, 4] },
    hind: { thigh: [3, 9], shin: [3, 8], foot: 3, claws: false },
    fore: { thigh: [3, 7], shin: [3, 6], foot: 3, claws: false },
    colors: { main: [378, 330, 72], belly: [19, 28], accent: [25, 4, 320] },
    features: ["plates", "spikes"],
  },
  ankylo: {
    title: "Ankylosaurus",
    biped: false,
    torso: { L: 10, hw: 4, H: 7, pitch: 0 },
    head: { L: 4, hw: 2, H: 4, snout: 1, bend: -8, jawOpen: 0, teeth: false },
    tail: { n: 2, L: 5, hw: 1, H: 4, taper: 0.8, bend: [4, 0] },
    hind: { thigh: [3, 5], shin: [3, 4], foot: 3, claws: false },
    fore: { thigh: [3, 5], shin: [3, 4], foot: 3, claws: false },
    colors: { main: [70, 28, 72], belly: [19, 84], accent: [28, 19, 71] },
    features: ["armor", "club"],
  },
  brachio: {
    title: "Brachiosaurus",
    biped: false,
    torso: { L: 9, hw: 3, H: 9, pitch: 14 },
    neck: { n: 3, L: 4, hw: 1, H: 5, bend: 26 },
    head: { L: 4, hw: 1, H: 4, snout: 2, bend: -50, jawOpen: 0, teeth: false },
    tail: { n: 2, L: 5, hw: 2, H: 5, taper: 0.55, bend: [-14, -6] },
    hind: { thigh: [3, 9], shin: [3, 8], foot: 3, claws: false },
    fore: { thigh: [3, 12], shin: [3, 11], foot: 3, claws: false },
    colors: { main: [379, 378, 71, 28], belly: [15, 19, 71], accent: [272, 330, 72] },
    features: [],
  },
};

// ------------------------------------------------------------------ builder

interface Palette {
  main: number;
  belly: number;
  accent: number;
}

export interface DinoDesign {
  root: Builder;
  sections: Builder[];
  title: string;
  rule: string;
}

/**
 * Build one dinosaur. `size` 0–2 scales lengths (×0.72, ×1, ×1.4), `detail`
 * 0–2 adds finishing (teeth, claws, features at 1; spikes, armour and back
 * stripes at 2; easy builds have one tail section fewer).
 */
export function dinosaur(species: Species, pool: Pool, size: number, detail: number, r: () => number, learned?: Plan): DinoDesign {
  const plan = learned ?? PLANS[species];
  const k = [0.72, 1, 1.4][size] * (0.94 + r() * 0.12);
  // The species' signature colour more often than not, else one of the others.
  const pick = (xs: number[]) => (r() < 0.55 ? xs[0] : xs[1 + Math.floor(r() * (xs.length - 1))] ?? xs[0]);
  const pal: Palette = { main: pick(plan.colors.main), belly: pick(plan.colors.belly), accent: pick(plan.colors.accent) };
  // Balance: build once, find the centre of mass of everything the legs carry,
  // and put the hips under it (a T. rex balances its head on its tail).
  const L = Math.max(plan.fore ? 8 : 4, Math.round(plan.torso.L * k));
  const guess = Math.max(2, Math.round(L * 0.3));
  const trial = build(plan, pool.fork(), k, pal, detail, guess);
  let m = 0, mx = 0;
  for (const p of [trial.root, ...trial.sections].flatMap((b) => b.parts)) {
    if (/leg/i.test(p.group)) continue;
    const { w, d, h } = dims(p);
    m += w * d * h;
    mx += w * d * h * worldCenter(p)[0];
  }
  // The hip is at world x = 0 in a build; moving it along the torso moves the body the other way.
  const hipC = plan.fore ? guess : Math.min(L - 3, Math.max(2, Math.round(guess + (m ? mx / m : 0))));
  return build(plan, pool, k, pal, detail, hipC);
}

function build(plan: Plan, pool: Pool, k: number, pal: Palette, detail: number, hipC: number): DinoDesign {
  const S = (v: number, min = 1) => Math.max(min, Math.round(v * k));
  const rig = new Rig(pool);
  const has = (f: Feature) => plan.features.includes(f) && detail >= (f === "spikes" || f === "armor" || f === "stripe" ? 2 : 1);
  // Bodies that carry something on their back keep a studded spine.
  const torsoSpine = has("sail") || has("plates") || has("armor") ? pal.main : has("stripe") ? pal.accent : undefined;
  const headSpine = has("crests") || has("frill") || has("horns") || has("crestTube") ? pal.main : undefined;

  // ---- torso: its pose comes from the hind legs (hip height from leg lengths).
  // Torso at least 4 wide (hip balls and the tail ball need their own columns),
  // and long enough on four legs for the front and back feet to stand apart.
  const T = { L: S(plan.torso.L, plan.fore ? 8 : 4), hw: Math.max(2, Math.round(plan.torso.hw * Math.min(k, 1.4))), H: S(plan.torso.H, plan.arms ? 8 : 5) };
  const shoulderC = T.L - 2; // fore legs / arms near the front (ball plate on columns L−3, L−2)
  const hipLocal = jointPlate("+z", T.hw - 1, 1, hipC).centre;

  const legLen = (p: [number, number]) => S(p[1], 4) * PLATE_H; // joint-to-joint, world units
  const hindL = [legLen(plan.hind.thigh), legLen(plan.hind.shin)];
  const ANKLE_LAYER = 4; // socket on the foot: plate + brick up
  const ankleY = ANKLE_LAYER * PLATE_H + 0.2;
  // Legs at 94 % of full stretch: knee bent forward, but the joints carry the
  // body with a short lever (a deeper crouch overloads a 1×2 ball plate).
  const STRETCH = 0.94;
  const hipY = ankleY + STRETCH * (hindL[0] + hindL[1]);
  let pitch = plan.torso.pitch * DEG;
  if (plan.fore) {
    // Four legs: tilt the torso so both pairs stand at the same stretch.
    const foreL = [legLen(plan.fore.thigh), legLen(plan.fore.shin)];
    const shoulderY = ankleY + STRETCH * (foreL[0] + foreL[1]);
    pitch = Math.asin(Math.max(-0.7, Math.min(0.7, (shoulderY - hipY) / (shoulderC - hipC))));
  }
  const torsoRot = rotZ(pitch);
  const torso = rig.section(chain(translate(0, hipY, T.hw + 0.5), torsoRot, translate(-hipLocal[0], -hipLocal[1], -hipLocal[2])));

  const colorBy = (bellyTop: number) => (_x: number, y: number) => (y < bellyTop ? pal.belly : pal.main);
  const tCols = columns(T.L, (i, t) => {
    // Deeper at the hips and chest, shallower toward the tail.
    const h = Math.round(T.H * (0.72 + 0.28 * Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.1))));
    return { hw: i === 0 || i === T.L - 1 ? Math.max(1, T.hw - 1) : T.hw, y0: 0, y1: h };
  });
  let tailBall!: Ball, headBall!: Ball, hipR!: Ball, hipL!: Ball, foreR: Ball | undefined, foreL: Ball | undefined;
  torso.module("Body", () => {
    hipR = rig.ball(torso, "+z", T.hw - 1, 1, hipC);
    hipL = rig.ball(torso, "-z", -T.hw, 1, hipC);
    // Tail joint set into the body: sections meet face to face, no gap.
    // At least two layers of the end column above it, to bridge over the joint.
    const tl = jointLayer(tCols[0].y1, 0);
    tailBall = rig.ball(torso, "-x", 1, tl, 0);
    torso.block(0, tl, -1, 1, 1, 2);
    // Neck (or head) joint also set into the chest, under the plates above it.
    const hl = jointLayer(tCols[T.L - 1].y1, 1);
    headBall = rig.ball(torso, "+x", T.L - 2, hl, 0);
    torso.block(T.L - 1, hl, -1, 1, 1, 2);
    if (plan.fore) {
      foreR = rig.ball(torso, "+z", T.hw - 1, 1, shoulderC);
      foreL = rig.ball(torso, "-z", -T.hw, 1, shoulderC);
    } else if (plan.arms) {
      // Arms high on the chest, on the upper joint layer; on a chest too low
      // for that, a ball plate further forward than the hips' (or no arms).
      const al = jointLayer(tCols[shoulderC].y1, 1);
      const ac = al > 1 || shoulderC - 1 > hipC ? shoulderC : hipC + 2;
      if (ac <= T.L - 2 && (al > 1 || ac - 1 > hipC)) {
        foreR = rig.ball(torso, "+z", T.hw - 1, al, ac);
        foreL = rig.ball(torso, "-z", -T.hw, al, ac);
      }
    }
    core(torso, 0, tCols, colorBy(Math.round(T.H * 0.34)));
    roundTop(torso, 0, tCols, pal.main, false, torsoSpine);
  });
  const spineTop = (i: number) => tCols[i].y1 + 2; // first layer on the spine's studs

  // ---- tail: n sections, each narrower and lower, bending as the plan says.
  let prevBall = tailBall, prevRot = chain(torsoRot, rotY(Math.PI));
  const tn = Math.max(2, plan.tail.n - (detail === 0 ? 1 : 0)); // easy builds: one tail section fewer
  for (let s = 0; s < tn; s++) {
    const f = Math.pow(plan.tail.taper, s);
    const L = S(plan.tail.L * (s === tn - 1 ? 1.1 : 1), 3);
    const hw0 = Math.max(1, Math.round(plan.tail.hw * f)), hw1 = Math.max(1, Math.round(plan.tail.hw * f * plan.tail.taper));
    const H0 = Math.max(3, Math.round(S(plan.tail.H) * f)), H1 = Math.max(2, Math.round(S(plan.tail.H) * f * plan.tail.taper));
    const last = s === tn - 1;
    // The first bend is from the horizontal (the torso's own tilt taken out), the rest relative.
    const bend = (plan.tail.bend[s] ?? 0) * DEG + (s === 0 ? pitch : 0);
    const rot = chain(prevRot, rotZ(bend));
    const sockLayer = jointLayer(H0, 0, true);
    const seg = rig.attach(prevBall, rot, "Tail", "-x", 0, sockLayer, 0);
    const cols = columns(L, (_i, t) => ({
      hw: last && t > 0.7 ? Math.max(1, hw1 - 1) || 1 : Math.max(1, Math.round(lerp(hw0, hw1, t))),
      y0: Math.round(lerp(0, last ? 1 : 0, t)),
      y1: Math.max(2, Math.round(lerp(H0, last ? Math.max(2, H1 - 1) : H1, t))),
    }));
    seg.module("Tail", () => {
      if (!last) {
        const tl = jointLayer(cols[L - 1].y1, 0, true);
        prevBall = rig.ball(seg, "+x", L - 2, tl, 0);
        seg.block(L - 1, tl, -1, 1, 1, 2);
      }
      core(seg, 0, cols, colorBy(Math.round(H0 * 0.34)));
      // Thagomizer: spikes out and back, on the top plate (before the tiles go on).
      if (last && has("spikes"))
        for (const [x, z] of [[L - 2, -1], [L - 2, 0], [L - 4, -1], [L - 4, 0]])
          if (x >= 0) seg.exact(TOOTH_INLINE, [x + 0.5, (cols[x].y1 + 2) * PLATE_H, z + 0.5], rotY(z < 0 ? (3 * Math.PI) / 4 : Math.PI / 4), WHITE, { cell: [x, cols[x].y1 + 1, z] });
      roundTop(seg, 0, cols, pal.main, cols[0].z1 - cols[0].z0 < 3);
    });
    prevRot = rot;
    if (last && has("club")) {
      const club = rig.ball(seg, "+x", L - 1, 0, 0);
      const c = rig.attach(club, rot, "Tail club", "-x", 0, 0, 0);
      c.module("Tail club", () => {
        const cc = columns(3, () => ({ hw: 2, y0: 0, y1: 3 }));
        core(c, 0, cc, () => pal.accent);
        roundTop(c, 0, cc, pal.accent);
      });
    }
  }

  // ---- neck (some species) and head.
  let headRot = torsoRot, attachTo = headBall;
  if (plan.neck)
    for (let s = 0; s < plan.neck.n; s++) {
      const rot = chain(headRot, rotZ((s === 0 ? plan.neck.bend : plan.neck.bend * 0.25) * DEG));
      const L = S(plan.neck.L, 2), hw = plan.neck.hw, H = S(plan.neck.H, 3);
      const seg = rig.attach(attachTo, rot, "Neck", "-x", 0, 1, 0);
      const cols = columns(L, () => ({ hw, y0: 0, y1: H }));
      seg.module("Neck", () => {
        attachTo = rig.ball(seg, "+x", L - 1, 1, 0);
        core(seg, 0, cols, colorBy(2));
        roundTop(seg, 0, cols, pal.main, hw * 2 < 3);
      });
      headRot = rot;
    }
  // Heads are at least 4 plates over the jaw line: a row of teeth, a plate, the 3-plate eye.
  const hL = S(plan.head.L, 4);
  const eyeAt = Math.max(1, Math.round(hL * 0.3));
  // The snout stays in front of the eye column (the eye needs the skull's height).
  const Hd = { L: hL, hw: plan.head.hw, H: Math.max(4, S(plan.head.H, 3)), snout: Math.max(1, Math.min(Math.round(plan.head.snout * k), hL - eyeAt - 1)) };
  const jawGap = plan.head.jawOpen > 0 ? 3 : 0; // upper head starts this high, over the jaw
  const hRot = chain(headRot, rotZ(plan.head.bend * DEG));
  const head = rig.attach(attachTo, hRot, "Head", "-x", 0, jawGap + 1, 0);
  const hCols = columns(Hd.L, (i) => {
    const front = i >= Hd.L - Hd.snout;
    return { hw: Hd.hw, y0: i === 0 || !jawGap ? 0 : jawGap, y1: front ? jawGap + Math.max(2, Hd.H - 3) : jawGap + Hd.H };
  });
  head.module("Head", () => {
    // Eyes at the top of the head (they fill a narrow head's width, so the
    // core under them and the plates over them hold the head together).
    const eyeX = eyeAt;
    const eyeY = jawGap + Hd.H - 3;
    {
      head.put(EYE, eyeX, eyeY, Hd.hw - 1, 0, pal.main);
      head.put(EYE, eyeX, eyeY, -Hd.hw, 2, pal.main);
    }
    if (jawGap && plan.head.teeth && detail >= 1)
      for (let x = 2; x < Hd.L; x++)
        for (const [z, dir] of [[Hd.hw - 1, "+z"], [-Hd.hw, "-z"]] as const) {
          // Every other stud, both at the tip; none under an eye or just in front
          // of it, where the snout's plates bond to the skull.
          if ((x % 2 && x < Hd.L - 1) || x === eyeX || x === eyeX + 1) continue;
          head.exact(TOOTH_DOWN, [x + 0.5, (jawGap + 1) * PLATE_H, z + 0.5], TURN[dir], WHITE, { cell: [x, jawGap, z] });
        }
    if (jawGap) {
      const jaw = rig.ball(head, "+x", 0, 0, 0);
      const jRot = chain(hRot, rotZ(-plan.head.jawOpen * DEG));
      const JL = Hd.L - 2;
      const j = rig.attach(jaw, jRot, "Jaw", "-x", 0, 0, 0);
      j.module("Jaw", () => {
        const jc = columns(JL, () => ({ hw: Hd.hw, y0: 0, y1: 2 }));
        if (plan.head.teeth && detail >= 1 && Hd.hw >= 2)
          for (let x = 1; x + 1 < JL; x += 2) {
            j.put(TEETH_UP, x, 2, Hd.hw - 1, 0, WHITE);
            j.put(TEETH_UP, x, 2, -Hd.hw, 0, WHITE);
          }
        core(j, 0, jc, (_x, y) => (y >= 1 ? pal.belly : pal.main));
        if (Hd.hw >= 2) j.rect("plate", 1, -1, Math.min(2, JL - 1), 2, 2, DARK_PINK); // tongue
        j.rect("tile", 0, -Hd.hw, JL, Hd.hw * 2, 2, pal.belly);
      });
      // Nothing of the head under the jaw line in front of the joint.
      head.block(1, 0, -Hd.hw, Hd.L - 1, jawGap, Hd.hw * 2);
    }
    core(head, 0, hCols, (x, y) => (y < jawGap + 1 && x > 0 ? pal.belly : pal.main));
    roundTop(head, 0, hCols, pal.main, Hd.hw * 2 < 3, headSpine);
    const top = hCols[0].y1 + 2, snoutTop = hCols[Hd.L - 1].y1 + 2;
    const back = Hd.L - Hd.snout; // columns behind the snout
    if (has("crests"))
      head.module("Crests", () => {
        // Twin crests: a brick and a double slope along each side of the skull.
        head.rect("brick", 0, -1, back, 2, top, pal.accent);
        for (let x = 0; x < back; x++) head.put(RIDGE_1x2, x, top + 3, -1, 0, pal.accent); // ridge across: a row of peaks
      });
    if (has("crestTube"))
      head.module("Crest", () => {
        // A hollow crest sweeping back over the neck, held by the skull's studs.
        const long = plain("plate", 6, 2)!; // 6 along x: 4 studs out behind the head
        head.put(long.id, -4, top, -1, long.rot, pal.accent);
        head.put(CURVED_2x2, -4, top + 1, -1, 1, pal.accent);
        head.rect("tile", -2, -1, 4, 2, top + 1, pal.accent);
      });
    if (has("frill"))
      head.module("Frill", () => {
        // A bonded wall behind the horns, wider than the skull (it overhangs both sides).
        const fh = Math.max(1, Hd.hw) + 2;
        const fc: Col[] = [0, 1].map(() => ({ z0: -fh, z1: fh, y0: top, y1: top + S(6, 3) }));
        core(head, 0, fc, () => pal.accent);
        roundTop(head, 0, fc, pal.accent);
      });
    if (has("horns"))
      head.module("Horns", () => {
        // Two brow horns over the eyes, one on the nose — all pointing forward.
        for (const z of [-1, 0]) head.exact(TOOTH_INLINE, [back - 0.5, (top + 1) * PLATE_H, z + 0.5], TURN["+x"], WHITE, { cell: [back - 1, top, z] });
        head.put(RIDGE_1x2, Hd.L - 1, snoutTop, -1, 0, WHITE);
      });
  });

  // ---- legs: hip → thigh → knee → shin → ankle → foot on the baseplate.
  const legs: { ball: Ball; side: 1 | -1; spec: NonNullable<Plan["fore"]>; name: string }[] = [
    { ball: hipR, side: 1, spec: plan.hind, name: "Right leg" },
    { ball: hipL, side: -1, spec: plan.hind, name: "Left leg" },
  ];
  if (plan.fore && foreR && foreL)
    legs.push({ ball: foreR, side: 1, spec: plan.fore, name: "Right front leg" }, { ball: foreL, side: -1, spec: plan.fore, name: "Left front leg" });
  for (const leg of legs) buildLeg(rig, leg.ball, leg.side, leg.spec, T.hw, S, pal, detail, leg.name, ANKLE_LAYER);

  // ---- arms (two-legged species): short, clawed, reaching forward.
  if (plan.arms && !plan.fore && foreR && foreL)
    for (const [ball, side] of [[foreR, 1], [foreL, -1]] as const) {
      const len = S(plan.arms.len, 3);
      const rot = rotZ(plan.arms.reach * DEG);
      const zi = side > 0 ? 0 : -1; // inner column
      const a = rig.attach(ball, rot, side > 0 ? "Right arm" : "Left arm", side > 0 ? "-z" : "+z", zi, len - 2, 1);
      a.module(side > 0 ? "Right arm" : "Left arm", () => {
        if (detail >= 1) a.exact(TOOTH_DOWN, [1.5, PLATE_H, zi + 0.5], TURN["+x"], BLACK, { cell: [1, 0, zi] }); // claw
        core(a, 0, [{ z0: zi, z1: zi + 1, y0: 0, y1: len }, { z0: zi, z1: zi + 1, y0: 0, y1: len }], () => pal.main);
      });
    }

  // ---- species features on the torso's studded spine (z ∈ [−1, 1)).
  const along = (from: number, to: number) => Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);
  if (has("sail"))
    torso.module("Sail", () => {
      // A bonded fin, tallest mid-back: h(t) = H·sin(πt)^0.8.
      const xs = along(1, T.L - 1);
      const Hs = S(10, 6);
      const sc: Col[] = xs.map((i) => {
        const t = (i - 0.5) / (T.L - 2);
        return { z0: -1, z1: 1, y0: spineTop(i), y1: spineTop(i) + Math.max(2, Math.round(Hs * Math.pow(Math.sin(Math.PI * t), 0.8))) };
      });
      core(torso, xs[0], sc, () => pal.accent);
      roundTop(torso, xs[0], sc, pal.accent, true);
    });
  if (has("plates"))
    torso.module("Back plates", () => {
      // Upright plates down the spine: 2×2 bricks capped by a double slope, tallest over the hips.
      for (let i = 0; i + 1 < T.L; i += 2) {
        const t = (i + 1) / T.L;
        const n = Math.max(0, Math.round(2.4 * Math.sin(Math.PI * t) - 0.3));
        const y = Math.max(spineTop(i), spineTop(i + 1));
        for (let k = 0; k < n; k++) torso.put("3003", i, y + 3 * k, -1, 0, pal.accent);
        torso.put(RIDGE_2x2, i, y + 3 * n, -1, 1, pal.accent);
      }
    });
  if (has("armor"))
    torso.module("Armour", () => {
      // Osteoderms: cones on every other stud of the spine.
      const zs = T.hw >= 4 ? [-2, -1, 0, 1] : [-1, 0];
      for (let i = 1; i + 1 < T.L; i++) for (const z of zs) if ((i + z + 4) % 2 === 0) torso.put(CONE, i, spineTop(i), z, 0, pal.accent);
    });

  return {
    root: rig.root,
    sections: rig.segs,
    title: plan.title,
    rule: `torso ${T.L}×${T.hw * 2} · ${tn} tail sections tapering ×${plan.tail.taper} · legs ${hindL.map((l) => l.toFixed(1)).join("+")} studs, hip at ${hipY.toFixed(1)} (${Math.round(STRETCH * 100)} % stretch, IK) · ball joints at every section`,
  };
}

/**
 * One leg by two-bone IK. Thigh and shin are columns built upright on their
 * own grids (x = thickness, y = up the leg); the hip ball points out of the
 * body, the knee ball back in, the ankle ball out again onto the foot's
 * socket — so the leg folds within a stud of the body. The knee goes forward.
 */
function buildLeg(
  rig: Rig,
  hip: Ball,
  side: 1 | -1,
  spec: NonNullable<Plan["fore"]>,
  hw: number,
  S: (v: number, min?: number) => number,
  pal: Palette,
  detail: number,
  name: string,
  ankleLayer: number,
) {
  // Thickness grows with size more slowly than length (√k), like real limbs carrying more.
  const thick = (v: number) => Math.max(2, Math.round(v * Math.sqrt(S(10, 1) / 10)));
  const ta = thick(spec.thigh[0]), sa = thick(spec.shin[0]);
  const tLen = S(spec.thigh[1], 4), sLen = S(spec.shin[1], 4);
  const l1 = tLen * PLATE_H, l2 = sLen * PLATE_H;
  const out: Dir = side > 0 ? "+z" : "-z", inn: Dir = side > 0 ? "-z" : "+z";
  const tc = Math.max(1, Math.round(ta / 2)), sc = Math.max(1, Math.round(sa / 2));
  // Thigh: inner column z = 0 (right) / −1 (left), 2 wide; shin inboard of it, 2 wide.
  const tz = side > 0 ? 0 : -1, tW = 2;
  const tZ0 = side > 0 ? 0 : -tW;
  const sW = 2, sz = side > 0 ? sW - 1 : -sW, sZ0 = side > 0 ? 0 : -sW;

  // Foot on the baseplate: its socket under the hip, slightly behind.
  const footZ = side > 0 ? hw + 1 : -hw - 2; // foot's inner column
  const fW = 2;
  const xa = Math.round(hip.world[0] - 0.4);
  const A = Rig.socketCentre(inn, footZ, ankleLayer, xa);
  // IK in the x–y plane.
  const dx = A[0] - hip.world[0], dy = A[1] - hip.world[1];
  const d = Math.min(Math.hypot(dx, dy), l1 + l2 - 1e-3);
  const a1 = Math.acos(Math.min(1, Math.max(-1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))));
  const base = Math.atan2(dy, dx);
  // Knee in front of the hip–ankle line (dinosaurs: knee forward).
  const knee: [number, number] = [hip.world[0] + l1 * Math.cos(base + a1), hip.world[1] + l1 * Math.sin(base + a1)];
  const phi1 = Math.atan2(knee[0] - hip.world[0], -(knee[1] - hip.world[1]));
  const phi2 = Math.atan2(A[0] - knee[0], -(A[1] - knee[1]));

  // Thigh: socket near the top, knee ball near the bottom, both on the inner
  // column, each sandwiched between plates (a joint plate never ends a column).
  const thigh = rig.attach(hip, rotZ(phi1), name, inn, tz, tLen + 1, tc);
  let kneeBall!: Ball;
  thigh.module(name, () => {
    kneeBall = rig.ball(thigh, inn, tz, 1, tc);
    // Drumstick: the columns away from the joints start higher, so the thigh narrows to the knee.
    const cols: Col[] = Array.from({ length: ta }, (_, i) => ({ z0: tZ0, z1: tZ0 + tW, y0: i === tc - 1 || i === tc ? 0 : Math.round(tLen * 0.4), y1: tLen + 3 }));
    core(thigh, 0, cols, () => pal.main);
  });
  // Shin: socket at the top on its outer column, ankle ball at the bottom, outer column.
  const shin = rig.attach(kneeBall, rotZ(phi2), name, out, sz, sLen + 1, sc);
  let ankle!: Ball;
  shin.module(name, () => {
    ankle = rig.ball(shin, out, sz, 1, sc);
    const cols: Col[] = Array.from({ length: sa }, () => ({ z0: sZ0, z1: sZ0 + sW, y0: 0, y1: sLen + 3 }));
    core(shin, 0, cols, () => pal.main);
  });
  // Foot: a plate, a heel post up to the ankle socket, claws at the toes.
  const f = rig.root;
  const fL = Math.max(2, S(spec.foot, 2));
  const fz0 = side > 0 ? footZ : footZ - fW + 1;
  f.module(name, () => {
    rig.socket(f, ankle, inn, footZ, ankleLayer, xa);
    f.rect("brick", xa - 1, fz0, 2, fW, 1, pal.main);
    f.rect("plate", xa - 1, fz0, 2, fW, 0, pal.main);
    f.rect("plate", xa - 1, fz0, fL + 1, fW, 0, pal.main);
    if (spec.claws && detail >= 1) {
      f.exact(CLAWS, [xa + fL - 0.5, 2 * PLATE_H, fz0 + 1], TURN["+x"], BLACK, { cell: [xa + fL - 1, 1, fz0], fp: { w: 1, d: 2, h: 1, studs: true } });
    } else f.rect("tile", xa + 1, fz0, fL - 1, fW, 1, DBG);
  });
}

