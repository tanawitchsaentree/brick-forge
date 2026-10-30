import { PARTS, type Rot } from "./parts";
import type { PlacedBrick } from "./grid";
import { RES, RES_Y, partCells, unkey, vkey, type Voxels } from "./shape";

// A roof from its grammar (the DNA experiment, docs/engine/dna-rules.md): rows of
// slopes stepping up, each row on the one below, a ridge of double slopes on
// top. Designers' house roofs are 68 % slopes (Slope 45 2×4, 2×2, 2×8 most); ours
// were 48 % tiles: the greedy laid slopes without the next row over them and
// capStuds capped the studs left showing, one 1×1 at a time.
//
// The roof is the part of the target above the eaves: the layer widest across
// in the upper half (the eaves overhang the walls). Its ridge runs along the
// axis the footprint shrinks least on. Each band of 3 plates:
//   • on each side that steps in 2 studs: 45° slopes, low side outward, as long
//     as fit along the ridge (8, 6, 4, 3, 2, 1);
//   • stepping in 3 studs: 33° slopes;
//   • between them, under the next band: plain bricks;
//   • a band 2 studs across or less is the ridge: 45° double slopes.
// Bands it can't read as one of these are left to the sculptor.

type Dir = "+x" | "-x" | "+z" | "-z";
const slope45 = (n: number) => ({ 8: "4445", 6: "23949", 4: "3037", 3: "3038", 2: "3039", 1: "3040b" })[n];
const slope33 = (n: number) => ({ 6: "3939", 4: "3297", 3: "4161", 2: "3298", 1: "4286" })[n];
const double45 = (n: number) => ({ 4: "3041", 3: "3042", 2: "3043", 1: "3044b" })[n];
const brickOf = (w: number, d: number) => {
  for (const p of Object.values(PARTS)) {
    const m = p.name.match(/^Brick (\d+) ?× ?(\d+)$/);
    if (m && !p.printed && ((+m[1] === w && +m[2] === d) || (+m[1] === d && +m[2] === w))) return p.id;
  }
  return undefined;
};

/** The direction a slope part descends to at a grid turn, read from its scanned cells. */
const descents = new Map<string, Dir>();
function descentOf(id: string, rot: Rot): Dir {
  const key = `${id}:${rot}`;
  const hit = descents.get(key);
  if (hit) return hit;
  const cells: [number, number, number][] = [];
  partCells({ uid: "", partId: id, x: 0, y: 0, z: 0, rot, color: 0 }, (x, y, z) => cells.push([x, y, z]));
  const top = Math.max(...cells.map((c) => c[1]));
  const all = cells, high = cells.filter((c) => c[1] === top);
  const mid = (cs: typeof cells, i: number) => cs.reduce((s, c) => s + c[i], 0) / cs.length;
  const dx = mid(all, 0) - mid(high, 0), dz = mid(all, 2) - mid(high, 2); // from the high strip toward the body's middle
  const d: Dir = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? "+x" : "-x") : dz > 0 ? "+z" : "-z";
  descents.set(key, d);
  return d;
}
const turnFor = (id: string, want: Dir): Rot => ([0, 1, 2, 3] as Rot[]).find((r) => descentOf(id, r) === want) ?? 0;

