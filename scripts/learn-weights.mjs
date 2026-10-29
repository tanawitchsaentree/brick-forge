// Phase 1: learn the sculptor's scoring weights from designer decisions
// (docs/engine/phase1.md). Input: decisions written by scripts/extract-decisions.mjs,
// one JSON line per decision:
//
//   { set, id, feats: number[][], cover: number[] }    candidate 0 = the designer's form
//
// Model, for a candidate with feature vector f and cover c (cells it fills):
//   rank = (w · f) / c^γ          the same shape as the sculptor's rank
// Loss: multinomial logistic over each decision's candidate set, L2 on w.
// γ isn't linear, so it's chosen by grid search on validation top-1.
// Split by set (80 / 20, seeded), never by placement.
//
//   node scripts/learn-weights.mjs <decisions.jsonl> [out.json] ['{"knownOnly":true}']
//
// knownOnly: only decisions whose designer form is among the forms the sculptor
// tries. A form outside them can't be chosen at decode time, and as a positive it
// has logUse = 0, so it would teach the model to prefer forms nobody uses.

import fs from "node:fs";
import crypto from "node:crypto";

const [, , input, out = "data/weights.json", optArg = "{}"] = process.argv;
const OPT = JSON.parse(optArg);
const lines = fs.readFileSync(input, "utf8").split("\n").filter(Boolean);
const meta = JSON.parse(lines[0]); // first line: { names, extracted: {...} }
const all = lines.slice(1).map((l) => JSON.parse(l));
const data = OPT.knownOnly ? all.filter((d) => d.known) : all;
const names = meta.names;
const D = names.length;

// Split by set, seeded.
let seed = 20261029;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed / 2147483648);
const sets = [...new Set(data.map((d) => d.set))].sort();
for (let i = sets.length - 1; i > 0; i--) {
  const j = Math.floor(rnd() * (i + 1));
  [sets[i], sets[j]] = [sets[j], sets[i]];
}
const valSets = new Set(sets.slice(0, Math.round(sets.length * 0.2)));
const train = data.filter((d) => !valSets.has(d.set)), val = data.filter((d) => valSets.has(d.set));

// Features are scaled to unit variance on the training set (weights are reported back in raw units).
const scale = new Array(D).fill(0);
{
  const sum = new Array(D).fill(0), sq = new Array(D).fill(0);
  let n = 0;
  for (const d of train) for (const f of d.feats) { n++; f.forEach((v, i) => ((sum[i] += v), (sq[i] += v * v))); }
  for (let i = 0; i < D; i++) scale[i] = Math.sqrt(Math.max(1e-9, sq[i] / n - (sum[i] / n) ** 2)) || 1;
}

// The hand-tuned score as weights (sculpt.ts constantWeights), in scaled units: the start point and the reference.
const CONST = { cover: 1, air: -3, studOk: 0, studBad: -40, pieces: -60, engaged: 2, float: -300, logUse: 3, repeat: -25 };
const constScaled = names.map((n, i) => (CONST[n] ?? 0) * scale[i]);

function fit(gamma, epochs = 300, lr = 0.05, l2 = 1e-3) {
  // Warm start from the constants: deterministic, and the loss starts where the old score is.
  const w = constScaled.slice();
  const m = new Array(D).fill(0), v = new Array(D).fill(0); // Adam
  let t = 0;
  const prep = (d) => d.feats.map((f, k) => f.map((x, i) => x / scale[i] / d.cover[k] ** gamma));
  const T = train.map((d) => Object.assign(prep(d), { pos: d.pos ?? 1 }));
  for (let e = 0; e < epochs; e++) {
    const g = new Array(D).fill(0);
    for (const X of T) {
      const s = X.map((x) => x.reduce((a, xi, i) => a + xi * w[i], 0));
      const mx = Math.max(...s);
      const p = s.map((z) => Math.exp(z - mx));
      const Z = p.reduce((a, b) => a + b, 0);
      // Several right answers (layer scope): the target is the softmax mass on them.
      const P = X.pos ?? 1;
      let Zp = 0;
      for (let k = 0; k < P; k++) Zp += p[k];
      X.forEach((x, k) => {
        const coef = p[k] / Z - (k < P ? p[k] / Zp : 0);
        for (let i = 0; i < D; i++) g[i] += coef * x[i];
      });
    }
    t++;
    for (let i = 0; i < D; i++) {
      const gi = g[i] / T.length + l2 * w[i];
      m[i] = 0.9 * m[i] + 0.1 * gi;
      v[i] = 0.999 * v[i] + 0.001 * gi * gi;
      w[i] -= (lr * (m[i] / (1 - 0.9 ** t))) / (Math.sqrt(v[i] / (1 - 0.999 ** t)) + 1e-8);
    }
  }
  return w;
}

/** Share of decisions where the designer's form ranks first / in the top 5. */
function agreement(w, gamma, rows) {
  let top1 = 0, top5 = 0;
  for (const d of rows) {
    const s = d.feats.map((f, k) => f.reduce((a, x, i) => a + (x / scale[i]) * w[i], 0) / d.cover[k] ** gamma);
    const P = d.pos ?? 1;
    const bestPos = Math.max(...s.slice(0, P));
    const better = s.filter((z, k) => k >= P && z >= bestPos).length; // ties count against the designer (as the extractor counts)
    if (better === 0) top1++;
    if (better < 5) top5++;
  }
  return { top1: +(top1 / rows.length).toFixed(4), top5: +(top5 / rows.length).toFixed(4) };
}

const grid = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2];
const tried = grid.map((g) => {
  const w = fit(g);
  return { gamma: g, w, train: agreement(w, g, train), val: agreement(w, g, val) };
});
const best = tried.reduce((a, b) => (b.val.top1 > a.val.top1 ? b : a));
// The reference: the constants (γ 0.7) on the same decisions, with the same tie rule.
const reference = { train: agreement(constScaled, 0.7, train), val: agreement(constScaled, 0.7, val) };
const raw = Object.fromEntries(names.map((n, i) => [n, +(best.w[i] / scale[i]).toPrecision(6)]));
const hash = crypto.createHash("sha1").update([...sets].filter((s) => !valSets.has(s)).join(",")).digest("hex").slice(0, 12);
const result = {
  version: `phase1-${new Date().toISOString().slice(0, 10)}${OPT.knownOnly ? "-known" : ""}`,
  options: OPT,
  trainSetHash: hash,
  extracted: meta.extracted,
  gamma: best.gamma,
  gates: false, // the old gates are features here (belowMinCover, fitNonPos)
  weights: raw,
  decisions: { train: train.length, val: val.length, sets: { train: sets.length - valSets.size, val: valSets.size } },
  agreement: { train: best.train, val: best.val },
  constants: reference,
  grid: tried.map(({ gamma, train, val }) => ({ gamma, train, val })),
};
fs.mkdirSync(out.split("/").slice(0, -1).join("/") || ".", { recursive: true });
fs.writeFileSync(out, JSON.stringify(result, null, 1));
console.log(JSON.stringify({ gamma: best.gamma, val: best.val, train: best.train, constants: reference, grid: result.grid }));
