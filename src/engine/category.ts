import { PARTS } from "./parts";

// What kind of piece a part is, for the benchmark's mix and the sculptor's features.

/** Piece categories compared with the designer's. `one` (1×1 of any kind) overlaps the others. */
export const CATEGORIES = ["plate", "brick", "tile", "slope", "snot", "technic", "other"] as const;
export type Category = (typeof CATEGORIES)[number];

const SNOT = /Bracket|with Studs? on (\d )?Sides?|Headlight|with Stud on|Studs on Sides/i;

export function categoryOf(id: string): Category {
  const p = PARTS[id];
  if (!p) return "other";
  if (/^Technic/i.test(p.name) || /^(Axle|Pin|Beam|Gear|Liftarm)/i.test(p.name)) return "technic";
  if (SNOT.test(p.name)) return "snot";
  if (p.category === "Tile") return "tile";
  if (p.category === "Slope" || /^(Wedge|Slope|Curved)/i.test(p.name) || /Curved/i.test(p.name)) return "slope";
  if (p.category === "Plate") return "plate";
  if (p.category === "Brick") return "brick";
  return "other";
}