export function roofFill(target: Voxels): { fixed: PlacedBrick[]; eave: number | null; axis: "x" | "z" | null; bands: number } {
  // Units (stud × plate) at least half full, with their colour votes.
  const fill = new Map<number, number>(), votes = new Map<number, Map<number, number>>();
  for (const [k, c] of target.cells) {
    const [x, y, z] = unkey(k);
    const u = vkey(Math.floor(x / RES), Math.floor(y / RES_Y), Math.floor(z / RES));
    fill.set(u, (fill.get(u) ?? 0) + 1);
    const v = votes.get(u) ?? new Map<number, number>();
    v.set(c, (v.get(c) ?? 0) + 1);
    votes.set(u, v);
  }
  const occ = new Set([...fill].filter(([, n]) => n * 2 >= RES * RES * RES_Y).map(([u]) => u));
  const layers = new Map<number, [number, number][]>();
  for (const u of occ) {
    const [x, y, z] = unkey(u);
    (layers.get(y) ?? layers.set(y, []).get(y)!).push([x, z]);
  }
  const ys = [...layers.keys()].sort((a, b) => a - b);
  const none = { fixed: [], eave: null, axis: null, bands: 0 };
  if (ys.length < 6) return none;
  const ext = (y: number) => {
    const c = layers.get(y) ?? [];
    return { x0: Math.min(...c.map((p) => p[0])), x1: Math.max(...c.map((p) => p[0])), z0: Math.min(...c.map((p) => p[1])), z1: Math.max(...c.map((p) => p[1])) };
  };
  // The eaves: in the upper half, the layer widest across (a roof is often a hollow
  // shell, so its area jumps about, but its width narrows steadily up to the ridge;
  // the eaves overhang the walls). The highest such layer if several tie.
  const upperHalf = ys.filter((y) => y >= ys[0] + 0.5 * (ys[ys.length - 1] - ys[0]));
  const span = (y: number) => {
    const e = ext(y);
    return Math.min(e.x1 - e.x0, e.z1 - e.z0); // across: the narrower extent (a roof is longer than it is wide)
  };
  const widest = Math.max(...upperHalf.map(span));
  const eave = [...upperHalf].reverse().find((y) => span(y) === widest)!;
  const roofYs = ys.filter((y) => y > eave);
  if (roofYs.length < 3) return none;
  // The ridge runs along the axis that shrinks least from the eaves to halfway up
  // the roof (the very top is often a chimney, no wider one way than the other).
  const e0 = ext(eave + 1), eT = ext(roofYs[Math.floor(roofYs.length / 2)]);
  const axis: "x" | "z" = e0.x1 - e0.x0 - (eT.x1 - eT.x0) <= e0.z1 - e0.z0 - (eT.z1 - eT.z0) ? "x" : "z";
  const fixed: PlacedBrick[] = [];
  const taken = new Set<number>();
  const colorAt = (x: number, y: number, z: number) => [...(votes.get(vkey(x, y, z)) ?? new Map())].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 71;
  /** Put a part if all its units are roof units not yet taken. */
  const put = (id: string | undefined, x: number, y: number, z: number, rot: Rot) => {
    if (!id || !PARTS[id]) return false;
    const cells: number[] = [];
    partCells({ uid: "", partId: id, x, y, z, rot, color: 0 }, (cx, cy, cz) => cells.push(vkey(Math.floor(cx / RES), Math.floor(cy / RES_Y), Math.floor(cz / RES))));
    const units = [...new Set(cells)];
    if (units.some((u) => taken.has(u) || !fill.has(u) || unkey(u)[1] <= eave)) return false;
    units.forEach((u) => taken.add(u));
    fixed.push({ uid: `r${fixed.length}`, partId: id, x, y, z, rot, color: colorAt(x, y, z), why: { role: "structure", cover: 0, air: 0, finish: 0, engaged: 0, prior: 0, repeat: false, rank: 0, margin: Infinity, motif: "roof: a row of slopes on the row below (roof grammar)" } });
    return true;
  };
  // Lay a run of parts along the ridge axis, longest first.
  // A turn that lays a part's length along the ridge (bricks, double slopes), or faces a slope's low side out.
  const along = (id: string): Rot => {
    const p = PARTS[id];
    const len0 = p.w; // x-extent at rot 0
    return (axis === "x" ? (len0 >= p.d ? 0 : 1) : len0 >= p.d ? 1 : 0) as Rot;
  };
  const run = (pick: (n: number) => string | undefined, lens: number[], a0: number, a1: number, cross: number, y: number, dir: Dir | "along") => {
    let a = a0;
    while (a <= a1) {
      let placed = false;
      for (const n of lens) {
        if (a + n - 1 > a1) continue;
        const id = pick(n);
        if (!id) continue;
        const rot = dir === "along" ? along(id) : turnFor(id, dir);
        const [x, z] = axis === "x" ? [a, cross] : [cross, a];
        if (put(id, x, y, z, rot)) {
          a += n;
          placed = true;
          break;
        }
      }
      if (!placed) a++;
    }
  };
  let bands = 0;
  for (let y = eave + 1; y + 2 <= roofYs[roofYs.length - 1]; y += 3) {
    const here = ext(y), next = ext(y + 3);
    const [lo, hi] = axis === "x" ? [here.z0, here.z1] : [here.x0, here.x1];
    const [a0, a1] = axis === "x" ? [here.x0, here.x1] : [here.z0, here.z1];
    const nextHas = layers.has(y + 3);
    const [nlo, nhi] = nextHas ? (axis === "x" ? [next.z0, next.z1] : [next.x0, next.x1]) : [Infinity, -Infinity];
    const width = hi - lo + 1;
    const [plus, minus]: [Dir, Dir] = axis === "x" ? ["+z", "-z"] : ["+x", "-x"];
    if (!nextHas || nhi < nlo || width <= 2) {
      // The ridge: double slopes across a band 2 wide (or single slopes facing out on 1).
      if (width === 2) run(double45, [4, 3, 2, 1], a0, a1, lo, y, "along");
      bands++;
      break;
    }
    const left = nlo - lo, right = hi - nhi;
    const lens45 = [8, 6, 4, 3, 2, 1], lens33 = [6, 4, 3, 2, 1];
    // A 45° slope is 2 deep: a stud of slope and a stud of studded strip, which the
    // next band, stepped in 1, stands on. A 33° slope is 3 deep, the next band 2 in.
    if (left === 1) run(slope45, lens45, a0, a1, lo, y, minus);
    else if (left === 2) run(slope33, lens33, a0, a1, lo, y, minus);
    if (right === 1) run(slope45, lens45, a0, a1, hi - 1, y, plus);
    else if (right === 2) run(slope33, lens33, a0, a1, hi - 2, y, plus);
    // Under the next band: bricks across its width, so it has studs to stand on.
    for (let c = nlo; c <= nhi; c += 2) {
      const w = Math.min(2, nhi - c + 1);
      run((n) => brickOf(w, n), [8, 6, 4, 3, 2, 1], a0, a1, c, y, "along");
    }
    bands++;
  }
  return { fixed, eave, axis, bands };
}
