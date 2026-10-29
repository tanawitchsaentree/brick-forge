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
export const parallel = () => Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));

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

/** How much bigger each tier builds the same design (pieces grow with the cube). */
export const SCALE: Record<Tier, number> = { junior: 1, creator: 1, advanced: 1, technic: 1, expert: 1.5, master: 2.5 };

export interface EngineDesign {
  bricks: PlacedBrick[];
  fit: number;
  held: number;
  made: number;
  reused: number;
  ms: number;
}

export async function engineDesign(base: CorpusModel, v: Variation, tier: Tier, articulate = false): Promise<EngineDesign> {
  await ensure();
  const { target, donors } = await targetOf(base, v, tier);
  const keys = Int32Array.from(target.cells.keys());
  const req: BuildRequest = {
    ticket: ++ticket,
    cells: keys,
    colors: Int32Array.from(keys, (k) => target.cells.get(k)!),
    studs: Int32Array.from(target.studs ?? []),
    name: `${base.id}-${v.kind}-${ticket}`,
    donors,
    donorDefs: [...new Set(donors.map((b) => b.partId))].map((id) => PARTS[id]).filter((p) => p?.made),
    donorShapes: [...new Set(donors.map((b) => b.partId))].filter((id) => PARTS[id]?.made).map((id) => [id, partShape(PARTS[id])]),
    tier,
    articulate,
  };
  const slot = workers.reduce((a, b) => (b.busy < a.busy ? b : a));
  slot.busy++;
  if (!slot.tiers.has(tier)) {
    req.forms = await formsOf(tier);
    slot.tiers.add(tier);
  }
  const reply = await new Promise<BuildReply>((resolve) => {
    waiting.set(req.ticket, resolve);
    slot.w.postMessage(req, [req.cells.buffer, req.colors.buffer, req.studs.buffer]);
  });
  await makeParts(reply.made.map((def) => ({ id: def.id, name: def.name, ldraw: def.made!, inline: true, def })));
  return { bricks: reply.bricks, fit: reply.fit, held: reply.held, made: reply.made.length, reused: reply.reused, ms: reply.ms };
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
