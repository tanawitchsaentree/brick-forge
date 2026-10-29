// The studio's Master builds, measured (program v2 S3, docs/engine/track-s.md).
// The reconstruction bench uses designers' own builds as targets, and those are
// shells already (1.2 % of units inside). The studio's Master targets are scaled
// up and smoothed (morph.ts scaleUp, ×2.5), and 24–40 % of their units are
// inside. Here: core8 models as the studio makes them, sculpted with the app's
// Master weights, with and without SHELL. No designer exists at that scale, so
// no PARITY: sculpt time, pieces, unconnected parts, held, IoU and stud
// smoothness against the scaled target.
//
//   node scripts/bench-studio-master.mjs ['{"SHELL":true}']   BENCH_RUN=name writes bench/results/<name>.json

import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";

const ROOT = path.resolve(import.meta.dirname, "..");
globalThis.fetch = async (u) => {
  const p = path.join(ROOT, "public", String(u));
  return { ok: fs.existsSync(p), headers: { get: () => "application/json" }, json: async () => JSON.parse(fs.readFileSync(p, "utf8")) };
};
const opts = { MAX_FORMS: 1500, MOTIFS: 4, PIECE: 20, STUD_BAD: 10, ...JSON.parse(process.argv[2] || "{}") }; // the app's Master weights (sculptWorker TIER_WEIGHTS)
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
    const forms = [...learned, ...parts.flatMap((p) => gridForms(p, 0)), ...learnMotifs(train, tr.map((m) => links.get(m.id)), keep, opts.MOTIFS)];
    const target = scaleUp(S.voxelize(all.get(id)), 2.5);
    const t0 = performance.now();
    const inside = opts.SHELL ? interiorFill(target) : null;
    const r = sculpt(target, { forms, ...opts, ...(inside ? { fixed: inside.fixed } : {}) });
    const ms = Math.round(performance.now() - t0);
    const ours = S.voxelize(r.bricks);
    const comps = components(r.bricks.length, connections(r.bricks));
    const deg = new Array(r.bricks.length).fill(0);
    for (const l of connections(r.bricks)) (deg[l.a]++, deg[l.b]++);
    // Stud smoothness against the scaled target: parity.ts with the target as "designer" (only its smooth terms are meaningful here).
    const p = parityOf(r.bricks, target, r.bricks, 0);
    const row = { id, ms, pieces: r.bricks.length, inside: inside ? inside.fixed.length : 0, unconnected: deg.filter((d) => d === 0).length, held: +((comps[0]?.length ?? 0) / r.bricks.length).toFixed(3), iou: +S.iou(ours, target).toFixed(3), smoothV2: p.smoothV2 };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
  const m = (k) => +(rows.reduce((s, r) => s + r[k], 0) / rows.length).toFixed(3);
  const out = { opts, mean: { ms: m("ms"), pieces: m("pieces"), unconnected: m("unconnected"), held: m("held"), iou: m("iou"), smoothV2: m("smoothV2") }, rows };
  console.log("MEAN", JSON.stringify(out.mean));
  if (process.env.BENCH_RUN) fs.writeFileSync(path.join(ROOT, "bench/results", `${process.env.BENCH_RUN}.json`), JSON.stringify(out, null, 1));
} finally {
  await vite.close();
}
