import { PARTS, type Rot } from "./parts";
import type { PlacedBrick } from "./grid";
import { RES, RES_Y, unkey, vkey, type Voxels } from "./shape";

// The shell target (program v2 S3, docs/engine/north-star.md). Designers build a
// core and a skin; the sculptor filled whole solids form by form, and spent most
// of its pieces and time inside, where nothing shows. Here the inside is filled
// first with the biggest plain bricks and plates that fit, and the sculptor then
// works only on the skin around them (they go in as its fixed parts).
//
// Inside: a stud × plate unit whose cells are all in the target, and so are its
// 4 sideways neighbours and the units above and below it. So the skin is one stud
// thick sideways and one plate thick top and bottom.

const FULL = 0xffffffff; // all 32 cells of a unit (RES · RES · RES_Y = 32)

/** Stock rectangles, biggest first: plain bricks and plates the catalog has (w ≤ d). */
function stock(kind: "Brick" | "Plate") {
  const out: { id: string; w: number; d: number }[] = [];
  for (const p of Object.values(PARTS)) {
    const m = p.name.match(/^(Brick|Plate) (\d+) ?× ?(\d+)$/);
    if (!m || m[1] !== kind || p.printed) continue;
    const a = +m[2], b = +m[3];
    if (Math.max(a, b) > 8) continue; // the sculptor's own size rule (keepPart)
    if (!out.some((s) => s.w === Math.min(a, b) && s.d === Math.max(a, b))) out.push({ id: p.id, w: Math.min(a, b), d: Math.max(a, b) });
  }
  return out.sort((x, y) => y.w * y.d - x.w * x.d || y.d - x.d);
}

export function interiorFill(target: Voxels): { fixed: PlacedBrick[]; interiorUnits: number } {
  // Units and how full each is.
  const mask = new Map<number, number>();
  const votes = new Map<number, Map<number, number>>();
  for (const [k, color] of target.cells) {
    const [x, y, z] = unkey(k);
    const ux = Math.floor(x / RES), uy = Math.floor(y / RES_Y), uz = Math.floor(z / RES);
    const u = vkey(ux, uy, uz);
    const bit = (x - ux * RES) + RES * ((z - uz * RES) + RES * (y - uy * RES_Y));
    mask.set(u, (mask.get(u) ?? 0) | (1 << bit));
    const v = votes.get(u) ?? new Map<number, number>();
    v.set(color, (v.get(color) ?? 0) + 1);
    votes.set(u, v);
  }
  const full = (x: number, y: number, z: number) => (mask.get(vkey(x, y, z)) ?? 0) >>> 0 === FULL;
  const inside = new Set<number>();
  for (const u of mask.keys()) {
    const [x, y, z] = unkey(u);
    if (full(x, y, z) && full(x + 1, y, z) && full(x - 1, y, z) && full(x, y, z + 1) && full(x, y, z - 1) && full(x, y + 1, z) && full(x, y - 1, z)) inside.add(u);
  }
  const bricks = stock("Brick"), plates = stock("Plate");
  const used = new Set<number>();
  const free = (x: number, y: number, z: number) => inside.has(vkey(x, y, z)) && !used.has(vkey(x, y, z));
  const fits = (x: number, y: number, z: number, w: number, d: number, h: number) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) for (let k = 0; k < d; k++) if (!free(x + i, y + j, z + k)) return false;
    return true;
  };
  const fixed: PlacedBrick[] = [];
  const ys = [...new Set([...inside].map((u) => unkey(u)[1]))].sort((a, b) => a - b);
  for (const y of ys) {
    // Alternate courses lay their long side the other way, so the inside bonds.
    const along = Math.floor(y / 3) % 2;
    const here = [...inside].map(unkey).filter((p) => p[1] === y).sort((a, b) => a[0] - b[0] || a[2] - b[2]);
    for (const [x, , z] of here) {
      if (!free(x, y, z)) continue;
      let placed = false;
      for (const [list, h] of [[bricks, 3], [plates, 1]] as const) {
        for (const s of list) {
          for (const turn of along ? [1, 0] : [0, 1]) {
            const w = turn ? s.d : s.w, d = turn ? s.w : s.d; // footprint along x, z
            if (!fits(x, y, z, w, d, h)) continue;
            const tally = new Map<number, number>();
            for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) for (let k = 0; k < d; k++) {
              used.add(vkey(x + i, y + j, z + k));
              for (const [c, n] of votes.get(vkey(x + i, y + j, z + k)) ?? []) tally.set(c, (tally.get(c) ?? 0) + n);
            }
            const color = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 71;
            const p = PARTS[s.id];
            const rot: Rot = (p.w === w && p.d === d ? 0 : 1) as Rot;
            fixed.push({ uid: `i${fixed.length}`, partId: s.id, x, y, z, rot, color, why: { role: "structure", cover: w * d * h * 32, air: 0, finish: 0, engaged: 0, prior: 0, repeat: false, rank: 0, margin: Infinity, motif: "inside: the biggest plain part that fits where nothing shows" } });
            placed = true;
            break;
          }
          if (placed) break;
        }
        if (placed) break;
      }
    }
  }
  return { fixed, interiorUnits: inside.size };
}
