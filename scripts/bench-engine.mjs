// The engine benchmark: rebuild real designs from their shape alone and
// compare with the designer's. The target's whole set is left out of what the
// engine learns from (leave-one-set-out), so it can't copy.
//
//   node scripts/bench-engine.mjs [ids,comma,separated | @set] ['{"PIECE":40,...}']
//   BENCH_RUN=name  also write bench/results/<name>.json (config, git, per model, per level)
//   sets (scripts/bench-sets.json, frozen): @core8 @levels @technic @nightly
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
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { createServer } from "vite";

const ROOT = path.resolve(import.meta.dirname, "..");
globalThis.fetch = async (u) => {
  const p = path.join(ROOT, "public", String(u));
  return { ok: fs.existsSync(p), headers: { get: () => "application/json" }, json: async () => JSON.parse(fs.readFileSync(p, "utf8")) };
};
const DEFAULT = "75870-1,31009-1-310091,4917-1-49171,7219-1,7611-1,6743-1-67431,30190-1,31066-1-shuttle";
const SETS = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/bench-sets.json"), "utf8"));
const flat = (v) => (Array.isArray(v) ? v : Object.values(v).flat());
const arg = process.argv[2] || DEFAULT;
const ids = arg.startsWith("@") ? arg.slice(1).split("+").flatMap((k) => flat(SETS[k])) : arg.split(",");
const RUN = process.env.BENCH_RUN;
// Git state when the code is loaded (edits during a long run don't change what ran).
const git = (c) => { try { return execSync(c, { cwd: ROOT }).toString().trim(); } catch { return null; } };
const GIT = { hash: git("git rev-parse --short HEAD"), dirty: !!git("git status --porcelain -uno -- src scripts") };
// The frozen Phase 0 baseline config (docs/engine/phase0.md): it reproduces the
// documented 0.382. Options given on the command line override it.
const BASELINE = { MAX_FORMS: 1500, MOTIFS: 4 };
const opts = { ...BASELINE, ...JSON.parse(process.argv[3] || "{}") };
const OUT = process.env.BENCH_OUT; // write each build here (for viewing)

