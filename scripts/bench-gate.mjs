// The merge gate (docs/engine/phase2.md): a paired comparison over core8 + levels
// (19 models, Technic left out). A change passes if it wins on at least WINS of
// the 19 models (by more than EPS), and no level's mean falls by more than DROP.
// One model collapsing can't flip it, and one level can't be sacrificed for the rest.
//
//   node scripts/bench-gate.mjs <baseline-core8> <baseline-levels> <new-core8> <new-levels> ['{"METRIC":"scoreV2"}']
//   (run names in bench/results/, or paths)

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const [, , b8, bl, n8, nl, optArg = "{}"] = process.argv;
const o = { METRIC: "scoreV2", WINS: 12, DROP: 0.02, EPS: 0.001, ...JSON.parse(optArg) };
const read = (n) => JSON.parse(fs.readFileSync(n.endsWith(".json") ? n : path.join(ROOT, "bench/results", `${n}.json`), "utf8"));
const rows = (a, b) => [...read(a).models, ...read(b).models].filter((m) => m.tier !== "technic");
const base = rows(b8, bl), cand = rows(n8, nl);
const byId = new Map(cand.map((m) => [m.id, m]));

let wins = 0, losses = 0, ties = 0;
const levels = {};
const lines = [];
for (const m of base) {
  const c = byId.get(m.id);
  if (!c) throw new Error(`missing in candidate: ${m.id}`);
  const d = c[o.METRIC] - m[o.METRIC];
  if (d > o.EPS) wins++;
  else if (d < -o.EPS) losses++;
  else ties++;
  const L = (levels[m.tier] ??= { n: 0, base: 0, cand: 0 });
  L.n++, (L.base += m[o.METRIC]), (L.cand += c[o.METRIC]);
  lines.push(`${m.id.padEnd(28)} ${m.tier.padEnd(9)} ${m[o.METRIC].toFixed(3)} → ${c[o.METRIC].toFixed(3)}  ${d > o.EPS ? "win" : d < -o.EPS ? "loss" : "tie"}`);
}
const drops = Object.entries(levels).map(([k, L]) => ({ level: k, n: L.n, base: +(L.base / L.n).toFixed(4), cand: +(L.cand / L.n).toFixed(4), delta: +((L.cand - L.base) / L.n).toFixed(4) }));
const mean = (xs) => +(xs.reduce((s, m) => s + m[o.METRIC], 0) / xs.length).toFixed(4);
const pass = wins >= o.WINS && drops.every((d) => d.delta >= -o.DROP);
console.log(lines.join("\n"));
console.log(drops.map((d) => `${d.level.padEnd(9)} n ${d.n}  ${d.base} → ${d.cand}  (${d.delta >= 0 ? "+" : ""}${d.delta})`).join("\n"));
console.log(`${o.METRIC}: mean ${mean(base)} → ${mean(cand)} | wins ${wins}, losses ${losses}, ties ${ties} of ${base.length} | gate (≥ ${o.WINS} wins, no level −${o.DROP}): ${pass ? "PASS" : "FAIL"}`);
process.exitCode = pass ? 0 : 1;
