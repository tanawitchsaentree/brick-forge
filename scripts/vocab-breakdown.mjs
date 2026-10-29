// Why the sculptor can't place what designers place (docs/engine/phase2.md): every
// designer part of every corpus model (not Technic, not in any bench set), checked
// against the forms the sculptor would have for it. Leave-one-out like the
// decision extractor: 5 folds by set; a model's forms come from the other folds.
//
//   covered   its form is among the MAX_FORMS (1,500) the sculptor tries
//   (a)       its form is in the table, but outside the 1,500 tried
//   (b)       the part is in the catalog and kept as structure, but this form isn't
//             in the table: seen only once elsewhere (dropped by MIN_USE 2), or a pose
//             never generated. By pose: grid (on the stud grid), upright offset (half
//             stud or plate off the grid), rotated (SNOT, tilted, odd angles).
//   (c)       the part isn't in the catalog, or has no scanned shape
//   policy    in the catalog, but excluded on purpose: not structure (minifig, flowers,
//             signs), printed, or bigger than 8 × 8 × 9
//
//   node scripts/vocab-breakdown.mjs [out.json]

import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";

const ROOT = path.resolve(import.meta.dirname, "..");
globalThis.fetch = async (u) => {
  const p = path.join(ROOT, "public", String(u));
  return { ok: fs.existsSync(p), headers: { get: () => "application/json" }, json: async () => JSON.parse(fs.readFileSync(p, "utf8")) };
};
const OUT = process.argv[2] || "docs/engine/vocab-breakdown.json";
const o = { FOLDS: 5, SEED: 20261029, MAX_FORMS: 1500, MOTIFS: 4, MIN_USE: 2 };

