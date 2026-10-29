// Builds the design corpus: official LEGO models from the LDraw Official Model
// Repository (library.ldraw.org/omr, CC BY 2.0), taken apart into single
// objects (a set with three cars gives three designs; minifigures, cones and
// cameras are left out) and written to public/corpus as clean .mpd files with
// an index. The Ideas panel builds from these: real designs by LEGO's own
// designers, recoloured and remixed, instead of hand-written rules.
//
//   node scripts/build-corpus.mjs            (uses booklets/omr as a download cache)
//
// Runs the app's own importer through Vite, so what's measured here is exactly
// what the app will load.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createServer } from "vite";

const ROOT = path.resolve(import.meta.dirname, "..");
const CACHE = path.join(ROOT, "booklets/omr");
const OUT = path.join(ROOT, "public/corpus");
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/corpus.json"), "utf8"));
// Models that aren't ours to publish (a MOC someone sold or gave us for study) are
// listed outside the repo, in booklets/local-models.json (gitignored, like the
// files themselves): [{ file, id, kind, name, theme, year }]. Their ids start with
// "moc-" so public/corpus/moc-*.mpd can be gitignored, and their index entries go
// to public/corpus/private.json (gitignored, never deployed), not index.json, so
// nothing public is learned from them.
const LOCAL_FILE = path.join(ROOT, "booklets/local-models.json");
const LOCAL = fs.existsSync(LOCAL_FILE) ? JSON.parse(fs.readFileSync(LOCAL_FILE, "utf8")) : [];
const OMR = "https://library.ldraw.org";

// ---- download (cached) ------------------------------------------------------

const curl = (url) => execFileSync("curl", ["-sfL", "-A", "Mozilla/5.0 (brick-forge corpus)", url], { maxBuffer: 1 << 28 });

function setIndex() {
  const file = path.join(CACHE, "index.json");
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  const rows = {};
  for (let page = 1; ; page++) {
    const html = curl(`${OMR}/omr/sets?page=${page}`).toString();
    const re = /href="https:\/\/library\.ldraw\.org\/omr\/sets\/(\d+)"\s+class="fi-ta-col"\s*>\s*<div class="fi-ta-text[^"]*">([^<]*)<\/div>/g;
    const before = Object.keys(rows).length;
    let m;
    while ((m = re.exec(html))) (rows[m[1]] ??= []).push(m[2].trim().replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&#0?39;/g, "'").replace(/&quot;/g, '"'));
    if (Object.keys(rows).length === before) break; // past the last page
  }
  const index = Object.entries(rows).map(([id, [set, name, theme, year]]) => ({ id, set, name, theme, year }));
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(index));
  return index;
}

/** The model files of one set (a 3-in-1 has one per model), downloaded once. */
function modelFiles(set, index) {
  const dir = path.join(CACHE, set);
  if (fs.existsSync(dir)) return fs.readdirSync(dir).filter((f) => /\.(mpd|ldr)$/i.test(f)).sort().map((f) => path.join(dir, f));
  const row = index.find((r) => r.set === set);
  if (!row) throw new Error(`${set} is not in the OMR`);
  const html = curl(`${OMR}/omr/sets/${row.id}`).toString();
  const urls = [...new Set(html.match(/https:\/\/library\.ldraw\.org\/media\/omr_models\/[^"?]+/g) ?? [])].sort();
  fs.mkdirSync(dir, { recursive: true });
  for (const u of urls) fs.writeFileSync(path.join(dir, path.basename(u)), curl(u));
  return modelFiles(set, index);
}

// ---- taking a set apart -------------------------------------------------------

const FIGURE = /minifig|mini-fig|\bfig\b|figure|driver|pilot|guy|girl|astronaut|\bkid\b|\bman\b|woman|person|people|crew|racer \d|mechanic/i;
const PROP = /\bcone\b|camera|stand|sign|flag|tool|trophy|barrier|ramp|plant|tree|flower|bird|fence/i;

function box(bricks, worldBox) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const b of bricks) {
    const w = worldBox(b);
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], w.lo[i]);
      hi[i] = Math.max(hi[i], w.hi[i]);
    }
  }
  return { lo, hi };
}
const overlaps = (a, b, pad) => [0, 1, 2].every((i) => a.lo[i] - pad < b.hi[i] && b.lo[i] - pad < a.hi[i]);

/**
 * Objects in an imported set: each big sub-model (or the loose parts of the
 * main model) is a candidate; small pieces touching an object join it (a
 * wheel set, a windscreen), figures and props are dropped.
 */
