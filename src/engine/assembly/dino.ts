import type { Rot } from "../parts";
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
const TOOTH_INLINE = "49668"; // Plate 1×1 with Tooth In-line (horn, spike, claw)
const CLAWS = "27261"; // Plate 1×2 with 3 Rocky Claws
const EYE = "lb-eye"; // brick with side stud + round tile eye

const BLACK = 0, WHITE = 15, DBG = 72, DARK_RED = 320;

// ------------------------------------------------------------- teeth (31058)
// How LEGO's 31058 Mighty Dinosaurs T. rex does a mouth (reverse-engineered from
// the set's photo and its Rebrickable inventory: 7× 15208 tri-tooth plates,
// 52107 / 26604 bricks with side studs, a dark red 1×4 tile tongue): each jaw
// edge is a rail of bricks with studs on their sides, and a 1×2 plate with
// three teeth clicks onto each pair of side studs, standing on its edge, so
// the teeth make one continuous row that points down from the upper jaw and
// up from the lower one. (Single 1×1 teeth on every other stud read as a toy.)
const TRI_TOOTH = "15208"; // Plate 1×2 with 3 Teeth In-line: teeth along +z, past its 1-stud depth
const SIDE_STUDS = "52107"; // Brick 1×2 with Studs on (both long) Sides
const COVER_TILE = "3069b"; // Tile 1×2 with Groove
const SIDE_STUD = "87087"; // Brick 1×1 with Stud on 1 Side (+z at rot 0)
const ROUND_1x1 = "6141"; // Plate 1×1 Round
const TRANS_ORANGE = 57;
const OPEN_ROUND = "85861"; // Plate 1×1 Round with Open Stud (a bar fits its stud)
const CLAW = "87747"; // Bar 0.5L with Curved Blade 2L: rotZ(−90°) points it +x, curving down

/**
 * Construction choices the image comparison (scripts/dino-head-fit.mjs) tries
 * against a reference photo; the defaults are the ones that scored best.
 */
export const DINO_TUNING = {
  teeth: "rail" as "rail" | "single", // tri-tooth rails (31058) or 1×1 teeth on every other stud
  coverTiles: true, // tiles over the tooth plates' studs
  eye: "snot" as "snot" | "printed", // trans-orange round plate on a side stud, or the printed-eye brick
  nostrils: true, // two studs facing forward on the snout
  brow: true, // the skull behind the snout in the accent colour
  profile: "slope" as "slope" | "step", // the head's top down to the snout: in steps, or one cliff
  belly: "inverted" as "inverted" | "flat", // inverted slopes round the underside of bodies
  claws: "curved" as "curved" | "plate", // a big curved claw per toe, or a 1×2 plate with 3 small claws
  ends: "cheese" as "cheese" | "square", // cheese slopes round a head's crown and snout ends
  cheeks: true, // side studs left showing on the cheeks
  statue: true, // from size 4 up, one bonded statue on the grid instead of sections on joints
  pairedJoints: true, // a double ball joint for a heavy head on a wide body
};

/** The tooth plate's turn: its studs face out of the jaw (±z), its teeth up or down. Column-major. */
const toothTurn = (side: 1 | -1, up: boolean): Mat4 =>
  up
    ? side > 0 ? [-1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1] : [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1]
    : side > 0 ? [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1] : [-1, 0, 0, 0, 0, 0, -1, 0, 0, -1, 0, 0, 0, 0, 0, 1];

/**
 * A rail section: a 1×2 side-stud brick at (x, y, z) on `b`'s grid and, on
 * its outer side studs, a tri-tooth plate standing on its long edge.
 */
