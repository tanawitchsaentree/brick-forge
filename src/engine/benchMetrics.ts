import { PARTS } from "./parts";
import type { PlacedBrick } from "./grid";
import { connections, type Link } from "./connect";
import { analyzeStability } from "./stability";
import { RES, RES_Y, unkey, vkey, type Voxels } from "./shape";
import { visibility } from "./visibility";

// Measurements the engine benchmark reports beyond PARITY (docs/engine/phase0.md).

export { CATEGORIES, categoryOf, type Category } from "./category";
import { CATEGORIES, categoryOf, type Category } from "./category";

export interface Mix {
  share: Record<Category, number>;
  one: number; // share of 1×1 parts of any kind
}

export function mixOf(bricks: PlacedBrick[]): Mix {
  const n = Math.max(1, bricks.length);
  const share = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;
  let one = 0;
  for (const b of bricks) {
    share[categoryOf(b.partId)]++;
    const p = PARTS[b.partId];
    if (p && p.w === 1 && p.d === 1) one++;
  }
  for (const c of CATEGORIES) share[c] = +(share[c] / n).toFixed(4);
  return { share, one: +(one / n).toFixed(4) };
}

/** Absolute difference per category (ours − designer's), and the sum of their magnitudes. */
export function mixDiff(ours: Mix, human: Mix) {
  const d = Object.fromEntries(CATEGORIES.map((c) => [c, +(ours.share[c] - human.share[c]).toFixed(4)])) as Record<Category, number>;
  const one = +(ours.one - human.one).toFixed(4);
  const l1 = +(CATEGORIES.reduce((s, c) => s + Math.abs(d[c]), 0)).toFixed(4);
  return { d, one, l1 };
}

/** Structure: pieces with no connection at all, joints over their clutch limit, the worst joint. */
export function structureOf(bricks: PlacedBrick[], links: Link[] = connections(bricks)) {
  const deg = new Array(bricks.length).fill(0);
  for (const l of links) (deg[l.a]++, deg[l.b]++);
  const st = analyzeStability(bricks);
  const ratios = [...st.ratio.values()]; // per part: load on its joint ÷ what it can take
  const finite = ratios.filter(Number.isFinite);
  return {
    unconnected: deg.filter((d) => d === 0).length,
    overLimit: ratios.filter((r) => r > 1).length,
    worst: +(finite.length ? Math.max(...finite) : 0).toFixed(3),
    floating: st.floating.size,
  };
}

/**
 * Smoothness on what can be seen. Our studs that show (not covered, and seen from
 * at least one view) are weighted by the projected area of the face they stand
 * on; a stud is right where the designer also shows one within a unit at the
 * same height (the parity rule). vsmooth = weight right ÷ weight shown (1 when
 * none show). Also: visible studs per visible cm², ours and the designer's.
 */
export function visibleSmooth(ours: Voxels, target: Voxels) {
  const vo = visibility(ours), vt = visibility(target);
  const unitOf = (k: number) => {
    const [x, y, z] = unkey(k);
    return [Math.floor(x / RES), Math.floor(y / RES_Y), Math.floor(z / RES)];
  };
  const humanUnits = new Set<number>();
  let nHuman = 0;
  for (const k of target.studs ?? []) {
    const [x, y, z] = unkey(k);
    if (!vt.sees(x, y, z)) continue;
    nHuman++;
    humanUnits.add(vkey(...(unitOf(k) as [number, number, number])));
  }
  let shown = 0, right = 0, nOurs = 0;
  for (const k of ours.studs ?? []) {
    const [x, y, z] = unkey(k);
    if (!vo.sees(x, y, z)) continue;
    nOurs++;
    const w = supportWeight(ours, vo.face, x, y, z);
    shown += w;
    const [ux, uy, uz] = unitOf(k);
    let near = false;
    for (let dx = -1; dx <= 1 && !near; dx++) for (let dz = -1; dz <= 1 && !near; dz++) near = humanUnits.has(vkey(ux + dx, uy, uz + dz));
    if (near) right += w;
  }
  const area = (v: ReturnType<typeof visibility>) => Math.max(1, v.byNormal.reduce((s, n) => s + n, 0)) * 0.25 / 100; // px (0.5 mm)² → cm²
  return {
    vsmooth: +(shown ? right / shown : 1).toFixed(3),
    studsPerCm2: +(nOurs / area(vo)).toFixed(3),
    humanStudsPerCm2: +(nHuman / area(vt)).toFixed(3),
  };
}

/** The face a stud cell stands on: the filled neighbour's exposed face toward it, its projected weight. */
function supportWeight(v: Voxels, face: Map<number, number>, x: number, y: number, z: number) {
  const N: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  let w = 0;
  N.forEach(([nx, ny, nz], n) => {
    // The neighbour at −normal whose face n points at this cell.
    const k = vkey(x - nx, y - ny, z - nz);
    if (v.cells.has(k)) w = Math.max(w, face.get(k * 6 + n) ?? 0);
  });
  return Math.max(1, w);
}