function objects(bricks, PARTS, worldBox) {
  const tops = new Map();
  for (const b of bricks) {
    const k = b.group === "Model" ? "Model" : `${b.top}`; // loose main-model parts form one candidate
    if (!tops.has(k)) tops.set(k, { name: b.group, bricks: [] });
    tops.get(k).bricks.push(b);
  }
  const isFig = (t) => FIGURE.test(t.name) || t.bricks.filter((b) => /^Minifig/.test(PARTS[b.partId]?.category ?? "")).length > t.bricks.length * 0.5;
  const cands = [...tops.values()].filter((t) => !isFig(t)).map((t) => ({ ...t, box: box(t.bricks, worldBox) }));
  cands.sort((a, b) => b.bricks.length - a.bricks.length);
  // A small sub-model touching an object is a piece of it (wheels, feet, a
  // windscreen); a big neighbour is an object of its own (the next car).
  // Merged until nothing changes, so feet join a body through its legs.
  const objs = cands.map((c) => ({ ...c, bricks: [...c.bricks] }));
  const piece = (c, o) => c.bricks.length < 25 || c.bricks.length < o.bricks.length * 0.4;
  for (let merged = true; merged; ) {
    merged = false;
    for (let i = 0; i < objs.length && !merged; i++)
      for (let j = i + 1; j < objs.length && !merged; j++) {
        const [o, c] = [objs[i], objs[j]]; // o is the bigger (sorted)
        if (!overlaps(o.box, c.box, 1) || !piece(c, o)) continue;
        o.bricks.push(...c.bricks);
        o.box = box(o.bricks, worldBox);
        objs.splice(j, 1);
        objs.sort((a, b) => b.bricks.length - a.bricks.length);
        merged = true;
      }
  }
  const biggest = Math.max(0, ...objs.map((o) => o.bricks.length));
  // Minifigure parts inside an object (a driver in the seat) stay: they're part of the design.
  return objs.filter((o) => o.bricks.length >= Math.max(12, biggest * 0.3) && !PROP.test(o.name));
}

/** Same parts in the same colours: the same design shown twice (an open and a closed version). */
// Who modelled it (the first "0 Author:" line; CC BY 2.0 asks that they're credited).
const authorOf = (text) => text.match(/^0\s+Author:\s*(.+?)\s*$/m)?.[1] ?? "";

const signature = (bricks) => bricks.map((b) => `${b.partId}:${b.color}`).sort().join(",");

/** An .mpd holding only the given main-model lines and the files they use. */
function extract(text, keep) {
  const blocks = [];
  let cur = null;
  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const m = raw.trim().match(/^0\s+FILE\s+(.+)$/i);
    if (m) {
      cur = { name: m[1].trim(), key: m[1].trim().toLowerCase().replace(/\\/g, "/"), lines: [] };
      blocks.push(cur);
      continue;
    }
    if (/^0\s+NOFILE/i.test(raw.trim())) continue;
    if (!cur) blocks.push((cur = { name: "main.ldr", key: "main.ldr", lines: [] }));
    cur.lines.push(raw.trim());
  }
  const [main, ...rest] = blocks;
  const byKey = new Map(rest.map((b) => [b.key, b]));
  const mainLines = main.lines.filter((l, i) => !/^[1-5]\s/.test(l) || keep.has(i));
  const used = new Set();
  const visit = (lines) => {
    for (const l of lines) {
      const t = l.split(/\s+/);
      if (t[0] !== "1" || t.length < 15) continue;
      const k = t.slice(14).join(" ").toLowerCase().replace(/\\/g, "/");
      const b = byKey.get(k);
      if (b && !used.has(k)) {
        used.add(k);
        visit(b.lines);
      }
    }
  };
  visit(mainLines);
  const out = [`0 FILE ${main.name}`, ...mainLines];
  for (const b of rest) if (used.has(b.key)) out.push("0 NOFILE", `0 FILE ${b.name}`, ...b.lines);
  return out.join("\n") + "\n";
}

// ---- main -----------------------------------------------------------------------

