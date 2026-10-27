// Builds public/catalog.json from an extracted LDraw library (public/ldraw).
//
// For every official part it resolves all subfiles and primitives, then derives
// what the grid engine needs: footprint (studs), height (plates), the stud cells
// on top, and where the LDraw origin sits relative to the part's bounding box.
//
// Usage: node scripts/build-catalog.mjs [ldrawDir] [outDir]

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.argv[2] ?? "public/ldraw");
const OUT_DIR = path.resolve(process.argv[3] ?? "public");

const LDU_STUD = 20;
const LDU_PLATE = 8;
const MAX_STUDS = 32;
// Top-facing stud primitives. stud3/stud4 etc. are underside tubes, not studs.
const STUD_RE = /^stud(2a?|6a?|10|15|el|17a|18a|p\d+|-logo\d*)?\.dat$/;
const SKIP_TYPES = /Alias|Shortcut|Primitive|Subpart|Physical_Colour|Configuration/i;
const SKIP_NAMES = /Sticker|Obsolete|Moved to/i;
const PRINTED = /Pattern|Decorated|Print/i; // kept, but flagged so the library can hide them
const SKIP_CATEGORIES = new Set(["Sticker", "Moved", "Obsolete", "Duplo", "Znap", "Clikits", "Belville", "Scala"]);

// ---------------------------------------------------------------- file lookup

const GEN = path.resolve(OUT_DIR, "ldraw-gen", "parts"); // parts this script composes (people)
const fileIndex = new Map(); // "stud.dat" | "s/x.dat" | "48/x.dat" -> absolute path
function indexDir(dir, prefix) {
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    if (f.toLowerCase().endsWith(".dat")) fileIndex.set(prefix + f.toLowerCase(), path.join(dir, f));
  }
}
indexDir(path.join(ROOT, "parts"), "");
indexDir(path.join(ROOT, "parts", "s"), "s/");
indexDir(path.join(ROOT, "p"), "");
indexDir(path.join(ROOT, "p", "48"), "48/");
indexDir(path.join(ROOT, "p", "8"), "8/");

// ------------------------------------------------------------------- people

// Minifigures assembled from real LDraw parts. Offsets follow LDraw's own
// torso assembly (76382) and hips/legs (3815c01); colour 16 (the torso) takes
// whatever colour the user picks.
const TORSO = [
  "1 16 0 0 0 1 0 0 0 1 0 0 0 1 973.dat",
  "1 16 -15.552 9 0 0.985 -0.17 0 0.17 0.985 0 0 0 1 3818.dat",
  "1 16 15.552 9 0 0.985 0.17 0 -0.17 0.985 0 0 0 1 3819.dat",
  "1 14 -23.69 26.774 -9.898 0.985 -0.12 0.12 0.17 0.696 -0.696 0 0.707 0.707 3820.dat",
  "1 14 23.69 26.774 -9.898 0.985 0.12 -0.12 -0.17 0.696 -0.696 0 0.707 0.707 3820.dat",
  "1 14 0 -24 0 1 0 0 0 1 0 0 0 1 3626bp01.dat",
];
const legs = (c) => [
  `1 ${c} 0 32 0 1 0 0 0 1 0 0 0 1 3815b.dat`,
  `1 ${c} 0 44 0 1 0 0 0 1 0 0 0 1 3816c.dat`,
  `1 ${c} 0 44 0 1 0 0 0 1 0 0 0 1 3817c.dat`,
];
const PEOPLE = [
  ["classic", "Classic", "3901", 70, 1],
  ["builder", "Construction Worker", "3833", 14, 272],
  ["police", "Police Officer", "3624", 0, 0],
  ["cowboy", "Cowboy", "3629", 70, 1],
  ["bun", "Hair Bun", "99240", 0, 320],
  ["tousled", "Tousled Hair", "62810", 19, 72],
  ["combed", "Combed Hair", "92081", 0, 15],
  ["bald", "Bald", null, 0, 71],
];
fs.rmSync(path.dirname(GEN), { recursive: true, force: true });
fs.mkdirSync(GEN, { recursive: true });
// Composite parts: id → its LDraw lines, the lines that define its grid
// footprint (`base`), and whether its top/bottom come from the base or from
// everything (so hats count toward a person's height but eye tiles don't).
const composites = new Map();
function compose(id, title, category, lines, base, top = "all", bottom = "all") {
  const text = [`0 ${title}`, `0 Name: ${id}.dat`, "0 !LDRAW_ORG Unofficial_Part", `0 !CATEGORY ${category}`, "", ...lines, ""].join("\n");
  fs.writeFileSync(path.join(GEN, `${id}.dat`), text);
  fileIndex.set(`${id}.dat`, path.join(GEN, `${id}.dat`));
  composites.set(id, { lines, base, top, bottom });
}

