import { generateBuild, PLANS, SPECIES, type Plan, type Species } from "../assembly";
import { rng } from "../generate/math";

// The Cookbook: a self-improving library of body plans.
//
// A recipe is a genome — every number of a dinosaur's body plan (torso, neck,
// head, tail, legs, arms, colours) — plus where it came from. The engine
// keeps an archive of the best recipes per species and size (MAP-Elites:
// many good answers, not one), and improves it for as long as it runs:
//
//   pick an elite  →  mutate (and sometimes cross with a relative)
//                  →  build it for real (generateBuild: parts, joints, physics)
//                  →  score it  →  keep it if it beats the cell's weakest elite
//
// Fitness is a weighted sum of measured features, all 0…1:
//   safety     1 − weakest joint's load ratio (must hold: ≤ 1)
//   fidelity   how close the proportions stay to the species' anchor plan
//              (head : torso, tail : torso, legs : torso, neck : torso, depth)
//   pieces     closeness to the size's piece target (S 130, M 220, L 330)
//   richness   share of special parts (slopes, joints, teeth, claws)
//   efficiency studs of volume per piece (fewer, bigger, better-used parts)
//   symmetry   mirror twins across the body
//   fit        stays on the 32×32 baseplate
// A design that fails (a part that can't be placed, anything floating, a
// joint over capacity) scores −1 and never enters the archive.
//
// The weights are the engine's taste, and they learn: when you build or
// follow the steps of one design out of those shown, the weights move toward
// what that design has more of than the others (a preference update). Mutation
// strength adapts per cell (1/5th rule): stuck cells search wider, improving
// ones fine-tune. Everything is plain JSON, so a cookbook can be exported,
// merged, and handed to an LLM as a brief — whose proposals are measured by
// the same fitness before they're allowed in.

export const COOKBOOK_VERSION = 1;
export const SIZES = [0, 1, 2] as const;
const ELITES = 5; // per cell
const FLOOR = 0.15; // a newcomer must be within this of the cell's best
const PIECE_TARGET = [130, 220, 330];

export type Origin = "anchor" | "evolved" | "llm" | "booklet" | "imported";

export interface Features {
  safety: number;
  fidelity: number;
  pieces: number;
  richness: number;
  efficiency: number;
  symmetry: number;
  fit: number;
}
export const FEATURE_KEYS: (keyof Features)[] = ["safety", "fidelity", "pieces", "richness", "efficiency", "symmetry", "fit"];
export type Weights = Features;
export const DEFAULT_WEIGHTS: Weights = { safety: 0.18, fidelity: 0.3, pieces: 0.14, richness: 0.14, efficiency: 0.1, symmetry: 0.09, fit: 0.05 };

export interface Recipe {
  id: string;
  species: Species;
  size: number;
  plan: Plan;
  origin: Origin;
  parent?: string;
  /** Generation it was born in (its cell's counter). */
  gen: number;
  fitness: number;
  features: Features;
  pieces: number;
  /** Builds and finished instructions of this recipe (your vote). */
  likes: number;
  note?: string;
}

export interface Cell {
  elites: Recipe[];
  gen: number;
  sigma: number; // mutation strength, 0.05…0.6
  tries: number;
  wins: number;
}

export interface Cookbook {
  version: number;
  weights: Weights;
  cells: Record<string, Cell>;
  evals: number;
  accepted: number;
  /** Best fitness per species over time (for the progress chart). */
  trend: { evals: number; best: number }[];
  updated: number;
}

export const cellKey = (species: Species, size: number) => `${species}|${size}`;

// ------------------------------------------------------------------ genome

type Path = (string | number)[];
interface Gene {
  path: Path;
  int: boolean;
  /** Bounds: relative to the anchor value (×) or absolute. */
  rel?: [number, number];
  abs?: [number, number];
}

