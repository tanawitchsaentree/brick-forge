// The sculptor off the main thread: loads the catalog, part shapes and learned
// forms once, then builds target solids (engine/sculpt.ts) and makes parts to
// measure where no real part fits (engine/madeParts.ts).
import { loadCatalog, type CatalogData } from "./catalog";
import { installShapes } from "./shape";
import { sculpt, unpackForms, type Form, type PackedForm, type SculptOptions } from "./sculpt";
import type { Tier } from "./style";
import { sculptArticulated } from "./articulate";
import { prune } from "./necessity";

/** Per tier: Junior wants few, big, upright parts; Master spends pieces on finish. */
const TIER_WEIGHTS: Record<Tier, Partial<SculptOptions>> = {
  junior: { PIECE: 80, AIR: 2, STUD_BAD: 0 },
  creator: { PIECE: 50 },
  advanced: {},
  expert: { PIECE: 30, STUD_BAD: 8 },
  master: { PIECE: 20, STUD_BAD: 10 },
  technic: { PIECE: 30, FLOAT: 60 },
};
// The 1,500 most used forms: 7× faster on the benchmark and no worse (docs/engine.md).
for (const w of Object.values(TIER_WEIGHTS)) w.MAX_FORMS = 1500;
import { makeBlobPart, residualBlobs } from "./madeParts";
import { connections, components } from "./connect";
import { installShapeBits, iou, partCells, vkey, voxelize, type PartShape } from "./shape";
import { PARTS, registerPart, type PartDef } from "./parts";
import type { PlacedBrick, Why } from "./grid";

export interface BuildRequest {
  ticket: number;
  cells: Int32Array; // cell keys
  colors: Int32Array;
  studs: Int32Array;
  name: string;
  /** The parent design's parts, moved with the shape: reused where sculpting leaves a gap. */
  donors: PlacedBrick[];
  /** Parts among the donors the catalog doesn't have (made from the model file). */
  donorDefs: PartDef[];
  donorShapes: [string, PartShape][];
  tier: Tier;
  /** Build turned segments on their own grids (animals, robots). */
  articulate: boolean;
  /** The tier's forms, sent the first time this worker builds in it. */
  forms?: PackedForm[];
}

export interface BuildReply {
  ticket: number;
  bricks: PlacedBrick[];
  made: PartDef[];
  /** Parts carried over from the parent design. */
  reused: number;
  /** How close the build is to the target (IoU), and the share of parts held together. */
  fit: number;
  held: number;
  ms: number;
}

// Everything shared comes from the page in one init message (the page has
// fetched it once for all workers): the catalog and part shapes. Forms come
// with the first request of each tier.
let resolveReady!: () => void;
const ready = new Promise<void>((r) => (resolveReady = r));
const vocab = new Map<Tier, Form[]>();

export interface InitMessage {
  type: "init";
  catalog: CatalogData;
  shapes: Record<string, [number, number, number, string]>;
}

self.onmessage = async (e: MessageEvent<BuildRequest | InitMessage>) => {
  if ("type" in e.data) {
    await loadCatalog(e.data.catalog);
    installShapes(e.data.shapes);
    resolveReady();
    return;
  }
  await ready;
  const { ticket, cells, colors, studs, name, donors, donorDefs, donorShapes, tier, articulate, forms: packed } = e.data;
  if (packed) vocab.set(tier, unpackForms(packed));
  const forms = vocab.get(tier)!;
  const target = { cells: new Map<number, number>(), studs: new Set<number>(studs) };
  cells.forEach((k, i) => target.cells.set(k, colors[i]));
  for (const def of donorDefs) registerPart(def);
  for (const [id, shape] of donorShapes) installShapeBits(id, shape);
  const KEPT: Why = { role: "kept", cover: 0, air: 0, finish: 0, engaged: 0, prior: 0, repeat: false, rank: 0, margin: Infinity };
  // The designer's parts go in first, as they were, wherever the new shape
  // still holds them (nearly all of a part inside it, no overlaps): a longer
  // car keeps its nose, its tail and a copied middle section. The sculptor
  // only builds the seams.
  const occupied = new Set<number>();
  const fixed: PlacedBrick[] = [];
  for (const d of donors) {
    if (!PARTS[d.partId]) continue;
    const c: number[] = [];
    partCells(d, (x, y, z) => c.push(vkey(x, y, z)));
    if (!c.length || c.some((k) => occupied.has(k))) continue;
    if (c.filter((k) => target.cells.has(k)).length < c.length * 0.85) continue;
    c.forEach((k) => occupied.add(k));
    fixed.push({ ...d, uid: `k${fixed.length}`, why: KEPT });
  }
  const reused = fixed.length;
  const t1 = performance.now();
  const r = articulate ? sculptArticulated(target, { forms, fixed, ...TIER_WEIGHTS[tier] }) : sculpt(target, { forms, fixed, ...TIER_WEIGHTS[tier] });
  // Every part must earn its place: shape only it fills, structure (Tarjan), or finish.
  const t2 = performance.now();
  r.bricks = prune(r.bricks, target).kept;
  const t3 = performance.now();
  const made: PartDef[] = [];
  for (const blob of residualBlobs(target, r.bricks, 64)) {
    const votes = new Map<number, number>();
    for (const k of blob) votes.set(target.cells.get(k)!, (votes.get(target.cells.get(k)!) ?? 0) + 1);
    const spec = makeBlobPart(blob, `made-${name}-${made.length}`, [...votes].sort((a, b) => b[1] - a[1])[0][0]);
    made.push(spec.part);
    r.bricks.push({ ...spec.brick, why: { ...KEPT, role: "made" } });
  }
  const t4 = performance.now();
  const comps = components(r.bricks.length, connections(r.bricks));
  const t5 = performance.now();
  if (import.meta.env.DEV) console.debug(`[sculpt] ${name}: kept ${reused}, sculpt ${Math.round(t2 - t1)} ms, prune ${Math.round(t3 - t2)} ms, made ${Math.round(t4 - t3)} ms, check ${Math.round(t5 - t4)} ms`);
  const reply: BuildReply = { ticket, bricks: r.bricks, made, reused, fit: iou(voxelize(r.bricks), target), held: (comps[0]?.length ?? 0) / Math.max(1, r.bricks.length), ms: r.ms };
  (self as unknown as Worker).postMessage(reply);
};
