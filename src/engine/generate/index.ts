import { PARTS, resolvePartId } from "../parts";
import { COLORS, colorOf } from "../colors";
import type { Inventory } from "../inventory";
import type { GenerateRequest } from "./worker";
import type { ColorInfo, Grid, Idea, Stock } from "./solver";
import { makeCharacter, type Archetype, type Character, type Personality } from "./characters";
import type { Level } from "./solver";

export type { Idea, Need, Grid, Level } from "./solver";
export { RECIPES } from "./recipes";
export { makeCharacter, jitter, type Archetype, type Personality } from "./characters";

// Names that mean the part isn't a plain box even if its footprint is.
const SHAPED = /Round|Corner|Slope|Curved|Arch|Modified|Wedge|Hole|Clip|Bar|Pin|Handle|Hinge|Cut|Angled|Half/i;

/** How the generator can use a part, judged by geometry rather than exact name. */
function stockKind(partId: string): Omit<Stock, "partId" | "color" | "qty"> | null {
  const part = PARTS[partId];
  if (!part || part.approx) return null;
  const slope = /^Slope Brick 45 2×(\d+)$/.exec(part.name);
  if (slope && part.h === 3 && part.d === 2 && part.studs.length === part.w)
    return { w: part.w, d: 2, h: 3, tile: false, slope: true };
  const kind = /^(Brick|Plate|Tile) \d+×\d+(?!×)/.exec(part.name)?.[1];
  const tile = kind === "Tile";
  if (!kind || SHAPED.test(part.name) || (part.h !== 1 && part.h !== 3)) return null;
  if (part.studs.length !== (tile ? 0 : part.w * part.d)) return null;
  return { w: part.w, d: part.d, h: part.h as 1 | 3, tile };
}

/** Library lines the generator can build with (bricks, plates, tiles, 45° slopes). */
export function usableStock(inv: Inventory): { stock: Stock[]; unusable: number } {
  const stock: Stock[] = [];
  let unusable = 0;
  for (const [key, qty] of Object.entries(inv)) {
    if (qty <= 0) continue;
    const i = key.lastIndexOf(":");
    const partId = key.slice(0, i);
    const kind = stockKind(partId);
    if (!kind) unusable += qty;
    else stock.push({ partId, color: Number(key.slice(i + 1)), qty, ...kind });
  }
  return { stock, unusable };
}

// Everyday parts a shop always has, for "dream big" designs.
const STANDARD = [
  "3005", "3004", "3622", "3010", "3009", "3008", "3003", "3002", "3001", "2456", "3007",
  "3024", "3023", "3623", "3710", "3666", "3460", "3022", "3021", "3020", "3795", "3034", "3031",
  "3070b", "3069b", "63864", "2431", "3068b", "87079",
  "3040", "3039", "3038", "3037",
];

/** Unlimited stock of standard parts in the palette colours plus every colour the user owns. */
export function dreamStock(inv: Inventory): Stock[] {
  const colors = new Set<number>(COLORS.map((c) => c.code));
  for (const k of Object.keys(inv)) colors.add(Number(k.slice(k.lastIndexOf(":") + 1)));
  const stock: Stock[] = [];
  for (const raw of STANDARD) {
    const partId = resolvePartId(raw);
    const kind = partId && stockKind(partId);
    if (!partId || !kind) continue;
    for (const color of colors) stock.push({ partId, color, qty: Infinity, ...kind });
  }
  return stock;
}

const colorInfo = (stock: Stock[]): ColorInfo[] =>
  [...new Set(stock.map((s) => s.color))].map((code) => {
    const c = colorOf(code);
    return { code, name: c.name, hex: c.hex };
  });

let worker: Worker | null = null;
let nextId = 0;

// Omit that keeps the union of request kinds apart.
type Payload = GenerateRequest extends infer R ? (R extends unknown ? Omit<R, "id" | "parts"> : never) : never;

function ask<T>(payload: Payload): Promise<T> {
  worker ??= new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  const id = ++nextId;
  const w = worker;
  return new Promise<T>((resolve) => {
    const onMessage = (e: MessageEvent<{ id: number } & T>) => {
      if (e.data.id !== id) return;
      w.removeEventListener("message", onMessage);
      resolve(e.data);
    };
    w.addEventListener("message", onMessage);
    const ids = [...payload.stock.map((s) => s.partId), ...("decor" in payload ? (payload.decor ?? []).map((d) => d.partId) : [])];
    const parts = [...new Set(ids)].map((id) => PARTS[id]).filter(Boolean);
    w.postMessage({ id, parts, ...payload });
  });
}