function genesOf(anchor: Plan): Gene[] {
  const g: Gene[] = [
    { path: ["torso", "L"], int: true, rel: [0.7, 1.4] },
    { path: ["torso", "hw"], int: true, abs: [2, 5] },
    { path: ["torso", "H"], int: true, rel: [0.75, 1.35] },
    { path: ["head", "L"], int: true, rel: [0.7, 1.4] },
    { path: ["head", "H"], int: true, rel: [0.75, 1.4] },
    { path: ["head", "snout"], int: true, abs: [1, 5] },
    { path: ["head", "bend"], int: false, abs: [-60, 10] },
    { path: ["tail", "n"], int: true, abs: [2, 4] },
    { path: ["tail", "L"], int: true, rel: [0.7, 1.4] },
    { path: ["tail", "H"], int: true, rel: [0.7, 1.35] },
    { path: ["tail", "taper"], int: false, abs: [0.45, 0.85] },
    { path: ["hind", "thigh", 0], int: true, abs: [2, 5] },
    { path: ["hind", "thigh", 1], int: true, rel: [0.75, 1.3] },
    { path: ["hind", "shin", 1], int: true, rel: [0.75, 1.3] },
    { path: ["hind", "foot"], int: true, abs: [2, 5] },
  ];
  if (anchor.biped) g.push({ path: ["torso", "pitch"], int: false, abs: [-5, 25] });
  if (anchor.head.jawOpen > 0) g.push({ path: ["head", "jawOpen"], int: false, abs: [10, 40] });
  anchor.tail.bend.forEach((_, i) => g.push({ path: ["tail", "bend", i], int: false, abs: [-20, 15] }));
  if (anchor.neck)
    g.push(
      { path: ["neck", "n"], int: true, abs: [1, anchor.neck.n > 1 ? 4 : 2] },
      { path: ["neck", "L"], int: true, rel: [0.7, 1.4] },
      { path: ["neck", "H"], int: true, rel: [0.75, 1.3] },
      { path: ["neck", "bend"], int: false, abs: [-20, 50] },
    );
  if (anchor.fore)
    g.push(
      { path: ["fore", "thigh", 1], int: true, rel: [0.75, 1.3] },
      { path: ["fore", "shin", 1], int: true, rel: [0.75, 1.3] },
    );
  if (anchor.arms) g.push({ path: ["arms", "len"], int: true, rel: [0.7, 1.4] }, { path: ["arms", "reach"], int: false, abs: [0, 60] });
  return g;
}

const get = (o: unknown, p: Path): number => p.reduce<unknown>((a, k) => (a as Record<string | number, unknown>)[k], o) as number;
function set(o: unknown, p: Path, v: number) {
  const parent = p.slice(0, -1).reduce<unknown>((a, k) => (a as Record<string | number, unknown>)[k], o) as Record<string | number, unknown>;
  parent[p[p.length - 1]] = v;
}
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

function bounds(gene: Gene, anchor: Plan): [number, number] {
  if (gene.abs) return gene.abs;
  const a = get(anchor, gene.path);
  return [Math.max(gene.int ? 1 : 0, a * gene.rel![0]), a * gene.rel![1]];
}

