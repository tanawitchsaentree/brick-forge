import { COLORS, COLOR_BY_CODE } from "./colors";
import { resolvePartId } from "./parts";
import type { PlacedBrick } from "./grid";

/** The user's own pieces: "partId:colorCode" → quantity. */
export type Inventory = Record<string, number>;

export const invKey = (partId: string, color: number) => `${partId}:${color}`;

export function parseKey(key: string) {
  const i = key.lastIndexOf(":");
  return { partId: key.slice(0, i), color: Number(key.slice(i + 1)) };
}

/** How many of each part/colour the current model uses. */
export function usage(bricks: PlacedBrick[]): Inventory {
  const used: Inventory = {};
  for (const b of bricks) used[invKey(b.partId, b.color)] = (used[invKey(b.partId, b.color)] ?? 0) + 1;
  return used;
}

export function totalPieces(inv: Inventory) {
  return Object.values(inv).reduce((a, b) => a + b, 0);
}

const nameToCode = () => {
  const m = new Map<string, number>();
  for (const c of Object.values(COLOR_BY_CODE)) m.set(c.name.toLowerCase(), c.code);
  return m;
};

/**
 * Parse a parts list. Accepts:
 *  • Rebrickable CSV exports ("Part,Color,Quantity" — their colour ids follow LDraw codes)
 *  • one part per line: "3001 4 10", "3001,red,10", "10x 3001 red"
 * Unknown part numbers are reported, not dropped silently.
 */
export function parseInventory(text: string): { inv: Inventory; added: number; unknown: string[] } {
  const inv: Inventory = {};
  const unknown = new Set<string>();
  const names = nameToCode();
  let added = 0;
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let cols: { part: number; color: number; qty: number } | null = null;

  for (const line of lines) {
    const cells = line.split(/[,\t;]/).map((c) => c.trim().replace(/^"|"$/g, ""));
    // Header row → remember which column is which.
    const lower = cells.map((c) => c.toLowerCase());
    if (lower.some((c) => /^(part|part_num|partid|item ?id)$/.test(c))) {
      cols = {
        part: lower.findIndex((c) => /^(part|part_num|partid|item ?id)$/.test(c)),
        color: lower.findIndex((c) => /^(color|colour|color_id|color id)$/.test(c)),
        qty: lower.findIndex((c) => /^(quantity|qty|count)$/.test(c)),
      };
      continue;
    }
    let part: string | undefined, color: number | undefined, qty = 1;
    if (cols && cells.length > 1) {
      part = cells[cols.part];
      color = Number(cells[cols.color]);
      qty = cols.qty >= 0 ? Number(cells[cols.qty]) || 1 : 1;
    } else {
      // Free-form: pick out "Nx" quantities, a part number, and a colour code or name.
      const tokens = line.split(/[\s,;]+/).filter(Boolean);
      const rest: string[] = [];
      for (const t of tokens) {
        const q = t.match(/^(\d+)x$|^x(\d+)$/i);
        if (q) qty = Number(q[1] ?? q[2]);
        else rest.push(t);
      }
      part = rest.shift();
      const colorWords = rest.filter((t) => !/^\d+$/.test(t)).join(" ").toLowerCase();
      const nums = rest.filter((t) => /^\d+$/.test(t)).map(Number);
      if (colorWords && names.has(colorWords)) color = names.get(colorWords);
      else if (nums.length) color = nums.shift();
      if (nums.length) qty = nums.shift()!;
    }
    if (!part) continue;
    const id = resolvePartId(part.toLowerCase().replace(/\.dat$/, ""));
    if (!id) {
      unknown.add(part);
      continue;
    }
    const k = invKey(id, Number.isFinite(color) ? color! : 4);
    inv[k] = (inv[k] ?? 0) + Math.max(1, Math.round(qty));
    added += Math.max(1, Math.round(qty));
  }
  return { inv, added, unknown: [...unknown] };
}

/**
 * A plausible "bucket of classic bricks" so the generator can be tried before
 * entering a real collection. Counts are made up but realistically skewed
 * toward small, common parts.
 */
export function sampleBucket(): Inventory {
  const inv: Inventory = {};
  const parts: [string, number][] = [
    ["3001", 10], ["3003", 12], ["3004", 14], ["3005", 16], ["3010", 8], ["3002", 6], ["3622", 8],
    ["3009", 4], ["3020", 6], ["3022", 8], ["3023", 14], ["3024", 16], ["3710", 8], ["3021", 6],
    ["3068b", 6], ["3069b", 8], ["3070b", 10],
  ];
  const palette = COLORS.slice(0, 10).map((c) => c.code); // red, orange, yellow, green, blues, white, greys…
  palette.forEach((color, ci) => {
    for (const [p, n] of parts) {
      const id = resolvePartId(p);
      if (!id) continue;
      // Primary colours get the most; later ones taper off.
      const qty = Math.max(1, Math.round(n * (1.3 - ci * 0.09)));
      inv[invKey(id, color)] = qty;
    }
  });
  return inv;
}

/** Rebrickable-style CSV ("Part,Color,Quantity") for a list of pieces to buy. */
export function shoppingCSV(rows: { partId: string; color: number; qty: number }[]) {
  return ["Part,Color,Quantity", ...rows.filter((r) => r.qty > 0).map((r) => `${r.partId},${r.color},${r.qty}`)].join("\n") + "\n";
}