for (const [slug, title, hat, hatColor, legColor] of PEOPLE) {
  const lines = [...(hat ? [`1 ${hatColor} 0 -24 0 1 0 0 0 1 0 0 0 1 ${hat}.dat`] : []), ...TORSO, ...legs(legColor)];
  compose(`lb-person-${slug}`, `Person ${title}`, "People", lines, legs(legColor));
}

// Character parts, built with SNOT ("studs not on top") the way LEGO does it:
// a 1×1 brick with a stud on its front (87087: side stud at (0, 10, −10),
// pointing −z, LDraw's front) carries a round eye tile. The tile is turned
// 90° about x so its face points out: rows (1 0 0 | 0 0 −1 | 0 1 0), and its
// origin sits 8 LDU (its thickness) in front of the brick face, at z = −18.
const SNOT = "1 16 0 0 0 1 0 0 0 1 0 0 0 1 87087.dat";
const onSideStud = (color, tile) => `1 ${color} 0 10 -18 1 0 0 0 0 -1 0 1 0 ${tile}.dat`;
const EYES = [
  ["eye", "Eye Block (open)", "98138p07"],
  ["eye-sleepy", "Eye Block (half closed)", "98138p0b"],
  ["eye-side", "Eye Block (side glance)", "98138p0k"],
  ["eye-big", "Big Eye Block", "14769p01"],
];
for (const [slug, title, tile] of EYES) compose(`lb-${slug}`, `${title} SNOT`, "Character", [SNOT, onSideStud(15, tile)], [SNOT], "base", "base");
// A plate whose tooth hangs down in front of the cell below (15070).
compose("lb-tooth", "Tooth Plate (hanging)", "Character", ["1 15 0 0 0 1 0 0 0 1 0 0 0 1 15070.dat"], ["1 15 0 0 0 1 0 0 0 1 0 0 0 1 3024.dat"], "base", "base");
// A race driver: a minifig head (its neck socket takes a stud) in a helmet, on a round 1×1 brick.
const DRIVER_SEAT = "1 0 0 0 0 1 0 0 0 1 0 0 0 1 3062b.dat";
compose("lb-driver", "Race Driver", "Character", [
  DRIVER_SEAT,
  "1 14 0 -24 0 1 0 0 0 1 0 0 0 1 3626bp01.dat",
  "1 16 0 -24 0 1 0 0 0 1 0 0 0 1 15851.dat",
], [DRIVER_SEAT], "all", "base");
// Bigger wheels: plate 4600 has wheel pins at (±22, 5, 0) pointing along x; a
// 30027 rim with tyre (Ø36 LDU, 20 wide, axle along z) is turned 90° about y
// onto each pin, centred at x = ±32 so it covers the pin (22…34).
const WHEEL_PLATE = "1 16 0 0 0 1 0 0 0 1 0 0 0 1 4600.dat";
compose("lb-wheels-big", "Wheel Set 2×2 Large", "Character", [
  WHEEL_PLATE,
  "1 15 32 5 0 0 0 1 0 1 0 -1 0 0 30027bc01.dat",
  "1 15 -32 5 0 0 0 -1 0 1 0 1 0 0 30027bc01.dat",
], ["1 16 0 0 0 1 0 0 0 1 0 0 0 1 3022.dat"], "base", "all"); // footprint of a plain 2×2: pins and wheels stick out
// Narrow axle: plate 1×4 with wheel pins at its ends (2926: pins at x = ±42,
// pointing out), a rim + tyre on each, centred at ±52. Wheels stand outside a
// 4-wide car.
compose("lb-axle-4", "Axle 1×4 with Wheels", "Character", [
  "1 16 0 0 0 1 0 0 0 1 0 0 0 1 2926.dat",
  "1 15 52 5 0 0 0 1 0 1 0 -1 0 0 30027bc01.dat",
  "1 15 -52 5 0 0 0 -1 0 1 0 1 0 0 30027bc01.dat",
], ["1 16 0 0 0 1 0 0 0 1 0 0 0 1 3710.dat"], "base", "all");
// Window 1×2×2 with trans-clear glass, as LDraw's own 60592c01 (glass shares the frame's origin).
compose("lb-window", "Window 1×2×2 with Glass", "Character", [
  "1 16 0 0 0 1 0 0 0 1 0 0 0 1 60592.dat",
  "1 47 0 0 0 1 0 0 0 1 0 0 0 1 60601.dat",
], ["1 16 0 0 0 1 0 0 0 1 0 0 0 1 60592.dat"], "base", "base");
// Plate 2×2 with wheels (122c01): footprint of the plate, height down to the tyres.
compose("lb-wheels", "Wheel Set 2×2", "Character", ["1 16 0 0 0 1 0 0 0 1 0 0 0 1 122c01.dat"], ["1 16 0 0 0 1 0 0 0 1 0 0 0 1 3022.dat"], "base", "all");

