import type { Tier } from "../engine/style";
import { hasShape, installShapeBits, installShapes, partShape, voxelize, type Voxels } from "../engine/shape";
import { scanPart } from "./shapeScan";
import { blend, blockify, lengthAxis, moveCells, seat, seatOffset, stretch, stretchParts } from "../engine/morph";
import { PARTS } from "../engine/parts";
import type { BuildReply, BuildRequest, InitMessage, RigRequest, ScaleRequest } from "../engine/sculptWorker";
import type { Build, generateBuild } from "../engine/assembly";
import type { Kind } from "../engine/assembly/kinds";
import type { PackedForm } from "../engine/sculpt";
import { catalogData } from "../engine/catalog";
import type { PlacedBrick } from "../engine/grid";
import { loadDesign, type CorpusModel } from "./corpus";
import { makeParts } from "./ldraw";
import { VARIANTS, pickBest } from "../engine/select/bestOfK";

// New designs from the learned engine: a target shape varied from real
// designs (longer, shorter, a cross of two), built by the sculptor in a
// worker from the forms LEGO's designers use. Made-to-measure parts it adds
// are registered here so they render and export.

// A small pool of workers, so a batch of designs builds in parallel (one per
// spare core, up to 4); each request goes to the least busy one.
const workers: { w: Worker; busy: number; tiers: Set<Tier> }[] = [];
let ticket = 0;
const waiting = new Map<number, (r: BuildReply) => void>();
let shared: Promise<void> | null = null;
// Each tier's forms, fetched once by the page and handed to each worker the first time it builds in that tier.
const vocab = new Map<Tier, Promise<PackedForm[]>>();
const formsOf = (tier: Tier) => {
  let f = vocab.get(tier);
  if (!f) {
    f = fetch(`/forms/${tier}.json`).then((r) => r.json() as Promise<PackedForm[]>);
    vocab.set(tier, f);
  }
  return f;
};

/**
 * Workers start with what they share (catalog, part shapes), fetched once by
 * the page rather than once per worker.
 */
let quick: (typeof workers)[number] | undefined;
function ensure() {
  shared ??= (async () => {
    const [catalog, shapes] = await Promise.all([catalogData(), fetch("/shapes.json").then((r) => r.json())]);
    installShapes(shapes);
    const n = parallel();
    // One more worker for the short jobs (rig builds, scaling a target): on the
    // others they waited behind a minute-long sculpt.
    for (let i = 0; i <= n; i++) {
      const w = new Worker(new URL("../engine/sculptWorker.ts", import.meta.url), { type: "module" });
      const slot = { w, busy: 0, tiers: new Set<Tier>() };
      w.onmessage = (e: MessageEvent<BuildReply>) => {
        slot.busy--;
        waiting.get(e.data.ticket)?.(e.data);
        waiting.delete(e.data.ticket);
      };
      w.postMessage({ type: "init", catalog: catalog!, shapes } satisfies InitMessage);
      if (i === n) quick = slot;
      else workers.push(slot);
    }
  })();
  return shared;
}

/** How many designs can be built at once. */
// Two at most, so a batch doesn't take every core (fans, a laptop heating up) while the page is in use.
export const parallel = () => Math.max(1, Math.min(2, (navigator.hardwareConcurrency || 2) - 1));

export type Variation = { kind: "longer" | "shorter" | "wider"; studs: number } | { kind: "cross"; with: CorpusModel; t: number };

const studs = (n: number) => `${n} stud${n === 1 ? "" : "s"}`;
export const describe = (v: Variation) =>
  v.kind === "cross"
    ? `crossed with ${v.with.model && !v.with.name.includes(v.with.model) ? `${v.with.name} (${v.with.model})` : v.with.name} ${v.with.set.replace(/-1$/, "")}`
    : v.kind === "longer" ? `${studs(v.studs)} longer` : v.kind === "wider" ? `${studs(v.studs)} wider` : `${studs(-v.studs)} shorter`;

/** The new shape, and the parent's parts moved with it (seated on the baseplate together). */
/** Parts made from a model file have no scanned shape yet: scan them (so they voxelize as what they are). */
async function scanMade(parts: PlacedBrick[]) {
  for (const id of new Set(parts.map((b) => b.partId)))
    if (PARTS[id]?.made && !hasShape(id)) installShapeBits(id, await scanPart(PARTS[id]));
}

async function targetOf(base: CorpusModel, v: Variation, tier: Tier): Promise<{ target: Voxels; donors: PlacedBrick[] }> {
  const parts = await loadDesign(base.id);
  await scanMade(parts);
  if (v.kind === "cross") await scanMade(await loadDesign(v.with.id));
  const a = voxelize(parts);
  let shape: Voxels, donors: PlacedBrick[];
  if (v.kind === "cross") {
    shape = blend(a, voxelize(await loadDesign(v.with.id)), v.t);
    donors = v.t < 0.5 ? parts.map((b) => moveCells(b, 0, 0, 0)) : [];
  } else {
    // Longer and shorter along the length; wider across it, the same way (a copied section).
    const length = lengthAxis(a);
    const axis = v.kind === "wider" ? (length === 0 ? 2 : 0) : length;
    shape = stretch(a, axis, v.studs);
    donors = stretchParts(parts, a, axis, v.studs);
  }
  // The tier's scale: Junior snaps the shape to whole units for plain bricks;
  // Expert and Master build it bigger and smoother, with room for detail
  // (the original's parts no longer fit a scaled shape, so none are kept).
  if (tier === "junior") shape = blockify(shape);
  const scale = SCALE[tier];
  if (scale > 1) {
    shape = await scaleUpOff(shape, scale);
    donors = [];
  }
  const [dx, dy, dz] = seatOffset(shape);
  return { target: seat(shape), donors: donors.map((b) => moveCells(b, dx, dy, dz)) };
}

