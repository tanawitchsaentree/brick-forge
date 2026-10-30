import { makeLibrary, type Library, type Vec3 } from "./library";
import { flatten, type Node } from "./ldraw";
import { connectionGraph, contactFallback } from "./graph";
import { blocking, interlocks } from "./blocking";
import { planAssembly, type Plan, type PlanWeights } from "./planner";

// The planner's output for the app and for robots: plain JSON. Booklet-sized steps
// grouped from the planned order, and each part with its pose and where it comes from
// in the file, so a viewer can match it to its own import of the same text.

export interface BuildStep {
  parts: number[]; // node indices put on in this step
  dir: Vec3; // insertion direction (LDraw axes, −y up)
  scope: string; // sub-model instance being built ("" = the main model)
  /** "subassembly": puts on a sub-assembly built in the steps before. */
  kind: "parts" | "subassembly";
  note?: string; // a constraint relaxed, or a step joining two pieces
}
export interface BuildPlan {
  nodes: { id: string; color: number; matrix: number[]; path: string; src: { file: string; line: number } }[];
  steps: BuildStep[];
  flexLeftOut: Record<string, number>;
  unknown: Record<string, number>;
  stats: { parts: number; units: number; steps: number; forced: number; ms: number };
}

/**
 * Units → steps: consecutive units of one scope, inserted the same way and close together
 * (within `reach` LDU of the step's first part), up to `size` parts (the corpus booklets'
 * median is about 5). A sub-assembly going on is a step of its own.
 */
export function groupSteps(plan: Plan, nodes: Node[], size = 5, reach = 80): BuildStep[] {
  const out: BuildStep[] = [];
  const placed = new Set<number>();
  for (const s of plan.steps) {
    const fresh = s.unit.filter((p) => !placed.has(p));
    s.unit.forEach((p) => placed.add(p));
    const note = s.forced ? `relaxed: ${s.forced}` : s.joins ? "joins two pieces" : undefined;
    if (!fresh.length) {
      out.push({ parts: s.unit, dir: s.dir, scope: s.scope, kind: "subassembly", note });
      continue;
    }
    const last = out[out.length - 1];
    const same = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] > 0.999;
    const near = last && last.kind === "parts" && Math.hypot(...([0, 1, 2].map((k) => nodes[fresh[0]].xf.t[k] - nodes[last.parts[0]].xf.t[k]) as Vec3)) <= reach;
    if (last && last.kind === "parts" && last.scope === s.scope && same(last.dir, s.dir) && near && last.parts.length + fresh.length <= size && !note && !last.note) last.parts.push(...fresh);
    else out.push({ parts: fresh, dir: s.dir, scope: s.scope, kind: "parts", note });
  }
  return out;
}

/** Plan a model with a synchronous library (Node scripts; or after `prefetch`). */
export function buildPlan(text: string, lib: Library, opts: { weights?: PlanWeights; beam?: number; stepSize?: number } = {}): BuildPlan {
  const t0 = performance.now();
  const flat = flatten(text, lib);
  const nodes = flat.nodes;
  const e0 = connectionGraph(lib, nodes);
  const edges = e0.concat(contactFallback(lib, nodes, e0));
  let blk = blocking(lib, nodes, edges);
  const inferred = interlocks(nodes, blk);
  if (inferred.length) edges.push(...inferred), (blk = blocking(lib, nodes, edges));
  const plan = planAssembly(nodes, edges, blk, { weights: opts.weights, beam: opts.beam });
  const steps = groupSteps(plan, nodes, opts.stepSize);
  return {
    nodes: nodes.map((n) => ({ id: n.id, color: n.color, matrix: [...n.xf.R, ...n.xf.t], path: n.path, src: n.src })),
    steps,
    flexLeftOut: flat.flex,
    unknown: flat.unknown,
    stats: { parts: nodes.length, units: plan.steps.length, steps: steps.length, forced: plan.steps.filter((s) => s.forced).length, ms: Math.round(performance.now() - t0) },
  };
}

/**
 * Plan with files fetched asynchronously (the browser: LDraw from shards, the shadow
 * library from wherever it's served). Runs the pipeline against a cache, collects the
 * files it missed, fetches them, and repeats until nothing new is asked for.
 */
export async function planModel(text: string, fetchFile: (path: string) => Promise<string | null>, dirs = { ldraw: "ldraw", shadow: "shadow" }, opts: Parameters<typeof buildPlan>[2] = {}): Promise<BuildPlan> {
  const cache = new Map<string, string | null>();
  for (let round = 0; round < 40; round++) {
    const missed = new Set<string>();
    const read = (p: string) => {
      if (cache.has(p)) return cache.get(p)!;
      missed.add(p);
      return null;
    };
    const lib = makeLibrary(read, dirs.ldraw, dirs.shadow);
    // Touch every part (and its references) the model uses.
    const flat = flatten(text, lib);
    for (const n of flat.nodes) lib.mesh(n.id);
    if (!missed.size) return buildPlan(text, lib, opts);
    await Promise.all([...missed].map(async (p) => cache.set(p, await fetchFile(p).catch(() => null))));
  }
  throw new Error("planModel: library files kept missing after 40 rounds");
}