const norm = (name) => name.trim().replace(/\\/g, "/").toLowerCase();

// ------------------------------------------------------------------- geometry

// 3x4 affine matrix as [a,b,c,d,e,f,g,h,i,x,y,z]: p' = M p + t
const apply = (m, [x, y, z]) => [
  m[0] * x + m[1] * y + m[2] * z + m[9],
  m[3] * x + m[4] * y + m[5] * z + m[10],
  m[6] * x + m[7] * y + m[8] * z + m[11],
];
const applyDir = (m, [x, y, z]) => [
  m[0] * x + m[1] * y + m[2] * z,
  m[3] * x + m[4] * y + m[5] * z,
  m[6] * x + m[7] * y + m[8] * z,
];

/** Transforming a box by M is exact only if M maps axes onto axes (no tilt). */
const axisAligned = (m) =>
  [0, 3, 6].every((r) => [m[r], m[r + 1], m[r + 2]].filter((v) => Math.abs(v) > 1e-6).length <= 1);

/** All face vertices of a file in its own coordinates, studs excluded (memoised). */
const vertCache = new Map();
function vertices(key, stack = new Set()) {
  if (vertCache.has(key)) return vertCache.get(key);
  const file = fileIndex.get(key);
  if (!file || stack.has(key)) return [];
  stack.add(key);
  const out = [];
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim().split(/\s+/);
    if (t[0] === "1" && t.length >= 15) {
      const sub = norm(t.slice(14).join(" "));
      if (STUD_RE.test(path.basename(sub))) continue;
      const n = t.slice(2, 14).map(Number);
      const m = [n[3], n[4], n[5], n[6], n[7], n[8], n[9], n[10], n[11], n[0], n[1], n[2]];
      for (const v of vertices(sub, stack)) out.push(apply(m, v));
    } else if ((t[0] === "3" && t.length >= 11) || (t[0] === "4" && t.length >= 14)) {
      const count = t[0] === "3" ? 3 : 4;
      for (let v = 0; v < count; v++) out.push(t.slice(2 + v * 3, 5 + v * 3).map(Number));
    }
  }
  stack.delete(key);
  vertCache.set(key, out);
  return out;
}