globalThis.fetch = async (u) => {
  const p = path.join(ROOT, "public", String(u));
  return { ok: fs.existsSync(p), headers: { get: () => "application/json" }, json: async () => JSON.parse(fs.readFileSync(p, "utf8")) };
};
const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
try {
  await (await vite.ssrLoadModule("/src/engine/catalog.ts")).loadCatalog();
  const { importLDraw } = await vite.ssrLoadModule("/src/engine/ldrawImport.ts");
  const { worldBox } = await vite.ssrLoadModule("/src/engine/pose.ts");
  const { PARTS } = await vite.ssrLoadModule("/src/engine/parts.ts");
  const { styleOf, tierOf } = await vite.ssrLoadModule("/src/engine/style.ts");
  const round3 = (v) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Math.round(x * 1000) / 1000]));

  const index = setIndex();
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const entries = [];
  const privateEntries = [];
  const seen = new Set();
  // Kinds the Ideas panel shows, then sets kept only to learn from (styles,
  // forms): Technic, Creator Expert, Modular buildings, UCS, BrickHeadz…
  const groups = [...Object.entries(MANIFEST.kinds), ["other", MANIFEST.learn ?? []]];
  for (const [kind, sets] of groups) {
    for (const spec of sets) {
      // "set" or "set:file-substring" (one model of a 3-in-1) or "set@object-name".
      const [, set, only, named] = spec.match(/^([^:@]+)(?::([^@]+))?(?:@(.+))?$/);
      const row = index.find((r) => r.set === set);
      let files;
      try {
        files = modelFiles(set, index).filter((f) => !only || path.basename(f).toLowerCase().includes(only.toLowerCase()));
      } catch (e) {
        console.warn(`skip ${set}: ${e.message}`);
        continue;
      }
      for (const file of files) {
        const text = fs.readFileSync(file, "latin1");
        const m = importLDraw(text, path.basename(file));
        let objs = objects(m.bricks, PARTS, worldBox).filter((o) => {
          const sig = signature(o.bricks);
          return !seen.has(sig) && seen.add(sig);
        });
        if (named) objs = objs.filter((o) => o.name.toLowerCase().includes(named.toLowerCase()));
        objs.forEach((o, k) => {
          const keep = new Set(o.bricks.map((b) => b.top));
          const base = `${set}${files.length > 1 ? "-" + path.basename(file).replace(/\.(mpd|ldr)$/i, "").replace(/^.*?_/, "").replace(/[^a-z0-9]+/gi, "").toLowerCase() : ""}${objs.length > 1 ? "-" + (k + 1) : ""}`;
          const id = base;
          if (MANIFEST.exclude?.includes(id)) return;
          const as = MANIFEST.move?.[id] ?? kind;
          fs.writeFileSync(path.join(OUT, `${id}.mpd`), extract(text, keep));
          const size = o.box.hi.map((h, i) => Math.round((h - o.box.lo[i]) * 10) / 10);
          const sub = o.name && !/^model$/i.test(o.name) ? o.name.replace(/^\d+(-\d)?\s*-\s*/, "") : "";
          const style = styleOf(o.bricks);
          entries.push({ id, kind: as, set, name: row?.name ?? set, model: sub, theme: row?.theme ?? "", year: Number(row?.year) || 0, author: authorOf(text), parts: o.bricks.length, size, tier: tierOf(style), style: round3(style) });
          console.log(`${as.padEnd(6)} ${id.padEnd(28)} ${String(o.bricks.length).padStart(4)} parts  ${size.join("×")}  ${row?.name ?? ""} ${sub ? "· " + sub : ""}`);
        });
      }
    }
  }
  // Models given as files (a Studio .io or an .ldr someone shared), whole.
  const { readIoModel } = await vite.ssrLoadModule("/src/engine/ioFile.ts");
  for (const l of LOCAL) {
    if (!l.id.startsWith("moc-")) throw new Error(`local model ${l.id}: ids start with "moc-" (gitignored)`);
    const file = path.join(ROOT, l.file);
    if (!fs.existsSync(file)) continue;
    const text = /\.io$/i.test(file) ? await readIoModel(fs.readFileSync(file).buffer) : fs.readFileSync(file, "latin1");
    const m = importLDraw(text, l.id);
    const b = box(m.bricks, worldBox);
    fs.writeFileSync(path.join(OUT, `${l.id}.mpd`), text);
    const style = styleOf(m.bricks);
    privateEntries.push({ id: l.id, kind: l.kind, set: l.id, name: l.name, model: "", theme: l.theme, year: l.year, parts: m.bricks.length, size: b.hi.map((h, i) => Math.round((h - b.lo[i]) * 10) / 10), tier: tierOf(style), style: round3(style) });
    console.log(`${l.kind.padEnd(6)} ${l.id.padEnd(28)} ${String(m.bricks.length).padStart(4)} parts  ${l.name}`);
  }
  entries.sort((a, b) => a.kind.localeCompare(b.kind) || a.parts - b.parts);
  fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify({ source: "LDraw.org Official Model Repository (CC BY 2.0)", models: entries }));
  if (privateEntries.length) fs.writeFileSync(path.join(OUT, "private.json"), JSON.stringify({ source: "local only, not for publishing", models: privateEntries }));
  console.log(`${entries.length} designs → public/corpus${privateEntries.length ? ` (+ ${privateEntries.length} local only)` : ""}`);
} finally {
  await vite.close();
}
