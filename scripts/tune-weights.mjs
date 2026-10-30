// Phase 1, second approach: the sculptor's weights chosen by what they build
// (docs/engine/phase1.md). Imitating designers decision by decision didn't raise
// PARITY: replay never shows what a choice obliges later. Here each candidate set
// of weights is used to sculpt a tuning set of real designs, and scored with the
// benchmark's own PARITY (src/engine/parity.ts). Coordinate search, seeded.
//
// Leave-one-out (rule 3): the tuning models come from sets outside every bench
// set; the forms and motifs are learned once from the other sets (not the
// tuning sets, not the bench sets, no Technic).
//
//   node scripts/tune-weights.mjs [out.json] ['{"N":12,"ROUNDS":3}']
//   (parity.ts is checked against the bench: each bench row also has `parityTs`.)

import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";

const ROOT = path.resolve(import.meta.dirname, "..");
globalThis.fetch = async (u) => {
  const p = path.join(ROOT, "public", String(u));
  return { ok: fs.existsSync(p), headers: { get: () => "application/json" }, json: async () => JSON.parse(fs.readFileSync(p, "utf8")) };
};
const OUT = process.argv[2] || "data/tuned.json";
// OBJECTIVE: "parityV2" (default, see src/engine/parity.ts) or "parity" (the frozen formula).
const o = { N: 12, ROUNDS: 3, SEED: 20261029, MAX_FORMS: 1500, MOTIFS: 4, MIN_USE: 2, MIN_GAIN: 0.002, ...JSON.parse(process.argv[3] || "{}") };

