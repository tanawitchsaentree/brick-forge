// The engine benchmark: rebuild real designs from their shape alone and
// compare with the designer's. The target's whole set is left out of what the
// engine learns from (leave-one-set-out), so it can't copy.
//
//   node scripts/bench-engine.mjs [ids,comma,separated] ['{"PIECE":40,...}']
//
//   PARITY = mean( IoU · smooth · held÷designer's · min(1, human pieces / ours)^½ · (1 − repeats) )
//   copy   = mean( IoU · (½ + ½·finish) · held · min(1, human pieces / ours)^½ · (1 − repeats) )
//
// Parity asks "as good as the designer?": smooth = share of our visible studs
// where the designer also shows studs (a smooth surface is never wrong). Copy
// asks "identical to the designer's build?" (finish = same stud positions).
// The designer scores 1.0 on both. Made-to-measure parts count as 3 pieces.
// See docs/engine.md for the log of what each change did.

import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";

const ROOT = path.resolve(import.meta.dirname, "..");
globalThis.fetch = async (u) => {
  const p = path.join(ROOT, "public", String(u));
  return { ok: fs.existsSync(p), headers: { get: () => "application/json" }, json: async () => JSON.parse(fs.readFileSync(p, "utf8")) };
};
const DEFAULT = "75870-1,31009-1-310091,4917-1-49171,7219-1,7611-1,6743-1-67431,30190-1,31066-1-shuttle";
const ids = (process.argv[2] || DEFAULT).split(",");
const opts = JSON.parse(process.argv[3] || "{}");
const OUT = process.env.BENCH_OUT; // write each build here (for viewing)

