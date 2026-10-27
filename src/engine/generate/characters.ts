// Character Grammar: creatures, robots, cars, racers and dinosaurs in the style
// of LEGO Classic idea books, generated from a personality vector
// p = (cute, fierce, quirky) ∈ [0,1]³, a size k, and a difficulty level.
// Every proportion is a formula of p:
//
//   head share of height   η = lerp(1/φ², 1/φ, cute)       0.382 → 0.618 (baby schema)
//   eye line in the head   λ = lerp(0.62, 0.45, cute)      lower eyes read younger
//   eye spacing            σ = lerp(0.30, 0.62, cute) · W  wide-set = cute, close-set = fierce
//   eye size / lids        2×2 when cute > ½; half-closed when fierce > 0.6; side glance when quirky
//   teeth                  T = round(fierce · W / 2)
//   leg arch               superellipse |x/a|ⁿ + |y/b|ⁿ ≤ 1, n = lerp(5, 2.2, cute)
//   accent hue             Δh = lerp(30°, 180°, fierce) in LCh, ΔL ≥ 25
//   symmetry               mirror x → W−1−x; each feature breaks it with probability quirky
//   cars                   L = W·φ; axles at the golden sections 0.191·L and 0.809·L
//   racer                  wedge top h(x) = h₀ + Δh·(1 − smoothstep(0.55L, L, x)), spoiler at the tail
//   dinosaurs              signed distance fields: ellipsoids and round cones joined by
//                          smooth union smin(a, b, k) = min(a, b) − h²k/4, h = max(k − |a−b|, 0)/k
//
// Size: everything scales with k, chosen so the piece count lands near the target.
// Level: Easy and Medium build in brick layers; Hard in plate layers (finer
// shapes, more detail) — the solver still uses bricks wherever three layers fit.
// Forward-facing eyes use SNOT: a brick with a side stud holding an eye tile.

import { colorOf } from "../colors";
import { PARTS } from "../parts";
import { PHI, hexToLab, rng, type Lab } from "./math";
import type { Grid, Level } from "./solver";

export type Archetype = "monster" | "robot" | "car" | "racer" | "dino";

export interface Personality {
  cute: number;
  fierce: number;
  quirky: number;
}

export interface Decor {
  partId: string;
  x: number; // studs, grid frame
  y: number; // plates
  z: number;
  rot: 0 | 1 | 2 | 3;
  role?: number; // take the colour of this body role…
  color?: number; // …or a fixed LDraw colour
}