/** Bounding box and stud list of a file in its own coordinates (memoised). */
const infoCache = new Map();
function analyze(key, stack = new Set()) {
  if (infoCache.has(key)) return infoCache.get(key);
  const file = fileIndex.get(key);
  if (!file || stack.has(key)) return null;
  stack.add(key);

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const studs = [];
  const grow = (p) => {
    for (let a = 0; a < 3; a++) {
      if (p[a] < min[a]) min[a] = p[a];
      if (p[a] > max[a]) max[a] = p[a];
    }
  };

  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim().split(/\s+/);
    if (t[0] === "1" && t.length >= 15) {
      const n = t.slice(2, 14).map(Number);
      const m = [n[3], n[4], n[5], n[6], n[7], n[8], n[9], n[10], n[11], n[0], n[1], n[2]];
      const sub = norm(t.slice(14).join(" "));
      if (STUD_RE.test(path.basename(sub))) {
        studs.push({ p: apply(m, [0, 0, 0]), up: applyDir(m, [0, -1, 0]) });
        continue;
      }
      const info = analyze(sub, stack);
      if (!info) continue;
      if (info.min[0] !== Infinity) {
        if (axisAligned(m)) {
          for (const cx of [info.min[0], info.max[0]])
            for (const cy of [info.min[1], info.max[1]])
              for (const cz of [info.min[2], info.max[2]]) grow(apply(m, [cx, cy, cz]));
        } else {
          // A tilted box overestimates curved primitives; use the real vertices.
          for (const v of vertices(sub)) grow(apply(m, v));
        }
      }
      for (const s of info.studs) studs.push({ p: apply(m, s.p), up: applyDir(m, s.up) });
    } else if (t[0] === "3" && t.length >= 11) {
      for (let v = 0; v < 3; v++) grow(t.slice(2 + v * 3, 5 + v * 3).map(Number));
    } else if (t[0] === "4" && t.length >= 14) {
      for (let v = 0; v < 4; v++) grow(t.slice(2 + v * 3, 5 + v * 3).map(Number));
    }
  }

  stack.delete(key);
  const info = { min, max, studs };
  infoCache.set(key, info);
  return info;
}

/** Bounding box of a handful of type-1 lines (used for composite footprints). */
function analyzeLines(lines) {
  const tmp = `__lines_${Math.random().toString(36).slice(2)}.dat`;
  const file = path.join(GEN, tmp);
  fs.writeFileSync(file, lines.join("\n"));
  fileIndex.set(tmp, file);
  const info = analyze(tmp);
  fs.rmSync(file);
  fileIndex.delete(tmp);
  return info;
}

// ---------------------------------------------------------------------- parts

function header(file) {
  const out = { description: "", type: "", category: "" };
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/, 40);
  out.description = (lines[0] ?? "").replace(/^0\s*/, "").trim();
  for (const l of lines) {
    const m = l.match(/^0\s+!LDRAW_ORG\s+(.+)/);
    if (m) out.type = m[1];
    const c = l.match(/^0\s+!CATEGORY\s+(.+)/);
    if (c) out.category = c[1].trim();
  }
  return out;
}

const round = (v, p = 4) => Math.round(v * 10 ** p) / 10 ** p;

// Semantic tags: what a part is *for*, so the assembly engine can ask for
// "a 45° slope 2 wide" or "a window" or "something with a side stud" and use
// whatever the library has. From the name and category; side studs come from
// geometry (stud primitives pointing sideways).
const TAG_RULES = [
  [/^Brick\b/, "brick"], [/^Plate\b/, "plate"], [/^Tile\b/, "tile"],
  [/Slope/, "slope"], [/Curved/, "curved"], [/Inverted/, "inverted"], [/Double/, "double"],
  [/\bRound\b/, "round"], [/^Cone/, "cone"], [/^Cylinder|Cylinder/, "cylinder"], [/^Dish|Dome/, "dish"],
  [/^Wedge|\bWedge\b/, "wedge"], [/^Arch\b/, "arch"],
  [/Window|Glass for Window|Pane/, "window"], [/^Door\b|Door Frame/, "door"],
  [/^Wheel\b|Wheel Rim/, "wheel"], [/^Tyre|^Tire/, "tyre"], [/Wheel (Pins?|Holder)|Wheels Holder/, "axle-holder"],
  [/Windscreen/, "windscreen"], [/Grille/, "grille"], [/Mudguard/, "mudguard"], [/Steering/, "steering"],
  [/with Studs? on (\d )?Sides?|Bracket|with Headlight/, "snot"], [/Headlight/, "headlight"],
  [/Hinge/, "hinge"], [/\bClip/, "clip"], [/\bBar\b/, "bar"], [/^Technic/, "technic"], [/Jumper|with 1 Stud|Centre Stud/, "jumper"],
  [/^Plant|Flower|Leaves|Tree/, "plant"], [/^Fence|Railing/, "fence"], [/^Ladder/, "ladder"], [/^Antenna/, "antenna"],
  [/^Flag/, "flag"], [/^Panel/, "panel"], [/Seat|Chair/, "seat"], [/Turntable/, "turntable"], [/Propeller/, "propeller"],
  [/Eye|Face/, "face"], [/Tooth|Teeth|Horn|Claw/, "creature"], [/^Minifig|^Person/, "figure"],
];
function tagsFor(desc, category, info, minY) {
  const tags = new Set();
  for (const [re, t] of TAG_RULES) if (re.test(desc)) tags.add(t);
  const angle = desc.match(/Slope (?:Brick )?(\d{2})\b/);
  if (angle) tags.add(`slope:${angle[1]}`);
  if (/^(Brick|Plate|Tile) \d+ x \d+( x \d+)?$/.test(desc)) tags.add("plain");
  const side = info.studs.filter((st) => Math.abs(st.up[1]) < 0.3).length;
  if (side) tags.add("snot");
  if (category === "Minifig" || category.startsWith("Minifig")) tags.add("figure");
  return { tags: [...tags], side };
}
const parts = [];
const moved = {}; // old id -> new id, so saved models keep working
let skipped = 0;

