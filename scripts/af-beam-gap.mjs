// How far is the planner's beam from the best order it could find? (af, ORASP-style check:
// arXiv 2310.17115 merges states and searches them exactly; with the planner's own state
// dedupe, a wide enough beam is that exact search on small scopes.) Runs the planner's public
// API at several beam widths and reports, per model: order vs the booklet (Spearman ρ),
// relaxed constraints, runtime. If ρ doesn't rise with the beam, the weights — not the search —
// are what keeps the order from the designer's.
//
//   node scripts/af-beam-gap.mjs [id ...]   BEAMS=1,4,16,64  OUT=bench/results/af-beam-gap.json

import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";

const ROOT = path.resolve(import.meta.dirname, "..");
const LADDER = ["30190-1", "31009-1-310091", "42021-1-420211", "42064-1", "8258-1", "42043-1-420431", "42055-1"];
const BEAMS = (process.env.BEAMS ?? "1,4,16,64").split(",").map(Number);
const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const load = (m) => vite.ssrLoadModule(m);
const { makeLibrary } = await load("/src/engine/plan/library.ts");
const { flatten } = await load("/src/engine/plan/ldraw.ts");
const { connectionGraph, contactFallback } = await load("/src/engine/plan/graph.ts");
const { blocking, interlocks } = await load("/src/engine/plan/blocking.ts");
const { planAssembly } = await load("/src/engine/plan/planner.ts");
const read = (p) => {
  try {
    return fs.readFileSync(path.join(ROOT, p), "latin1");
  } catch {
    return null;
  }
};
const lib = makeLibrary(read, "public/ldraw", "booklets/shadow");

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
const spearman = (a, b) => {
  const ra = rank(a), rb = rank(b), n = a.length, m = (n - 1) / 2;
  let s = 0, sa = 0, sb = 0;
  for (let i = 0; i < n; i++) (s += (ra[i] - m) * (rb[i] - m)), (sa += (ra[i] - m) ** 2), (sb += (rb[i] - m) ** 2);
  return sa && sb ? s / Math.sqrt(sa * sb) : NaN;
};

const out = [];
for (const id of process.argv.slice(2).length ? process.argv.slice(2) : LADDER) {
  const file = fs.existsSync(id) ? id : path.join(ROOT, "public/corpus", `${id}.mpd`);
  const nodes = flatten(fs.readFileSync(file, "latin1"), lib).nodes;
  const edges0 = connectionGraph(lib, nodes);
  const edges = edges0.concat(contactFallback(lib, nodes, edges0));
  let blk = blocking(lib, nodes, edges);
  const inferred = interlocks(nodes, blk);
  if (inferred.length) edges.push(...inferred), (blk = blocking(lib, nodes, edges));
  const official = nodes.map((n) => n.step);
  const row = { model: id, parts: nodes.length, beams: {} };
  for (const beam of BEAMS) {
    const plan = planAssembly(nodes, edges, blk, { beam });
    const placedAt = new Array(nodes.length).fill(-1);
    let pos = 0;
    for (const s of plan.steps) for (const p of s.unit) if (placedAt[p] === -1) placedAt[p] = pos++;
    row.beams[beam] = { rho: +spearman(placedAt, official).toFixed(3), forced: plan.steps.filter((s) => s.forced).length, ms: Math.round(plan.ms) };
    console.log(`${id.padEnd(18)} ${String(nodes.length).padStart(5)} parts  beam ${String(beam).padStart(3)}  ρ ${row.beams[beam].rho.toFixed(3)}  forced ${row.beams[beam].forced}  ${row.beams[beam].ms} ms`);
  }
  out.push(row);
}
const OUT = process.env.OUT ?? "bench/results/af-beam-gap.json";
fs.writeFileSync(path.join(ROOT, OUT), JSON.stringify(out, null, 1));
await vite.close();
