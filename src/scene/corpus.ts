import type { Kind } from "../engine/assembly/kinds";
import { LIVERIES } from "../engine/assembly/f1";
import { colorOf } from "../engine/colors";
import { importLDraw, partsToMake, type ImportResult } from "../engine/ldrawImport";
import { makeParts } from "./ldraw";

// The design corpus (scripts/build-corpus.mjs): official LEGO models, one
// object each, that the Ideas panel builds from. Designs load on demand and
// are kept once imported.

export interface CorpusModel {
  id: string;
  kind: Kind;
  set: string;
  name: string;
  /** Which model of the set (a 3-in-1's alternate, one car of several). */
  model: string;
  theme: string;
  year: number;
  /** Who modelled it for the LDraw Official Model Repository (credited on /credits.html). */
  author?: string;
  parts: number;
  size: [number, number, number];
  /** Measured level (engine/style.ts) and the measurements behind it. */
  tier?: import("../engine/style").Tier;
  style?: import("../engine/style").StyleVector;
}

let index: Promise<CorpusModel[]> | null = null;

const models = (url: string): Promise<CorpusModel[]> =>
  fetch(url)
    .then((r) => (r.ok && r.headers.get("content-type")?.includes("json") ? r.json() : { models: [] }))
    .then((o: { models: CorpusModel[] }) => o.models)
    .catch(() => []);

/** The public corpus, plus private.json where it exists: models kept on this machine only (never deployed). */
export function corpusIndex(): Promise<CorpusModel[]> {
  index ??= Promise.all([models("/corpus/index.json"), models("/corpus/private.json")]).then(([pub, own]) => [...pub, ...own]);
  return index;
}

const designs = new Map<string, Promise<ImportResult["bricks"]>>();

/** A design's parts, placed on the baseplate (parts the catalog lacks are made first). */
export function loadDesign(id: string): Promise<ImportResult["bricks"]> {
  return loadDesignText(id, () => fetch(`/corpus/${id}.mpd`).then((r) => r.text()));
}

/** The same for LDraw text the app carries itself (a reference rebuild, data/golden). */
export function loadDesignText(id: string, text: () => Promise<string>): Promise<ImportResult["bricks"]> {
  let d = designs.get(id);
  if (!d) {
    d = text().then(async (text) => {
      await makeParts(partsToMake(text));
      // Module names without the set number ("8123 - Front wing" → "Front wing").
      return importLDraw(text, id).bricks.map((b) => ({ ...b, group: b.group === "Model" ? "Main" : b.group.replace(/^\d+(-\d+)?\s*-\s*/, "") }));
    });
    d.catch(() => designs.delete(id));
    designs.set(id, d);
  }
  return d;
}

/** Piece bands by level: a higher level is a more complex real set, not a bigger copy. */
const TIER_BANDS: [string, number, number][] = [
  ["junior", 0, 150],
  ["creator", 150, 400],
  ["advanced", 400, 800],
  ["expert", 800, 1500],
  ["master", 1500, Infinity],
];

/**
 * Real designs of a kind for a level and size: the level's piece band (the nearest band
 * below when it has none, e.g. no 1,500-piece robot), then S/M/L as its lower, middle
 * and upper third (the whole band when a third is empty).
 */
export function inTier(models: CorpusModel[], kind: Kind, tier: string, band: number): CorpusModel[] {
  const all = models.filter((m) => m.kind === kind).sort((a, b) => a.parts - b.parts);
  let k = Math.max(0, TIER_BANDS.findIndex(([t]) => t === tier));
  let pool: CorpusModel[] = [];
  for (; k >= 0 && !pool.length; k--) pool = all.filter((m) => m.parts >= TIER_BANDS[k][1] && m.parts < TIER_BANDS[k][2]);
  if (!pool.length) return all.slice(0, 1);
  const third = pool.slice(Math.floor((pool.length * band) / 3), Math.floor((pool.length * (band + 1)) / 3));
  return third.length ? third : pool;
}

/**
 * Designs of a kind in a size band. Bands split each kind's designs by piece
 * count into thirds, so S, M and L always have something to show.
 */
export function inBand(models: CorpusModel[], kind: Kind, band: number): CorpusModel[] {
  const all = models.filter((m) => m.kind === kind).sort((a, b) => a.parts - b.parts);
  if (all.length < 6) return all;
  const lo = Math.floor((all.length * band) / 3), hi = Math.floor((all.length * (band + 1)) / 3);
  return all.slice(lo, hi);
}

/** Colours that read as structure rather than paint: kept when recolouring. */
const NEUTRAL = new Set([0, 71, 72, 7, 8, 15, 19, 28, 70, 6, 80, 383, 334, 135, 179]);

/** The model's paint: its most-used non-neutral colours, most first. */
function paint(bricks: { color: number }[]): number[] {
  const n = new Map<number, number>();
  for (const b of bricks) {
    if (NEUTRAL.has(b.color) || (colorOf(b.color).alpha ?? 1) < 1) continue;
    n.set(b.color, (n.get(b.color) ?? 0) + 1);
  }
  return [...n].sort((a, b) => b[1] - a[1]).map(([c]) => c);
}

/** Schemes to repaint with: team liveries for vehicles, and LEGO's own house palettes. */
const SCHEMES: { name: string; colors: number[] }[] = [
  // Liveries led by a colour (a white or black lead turns a red car grey or into a silhouette).
  ...LIVERIES.filter((l) => !NEUTRAL.has(l.main)).map((l) => ({ name: l.name, colors: [l.main, l.accent, l.detail] })),
  { name: "Sunshine", colors: [14, 1, 4] },
  { name: "Lime", colors: [27, 0, 25] },
  { name: "Azure", colors: [321, 15, 14] },
  { name: "Dark red", colors: [320, 19, 0] },
  { name: "Sand green", colors: [378, 19, 70] },
  { name: "Coral", colors: [353, 15, 322] },
];

/**
 * The same design in another scheme: its main paint takes the scheme's first
 * colour, the second its second… Structure (black, greys, white, tan),
 * transparent parts and printed details keep their colours.
 */
export function recolor<B extends { color: number }>(bricks: B[], scheme: number): { bricks: B[]; name: string } | null {
  const s = SCHEMES[scheme % SCHEMES.length];
  const from = paint(bricks);
  if (!from.length) return null; // all structure colours (a white shuttle): nothing to repaint
  const to = new Map(from.slice(0, s.colors.length).map((c, i) => [c, s.colors[i]]));
  return { bricks: bricks.map((b) => (to.has(b.color) ? { ...b, color: to.get(b.color)! } : b)), name: s.name };
}

export const SCHEME_COUNT = SCHEMES.length;
/** The first this many schemes are the F1 team liveries (engine/assembly/f1.ts LIVERIES, colour-led ones). */
export const LIVERY_SCHEMES = LIVERIES.filter((l) => !NEUTRAL.has(l.main)).length;
