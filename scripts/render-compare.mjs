// Side-by-side pictures for a gate decision (program v2: "passing has to look
// right, not just score"): per model, the designer's build, then each saved bench
// build (BENCH_OUT dirs), rendered the same way on the real GPU, in one sheet.
// Made-to-measure parts aren't in a fresh page's catalog, so they're left out of
// the pictures (counted in the label).
//
//   node scripts/render-compare.mjs out.png id1,id2 dirA:label dirB:label ...   (dev server on :5174)

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const [out, ids, ...cols] = process.argv.slice(2);
const ROOT = path.resolve(import.meta.dirname, "..");
const b = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
await p.goto("http://localhost:5174/");
await p.waitForTimeout(3000);
const rows = [];
for (const id of ids.split(",")) {
  const mpd = fs.readFileSync(path.join(ROOT, "public/corpus", `${id}.mpd`), "latin1");
  const builds = cols.map((c) => JSON.parse(fs.readFileSync(path.join(c.split(":")[0], `out-${id}.json`), "utf8")));
  const imgs = await p.evaluate(async ({ mpd, id, builds }) => {
    const { importLDraw } = await import("/src/engine/ldrawImport.ts");
    const { PARTS } = await import("/src/engine/parts.ts");
    const T = await import("/src/scene/thumbnails.ts");
    const real = importLDraw(mpd, id).bricks;
    const all = [real, ...builds];
    const res = [];
    for (const bricks of all) {
      const known = bricks.filter((x) => PARTS[x.partId]);
      res.push({ url: await T.renderModelImageLDraw(known, 420, { azimuth: 0.7, elevation: 0.45 }), n: bricks.length, made: bricks.length - known.length });
    }
    return res;
  }, { mpd, id, builds });
  rows.push({ id, imgs });
}
// One HTML page with the pictures in a grid, screenshotted.
const labels = ["designer", ...cols.map((c) => c.split(":")[1] ?? c)];
const html = `<body style="margin:0;font:13px system-ui;background:#fff"><table style="border-collapse:collapse">
<tr><th></th>${labels.map((l) => `<th style="padding:4px">${l}</th>`).join("")}</tr>
${rows.map((r) => `<tr><td style="padding:4px;writing-mode:vertical-rl">${r.id}</td>${r.imgs.map((im) => `<td style="padding:2px;text-align:center"><img src="${im.url}" width="300"><br>${im.n} pcs${im.made ? ` (${im.made} made, not drawn)` : ""}</td>`).join("")}</tr>`).join("")}
</table></body>`;
const q = await b.newPage();
await q.setContent(html);
await q.waitForTimeout(500);
await q.screenshot({ path: out, fullPage: true });
await b.close();
console.log("wrote", out);
