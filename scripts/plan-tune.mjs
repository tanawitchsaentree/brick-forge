// Layer E: learn the planner's ordering weights from designers' steps. Corpus models with
// STEP lines, split into a training and a held-out set by name hash; coordinate ascent on
// the weights maximising the mean Spearman ρ between the planned order and the booklet's
// on the training set, reported on both.
//
//   node scripts/plan-tune.mjs [rounds=2]   → data/plan-weights.json

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createServer } from "vite";

const ROOT = path.resolve(import.meta.dirname, "..");
const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const load = (m) => vite.ssrLoadModule(m);
const { makeLibrary } = await load("/src/engine/plan/library.ts");
const { flatten } = await load("/src/engine/plan/ldraw.ts");
const { connectionGraph, contactFallback } = await load("/src/engine/plan/graph.ts");
const { blocking, interlocks } = await load("/src/engine/plan/blocking.ts");
const { planAssembly, DEFAULT_WEIGHTS } = await load("/src/engine/plan/planner.ts");
const read = (p) => {
  try {
    return fs.readFileSync(path.join(ROOT, p), "latin1");
  } catch {
    return null;
  }
};
const lib = makeLibrary(read, "public/ldraw", process.env.CONNECTORS === "shadow" ? "booklets/shadow" : null);
const spearman = (a, b) => {
  const rank = (v) => {
    const o = v.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]);
    const r = new Array(v.length);
    for (let i = 0; i < o.length; ) {
      let j = i;
      while (j + 1 < o.length && o[j + 1][0] === o[i][0]) j++;
      for (let k = i; k <= j; k++) r[o[k][1]] = (i + j) / 2;
      i = j + 1;
    }
    return r;
  };
  const ra = rank(a), rb = rank(b), n = a.length, m = (n - 1) / 2;
  let s = 0, sa = 0, sb = 0;
  for (let i = 0; i < n; i++) (s += (ra[i] - m) * (rb[i] - m)), (sa += (ra[i] - m) ** 2), (sb += (rb[i] - m) ** 2);
  return sa && sb ? s / Math.sqrt(sa * sb) : NaN;
};

// Models with designer steps, 60–400 parts (fast enough to plan many times).
const files = fs.readdirSync(path.join(ROOT, "public/corpus")).filter((f) => f.endsWith(".mpd")).sort();
const pool = [];
for (const f of files) {
  const text = fs.readFileSync(path.join(ROOT, "public/corpus", f), "latin1");
  const steps = (text.match(/^\s*0\s+STEP/gim) ?? []).length;
  const n = (text.match(/^1 /gm) ?? []).length;
  if (steps < 8 || n < 60 || n > 400) continue;
  pool.push({ f, text });
}
const hash = (s) => parseInt(crypto.createHash("md5").update(s).digest("hex").slice(0, 8), 16);
const picked = pool.filter((m) => hash(m.f) % 7 === 0).slice(0, 24);
const train = picked.filter((m) => hash(m.f + "split") % 3 !== 0), test = picked.filter((m) => hash(m.f + "split") % 3 === 0);
console.log(`pool ${pool.length}, train ${train.length}, held out ${test.length}`);
const prep = (m) => {
  const nodes = flatten(m.text, lib).nodes;
  const e0 = connectionGraph(lib, nodes);
  const edges = e0.concat(contactFallback(lib, nodes, e0));
  let blk = blocking(lib, nodes, edges);
  const inf = interlocks(nodes, blk);
  if (inf.length) edges.push(...inf), (blk = blocking(lib, nodes, edges));
  return { name: m.f, nodes, edges, blk };
};
const T = train.map(prep), H = test.map(prep);
const rhoOf = (set, W) =>
  set.map(({ nodes, edges, blk }) => {
    const plan = planAssembly(nodes, edges, blk, { weights: W, beam: 2 });
    const at = new Array(nodes.length).fill(-1);
    let k = 0;
    for (const s of plan.steps) for (const p of s.unit) if (at[p] < 0) at[p] = k++;
    return spearman(at, nodes.map((n) => n.step));
  });
const mean = (v) => v.filter(Number.isFinite).reduce((s, x) => s + x, 0) / Math.max(1, v.filter(Number.isFinite).length);
let W = { ...DEFAULT_WEIGHTS, split: 2 };
if (process.env.VARIANTS) {
  // Fixed variants, reported on both sets (no fitting).
  for (const v of JSON.parse(process.env.VARIANTS)) {
    const Wv = { ...W, ...v };
    console.log(JSON.stringify(v), "train ρ", mean(rhoOf(T, Wv)).toFixed(3), "held-out ρ", mean(rhoOf(H, Wv)).toFixed(3));
  }
  await vite.close();
  process.exit(0);
}
let best = mean(rhoOf(T, W));
console.log("start", JSON.stringify(W), "train ρ", best.toFixed(3), "held-out ρ", mean(rhoOf(H, W)).toFixed(3));
const rounds = +(process.argv[2] ?? 2);
for (let r = 0; r < rounds; r++)
  for (const key of ["height", "outward", "sameDir", "near", "leaf", "split"])
    for (const f of [0, 0.5, 2, -1]) {
      const cand = { ...W, [key]: f === 0 ? 0 : f === -1 ? -Math.abs(W[key] || 0.5) : (W[key] || 0.5) * f };
      const v = mean(rhoOf(T, cand));
      if (v > best + 1e-4) {
        best = v;
        W = cand;
        console.log(`  ${key} → ${cand[key].toFixed(3)}  train ρ ${v.toFixed(3)}`);
      }
    }
const held = rhoOf(H, W);
console.log("learned", JSON.stringify(W), "train ρ", best.toFixed(3), "held-out ρ", mean(held).toFixed(3), "per model", held.map((v) => v.toFixed(2)).join(" "));
fs.writeFileSync(path.join(ROOT, "data/plan-weights.json"), JSON.stringify({ weights: W, train: train.map((m) => m.f), heldOut: test.map((m) => m.f), trainRho: best, heldOutRho: mean(held) }, null, 1));
await vite.close();
