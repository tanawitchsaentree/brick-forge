import type { PlacedBrick } from "./grid";
import { mul, partMatrix, type Mat4 } from "./pose";
import { PLATE_H } from "./units";

// Feature units (the DNA experiment, docs/engine/dna-rules.md): a feature part and
// the partners that come with it in at least half its uses (a window and its
// glass, a rim and its tyre, a windscreen and its roof hinge), from the mined
// attachment rules (scripts/mine-rules.mjs), each partner at its learned place
// in the feature part's frame. A test leaves its own set out of the counts.

export interface Rule { feature: string; neighbour: string; at: string; turn: string; exact?: number[]; color?: number; n: number; sets: Record<string, number> }
export interface RuleTable { features: Record<string, { role: string; n: number; sets: Record<string, number> }>; rules: Rule[] }

/** For each feature part, its partners used in at least `share` of its uses (without `leaveOut`). */
export function unitsOf(table: RuleTable, leaveOut: string, share = 0.5) {
  const uses = (sets: Record<string, number>) => Object.entries(sets).reduce((s, [k, v]) => s + (k === leaveOut ? 0 : v), 0);
  const units = new Map<string, Rule[]>();
  for (const r of table.rules) {
    if (r.turn === "angled") continue;
    const f = table.features[r.feature];
    const n = f ? uses(f.sets) : 0, k = uses(r.sets);
    if (n < 3 || k < share * n) continue; // seen at least 3 times elsewhere, and with it half the time
    (units.get(r.feature) ?? units.set(r.feature, []).get(r.feature)!).push(r);
  }
  return units;
}

/** A rule's partner as a placed part, in the feature part's frame. */
function partnerMatrix(r: Rule): Mat4 {
  if (r.exact) return r.exact;
  const [x, y, z] = r.at.split(",").map(Number);
  const t = r.turn.split(",").map(Number); // the 3×3 entries 0,1,2,4,5,6,8,9,10, rounded
  return [t[0], t[1], t[2], 0, t[3], t[4], t[5], 0, t[6], t[7], t[8], 0, x, y * PLATE_H, z, 1];
}

/**
 * The partners each feature part in `features` should have, placed: one per rule,
 * at its learned position, in the feature part's colour for glass-like parts or the
 * rule's colour (the designer's most common). Parts that would sit where another
 * already is are the caller's to drop (the sculptor's fixed parts can't overlap).
 */
export function placeUnits(features: PlacedBrick[], units: Map<string, Rule[]>, colorOf: (r: Rule) => number): PlacedBrick[] {
  const out: PlacedBrick[] = [];
  features.forEach((f, i) => {
    for (const r of units.get(f.partId) ?? [])
      out.push({ uid: `u${i}.${out.length}`, partId: r.neighbour, x: 0, y: 0, z: 0, rot: 0, color: colorOf(r), place: mul(partMatrix(f), partnerMatrix(r)), why: { role: "structure", cover: 0, air: 0, finish: 0, engaged: 0, prior: 0, repeat: false, rank: 0, margin: Infinity, motif: `unit: comes with ${f.partId} in most designs` } });
  });
  return out;
}
