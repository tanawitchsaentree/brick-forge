// Best-of-K where the studio builds without donor parts: core8 models scaled up
// (morph.ts scaleUp) and sculpted with the app's tier weights, as sculptWorker
// does (prune, made parts). Each of the 4 VARIANTS is built; pickBest chooses.
// No designer exists at these scales, so no PARITY: per variant the time, the
// selector inputs, and stud smoothness against the scaled target. The judge for
// "better" here is the picture (BENCH_OUT=dir writes each build per variant).
//
//   node scripts/c5-studio-bestofk.mjs [scale=1.5] [tier=expert]   BENCH_RUN=name → bench/results/<name>.json

import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";

const ROOT = path.resolve(import.meta.dirname, "..");
globalThis.fetch = async (u) => {
  const p = path.join(ROOT, "public", String(u));
  return { ok: fs.existsSync(p), headers: { get: () => "application/json" }, json: async () => JSON.parse(fs.readFileSync(p, "utf8")) };
};
const scale = +(process.argv[2] ?? 1.5);
const tier = process.argv[3] ?? "expert";
// The app's tier weights (sculptWorker TIER_WEIGHTS, with MAX_FORMS and S8's NO_FLOAT).
const TIER = { junior: { PIECE: 80, AIR: 2, STUD_BAD: 0 }, creator: { PIECE: 50 }, advanced: {}, expert: { PIECE: 30, STUD_BAD: 8 }, master: { PIECE: 20, STUD_BAD: 10 } };
const base = { MAX_FORMS: 1500, MOTIFS: 4, NO_FLOAT: "onSmooth", ...TIER[tier] };
const OUT = process.env.BENCH_OUT;
const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
try {
  const L = (m) => vite.ssrLoadModule(m);
  await (await L("/src/engine/catalog.ts")).loadCatalog();
  const S = await L("/src/engine/shape.ts");
  const { sculpt, learnForms, learnMotifs, gridForms, keepPart } = await L("/src/engine/sculpt.ts");
  const { scaleUp } = await L("/src/engine/morph.ts");
  const { importLDraw } = await L("/src/engine/ldrawImport.ts");
  const { connections, components } = await L("/src/engine/connect.ts");
  const { parityOf } = await L("/src/engine/parity.ts");
  const { interiorFill } = await L("/src/engine/shell.ts");
  const { prune } = await L("/src/engine/necessity.ts");
  const { makeBlobPart, residualBlobs } = await L("/src/engine/madeParts.ts");
  const { VARIANTS, pickBest } = await L("/src/engine/select/bestOfK.ts");
  const shapes = JSON.parse(fs.readFileSync(path.join(ROOT, "public/shapes.json"), "utf8"));
  S.installShapes(shapes);
  const corpus = JSON.parse(fs.readFileSync(path.join(ROOT, "public/corpus/index.json"), "utf8")).models;
  const SETS = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/bench-sets.json"), "utf8"));
  const read = (id) => importLDraw(fs.readFileSync(path.join(ROOT, "public/corpus", `${id}.mpd`), "latin1"), id).bricks;
  const all = new Map(corpus.filter((m) => m.tier !== "technic").map((m) => [m.id, read(m.id)]));
  const links = new Map([...all].map(([id, b]) => [id, connections(b)]));
  const keep = (id) => keepPart(id, (x) => !!shapes[x]);
  const rows = [];
  for (const id of SETS.core8) {
    const set = corpus.find((m) => m.id === id).set;
    const tr = corpus.filter((m) => m.set !== set && m.tier !== "technic");
    const train = tr.map((m) => all.get(m.id));
    const learned = learnForms(train, keep).filter((f) => f.use >= 2);
    const parts = [...new Set(learned.map((f) => f.partId))];
    const forms = [...learned, ...parts.flatMap((p) => gridForms(p, 0)), ...learnMotifs(train, tr.map((m) => links.get(m.id)), keep, base.MOTIFS)];
    const target = scaleUp(S.voxelize(all.get(id)), scale);
    const cands = VARIANTS.map((v) => {
      const t0 = performance.now();
      const r = sculpt(target, { forms, ...base, ...v.opts, ...(v.shell ? { fixed: interiorFill(target).fixed } : {}) });
      r.bricks = prune(r.bricks, target).kept;
      let made = 0;
      for (const blob of residualBlobs(target, r.bricks, 64)) r.bricks.push(makeBlobPart(blob, `made-${id}-${made++}`, 71).brick);
      const ms = Math.round(performance.now() - t0);
      const comps = components(r.bricks.length, connections(r.bricks));
      const c = {
        v: v.name, ms,
        fit: +S.iou(S.voxelize(r.bricks), target).toFixed(3),
        held: +((comps[0]?.length ?? 0) / Math.max(1, r.bricks.length)).toFixed(3),
        repeats: +(r.bricks.filter((b) => b.why?.repeat).length / Math.max(1, r.bricks.length)).toFixed(3),
        pieces: r.bricks.length + 2 * made,
        smoothV2: parityOf(r.bricks, target, r.bricks, 0).smoothV2,
      };
      if (OUT) { fs.mkdirSync(path.join(OUT, v.name), { recursive: true }); fs.writeFileSync(path.join(OUT, v.name, `out-${id}.json`), JSON.stringify(r.bricks)); }
      return c;
    });
    const row = { id, picked: cands[pickBest(cands)].v, cands };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
  const picked = {};
  for (const r of rows) picked[r.picked] = (picked[r.picked] ?? 0) + 1;
  const msDefault = Math.round(rows.reduce((s, r) => s + r.cands[0].ms, 0) / rows.length);
  const msAll = Math.round(rows.reduce((s, r) => s + r.cands.reduce((a, c) => a + c.ms, 0), 0) / rows.length);
  console.log("PICKED", JSON.stringify(picked), "ms default", msDefault, "ms all 4", msAll);
  if (process.env.BENCH_RUN) fs.writeFileSync(path.join(ROOT, "bench/results", `${process.env.BENCH_RUN}.json`), JSON.stringify({ scale, tier, base, picked, msDefault, msAll, rows }, null, 1));
} finally {
  await vite.close();
}