const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
try {
  const load = (m) => vite.ssrLoadModule(m);
  await (await load("/src/engine/catalog.ts")).loadCatalog();
  const S = await load("/src/engine/shape.ts");
  const { sculpt, learnForms, learnMotifs, gridForms, isStructure, constantWeights, keepPart } = await load("/src/engine/sculpt.ts");
  // WEIGHTS: "constants" (the hand-tuned score as weights, the regression reference) or a weights file (Phase 1).
  if (opts.WEIGHTS === "constants") opts.WEIGHTS = constantWeights(opts);
  else if (typeof opts.WEIGHTS === "string") opts.WEIGHTS = JSON.parse(fs.readFileSync(path.join(ROOT, opts.WEIGHTS), "utf8"));
  const { importLDraw } = await load("/src/engine/ldrawImport.ts");
  const { connections, components } = await load("/src/engine/connect.ts");
  const { PARTS } = await load("/src/engine/parts.ts");
  const { residualBlobs, makeBlobPart } = await load("/src/engine/madeParts.ts");
  const { sculptArticulated } = await load("/src/engine/articulate.ts");
  const { prune } = await load("/src/engine/necessity.ts");
  const M = await load("/src/engine/benchMetrics.ts");
  const { parityOf } = await load("/src/engine/parity.ts");
  const { interiorFill } = await load("/src/engine/shell.ts");
  const { unitsOf, placeUnits } = await load("/src/engine/featureUnits.ts");
  const { roofFill } = await load("/src/engine/roof.ts");
  const { rolesOf } = await load("/src/engine/roles.ts");
  const ruleTable = opts.FEATURES ? JSON.parse(fs.readFileSync(path.join(ROOT, "data/rules/adjacency.json"), "utf8")) : null;
  const shapes = JSON.parse(fs.readFileSync(path.join(ROOT, "public/shapes.json"), "utf8"));
  S.installShapes(shapes);
  const corpus = JSON.parse(fs.readFileSync(path.join(ROOT, "public/corpus/index.json"), "utf8")).models;
  const models = new Map(corpus.map((m) => [m.id, importLDraw(fs.readFileSync(path.join(ROOT, "public/corpus", `${m.id}.mpd`), "latin1"), m.id).bricks]));
  const links = opts.MOTIFS ? new Map([...models].map(([id, b]) => [id, connections(b)])) : null;
  // Which designs to learn from: every tier but Technic unless asked (FROM: ["creator", …]).
  const learnable = (m) => (opts.FROM ? opts.FROM.includes(m.tier) : m.tier !== "technic");
  // KEEP_LONG: plain plates, bricks and tiles up to 16 long too (sculpt.ts keepPart, Phase 2 step 1).
  const keep = (id) => keepPart(id, (x) => !!shapes[x], { long: !!opts.KEEP_LONG });
  // Units where a stud shows (finish is compared per stud × plate unit).
  const studUnits = (v) => new Set([...v.studs].map((k) => {
    const [x, y, z] = S.unkey(k);
    return S.vkey(Math.floor(x / S.RES), Math.floor(y / S.RES_Y), Math.floor(z / S.RES));
  }));
  const res = [];
  for (const id of ids) {
    const w0 = performance.now();
    const set = corpus.find((m) => m.id === id).set;
    const trainSet = corpus.filter((m) => m.set !== set && learnable(m));
    const train = trainSet.map((m) => models.get(m.id));
    const learned = learnForms(train, keep).filter((f) => f.use >= (opts.MIN_USE ?? 2));
    const parts = [...new Set(learned.map((f) => f.partId))]; // tiles too: a smooth top is a form
    const motifs = links ? learnMotifs(train, trainSet.map((m) => links.get(m.id)), keep, opts.MOTIFS) : [];
    const forms = [...learned, ...parts.flatMap((p) => gridForms(p, 0)), ...motifs];
    // REF_NO_BASEPLATE: a reference, not a gate. The designer's baseplates out of both the target and the
    // comparison (metric v3 candidate): where Junior's ceiling would be without them.
    const real = opts.REF_NO_BASEPLATE ? models.get(id).filter((b) => PARTS[b.partId]?.category !== "Baseplate") : models.get(id);
    const target = S.voxelize(real);
    // SHELL (program v2 S3): the inside filled first with the biggest plain parts, the sculptor on the skin.
    const inside = opts.SHELL ? interiorFill(target) : null;
    // FEATURES (the DNA experiment, docs/engine/dna-rules.md): the designer's feature parts
    // (windows, windscreens, doors, wheels) held where the designer put them, as an oracle DNA;
    // "units" adds the partners the mined rules say come with them (this set left out).
    let featFixed = [];
    if (opts.FEATURES) {
      const feats = real.filter((b) => ["window", "windscreen", "door", "wheel"].some((x) => rolesOf(b.partId).includes(x)));
      featFixed = [...feats];
      if (opts.FEATURES === "units") {
        const taken = new Set();
        for (const b of feats) S.partCells(b, (x, y, z) => taken.add(S.vkey(x, y, z)));
        for (const p of placeUnits(feats, unitsOf(ruleTable, set), (rule) => rule.color ?? 71)) {
          if (!PARTS[p.partId]) continue;
          const cells = [];
          S.partCells(p, (x, y, z) => cells.push(S.vkey(x, y, z)));
          if (cells.some((c) => taken.has(c))) continue; // where a part already is
          cells.forEach((c) => taken.add(c));
          featFixed.push(p);
        }
      }
    }
    // ROOF (the DNA experiment): the roof from its grammar (src/engine/roof.ts), the sculptor below it.
    const roof = opts.ROOF && corpus.find((m) => m.id === id).kind === "house" ? roofFill(target) : null; // houses only
    const fixed = [...(inside ? inside.fixed : []), ...featFixed, ...(roof ? roof.fixed : [])];
    const r = opts.ARTICULATE ? sculptArticulated(target, { forms, ...opts }) : sculpt(target, { forms, ...opts, ...(fixed.length ? { fixed } : {}) });
    if (opts.FEATURES) Object.assign(r.phase ?? (r.phase = {}), { featureParts: featFixed.length });
    if (roof) Object.assign(r.phase ?? (r.phase = {}), { roofParts: roof.fixed.length, roofBands: roof.bands, roofAxis: roof.axis });
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
    console.log(JSON.stringify(row));
    // Phase 0 measurements (src/engine/benchMetrics.ts): kept off the console line above so it reads as before.
    row.tier = corpus.find((m) => m.id === id).tier;
    const pv = parityOf(real, target, r.bricks, made);
    row.parityTs = pv.parity; // must equal row.score (the tuner optimizes parity.ts)
    Object.assign(row, { smoothV2: pv.smoothV2, studRecall: pv.studRecall, scoreV2: pv.parityV2 });
    const mixO = M.mixOf(r.bricks), mixH = M.mixOf(real);
    row.mix = { ours: mixO, human: mixH, diff: M.mixDiff(mixO, mixH) };
    row.structure = { ours: M.structureOf(r.bricks), human: M.structureOf(real) };
    Object.assign(row, M.visibleSmooth(ours, target));
    row.wallMs = Math.round(performance.now() - w0);
    if (r.phase?.merges !== undefined) Object.assign(row, { merges: r.phase.merges, mergeRefused: r.phase.refused });
    if (r.phase?.featureParts !== undefined) row.featureParts = r.phase.featureParts;
    if (r.phase?.roofParts !== undefined) Object.assign(row, { roofParts: r.phase.roofParts, roofBands: r.phase.roofBands, roofAxis: r.phase.roofAxis });
    // The build itself, hashed: a refactor that should change nothing must give the same hash (phase regression tests).
    const canon = r.bricks.map((b) => [b.partId, b.color, b.rot, b.x, b.y, b.z, b.place ? b.place.map((v) => +v.toFixed(4)) : null]);
    row.outHash = crypto.createHash("sha1").update(JSON.stringify(canon)).digest("hex").slice(0, 16);
    res.push(row);
    if (OUT) {
      fs.writeFileSync(path.join(OUT, `out-${id}.json`), JSON.stringify(r.bricks));
      // The made-to-measure parts' definitions, so a picture can draw them (scripts/render-compare.mjs).
      const madeDefs = [...new Set(r.bricks.map((b) => b.partId))].filter((p) => /^made-/.test(p)).map((p) => PARTS[p]);
      fs.writeFileSync(path.join(OUT, `out-${id}.made.json`), JSON.stringify(madeDefs));
    }
  }
  const avg = (k) => +(res.reduce((s, r) => s + r[k], 0) / res.length).toFixed(3);
  if (RUN) {
    const levels = {};
    for (const r of res) (levels[r.tier] ??= []).push(r);
    const agg = (rows) => {
      const m = (f) => +(rows.reduce((s, r) => s + f(r), 0) / rows.length).toFixed(4);
      return {
        n: rows.length,
        parity: m((r) => r.score), parityV2: m((r) => r.scoreV2), smoothV2: m((r) => r.smoothV2), studRecall: m((r) => r.studRecall), iou: m((r) => r.iou), smooth: m((r) => r.smooth), heldVsHuman: m((r) => r.heldVsHuman),
        repeats: m((r) => r.repeats), piecesXHuman: m((r) => r.ours / r.human), copy: m((r) => r.copy),
        vsmooth: m((r) => r.vsmooth), mixL1: m((r) => r.mix.diff.l1), oneDiff: m((r) => r.mix.diff.one),
        overLimit: m((r) => r.structure.ours.overLimit), unconnected: m((r) => r.structure.ours.unconnected),
        worstJoint: +Math.max(...rows.map((r) => r.structure.ours.worst)).toFixed(3), msMean: m((r) => r.ms),
      };
    };
    const out = {
      run: RUN, date: new Date().toISOString(), git: GIT.hash, dirty: GIT.dirty,
      arg, ids, idsHash: crypto.createHash("sha1").update(ids.join(",")).digest("hex").slice(0, 12), opts, node: process.version,
      all: agg(res.filter((r) => r.tier !== "technic")), byLevel: Object.fromEntries(Object.entries(levels).map(([k, v]) => [k, agg(v)])), models: res,
    };
    fs.mkdirSync(path.join(ROOT, "bench/results"), { recursive: true });
    fs.writeFileSync(path.join(ROOT, "bench/results", `${RUN}.json`), JSON.stringify(out, null, 1));
    console.log(`wrote bench/results/${RUN}.json`);
  }
  console.log(`PARITY_v2 ${(res.filter((r) => r.tier !== "technic").reduce((s, r) => s + r.scoreV2, 0) / Math.max(1, res.filter((r) => r.tier !== "technic").length)).toFixed(3)} (smooth_v2, see src/engine/parity.ts)`);
  console.log(`MEAN iou ${avg("iou")} smooth ${avg("smooth")} held÷human ${avg("heldVsHuman")} repeats ${avg("repeats")} pieces×human ${(res.reduce((s, r) => s + r.ours / r.human, 0) / res.length).toFixed(2)} | copy ${avg("copy")} | PARITY ${avg("score")}`);
} finally {
  await vite.close();
}