const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
try {
  const load = (m) => vite.ssrLoadModule(m);
  await (await load("/src/engine/catalog.ts")).loadCatalog();
  const S = await load("/src/engine/shape.ts");
  const { sculpt, learnForms, learnMotifs, gridForms, isStructure } = await load("/src/engine/sculpt.ts");
  const { importLDraw } = await load("/src/engine/ldrawImport.ts");
  const { connections, components } = await load("/src/engine/connect.ts");
  const { PARTS } = await load("/src/engine/parts.ts");
  const { residualBlobs, makeBlobPart } = await load("/src/engine/madeParts.ts");
  const { sculptArticulated } = await load("/src/engine/articulate.ts");
  const { prune } = await load("/src/engine/necessity.ts");
  const shapes = JSON.parse(fs.readFileSync(path.join(ROOT, "public/shapes.json"), "utf8"));
  S.installShapes(shapes);
  const corpus = JSON.parse(fs.readFileSync(path.join(ROOT, "public/corpus/index.json"), "utf8")).models;
  const models = new Map(corpus.map((m) => [m.id, importLDraw(fs.readFileSync(path.join(ROOT, "public/corpus", `${m.id}.mpd`), "latin1"), m.id).bricks]));
  const links = opts.MOTIFS ? new Map([...models].map(([id, b]) => [id, connections(b)])) : null;
  // Which designs to learn from: every tier but Technic unless asked (FROM: ["creator", …]).
  const learnable = (m) => (opts.FROM ? opts.FROM.includes(m.tier) : m.tier !== "technic");
  const keep = (id) => shapes[id] && isStructure(id) && !PARTS[id].printed && PARTS[id].w <= 8 && PARTS[id].d <= 8 && PARTS[id].h <= 9;
  // Units where a stud shows (finish is compared per stud × plate unit).
  const studUnits = (v) => new Set([...v.studs].map((k) => {
    const [x, y, z] = S.unkey(k);
    return S.vkey(Math.floor(x / S.RES), Math.floor(y / S.RES_Y), Math.floor(z / S.RES));
  }));
  const res = [];
  for (const id of ids) {
    const set = corpus.find((m) => m.id === id).set;
    const trainSet = corpus.filter((m) => m.set !== set && learnable(m));
    const train = trainSet.map((m) => models.get(m.id));
    const learned = learnForms(train, keep).filter((f) => f.use >= (opts.MIN_USE ?? 2));
    const parts = [...new Set(learned.map((f) => f.partId))]; // tiles too: a smooth top is a form
    const motifs = links ? learnMotifs(train, trainSet.map((m) => links.get(m.id)), keep, opts.MOTIFS) : [];
    const forms = [...learned, ...parts.flatMap((p) => gridForms(p, 0)), ...motifs];
    const real = models.get(id);
    const target = S.voxelize(real);
    const r = opts.ARTICULATE ? sculptArticulated(target, { forms, ...opts }) : sculpt(target, { forms, ...opts });
    let pruned = 0;
    if (opts.PRUNE) {
      const n = prune(r.bricks, target);
      pruned = n.removed.length;
      r.bricks = n.kept;
    }
    let made = 0;
    for (const blob of residualBlobs(target, r.bricks, opts.MADE ?? 64)) {
      const votes = new Map();
      for (const k of blob) votes.set(target.cells.get(k), (votes.get(target.cells.get(k)) ?? 0) + 1);
      r.bricks.push(makeBlobPart(blob, `made-${id}-${made++}`, [...votes].sort((a, b) => b[1] - a[1])[0][0]).brick);
    }
    const ours = S.voxelize(r.bricks);
    const comps = components(r.bricks.length, connections(r.bricks));
    const [a, b] = [studUnits(ours), studUnits(target)];
    let both = 0;
    for (const k of a) if (b.has(k)) both++;
    // Parity: as good as the designer, not identical. Our showing studs count as
    // right where the designer also shows studs (within a unit, same height);
    // smooth is never wrong. Held is against the designer's own build.
    let onStuds = 0;
    for (const k of a) {
      const [x, y, z] = S.unkey(k);
      let near = false;
      for (let dx = -1; dx <= 1 && !near; dx++) for (let dz = -1; dz <= 1 && !near; dz++) near = b.has(S.vkey(x + dx, y, z + dz));
      if (near) onStuds++;
    }
    const humanComps = components(real.length, connections(real));
    const humanHeld = (humanComps[0]?.length ?? 0) / Math.max(1, real.length);
    const row = {
      id,
      human: real.length,
      ours: r.bricks.length,
      iou: +S.iou(ours, target).toFixed(3),
      finish: +(both / Math.max(1, a.size + b.size - both)).toFixed(3),
      held: +((comps[0]?.length ?? 0) / Math.max(1, r.bricks.length)).toFixed(3),
      repeats: +(r.bricks.filter((x) => x.why?.repeat).length / Math.max(1, r.bricks.length)).toFixed(3),
      made,
      pruned,
      segments: r.segments ? `${r.segments.filter((x) => x.frame).length}/${r.segments.length}` : undefined,
      joints: r.joints,
      forms: forms.length,
      ms: Math.round(r.ms),
    };
    row.smooth = +(a.size ? onStuds / a.size : 1).toFixed(3);
    row.heldVsHuman = +Math.min(1, row.held / Math.max(0.01, humanHeld)).toFixed(3);
    const economy = Math.min(1, row.human / (row.ours + 2 * made)) ** 0.5;
    // Copy score: identical to the designer = 1. Parity score: as good as the designer = 1.
    row.copy = +(row.iou * (0.5 + 0.5 * row.finish) * row.held * economy * (1 - row.repeats)).toFixed(3);
    row.score = +(row.iou * row.smooth * row.heldVsHuman * economy * (1 - row.repeats)).toFixed(3);
    res.push(row);
    console.log(JSON.stringify(row));
    if (OUT) fs.writeFileSync(path.join(OUT, `out-${id}.json`), JSON.stringify(r.bricks));
  }
  const avg = (k) => +(res.reduce((s, r) => s + r[k], 0) / res.length).toFixed(3);
  console.log(`MEAN iou ${avg("iou")} smooth ${avg("smooth")} held÷human ${avg("heldVsHuman")} repeats ${avg("repeats")} pieces×human ${(res.reduce((s, r) => s + r.ours / r.human, 0) / res.length).toFixed(2)} | copy ${avg("copy")} | PARITY ${avg("score")}`);
} finally {
  await vite.close();
}
