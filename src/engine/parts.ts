import { PLATE_H } from "./units";

export type Shape =
  | { type: "box" }
  | { type: "round" }
  /** Flat for `flat` stud rows, then slopes down toward +z to a front lip (world units). */
  | { type: "slope"; flat: number; lip: number }
  /** Full top; the underside is flat for `flat` rows, then rises toward +z. */
  | { type: "inverted"; flat: number }
  /** An opening `span` studs wide, centred along x. */
  | { type: "arch"; span: number }
  /** Real geometry from the LDraw library (parts/<id>.dat). */
  | { type: "ldraw" };

export interface PartDef {
  id: string; // LDraw part number
  name: string;
  label: string; // short label for the picker
  category: string;
  w: number; // studs along x (LDraw: the long side is along x)
  d: number; // studs along z
  h: number; // height in plates
  shape: Shape;
  studs: [number, number][]; // stud cells (i along x, k along z) in part-local coords
  /** LDraw origin in part-local space (x/z studs, y world units); default top centre. */
  origin?: [number, number, number];
  /** Footprint rounded from a shape that doesn't fit the stud grid exactly. */
  approx?: boolean;
  /** Has a printed pattern (hidden from category browsing by default). */
  printed?: boolean;
  /** Composite parts (people): the LDraw lines they're made of, for export. */
  components?: string[];
  /** What the part is for (brick, slope:45, window, wheel, snot…), from the catalog's semantic tagging. */
  tags?: string[];
  /** Studs on its sides (SNOT), measured from geometry. */
  side?: number;
  /** Every stud, any direction (part-local studs, y up): [x, y, z, dir], dir 0..5 = +y −y +x −x +z −z. */
  connectors?: [number, number, number, number][];
  /** Exact geometry size (studs) where w/d/h were rounded. */
  geo?: [number, number, number];
  /** Made at runtime from geometry no library file holds: its LDraw lines, embedded on export. */
  made?: string;
}

/** Stud cells covering the first `rows` rows of a w x d part. */
function grid(w: number, d: number, rows = d): [number, number][] {
  const out: [number, number][] = [];
  for (let k = 0; k < rows; k++) for (let i = 0; i < w; i++) out.push([i, k]);
  return out;
}

const size = (w: number, d: number) => `${d}×${w}`;
const BOX: Shape = { type: "box" };

const brick = (id: string, w: number, d: number, h = 3): PartDef => {
  const s = h === 3 ? size(w, d) : `${size(w, d)}×${h / 3}`;
  return { id, name: `Brick ${s}`, label: s, category: "Brick", w, d, h, shape: BOX, studs: grid(w, d) };
};
const plate = (id: string, w: number, d: number): PartDef => ({
  id, name: `Plate ${size(w, d)}`, label: size(w, d), category: "Plate", w, d, h: 1, shape: BOX, studs: grid(w, d),
});
const tile = (id: string, w: number, d: number): PartDef => ({
  id, name: `Tile ${size(w, d)}`, label: size(w, d), category: "Tile", w, d, h: 1, shape: BOX, studs: [],
});
const slope = (id: string, name: string, label: string, w: number, d: number, h: number, flat: number, lip = 0.15): PartDef => ({
  id, name, label, category: "Slope", w, d, h, shape: { type: "slope", flat, lip }, studs: grid(w, d, flat),
});
const inverted = (id: string, name: string, label: string, w: number, d: number): PartDef => ({
  id, name, label, category: "Slope", w, d, h: 3, shape: { type: "inverted", flat: d - 1 }, studs: grid(w, d),
});
const round = (id: string, kind: string, n: number, h: number, studs: boolean): PartDef => ({
  id, name: `${kind} Round ${n}×${n}`, label: `${kind} ${n}×${n}`, category: "Round",
  w: n, d: n, h, shape: { type: "round" }, studs: studs ? grid(n, n) : [],
});
const arch = (id: string, w: number, h: number, span: number): PartDef => {
  const s = h === 3 ? `1×${w}` : `1×${w}×${h / 3}`;
  return { id, name: `Arch ${s}`, label: s, category: "Arch", w, d: 1, h, shape: { type: "arch", span }, studs: grid(w, 1) };
};