/**
 * How much bigger each tier builds the same design (pieces and time grow with the cube).
 * Kept small: at 1.5× / 2.5× a Master design took 68 s and thousands of pieces, and a
 * higher level should mean more detail (its weights), not the same model blown up.
 */
export const SCALE: Record<Tier, number> = { junior: 1, creator: 1, advanced: 1, technic: 1, expert: 1, master: 1 };

export interface EngineDesign {
  bricks: PlacedBrick[];
  fit: number;
  held: number;
  made: number;
  reused: number;
  ms: number;
  /**
   * Best-of-K (engine/select/bestOfK.ts): build the same target the other ways and
   * keep the best by pickBest — the better design, or null when the first build
   * already was. Only where the variants apply and the extra builds are affordable.
   */
  refine?: () => Promise<EngineDesign | null>;
}

/**
 * Levels where best-of-K runs (Technic ignores the variants): none by default, since its
 * three extra builds kept the machine busy after the tiles were in. Expert: no parent parts
 * are kept at its scale, so the variants differ; on core8 the pick changed 2 of 8 and
 * looked no worse in either (docs/engine/c5-best-of-k.md), ~3 s a variant. Junior to
 * Advanced keep the parent's parts and the default won 6 of 6, so they don't pay for it.
 * Override with localStorage "lego-builder:bestOf" (tiers, comma-separated; "none").
 */
const REFINE = (): Tier[] => ((typeof localStorage !== "undefined" && localStorage.getItem("lego-builder:bestOf")) || "").split(",").filter(Boolean) as Tier[];

export async function engineDesign(base: CorpusModel, v: Variation, tier: Tier, articulate = false): Promise<EngineDesign> {
  await ensure();
  const { target, donors } = await targetOf(base, v, tier);
  const keys = Int32Array.from(target.cells.keys());
  const request = (variant: number): BuildRequest => ({
    ticket: ++ticket,
    cells: keys.slice(),
    colors: Int32Array.from(keys, (k) => target.cells.get(k)!),
    studs: Int32Array.from(target.studs ?? []),
    name: `${base.id}-${v.kind}-${ticket}`,
    donors,
    donorDefs: [...new Set(donors.map((b) => b.partId))].map((id) => PARTS[id]).filter((p) => p?.made),
    donorShapes: [...new Set(donors.map((b) => b.partId))].filter((id) => PARTS[id]?.made).map((id) => [id, partShape(PARTS[id])]),
    tier,
    articulate,
    variant,
  });
  const run = async (req: BuildRequest) => {
    const slot = workers.reduce((a, b) => (b.busy < a.busy ? b : a));
    slot.busy++;
    if (!slot.tiers.has(tier)) {
      req.forms = await formsOf(tier);
      slot.tiers.add(tier);
    }
    return new Promise<BuildReply>((resolve) => {
      waiting.set(req.ticket, resolve);
      slot.w.postMessage(req, [req.cells.buffer, req.colors.buffer, req.studs.buffer]);
    });
  };
  const design = async (reply: BuildReply): Promise<EngineDesign> => {
    await makeParts(reply.made.map((def) => ({ id: def.id, name: def.name, ldraw: def.made!, inline: true, def })));
    return { bricks: reply.bricks, fit: reply.fit, held: reply.held, made: reply.made.length, reused: reply.reused, ms: reply.ms };
  };
  const first = await run(request(0));
  const out = await design(first);
  if (REFINE().includes(tier))
    out.refine = async () => {
      // Every candidate goes to pickBest together, in VARIANTS order (its economy term is relative to the leanest).
      const rest = await Promise.all(VARIANTS.slice(1).map((_, k) => run(request(k + 1))));
      const cands = [first, ...rest].filter((r) => !r.skipped);
      const best = cands[pickBest(cands)];
      if (import.meta.env.DEV) console.debug(`[best-of-K] ${base.id}: ${VARIANTS[best === first ? 0 : rest.indexOf(best) + 1].name} of ${cands.length}`);
      return best === first ? null : design(best);
    };
  return out;
}

/**
 * A rig build (dinosaurs, F1) in a worker: a Master one is 5,000 parts and took
 * 1.5–2.8 s on the page's own thread, freezing it while the studio filled.
 */
export async function rigBuild(kind: Kind, opts: Parameters<typeof generateBuild>[1]): Promise<Build> {
  await ensure();
  const slot = quick!;
  slot.busy++;
  const t = ++ticket;
  const reply = await new Promise<BuildReply>((resolve) => {
    waiting.set(t, resolve);
    slot.w.postMessage({ type: "rig", ticket: t, kind, opts } satisfies RigRequest);
  });
  return (reply as unknown as { build: Build }).build;
}

/** scaleUp in a worker (the result is the same; 1–2 s a Master target, off the page's thread). */
async function scaleUpOff(v: Voxels, s: number): Promise<Voxels> {
  if (s <= 1) return v;
  await ensure();
  const slot = quick!;
  slot.busy++;
  const t = ++ticket;
  const keys = Int32Array.from(v.cells.keys());
  const req: ScaleRequest = { type: "scale", ticket: t, keys, colors: Int32Array.from(keys, (k) => v.cells.get(k)!), studs: Int32Array.from(v.studs ?? []), s };
  const reply = (await new Promise<BuildReply>((resolve) => {
    waiting.set(t, resolve);
    slot.w.postMessage(req, [req.keys.buffer, req.colors.buffer, req.studs.buffer]);
  })) as unknown as { keys: Int32Array; colors: Int32Array; studs: Int32Array };
  return { cells: new Map(Array.from(reply.keys, (k, i) => [k, reply.colors[i]])), studs: new Set(reply.studs) };
}
