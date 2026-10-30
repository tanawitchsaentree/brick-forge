// Why the planner had to relax: per forced step, the unit, the reason, its open joints and
// what blocks it. For finding what Layer A misreads.   node scripts/plan-forced.mjs id [n]
import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";
const ROOT = path.resolve(import.meta.dirname, "..");
const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const L = (m) => vite.ssrLoadModule(m);
const { makeLibrary } = await L("/src/engine/plan/library.ts");
const { flatten } = await L("/src/engine/plan/ldraw.ts");
const { connectionGraph, contactFallback } = await L("/src/engine/plan/graph.ts");
const { blocking, interlocks } = await L("/src/engine/plan/blocking.ts");
const { planAssembly } = await L("/src/engine/plan/planner.ts");
const read = (p) => { try { return fs.readFileSync(path.join(ROOT, p), "latin1"); } catch { return null; } };
const lib = makeLibrary(read, "public/ldraw", "booklets/shadow");
const [id, n = "15"] = process.argv.slice(2);
const nodes = flatten(fs.readFileSync(path.join(ROOT, "public/corpus", `${id}.mpd`), "latin1"), lib).nodes;
const e0 = connectionGraph(lib, nodes), edges = e0.concat(contactFallback(lib, nodes, e0));
let blk = blocking(lib, nodes, edges);
edges.push(...interlocks(nodes, blk)); blk = blocking(lib, nodes, edges);
const plan = planAssembly(nodes, edges, blk);
const name = (j) => `${nodes[j].id} ${lib.part(nodes[j].id).name.slice(0, 26)}`;
const cat = {};
let shown = 0;
for (const s of plan.steps.filter((s) => s.forced)) {
  const k = s.unit.length === 1 ? `${lib.part(nodes[s.unit[0]].id).name.match(/^(Technic \w+|\w+)/)[1]}: ${s.forced.replace(/\d+/, "n")}` : `sub-assembly: ${s.forced.replace(/\d+/, "n")}`;
  cat[k] = (cat[k] ?? 0) + 1;
  if ((!process.env.ONLY || lib.part(nodes[s.unit[0]].id).name.includes(process.env.ONLY)) && shown++ < +n && s.unit.length === 1) {
    const i = s.unit[0];
    const js = edges.filter((e) => e.a === i || e.b === i).map((e) => `${e.type}/s${e.sense}→${nodes[e.a === i ? e.b : e.a].id}`);
    const present = new Set(plan.steps.slice(0, plan.steps.indexOf(s)).flatMap((t) => t.unit)); // in build order: what's there before it goes on
    const ways = blk.dirs[i].map((d, k) => `[${d.map((v) => Math.round(v * 10) / 10)}]: ${blk.ways(i, k).map((w) => w.filter((j) => present.has(j)).map((j) => nodes[j].id).join("+") || "∅").slice(0, 4).join(" | ")}`);
    console.log(`${name(i)} | ${s.forced} | joints ${js.join(" ")}\n     ${ways.join("\n     ")}`);
  }
}
if (process.env.PART) {
  for (const n of nodes.filter((n) => n.id === process.env.PART)) {
    const i = n.i;
    const at = plan.steps.findIndex((t) => t.unit.includes(i));
    const js = edges.filter((e) => e.a === i || e.b === i).map((e) => `${e.type}/s${e.sense}${e.a === i ? "M" : "F"}[${e.axis.map((v) => Math.round(v * 10) / 10)}]→${nodes[e.a === i ? e.b : e.a].id}`);
    console.log("PART", n.id, "at build step", at, plan.steps[at]?.forced ?? "", "| joints", js.join(" "));
  }
}
console.log(JSON.stringify(Object.entries(cat).sort((a, b) => b[1] - a[1]).slice(0, 15)));
await vite.close();
