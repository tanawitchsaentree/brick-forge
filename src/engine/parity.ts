import type { PlacedBrick } from "./grid";
import { components, connections } from "./connect";
import { RES, RES_Y, iou, unkey, vkey, voxelize, type Voxels } from "./shape";

// The benchmark's PARITY for one build (scripts/bench-engine.mjs computes the
// same, inline): kept here so the weight tuner (scripts/tune-weights.mjs)
// optimizes exactly what the benchmark reports. Checked against the bench's
// own numbers on the same builds (docs/engine/phase1.md).

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
  let onStuds = 0;
  for (const k of a) {
    const [x, y, z] = unkey(k);
    let near = false;
    for (let dx = -1; dx <= 1 && !near; dx++) for (let dz = -1; dz <= 1 && !near; dz++) near = b.has(vkey(x + dx, y, z + dz));
    if (near) onStuds++;
  }
  const humanComps = components(real.length, connections(real));
  const humanHeld = (humanComps[0]?.length ?? 0) / Math.max(1, real.length);
  const IoU = +iou(ours, target).toFixed(3);
  const held = +((comps[0]?.length ?? 0) / Math.max(1, bricks.length)).toFixed(3);
  const repeats = +(bricks.filter((x) => x.why?.repeat).length / Math.max(1, bricks.length)).toFixed(3);
  const smooth = +(a.size ? onStuds / a.size : 1).toFixed(3);
  const heldVsHuman = +Math.min(1, held / Math.max(0.01, humanHeld)).toFixed(3);
  const economy = Math.min(1, real.length / (bricks.length + 2 * made)) ** 0.5;
  return { iou: IoU, smooth, heldVsHuman, repeats, piecesXHuman: bricks.length / real.length, parity: +(IoU * smooth * heldVsHuman * economy * (1 - repeats)).toFixed(3) };
}
