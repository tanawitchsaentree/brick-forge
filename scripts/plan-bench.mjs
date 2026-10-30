// Assembly-planning bench (docs/engine/assembly-planning.md): unit tests, then a ladder of
// models — each flattened, connected (typed graph), blocked (directions), planned by
// disassembly and checked. Metrics per model:
//   plan validity (no constraint relaxed), collision-free rate, connectivity, reorientations,
//   stability of partial builds (sampled), order vs the designer's (Spearman), the official
//   order's feasibility under our checks (false alarms), runtime, memory.
//
//   node scripts/plan-bench.mjs [--tests] [id|path.ldr|path.mpd ...]   (defaults: the ladder)
//   BEAM=4 HIER=1 STAB=20 (partial builds checked) OUT=bench/results/plan-<name>.json

import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";

const ROOT = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const LADDER = ["30190-1", "31009-1-310091", "42021-1-420211", "42064-1", "8258-1", "42043-1-420431", "42055-1"];
const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const load = (m) => vite.ssrLoadModule(m);
const { makeLibrary } = await load("/src/engine/plan/library.ts");
const { flatten } = await load("/src/engine/plan/ldraw.ts");
const { connectionGraph, contactFallback } = await load("/src/engine/plan/graph.ts");
const { blocking, interlocks } = await load("/src/engine/plan/blocking.ts");
const { planAssembly } = await load("/src/engine/plan/planner.ts");
const { checkStability } = await load("/src/engine/plan/stability.ts");
const read = (p) => {
  try {
    return fs.readFileSync(path.join(ROOT, p), "latin1");
  } catch {
    return null;
  }
};
const lib = makeLibrary(read, "public/ldraw", "booklets/shadow");

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