/** Keep every gene inside its bounds (and the tail-bend list as long as the tail). */
export function repair(plan: Plan, species: Species): Plan {
  const anchor = PLANS[species];
  const p = clone(plan);
  // Structure stays the species' own: two or four legs, neck or not, its features.
  p.biped = anchor.biped;
  p.features = [...anchor.features];
  if (!anchor.neck) delete p.neck;
  else p.neck ??= clone(anchor.neck);
  if (!anchor.fore) delete p.fore;
  else p.fore ??= clone(anchor.fore);
  if (!anchor.arms) delete p.arms;
  else p.arms ??= clone(anchor.arms);
  p.tail.bend = Array.from({ length: anchor.tail.bend.length }, (_, i) => p.tail.bend?.[i] ?? anchor.tail.bend[i]);
  p.head.teeth = anchor.head.teeth;
  if (!anchor.head.jawOpen) p.head.jawOpen = 0;
  if (!anchor.biped) p.torso.pitch = anchor.torso.pitch;
  for (const g of genesOf(anchor)) {
    const [lo, hi] = bounds(g, anchor);
    let v = Number(get(p, g.path));
    if (!Number.isFinite(v)) v = get(anchor, g.path);
    v = Math.min(hi, Math.max(lo, v));
    set(p, g.path, g.int ? Math.round(v) : Math.round(v * 100) / 100);
  }
  // Colours: only the species' own (a mutation may reorder them).
  for (const k of ["main", "belly", "accent"] as const) {
    const allowed = anchor.colors[k];
    const mine = (p.colors?.[k] ?? []).filter((c) => allowed.includes(c));
    p.colors[k] = [...new Set([...mine, ...allowed])];
  }
  return p;
}

/** A child: a few genes nudged by a Gaussian of strength `sigma` (fraction of the range). */
export function mutate(plan: Plan, species: Species, sigma: number, r: () => number): Plan {
  const anchor = PLANS[species];
  const p = clone(plan);
  const genes = genesOf(anchor);
  const n = 1 + Math.floor(r() * 3);
  const gauss = () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
  for (let k = 0; k < n; k++) {
    const g = genes[Math.floor(r() * genes.length)];
    const [lo, hi] = bounds(g, anchor);
    let v = get(p, g.path) + gauss() * sigma * (hi - lo);
    if (g.int && Math.round(v) === get(p, g.path)) v += r() < 0.5 ? -1 : 1; // an integer gene must actually move
    set(p, g.path, v);
  }
  if (r() < 0.15) {
    // Bring another colour of the species to the front.
    const k = (["main", "belly", "accent"] as const)[Math.floor(r() * 3)];
    const xs = p.colors[k];
    if (xs.length > 1) xs.unshift(...xs.splice(1 + Math.floor(r() * (xs.length - 1)), 1));
  }
  return repair(p, species);
}

/** Uniform crossover of two plans of the same species. */
export function cross(a: Plan, b: Plan, species: Species, r: () => number): Plan {
  const p = clone(a);
  for (const g of genesOf(PLANS[species])) if (r() < 0.5) set(p, g.path, get(b, g.path));
  return repair(p, species);
}

// ----------------------------------------------------------------- fitness

/** Proportions that make the species recognisable, in torso lengths. */
function proportions(p: Plan) {
  const T = p.torso.L;
  return [
    p.head.L / T,
    (p.tail.n * p.tail.L) / T,
    (p.hind.thigh[1] + p.hind.shin[1]) / 2.5 / T,
    p.neck ? (p.neck.n * p.neck.L) / T : 0,
    p.torso.H / 3 / T,
    p.head.H / p.head.L,
  ];
}

export interface Evaluation {
  fitness: number;
  features: Features;
  pieces: number;
  ok: boolean;
  why?: string;
}

const score = (f: Features, w: Weights) => FEATURE_KEYS.reduce((s, k) => s + w[k] * f[k], 0) / FEATURE_KEYS.reduce((s, k) => s + w[k], 0);