/** Built-in parametric parts, used when no LDraw catalog is installed. */
const BUILTIN: PartDef[] = [
  brick("3005", 1, 1),
  brick("3004", 2, 1),
  brick("3622", 3, 1),
  brick("3010", 4, 1),
  brick("3009", 6, 1),
  brick("3008", 8, 1),
  brick("6111", 10, 1),
  brick("6112", 12, 1),
  brick("2465", 16, 1),
  brick("3003", 2, 2),
  brick("3002", 3, 2),
  brick("3001", 4, 2),
  brick("2456", 6, 2),
  brick("3007", 8, 2),
  brick("3006", 10, 2),
  brick("3245c", 2, 1, 6),
  brick("14716", 1, 1, 9),
  brick("30145", 2, 2, 9),
  brick("2454", 2, 1, 15),

  plate("3024", 1, 1),
  plate("3023", 2, 1),
  plate("3623", 3, 1),
  plate("3710", 4, 1),
  plate("3666", 6, 1),
  plate("3460", 8, 1),
  plate("4477", 10, 1),
  plate("60479", 12, 1),
  plate("3022", 2, 2),
  plate("3021", 3, 2),
  plate("3020", 4, 2),
  plate("3795", 6, 2),
  plate("3034", 8, 2),
  plate("3832", 10, 2),
  plate("2445", 12, 2),
  plate("4282", 16, 2),
  plate("11212", 3, 3),
  plate("3031", 4, 4),
  plate("3032", 6, 4),
  plate("3035", 8, 4),
  plate("3030", 10, 4),
  plate("3029", 12, 4),
  plate("3958", 6, 6),
  plate("3036", 8, 6),
  plate("3033", 10, 6),
  plate("3028", 12, 6),
  plate("3456", 14, 6),
  plate("3027", 16, 6),
  plate("3026", 24, 6),
  plate("41539", 8, 8),
  plate("92438", 16, 8),
  plate("91405", 16, 16),

  tile("3070b", 1, 1),
  tile("3069b", 2, 1),
  tile("63864", 3, 1),
  tile("2431", 4, 1),
  tile("6636", 6, 1),
  tile("4162", 8, 1),
  tile("3068b", 2, 2),
  tile("26603", 3, 2),
  tile("87079", 4, 2),
  tile("69729", 6, 2),
  tile("10202", 6, 6),

  slope("3040", "Slope 45 2×1", "45° 2×1", 1, 2, 3, 1),
  slope("3039", "Slope 45 2×2", "45° 2×2", 2, 2, 3, 1),
  slope("3038", "Slope 45 2×3", "45° 2×3", 3, 2, 3, 1),
  slope("3037", "Slope 45 2×4", "45° 2×4", 4, 2, 3, 1),
  slope("3298", "Slope 33 3×2", "33° 3×2", 2, 3, 3, 1),
  slope("4286", "Slope 33 3×1", "33° 3×1", 1, 3, 3, 1),
  slope("3297", "Slope 33 3×4", "33° 3×4", 4, 3, 3, 1),
  slope("60481", "Slope 65 2×1×2", "65° 2×1×2", 1, 2, 6, 1),
  slope("54200", "Slope 30 1×1×⅔", "30° 1×1", 1, 1, 2, 0, 0.05),
  slope("85984", "Slope 30 1×2×⅔", "30° 1×2", 2, 1, 2, 0, 0.05),
  inverted("3665", "Slope 45 2×1 Inverted", "Inv 2×1", 1, 2),
  inverted("3660", "Slope 45 2×2 Inverted", "Inv 2×2", 2, 2),

  round("3062b", "Brick", 1, 3, true),
  round("3941", "Brick", 2, 3, true),
  round("4073", "Plate", 1, 1, true),
  round("4032a", "Plate", 2, 1, true),
  round("98138", "Tile", 1, 1, false),
  round("14769", "Tile", 2, 1, false),

  arch("4490", 3, 3, 1),
  arch("3659", 4, 3, 2),
  arch("3455", 6, 3, 4),
  arch("3307", 6, 6, 4),
  arch("3308", 8, 6, 6),
];

// The active catalog. Filled once at startup (see installCatalog) and then
// treated as read-only.
export const PART_LIST: PartDef[] = [...BUILTIN];
export const PARTS: Record<string, PartDef> = Object.fromEntries(PART_LIST.map((p) => [p.id, p]));

/** Renamed or obsolete part numbers → their current id. */
const MOVED: Record<string, string> = {};

export function installCatalog(parts: PartDef[], moved: Record<string, string>) {
  PART_LIST.splice(0, PART_LIST.length, ...parts);
  for (const k of Object.keys(PARTS)) delete PARTS[k];
  for (const p of parts) PARTS[p.id] = p;
  Object.assign(MOVED, moved);
}

/** Add a part made at runtime (e.g. for an imported model); not listed in the catalog. */
export function registerPart(p: PartDef) {
  PARTS[p.id] = p;
}

/** Current id for a part number, following LDraw renames; undefined if unknown. */
export function resolvePartId(id: string): string | undefined {
  if (PARTS[id]) return id;
  const to = MOVED[id];
  return to && PARTS[to] ? to : undefined;
}

/** LDraw origin of a part in its local frame. */
export function partOrigin(part: PartDef): [number, number, number] {
  return part.origin ?? [part.w / 2, part.h * PLATE_H, part.d / 2];
}

export type Rot = 0 | 1 | 2 | 3; // quarter turns, clockwise seen from above

/** Footprint in studs after rotation. */
export function footprint(part: PartDef, rot: Rot) {
  return rot % 2 === 0 ? { w: part.w, d: part.d } : { w: part.d, d: part.w };
}

/** Map a part-local cell to its offset inside the rotated footprint. */
export function rotateCell(part: PartDef, rot: Rot, i: number, k: number): [number, number] {
  let d = part.d;
  let w = part.w;
  for (let r = 0; r < rot; r++) {
    [i, k] = [d - 1 - k, i];
    [w, d] = [d, w];
  }
  return [i, k];
}
