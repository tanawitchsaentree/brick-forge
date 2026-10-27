import { GOLDEN_ANGLE, PHI, fbm, noise3 } from "./math";

// Each recipe is a little piece of geometry: a function that says, for any
// point in physical space, which colour role (if any) belongs there. Units are
// studs on every axis (1 stud = 8 mm, so a brick is 1.2 tall, a plate 0.4).
// The solver samples it at the centre of every stud-sized cell and builds it.

export interface Role {
  name: string;
  /** Hue the role would like (leaf → green); omitted roles just take the best-stocked colours. */
  prefer?: string;
}

export interface Shape {
  W: number; // studs along x
  D: number; // studs along z
  H: number; // physical height in studs
  /** Role index at a point, or -1 for empty. */
  at(x: number, y: number, z: number): number;
}

export interface Recipe {
  id: string;
  title: string;
  /** The idea behind it, in one line. */
  math: string;
  roles: Role[];
  /** Flat mosaics are one plate thick; "any" picks bricks or plates from what you own. */
  layers: "plate" | "any";
  /** Candidate sizes, largest first; the solver keeps the biggest one your pieces can finish. */
  sizes: number[];
  build(size: number, seed: number): Shape;
}

const range = (from: number, to: number, step = -1) => {
  const out: number[] = [];
  for (let v = from; step < 0 ? v >= to : v <= to; v += step) out.push(v);
  return out;
};

/** Superellipse |x|ⁿ + |z|ⁿ ≤ 1 (Piet Hein's "squircle" for n ≈ 2.5). */
const superellipse = (x: number, z: number, n: number) => Math.abs(x) ** n + Math.abs(z) ** n <= 1;