const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
try {
  const load = (m) => vite.ssrLoadModule(m);
  await (await load("/src/engine/catalog.ts")).loadCatalog();
  const S = await load("/src/engine/shape.ts");
  const { sculpt, learnForms, learnMotifs, gridForms, isStructure } = await load("/src/engine/sculpt.ts");
  const { importLDraw } = await load("/src/engine/ldrawImport.ts");
  const { connections } = await load("/src/engine/connect.ts");
  const { PARTS } = await load("/src/engine/parts.ts");
  const { residualBlobs, makeBlobPart } = await load("/src/engine/madeParts.ts");
  const { parityOf } = await load("/src/engine/parity.ts");
  const shapes = JSON.parse(fs.readFileSync(path.join(ROOT, "public/shapes.json"), "utf8"));
  S.installShapes(shapes);
  const corpus = JSON.parse(fs.readFileSync(path.join(ROOT, "public/corpus/index.json"), "utf8")).models;
  const readModel = (id) => importLDraw(fs.readFileSync(path.join(ROOT, "public/corpus", `${id}.mpd`), "latin1"), id).bricks;
  // Made-to-measure parts for what no part fills, as the bench adds them.
  const withMade = (target, bricks, id) => {
    let made = 0;
    for (const blob of residualBlobs(target, bricks, 64)) {
      const votes = new Map();
      for (const k of blob) votes.set(target.cells.get(k), (votes.get(target.cells.get(k)) ?? 0) + 1);
      bricks.push(makeBlobPart(blob, `made-${id}-${made++}`, [...votes].sort((a, b) => b[1] - a[1])[0][0]).brick);
    }
    return made;
  };

  main: {
    const SETS = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/bench-sets.json"), "utf8"));
    const benchIds = [SETS.core8, ...Object.values(SETS.levels), SETS.technic, SETS.nightly].flat();
    const benchSets = new Set(benchIds.map((id) => corpus.find((m) => m.id === id).set));
    const usable = corpus.filter((m) => m.tier !== "technic" && !benchSets.has(m.set));
    // Tuning models: one per set, 30–400 pieces, a third each Junior / Creator / Advanced, seeded.
    let seed = o.SEED;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed / 2147483648);
    // EXCLUDE: a tuning run's file whose models' sets stay out (a validation set disjoint from it).
    const taken = new Set(o.EXCLUDE ? JSON.parse(fs.readFileSync(path.join(ROOT, o.EXCLUDE), "utf8")).tuning.map((id) => corpus.find((m) => m.id === id).set) : []);
    const excluded = new Set(taken);
    const tune = [];
    // Per level: how many, and the size range (o.MIX overrides; the default covers small to Expert).
    const MIX = o.MIX ?? { junior: [3, 30, 400], creator: [4, 30, 400], advanced: [4, 30, 400] };
    for (const [tier, [count, lo, hi]] of Object.entries(MIX)) {
      const pool = usable.filter((m) => m.tier === tier && m.parts >= lo && m.parts <= hi).sort((a, b) => (a.id < b.id ? -1 : 1));
      let n = 0;
      while (n < count && pool.length) {
        const m = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
        if (taken.has(m.set)) continue;
        taken.add(m.set);
        tune.push(m);
        n++;
      }
    }
    const learnFrom = usable.filter((m) => !taken.has(m.set) || excluded.has(m.set)); // the excluded tuning sets may teach the forms
    const train = learnFrom.map((m) => readModel(m.id));
    const keep = (id) => shapes[id] && isStructure(id) && !PARTS[id].printed && PARTS[id].w <= 8 && PARTS[id].d <= 8 && PARTS[id].h <= 9;
    const learned = learnForms(train, keep).filter((f) => f.use >= o.MIN_USE);
    const parts = [...new Set(learned.map((f) => f.partId))];
    const motifs = o.MOTIFS ? learnMotifs(train, train.map((b) => connections(b)), keep, o.MOTIFS) : [];
    const forms = [...learned, ...parts.flatMap((p) => gridForms(p, 0)), ...motifs];
    const reals = tune.map((m) => readModel(m.id));
    const targets = reals.map((r) => S.voxelize(r));
    console.log(`tuning on ${tune.length}: ${tune.map((m) => `${m.id}(${m.tier},${m.parts})`).join(" ")}; ${forms.length} forms from ${learnFrom.length} models`);

    const evaluate = (params) => {
      const t0 = performance.now();
      const rows = tune.map((m, i) => {
        const r = sculpt(targets[i], { forms, MAX_FORMS: o.MAX_FORMS, ...params });
        const made = withMade(targets[i], r.bricks, m.id);
        return parityOf(reals[i], targets[i], r.bricks, made);
      });
      const mean = (k) => +(rows.reduce((s, r) => s + r[k], 0) / rows.length).toFixed(4);
      return { parity: mean(o.OBJECTIVE ?? "parityV2"), parityV1: mean("parity"), parityV2: mean("parityV2"), iou: mean("iou"), smooth: mean("smooth"), heldVsHuman: mean("heldVsHuman"), piecesXHuman: mean("piecesXHuman"), repeats: mean("repeats"), s: Math.round((performance.now() - t0) / 1000), rows: rows.map((r) => r.parity) };
    };
    // GRID: just evaluate these values of one option against the defaults, no search
    // (e.g. {"MIN_FILL":[0.8,0.85,0.9]}), to choose a rule's value away from the bench.
    if (o.GRID) {
      const base = evaluate({});
      const res = [{ params: {}, ...base }];
      console.log("defaults", JSON.stringify({ parity: base.parity, piecesXHuman: base.piecesXHuman, heldVsHuman: base.heldVsHuman }));
      // GRID: {"KEY": [values]} or a list of option sets [{...}, {...}].
      const sets = Array.isArray(o.GRID) ? o.GRID : Object.entries(o.GRID).flatMap(([k, vals]) => vals.map((v) => ({ [k]: v })));
      for (const params of sets) {
          const r = evaluate(params);
          const wins = r.rows.filter((x, i) => x > base.rows[i] + 0.001).length, losses = r.rows.filter((x, i) => x < base.rows[i] - 0.001).length;
          res.push({ params, ...r, wins, losses });
          console.log(`GRID ${JSON.stringify(params)}`, JSON.stringify({ parity: r.parity, piecesXHuman: r.piecesXHuman, heldVsHuman: r.heldVsHuman, wins, losses, of: r.rows.length }));
        }
      fs.writeFileSync(path.join(ROOT, OUT), JSON.stringify({ grid: o.GRID, tuning: tune.map((m) => m.id), res }, null, 1));
      break main;
    }
    // The constants and how each is varied.
    const start = { AIR: 3, PIECE: 60, HOLD: 2, FLOAT: 300, PRIOR: 3, GAMMA: 0.7, STUD_BAD: 40, REPEAT: 25, MIN_COVER: 16 };
    const steps = (k, v) =>
      k === "GAMMA" ? [-0.2, -0.1, 0.1, 0.2].map((d) => +(v + d).toFixed(2)) : k === "MIN_COVER" ? [-8, -4, 4, 8].map((d) => Math.max(0, v + d)) : [0.5, 0.75, 1.33, 2].map((f) => +(v * f).toPrecision(3));
    let best = { params: { ...start }, ...evaluate(start) };
    const history = [{ params: best.params, ...best }];
    console.log("start", JSON.stringify({ parity: best.parity, piecesXHuman: best.piecesXHuman, s: best.s }));
    for (let round = 0; round < o.ROUNDS; round++) {
      let moved = false;
      for (const k of Object.keys(start)) {
        for (const v of steps(k, best.params[k])) {
          const params = { ...best.params, [k]: v };
          const r = evaluate(params);
          history.push({ params, ...r });
          if (r.parity > best.parity + o.MIN_GAIN) {
            best = { params, ...r };
            moved = true;
            console.log(`round ${round} ${k}=${v}: parity ${r.parity} (pieces×human ${r.piecesXHuman})`);
          }
        }
      }
      if (!moved) break;
    }
    const out = { version: `tuned-${new Date().toISOString().slice(0, 10)}`, tuning: tune.map((m) => m.id), forms: forms.length, options: o, start: history[0], best, evaluations: history.length, history };
    fs.mkdirSync(path.dirname(path.join(ROOT, OUT)), { recursive: true });
    fs.writeFileSync(path.join(ROOT, OUT), JSON.stringify(out, null, 1));
    console.log("best", JSON.stringify({ params: best.params, parity: best.parity, start: history[0].parity, evaluations: history.length }));
  }
} finally {
  await vite.close();
}