/** Build a plan for real at one size (two colour seeds) and measure it. */
export function evaluate(plan: Plan, species: Species, size: number, w: Weights): Evaluation {
  let worst: Evaluation | null = null;
  for (const seed of [1, 2]) {
    const b = generateBuild("dino", { size, level: 2, seed, mode: "any", inv: {}, species, plan });
    const fail = b.failed > 0 ? "a part could not be placed" : !Number.isFinite(b.stress) ? "parts float" : b.stress > 1 ? "a joint is overloaded" : "";
    const a = proportions(PLANS[species]), q = proportions(plan);
    const dev = a.reduce((s, v, i) => s + (v ? ((q[i] - v) / v) ** 2 : 0), 0);
    const T = PIECE_TARGET[size];
    const f: Features = {
      safety: Math.max(0, 1 - b.stress),
      fidelity: Math.exp(-dev / 0.08),
      pieces: Math.exp(-(((b.pieces - T) / T) ** 2) / 0.12),
      richness: Math.min(1, b.metrics.special / 0.35),
      efficiency: Math.min(1, b.metrics.efficiency / 8),
      symmetry: b.metrics.symmetry,
      fit: b.W <= 32 && b.D <= 32 ? 1 : Math.max(0, 1 - (Math.max(b.W, b.D) - 32) / 16),
    };
    const e: Evaluation = fail ? { fitness: -1, features: f, pieces: b.pieces, ok: false, why: fail } : { fitness: score(f, w), features: f, pieces: b.pieces, ok: true };
    if (!worst || e.fitness < worst.fitness) worst = e;
  }
  return worst!;
}

// ------------------------------------------------------------------ archive