const partFiles = [...fs.readdirSync(path.join(ROOT, "parts")), ...fs.readdirSync(GEN)];
for (const f of partFiles) {
  if (!f.toLowerCase().endsWith(".dat")) continue;
  const key = f.toLowerCase();
  const h = header(fileIndex.get(key));
  const desc = h.description.replace(/\s+/g, " ");
  const mv = desc.match(/^~Moved to (\S+)/);
  if (mv) moved[key.replace(/\.dat$/, "")] = mv[1].toLowerCase().replace(/\.dat$/, "");
  else if (/\(Obsolete\)/.test(desc)) moved[key.replace(/\.dat$/, "")] = key.replace(/\.dat$/, "");
  if (!desc || /^[~=_|]/.test(desc) || SKIP_TYPES.test(h.type) || SKIP_NAMES.test(desc)) {
    skipped++;
    continue;
  }
  const category = h.category || desc.split(" ")[0];
  if (SKIP_CATEGORIES.has(category)) {
    skipped++;
    continue;
  }

  const info = analyze(key);
  if (!info || info.min[0] === Infinity) {
    skipped++;
    continue;
  }
  const composite = composites.get(key.replace(/\.dat$/, ""));
  // Composites take their footprint from their base parts (a person's legs,
  // an eye block's brick), not from hands, hats or eye tiles that stick out.
  const foot = composite ? analyzeLines(composite.base) : info;
  const [minX, , minZ] = foot.min;
  const [maxX, , maxZ] = foot.max;
  const minY = (composite?.top === "base" ? foot : info).min[1];
  const maxY = (composite?.bottom === "base" ? foot : info).max[1];
  const ex = maxX - minX, ey = maxY - minY, ez = maxZ - minZ;
  const w = Math.max(1, Math.round(ex / LDU_STUD));
  const d = Math.max(1, Math.round(ez / LDU_STUD));
  const hp = Math.max(1, Math.round(ey / LDU_PLATE));
  if (w > MAX_STUDS || d > MAX_STUDS || hp > 120) {
    skipped++;
    continue;
  }
  const approx = Math.abs(ex - w * LDU_STUD) > 2 || Math.abs(ez - d * LDU_STUD) > 2 || Math.abs(ey - hp * LDU_PLATE) > 2;

  // Upward studs on the top surface → grid cells (our z axis is LDraw -z).
  const cells = new Set();
  for (const s of info.studs) {
    if (s.up[1] > -0.9 || Math.abs(s.p[1] - minY) > 1.5) continue;
    if (s.p[0] < minX - 1 || s.p[0] > maxX + 1 || s.p[2] < minZ - 1 || s.p[2] > maxZ + 1) continue; // e.g. wheel hubs
    const i = Math.min(w - 1, Math.max(0, Math.floor((s.p[0] - minX) / LDU_STUD)));
    const k = Math.min(d - 1, Math.max(0, Math.floor((maxZ - s.p[2]) / LDU_STUD)));
    cells.add(`${i},${k}`);
  }

  const entry = {
    id: key.replace(/\.dat$/, ""),
    n: desc,
    c: category,
    w, d, h: hp,
    s: [...cells].map((c) => c.split(",").map(Number)),
    // LDraw origin in part-local grid space (x/z in studs, y in world units).
    o: [round(-minX / LDU_STUD), round(maxY / LDU_STUD), round(maxZ / LDU_STUD)],
  };
  if (approx) entry.a = 1;
  if (PRINTED.test(desc)) entry.pr = 1;
  const sem = tagsFor(desc, category, info, minY);
  if (sem.tags.length) entry.t = sem.tags.join(",");
  if (sem.side) entry.ss = sem.side; // studs on the sides (SNOT)
  if (composite) entry.x = composite.lines;
  parts.push(entry);
}