/** Ideas from the recipe book, built from the library (or dreamed at full size). */
export async function requestIdeas(inv: Inventory, seed: number, dream = false) {
  const { stock: mine, unusable } = usableStock(inv);
  const stock = dream ? dreamStock(inv) : mine;
  const owned = Object.entries(inv);
  const r = await ask<{ ideas: Idea[]; ms: number }>({
    kind: "recipes",
    stock,
    colors: colorInfo(stock),
    seed,
    dream,
    owned,
  });
  return { ...r, unusable };
}

/** Build a ready-made colour grid (photo mosaic, imported model). */
export async function requestGrid(
  inv: Inventory,
  grid: Grid,
  roleColors: number[],
  meta: { recipe: string; title: string; math: string },
  dream = false,
) {
  const stock = dream ? dreamStock(inv) : usableStock(inv).stock;
  const r = await ask<{ idea: Idea; ms: number }>({
    kind: "grid",
    stock,
    colors: colorInfo([...stock, ...roleColors.map((color) => ({ color }) as Stock)]),
    grid,
    roleColors,
    meta,
    owned: Object.entries(inv),
    seed: 0,
  });
  return r;
}

/**
 * A character from the Character Grammar: its body is solved from the stock
 * (or dreamed), its eyes, teeth, horns and wheels are placed as designed.
 */
export async function requestCharacter(inv: Inventory, c: Character, dream = false) {
  const stock = dream ? dreamStock(inv) : usableStock(inv).stock;
  const decor = c.decor
    .map((d) => ({ ...d, partId: resolvePartId(d.partId) ?? d.partId, color: d.color ?? c.roleColors[d.role ?? 0] }))
    .filter((d) => PARTS[d.partId]);
  const r = await ask<{ idea: Idea; ms: number }>({
    kind: "grid",
    stock,
    colors: colorInfo([...stock, ...c.roleColors.map((color) => ({ color }) as Stock)]),
    grid: c.grid,
    roleColors: c.roleColors,
    meta: { recipe: `char-${c.title}`, title: c.title, math: c.math },
    owned: Object.entries(inv),
    decor,
    level: c.level,
    seed: 0,
  });
  return r;
}

/**
 * A character sized by actually solving it: start from the estimate, then
 * correct k by ∛(target / pieces) and, if the result wouldn't hold together,
 * shrink by 15 %. Keeps the best attempt (stable first, then closest to target).
 */
export async function generateCharacter(
  inv: Inventory,
  arch: Archetype,
  p: Personality,
  seed: number,
  palette: number[],
  pieces: number,
  level: Level,
  dream: boolean,
) {
  let c = makeCharacter(arch, p, seed, palette, pieces, level);
  let best: { idea: Idea; ms: number } | null = null;
  let ms = 0;
  const rank = (i: Idea) => (i.stress <= 1 ? 0 : 1) * 1e6 + Math.abs(Math.log(i.pieces / pieces)) * 100 + (1 - i.coverage) * 50;
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await requestCharacter(inv, c, dream);
    ms += r.ms;
    if (!best || rank(r.idea) < rank(best.idea)) best = r;
    const i = r.idea;
    const off = i.pieces / pieces;
    if (i.stress <= 1 && off > 0.8 && off < 1.25) break;
    const k = i.stress > 1 ? c.k * 0.85 : c.k * Math.cbrt(1 / off);
    if (Math.abs(k - c.k) < 0.04) break;
    c = makeCharacter(arch, p, seed, palette, pieces, level, k);
  }
  return { idea: best!.idea, ms };
}

/** The colours the generator may use for a mosaic or model: owned ones, or all solid colours when dreaming. */
export function buildPalette(inv: Inventory, dream: boolean, lh: 1 | 3): number[] {
  if (dream) return [...new Set(dreamStock(inv).map((s) => s.color))];
  return [...new Set(usableStock(inv).stock.filter((s) => s.h === lh && !s.slope).map((s) => s.color))];
}

export { shoppingCSV } from "../inventory";