const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
try {
  const load = (m) => vite.ssrLoadModule(m);
  await (await load("/src/engine/catalog.ts")).loadCatalog();
  const S = await load("/src/engine/shape.ts");
  const { learnForms, learnMotifs, gridForms, isStructure, sigOf, formSigOf } = await load("/src/engine/sculpt.ts");
  const { importLDraw, toGrid } = await load("/src/engine/ldrawImport.ts");
  const { connections } = await load("/src/engine/connect.ts");
  const { PARTS } = await load("/src/engine/parts.ts");
  const { categoryOf } = await load("/src/engine/category.ts");
  const shapes = JSON.parse(fs.readFileSync(path.join(ROOT, "public/shapes.json"), "utf8"));
  S.installShapes(shapes);

  const corpus = JSON.parse(fs.readFileSync(path.join(ROOT, "public/corpus/index.json"), "utf8")).models;
  const SETS = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/bench-sets.json"), "utf8"));
  const benchIds = [SETS.core8, ...Object.values(SETS.levels), SETS.technic, SETS.nightly].flat();
  const benchSets = new Set(benchIds.map((id) => corpus.find((m) => m.id === id).set));
  const usable = corpus.filter((m) => m.tier !== "technic" && !benchSets.has(m.set));
  let seed = o.SEED;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed / 2147483648);
  const sets = [...new Set(usable.map((m) => m.set))].sort();
  for (let i = sets.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [sets[i], sets[j]] = [sets[j], sets[i]];
  }
  const foldOf = new Map(sets.map((s, i) => [s, i % o.FOLDS]));
  const bricksOf = new Map(usable.map((m) => [m.id, importLDraw(fs.readFileSync(path.join(ROOT, "public/corpus", `${m.id}.mpd`), "latin1"), m.id).bricks]));
  const links = new Map([...bricksOf].map(([id, b]) => [id, connections(b)]));
  const keep = (id) => shapes[id] && isStructure(id) && !PARTS[id].printed && PARTS[id].w <= 8 && PARTS[id].d <= 8 && PARTS[id].h <= 9;

  const poseOf = (b) => {
    if (!b.place && !b.pose) return "grid";
    if (b.pose) return "rotated";
    if (toGrid(b)) return "grid";
    const m = b.place;
    const upright = Math.abs(m[5] - 1) < 1e-3 && Math.abs(m[1]) < 1e-3 && Math.abs(m[9]) < 1e-3;
    return upright ? "uprightOffset" : "rotated";
  };
  const T = {}; // cause → count
  const byCat = {}; // cause → category → count
  const rankBeyond = []; // (a): rank of the form when outside the top MAX_FORMS
  const missingParts = new Map(); // (c): part id → count
  const add = (cause, b) => {
    T[cause] = (T[cause] ?? 0) + 1;
    const c = PARTS[b.partId] ? categoryOf(b.partId) : "unknown";
    ((byCat[cause] ??= {})[c] = (byCat[cause][c] ?? 0) + 1);
  };
  let total = 0;
  for (let k = 0; k < o.FOLDS; k++) {
    const train = usable.filter((m) => foldOf.get(m.set) !== k);
    const all = learnForms(train.map((m) => bricksOf.get(m.id)), keep); // every form, with its use count
    const learned = all.filter((f) => f.use >= o.MIN_USE);
    const parts = [...new Set(learned.map((f) => f.partId))];
    const motifs = learnMotifs(train.map((m) => bricksOf.get(m.id)), train.map((m) => links.get(m.id)), keep, o.MOTIFS);
    const table = [...learned, ...parts.flatMap((p) => gridForms(p, 0)), ...motifs];
    // The sculptor's order: by use, most first (a stable sort, as sculpt() does).
    const order = [...table].sort((a, b) => b.use - a.use);
    const rank = new Map();
    order.forEach((f, i) => !f.extra && !rank.has(sigOf(f)) && rank.set(sigOf(f), i));
    const once = new Set(all.filter((f) => f.use < o.MIN_USE).map(sigOf));
    const tableParts = new Set(table.filter((f) => !f.extra).map((f) => f.partId));
    for (const m of usable.filter((x) => foldOf.get(x.set) === k))
      for (const b of bricksOf.get(m.id)) {
        total++;
        if (!PARTS[b.partId]) {
          add("c_noCatalog", b);
          missingParts.set(b.partId, (missingParts.get(b.partId) ?? 0) + 1);
          continue;
        }
        if (!shapes[b.partId]) {
          add("c_noShape", b);
          missingParts.set(b.partId, (missingParts.get(b.partId) ?? 0) + 1);
          continue;
        }
        if (!keep(b.partId)) {
          const p = PARTS[b.partId];
          add(!isStructure(b.partId) ? "policy_notStructure" : p.printed ? "policy_printed" : "policy_oversize", b);
          continue;
        }
        const sig = formSigOf(b);
        if (!sig) {
          add("c_noCells", b);
          continue;
        }
        const r = rank.get(sig);
        if (r !== undefined && r < o.MAX_FORMS) {
          add("covered", b);
          continue;
        }
        if (r !== undefined) {
          add("a_outsideTop", b);
          rankBeyond.push(r);
          continue;
        }
        const pose = poseOf(b);
        if (once.has(sig)) add(`b_seenOnce_${pose}`, b);
        else if (tableParts.has(b.partId)) add(`b_poseMissing_${pose}`, b);
        else add(`b_partNotInTable_${pose}`, b);
      }
    console.log(`fold ${k}: ${total} parts so far`);
  }
  const pct = (n) => +((100 * n) / total).toFixed(2);
  const kept = total - Object.entries(T).filter(([c]) => c.startsWith("policy") || c.startsWith("c_")).reduce((s, [, n]) => s + n, 0);
  const sum = (pre) => Object.entries(T).filter(([c]) => c.startsWith(pre)).reduce((s, [, n]) => s + n, 0);
  rankBeyond.sort((a, b) => a - b);
  const out = {
    total, kept,
    counts: T,
    pctOfAll: Object.fromEntries(Object.entries(T).map(([c, n]) => [c, pct(n)])),
    pctOfKept: Object.fromEntries(Object.entries(T).filter(([c]) => !c.startsWith("policy") && !c.startsWith("c_")).map(([c, n]) => [c, +((100 * n) / kept).toFixed(2)])),
    groups: { covered: pct(T.covered ?? 0), a: pct(sum("a_")), b: pct(sum("b_")), c: pct(sum("c_")), policy: pct(sum("policy")) },
    byCategory: byCat,
    aRank: rankBeyond.length ? { min: rankBeyond[0], median: rankBeyond[rankBeyond.length >> 1], p90: rankBeyond[Math.floor(rankBeyond.length * 0.9)], max: rankBeyond.at(-1) } : null,
    topMissingParts: [...missingParts].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([id, n]) => ({ id, n })),
  };
  fs.writeFileSync(path.join(ROOT, OUT), JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ total, kept, groups: out.groups, pctOfKept: out.pctOfKept, aRank: out.aRank }, null, 1));
} finally {
  await vite.close();
}