function analyse(name, text, opts = {}) {
  const heap0 = process.memoryUsage().heapUsed;
  let t = performance.now();
  const flat = flatten(text, lib);
  const nodes = flat.nodes;
  const tFlat = performance.now() - t;
  t = performance.now();
  const edges0 = connectionGraph(lib, nodes);
  const edges = edges0.concat(contactFallback(lib, nodes, edges0));
  const tGraph = performance.now() - t;
  t = performance.now();
  let blk = blocking(lib, nodes, edges);
  // Joints the connectors missed (mutually blocked every way): added, counted, blocking redone.
  const inferred = process.env.INTERLOCK === "0" ? [] : interlocks(nodes, blk);
  if (inferred.length) edges.push(...inferred), (blk = blocking(lib, nodes, edges));
  const tBlock = performance.now() - t;
  const plan = planAssembly(nodes, edges, blk, { beam: +(process.env.BEAM ?? 4), hierarchy: process.env.HIER !== "0", clusters: process.env.CLUSTER !== "0" });
  const types = {};
  for (const e of edges) types[e.type] = (types[e.type] ?? 0) + 1;
  // Assembly order per part.
  const order = new Array(nodes.length).fill(-1);
  plan.steps.forEach((s, k) => s.unit.forEach((p) => order[p] === -1 && (order[p] = k)));
  // Each step's own new parts: the unit minus parts already placed (sub-assemblies list theirs again).
  const placedAt = new Array(nodes.length).fill(-1);
  let pos = 0;
  for (const s of plan.steps) for (const p of s.unit) if (placedAt[p] === -1) placedAt[p] = pos++;
  const official = nodes.map((n) => n.step);
  const fileOrder = nodes.map((n) => n.i);
  // Reorientations: insertion direction changes between consecutive steps of one scope.
  let reorient = 0;
  const lastDir = new Map();
  for (const s of plan.steps) {
    const l = lastDir.get(s.scope);
    if (l && l[0] * s.dir[0] + l[1] * s.dir[1] + l[2] * s.dir[2] < 0.999) reorient++;
    lastDir.set(s.scope, s.dir);
  }
  const forced = plan.steps.filter((s) => s.forced).length;
  // Stability of the main build after sampled top-level steps (sub-assemblies count once attached).
  const top = plan.steps.map((s, k) => [s, k]).filter(([s]) => s.scope === "");
  const attach = new Array(nodes.length).fill(Infinity);
  top.forEach(([s], q) => s.unit.forEach((p) => (attach[p] = Math.min(attach[p], q))));
  const samples = Math.min(top.length, +(process.env.STAB ?? 20));
  let unstable = 0, minMargin = Infinity, stabMs = 0;
  const unstableAt = [];
  for (let k = 1; k <= samples; k++) {
    const q = Math.round((k * top.length) / samples) - 1;
    const present = nodes.filter((n) => attach[n.i] <= q);
    if (!present.length) continue;
    const set = new Set(present.map((n) => n.i));
    const es = edges.filter((e) => set.has(e.a) && set.has(e.b));
    const t1 = performance.now();
    const r = checkStability(lib, present, es);
    stabMs += performance.now() - t1;
    if (!r.stable) unstable++, unstableAt.push(`${q}:${present[r.worst].id}`);
    minMargin = Math.min(minMargin, 1 - Math.max(0, ...r.utilization));
  }
  // The official order under the same checks (flat): how often would we call a real step impossible?
  const offSeq = [...nodes].sort((a, b) => a.step - b.step || a.i - b.i).map((n) => n.i);
  const present = new Uint8Array(nodes.length).fill(1);
  const byPart = nodes.map(() => []);
  for (const e of edges) if (e.type !== "gear") byPart[e.a].push(e), byPart[e.b].push(e);
  let offFail = 0, offBlocked = 0, offNoDir = 0, offTogether = 0;
  // A booklet step adds its parts in any order: take off whichever of the step's parts are free,
  // again and again; what never comes free is a false alarm of ours (or a joint we read wrong).
  const free = (i) => {
    let any = false;
    for (let k = 0; k < blk.dirs[i].length; k++) {
      const d = blk.dirs[i][k];
      if (!byPart[i].every((e) => !present[e.a === i ? e.b : e.a] || blk.permits(e, i, d))) continue;
      any = true;
      if (blk.ways(i, k).some((w) => w.every((j) => !present[j]))) return "ok";
    }
    return any ? "blocked" : "noDir";
  };
  const bySteps = new Map();
  for (const i of offSeq) (bySteps.get(nodes[i].step) ?? bySteps.set(nodes[i].step, []).get(nodes[i].step)).push(i);
  for (const stepParts of [...bySteps.values()].reverse()) {
    let left = [...stepParts];
    for (let pass = 0; left.length && pass < left.length + 1; pass++) {
      const still = [];
      for (const i of left) (free(i) === "ok" ? (present[i] = 0) : still.push(i));
      if (still.length === left.length) break;
      left = still;
    }
    // What's left of a step may go on as one group (parts on one axle pushed in together).
    if (left.length > 1 && left.length <= 8) {
      const AX = [[0, -1, 0], [0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
      const inL = new Set(left);
      const ok = AX.some((d) => left.every((i) => byPart[i].every((e) => inL.has(e.a === i ? e.b : e.a) || !present[e.a === i ? e.b : e.a] || blk.permits(e, i, d))) && blk.groupWays(left, d).some((w) => w.every((j) => inL.has(j) || !present[j])));
      if (ok) {
        offTogether += left.length;
        for (const i of left) present[i] = 0;
        left = [];
      }
    }
    for (const i of left) {
      const why = free(i);
      offFail++, why === "blocked" ? offBlocked++ : offNoDir++;
      if (process.env.AGG && why === "noDir") {
        const sig = byPart[i].filter((e) => present[e.a === i ? e.b : e.a] && e.sense !== "any").map((e) => `${e.type}${e.sense}${e.a === i ? "M" : "F"}`).sort().join("+");
        (globalThis.agg ??= {})[sig] = (globalThis.agg[sig] ?? 0) + 1;
      }
      if (process.env.AGG && why === "blocked") {
        for (let k = 0; k < blk.dirs[i].length; k++) {
          const d = blk.dirs[i][k];
          if (!byPart[i].every((e) => !present[e.a === i ? e.b : e.a] || blk.permits(e, i, d))) continue;
          for (const j of blk.blockers(i, k).filter((j) => present[j])) {
            const linked = byPart[i].find((e) => (e.a === i ? e.b : e.a) === j);
            const cat = (k) => (lib.part(nodes[k].id).name.match(/^(Technic \w+|\w+)/)?.[1] ?? "?");
            const sig = `${cat(i)} ⟵ ${cat(j)}${linked ? " (joined " + linked.type + ")" : ""}`;
            (globalThis.agg ??= {})[sig] = (globalThis.agg[sig] ?? 0) + 1;
          }
        }
      }
      if (process.env.DEBUG && why === "noDir" && offNoDir <= +process.env.DEBUG) console.log("NODIR", nodes[i].id, lib.part(nodes[i].id).name.slice(0, 30), "joints:", byPart[i].filter((e) => present[e.a === i ? e.b : e.a]).map((e) => `${e.type}/s${e.sense}/${e.a === i ? "M" : "F"}/ax[${e.axis.map((v) => Math.round(v * 100) / 100)}]→${nodes[e.a === i ? e.b : e.a].id}`).join(" "));
      if (process.env.DEBUG && offFail <= +process.env.DEBUG) console.log("OFFICIAL✗", nodes[i].id, lib.part(nodes[i].id).name.slice(0, 30), "step", nodes[i].step, why, blk.dirs[i].map((d, k) => `[${d.map(Math.round)}]:${blk.blockers(i, k).filter((j) => present[j]).map((j) => nodes[j].id).slice(0, 3)}`).join(" "));
      present[i] = 0;
    }
  }
  const res = {
    name, parts: nodes.length, flexLeftOut: Object.values(flat.flex).reduce((s, v) => s + v, 0), unknown: Object.values(flat.unknown).reduce((s, v) => s + v, 0),
    edges: edges.length, types, inferredJoints: inferred.length, steps: plan.steps.length, clusters: plan.clusters, forced, joinsPieces: plan.steps.filter((s) => s.joins).length, together: { steps: plan.steps.filter((s) => s.together).length, maxUnits: Math.max(0, ...plan.steps.map((s) => s.together ?? 0)), maxParts: Math.max(0, ...plan.steps.filter((s) => s.together).map((s) => s.unit.length)) }, violations: plan.violations,
    validity: forced === 0, collisionFree: +(1 - plan.violations.blocked / Math.max(1, plan.steps.length)).toFixed(4),
    reorientations: reorient, stability: { sampled: samples, unstable, unstableAt, minMargin: +minMargin.toFixed(3), ms: Math.round(stabMs) },
    spearmanVsOfficial: +spearman(placedAt, official).toFixed(3), fileOrderVsOfficial: +spearman(fileOrder, official).toFixed(3),
    officialFlaggedInfeasible: { all: offFail, blocked: offBlocked, noDirection: offNoDir, asGroup: offTogether, rate: +(offFail / Math.max(1, nodes.length)).toFixed(4) },
    ms: { flatten: Math.round(tFlat), graph: Math.round(tGraph), blocking: Math.round(tBlock), plan: Math.round(plan.ms) },
    heapMB: Math.round((process.memoryUsage().heapUsed - heap0) / 1e6),
  };
  return res;
}

// --- unit tests: tiny LDraw models whose answer is known
function tests() {
  const brick = (x, y, z, id = "3001", c = 4) => `1 ${c} ${x} ${y} ${z} 1 0 0 0 1 0 0 0 1 ${id}.dat`;
  const ok = (cond, msg) => console.log(cond ? "  pass" : "  FAIL", msg);
  {
    const text = [brick(0, 0, 0), brick(0, -24, 0), brick(0, -48, 0)].join("\n");
    const nodes = flatten(text, lib).nodes, edges = connectionGraph(lib, nodes), blk = blocking(lib, nodes, edges);
    ok(edges.length === 2 && edges.every((e) => e.type === "stud" && e.n === 8), `tower of 3: 2 stud joints of 8 studs (got ${edges.map((e) => e.type + e.n)})`);
    const up = blk.dirs[0].findIndex((d) => d[1] < -0.99);
    ok(blk.blockers(0, up).includes(1) && blk.ways(2, blk.dirs[2].findIndex((d) => d[1] < -0.99)).some((w) => !w.length), "bottom brick blocked upward by the one above; top one free");
    const plan = planAssembly(nodes, edges, blk);
    ok(plan.steps.map((s) => s.unit[0]).join() === "0,1,2" && !plan.steps.some((s) => s.forced), `planned bottom-up (got ${plan.steps.map((s) => s.unit[0])})`);
    ok(checkStability(lib, nodes, edges).stable, "tower stands");
  }
  {
    // A 1×8 plate held by one stud at its end, sticking out 7 studs.
    const text = [brick(0, 0, 0), `1 1 100 -8 10 1 0 0 0 1 0 0 0 1 3460.dat`].join("\n");
    const nodes = flatten(text, lib).nodes, edges = connectionGraph(lib, nodes);
    ok(edges.length === 1 && edges[0].n === 1, `one-stud cantilever joint (got ${edges.map((e) => e.type + e.n)})`);
    ok(checkStability(lib, nodes, edges).stable, "a light plate on one stud holds");
    ok(!checkStability(lib, nodes, edges, { extraLoad: { part: 1, newtons: 3 } }).stable, "3 N on its free end pulls it off");
  }
  {
    const text = [brick(0, 0, 0), brick(200, -200, 0)].join("\n");
    const nodes = flatten(text, lib).nodes, edges = connectionGraph(lib, nodes);
    ok(!checkStability(lib, nodes, edges).stable, "a brick in mid-air falls");
  }
  {
    const nodes = flatten(fs.readFileSync(path.join(ROOT, "public/corpus/30190-1.mpd"), "latin1"), lib).nodes;
    const e0 = connectionGraph(lib, nodes), edges = e0.concat(contactFallback(lib, nodes, e0));
    const r = checkStability(lib, nodes, edges);
    const k = r.worst;
    console.log("   30190 stable:", r.stable, "iters", r.iterations, "worst", k >= 0 ? `${nodes[k].id} ${lib.part(nodes[k].id).name} residual ${r.residual[k].toExponential(2)}` : "-", "edges of worst:", edges.filter((e) => e.a === k || e.b === k).map((e) => e.type).join(","));
  }
}

if (args.includes("--tests") || !args.length) tests();
const targets = args.filter((a) => !a.startsWith("--"));
const results = [];
for (const t of targets.length ? targets : LADDER) {
  const file = fs.existsSync(t) ? t : path.join(ROOT, "public/corpus", `${t}.mpd`);
  const r = analyse(path.basename(t).replace(/\.(mpd|ldr)$/i, ""), fs.readFileSync(file, "latin1"));
  results.push(r);
  console.log(JSON.stringify(r));
}
if (globalThis.agg) console.log("AGG", JSON.stringify(Object.entries(globalThis.agg).sort((a, b) => b[1] - a[1]).slice(0, 15)));
if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(results, null, 1));
await vite.close();
