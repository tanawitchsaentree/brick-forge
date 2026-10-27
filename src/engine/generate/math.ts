// Small numeric toolkit for the generator: seeded randomness, smooth noise and
// perceptual colour distance.

/** Mulberry32: tiny, fast, seedable PRNG returning [0, 1). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const PHI = (1 + Math.sqrt(5)) / 2;
export const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ≈ 137.508°

const smooth = (t: number) => t * t * t * (t * (t * 6 - 15) + 10); // quintic fade (Perlin 2002)

function hash3(x: number, y: number, z: number, seed: number) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + seed * 144269504) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** 3D value noise in [-1, 1] with quintic interpolation. */
export function noise3(x: number, y: number, z: number, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const u = smooth(x - xi), v = smooth(y - yi), w = smooth(z - zi);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz, seed);
  const x00 = lerp(c(0, 0, 0), c(1, 0, 0), u), x10 = lerp(c(0, 1, 0), c(1, 1, 0), u);
  const x01 = lerp(c(0, 0, 1), c(1, 0, 1), u), x11 = lerp(c(0, 1, 1), c(1, 1, 1), u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w) * 2 - 1;
}

/** Fractal Brownian motion: octaves of noise, each at double frequency and half amplitude. */
export function fbm(x: number, z: number, seed: number, octaves = 4) {
  let sum = 0, amp = 0.5, freq = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise3(x * freq, 0.5, z * freq, seed + o * 17);
    amp *= 0.5;
    freq *= 2;
  }
  return sum;
}

// ---- colour: sRGB hex → CIELAB, distance ΔE*76 (Euclidean in Lab) ----

export type Lab = [number, number, number];

export function hexToLab(hex: string): Lab {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const r = lin((n >> 16) & 255), g = lin((n >> 8) & 255), b = lin(n & 255);
  const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

export const deltaE = (a: Lab, b: Lab) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