export const RECIPES: Recipe[] = [
  {
    id: "ziggurat",
    title: "Golden Ziggurat",
    math: "Stepped pyramid; the accent band sits at height H/φ, the golden section.",
    roles: [{ name: "stone" }, { name: "band" }],
    layers: "any",
    sizes: range(24, 6, -2),
    build(n) {
      const tiers = Math.floor(n / 2);
      const th = 1.2;
      const band = Math.round(tiers / PHI);
      return {
        W: n, D: n, H: tiers * th,
        at(x, y, z) {
          const t = Math.floor(y / th);
          if (t >= tiers) return -1;
          if (x < t || z < t || x >= n - t || z >= n - t) return -1;
          return t === band || t === tiers - 1 ? 1 : 0;
        },
      };
    },
  },
  {
    id: "vase",
    title: "Squircle Vase",
    math: "Superellipse cross-section |x|ⁿ+|z|ⁿ=rⁿ (n=2.6) swept along a sine profile; hollow walls.",
    roles: [{ name: "body" }, { name: "stripe" }],
    layers: "any",
    sizes: range(10, 3, -1),
    build(R, seed) {
      const H = R * PHI * 1.6;
      const phase = (seed % 7) * 0.05;
      const radius = (y: number) => {
        const t = y / H;
        return R * (0.5 + 0.5 * Math.sin(Math.PI * (0.18 + phase + 0.8 * t)) ** 1.4) + (t > 0.86 ? (t - 0.86) * R * 2 : 0);
      };
      const c = R + 0.5;
      return {
        W: 2 * R + 2, D: 2 * R + 2, H,
        at(x, y, z) {
          if (y > H) return -1;
          const r = Math.max(radius(y), 1);
          const dx = (x - c) / r, dz = (z - c) / r;
          if (!superellipse(dx, dz, 2.6)) return -1;
          const inner = Math.max(r - 1.1, 0);
          const hollow = y > 1.2 && inner > 0.6 && superellipse((x - c) / inner, (z - c) / inner, 2.6);
          if (hollow) return -1;
          return Math.floor(y / 1.2) % 4 === 3 ? 1 : 0;
        },
      };
    },
  },
  {
    id: "twist",
    title: "Twisted Tower",
    math: "A rounded square rotated by θ(y) = k·y as it rises — parametric architecture.",
    roles: [{ name: "facade" }, { name: "floors" }],
    layers: "any",
    sizes: range(9, 3, -1),
    build(a, seed) {
      const H = a * 4.2;
      const k = (Math.PI / 2 / H) * (1 + (seed % 3) * 0.25);
      const c = a + 1;
      return {
        W: 2 * a + 2, D: 2 * a + 2, H,
        at(x, y, z) {
          if (y > H) return -1;
          const th = k * y;
          const dx = x - c, dz = z - c;
          const u = (dx * Math.cos(th) + dz * Math.sin(th)) / a;
          const v = (-dx * Math.sin(th) + dz * Math.cos(th)) / a;
          if (!superellipse(u, v, 4)) return -1;
          return Math.floor(y / 1.2) % 3 === 2 ? 1 : 0;
        },
      };
    },
  },
  {
    id: "bridge",
    title: "Catenary Bridge",
    math: "Arch under the deck follows y = a·cosh(x/a), the curve of a hanging chain flipped upright, on solid abutments.",
    roles: [{ name: "arch" }, { name: "deck" }],
    layers: "any",
    sizes: range(30, 10, -2),
    build(L) {
      const rise = L * 0.32;
      // Solve a·(cosh(L/2a) − 1) = rise for a by bisection.
      let lo = 0.1, hi = 1000;
      for (let i = 0; i < 60; i++) {
        const m = (lo + hi) / 2;
        if (m * (Math.cosh(L / 2 / m) - 1) > rise) lo = m;
        else hi = m;
      }
      const a = (lo + hi) / 2;
      const deckTop = rise + 1.2;
      return {
        W: L, D: 4, H: deckTop,
        at(x, y) {
          const underside = rise - a * (Math.cosh((x - L / 2) / a) - 1);
          const abutment = x < 2 || x > L - 2; // solid piers where the arch meets the ground
          if (y > deckTop || (y < underside && !abutment)) return -1;
          return y >= rise ? 1 : 0;
        },
      };
    },
  },
  {
    id: "house",
    title: "Little House",
    math: "A shape grammar: walls → door and window rhythm every 3 studs → trim course → stepped gable roof.",
    roles: [{ name: "walls" }, { name: "roof", prefer: "#A83D15" }, { name: "trim", prefer: "#F4F4F4" }],
    layers: "any",
    sizes: range(14, 6, -2),
    build(w) {
      const d = Math.max(4, Math.round(w * 0.7));
      const wall = 4.8;
      const roofLayers = Math.ceil(d / 2);
      return {
        W: w, D: d, H: wall + roofLayers * 1.2,
        at(px, y, pz) {
          const x = Math.floor(px), z = Math.floor(pz); // grammar rules work on whole cells
          if (y < wall) {
            const edge = x === 0 || z === 0 || x === w - 1 || z === d - 1;
            if (!edge) return -1;
            const course = Math.floor(y / 1.2);
            const doorX = Math.floor(w / 2) - 1;
            if (z === d - 1 && x >= doorX && x < doorX + 2 && course < 2) return -1; // door
            if (course === 1 && (x % 3 === 1 || z % 3 === 1) && !(x === 0 && z === 0)) return -1; // windows
            return course === 3 ? 2 : 0;
          }
          const k = Math.floor((y - wall) / 1.2);
          return z >= k && z < d - k ? 1 : -1;
        },
      };
    },
  },
  {
    id: "tree",
    title: "Noise Tree",
    math: "Ellipsoid canopy whose radius is pushed in and out by 3D value noise; a sturdy trunk.",
    roles: [{ name: "leaves", prefer: "#237841" }, { name: "trunk", prefer: "#583927" }],
    layers: "any",
    sizes: range(8, 3, -1),
    build(r, seed) {
      const trunkH = r * 1.1 + 1.2;
      const cy = trunkH + r * 0.75;
      const c = r + 1;
      return {
        W: 2 * r + 2, D: 2 * r + 2, H: cy + r * 0.95,
        at(x, y, z) {
          const dx = x - c, dz = z - c, dy = y - cy;
          const wobble = 1 + 0.28 * noise3(x * 0.35, y * 0.35, z * 0.35, seed);
          if ((dx * dx + dz * dz) / (r * r) + (dy * dy) / (r * 0.85) ** 2 <= wobble * wobble) return 0;
          if (y < cy && Math.abs(dx) <= 1 && Math.abs(dz) <= 1) return 1;
          return -1;
        },
      };
    },
  },
  {
    id: "island",
    title: "fBm Island",
    math: "Fractal Brownian motion heightmap under a radial falloff, banded into beach, grass, rock and snow.",
    roles: [
      { name: "water", prefer: "#1E5AA8" },
      { name: "sand", prefer: "#E4CD9E" },
      { name: "grass", prefer: "#58AB41" },
      { name: "rock", prefer: "#A0A5A9" },
      { name: "snow", prefer: "#F4F4F4" },
    ],
    layers: "plate",
    sizes: range(15, 5, -1),
    build(R, seed) {
      const top = R * 0.5;
      const c = R;
      const height = (x: number, z: number) => {
        const d = Math.hypot(x - c, z - c) / R;
        if (d > 1) return -1;
        const h = (0.55 * fbm((x / R) * 2.2, (z / R) * 2.2, seed) + 0.75 * (1 - d ** 2.2)) * top;
        return h;
      };
      return {
        W: 2 * R + 1, D: 2 * R + 1, H: top + 0.4,
        at(x, y, z) {
          const h = height(x, z);
          if (h < 0) return -1;
          if (h < 0.4) return y < 0.4 ? 0 : -1;
          if (y > h) return -1;
          const t = y / top;
          return t < 0.18 ? 1 : t < 0.55 ? 2 : t < 0.82 ? 3 : 4;
        },
      };
    },
  },
  {
    id: "heart",
    title: "Taubin Heart",
    math: "Implicit surface (x²+9/4·z²+y²−1)³ − x²y³ − 9/80·z²y³ ≤ 0, with a highlight glint.",
    roles: [{ name: "heart", prefer: "#C91A09" }, { name: "glint", prefer: "#F4F4F4" }],
    layers: "any",
    sizes: range(9, 3, -1),
    build(s) {
      const W = Math.ceil(2.4 * s) + 1, D = Math.ceil(1.5 * s) + 1;
      const cx = W / 2, cz = D / 2, cy = 1.02 * s;
      return {
        W, D, H: 2.3 * s,
        at(x, y, z) {
          const X = (x - cx) / s, Y = (y - cy) / s, Z = (z - cz) / s;
          const a = X * X + 2.25 * Z * Z + Y * Y - 1;
          if (a * a * a - X * X * Y ** 3 - 0.1125 * Z * Z * Y ** 3 > 0) return -1;
          return X < -0.3 && Y > 0.45 && Z < -0.1 ? 1 : 0;
        },
      };
    },
  },
  {
    id: "sunflower",
    title: "Sunflower Mosaic",
    math: "Vogel's spiral: seed k at radius c√k, angle k·137.5°. Colouring k mod 21 reveals the Fibonacci spirals.",
    roles: [{ name: "spiral A", prefer: "#F2CD37" }, { name: "spiral B", prefer: "#FE8A18" }, { name: "spiral C", prefer: "#C91A09" }, { name: "centre", prefer: "#583927" }],
    layers: "plate",
    sizes: range(30, 10, -2),
    build(n) {
      const R = n / 2;
      const count = Math.round(R * R * 1.1);
      const cScale = R / Math.sqrt(count);
      const seeds = Array.from({ length: count }, (_, k) => [
        R + cScale * Math.sqrt(k) * Math.cos(k * GOLDEN_ANGLE),
        R + cScale * Math.sqrt(k) * Math.sin(k * GOLDEN_ANGLE),
      ]);
      return {
        W: n, D: n, H: 0.4,
        at(x, _y, z) {
          if (Math.hypot(x - R, z - R) > R) return -1;
          let best = 0, bd = Infinity;
          for (let k = 0; k < count; k++) {
            const d = (seeds[k][0] - x) ** 2 + (seeds[k][1] - z) ** 2;
            if (d < bd) [bd, best] = [d, k];
          }
          if (best < count * 0.08) return 3;
          return (best % 21) % 3;
        },
      };
    },
  },
  {
    id: "truchet",
    title: "Truchet Maze",
    math: "Truchet tiles: each 4×4 square holds two quarter-circle arcs, randomly turned; they join into endless paths.",
    roles: [{ name: "ground" }, { name: "paths" }],
    layers: "plate",
    sizes: range(32, 8, -4),
    build(n, seed) {
      const T = 4;
      const flip = (i: number, j: number) => noise3(i * 1.37, j * 1.91, 0.5, seed) > 0;
      return {
        W: n, D: n, H: 0.4,
        at(x, _y, z) {
          const i = Math.floor(x / T), j = Math.floor(z / T);
          let u = (x % T) / T, v = (z % T) / T;
          if (flip(i, j)) u = 1 - u;
          const r1 = Math.hypot(u, v), r2 = Math.hypot(1 - u, 1 - v);
          const onArc = Math.abs(r1 - 0.5) < 0.2 || Math.abs(r2 - 0.5) < 0.2;
          return onArc ? 1 : 0;
        },
      };
    },
  },
];
