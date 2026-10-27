import { PARTS, footprint } from "./parts";
import type { PlacedBrick } from "./grid";

// How hard is a build? Measured from the design itself, the way a box's age
// mark summarises it:
//
//   D = log₂(n+1) + 0.05·types + 0.5·√(snot + joints) + 2·small + min(stress, 1)
//
//   n      pieces            — more pieces, longer and harder, with diminishing returns
//   types  distinct parts    — more to tell apart and find
//   snot   sub-assemblies    — sideways building (eye blocks, teeth) is a skill step
//   joints ball joints, parts set at an angle — lining a socket up on a tilted section is another
//   small  share of 1×1s     — fiddly to grip and place
//   stress weakest joint     — overhangs that need holding while you build
//
// Stars: D < 6 ★, < 7.6 ★★, < 9.6 ★★★, < 11.8 ★★★★, else ★★★★★ (ages 4+ … 12+).
// Calibrated so ~30 pieces reads 6+, ~80 reads 8+, ~200 reads 10+, 400+ reads 12+,
// in line with the age marks on LEGO Classic and Creator boxes.
// Time: about (6 + 2·stars) seconds per piece.

export interface Difficulty {
  score: number;
  stars: 1 | 2 | 3 | 4 | 5;
  age: number;
  label: "Easy" | "Medium" | "Hard" | "Expert" | "Master";
  minutes: number;
  types: number;
  subassemblies: number;
}

const LABELS = ["Easy", "Medium", "Hard", "Expert", "Master"] as const;
const AGES = [4, 6, 8, 10, 12];

export function rateDifficulty(bricks: PlacedBrick[], stress: number): Difficulty {
  const n = bricks.length;
  const types = new Set(bricks.map((b) => b.partId)).size;
  const subassemblies = bricks.filter((b) => PARTS[b.partId]?.components && !b.partId.startsWith("lb-person")).length;
  const joints = new Set(bricks.flatMap((b) => b.joints ?? [])).size;
  const small = n
    ? bricks.filter((b) => {
        const p = PARTS[b.partId];
        if (!p) return false;
        const { w, d } = footprint(p, b.rot);
        return w * d === 1;
      }).length / n
    : 0;
  const score =
    Math.log2(n + 1) + 0.05 * types + 0.5 * Math.sqrt(subassemblies + joints) + 2 * small + Math.min(Number.isFinite(stress) ? stress : 1, 1);
  const stars = (score < 6 ? 1 : score < 7.6 ? 2 : score < 9.6 ? 3 : score < 11.8 ? 4 : 5) as Difficulty["stars"];
  return {
    score,
    stars,
    age: AGES[stars - 1],
    label: LABELS[stars - 1],
    minutes: Math.max(1, Math.round((n * (6 + 2 * stars)) / 60)),
    types,
    subassemblies,
  };
}
