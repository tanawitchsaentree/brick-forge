import { PARTS, footprint, partOrigin, resolvePartId, type PartDef, type Rot } from "./parts";
import type { PlacedBrick } from "./grid";
import { chain, mul, scale, translate, worldBox, type Mat4 } from "./pose";
import { PLATE_H } from "./units";

// Reads real models — .ldr / .mpd (and the model.ldr inside a Studio .io) —
// into the engine, so designs by LEGO and by expert builders can be studied:
// rendered, load-tested, and taken apart into sub-assemblies to learn from.
//
// Submodels are flattened. A part whose transform is a quarter turn about
// the vertical on whole studs and plates becomes an ordinary grid part (so
// clutch, stability and instructions work as for anything built here);
// anything else (tilted, sideways, half-stud) keeps its exact matrix.

export interface ImportResult {
  /** `top`: which line of the main model the part comes from (a sub-model, or the part itself). */
  bricks: (PlacedBrick & { group: string; top: number })[];
  name: string;
  /** Part references the catalog doesn't have (left out). */
  missing: Record<string, number>;
  /** Placed exactly (off the stud grid): SNOT, hinges, angles, half-stud offsets. */
  exact: number;
}

/** LDraw axes (y down, z toward the viewer, 20 LDU per stud) to ours. */
const TO_WORLD = scale(1 / 20, -1 / 20, -1 / 20);
const FROM_LOCAL = scale(20, -20, -20);

function lineMatrix(t: number[]): Mat4 {
  // "x y z a b c d e f g h i": rows (a b c), (d e f), (g h i).
  const [x, y, z, a, b, c, d, e, f, g, h, i] = t;
  return [a, d, g, 0, b, e, h, 0, c, f, i, 0, x, y, z, 1];
}

/** File names as references use them: case-insensitive, either slash. */
const fileKey = (name: string) => name.trim().toLowerCase().replace(/\\/g, "/");

/** The files of an .mpd or Studio model (a plain .ldr is one), and which is the main model. */
function splitFiles(text: string) {
  const files = new Map<string, string[]>();
  const names = new Map<string, string>(); // key → name as written
  let current = "__main__";
  let first: string | null = null;
  for (const raw of text.replace(/^\ufeff/, "").split(/\r?\n/)) {
    const line = raw.trim();
    const m = line.match(/^0\s+FILE\s+(.+)$/i);
    if (m) {
      current = fileKey(m[1]);
      names.set(current, m[1].trim());
      first ??= current;
      files.set(current, []);
      continue;
    }
    if (/^0\s+NOFILE/i.test(line)) continue;
    if (!files.has(current)) files.set(current, []);
    files.get(current)!.push(line);
  }
  return { files, names, main: first ?? "__main__" };
}

/** A part the catalog lacks, made from LDraw text (the scene measures and registers it). */
export interface MadePart {
  id: string;
  name: string;
  /** LDraw text in the part's own frame: plain lines, or an MPD whose first file is the part. */
  ldraw: string;
  /** Geometry from the model itself (no library file to point at). */
  inline?: boolean;
  /** Already measured (a part made to measure by the engine): used as is. */
  def?: PartDef;
}

