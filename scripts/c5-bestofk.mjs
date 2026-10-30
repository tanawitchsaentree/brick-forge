// Best-of-K (Blox-Net, docs/research/papers-2026-10.md §1), measured offline on
// bench runs already in bench/results: each config is one candidate per model.
// The selector may only use what the app knows at build time (the target and our
// build): IoU, our own connectivity, our piece count, repeats. Never the
// designer's build — that would be choosing by the answer.
//
//   node scripts/c5-bestofk.mjs [base=v2-s8b] [pool=all|name,name,...]
//   a name is <run>-core8.json + <run>-levels.json (the 19 gate models) or <run>.json
//
// Prints: base, oracle (pick by true PARITY_v2 — the ceiling), and the
// target-only selector, as means and wins/losses over the 19 gate models.

import fs from "node:fs";
import path from "node:path";

const D = path.resolve(import.meta.dirname, "../bench/results");
const base = process.argv[2] || "v2-s8b";
const poolArg = process.argv[3] || "all";
const one = (f) => JSON.parse(fs.readFileSync(path.join(D, f))).models;
const load = (run) => fs.existsSync(path.join(D, `${run}.json`)) ? one(`${run}.json`) : [...one(`${run}-core8.json`), ...one(`${run}-levels.json`)];
const runs = poolArg === "all"
  ? [...new Set(fs.readdirSync(D).filter((f) => f.endsWith("-core8.json")).map((f) => f.slice(0, -11)))].filter((r) => fs.existsSync(path.join(D, `${r}-levels.json`)))
  : poolArg.split(",");
// Candidates must be real engine outputs from the frozen gate set; skip oracle-fed runs (they read the designer's build).
const cand = new Map();
for (const r of runs) {
  if (/oracle/.test(r)) continue;
  const rows = load(r);
  if (rows.length !== load(base).length || rows.some((x) => x.scoreV2 === undefined)) continue;
  cand.set(r, new Map(rows.map((x) => [x.id, x])));
}
if (!cand.has(base)) throw new Error(`base ${base} not in pool`);
const ids = [...cand.get(base).keys()];

// Target-only score. Economy is relative to the leanest candidate for this target
// (no designer count); ECON is its exponent, the only knob.
const pick = (id, score) => {
  let best = null;
  for (const [r, m] of cand) { const s = score(m.get(id), id); if (!best || s > best.s) best = { r, s, row: m.get(id) }; }
  return best;
};
const minOurs = (id) => Math.min(...[...cand.values()].map((m) => m.get(id).ours + 2 * m.get(id).made));
const proxy = (ECON) => (x, id) => x.iou * x.held * (1 - x.repeats) * (minOurs(id) / (x.ours + 2 * x.made)) ** ECON;

const report = (name, choose) => {
  let sum = 0, w = 0, l = 0;
  const picked = {};
  for (const id of ids) {
    const p = choose(id);
    const b = cand.get(base).get(id).scoreV2;
    sum += p.row.scoreV2;
    if (p.row.scoreV2 > b + 1e-9) w++; else if (p.row.scoreV2 < b - 1e-9) l++;
    picked[p.r] = (picked[p.r] ?? 0) + 1;
  }
  console.log(name.padEnd(18), (sum / ids.length).toFixed(4), `w${w}/l${l}`, JSON.stringify(picked));
};
console.log(`pool K=${cand.size}: ${[...cand.keys()].join(" ")}`);
report("base " + base, (id) => ({ r: base, row: cand.get(base).get(id) }));
report("oracle", (id) => pick(id, (x) => x.scoreV2));
for (const e of [0, 0.25, 0.5, 1]) report(`proxy econ=${e}`, (id) => pick(id, proxy(e)));