export interface Character {
  grid: Grid;
  roleColors: number[];
  decor: Decor[];
  title: string;
  math: string;
  level: Level;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const even = (v: number) => Math.max(2, 2 * Math.round(v / 2));
const ROLE = { body: 0, accent: 1, mouth: 2, detail: 3 } as const;
const fmt = (v: number) => v.toFixed(2);

// ------------------------------------------------------------- colour (LCh)

const toLCh = ([L, a, b]: Lab) => [L, Math.hypot(a, b), ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360] as const;
const fromLCh = (L: number, C: number, h: number): Lab => [L, C * Math.cos((h * Math.PI) / 180), C * Math.sin((h * Math.PI) / 180)];
const dist = (p: Lab, q: Lab) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

/**
 * Body: a lively colour (chroma ≥ 25), optionally near one of `prefer` (dinosaurs
 * lean green and brown, racers red and blue). Accent: hue rotated by Δh with
 * lightness ≥ 25 apart. Mouth: darkest warm colour. Detail: a neutral grey.
 */
function harmonise(palette: number[], p: Personality, rand: () => number, prefer?: string[], soft = false) {
  const labs = palette.map((c) => ({ c, lab: hexToLab(colorOf(c).hex) }));
  const pick = (target: Lab, avoid: number[], minDL = 0, ref?: Lab) => {
    let best = palette[0], bd = Infinity;
    for (const { c, lab } of labs) {
      if (avoid.includes(c)) continue;
      const contrast = ref ? Math.abs(lab[0] - ref[0]) : 99;
      const d = dist(lab, target) + (contrast < minDL ? 60 : 0);
      if (d < bd) [best, bd] = [c, d];
    }
    return best;
  };
  const lively = labs.filter((x) => toLCh(x.lab)[1] >= 25);
  const pool = lively.length ? lively : labs;
  let body = pool[Math.floor(rand() * pool.length)];
  if (prefer?.length) {
    const want = hexToLab(prefer[Math.floor(rand() * prefer.length)]);
    body = labs.reduce((a, b) => (dist(b.lab, want) < dist(a.lab, want) ? b : a));
  }
  const [L, C, h] = toLCh(body.lab);
  // Soft (animals): a lighter belly of nearly the same hue, as in nature; otherwise Δh from fierceness.
  const dh = soft ? 15 : lerp(30, 180, p.fierce) * (rand() < 0.5 ? 1 : -1);
  const accent = soft
    ? pick(fromLCh(Math.min(92, L + 28), C * 0.6, h + dh), [body.c], 18, body.lab)
    : pick(fromLCh(L > 55 ? L - 30 : L + 30, Math.max(C, 40), h + dh), [body.c], 25, body.lab);
  const mouth = pick([22, 25, 12], [body.c]);
  const detail = pick([62, 0, -2], [body.c, accent]);
  return [body.c, accent, mouth, detail];
}

// ------------------------------------------------------------------ toolkit

interface Box {
  x: number;
  z: number;
  y0: number; // plates, inclusive
  y1: number; // plates, exclusive
}

/** A design in physical units (x, z in studs; y in plates), before sampling to a grid. */
interface Blueprint {
  W: number;
  D: number;
  H: number; // plates
  at(x: number, y: number, z: number): number; // role, or −1
  decor: Decor[];
  reserve: Box[]; // cells the decor occupies: kept empty for the solver
  floor?: number; // plates: the body rests on decor (a chassis), not the baseplate
  title: string;
  math: string;
}

interface Ctx {
  k: number;
  lh: 1 | 3;
  rand: () => number;
  p: Personality;
  level: Level;
}

/** Snap a height to the layer grid (eye blocks are a brick tall). */
const snap = (y: number, lh: 1 | 3) => (lh === 3 ? Math.round(y / 3) * 3 : Math.round(y));

function eyePart(p: Personality, big: boolean, rand: () => number) {
  if (big) return "lb-eye-big";
  if (p.quirky > 0.65 && rand() < p.quirky) return "lb-eye-side";
  if (p.fierce > 0.6) return "lb-eye-sleepy";
  return "lb-eye";
}

/** An eye block (a brick tall) at a cell, facing `rot`, taking the body colour. */
function addEye(bp: { decor: Decor[]; reserve: Box[] }, part: string, x: number, y: number, z: number, rot: Decor["rot"]) {
  bp.decor.push({ partId: part, x, y, z, rot, role: ROLE.body });
  bp.reserve.push({ x, z, y0: y, y1: y + 3 });
}

/**
 * A hanging tooth plate. In brick layers it fills the rest of its cell with two
 * 1×1 plates in the body colour; in plate layers the solver fills above it.
 */
function addTooth(bp: { decor: Decor[]; reserve: Box[] }, x: number, y: number, z: number, rot: Decor["rot"], lh: 1 | 3) {
  bp.decor.push({ partId: "lb-tooth", x, y, z, rot });
  if (lh === 3) {
    bp.decor.push({ partId: "3024", x, y: y + 1, z, rot: 0, role: ROLE.body }, { partId: "3024", x, y: y + 2, z, rot: 0, role: ROLE.body });
    bp.reserve.push({ x, z, y0: y, y1: y + 3 });
  } else bp.reserve.push({ x, z, y0: y, y1: y + 1 });
}

/** A plate (or a row of plates) covering an x-by-z rectangle, as decor. */
function addPlates(bp: { decor: Decor[] }, x0: number, z0: number, xs: number, zs: number, y: number, role: number) {
  const lens = [12, 10, 8, 6, 4, 3, 2, 1];
  const find = (a: number, b: number) => {
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const part = Object.values(PARTS).find((p) => p.name === `Plate ${lo}×${hi}` && !p.printed);
    return part ? { id: part.id, rot: (part.w === a ? 0 : 1) as Decor["rot"] } : null;
  };
  let x = x0;
  while (x < x0 + xs) {
    const rest = x0 + xs - x;
    const len = lens.find((n) => n <= rest && find(n, zs)) ?? 1;
    const f = find(len, zs);
    if (f) bp.decor.push({ partId: f.id, x, y, z: z0, rot: f.rot, role });
    x += len;
  }
}

// --------------------------------------------------------------- archetypes

function monster({ k, lh, rand, p }: Ctx): Blueprint {
  const W = even(6 * k), D = Math.max(3, Math.round(3 * k));
  const T = 3 * Math.max(5, Math.round((6 + rand() * 2) * k));
  const eta = lerp(1 / PHI ** 2, 1 / PHI, p.cute);
  const headH = 3 * Math.max(3, Math.round((eta * T) / 3));
  const legH = T - headH;
  const arm = p.cute > 0.35 ? 1 : 0;
  const GW = W + 2 * arm, x0 = arm;
  const n = lerp(5, 2.2, p.cute);
  const legW = Math.max(1, Math.round(W * lerp(0.3, 0.22, p.cute)));
  const a = W / 2 - legW;
  const lambda = lerp(0.62, 0.45, p.cute);
  const eyeY = snap(legH + lambda * (headH - 3), lh);
  const mouthY = eyeY - 3;
  const mw = Math.max(2, Math.round(W * lerp(0.35, 0.65, p.fierce)));
  const m0 = Math.floor((W - mw) / 2);
  const sigma = lerp(0.3, 0.62, p.cute);
  const half = Math.max(1, Math.round((sigma * W) / 2));
  const ex = [Math.floor(W / 2) - half, Math.ceil(W / 2) - 1 + half].map((v) => clamp(v, 0, W - 1));
  if (ex[1] - ex[0] < 2) ex[1] = Math.min(W - 1, ex[0] + 2);

  const bp: Blueprint = {
    W: GW, D, H: T,
    at(x, y, z) {
      const bx = x - x0;
      if (bx < 0 || bx >= W) return arm && y >= legH && y < legH + 3 && z >= 1 ? ROLE.body : -1;
      if (y < legH) {
        const u = (bx - W / 2) / a, v = y / legH;
        if (Math.abs(u) ** n + Math.abs(v) ** n <= 1) return -1;
      }
      if (z >= D - 1 && y >= mouthY && y < mouthY + 3 && mouthY >= legH && bx >= m0 && bx < m0 + mw) return ROLE.mouth;
      return y >= T - 3 && p.cute < 0.5 ? ROLE.accent : ROLE.body;
    },
    decor: [],
    reserve: [],
    title: p.fierce > 0.6 ? "Grumpy Monster" : p.cute > 0.6 ? "Cuddly Monster" : "Arch Monster",
    math: `η=${fmt(headH / T)} (φ-bounded) · λ=${fmt(lambda)} · σ=${fmt(sigma)} · arch n=${fmt(n)}`,
  };
  const big = p.cute > 0.5;
  const asym = rand() < p.quirky * 0.6;
  ex.forEach((x, i) => addEye(bp, eyePart(p, asym ? i === 0 : big, rand), x0 + x, eyeY, D - 1, 0));
  if (mouthY >= legH) {
    const teeth = Math.round((p.fierce * W) / 2);
    const spots = Array.from({ length: mw }, (_, i) => m0 + i).filter((x) => !ex.includes(x));
    const step = spots.length / Math.max(teeth, 1);
    for (let t = 0; t < teeth && t < spots.length; t++) addTooth(bp, x0 + spots[Math.min(spots.length - 1, Math.floor(t * step + step / 2))], eyeY, D - 1, 0, lh);
  }
  const crooked = rand() < p.quirky * 0.5;
  [0, 1].forEach((i) => {
    if (p.fierce > 0.45) {
      if (!(crooked && i === 1)) bp.decor.push({ partId: "4589", x: i ? x0 + W - 1 : x0, y: T, z: 1, rot: 0, role: ROLE.accent });
    } else bp.decor.push({ partId: "3040b", x: i ? x0 + W - 2 : x0, y: T, z: 1, rot: i ? 3 : 1, role: ROLE.accent });
  });
  return bp;
}

function robot({ k, lh, rand, p }: Ctx): Blueprint {
  const W = even(6 * k), D = Math.max(4, even(4 * k));
  const legH = 3 * Math.max(2, Math.round(2 * k));
  const torsoH = 3 * Math.max(2, Math.round((2 + (1 - p.cute)) * k));
  const eta = lerp(1 / PHI ** 2, 1 / PHI, p.cute);
  const headH = 3 * Math.max(2, Math.round(((legH + torsoH) * eta) / (1 - eta) / 3));
  const neckY = legH + torsoH, headY = neckY + 3, T = headY + headH;
  const GW = W + 2, x0 = 1;
  const legW = Math.max(2, Math.round(W / 3));
  const eyeY = snap(headY + lerp(0.62, 0.45, p.cute) * (headH - 3), lh);
  const chestY = legH + Math.floor(torsoH / 6) * 3;
  const bp: Blueprint = {
    W: GW, D, H: T,
    at(x, y, z) {
      const bx = x - x0;
      if (bx < 0 || bx >= W) return y >= legH && y < neckY && z >= 1 && z < D - 1 ? ROLE.body : -1; // arms
      if (y < legH) {
        const inLeg = bx < legW || bx >= W - legW;
        if (!inLeg) return -1;
        return y < 3 || (z >= 1 && z < D - 1) ? ROLE.detail : -1; // feet full depth, legs inset
      }
      if (y >= neckY && y < headY) return ROLE.detail;
      if (z >= D - 1 && y >= chestY && y < chestY + 3 && bx >= 2 && bx < W - 2) return ROLE.accent;
      if (z >= D - 1 && y >= eyeY - 3 && y < eyeY && eyeY - 3 >= headY && bx >= 1 && bx < W - 1) return ROLE.mouth;
      return ROLE.body;
    },
    decor: [],
    reserve: [],
    title: p.fierce > 0.6 ? "Guard Bot" : p.cute > 0.6 ? "Buddy Bot" : "Box Robot",
    math: `head:body = ${headH}:${legH + torsoH} plates (η=${fmt(eta)}) · eyes at λ · neck band`,
  };
  const ex = p.cute > 0.4 ? [1, W - 2] : [2, W - 3];
  ex.forEach((x) => addEye(bp, eyePart(p, p.cute > 0.3, rand), x0 + x, eyeY, D - 1, 0));
  const ax = rand() < p.quirky ? (rand() < 0.5 ? 1 : W - 2) : Math.floor(W / 2) - (rand() < 0.5 ? 1 : 0);
  bp.decor.push({ partId: "3957a", x: x0 + ax, y: T, z: Math.floor(D / 2) - 1, rot: 0, color: 0 });
  return bp;
}

/**
 * Large wheels (Ø 14 mm) on two axles at the golden sections of the length,
 * a set at each side so the wheels stand out of the body, and a chassis of
 * plates on top. The body starts on the chassis, 4 plates up.
 */
function chassis(bp: Blueprint, L: number, Wd: number) {
  for (const t of [1 / PHI ** 2 / 2, 1 - 1 / PHI ** 2 / 2]) {
    const x = clamp(Math.round(L * t - 1), 0, L - 2);
    for (const z of Wd >= 6 ? [0, Wd - 2] : [Math.floor(Wd / 2) - 1]) bp.decor.push({ partId: "lb-wheels-big", x, y: 0, z, rot: 1, role: ROLE.detail });
  }
  addPlates(bp, 0, 0, L, Wd, 3, ROLE.detail);
  bp.floor = 4;
}

function car({ k, lh, rand, p }: Ctx): Blueprint {
  const Wd = k >= 2.2 ? 8 : k >= 1.4 ? 6 : 4;
  const L = Math.min(30, even(Wd * PHI * lerp(1, 1.5, clamp((k - 1) / 1.5, 0, 1))));
  const base = 4;
  const top = base + 3 * Math.max(2, Math.round(2 * k));
  const bp: Blueprint = {
    W: L, D: Wd, H: top + 3,
    at(x, y, z) {
      if (y < base || y >= top) return -1;
      const u = (x - L / 2) / (L / 2), v = (z - Wd / 2) / (Wd / 2);
      if (Math.abs(u) ** 4 + Math.abs(v) ** 4 > 1.15) return -1;
      if (y >= top - 3 && x >= L - 1) return -1; // the nose drops a layer
      if (x >= L - 1 && y < base + 3 && z >= 1 && z < Wd - 1) return ROLE.mouth;
      return y < base + 3 ? ROLE.accent : ROLE.body;
    },
    decor: [],
    reserve: [],
    title: p.fierce > 0.55 ? "Shark Racer" : "Critter Car",
    math: `L = W·φ ≈ ${L} · axles at 0.191L, 0.809L · fin at L/φ · hull |x|⁴+|z|⁴ ≤ 1`,
  };
  chassis(bp, L, Wd);
  for (const z of [0, Wd - 1]) addEye(bp, eyePart(p, p.cute > 0.55, rand), L - 2, top - 3, z, 3);
  const teeth = Math.round(p.fierce * (Wd - 2));
  for (let t = 0; t < teeth; t++) addTooth(bp, L - 1, base + 3, 1 + t, 3, lh);
  const fx = Math.round(L / PHI) - 2;
  const zc = Math.floor(Wd / 2) - 1;
  bp.decor.push({ partId: "3039", x: fx - 1, y: top, z: zc, rot: 1, role: ROLE.accent });
  bp.decor.push({ partId: "3039", x: fx + 1, y: top, z: zc, rot: 3, role: ROLE.accent });
  return bp;
}

/**
 * A Classic-style race car, nose toward +x. Side profile, as fractions of L:
 *   base tub 1 brick high the whole length, nose tapering in plan:
 *     half-width(x) = lerp(W/2, 1, smoothstep(0.62L, L, x))
 *   sidepods (0.22–0.58 L) and cockpit walls one brick up, cockpit open at
 *   0.45–0.62 L with the driver in it, airbox behind (0.10–0.45 L) stepping
 *   up a second brick (the solver turns its steps into slopes), rear wing on
 *   two posts over the tail.
 */
function racer({ k, rand, p }: Ctx): Blueprint {
  const Wd = k >= 1.8 ? 8 : 6;
  const L = clamp(even(10 + 6 * k), 12, 28);
  const base = 4, zc = Wd / 2;
  const half = (x: number) => lerp(Wd / 2, 1, smoothstep(0.62 * L, L, x));
  const f = (x: number) => x / L;
  const bp: Blueprint = {
    W: L, D: Wd, H: base + 12,
    at(x, y, z) {
      const dz = Math.abs(z - zc);
      if (y < base || dz > half(x)) return -1;
      const t = f(x);
      if (y < base + 3) return t > 0.62 && dz < 1 ? ROLE.accent : ROLE.body; // tub, stripe on the nose
      if (y < base + 6) {
        if (t > 0.45 && t < 0.62 && dz < 1) return -1; // cockpit
        if (t >= 0.22 && t <= 0.62 && dz >= 1) return ROLE.body; // sidepods & cockpit walls
        if (t >= 0.1 && t < 0.45 && dz < 1.5) return ROLE.accent; // airbox, lower
        return -1;
      }
      if (y < base + 9 && t >= 0.22 && t < 0.45 && dz < 1.5) return ROLE.accent; // airbox, upper
      return -1;
    },
    decor: [],
    reserve: [],
    title: p.fierce > 0.55 ? "Wedge Racer" : "Speedster",
    math: `L = ${L}, W = ${Wd} · nose half-width lerp(W/2, 1, smoothstep(0.62L, L, x)) · cockpit 0.45–0.62L · axles at 0.191L, 0.809L`,
  };
  chassis(bp, L, Wd);
  const dx = Math.round(0.53 * L);
  bp.decor.push({ partId: "lb-driver", x: dx, y: base + 3, z: Math.floor(zc) - 1, rot: 3, role: ROLE.accent });
  // Rear wing on two posts over the tail.
  for (const z of [1, Wd - 2]) {
    bp.decor.push({ partId: "3005", x: 0, y: base + 3, z, rot: 0, role: ROLE.detail });
    bp.reserve.push({ x: 0, z, y0: base + 3, y1: base + 6 });
  }
  addPlates(bp, 0, 0, 2, Wd, base + 6, ROLE.accent);
  if (p.quirky > 0.55) for (const z of [Math.floor(zc) - 2, Math.floor(zc) + 1]) addEye(bp, eyePart(p, false, rand), L - 4, base + 3, clamp(z, 0, Wd - 1), 3);
  return bp;
}

// ------------------------------------------------------------- dinosaurs (SDF)

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** Ellipsoid distance (Quílez's bound): good enough for a voxel inside test. */
const sdEllipsoid = (p: V3, c: V3, r: V3) => {
  const q: V3 = [(p[0] - c[0]) / r[0], (p[1] - c[1]) / r[1], (p[2] - c[2]) / r[2]];
  return (len(q) - 1) * Math.min(...r);
};
/** Round cone: a capsule whose radius goes from ra at a to rb at b. */
const sdRoundCone = (p: V3, a: V3, b: V3, ra: number, rb: number) => {
  const ba = sub(b, a), pa = sub(p, a);
  const t = clamp(dot(pa, ba) / dot(ba, ba), 0, 1);
  const q: V3 = [pa[0] - ba[0] * t, pa[1] - ba[1] * t, pa[2] - ba[2] * t];
  return len(q) - lerp(ra, rb, t);
};
/** Polynomial smooth minimum: blends two shapes with a fillet of size k. */
const smin = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - (h * h * k) / 4;
};

type Species = "rex" | "brachio" | "stego";

function dino({ k, lh, rand, p }: Ctx, species: Species): Blueprint {
  const s = k; // studs per unit
  const D = Math.max(5, Math.round(5 * s)) + 1;
  const zc = D / 2;
  // Each species: parts in unit coordinates (x along the body, y up, z across), studs = unit × s.
  const parts: ((q: V3) => number)[] = [];
  let length = 14, height = 10, title = "", headC: V3 = [0, 0, 0], jawFront = 0, spineFrom = 0, spineTo = 0;
  const E = (c: V3, r: V3) => (q: V3) => sdEllipsoid(q, [c[0], c[1], 0], r);
  const C = (a: V3, b: V3, ra: number, rb: number) => (q: V3) => sdRoundCone(q, a, b, ra, rb);
  if (species === "rex") {
    title = "T-Rex";
    parts.push(E([7, 5.2, 0], [3.4, 2.4, 1.9]));
    parts.push(C([4.2, 5.4, 0], [0.4, 4.0, 0], 1.6, 0.35)); // tail
    parts.push(C([9.4, 6.2, 0], [10.6, 7.8, 0], 1.35, 1.05)); // neck
    parts.push(E([11.7, 8.4, 0], [2.1, 1.25, 1.15])); // head
    parts.push(E([12.0, 7.3, 0], [1.8, 0.6, 1.0])); // jaw
    for (const z of [-1.3, 1.3]) {
      parts.push(C([7.2, 4.4, z], [7.6, 1.6, z * 1.05], 1.15, 0.75)); // thigh
      parts.push(C([7.6, 1.6, z * 1.05], [8.0, 0.3, z * 1.05], 0.7, 0.6)); // shin
      parts.push(C([9.3, 5.4, z * 0.8], [10.1, 4.5, z * 0.9], 0.38, 0.3)); // tiny arms
    }
    headC = [11.9, 8.7, 0];
    jawFront = 13.6;
    spineFrom = 3; spineTo = 9;
    height = 10;
  } else if (species === "brachio") {
    title = "Brachiosaurus";
    parts.push(E([6.2, 4.6, 0], [3.3, 2.0, 1.8]));
    for (const x of [4.3, 8.0]) for (const z of [-1.1, 1.1]) parts.push(C([x, 3.8, z], [x, 0.3, z * 1.1], 0.95, 0.85));
    parts.push(C([8.6, 5.6, 0], [11.0, 11.4, 0], 1.15, 0.6)); // neck
    parts.push(E([11.7, 11.9, 0], [1.2, 0.65, 0.65])); // head
    parts.push(C([3.2, 5.0, 0], [0.4, 3.6, 0], 1.2, 0.25)); // tail
    headC = [11.9, 12.0, 0];
    jawFront = 12.9;
    height = 13;
  } else {
    title = "Stegosaurus";
    parts.push(E([6.4, 4.2, 0], [3.5, 2.4, 1.9]));
    for (const x of [4.6, 8.3]) for (const z of [-1.1, 1.1]) parts.push(C([x, 3.0, z], [x, 0.3, z * 1.1], 0.85, 0.75));
    parts.push(C([9.2, 3.8, 0], [10.6, 2.9, 0], 0.9, 0.7)); // neck
    parts.push(E([11.2, 2.8, 0], [1.1, 0.75, 0.7])); // head
    parts.push(C([3.4, 4.6, 0], [0.4, 3.0, 0], 1.3, 0.3)); // tail
    headC = [11.3, 3.0, 0];
    jawFront = 12.3;
    spineFrom = 3; spineTo = 9.5;
    height = 7.5;
  }
  const W = Math.min(32, Math.ceil(length * s) + 1);
  const Hp = Math.min(120, Math.ceil((height * s) / 0.4) + 3);
  const blend = 0.6;
  const field = (x: number, y: number, z: number) => {
    const q: V3 = [x / s, (y * 0.4) / s, (z - zc) / s];
    let d = Infinity;
    for (const f of parts) d = smin(d === Infinity ? 1e3 : d, f(q), blend);
    return d;
  };
  const mouthY = (headC[1] - 0.55) * s / 0.4; // plates: the line between head and jaw
  // Thin parts (necks, tails, legs) can slip between cell centres; sample three
  // heights per layer and grow the shape slightly so they survive voxelisation.
  const dy = lh * 0.35;
  const inside = (x: number, y: number, z: number) => Math.min(field(x, y - dy, z), field(x, y, z), field(x, y + dy, z)) < 0.28;
  const bp: Blueprint = {
    W, D, H: Hp,
    at(x, y, z) {
      if (!inside(x, y, z)) return -1;
      const ux = x / s, uy = (y * 0.4) / s;
      if (species === "rex" && ux > headC[0] - 0.4 && Math.abs(y - mouthY) < (lh === 3 ? 1.6 : 0.6)) return ROLE.mouth;
      if (uy < 4.2 && ux > 4.5 && ux < 10 && species !== "stego" && Math.abs((z - zc) / s) > 0) {
        // belly: the lower half of the torso, on the outward faces
        const under = field(x, y - (lh === 3 ? 3 : 1), z) > 0;
        if (under) return ROLE.accent;
      }
      return ROLE.body;
    },
    decor: [],
    reserve: [],
    title,
    math: `SDF: ellipsoids + round cones, smin(a,b,k) blend k=${blend} · scale ${fmt(s)} studs/unit`,
  };

  // Eyes on both sides of the head (rot 0 looks +z, rot 2 looks −z): the
  // outermost head cell near eye height that has head under it to sit on.
  const roleAt = (x: number, y: number, z: number) => bp.at(x + 0.5, y + 0.5 * lh, z + 0.5);
  const ex = Math.round(headC[0] * s - 0.5);
  const ey0 = snap((headC[1] * s) / 0.4, lh);
  for (const [dir, rot] of [[1, 0], [-1, 2]] as const) {
    let placed = false;
    for (const dy of [0, -lh, lh, -2 * lh]) {
      const ey = ey0 + dy;
      for (let z = dir > 0 ? D - 1 : 0; z >= 0 && z < D && !placed; z -= dir) {
        if (roleAt(ex, ey, z) < 0) continue;
        if (roleAt(ex, ey - lh, z) >= 0) {
          addEye(bp, eyePart(p, false, rand), ex, ey, z, rot);
          placed = true;
        }
        break; // only the outermost solid cell counts: an eye inside the head can't be seen
      }
      if (placed) break;
    }
  }
  // T-rex teeth: hanging at the front of the jaw, facing forward (rot 3 = +x).
  if (species === "rex") {
    const tx = Math.min(W - 1, Math.round(jawFront * s) - 1);
    const ty = snap(mouthY, lh); // on the layer grid, or its cell would straddle two layers
    const teeth = 1 + Math.round(p.fierce * 2);
    for (let t = 0; t < teeth; t++) {
      const z = Math.round(zc) - 1 + (t % 2) - (t === 2 ? 1 : 0);
      // Only where the jaw is solid both at the tooth and beneath it (a tooth needs a stud to sit on).
      if (roleAt(tx, ty, z) >= 0 && roleAt(tx, ty - lh, z) >= 0) addTooth(bp, tx, ty, z, 3, lh);
    }
  }
  // Spine decorations on the top surface: cones (rex), slope pairs (stego plates).
  if (spineTo > spineFrom) {
    const topY = (x: number, z: number) => {
      for (let y = Hp - 1; y >= 0; y--) if (roleAt(x, y, z) >= 0) return y + 1;
      return -1;
    };
    const step = species === "stego" ? 2 : 3;
    for (let ux = spineFrom; ux <= spineTo; ux += step / s) {
      const x = Math.round(ux * s);
      const z = Math.floor(zc) - (species === "stego" ? 1 : 0);
      // Sit on the highest cell under the whole footprint (backs are curved).
      const span = species === "stego" ? [z - 1, z, z + 1, z + 2] : [Math.floor(zc)];
      const y = Math.max(...span.map((zz) => topY(x, zz)));
      if (y < 0) continue;
      const yy = lh === 3 ? Math.ceil(y / 3) * 3 : y;
      if (species === "rex" && p.fierce > 0.4) bp.decor.push({ partId: "4589", x, y: yy, z: Math.floor(zc), rot: 0, role: ROLE.accent });
      if (species === "stego") {
        bp.decor.push({ partId: "3040b", x, y: yy, z: z - 1, rot: 2, role: ROLE.accent });
        bp.decor.push({ partId: "3040b", x, y: yy, z: z + 1, rot: 0, role: ROLE.accent });
      }
    }
  }
  return bp;
}

// ----------------------------------------------------------------- assembly

const BUILD: Record<Archetype, (c: Ctx) => Blueprint> = {
  monster,
  robot,
  car,
  racer,
  dino: (c) => {
    // Species drawn with weights from the personality: fierce → T-rex, cute → Brachiosaurus, quirky → Stegosaurus.
    const w = [c.p.fierce + 0.25, c.p.cute + 0.25, c.p.quirky + 0.25];
    let r = c.rand() * (w[0] + w[1] + w[2]);
    const species: Species = (r -= w[0]) < 0 ? "rex" : (r -= w[1]) < 0 ? "brachio" : "stego";
    return dino(c, species);
  },
};

const PREFER: Partial<Record<Archetype, string[]>> = {
  dino: ["#237841", "#4B9F4A", "#A0BCAC", "#958A73", "#582A12", "#FE8A18"],
  racer: ["#C91A09", "#0055BF", "#F2CD37", "#FE8A18", "#1B2A34", "#FFFFFF"],
};

/**
 * Sample a blueprint into a solver grid (layers of lh plates from y0 up),
 * keeping decor cells empty and marking every decor footprint as solid.
 */
function toGrid(bp: Blueprint, lh: 1 | 3): Grid {
  const { W, D } = bp;
  const y0 = bp.floor ?? 0;
  const L = Math.max(1, Math.ceil((bp.H - y0) / lh));
  const role = new Int8Array(W * D * L);
  const keep = new Uint8Array(W * D * L);
  for (let l = 0; l < L; l++)
    for (let z = 0; z < D; z++)
      for (let x = 0; x < W; x++) role[l * W * D + z * W + x] = bp.at(x + 0.5, y0 + (l + 0.5) * lh, z + 0.5);
  const mark = (x: number, y: number, z: number, clear: boolean) => {
    const l = Math.floor((y - y0) / lh);
    if (l < 0 || l >= L || x < 0 || x >= W || z < 0 || z >= D) return;
    if (clear) role[l * W * D + z * W + x] = -1;
    keep[l * W * D + z * W + x] = 1;
  };
  for (const b of bp.reserve) for (let y = b.y0; y < b.y1; y++) mark(b.x, y, b.z, true);
  for (const d of bp.decor) {
    const part = PARTS[d.partId];
    if (!part) continue;
    const [w, dd] = d.rot % 2 ? [part.d, part.w] : [part.w, part.d];
    for (let x = 0; x < w; x++) for (let z = 0; z < dd; z++) for (let y = 0; y < part.h; y++) mark(d.x + x, d.y + y, d.z + z, false);
  }
  return { W, D, L, lh, role, keep, floor: 0, y0 };
}

/** Plate-cells per piece the solver tends to reach, by level — for sizing to a piece budget. */
const CELLS_PER_PIECE: Record<Level, number> = { easy: 15, medium: 10, hard: 6.5 };

function estimate(bp: Blueprint, lh: 1 | 3, level: Level) {
  const g = toGrid(bp, lh);
  let cells = 0;
  for (const r of g.role) if (r >= 0) cells++;
  return (cells * lh) / CELLS_PER_PIECE[level] + bp.decor.length;
}

/**
 * One character: archetype + personality + seed, sized so its piece count
 * lands near `pieces` (k from the cube root of the ratio, refined twice).
 */
export function makeCharacter(
  arch: Archetype,
  p: Personality,
  seed: number,
  palette: number[],
  pieces = 60,
  level: Level = "medium",
  fixedK?: number,
): Character & { k: number } {
  // Hard builds vehicles and robots in plate layers for finer shapes. Curved
  // creatures (dinosaur skins, monster arches) would turn into rings of thin
  // plate overhangs, so they stay in brick layers and get harder through
  // smaller parts instead.
  const lh: 1 | 3 = level === "hard" && arch !== "dino" && arch !== "monster" ? 1 : 3;
  // Dinosaurs need some bulk: below k = 1 legs get thinner than a stud and vanish.
  const kMin = arch === "dino" ? 0.85 : 0.75;
  if (fixedK !== undefined) {
    const k = clamp(fixedK, kMin, 3.2);
    const bp = BUILD[arch]({ k, lh, rand: rng(seed * 2654435761), p, level });
    const rand = rng(seed * 2654435761 + 7);
    return { grid: toGrid(bp, lh), roleColors: harmonise(palette, p, rand, PREFER[arch], arch === "dino"), decor: bp.decor, title: bp.title, math: bp.math, level, k };
  }
  let k = Math.max(1, kMin);
  let bp!: Blueprint;
  for (let iter = 0; iter < 3; iter++) {
    const rand = rng(seed * 2654435761);
    bp = BUILD[arch]({ k, lh, rand, p, level });
    if (iter === 2) break;
    const est = estimate(bp, lh, level);
    const next = clamp(k * Math.cbrt(pieces / Math.max(est, 1)), kMin, 3.2);
    if (Math.abs(next - k) < 0.05) break;
    k = next;
    bp = BUILD[arch]({ k, lh, rand: rng(seed * 2654435761), p, level });
  }
  const rand = rng(seed * 2654435761 + 7);
  return {
    grid: toGrid(bp, lh),
    roleColors: harmonise(palette, p, rand, PREFER[arch], arch === "dino"),
    decor: bp.decor,
    title: bp.title,
    math: bp.math,
    level,
    k,
  };
}

/** Personality jittered around the sliders, so a batch shows a family, not clones. */
export function jitter(p: Personality, seed: number): Personality {
  const r = rng(seed * 40503);
  const j = (v: number) => clamp(v + (r() - 0.5) * 0.3, 0, 1);
  return { cute: j(p.cute), fierce: j(p.fierce), quirky: j(p.quirky) };
}