const INLINE = "io-";
const slug = (name: string) => INLINE + name.replace(/\.(dat|ldr)$/i, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
const hasGeometry = (lines: string[]) => lines.some((l) => /^[34]\s/.test(l));
const refOf = (t: string[]) => fileKey(t.slice(14).join(" "));
/** An embedded copy of a part the catalog has ("41505 - 14704.dat" → 14704). */
const catalogCopy = (key: string) => resolvePartId(key.replace(/^.* - /, "").replace(/\.dat$/, ""));

/**
 * Whether a file inside a model is a part rather than a sub-assembly. Model
 * files embed parts the official library lacks (new moulds, stickers, Studio's
 * bent hoses) as files of their own, drawn with primitives and raw triangles;
 * those are placed whole, not walked into.
 */
function isPart(lines: string[]): boolean {
  const org = lines.find((l) => /^0\s+!LDRAW_ORG/i.test(l));
  if (org) return !/\bModel\b/i.test(org);
  return hasGeometry(lines);
}

/**
 * A part file with every model file it uses, as an MPD whose first file is the
 * part. Embedded files get plain names (references are rewritten): LDrawLoader
 * resolves "s\\x.dat" to "parts/s/x.dat" but stores an embedded "s\\x.dat" as is.
 */
function bundle(key: string, files: Map<string, string[]>, id: string): string {
  const rename = new Map<string, string>([[key, `${id}.dat`]]);
  const queue = [key];
  while (queue.length)
    for (const line of files.get(queue.shift()!)!) {
      const t = line.split(/\s+/);
      if (t[0] !== "1" || t.length < 15) continue;
      const ref = refOf(t);
      if (!files.has(ref) || rename.has(ref)) continue;
      rename.set(ref, `${slug(ref)}-${id}.dat`);
      queue.push(ref);
    }
  const out: string[] = [];
  for (const [k, name] of rename) {
    if (out.length) out.push("0 NOFILE");
    out.push(`0 FILE ${name}`);
    for (const line of files.get(k)!) {
      const t = line.split(/\s+/);
      const to = t[0] === "1" && t.length >= 15 ? rename.get(refOf(t)) : undefined;
      out.push(to ? [...t.slice(0, 14), to].join(" ") : line);
    }
  }
  return out.join("\n");
}

/**
 * Parts a model needs that the catalog doesn't have, so they can be made
 * rather than left out: library files the catalog skips (subparts such as a
 * hose end) and parts stored in the model itself (unofficial moulds,
 * stickers, a hose Studio bent to shape).
 */
export function partsToMake(text: string): MadePart[] {
  const { files, names } = splitFiles(text);
  const made = new Map<string, MadePart>();
  for (const [key, lines] of files) {
    if (isPart(lines)) {
      if (catalogCopy(key)) continue;
      const id = slug(key);
      made.set(id, { id, name: `Custom ${(names.get(key) ?? key).replace(/\.(dat|ldr)$/i, "")}`, ldraw: bundle(key, files, id), inline: true });
      continue;
    }
    for (const line of lines) {
      const t = line.split(/\s+/);
      if (t[0] !== "1" || t.length < 15) continue;
      const ref = refOf(t);
      const id = ref.replace(/\.dat$/, "");
      if (files.has(ref) || resolvePartId(id) || made.has(id)) continue;
      made.set(id, { id, name: id, ldraw: `1 16 0 0 0 1 0 0 0 1 0 0 0 1 ${ref}` });
    }
  }
  return [...made.values()];
}

export function importLDraw(text: string, fileName = "model"): ImportResult {
  const { files, main } = splitFiles(text);

  const out: ImportResult["bricks"] = [];
  const missing: Record<string, number> = {};
  let exact = 0, n = 0;
  // Official steps: STEP lines number them as the files are walked, so a
  // sub-model is built in its own steps where it's first used; the same
  // sub-model again (the other three wheels) goes on in a single step.
  let top = 0, step = 0;
  const built = new Set<string>();
  let replay = 0; // > 0 inside a sub-model already built step by step
  const walk = (name: string, G: Mat4, color: number, group: string, depth: number) => {
    if (depth > 16) return;
    const lines = files.get(name) ?? [];
    // A part stored in the model: placed whole, as made by partsToMake.
    if (depth > 0 && isPart(lines)) {
      const known = catalogCopy(name) ?? (PARTS[slug(name)] ? slug(name) : undefined);
      if (known) place(known, G, color, group);
      else missing[name] = (missing[name] ?? 0) + 1;
      return;
    }
    lines.forEach((line, i) => {
      const t = line.split(/\s+/);
      if (t[0] === "0" && /^(STEP|ROTSTEP)$/i.test(t[1] ?? "")) {
        if (!replay) step++;
        return;
      }
      if (t[0] !== "1" || t.length < 15) return;
      if (depth === 0) top = i;
      const c = t[1] === "16" ? color : Number(t[1]);
      const ref = t.slice(14).join(" ").trim();
      const M = mul(G, lineMatrix(t.slice(2, 14).map(Number)));
      const key = fileKey(ref);
      if (files.has(key)) {
        const again = built.has(key) || replay > 0;
        if (again) replay++;
        else if (!isPart(files.get(key)!)) step++; // its steps start fresh
        walk(key, M, c, depth === 0 ? ref.replace(/\.(dat|ldr)$/i, "") : group, depth + 1);
        if (again) replay--;
        else built.add(key);
        if (!replay && !isPart(files.get(key)!)) step++; // what follows it is a new step
        return;
      }
      const id = resolvePartId(key.replace(/\.dat$/, ""));
      if (!id) {
        missing[ref] = (missing[ref] ?? 0) + 1;
        return;
      }
      place(id, M, c, group);
    });
  };
  const place = (id: string, M: Mat4, color: number, group: string) => {
    const [ox, oy, oz] = partOrigin(PARTS[id]);
    // Part-local (our frame) → LDraw part coordinates → LDraw world → ours.
    const at = chain(TO_WORLD, M, FROM_LOCAL, translate(-ox, -oy, -oz));
    out.push({ uid: `m${n++}`, partId: id, x: 0, y: 0, z: 0, rot: 0 as Rot, color, place: at, group, top, step });
  };
  walk(main, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 71, "Model", 0);

  // Stand it on the baseplate, centred.
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const b of out) {
    const w = worldBox(b);
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], w.lo[i]);
      hi[i] = Math.max(hi[i], w.hi[i]);
    }
  }
  // Shift onto the grid: the offset (mod a stud / a plate) most upright parts
  // share, so they land on whole studs and plates, and the model sits on the
  // baseplate (its lowest part at y ≥ 0) roughly centred.
  const mode = (vals: number[]) => {
    const count = new Map<number, number>();
    for (const v of vals) {
      const f = Math.round((((v % 1) + 1) % 1) * 1000) / 1000 % 1;
      count.set(f, (count.get(f) ?? 0) + 1);
    }
    return [...count].sort((p, q) => q[1] - p[1])[0]?.[0] ?? 0;
  };
  const corners = out.flatMap((b) => {
    const m = b.place!;
    if (!near(m[5], 1)) return [];
    const part = PARTS[b.partId];
    const turned = near(Math.abs(m[2]), 1);
    const { w, d } = turned ? { w: part.d, d: part.w } : { w: part.w, d: part.d };
    return [[m[0] * (part.w / 2) + m[8] * (part.d / 2) + m[12] - w / 2, m[13] / PLATE_H, m[2] * (part.w / 2) + m[10] * (part.d / 2) + m[14] - d / 2]];
  });
  const fx = mode(corners.map((c) => c[0])), fy = mode(corners.map((c) => c[1])), fz = mode(corners.map((c) => c[2]));
  const dx = Math.round(16 - (lo[0] + hi[0]) / 2 + fx) - fx;
  const dz = Math.round(16 - (lo[2] + hi[2]) / 2 + fz) - fz;
  const dyPlates = Math.ceil(-lo[1] / PLATE_H + fy - 1e-6) - fy;
  const shift = translate(dx, dyPlates * PLATE_H, dz);
  for (const b of out) {
    b.place = mul(shift, b.place!);
    // Back onto the grid where it sits on it: a quarter turn about y, whole studs and plates.
    const g = toGrid(b);
    if (g) {
      Object.assign(b, g);
      delete b.place;
    } else {
      b.seg = -1 - out.indexOf(b);
      exact++;
    }
  }
  return { bricks: out, name: fileName, missing, exact };
}

