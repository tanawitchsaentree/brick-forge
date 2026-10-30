import { partLines, withMadeParts } from "../engine/ldraw";
import type { PlacedBrick } from "../engine/grid";
import { PARTS } from "../engine/parts";
import type { PlanReply, PlanRequest } from "./planWorker";

// Steps from the assembly planner for a model with no designer's steps: the
// model written as LDraw (each part's lines noted), planned in a worker, and
// the plan's parts mapped back to the model's by the line each came from.
// On by default: side by side with the booklet on 31009 it follows the booklet's
// base and ring where the height split scattered parts over the plate and left wall
// pieces standing apart (docs/engine/assembly-planning.md). localStorage
// "lego-builder:planner" = "0" turns it off.

export const plannerOn = () => typeof localStorage === "undefined" || localStorage.getItem("lego-builder:planner") !== "0";

/** True when the model has no steps of its own: a new design (some or all parts without one), or a file without STEP lines. */
export const needsPlan = (bricks: PlacedBrick[]) => bricks.length > 1 && (bricks.some((b) => b.step === undefined) || new Set(bricks.map((b) => b.step)).size <= 1);

let worker: Worker | null = null;
let ticket = 0;
const waiting = new Map<number, (r: PlanReply) => void>();

/** The model's build steps as groups of brick indices, in order; null if the planner failed. */
export async function planSteps(bricks: PlacedBrick[]): Promise<number[][] | null> {
  // The model as LDraw, remembering which lines each brick wrote.
  const lines = ["0 model", "0 Name: model.ldr", "0 Author: Brick Forge", ""];
  const lineOf: number[] = []; // line → brick (before made parts may add a FILE line on top)
  bricks.forEach((b, i) => {
    for (const l of partLines(b)) {
      lineOf[lines.length] = i;
      lines.push(l);
    }
  });
  const text = withMadeParts(lines, bricks, "model");
  const shift = /^0\s+FILE/i.test(lines[0]) ? 1 : 0; // withMadeParts put a FILE line on top

  // One model at a time: a plan still running (a big model, up to ~20 s) is for a view
  // that's gone, so its worker is dropped rather than queued behind.
  if (waiting.size && worker) {
    worker.terminate();
    worker = null;
    for (const [id, resolve] of waiting) resolve({ id, error: "superseded" });
    waiting.clear();
  }
  worker ??= (() => {
    const w = new Worker(new URL("./planWorker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<PlanReply>) => {
      waiting.get(e.data.id)?.(e.data);
      waiting.delete(e.data.id);
    };
    return w;
  })();
  const id = ++ticket;
  const reply = await new Promise<PlanReply>((resolve) => {
    waiting.set(id, resolve);
    worker!.postMessage({ id, text } satisfies PlanRequest);
  });
  if ("error" in reply) {
    if (import.meta.env.DEV && reply.error !== "superseded") console.warn("[planner]", reply.error);
    return null;
  }
  const { plan } = reply;
  const brickOf = plan.nodes.map((n) => lineOf[n.src.line - shift]);
  if (brickOf.some((b) => b === undefined)) return null; // lines don't line up: keep the default steps
  const placed = new Set<number>();
  const groups: number[][] = [];
  for (const s of plan.steps) {
    const g = [...new Set(s.parts.map((p) => brickOf[p]))].filter((b) => !placed.has(b));
    g.forEach((b) => placed.add(b));
    if (g.length) groups.push(g);
  }
  // Parts the planner left out (hoses, cables, parts it doesn't know) go on last.
  const rest = bricks.map((_, i) => i).filter((i) => !placed.has(i));
  for (let k = 0; k < rest.length; k += 4) groups.push(rest.slice(k, k + 4));
  if (import.meta.env.DEV) {
    (globalThis as { __planText?: string }).__planText = text; // to reproduce a plan in scripts/plan-bench.mjs
    const off = plan.nodes.filter((n, k) => !PARTS[bricks[brickOf[k]].partId]?.components && n.id.replace(/\.dat$/i, "").toLowerCase() !== String(PARTS[bricks[brickOf[k]].partId]?.id).toLowerCase()).length;
    console.debug(`[planner] ${bricks.length} parts → ${groups.length} steps in ${Math.round(plan.stats.ms)} ms; first ${groups[0]?.map((b) => `${bricks[b].partId}@y${bricks[b].y}`).join(",")}; ${off} id mismatches; lowest y ${Math.min(...bricks.filter((b) => !b.place && !b.pose).map((b) => b.y))}`);
  }
  return groups;
}
