// Pictures of a build in progress: the booklet's order vs the planner's, at the same part
// counts, side by side (what the user judges by eye).
//   node scripts/plan-steps-render.mjs id out.png [fractions=0.15,0.35,0.6,0.85]   (dev server on :5174)
//   CONNECTORS=shadow to plan with LDCad's shadow library (local only)

import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright";

const ROOT = path.resolve(import.meta.dirname, "..");
const [id, out, fr = "0.15,0.35,0.6,0.85"] = process.argv.slice(2);
const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const { makeLibrary } = await vite.ssrLoadModule("/src/engine/plan/library.ts");
const { buildPlan } = await vite.ssrLoadModule("/src/engine/plan/build.ts");
const { flatten } = await vite.ssrLoadModule("/src/engine/plan/ldraw.ts");
const read = (p) => {
  try {
    return fs.readFileSync(path.join(ROOT, p), "latin1");
  } catch {
    return null;
  }
};
const lib = makeLibrary(read, "public/ldraw", process.env.CONNECTORS === "shadow" ? "booklets/shadow" : null);
const text = fs.readFileSync(path.join(ROOT, "public/corpus", `${id}.mpd`), "latin1");
const plan = buildPlan(text, lib);
await vite.close();
const nodes = flatten(text, lib).nodes;
// Orders: the booklet's (STEP, then file order) and ours (first time each part goes on).
const booklet = [...nodes].sort((a, b) => a.step - b.step || a.i - b.i).map((n) => n.i);
const ours = [];
const seen = new Set();
for (const s of plan.steps) for (const p of s.parts) if (!seen.has(p)) seen.add(p), ours.push(p);
const line = (i) => {
  const n = nodes[i];
  return `1 ${n.color} ${n.xf.t.join(" ")} ${n.xf.R.join(" ")} ${n.id}.dat`;
};
const fracs = fr.split(",").map(Number);
const sheets = { booklet: [], planner: [] };
for (const f of fracs) {
  const k = Math.max(1, Math.round(f * nodes.length));
  sheets.booklet.push(booklet.slice(0, k).map(line).join("\n"));
  sheets.planner.push(ours.slice(0, k).map(line).join("\n"));
}
const b = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
await p.goto("http://localhost:5174/");
await p.waitForTimeout(3000);
const imgs = await p.evaluate(async ({ sheets }) => {
  const { importLDraw } = await import("/src/engine/ldrawImport.ts");
  const { PARTS } = await import("/src/engine/parts.ts");
  const T = await import("/src/scene/thumbnails.ts");
  const res = {};
  for (const [k, list] of Object.entries(sheets)) {
    res[k] = [];
    for (const t of list) {
      const bricks = importLDraw(t, "x").bricks.filter((x) => PARTS[x.partId]);
      res[k].push(await T.renderModelImageLDraw(bricks, 360, { azimuth: 0.7, elevation: 0.45 }));
    }
  }
  return res;
}, { sheets });
const html = `<body style="margin:0;font:13px system-ui;background:#fff"><table style="border-collapse:collapse">
<tr><th></th>${fracs.map((f) => `<th>${Math.round(f * 100)}% (${Math.round(f * nodes.length)} parts)</th>`).join("")}</tr>
${Object.entries(imgs).map(([k, list]) => `<tr><td style="padding:4px;writing-mode:vertical-rl">${k}</td>${list.map((u) => `<td><img src="${u}" width="260"></td>`).join("")}</tr>`).join("")}
</table></body>`;
const q = await b.newPage();
await q.setContent(html);
await q.waitForTimeout(500);
await q.screenshot({ path: out, fullPage: true });
await b.close();
console.log("wrote", out);
