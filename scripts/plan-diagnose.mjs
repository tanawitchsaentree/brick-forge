// Diagnose the step planner (engine/instructions.ts) on corpus models with their
// official STEP lines stripped: how much of the structure the connection
// detectors see, how often a planned part goes on with nothing placed to hold
// it, how the order compares with the designer's, and how long it takes.
//
//   node scripts/plan-diagnose.mjs id1,id2,...

import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";

const ROOT = path.resolve(import.meta.dirname, "..");
globalThis.fetch = async (u) => { const p = path.join(ROOT, "public", String(u)); return { ok: fs.existsSync(p), headers: { get: () => "application/json" }, json: async () => JSON.parse(fs.readFileSync(p, "utf8")) }; };
const ids = (process.argv[2] ?? "").split(",").filter(Boolean);
const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const load = (m) => vite.ssrLoadModule(m);
await (await load("/src/engine/catalog.ts")).loadCatalog();
(await load("/src/engine/shape.ts")).installShapes(JSON.parse(fs.readFileSync(path.join(ROOT, "public/shapes.json"), "utf8")));
const { importLDraw } = await load("/src/engine/ldrawImport.ts");
const { connections, components } = await load("/src/engine/connect.ts");
const { planInstructions } = await load("/src/engine/instructions.ts");

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
  const ra = rank(a), rb = rank(b), n = a.length, ma = (n - 1) / 2;
  let s = 0, sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { s += (ra[i] - ma) * (rb[i] - ma); sa += (ra[i] - ma) ** 2; sb += (rb[i] - ma) ** 2; }
  return s / Math.sqrt(sa * sb);
};

for (const id of ids) {
  const res = importLDraw(fs.readFileSync(path.join(ROOT, "public/corpus", `${id}.mpd`), "latin1"), id);
  const bricks = res.bricks;
  const official = bricks.map((b) => b.step ?? 0);
  const missing = Object.values(res.missing).reduce((s, v) => s + v, 0);
  let t = performance.now();
  const links = connections(bricks);
  const tConnect = performance.now() - t;
  const deg = new Array(bricks.length).fill(0);
  for (const l of links) { deg[l.a]++; deg[l.b]++; }
  const isolated = deg.filter((d) => d === 0).length;
  const comps = components(bricks.length, links);
  const fits = links.filter((l) => l.studs === 0).length;
  // Plan without the designer's steps.
  const stripped = bricks.map(({ step, ...b }) => b);
  t = performance.now();
  const plan = planInstructions(stripped);
  const tPlan = performance.now() - t;
  const order = new Array(bricks.length).fill(0);
  plan.steps.forEach((s, k) => s.parts.forEach((p) => (order[p.index] = k)));
  // A part "floats" when it goes on with no connect.ts link to anything already placed
  // (and isn't on the ground): someone has to hold it until a later part ties it in.
  const nbr = bricks.map(() => []);
  for (const l of links) { nbr[l.a].push(l.b); nbr[l.b].push(l.a); }
  const minY = Math.min(...bricks.map((b) => b.y));
  let floats = 0;
  plan.steps.forEach((s, k) => {
    for (const p of s.parts) if (bricks[p.index].y > minY + 0 && !nbr[p.index].some((j) => order[j] < k || (order[j] === k && j !== p.index))) floats++;
  });
  console.log(JSON.stringify({
    id, parts: bricks.length, missing, offGrid: res.exact, links: links.length, fits, isolated, components: comps.length, largest: comps[0]?.length ?? 0,
    steps: plan.steps.length, floats, spearmanVsOfficial: +spearman(order, official).toFixed(3), msConnect: Math.round(tConnect), msPlan: Math.round(tPlan),
  }));
}
await vite.close();
