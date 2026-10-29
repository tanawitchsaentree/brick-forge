// Phase 1: designer decisions for learning the sculptor's weights
// (docs/engine/phase1.md). Each corpus model is replayed through the sculptor
// (sculpt's REPLAY mode): at each sampled part, the designer's form and the
// candidates at its anchor become one decision (candidate 0 = the designer's).
//
// Leave-one-out (rule 3): models are split into 5 folds by set. A model's forms,
// motifs and priors come only from the other folds. Every set in the benchmark
// (scripts/bench-sets.json, all of it) is left out entirely. Technic is left
// out, like the benchmark's learning.
//
//   node scripts/extract-decisions.mjs out.jsonl ['{"K":32,"R":8,"CAP":200,"WEIGHTS":"data/weights.json"}']
//
// With WEIGHTS, the negatives are the top K by those weights (the re-extraction
// round): negatives from the old score are biased toward what it already likes.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createServer } from "vite";

const ROOT = path.resolve(import.meta.dirname, "..");
globalThis.fetch = async (u) => {
  const p = path.join(ROOT, "public", String(u));
  return { ok: fs.existsSync(p), headers: { get: () => "application/json" }, json: async () => JSON.parse(fs.readFileSync(p, "utf8")) };
};
const OUT = process.argv[2] || "data/decisions.jsonl";
const o = { K: 32, R: 8, CAP: 200, FOLDS: 5, SEED: 20261029, MAX_FORMS: 1500, MOTIFS: 4, MIN_USE: 2, ...JSON.parse(process.argv[3] || "{}") };

const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
try {
  const load = (m) => vite.ssrLoadModule(m);
  await (await load("/src/engine/catalog.ts")).loadCatalog();
  const S = await load("/src/engine/shape.ts");
  const { sculpt, learnForms, learnMotifs, gridForms, isStructure, FEATURES, sigOf, formSigOf } = await load("/src/engine/sculpt.ts");
  const { importLDraw } = await load("/src/engine/ldrawImport.ts");
  const { connections } = await load("/src/engine/connect.ts");
  const { PARTS } = await load("/src/engine/parts.ts");
  const shapes = JSON.parse(fs.readFileSync(path.join(ROOT, "public/shapes.json"), "utf8"));
  S.installShapes(shapes);
  const weights = typeof o.WEIGHTS === "string" ? JSON.parse(fs.readFileSync(path.join(ROOT, o.WEIGHTS), "utf8")) : undefined;

  const corpus = JSON.parse(fs.readFileSync(path.join(ROOT, "public/corpus/index.json"), "utf8")).models;
  const SETS = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/bench-sets.json"), "utf8"));
  const benchIds = [SETS.core8, ...Object.values(SETS.levels), SETS.technic, SETS.nightly].flat();
  const benchSets = new Set(benchIds.map((id) => corpus.find((m) => m.id === id).set));
  const usable = corpus.filter((m) => m.tier !== "technic" && !benchSets.has(m.set));

  // Folds by set, seeded.
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

  const out = fs.createWriteStream(OUT);
  out.write(JSON.stringify({ names: FEATURES, extracted: { ...o, WEIGHTS: weights?.version ?? "baseline score", benchSetsLeftOut: benchSets.size, models: usable.length, date: new Date().toISOString() } }) + "\n");
  const stats = { models: 0, parts: 0, sampled: 0, inTable: 0, known: 0, overlap: 0, fitNonPos: 0, belowMinCover: 0, eitherGate: 0, decisions: 0, top1: 0, top5: 0 };
  const t0 = performance.now();
  for (let k = 0; k < o.FOLDS; k++) {
    const train = usable.filter((m) => foldOf.get(m.set) !== k);
    const learned = learnForms(train.map((m) => bricksOf.get(m.id)), keep).filter((f) => f.use >= o.MIN_USE);
    const parts = [...new Set(learned.map((f) => f.partId))];
    const motifs = o.MOTIFS ? learnMotifs(train.map((m) => bricksOf.get(m.id)), train.map((m) => links.get(m.id)), keep, o.MOTIFS) : [];
    const forms = [...learned, ...parts.flatMap((p) => gridForms(p, 0)), ...motifs];
    const tableSigs = new Set(forms.filter((f) => !f.extra).map(sigOf)); // the whole table, before MAX_FORMS
    for (const m of usable.filter((x) => foldOf.get(x.set) === k).slice(0, o.LIMIT ?? Infinity)) { // LIMIT: a smoke test
      const bricks = bricksOf.get(m.id);
      // At most CAP sampled decisions per model, chosen by a seeded hash of the part's index.
      const rate = Math.min(1, o.CAP / Math.max(1, bricks.length));
      const pick = (i) => (parseInt(crypto.createHash("md5").update(`${m.id}:${i}`).digest("hex").slice(0, 8), 16) / 0xffffffff) < rate;
      stats.models++;
      stats.parts += bricks.length;
      sculpt(S.voxelize(bricks), {
        forms, MAX_FORMS: o.MAX_FORMS, WEIGHTS: weights,
        REPLAY: {
          bricks, K: o.K, R: o.R, seed: o.SEED, sample: pick, keep,
          emit: (d) => {
            stats.sampled++;
            if (tableSigs.has(formSigOf(bricks[d.brick]))) stats.inTable++;
            if (d.known) stats.known++;
            if (d.overlap) stats.overlap++;
            if (d.gate?.fitNonPos) stats.fitNonPos++;
            if (d.gate?.belowMinCover) stats.belowMinCover++;
            if (d.gate && (d.gate.fitNonPos || d.gate.belowMinCover)) stats.eitherGate++;
            if (!d.feats) return;
            stats.decisions++;
            if (d.better === 0) stats.top1++;
            if (d.better < 5) stats.top5++;
            out.write(JSON.stringify({ set: m.set, id: m.id, tier: m.tier, fold: k, known: d.known, gate: d.gate, better: d.better, candidates: d.candidates, feats: d.feats, cover: d.cover }) + "\n");
          },
        },
      });
    }
    console.log(`fold ${k}: ${stats.models} models, ${stats.decisions} decisions, ${Math.round((performance.now() - t0) / 1000)} s`);
  }
  out.end();
  const pct = (n, d = stats.sampled) => +((100 * n) / Math.max(1, d)).toFixed(1);
  const summary = {
    ...stats,
    pct: {
      inTable: pct(stats.inTable), knownTop: pct(stats.known), overlap: pct(stats.overlap), fitNonPos: pct(stats.fitNonPos), belowMinCover: pct(stats.belowMinCover), eitherGate: pct(stats.eitherGate),
      currentTop1: pct(stats.top1, stats.decisions), currentTop5: pct(stats.top5, stats.decisions),
    },
    seconds: Math.round((performance.now() - t0) / 1000),
  };
  fs.writeFileSync(OUT.replace(/\.jsonl$/, ".summary.json"), JSON.stringify(summary, null, 1));
  console.log(JSON.stringify(summary));
} finally {
  await vite.close();
}
