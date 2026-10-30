// The sculptor off the main thread: loads the catalog, part shapes and learned
// forms once, then builds target solids (engine/sculpt.ts) and makes parts to
// measure where no real part fits (engine/madeParts.ts).
import { loadCatalog, type CatalogData } from "./catalog";
import { installShapes } from "./shape";
import { sculpt, unpackForms, type Form, type PackedForm, type SculptOptions } from "./sculpt";
import type { Tier } from "./style";
import { sculptArticulated } from "./articulate";
import { prune } from "./necessity";
import { generateBuild } from "./assembly";
import { scaleUp } from "./morph";
import type { Kind } from "./assembly/kinds";

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
// S8 (program v2, docs/engine/track-s.md): no unheld part resting on a part with no
// stud into it. Passed the paired gate (14 of 19, every level up; validated on a
// disjoint set first). Technic isn't gated, so it keeps the old behaviour.
for (const [tier, w] of Object.entries(TIER_WEIGHTS)) if (tier !== "technic") w.NO_FLOAT = "onSmooth";
import { makeBlobPart, residualBlobs } from "./madeParts";
import { connections, components } from "./connect";
import { installShapeBits, iou, partCells, vkey, voxelize, type PartShape } from "./shape";
import { PARTS, registerPart, type PartDef } from "./parts";
import type { PlacedBrick, Why } from "./grid";
import { interiorFill } from "./shell";
import { VARIANTS, type Variant } from "./select/bestOfK";

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
  /** Which way to build (engine/select/bestOfK.ts VARIANTS); 0, the default, is the app's build. The page runs the others and keeps the best with pickBest. */
  variant?: number;
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
  /** The rest of what pickBest reads: share of repeated parts, and pieces (made parts count as 3). */
  repeats: number;
  pieces: number;
  ms: number;
  /** The variant doesn't apply here (shell with donor parts kept: its fill would overlap them); no build. */
  skipped?: boolean;
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

/** A rig build (dinosaurs, F1: engine/assembly), here so a 5,000-part one doesn't freeze the page. */
export interface RigRequest {
  type: "rig";
  ticket: number;
  kind: Kind;
  opts: Parameters<typeof generateBuild>[1];
}

/** A Master target scaled up and smoothed (engine/morph.ts scaleUp): 1–2 s each, too long for the page's thread. */
export interface ScaleRequest {
  type: "scale";
  ticket: number;
  keys: Int32Array;
  colors: Int32Array;
  studs: Int32Array;
  s: number;
}

self.onmessage = async (e: MessageEvent<BuildRequest | InitMessage | RigRequest | ScaleRequest>) => {
  if ("type" in e.data && e.data.type === "scale") {
    const { ticket, keys, colors, studs, s } = e.data;
    const v = scaleUp({ cells: new Map(Array.from(keys, (k, i) => [k, colors[i]])), studs: new Set(studs) }, s);
    const k2 = Int32Array.from(v.cells.keys()), c2 = Int32Array.from(k2, (k) => v.cells.get(k)!), s2 = Int32Array.from(v.studs ?? []);
    (self as unknown as Worker).postMessage({ ticket, keys: k2, colors: c2, studs: s2 }, [k2.buffer, c2.buffer, s2.buffer]);
    return;
  }
  if ("type" in e.data && e.data.type === "rig") {
    await ready;
    const { ticket, kind, opts } = e.data;
    (self as unknown as Worker).postMessage({ ticket, build: generateBuild(kind, opts) });
    return;
  }
  if ("type" in e.data) {
    await loadCatalog(e.data.catalog);
    installShapes(e.data.shapes);
    resolveReady();
    return;
  }
  await ready;
  const { ticket, cells, colors, studs, name, donors, donorDefs, donorShapes, tier, articulate, forms: packed, variant = 0 } = e.data;
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
  const build = (v: Variant) => {
    const opts = { forms, fixed: v.shell ? [...fixed, ...interiorFill(target).fixed] : fixed, ...TIER_WEIGHTS[tier], ...(tier === "technic" ? {} : v.opts) };
    const t1 = performance.now();
    const r = articulate ? sculptArticulated(target, opts) : sculpt(target, opts);
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
    if (import.meta.env.DEV) console.debug(`[sculpt] ${name} (${v.name}): kept ${reused}, sculpt ${Math.round(t2 - t1)} ms, prune ${Math.round(t3 - t2)} ms, made ${Math.round(t4 - t3)} ms, check ${Math.round(t5 - t4)} ms`);
    const held = (comps[0]?.length ?? 0) / Math.max(1, r.bricks.length);
    const repeats = r.bricks.filter((b) => b.why?.repeat).length / Math.max(1, r.bricks.length);
    return { r, made, fit: iou(voxelize(r.bricks), target), held, repeats, pieces: r.bricks.length + 2 * made.length };
  };
  const v = VARIANTS[variant];
  if (v.shell && reused) {
    const reply: BuildReply = { ticket, bricks: [], made: [], reused, fit: 0, held: 0, repeats: 0, pieces: 0, ms: 0, skipped: true };
    (self as unknown as Worker).postMessage(reply);
    return;
  }
  const { r, made, fit, held, repeats, pieces } = build(v);
  const reply: BuildReply = { ticket, bricks: r.bricks, made, reused, fit, held, repeats, pieces, ms: r.ms };
  (self as unknown as Worker).postMessage(reply);
};