const natural = new Intl.Collator("en", { numeric: true });
parts.sort((a, b) => natural.compare(a.c, b.c) || a.w * a.d - b.w * b.d || natural.compare(a.n, b.n));

// Primitives live in p/, but LDrawLoader looks in parts/ first; a file map
// sends it straight to the right folder instead of 404-ing on every stud.
const fileMap = {};
for (const [k, abs] of fileIndex) {
  const rel = path.relative(ROOT, abs).split(path.sep).join("/");
  if (rel.startsWith("p/")) fileMap[k] = rel;
}

// Follow chains (a → b → c). If a chain ends on an obsolete part, fall back to
// its newest successor with the same number plus a letter (3660a → 3660b).
const ids = new Set(parts.map((p) => p.id));
const successor = (id) => [...ids].filter((x) => x.length === id.length + 1 && x.startsWith(id) && /[a-z]$/.test(x)).sort().pop();
const bySuffix = new Map(); // "3660" -> ["3660a", "3660b"]
for (const id of ids) {
  const m = id.match(/^(.*\d)[a-z]$/);
  if (m) bySuffix.set(m[1], [...(bySuffix.get(m[1]) ?? []), id].sort());
}
for (const k of Object.keys(moved)) {
  let t = moved[k];
  for (let hops = 0; moved[t] && moved[t] !== t && hops < 10; hops++) t = moved[t];
  if (!ids.has(t)) t = successor(t) ?? bySuffix.get(t.replace(/[a-z]$/, ""))?.at(-1) ?? t;
  if (ids.has(t) && t !== k) moved[k] = t;
  else delete moved[k];
}

// Every colour LDraw defines (solid, transparent, metallic…), from LDConfig.ldr.
const colors = [];
for (const l of fs.readFileSync(path.join(ROOT, "LDConfig.ldr"), "utf8").split(/\r?\n/)) {
  const m = l.match(/^0\s+!COLOUR\s+(\S+)\s+CODE\s+(\d+)\s+VALUE\s+#([0-9A-Fa-f]{6})(?:.*?ALPHA\s+(\d+))?/);
  if (!m) continue;
  const code = Number(m[2]);
  if (code === 16 || code === 24) continue; // "main" and "edge" placeholders
  const c = { code, name: m[1].replace(/_/g, " "), hex: `#${m[3].toUpperCase()}` };
  if (m[4]) c.alpha = Number(m[4]) / 255;
  colors.push(c);
}

fs.writeFileSync(path.join(OUT_DIR, "catalog.json"), JSON.stringify({ parts, moved, colors }));
fs.writeFileSync(path.join(OUT_DIR, "ldraw-filemap.json"), JSON.stringify(fileMap));

const byCat = {};
for (const p of parts) byCat[p.c] = (byCat[p.c] ?? 0) + 1;
console.log(
  `${parts.length} parts (${parts.filter((p) => p.pr).length} printed, ${skipped} skipped), ` +
    `${Object.keys(moved).length} moved ids, ${colors.length} colours, ${Object.keys(fileMap).length} primitives mapped`,
);
console.log(Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(" · "));