let idCounter = 0;
const newId = (species: string) => `${species}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;
const genomeKey = (p: Plan) => JSON.stringify(p);

/** A fresh cookbook: every species' anchor plan, measured at every size. */
export function seedCookbook(w: Weights = DEFAULT_WEIGHTS): Cookbook {
  const cb: Cookbook = { version: COOKBOOK_VERSION, weights: { ...w }, cells: {}, evals: 0, accepted: 0, trend: [], updated: Date.now() };
  for (const sp of SPECIES)
    for (const size of SIZES) {
      const plan = repair(PLANS[sp.id], sp.id);
      const e = evaluate(plan, sp.id, size, cb.weights);
      cb.evals++;
      cb.cells[cellKey(sp.id, size)] = {
        elites: e.ok ? [{ id: newId(sp.id), species: sp.id, size, plan, origin: "anchor", gen: 0, fitness: e.fitness, features: e.features, pieces: e.pieces, likes: 0 }] : [],
        gen: 0,
        sigma: 0.25,
        tries: 0,
        wins: 0,
      };
    }
  return cb;
}

/** Offer a recipe to its cell; true if it made the elites. */
export function offer(cb: Cookbook, rec: Omit<Recipe, "fitness" | "features" | "pieces" | "id" | "gen" | "likes"> & Partial<Recipe>): { accepted: boolean; evaluation: Evaluation } {
  const key = cellKey(rec.species, rec.size);
  const cell = (cb.cells[key] ??= { elites: [], gen: 0, sigma: 0.25, tries: 0, wins: 0 });
  const plan = repair(rec.plan, rec.species);
  const e = evaluate(plan, rec.species, rec.size, cb.weights);
  cb.evals++;
  cell.tries++;
  if (!e.ok || cell.elites.some((x) => genomeKey(x.plan) === genomeKey(plan))) return { accepted: false, evaluation: e };
  const weakest = cell.elites.length >= ELITES ? cell.elites[cell.elites.length - 1] : null;
  if (weakest && e.fitness <= weakest.fitness) return { accepted: false, evaluation: e };
  const best = cell.elites[0]?.fitness ?? -Infinity;
  // Room in a cell is for variety, not for clearly worse designs.
  if (e.fitness < best - FLOOR) return { accepted: false, evaluation: { ...e, why: "well below the best so far" } };
  cell.elites.push({ likes: 0, ...rec, plan, id: rec.id ?? newId(rec.species), gen: cell.gen, fitness: e.fitness, features: e.features, pieces: e.pieces });
  cell.elites.sort((a, b) => b.fitness - a.fitness);
  cell.elites.length = Math.min(cell.elites.length, ELITES);
  if (e.fitness > best) cell.wins++;
  cb.accepted++;
  cb.updated = Date.now();
  return { accepted: true, evaluation: e };
}

/**
 * One step of the search: a child of one of a cell's elites (sometimes
 * crossed with an elite of another size of the same species), offered back.
 */
export function step(cb: Cookbook, r: () => number): { key: string; accepted: boolean } {
  const keys = Object.keys(cb.cells);
  const key = keys[Math.floor(r() * keys.length)];
  const cell = cb.cells[key];
  const [species, s] = key.split("|");
  const size = Number(s);
  const sp = species as Species;
  if (!cell.elites.length) {
    const res = offer(cb, { species: sp, size, plan: mutate(PLANS[sp], sp, 0.3, r), origin: "evolved" });
    return { key, accepted: res.accepted };
  }
  // Tournament of two, with your likes as a tie-breaker.
  const pick = () => cell.elites[Math.floor(r() * cell.elites.length)];
  const [a, b] = [pick(), pick()];
  const parent = a.fitness + 0.02 * Math.log1p(a.likes) >= b.fitness + 0.02 * Math.log1p(b.likes) ? a : b;
  let plan = mutate(parent.plan, sp, cell.sigma, r);
  if (r() < 0.2) {
    const other = cb.cells[cellKey(sp, SIZES[Math.floor(r() * 3)])]?.elites[0];
    if (other) plan = cross(plan, other.plan, sp, r);
  }
  const before = cell.wins;
  cell.gen++;
  const res = offer(cb, { species: sp, size, plan, origin: "evolved", parent: parent.id });
  // 1/5th rule: improving often → finer steps; rarely → wider search.
  const won = cell.wins > before;
  cell.sigma = Math.min(0.6, Math.max(0.05, cell.sigma * (won ? 1.22 : 0.96)));
  if (cb.evals % 50 === 0) {
    const best = Object.values(cb.cells).reduce((s, c) => s + (c.elites[0]?.fitness ?? 0), 0) / Math.max(1, keys.length);
    cb.trend.push({ evals: cb.evals, best });
    if (cb.trend.length > 400) cb.trend.splice(0, cb.trend.length - 400);
  }
  return { key, accepted: res.accepted };
}

/**
 * Re-score every elite after the weights changed (taste moved), so the
 * archive ranks by what you like now.
 */
export function rescore(cb: Cookbook) {
  for (const cell of Object.values(cb.cells)) {
    for (const e of cell.elites) e.fitness = score(e.features, cb.weights);
    cell.elites.sort((a, b) => b.fitness - a.fitness);
  }
}

/**
 * Learn taste from a choice: of the designs shown, you built (or followed the
 * steps of) `chosen`. Weights move toward the features it has more of than
 * the average shown — a perceptron-style preference update.
 */
export function learnChoice(cb: Cookbook, shown: Features[], chosen: Features, strength = 1) {
  const lr = 0.04 * strength;
  for (const k of FEATURE_KEYS) {
    const mean = shown.reduce((s, f) => s + f[k], 0) / Math.max(1, shown.length);
    cb.weights[k] = Math.max(0.02, cb.weights[k] + lr * (chosen[k] - mean));
  }
  const sum = FEATURE_KEYS.reduce((s, k) => s + cb.weights[k], 0);
  for (const k of FEATURE_KEYS) cb.weights[k] /= sum;
  rescore(cb);
}

/** The recipe to build for a card: an elite of the cell, the fitter (and liked) the likelier. */
export function choose(cb: Cookbook | null, species: Species, size: number, seed: number): Recipe | null {
  const cell = cb?.cells[cellKey(species, size)];
  if (!cell?.elites.length) return null;
  const r = rng(seed * 7919 + size);
  const w = cell.elites.map((e) => Math.exp(8 * e.fitness) * (1 + 0.2 * Math.log1p(e.likes)));
  let t = r() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < w.length; i++) if ((t -= w[i]) <= 0) return cell.elites[i];
  return cell.elites[0];
}

export function like(cb: Cookbook, id: string, by = 1) {
  for (const cell of Object.values(cb.cells)) for (const e of cell.elites) if (e.id === id) e.likes += by;
}

/** Merge another cookbook in (each of its elites offered to the matching cell). */
export function merge(cb: Cookbook, other: Cookbook): number {
  let n = 0;
  for (const cell of Object.values(other.cells ?? {}))
    for (const e of cell.elites ?? [])
      if (SPECIES.some((s) => s.id === e.species) && offer(cb, { ...e, origin: e.origin === "anchor" ? "imported" : e.origin, id: undefined }).accepted) n++;
  return n;
}

// -------------------------------------------------------------------- LLMs

/**
 * A brief for any LLM: what a recipe is, how it's judged, what's best so far,
 * and the answer format. Paste its reply into ingest(). Models good at
 * anatomy or at LEGO building will propose different things; the fitness
 * decides what stays.
 */
export function brief(cb: Cookbook, focus?: Species): string {
  const species = focus ? [focus] : SPECIES.map((s) => s.id);
  const best = species.map((sp) => ({ species: sp, best: SIZES.map((sz) => cb.cells[cellKey(sp, sz)]?.elites[0]).filter(Boolean).map((e) => ({ size: e!.size, fitness: +e!.fitness.toFixed(3), plan: e!.plan })) }));
  return [
    "You are improving the body plans of brick-built dinosaurs (LEGO Creator style).",
    "Each plan is built for real by a deterministic engine: rigid sections (torso, neck, head with jaw, tail sections, thighs, shins, arms) joined by Joint-8 ball joints, bodies lofted from bricks/plates with curved slopes on top, legs solved by two-bone IK to feet on a baseplate.",
    "Units: studs for lengths along a section (L), half-width in studs (hw), heights in plates (H; 3 plates = 1 brick); angles in degrees; leg entries are [thickness in studs, joint-to-joint length in plates].",
    `A design is rejected if a part can't be placed, anything floats, or a ball joint is overloaded. Otherwise fitness = weighted mean of: ${FEATURE_KEYS.map((k) => `${k} ${cb.weights[k].toFixed(2)}`).join(", ")}.`,
    "fidelity compares head:torso, tail:torso, legs:torso, neck:torso, torso depth and head shape to the species' anchor; pieces targets 130 / 220 / 330 for sizes 0 / 1 / 2.",
    "Keep each species' structure (two or four legs, neck or not, features); change the numbers. Think about real anatomy, balance over the hips, and how LEGO designers shape bodies.",
    "Current best plans:",
    JSON.stringify(best),
    'Answer with JSON only: an array of {"species": "...", "size": 0|1|2, "plan": {…same shape…}, "note": "why"}. Up to 12 proposals.',
  ].join("\n\n");
}

