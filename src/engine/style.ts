import { PARTS } from "./parts";
import type { PlacedBrick } from "./grid";
import { partMatrix } from "./pose";

// What kind of LEGO a model is, measured from its parts rather than its box:
// a 4+ set and a 4,000-piece UCS ship differ in numbers anyone can check.
// The style vector of every corpus design places it in a tier; the engine
// builds in a tier with the forms and the scale designers use at that level.

export interface StyleVector {
  pieces: number;
  /** Parts not upright (studs sideways or down): SNOT. */
  snot: number;
  /** Parts off the stud grid (half-stud offsets, angles, any exact placement). */
  offgrid: number;
  /** Technic system parts (beams, pins, axles, gears, panels). */
  technic: number;
  /** Plain bricks and plates. */
  plain: number;
  /** Tiles: smooth finish. */
  tiles: number;
  /** Slopes and curves. */
  slopes: number;
  /** Distinct part types per piece (higher = more specialised detail). */
  variety: number;
  /** Mean part size (stud × stud × plate). */
  size: number;
}

export function styleOf(bricks: PlacedBrick[]): StyleVector {
  const n = Math.max(1, bricks.length);
  let snot = 0, offgrid = 0, technic = 0, plain = 0, tiles = 0, slopes = 0, size = 0;
  const types = new Set<string>();
  for (const b of bricks) {
    const p = PARTS[b.partId];
    if (!p) continue;
    types.add(b.partId);
    const up = partMatrix(b)[5]; // local y → world y
    if (up < 0.99) snot++;
    if (b.place || b.pose) offgrid++;
    if (/^Technic/.test(p.category) || /^Technic/.test(p.name)) technic++;
    if (/^(Brick|Plate) \d+ ?× ?\d+( ?× ?\d+)?$/.test(p.name)) plain++;
    if (p.category === "Tile") tiles++;
    if (/^(Slope|Wedge)/.test(p.category) || /Curved/.test(p.name)) slopes++;
    size += p.w * p.d * p.h;
  }
  return { pieces: bricks.length, snot: snot / n, offgrid: offgrid / n, technic: technic / n, plain: plain / n, tiles: tiles / n, slopes: slopes / n, variety: types.size / n, size: size / n };
}

export type Tier = "junior" | "creator" | "advanced" | "expert" | "master" | "technic";

/**
 * The tiers, by definition. Technic is a different building system, so it's
 * decided first; the others are a ladder of size and technique.
 */
export const TIERS: { id: Tier; label: string; rule: string; test: (v: StyleVector) => boolean }[] = [
  { id: "technic", label: "Technic", rule: "≥ 35 % Technic parts (beams, pins, axles, gears)", test: (v) => v.technic >= 0.35 },
  { id: "junior", label: "Junior", rule: "< 120 pieces, < 8 % SNOT, big parts (≥ 6 stud·stud·plate on average)", test: (v) => v.pieces < 120 && v.snot < 0.08 && v.size >= 6 },
  { id: "creator", label: "Creator", rule: "< 700 pieces, < 25 % SNOT", test: (v) => v.pieces < 700 && v.snot < 0.25 },
  { id: "advanced", label: "Advanced", rule: "< 1,500 pieces, SNOT or off-grid detail (≥ 25 %)", test: (v) => v.pieces < 1500 },
  { id: "expert", label: "Expert", rule: "1,500–4,000 pieces", test: (v) => v.pieces < 4000 },
  { id: "master", label: "Master", rule: "≥ 4,000 pieces", test: () => true },
];

export const tierOf = (v: StyleVector): Tier => TIERS.find((t) => t.test(v))!.id;
export const tierLabel = (t: Tier) => TIERS.find((x) => x.id === t)!.label;

/** Ladder position (Technic sits beside the ladder, at Advanced). */
export const TIER_RANK: Record<Tier, number> = { junior: 0, creator: 1, advanced: 2, technic: 2, expert: 3, master: 4 };
