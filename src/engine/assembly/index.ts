import { PARTS, footprint } from "../parts";
import { mul, translate, worldBox, worldCenter } from "../pose";
import { analyzeStability, sizeMM } from "../stability";
import { rateDifficulty } from "../difficulty";
import { invKey, type Inventory } from "../inventory";
import type { Idea } from "../generate";
import { Builder, Pool, type Mode, type Part } from "./pool";
import { design, KINDS, type Kind } from "./objects";
import type { Plan, Species } from "./dino";
import type { F1Plan } from "./f1";

export { KINDS, type Kind } from "./objects";
export type { Mode } from "./pool";
export { SPECIES, PLANS, DINO_TUNING, type Plan, type Species } from "./dino";
export { F1_ANCHOR, LIVERIES, type F1Plan } from "./f1";

export interface ModuleInfo {
  name: string;
  parts: number;
}

export interface BuildMetrics {
  /** Stud-cells of volume per piece: higher = fewer, bigger, better-used parts. */
  efficiency: number;
  /** Share of pieces that are not plain bricks/plates/tiles (slopes, windows, SNOT, wheels…). */
  special: number;
  /** Share of pieces with a mirror twin across the model's centre line. */
  symmetry: number;
  types: number;
}

export interface Build extends Idea {
  kind: Kind;
  /** From the design corpus: an official set (and the scheme it was repainted in, if any). */
  real?: { set: string; scheme: string };
  /** From the learned engine: share of parts held together (engine/connect.ts). */
  held?: number;
  species?: Species;
  modules: ModuleInfo[];
  metrics: BuildMetrics;
  failed: number;
}

/** Left/right versions of the same part. */
const MIRROR: Record<string, string> = Object.fromEntries(
  [["41769a", "41770a"], ["43722a", "43723a"], ["29119", "29120"], ["50304", "50305"], ["41747", "41748"]].flatMap(([a, b]) => [[a, b], [b, a]]),
);

const isPlain = (id: string) => !!PARTS[id]?.tags?.includes("plain");

function measure(parts: Part[]): BuildMetrics {
  let vol = 0, special = 0;
  for (const p of parts) {
    const d = PARTS[p.partId];
    if (!d) continue;
    vol += d.w * d.d * d.h;
    if (!isPlain(p.partId)) special++;
  }
  // Mirror symmetry about the model's centre plane, along whichever axis it's
  // more symmetric in (vehicles mirror across z, a robot facing us across x).
  // Measured on world centres, so posed parts (a dinosaur's legs) count too.
  const mids = parts.map((p) => worldCenter(p));
  const q = (v: number) => Math.round(v * 4) / 4;
  const twinsAlong = (axis: 0 | 2) => {
    let lo = Infinity, hi = -Infinity;
    for (const m of mids) {
      lo = Math.min(lo, m[axis]);
      hi = Math.max(hi, m[axis]);
    }
    const key = (id: string, m: number[]) => `${id}:${q(m[0])}:${q(m[1])}:${q(m[2])}`;
    const set = new Set(parts.map((p, i) => key(p.partId, mids[i])));
    let n = 0;
    parts.forEach((p, i) => {
      const m = [...mids[i]];
      m[axis] = lo + hi - m[axis];
      // A left part's twin is its right-hand version (wing plates, cut-out slopes).
      if (set.has(key(p.partId, m)) || set.has(key(MIRROR[p.partId] ?? "", m))) n++;
    });
    return n;
  };
  const twins = Math.max(twinsAlong(0), twinsAlong(2));
  return {
    efficiency: parts.length ? vol / parts.length : 0,
    special: parts.length ? special / parts.length : 0,
    symmetry: parts.length ? twins / parts.length : 0,
    types: new Set(parts.map((p) => p.partId)).size,
  };
}

/**
 * Bonding plates: if any part ended up connected to nothing, lay a 1×2 plate
 * on top bridging it to a neighbour that is connected — the standard LEGO way
 * to tie two stacks together. Repeats until everything holds (or no bridge fits).
 */
function repair(b: Builder) {
  for (let pass = 0; pass < 4; pass++) {
    const st = analyzeStability(b.parts);
    if (!st.floating.size) return;
    const top = new Map<string, Part>(); // "x,z" of each part's top cell → part, at that top height
    for (const p of b.parts) {
      if (p.place) continue;
      const { w, d } = footprint(PARTS[p.partId], p.rot);
      for (let i = 0; i < w; i++) for (let k = 0; k < d; k++) top.set(`${p.x + i},${p.y + PARTS[p.partId].h},${p.z + k}`, p);
    }
    let fixed = false;
    for (const p of b.parts) {
      if (!st.floating.has(p.uid) || p.place) continue;
      const part = PARTS[p.partId];
      if (!part.studs.length) continue;
      const { w, d } = footprint(part, p.rot);
      const y = p.y + part.h;
      search: for (let i = 0; i < w; i++)
        for (let k = 0; k < d; k++)
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = p.x + i + dx, nz = p.z + k + dz;
            const q = top.get(`${nx},${y},${nz}`);
            if (!q || st.floating.has(q.uid)) continue;
            const x = Math.min(p.x + i, nx), z = Math.min(p.z + k, nz);
            b.module(p.group, () => {
              fixed = b.put("3023", x, y, z, dx ? 0 : 1, p.color) || fixed; // 1×2 along the bridge
            });
            if (fixed) break search;
          }
    }
    if (!fixed) return;
  }
}