/** Read an LLM's (or a booklet study's) proposals and offer each; returns what happened to each. */
export function ingest(cb: Cookbook, text: string, origin: Origin = "llm"): { species: string; size: number; accepted: boolean; fitness: number; why?: string }[] {
  const at = text.indexOf("["), end = text.lastIndexOf("]");
  if (at < 0 || end < at) throw new Error("No JSON array found in the reply.");
  const list = JSON.parse(text.slice(at, end + 1)) as { species: Species; size?: number; plan: Plan; note?: string }[];
  const out = [];
  for (const p of list) {
    if (!SPECIES.some((s) => s.id === p.species) || !p.plan) continue;
    const anchor = PLANS[p.species];
    // Fill anything the proposal left out from the anchor, then measure.
    const plan = repair({ ...clone(anchor), ...p.plan, torso: { ...anchor.torso, ...p.plan.torso }, head: { ...anchor.head, ...p.plan.head }, tail: { ...anchor.tail, ...p.plan.tail }, hind: { ...anchor.hind, ...p.plan.hind } } as Plan, p.species);
    for (const size of p.size === undefined ? SIZES : [p.size]) {
      const res = offer(cb, { species: p.species, size, plan, origin, note: p.note });
      out.push({ species: p.species, size, accepted: res.accepted, fitness: res.evaluation.fitness, why: res.evaluation.why });
    }
  }
  return out;
}
