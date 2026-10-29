import { F1_ANCHOR, LIVERIES, PLANS, SPECIES, generateBuild, type Build, type F1Plan, type Plan, type Species } from "../assembly";

// What the cookbook can learn: families of designs, each with its own genome.
// A family knows its anchor (the plan its knowledge comes from: a species'
// body plan, the 77244 car), which numbers may change and how far (genes),
// how to keep a plan structurally sound, how to build one, and which
// proportions make it recognisable (fidelity is measured on those).

export type AnyPlan = Plan | F1Plan;
type Path = (string | number)[];
export interface Gene {
  path: Path;
  int: boolean;
  /** Bounds: relative to the anchor value (×) or absolute. */
  rel?: [number, number];
  abs?: [number, number];
}

export interface Family {
  id: string;
  label: string;
  variants: { id: string; label: string }[];
  pieceTarget: number[]; // per size
  anchor(variant: string, size: number): AnyPlan;
  genes(anchor: AnyPlan): Gene[];
  /** Keep structure the family's own after a mutation (counts, lists, features). */
  fix(plan: AnyPlan, variant: string, size: number): AnyPlan;
  build(plan: AnyPlan, variant: string, size: number, seed: number): Build;
  proportions(plan: AnyPlan): number[];
  /** Recolour moves (a mutation of the palette genes). */
  recolor?(plan: AnyPlan, r: () => number): void;
}

export const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

// ------------------------------------------------------------- dinosaurs

const dino: Family = {
  id: "dino",
  label: "Dinosaurs",
  variants: SPECIES.map((s) => ({ id: s.id, label: s.label })),
  pieceTarget: [130, 220, 330],
  anchor: (v) => PLANS[v as Species],
  genes(a0) {
    const anchor = a0 as Plan;
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
    if (anchor.fore) g.push({ path: ["fore", "thigh", 1], int: true, rel: [0.75, 1.3] }, { path: ["fore", "shin", 1], int: true, rel: [0.75, 1.3] });
    if (anchor.arms) g.push({ path: ["arms", "len"], int: true, rel: [0.7, 1.4] }, { path: ["arms", "reach"], int: false, abs: [0, 60] });
    return g;
  },
  fix(plan0, v) {
    const anchor = PLANS[v as Species];
    const p = clone(plan0) as Plan;
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
    for (const k of ["main", "belly", "accent"] as const) {
      const allowed = anchor.colors[k];
      const mine = (p.colors?.[k] ?? []).filter((c) => allowed.includes(c));
      p.colors[k] = [...new Set([...mine, ...allowed])];
    }
    return p;
  },
  build: (plan, v, size, seed) => generateBuild("dino", { size, level: 2, seed, mode: "any", inv: {}, species: v as Species, plan: plan as Plan }),
  proportions(p0) {
    const p = p0 as Plan;
    const T = p.torso.L;
    return [p.head.L / T, (p.tail.n * p.tail.L) / T, (p.hind.thigh[1] + p.hind.shin[1]) / 2.5 / T, p.neck ? (p.neck.n * p.neck.L) / T : 0, p.torso.H / 3 / T, p.head.H / p.head.L];
  },
  recolor(p0, r) {
    const p = p0 as Plan;
    const k = (["main", "belly", "accent"] as const)[Math.floor(r() * 3)];
    const xs = p.colors[k];
    if (xs.length > 1) xs.unshift(...xs.splice(1 + Math.floor(r() * (xs.length - 1)), 1));
  },
};

// --------------------------------------------------------------- F1 cars

const f1: Family = {
  id: "f1",
  label: "F1 cars",
  variants: [{ id: "f1", label: "F1 car" }],
  // 77244 is 265 pieces with stickers and printed parts; ours carry no prints.
  pieceTarget: [120, 160, 200],
  anchor: (_v, size) => F1_ANCHOR(size),
  genes: () => [
    { path: ["L"], int: true, rel: [0.85, 1.2] },
    { path: ["frontAxle"], int: true, abs: [4, 8] },
    { path: ["rearAxle"], int: true, abs: [2, 5] },
    { path: ["cockpit"], int: false, abs: [0.45, 0.65] },
    { path: ["podH"], int: true, abs: [3, 6] },
    { path: ["rearWingY"], int: true, abs: [11, 15] },
    { path: ["frontWing"], int: true, abs: [4, 5] },
    { path: ["rearWing"], int: true, abs: [3, 5] },
    { path: ["livery"], int: true, abs: [0, LIVERIES.length - 1] },
  ],
  fix(p0) {
    const p = clone(p0) as F1Plan;
    // A wheelbase long enough for sidepods between the wheels, a cockpit inside it.
    const minL = p.frontAxle + p.rearAxle + 9;
    if (p.L < minL) p.L = minL;
    return p;
  },
  build: (plan, _v, size, seed) => generateBuild("racer", { size, level: 2, seed, mode: "any", inv: {}, plan: plan as F1Plan }),
  proportions(p0) {
    const p = p0 as F1Plan;
    return [p.frontAxle / p.L, p.rearAxle / p.L, (p.L - p.frontAxle - p.rearAxle) / p.L, p.cockpit, p.rearWingY / 12, p.frontWing / 5];
  },
};

export const FAMILIES: Family[] = [dino, f1];
const byVariant = new Map(FAMILIES.flatMap((f) => f.variants.map((v) => [v.id, f] as const)));

/** The family a variant (a species, "f1") belongs to. */
export function familyOf(variant: string): Family {
  const f = byVariant.get(variant);
  if (!f) throw new Error(`Unknown design variant: ${variant}`);
  return f;
}
export const VARIANTS = FAMILIES.flatMap((f) => f.variants);
