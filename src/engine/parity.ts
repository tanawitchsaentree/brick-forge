import type { PlacedBrick } from "./grid";
import { components, connections } from "./connect";
import { RES, RES_Y, iou, unkey, vkey, voxelize, type Voxels } from "./shape";

// The benchmark's PARITY for one build (scripts/bench-engine.mjs computes the
// same, inline): kept here so the weight tuner (scripts/tune-weights.mjs)
// optimizes exactly what the benchmark reports. Checked against the bench's
// own numbers on the same builds (docs/engine/phase1.md).
//
// PARITY_v2 (docs/engine/phase2.md) fixes two faults of `smooth`, which the
// frozen PARITY keeps for comparison:
//   • on a small model a few studs decide it: one stray stud of one gave 0. Both
//     shares are shrunk toward 1 by α = 3 stud units, (right + α) / (n + α), so the
//     designer still scores exactly 1 and one stray stud of one gives 0.75;
//   • it only punished studs we show where the designer has none, never studs the
//     designer shows that we tiled over (our tile share +0.24, half the visible
//     studs). smooth_v2 is the harmonic mean of that precision and its recall: the
//     designer's stud units where we show a stud too (within a unit, same height).

const studUnits = (v: Voxels) =>
  new Set(
    [...(v.studs ?? [])].map((k) => {
      const [x, y, z] = unkey(k);
      return vkey(Math.floor(x / RES), Math.floor(y / RES_Y), Math.floor(z / RES));
    }),
  );

/** `made`: made-to-measure parts among `bricks` (they count as 3 pieces). */
export function parityOf(real: PlacedBrick[], target: Voxels, bricks: PlacedBrick[], made: number) {
  const ours = voxelize(bricks);
  const comps = components(bricks.length, connections(bricks));
  const [a, b] = [studUnits(ours), studUnits(target)];
  const nearIn = (set: Set<number>, k: number) => {
    const [x, y, z] = unkey(k);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (set.has(vkey(x + dx, y, z + dz))) return true;
    return false;
  };
  let onStuds = 0, kept = 0;
  for (const k of a) if (nearIn(b, k)) onStuds++;
  for (const k of b) if (nearIn(a, k)) kept++;
  const humanComps = components(real.length, connections(real));
  const humanHeld = (humanComps[0]?.length ?? 0) / Math.max(1, real.length);
  const IoU = +iou(ours, target).toFixed(3);
  const held = +((comps[0]?.length ?? 0) / Math.max(1, bricks.length)).toFixed(3);
  const repeats = +(bricks.filter((x) => x.why?.repeat).length / Math.max(1, bricks.length)).toFixed(3);
  const smooth = +(a.size ? onStuds / a.size : 1).toFixed(3);
  const heldVsHuman = +Math.min(1, held / Math.max(0.01, humanHeld)).toFixed(3);
  const economy = Math.min(1, real.length / (bricks.length + 2 * made)) ** 0.5;
  const ALPHA = 3;
  const precision = (onStuds + ALPHA) / (a.size + ALPHA), recall = (kept + ALPHA) / (b.size + ALPHA);
  const smoothV2 = +((2 * precision * recall) / (precision + recall)).toFixed(3);
  return {
    iou: IoU, smooth, smoothV2, studRecall: +recall.toFixed(3), heldVsHuman, repeats, piecesXHuman: bricks.length / real.length,
    parity: +(IoU * smooth * heldVsHuman * economy * (1 - repeats)).toFixed(3),
    parityV2: +(IoU * smoothV2 * heldVsHuman * economy * (1 - repeats)).toFixed(3),
  };
}