function toothRail(b: Builder, x: number, y: number, z: number, side: 1 | -1, up: boolean, color: number) {
  if (!b.put(SIDE_STUDS, x, y, z, 0, color)) return false;
  // Side studs are 0.7 up the brick (LDraw: 10 LDU under its top); the plate's
  // top face (its origin) lies a plate's thickness out from the brick's side.
  const cz = side > 0 ? z + 1 + PLATE_H : z - PLATE_H;
  b.exact(TRI_TOOTH, [x + 1, y * PLATE_H + 0.7, cz], toothTurn(side, up), WHITE);
  // A tile in the jaw's colour over the plate's studs: the side reads smooth, with the teeth below it.
  if (DINO_TUNING.coverTiles) b.exact(COVER_TILE, [x + 1, y * PLATE_H + 0.7, cz + side * PLATE_H], toothTurn(side, up), color);
  return true;
}

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
  /** More height bands in the same column (a statue's jaw under its head), filled in the same bonded core. */
  more?: { y0: number; y1: number }[];
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
    return !!c && z >= c.z0 && z < c.z1 && ((y >= c.y0 && y < c.y1) || !!c.more?.some((m) => y >= m.y0 && y < m.y1));
  };
  const yMin = Math.min(...cols.flatMap((c) => [c.y0, ...(c.more ?? []).map((m) => m.y0)]));
  const yMax = Math.max(...cols.flatMap((c) => [c.y1, ...(c.more ?? []).map((m) => m.y1)]));
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
function roundTop(b: Builder, x0: number, cols: Col[], colorOf: number | ((x: number) => number), flat = false, spine?: number) {
  const same = (p: Col, q: Col) => p.z0 === q.z0 && p.z1 === q.z1 && p.y1 === q.y1;
  for (let i = 0; i < cols.length; ) {
    let n = 1;
    const tone = (j: number) => (typeof colorOf === "number" ? colorOf : colorOf(x0 + j));
    while (i + n < cols.length && same(cols[i], cols[i + n]) && tone(i + n) === tone(i)) n++;
    const c = cols[i], x = x0 + i, y = c.y1;
    const color = typeof colorOf === "number" ? colorOf : colorOf(x);
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
 * Round the ends of a body along its length: a 1×1 cheese slope on each stud
 * of the first and last columns' tops (between the side edges roundTop
 * curves), facing out of the ends, so the body doesn't end in a square box
 * (a head's crown and snout, seen from the side). Run before roundTop, which
 * then fills only the rest.
 */
function roundEnds(b: Builder, x0: number, cols: Col[], color: (x: number) => number, ends: { back?: boolean; front?: boolean } = { back: true, front: true }) {
  if (DINO_TUNING.ends !== "cheese") return;
  const at = (i: number, rot: Rot) => {
    const c = cols[i], w = c.z1 - c.z0;
    const edge = w >= 3 ? 2 : 0; // roundTop's curved edges
    for (let z = c.z0 + edge; z < c.z1 - edge; z++) b.put(CHEESE_1x1, x0 + i, c.y1, z, rot, color(x0 + i));
  };
  if (ends.front) at(cols.length - 1, 3); // slope toward +x
  if (ends.back) at(0, 1); // toward −x
}

/**
 * Round the underside of a body: inverted slopes along both side edges of the
 * bottom course (the overhang outward), so a belly or a tail curves in toward
 * its middle instead of ending in a flat, square bottom. Placed before the
 * core fills in; cells already taken (a hip joint) are left as they are.
 */
const INV_45 = "3665a"; // Slope Brick 45 2×1 Inverted: overhang toward +z at rot 0
function roundBottom(b: Builder, x0: number, cols: Col[], color: (x: number) => number) {
  if (DINO_TUNING.belly !== "inverted") return;
  cols.forEach((c, i) => {
    const w = c.z1 - c.z0;
    if (w < 4 || c.y1 - c.y0 < 5) return; // narrow or thin parts stay square
    const x = x0 + i;
    b.put(INV_45, x, c.y0, c.z0, 2, color(x));
    b.put(INV_45, x, c.y0, c.z1 - 2, 0, color(x));
  });
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
  /** stride: the feet this many studs ahead (one leg) and behind (the other) of the hips, walking. */
  hind: { thigh: [number, number]; shin: [number, number]; foot: number; claws: boolean; stride?: number };
  fore?: { thigh: [number, number]; shin: [number, number]; foot: number; claws: boolean; stride?: number };
  arms?: { len: number; reach: number };
  /** joint: the knees in the joints' colour (31058's grey hinges); main if absent. */
  colors: { main: number[]; belly: number[]; accent: number[]; joint?: number };
  features: Feature[];
}

export type Feature = "sail" | "crests" | "frill" | "horns" | "plates" | "spikes" | "armor" | "club" | "crestTube" | "stripe";

/** The hand-built body plans: the anchors the learning engine starts from and is measured against. */
export const PLANS: Record<Species, Plan> = {
  rex: {
    title: "T. rex",
    biped: true,
    // 31058 Mighty Dinosaurs (booklets/rex/31058-1.jpg, docs/engine/dna-31058.md): a
    // 4-wide, 12-plate-tall level body; head ≈ 0.9 × torso, tail ≈ 1.8 × torso
    // curling up 10°/30°/60°, the neck rising 30°+ so the snout is over the shoulders.
    torso: { L: 8, hw: 2, H: 10, pitch: 4 },
    head: { L: 9, hw: 2, H: 6, snout: 3, bend: 25, jawOpen: 45, teeth: true },
    tail: { n: 3, L: 5, hw: 2, H: 6, taper: 0.66, bend: [8, 14, 20] },
    // A big green thigh, a thin grey shin (31058's hinge-and-Technic legs).
    hind: { thigh: [4, 11], shin: [1, 11], foot: 4, claws: true, stride: 3 },
    arms: { len: 5, reach: 40 },
    // 31058's colours, always: Green over Tan, the head green all over.
    colors: { main: [2], belly: [19], accent: [2], joint: DBG },
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
  joint: number;
}

export interface DinoDesign {
  root: Builder;
  sections: Builder[];
  title: string;
  rule: string;
}

/**
 * Build one dinosaur. `size` 0–7 scales lengths (×0.72 … ×5.4; from size 4 a statue), `detail`
 * 0–2 adds finishing (teeth, claws, features at 1; spikes, armour and back
 * stripes at 2; easy builds have one tail section fewer).
 */
export function dinosaur(species: Species, pool: Pool, size: number, detail: number, r: () => number, learned?: Plan): DinoDesign {
  const plan = learned ?? PLANS[species];
  // Sizes 3–4 are the Expert and Master scales (more sections' worth of bricks, same plan).
  const k = [0.72, 1, 1.4, 1.9, 2.5, 3.3, 4.3, 5.4][Math.max(0, Math.min(7, size))] * (0.94 + r() * 0.12);
  // The species' signature colour more often than not, else one of the others.
  const pick = (xs: number[]) => (r() < 0.55 ? xs[0] : xs[1 + Math.floor(r() * (xs.length - 1))] ?? xs[0]);
  const main = pick(plan.colors.main);
  const pal: Palette = { main, belly: pick(plan.colors.belly), accent: pick(plan.colors.accent), joint: plan.colors.joint ?? main };
  // Master scale: one statue on the grid (joints can't carry a model this big, see statue()).
  if (size >= 4 && DINO_TUNING.statue) return statue(plan, pool, k, pal, detail);
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
  // Widths scale a little slower than lengths (k^0.9), so a big model is a
  // bigger animal, not a longer one: before, widths were capped or fixed, and
  // at ×2.5 the body came out a plank on stilts.
  const W = (v: number, min = 1) => Math.max(min, Math.round(v * Math.pow(k, 0.9)));
  const rig = new Rig(pool);
  const has = (f: Feature) => plan.features.includes(f) && detail >= (f === "spikes" || f === "armor" || f === "stripe" ? 2 : 1);
  // Bodies that carry something on their back keep a studded spine.
  const torsoSpine = has("sail") || has("plates") || has("armor") ? pal.main : has("stripe") ? pal.accent : undefined;
  const headSpine = has("crests") || has("frill") || has("horns") || has("crestTube") ? pal.main : undefined;

  // ---- torso: its pose comes from the hind legs (hip height from leg lengths).
  // Torso at least 4 wide (hip balls and the tail ball need their own columns),
  // and long enough on four legs for the front and back feet to stand apart.
  const T = { L: S(plan.torso.L, plan.fore ? 8 : 4), hw: W(plan.torso.hw, 2), H: S(plan.torso.H, plan.arms ? 8 : 5) };
  const shoulderC = T.L - 2; // fore legs / arms near the front (ball plate on columns L−3, L−2)
  const hipLocal = jointPlate("+z", T.hw - 1, 1, hipC).centre;

  const legLen = (p: [number, number]) => S(p[1], 4) * PLATE_H; // joint-to-joint, world units
  const hindL = [legLen(plan.hind.thigh), legLen(plan.hind.shin)];
  const ANKLE_LAYER = 4; // socket on the foot: plate + brick up
  const ankleY = ANKLE_LAYER * PLATE_H + 0.2;
  // Legs at 94 % of full stretch: knee bent forward, but the joints carry the
  // body with a short lever (a deeper crouch overloads a 1×2 ball plate).
  // Straighter on a big model: the knee's lever (and torque) grows with the bend.
  const STRETCH = k >= 1.7 ? 0.985 : 0.94;
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
  let headBall2: Ball | undefined, tailBall2: Ball | undefined;
  // The tail's root too (its section is turned half round, so its sockets mirror across z).
  const pairedTail = T.hw >= 3 && W(plan.tail.hw) >= 3 && DINO_TUNING.pairedJoints;
  // A heavy head on a wide body gets a double joint (needs 6 studs across on both).
  const pairedHead = !plan.neck && T.hw >= 3 && W(plan.head.hw, plan.head.hw) >= 3 && DINO_TUNING.pairedJoints;
  torso.module("Body", () => {
    hipR = rig.ball(torso, "+z", T.hw - 1, 1, hipC);
    hipL = rig.ball(torso, "-z", -T.hw, 1, hipC);
    // Tail joint set into the body: sections meet face to face, no gap.
    // At least two layers of the end column above it, to bridge over the joint.
    const tl = jointLayer(tCols[0].y1, 0);
    if (pairedTail) {
      tailBall = rig.ball(torso, "-x", 1, tl, -2);
      tailBall2 = rig.ball(torso, "-x", 1, tl, 2);
      torso.block(0, tl, -3, 1, 1, 2);
      torso.block(0, tl, 1, 1, 1, 2);
    } else {
      tailBall = rig.ball(torso, "-x", 1, tl, 0);
      torso.block(0, tl, -1, 1, 1, 2);
    }
    // Neck (or head) joint also set into the chest, under the plates above it.
    const hl = jointLayer(tCols[T.L - 1].y1, 1);
    if (pairedHead) {
      // Two ball plates side by side on the rotation axis (z): they turn as one and share the head's torque.
      headBall = rig.ball(torso, "+x", T.L - 2, hl, -2);
      headBall2 = rig.ball(torso, "+x", T.L - 2, hl, 2);
      torso.block(T.L - 1, hl, -3, 1, 1, 2);
      torso.block(T.L - 1, hl, 1, 1, 1, 2);
    } else {
      headBall = rig.ball(torso, "+x", T.L - 2, hl, 0);
      torso.block(T.L - 1, hl, -1, 1, 1, 2);
    }
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
    roundBottom(torso, 0, tCols, () => pal.belly);
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
    const hw0 = W(plan.tail.hw * f), hw1 = W(plan.tail.hw * f * plan.tail.taper);
    const H0 = Math.max(3, Math.round(S(plan.tail.H) * f)), H1 = Math.max(2, Math.round(S(plan.tail.H) * f * plan.tail.taper));
    const last = s === tn - 1;
    // The first bend is from the horizontal (the torso's own tilt taken out), the rest relative.
    const bend = (plan.tail.bend[s] ?? 0) * DEG + (s === 0 ? pitch : 0);
    const rot = chain(prevRot, rotZ(bend));
    const sockLayer = jointLayer(H0, 0, true);
    const twin = s === 0 ? tailBall2 : undefined;
    const seg = rig.attach(prevBall, rot, "Tail", "-x", 0, sockLayer, twin ? 2 : 0);
    if (twin) seg.module("Tail", () => rig.socket(seg, twin, "-x", 0, sockLayer, -2));
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
      roundBottom(seg, 0, cols, () => pal.belly);
      core(seg, 0, cols, colorBy(Math.round(H0 * 0.34)));
      // Thagomizer: spikes out and back, on the top plate (before the tiles go on).
      if (last && has("spikes"))
        for (const [x, z] of [[L - 2, -1], [L - 2, 0], [L - 4, -1], [L - 4, 0]])
          if (x >= 0) seg.exact(TOOTH_INLINE, [x + 0.5, (cols[x].y1 + 2) * PLATE_H, z + 0.5], rotY(z < 0 ? (3 * Math.PI) / 4 : Math.PI / 4), WHITE, { cell: [x, cols[x].y1 + 1, z] });
      // With spikes on top, the middle stays studded for them (on a 4-wide tail the
      // curved edges would otherwise meet in the middle and leave them nothing to stand on).
      roundTop(seg, 0, cols, pal.main, cols[0].z1 - cols[0].z0 < 3, last && has("spikes") ? pal.main : undefined);
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
      const L = S(plan.neck.L, 2), hw = W(plan.neck.hw), H = S(plan.neck.H, 3);
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
  // On a big model the head grows a little slower than the body (k^0.8): still a
  // big head, but light enough for its joints (mass grows with the cube, torque with k⁴; 0.8 keeps a T. rex's double joint within its hold).
  const SH = (v: number, min = 1) => Math.max(min, Math.round(v * (k >= 1.7 ? Math.pow(k, 0.8) : k)));
  const hL = SH(plan.head.L, 4);
  const eyeAt = Math.max(1, Math.round(hL * 0.3));
  // The snout stays in front of the eye column (the eye needs the skull's height).
  const Hd = { L: hL, hw: W(plan.head.hw, plan.head.hw), H: Math.max(4, SH(plan.head.H, 3)), snout: Math.max(1, Math.min(Math.round(plan.head.snout * k), hL - eyeAt - 1)) };
  const jawGap = plan.head.jawOpen > 0 ? 3 : 0; // upper head starts this high, over the jaw
  const hRot = chain(headRot, rotZ(plan.head.bend * DEG));
  const head = rig.attach(attachTo, hRot, "Head", "-x", 0, jawGap + 1, headBall2 ? -2 : 0);
  if (headBall2) head.module("Head", () => rig.socket(head, headBall2!, "-x", 0, jawGap + 1, 2));
  // Side profile: the crown at full height, then down to the snout in steps of a
  // plate or two (each step's edge rounded by the curved slopes on top), not one cliff.
  const snoutH = Math.max(2, Hd.H - 3);
  const hCols = columns(Hd.L, (i) => {
    const back = Hd.L - Hd.snout; // first snout column
    const t = i < back ? 0 : Hd.snout > 1 ? (i - back + 1) / Hd.snout : 1;
    const h = DINO_TUNING.profile === "slope" ? Math.round(Hd.H - (Hd.H - snoutH) * t) : i >= back ? snoutH : Hd.H;
    return { hw: Hd.hw, y0: i === 0 || !jawGap ? 0 : jawGap, y1: jawGap + h };
  });
  head.module("Head", () => {
    // Eyes at the top of the head (they fill a narrow head's width, so the
    // core under them and the plates over them hold the head together).
    const eyeX = eyeAt;
    const eyeY = jawGap + Hd.H - 3;
    if (DINO_TUNING.eye === "snot") {
      // 31058's eye: a trans-orange round plate on the side stud of a brick, under a dark brow.
      for (const side of [1, -1] as const) {
        const z = side > 0 ? Hd.hw - 1 : -Hd.hw;
        if (!head.put(SIDE_STUD, eyeX, eyeY, z, side > 0 ? 0 : 2, pal.accent)) continue;
        const at: V3 = [eyeX + 0.5, eyeY * PLATE_H + 0.7, side > 0 ? Hd.hw + PLATE_H : -Hd.hw - PLATE_H];
        head.exact(ROUND_1x1, at, side > 0 ? [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1] : [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1], TRANS_ORANGE);
      }
    } else {
      head.put(EYE, eyeX, eyeY, Hd.hw - 1, 0, pal.main);
      head.put(EYE, eyeX, eyeY, -Hd.hw, 2, pal.main);
    }
    // Cheeks: studs facing out along the side, behind and under the eye (31151's studded face).
    if (DINO_TUNING.cheeks)
      for (const side of [1, -1] as const)
        for (let x = 1; x < eyeX; x += 2) {
          const y = jawGap + 2;
          if (y + 3 <= hCols[x].y1 && !(x === eyeX)) head.put(SIDE_STUD, x, y, side > 0 ? Hd.hw - 1 : -Hd.hw, side > 0 ? 0 : 2, pal.main);
        }
    // Nostrils: two studs facing forward on the snout's front face (side-stud bricks turned to +x).
    // (6 studs across at least: on a 4-wide snout the two bricks cut its tip column off.)
    if (DINO_TUNING.nostrils && Hd.hw >= 3 && jawGap) { // (a beaked head without a jaw keeps its plain front)
      const tip = Hd.L - 1, ny = hCols[tip].y1 - 3;
      if (ny >= jawGap) for (const z of [-1, 0]) head.put(SIDE_STUD, tip, ny, z, 3, pal.main);
    }
    // Rails need a head at least 4 studs wide (a 2-wide head is all rail and falls apart); narrower ones keep single teeth.
    const rails = DINO_TUNING.teeth === "rail" && Hd.hw >= 2;
    if (jawGap && plan.head.teeth && detail >= 1 && !rails)
      for (let x = 2; x < Hd.L; x++)
        for (const [z, dir] of [[Hd.hw - 1, "+z"], [-Hd.hw, "-z"]] as const) {
          // Every other stud, both at the tip; none under an eye or just in front of it.
          if ((x % 2 && x < Hd.L - 1) || x === eyeX || x === eyeX + 1) continue;
          head.exact(TOOTH_DOWN, [x + 0.5, (jawGap + 1) * PLATE_H, z + 0.5], TURN[dir], WHITE, { cell: [x, jawGap, z] });
        }
    if (jawGap && plan.head.teeth && detail >= 1 && rails)
      // Upper teeth: rails along the bottom course of both sides, wherever the
      // head is a whole brick deep there and no eye sits in the way.
      for (let x = 1; x + 2 <= Hd.L; x += 2) {
        const deep = (i: number) => hCols[i].y1 - jawGap >= 2;
        const eye = (i: number) => i === eyeX && eyeY < jawGap + 3;
        if (!deep(x) || !deep(x + 1) || eye(x) || eye(x + 1)) continue;
        // A plate lower than the head's bottom course, so the teeth hang clear of the jaw line.
        toothRail(head, x, jawGap - 1, Hd.hw - 1, 1, false, pal.main);
        toothRail(head, x, jawGap - 1, -Hd.hw, -1, false, pal.main);
      }
    if (jawGap) {
      const jaw = rig.ball(head, "+x", 0, 0, 0);
      const jRot = chain(hRot, rotZ(-plan.head.jawOpen * DEG));
      const JL = Hd.L - 2;
      const j = rig.attach(jaw, jRot, "Jaw", "-x", 0, 0, 0);
      j.module("Jaw", () => {
        // A brick deep with teeth (the rails need a whole course), two plates without.
        const toothed = plan.head.teeth && detail >= 1 && rails;
        // Deeper with the head (a fixed 3 plates turns into a stick on a big model).
        const JH = Math.max(toothed ? 3 : 2, Math.round(Hd.H * 0.45));
        const jc = columns(JL, () => ({ hw: Hd.hw, y0: 0, y1: JH }));
        if (toothed)
          for (let x = 1; x + 2 <= JL; x += 2) {
            toothRail(j, x, 0, Hd.hw - 1, 1, true, pal.belly);
            toothRail(j, x, 0, -Hd.hw, -1, true, pal.belly);
          }
        core(j, 0, jc, (_x, y) => (y >= 1 ? pal.belly : pal.main));
        roundEnds(j, 0, jc, () => pal.belly, { front: true }); // a rounded chin, not a cut-off slab
        // The tongue: dark red tiles down the middle, the jaw's edges tiled in its own colour.
        if (Hd.hw >= 2) j.rect("tile", 1, -1, JL - 1, 2, JH, DARK_RED); // 31058's dark red mouth, with teeth or without
        j.rect("tile", 0, -Hd.hw, JL, Hd.hw * 2, JH, pal.belly);
      });
      // Nothing of the head under the jaw line in front of the joint.
      head.block(1, 0, -Hd.hw, Hd.L - 1, jawGap, Hd.hw * 2);
    }
    core(head, 0, hCols, (x, y) => (y < jawGap + 1 && x > 0 ? pal.belly : pal.main));
    // The skull behind the snout in the darker accent (31058's dark green brow and crown).
    const crown = (x: number) => (DINO_TUNING.brow && headSpine === undefined && x < Hd.L - Hd.snout ? pal.accent : pal.main);
    if (headSpine === undefined) roundEnds(head, 0, hCols, crown);
    roundTop(head, 0, hCols, crown, Hd.hw * 2 < 3, headSpine);
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
  const thick = (v: number) => Math.max(2, Math.round(v * Math.pow(S(10, 1) / 10, 0.85)));
  const ta = thick(spec.thigh[0]), sa = thick(spec.shin[0]);
  const tLen = S(spec.thigh[1], 4), sLen = S(spec.shin[1], 4);
  const l1 = tLen * PLATE_H, l2 = sLen * PLATE_H;
  const out: Dir = side > 0 ? "+z" : "-z", inn: Dir = side > 0 ? "-z" : "+z";
  const tc = Math.max(1, Math.round(ta / 2)), sc = Math.max(1, Math.round(sa / 2));
  // Thigh: inner column z = 0 (right) / −1 (left), 2 wide; shin inboard of it, 2 wide.
  // Widths across (z) grow with size too. Joints stay on the inner columns
  // (thigh) and the column next to the knee (shin), so the joint layout holds.
  const wide = (v: number) => Math.min(4, Math.max(2, Math.round(v * Math.pow(S(10, 1) / 10, 0.9))));
  const tz = side > 0 ? 0 : -1, tW = wide(2);
  const tZ0 = side > 0 ? 0 : -tW;
  const sW = wide(1.6), sz = side > 0 ? sW - 1 : -sW, sZ0 = side > 0 ? 0 : -sW;

  // Foot on the baseplate: its socket under the hip, slightly behind.
  const footZ = side > 0 ? hw + 1 : -hw - 2; // foot's inner column
  const fW = wide(2.2);
  // Walking (31058's stride) at sizes S and M only: from L up the stride levers the hip joint past its hold (stress 1.12).
  const stride = S(10, 1) / 10 < 1.2 ? S(spec.stride ?? 0, 0) : 0;
  const xa = Math.round(hip.world[0] - 0.4 + side * stride);
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
    // The thigh's top shows beside the hip: tiled, not left studded.
    thigh.rect("tile", 0, tZ0, ta, tW, tLen + 3, pal.main);
  });
  // Shin: socket at the top on its outer column, ankle ball at the bottom, outer column.
  const shin = rig.attach(kneeBall, rotZ(phi2), name, out, sz, sLen + 1, sc);
  let ankle!: Ball;
  shin.module(name, () => {
    ankle = rig.ball(shin, out, sz, 1, sc);
    const cols: Col[] = Array.from({ length: sa }, () => ({ z0: sZ0, z1: sZ0 + sW, y0: 0, y1: sLen + 3 }));
    // Green, with the knee end in the joints' colour (31058: small grey joints, not grey stilts).
    core(shin, 0, cols, (_x, y) => (y >= sLen - 1 ? pal.joint : pal.main));
    shin.rect("tile", 0, sZ0, sa, sW, sLen + 3, pal.joint); // the knee's top, tiled
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
    if (spec.claws && detail >= 1 && DINO_TUNING.claws === "curved") {
      // 31058 / 31151 toes: a big curved claw per toe, its bar in the open stud
      // of a round plate on the front face of a side-stud brick (up to three toes).
      const xT = xa + fL - 1;
      const toes = Math.min(3, fW);
      for (let i = 0; i < toes; i++) {
        const z = fz0 + Math.round((i * (fW - 1)) / Math.max(1, toes - 1));
        if (!f.put(SIDE_STUD, xT, 1, z, 3, pal.main)) continue;
        f.exact(OPEN_ROUND, [xT + 1 + PLATE_H, PLATE_H + 0.7, z + 0.5], rotZ(-Math.PI / 2), BLACK);
        f.exact(CLAW, [xT + 1 + PLATE_H, PLATE_H + 0.7, z + 0.5], rotZ(-Math.PI / 2), BLACK);
      }
      if (fL > 2) f.rect("tile", xa + 1, fz0, fL - 2, fW, 1, pal.main);
    } else if (spec.claws && detail >= 1) {
      // A 1×2 claw plate per two columns of toes (one more on a wide foot).
      for (let z = fz0; z + 2 <= fz0 + fW; z += 2)
        f.exact(CLAWS, [xa + fL - 0.5, 2 * PLATE_H, z + 1], TURN["+x"], BLACK, { cell: [xa + fL - 1, 1, z], fp: { w: 1, d: 2, h: 1, studs: true } });
    } else f.rect("tile", xa + 1, fz0, fL - 1, fW, 1, DBG);
  });
}


// ------------------------------------------------------------------- statues
//
// Large dinosaurs (Master scale: from ×2.5 up, about 1,000 to 5,000 pieces)
// as one statue on the baseplate's grid, the way big brick-built sculptures
// are made. Posable sections can't scale: a friction ball joint holds the same
// torque at any size while the load grows with the fourth power of the scale
// (mass k³ × lever k), so at ×2.5 the head's joint was 6× over and at ×4.3 it
// would be 60× over. Here nothing hinges:
//
//   • the tail, torso, neck and head are one run of stud columns along x
//     (tail tip at x = 0, snout last), each with its own height band, filled
//     by one bonded core so the running bond ties every section to the next;
//   • curves are steps: a section bent by θ moves its band 2.5·tan θ plates per
//     stud (a stud is 2.5 plates wide), the tail rising, the head tilting down;
//   • the jaw opens the same way, its columns dropping in pairs (pairs so the
//     1×2 tooth rails sit level);
//   • legs are bonded columns under the hips, overlapping the body's bottom
//     edge so its bricks stand on their studs, on clawed feet on the baseplate.
// Everything stands on studs, so the stability check sees clutch, not joints.

interface Band extends Col {
  belly: number; // layers below this are the belly colour
}

function statue(plan: Plan, pool: Pool, k: number, pal: Palette, detail: number): DinoDesign {
  const S = (v: number, min = 1) => Math.max(min, Math.round(v * k));
  const W = (v: number, min = 1) => Math.max(min, Math.round(v * Math.pow(k, 0.9)));
  const has = (f: Feature) => plan.features.includes(f) && detail >= (f === "spikes" || f === "armor" || f === "stripe" ? 2 : 1);
  const b = new Builder(pool, undefined, "t");
  const PER_STUD = 1 / PLATE_H; // plates per stud of run
  const slope = (deg: number) => Math.tan(deg * DEG) * PER_STUD;

  // ---- legs first: they set the hip height.
  const hind = plan.hind;
  const tLen = S(hind.thigh[1], 4), sLen = S(hind.shin[1], 4);
  const FOOT = 2; // foot plate + toe course height
  const hipY = FOOT + Math.round(0.9 * (tLen + sLen));

  // ---- the run of columns.
  const T = { L: S(plan.torso.L, plan.fore ? 8 : 4), hw: W(plan.torso.hw, 2), H: S(plan.torso.H, 5) };
  const tn = Math.max(2, plan.tail.n);
  const tails = Array.from({ length: tn }, (_, s) => {
    const f = Math.pow(plan.tail.taper, s);
    return {
      L: S(plan.tail.L * (s === tn - 1 ? 1.1 : 1), 3),
      hw0: W(plan.tail.hw * f), hw1: W(plan.tail.hw * f * plan.tail.taper),
      H0: Math.max(3, Math.round(S(plan.tail.H) * f)), H1: Math.max(2, Math.round(S(plan.tail.H) * f * plan.tail.taper)),
      bend: plan.tail.bend[s] ?? 0,
    };
  });
  const tailLen = tails.reduce((a, t) => a + t.L, 0);
  const torsoY0 = hipY - Math.round(T.H * 0.3); // the hips in the lower third of the body
  const bands: Band[] = [];
  // Tail, built from the torso outward, then reversed (tip first on the run).
  {
    let yc = torsoY0 + T.H * 0.62, ang = 0;
    const rev: Band[] = [];
    tails.forEach((t, s) => {
      ang += t.bend;
      for (let i = 0; i < t.L; i++) {
        const u = t.L > 1 ? i / (t.L - 1) : 0;
        const last = s === tn - 1;
        const hw = Math.max(1, Math.round(lerp(t.hw0, last && u > 0.7 ? Math.max(1, t.hw1 - 1) : t.hw1, u)));
        const H = Math.max(2, Math.round(lerp(t.H0, last ? Math.max(2, t.H1 - 1) : t.H1, u)));
        yc += slope(ang);
        const y0 = Math.round(yc - H / 2);
        rev.push({ z0: -hw, z1: hw, y0, y1: y0 + H, belly: y0 + Math.round(H * 0.34) });
      }
    });
    bands.push(...rev.reverse());
  }
  const xTorso = tailLen;
  for (let i = 0; i < T.L; i++) {
    const t = T.L > 1 ? i / (T.L - 1) : 0;
    const h = Math.round(T.H * (0.72 + 0.28 * Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.1))));
    const hw = i === 0 || i === T.L - 1 ? Math.max(1, T.hw - 1) : T.hw;
    bands.push({ z0: -hw, z1: hw, y0: torsoY0, y1: torsoY0 + h, belly: torsoY0 + Math.round(T.H * 0.34) });
  }
  // Neck: rising (or falling) by its bend.
  let front = bands[bands.length - 1];
  let neckTop = front.y1;
  if (plan.neck) {
    const L = S(plan.neck.L, 2) * plan.neck.n, hw = W(plan.neck.hw), H = S(plan.neck.H, 3);
    let yc = front.y1 - H / 2;
    for (let i = 0; i < L; i++) {
      // Steeper than the posed neck: up through the bricks' compression, not out as a cantilever.
      // A long sauropod neck goes steeper than the posed one (up through the bricks'
      // compression, not out as a cantilever); a short neck keeps its angle.
      const steep = plan.neck.n >= 2 ? Math.min(70, plan.neck.bend * 2) : plan.neck.bend;
      yc += slope(steep * (i < L / plan.neck.n ? 1 : 0.8));
      const y0 = Math.round(yc - H / 2);
      bands.push({ z0: -hw, z1: hw, y0, y1: y0 + H, belly: y0 + 2 });
    }
    front = bands[bands.length - 1];
    neckTop = front.y1;
  }
  // Head: the jaw line a couple of plates under the top of what it joins, tilting by its bend.
  const hL = S(plan.head.L, 4), hhw = W(plan.head.hw, plan.head.hw), hH = Math.max(4, S(plan.head.H, 3));
  const snout = Math.max(1, Math.min(Math.round(plan.head.snout * k), hL - 2));
  const toothed = plan.head.teeth && detail >= 1 && hhw >= 2 && DINO_TUNING.teeth === "rail";
  const open = plan.head.jawOpen > 0;
  // The jaw's slope: the head's tilt plus its opening, in plates per stud of run.
  // Consecutive columns must share at least 2 plates to bond, so a steep jaw is
  // made deeper; it drops in pairs of columns (level pairs for the tooth rails)
  // when a pair's drop still leaves that overlap.
  // (A statue's jaw is a solid wedge of columns: at the posed angle it reaches
  // the ground, so it opens about half as far, plus half the head's tilt.)
  const jawStep = Math.max(0, slope(plan.head.jawOpen * 0.55 - plan.head.bend * 0.5));
  const JH = Math.max(toothed ? 3 : 2, Math.round(hH * 0.45), Math.ceil(jawStep) + 2);
  const paired = 2 * jawStep <= JH - 2;
  const jawLine0 = neckTop - Math.round(hH * 0.55);
  const xHead = bands.length;
  const headBands: Band[] = [];
  const jawBands: Col[] = [];
  const snoutH = Math.max(2, hH - 3);
  for (let i = 0; i < hL; i++) {
    const tilt = Math.round(slope(plan.head.bend) * i);
    const jl = jawLine0 + tilt + (open ? JH : 0); // upper head sits over the jaw when it's open
    const back = hL - snout;
    const t = i < back ? 0 : (i - back + 1) / snout;
    const h = Math.round(hH - (hH - snoutH) * t);
    headBands.push({ z0: -hhw, z1: hhw, y0: jl, y1: jl + h, belly: jl + 1 });
    if (open && i < hL - 1) {
      // The jaw drops forward from the hinge at the back.
      const drop = Math.round(jawStep * (paired ? Math.floor(i / 2) * 2 : i));
      // A plate under the head's bottom, so the jaw hangs from its hinge column, not from the tooth rails.
      const top = jawLine0 + JH - drop - (i > 0 ? 1 : 0);
      jawBands.push({ z0: -hhw, z1: hhw, y0: top - JH, y1: top });
    }
  }
  // The hinge: the head's back column reaches down over the jaw's, so they're one piece.
  if (open) headBands[0] = { ...headBands[0], y0: jawBands[0].y0 };
  bands.push(...headBands);

  // Where the legs stand under the body (set here: the body is built flat above them).
  const hipX = xTorso + Math.max(2, Math.round(T.L * 0.3));
  const shX = xTorso + T.L - Math.max(2, Math.round(T.L * 0.2));
  // A statue's legs carry everything: thighs as deep as a third of the torso,
  // shins two-thirds of that, both wider than the posed legs' joints allowed.
  const ta = Math.max(4, Math.round(Math.max(hind.thigh[0] * Math.pow(k, 0.85), T.L * 0.34)));
  const color = (x: number, y: number) => {
    const c = bands[x];
    return c && y < c.belly ? pal.belly : pal.main;
  };

  b.module("Body", () => {
    // ---- head details first (they take their cells before the core).
    const hx = (i: number) => xHead + i;
    const eyeAt = Math.max(1, Math.round(hL * 0.3));
    const eyeY = headBands[eyeAt].y1 - 3;
    for (const side of [1, -1] as const) {
      const z = side > 0 ? hhw - 1 : -hhw;
      if (!b.put(SIDE_STUD, hx(eyeAt), eyeY, z, side > 0 ? 0 : 2, pal.accent)) continue;
      b.exact(ROUND_1x1, [hx(eyeAt) + 0.5, eyeY * PLATE_H + 0.7, side > 0 ? hhw + PLATE_H : -hhw - PLATE_H], side > 0 ? [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1] : [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1], TRANS_ORANGE);
    }
    if (open && hhw >= 2) {
      const tip = hL - 1, ny = headBands[tip].y1 - 3;
      if (ny >= headBands[tip].y0) for (const z of [-1, 0]) b.put(SIDE_STUD, hx(tip), ny, z, 3, pal.main);
    }
    if (open && toothed)
      for (let i = 1; i + 2 <= hL; i += 2) {
        const y = headBands[i].y0; // inside the head's bottom course (hanging below, one stud held the jaw's load)
        if (headBands[i + 1].y0 !== y) continue; // rails need a level pair
        toothRail(b, hx(i), y, hhw - 1, 1, false, pal.main);
        toothRail(b, hx(i), y, -hhw, -1, false, pal.main);
      }
    if (open && toothed)
      for (let i = 1; i + 2 <= jawBands.length; i += 2) {
        if (jawBands[i].y0 !== jawBands[i + 1]?.y0) continue;
        toothRail(b, hx(i), jawBands[i].y0, hhw - 1, 1, true, pal.belly);
        toothRail(b, hx(i), jawBands[i].y0, -hhw, -1, true, pal.belly);
      }
    // Flat underneath where the legs carry the body (an inverted slope has no bottom to stand on).
    const flat = new Set<number>();
    for (const x of plan.fore ? [hipX, shX] : [hipX]) for (let i = -Math.ceil(ta / 2) - 1; i <= Math.ceil(ta / 2) + 1; i++) flat.add(x + i);
    roundBottom(b, 0, bands.slice(0, xHead).map((c, x) => (flat.has(x) ? { ...c, z0: 0, z1: 0 } : c)), () => pal.belly);
    roundEnds(b, xHead, headBands, (x) => (x - xHead < hL - snout ? pal.accent : pal.main), { front: true });
    // One bonded core for the whole run, the jaw included (its bands under the head's).
    const run = bands.map((c, x) => {
      const j = x >= xHead ? jawBands[x - xHead] : undefined;
      if (!j) return c;
      // Under the head: a band of its own; touching or overlapping it: one band from the jaw's bottom up.
      return j.y1 < c.y0 ? { ...c, more: [{ y0: j.y0, y1: j.y1 }] } : { ...c, y0: Math.min(c.y0, j.y0) };
    });
    const jawColor = (x: number, y: number) => {
      const j = x >= xHead ? jawBands[x - xHead] : undefined;
      return j && y < j.y1 && y >= j.y0 && y < bands[x].y0 ? pal.belly : color(x, y);
    };
    // Ties across the seams where one section's band meets the next (tail → torso,
    // torso → neck → head): 2×4 plates laid 4 along the run, every third plate up
    // the overlap, before the core fills in. The fill alone can close a layer with
    // parts reaching back from the seam, never over it, and leave a head loose.
    const seams = [xTorso, xTorso + T.L, xHead].filter((x, i, a) => x > 1 && x < run.length - 1 && a.indexOf(x) === i);
    const tie = plain("plate", 4, 2)!;
    for (const x of seams) {
      const p = run[x - 1], q = run[x];
      const lo = Math.max(p.y0, q.y0), hi = Math.min(p.y1, q.y1);
      const zw = Math.min(p.z1 - p.z0, q.z1 - q.z0);
      if (hi - lo < 1 || zw < 2) continue;
      for (let y = lo + (hi - lo > 3 ? 1 : 0); y < hi; y += 3) b.put(tie.id, x - 2, y, -1, tie.rot, jawColor(x, y));
    }
    // The jaw's steps too: wherever it drops, a tie across the four columns around the step.
    if (open)
      for (let i = 1; i < jawBands.length; i++) {
        if (jawBands[i].y0 === jawBands[i - 1].y0) continue;
        // Four columns around a gentle step; just the two either side of a steep one
        // (a 4-long plate can't stay inside a jaw that drops a lot per column).
        const wide = jawBands[i - 1].y0 - jawBands[i].y0 <= 2;
        const from = Math.max(0, i - (wide ? 2 : 1)), to = Math.min(jawBands.length - 1, i + (wide ? 1 : 0)), n = to - from + 1;
        const t = plain("plate", n, 2);
        if (!t || n < 2) continue;
        const span = jawBands.slice(from, to + 1);
        const lo = Math.max(...span.map((c) => c.y0)), hi = Math.min(...span.map((c) => c.y1));
        for (let y = lo; y < hi; y += wide ? 3 : 2) b.put(t.id, xHead + from, y, -1, t.rot, pal.belly);
      }
    core(b, 0, run, jawColor);
    // Crown in the accent, back and tail with their rounded tops (a studded spine for features).
    const spine = has("sail") || has("plates") || has("armor") ? pal.main : undefined;
    roundTop(b, 0, bands.slice(0, xHead), pal.main, false, spine);
    const crest = has("frill") || has("horns") || has("crests") ? pal.main : undefined; // studs left for them to stand on
    roundTop(b, xHead, headBands, (x) => (x - xHead < hL - snout ? pal.accent : pal.main), hhw * 2 < 3, crest);
  });

  if (open)
    b.module("Jaw", () => {
      const x0 = xHead;
      // Tongue down the middle, the rest tiled.
      jawBands.forEach((c, i) => {
        if (hhw >= 2 && i > 0) b.rect("tile", x0 + i, -1, 1, 2, c.y1, DARK_RED);
        b.rect("tile", x0 + i, c.z0, 1, c.z1 - c.z0, c.y1, pal.belly);
      });
    });

  // ---- legs: thigh and shin as bonded columns under the hips, the thigh
  // overlapping the body's edge column so the body stands on it.

  const tW = Math.min(8, Math.max(3, Math.round(T.hw * 0.75)));
  const sa = Math.max(3, Math.round(Math.max(hind.shin[0] * Math.pow(k, 0.85), ta * 0.6)));
  const legAt = (x: number, side: 1 | -1, name: string, spec: Plan["hind"]) =>
    b.module(name, () => {
      // The thigh reaches three columns in under the body (the body above it is
      // flat bricks, see hipFlat), so the body stands on many studs, not two.
      // (Never past the middle: a narrow body's two thighs would collide.)
      const zIn = side > 0 ? Math.max(0, T.hw - 3) : Math.min(-tW, -T.hw - tW + 3);
      const kneeY = FOOT + Math.round(0.9 * S(spec.shin[1], 4));
      const top = torsoY0 + Math.round(T.H * 0.45);
      // Thigh: in front of and behind the hip, tapering to the knee.
      const tcols = Array.from({ length: ta }, (_, i) => ({ z0: zIn, z1: zIn + tW, y0: i === 0 || i === ta - 1 ? kneeY + 3 : kneeY, y1: top }));
      core(b, x - Math.floor(ta / 2), tcols, () => pal.main);
      // Where the thigh shows beside the body, its top is rounded like a muscle (the rest is under the body, taken).
      roundTop(b, x - Math.floor(ta / 2), tcols, pal.main);
      // Shin: a step behind the knee, down to the foot.
      const sx = x - Math.floor(sa / 2) - 1;
      const sW = Math.max(2, Math.min(tW, Math.round(tW * 0.7)));
      const sZ = side > 0 ? zIn + tW - sW : zIn; // the shin under the thigh's outer side
      core(b, sx, Array.from({ length: sa }, () => ({ z0: sZ, z1: sZ + sW, y0: FOOT, y1: kneeY + 3 })), () => pal.main);
      // Foot: plates on the baseplate under the shin, reaching forward, with a claw per toe.
      // Feet grow slower than the body (k^0.7): at full scale they turned into planks.
      const fL = Math.max(3, Math.round(spec.foot * Math.pow(k, 0.7))), fW = Math.min(6, sW + 1);
      const fz = side > 0 ? sZ : sZ + sW - fW;
      b.rect("plate", sx - 1, fz, sa + 1 + fL, fW, 0, pal.main);
      b.rect("plate", sx - 1, fz, sa + 1, fW, 1, pal.main);
      // Toes: a brick course from the heel forward, so the foot has height, then the claws.
      b.rect("brick", sx + sa, fz, fL - 1, fW, 1, pal.main);
      const xT = sx + sa + fL - 1;
      if (spec.claws && detail >= 1)
        for (let i = 0; i < Math.min(3, fW); i++) {
          const z = fz + Math.round((i * (fW - 1)) / Math.max(1, Math.min(3, fW) - 1));
          if (!b.put(SIDE_STUD, xT, 1, z, 3, pal.main)) continue;
          b.exact(OPEN_ROUND, [xT + 1 + PLATE_H, PLATE_H + 0.7, z + 0.5], rotZ(-Math.PI / 2), BLACK);
          b.exact(CLAW, [xT + 1 + PLATE_H, PLATE_H + 0.7, z + 0.5], rotZ(-Math.PI / 2), BLACK);
        }
      b.rect("tile", sx + sa, fz, fL - 1, fW, 4, pal.main);
    });
  legAt(hipX, 1, "Right leg", hind);
  legAt(hipX, -1, "Left leg", hind);
  if (plan.fore) {
      legAt(shX, 1, "Right front leg", plan.fore);
    legAt(shX, -1, "Left front leg", plan.fore);
  }

  // ---- features on the studded spine and the head.
  const spineTop = (x: number) => bands[x].y1 + 2;
  if (has("sail"))
    b.module("Sail", () => {
      const xs = Array.from({ length: T.L - 2 }, (_, i) => xTorso + 1 + i);
      const Hs = S(10, 6);
      const sc: Col[] = xs.map((x, i) => {
        const t = (i + 0.5) / xs.length;
        return { z0: -1, z1: 1, y0: spineTop(x), y1: spineTop(x) + Math.max(2, Math.round(Hs * Math.pow(Math.sin(Math.PI * t), 0.8))) };
      });
      core(b, xs[0], sc, () => pal.accent);
      roundTop(b, xs[0], sc, pal.accent, true);
    });
  if (has("plates"))
    b.module("Back plates", () => {
      for (let i = 0; i + 1 < T.L; i += 2) {
        const x = xTorso + i, t = (i + 1) / T.L;
        const n = Math.max(0, Math.round(2.4 * Math.pow(k, 0.6) * Math.sin(Math.PI * t) - 0.3));
        const y = Math.max(spineTop(x), spineTop(x + 1));
        for (let j = 0; j < n; j++) b.put("3003", x, y + 3 * j, -1, 0, pal.accent);
        b.put(RIDGE_2x2, x, y + 3 * n, -1, 1, pal.accent);
      }
    });
  if (has("armor"))
    b.module("Armour", () => {
      for (let x = xTorso + 1; x < xTorso + T.L - 1; x++) for (const z of [-2, -1, 0, 1]) if ((x + z + 4) % 2 === 0) b.put(CONE, x, spineTop(x), z, 0, pal.accent);
    });
  const headTop = (i: number) => headBands[i].y1 + 2;
  if (has("frill"))
    b.module("Frill", () => {
      const fh = hhw + 2;
      const fc: Col[] = [0, 1].map((i) => ({ z0: -fh, z1: fh, y0: headTop(i), y1: headTop(i) + S(6, 3) }));
      core(b, xHead, fc, () => pal.accent);
      roundTop(b, xHead, fc, pal.accent);
    });
  if (has("horns"))
    b.module("Horns", () => {
      const back = hL - snout;
      for (const z of [-1, 0]) b.exact(TOOTH_INLINE, [xHead + back - 0.5, (headTop(back - 1) + 1) * PLATE_H, z + 0.5], TURN["+x"], WHITE, { cell: [xHead + back - 1, headTop(back - 1), z] });
    });

  return {
    root: b,
    sections: [],
    title: plan.title,
    rule: `statue on the grid: ${bands.length}-stud run (tail ${tailLen}, torso ${T.L}, head ${hL}), curves stepped at 2.5·tanθ plates per stud, hips at ${hipY} plates, every section bonded (no joints at this scale)`,
  };
}