const near = (v: number, t: number) => Math.abs(v - t) < 1e-3;

/** Grid placement reproducing an exact matrix, if there is one. */
export function toGrid(b: PlacedBrick): Pick<PlacedBrick, "x" | "y" | "z" | "rot"> | null {
  const m = b.place!;
  // Upright (y stays y) and a quarter turn about it.
  if (!near(m[5], 1) || !near(m[1], 0) || !near(m[9], 0) || !near(m[4], 0) || !near(m[6], 0)) return null;
  // Grid rot r turns by −r·90° about y: (cos, −sin) = (1,0), (0,1), (−1,0), (0,−1).
  const rot = ([[1, 0], [0, 1], [-1, 0], [0, -1]] as const).findIndex(([c, s]) => near(m[0], c) && near(m[2], s));
  if (rot < 0) return null;
  const part = PARTS[b.partId];
  const { w, d } = footprint(part, rot as Rot);
  // Our grid placement puts the footprint's min corner at (x, z), bottom at y.
  // The part-local box centre (w/2, 0, d/2) lands at (x + w/2, y·PLATE_H, z + d/2).
  const cx = m[0] * (part.w / 2) + m[8] * (part.d / 2) + m[12];
  const cz = m[2] * (part.w / 2) + m[10] * (part.d / 2) + m[14];
  const x = cx - w / 2, z = cz - d / 2, y = m[13] / PLATE_H;
  if (!near(x, Math.round(x)) || !near(z, Math.round(z)) || !near(y, Math.round(y))) return null;
  return { x: Math.round(x), y: Math.round(y), z: Math.round(z), rot: rot as Rot };
}