/**
 * Design one object with the Assembly Grammar and evaluate it. `mode` "mine"
 * builds from My Library where it can (stand-ins included) and lists the rest
 * to buy; "any" uses standard parts.
 */
export function generateBuild(
  kind: Kind,
  opts: { size: number; level: 0 | 1 | 2; seed: number; mode: Mode; inv: Inventory; species?: Species; plan?: Plan | F1Plan },
): Build {
  const pool = new Pool(opts.mode, opts.inv);
  // Colours the user owns most of (by piece count), to lead the palette in mine mode.
  const byColor = new Map<number, number>();
  for (const [k, q] of Object.entries(opts.inv)) byColor.set(Number(k.slice(k.lastIndexOf(":") + 1)), (byColor.get(Number(k.slice(k.lastIndexOf(":") + 1))) ?? 0) + q);
  const owned = opts.mode === "mine" ? [...byColor].sort((a, b) => b[1] - a[1]).map(([c]) => c) : [];
  const d = design(kind, pool, opts.size, opts.level, opts.seed, owned, opts.species, opts.plan);
  repair(d.b);
  const sections = d.sections ?? [];
  const failed = [d.b, ...sections].flatMap((b) => b.failed);
  if (import.meta.env.DEV && failed.length) console.debug(`[assembly] ${kind}: ${failed.length} placements failed`, JSON.stringify(failed.map((f) => `${f.group}:${f.id}@${f.x},${f.y},${f.z}`)));
  // Posed sections first, so instructions start with the body (built in the
  // hand) and end with the feet on the baseplate, as Creator booklets do.
  let parts = [...sections, d.b].flatMap((b) => b.parts);
  // A stray plain part that ended up touching nothing (a plate boxed in beside
  // a joint) is left out rather than shipped loose. More than a few would be a
  // design bug, so those stay visible.
  const loose = analyzeStability(parts).floating;
  if (loose.size && loose.size <= 3) parts = parts.filter((p) => !loose.has(p.uid) || !isPlain(p.partId));

  // Centre on the 32×32 baseplate (by where parts show, posed ones included).
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of parts) {
    const { lo, hi } = worldBox(p);
    x0 = Math.min(x0, lo[0]); x1 = Math.max(x1, hi[0]);
    z0 = Math.min(z0, lo[2]); z1 = Math.max(z1, hi[2]);
  }
  const ox = Math.floor((32 - (x1 - x0)) / 2 - x0), oz = Math.floor((32 - (z1 - z0)) / 2 - z0);
  const shift = translate(ox, 0, oz);
  // Baseplate-grid parts move on the grid; posed sections move their pose.
  const bricks: Part[] = parts.map((p) => ({
    ...p,
    ...(p.pose ? { pose: mul(shift, p.pose) } : { x: p.x + ox, z: p.z + oz }),
    ...(p.place ? { place: mul(shift, p.place) } : {}),
  }));

  return evaluateBuild(kind, { title: d.title, rule: d.rule, size: opts.size, seed: opts.seed, species: d.species, failed: failed.length }, bricks, opts.inv);
}

/**
 * The card for a finished model: pieces, what My Library covers, weight,
 * size, load at the weakest joint, difficulty and design metrics. Shared by
 * generated builds and real designs from the corpus.
 */
export function evaluateBuild(
  kind: Kind,
  meta: { title: string; rule: string; size: number; seed: number; species?: Species; failed?: number; recipe?: string },
  bricks: Part[],
  inv: Inventory,
): Build {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of bricks) {
    const { lo, hi } = worldBox(p);
    x0 = Math.min(x0, lo[0]); x1 = Math.max(x1, hi[0]);
    z0 = Math.min(z0, lo[2]); z1 = Math.max(z1, hi[2]);
  }
  const st = analyzeStability(bricks);
  const mm = sizeMM(bricks) ?? { w: 0, d: 0, h: 0 };
  const counts = new Map<string, number>();
  for (const b of bricks) counts.set(invKey(b.partId, b.color), (counts.get(invKey(b.partId, b.color)) ?? 0) + 1);
  const needs = [...counts].map(([k, need]) => {
    const i = k.lastIndexOf(":");
    return { partId: k.slice(0, i), color: Number(k.slice(i + 1)), need, have: Math.min(need, inv[k] ?? 0) };
  });
  const modules: ModuleInfo[] = [];
  for (const b of bricks) {
    const last = modules.find((m) => m.name === b.group);
    if (last) last.parts++;
    else modules.push({ name: b.group, parts: 1 });
  }
  const metrics = measure(bricks);
  return {
    kind,
    species: meta.species,
    recipe: meta.recipe ?? `build-${kind}`,
    title: meta.title,
    math: meta.rule,
    size: meta.size,
    seed: meta.seed,
    bricks,
    palette: [],
    pieces: bricks.length,
    owned: Object.values(inv).reduce((a, b) => a + b, 0),
    coverage: 1,
    substituted: 0,
    missing: 0,
    dropped: 0,
    slopes: bricks.filter((b) => PARTS[b.partId]?.tags?.includes("slope")).length,
    stress: st.worst,
    massG: st.massG,
    mm: [mm.w, mm.d, mm.h],
    needs,
    difficulty: rateDifficulty(bricks, st.worst),
    score: 0,
    W: Math.round(x1 - x0),
    D: Math.round(z1 - z0),
    modules,
    metrics,
    failed: meta.failed ?? 0,
  };
}

export const kindLabel = (k: Kind) => KINDS.find((x) => x.id === k)?.label ?? k;
