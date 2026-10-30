// Pictures of LDraw files (a hand-made reconstruction, a corpus model) from a few
// angles, in one sheet, rendered as render-compare.mjs does. Parts the catalog
// doesn't know are left out (counted in the label).
//
//   node scripts/render-ldr.mjs out.png a.ldr[:label] b.mpd[:label] ...   (dev server on :5174)
//   VIEWS="0.7,0.45 2.4,0.3"  azimuth,elevation pairs (default: three views)

import fs from "node:fs";
import { chromium } from "playwright";

const [out, ...files] = process.argv.slice(2);
const views = (process.env.VIEWS ?? "0.7,0.45 2.4,0.35 -1.57,1.4").split(" ").map((v) => v.split(",").map(Number));
const b = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
await p.goto("http://localhost:5174/");
await p.waitForTimeout(3000);
const rows = [];
for (const f of files) {
  const [file, label] = f.split(":");
  const text = fs.readFileSync(file, "latin1");
  const imgs = await p.evaluate(async ({ text, views }) => {
    const { importLDraw } = await import("/src/engine/ldrawImport.ts");
    const { PARTS } = await import("/src/engine/parts.ts");
    const T = await import("/src/scene/thumbnails.ts");
    const bricks = importLDraw(text, "file").bricks;
    const known = bricks.filter((x) => PARTS[x.partId]);
    const res = [];
    for (const [azimuth, elevation] of views) res.push({ url: await T.renderModelImageLDraw(known, 420, { azimuth, elevation }), n: bricks.length, missing: [...new Set(bricks.filter((x) => !PARTS[x.partId]).map((x) => x.partId))] });
    return res;
  }, { text, views });
  rows.push({ label: label ?? file, imgs });
}
const html = `<body style="margin:0;font:13px system-ui;background:#fff"><table style="border-collapse:collapse">
${rows.map((r) => `<tr><td style="padding:4px;writing-mode:vertical-rl">${r.label}</td>${r.imgs.map((im) => `<td style="padding:2px;text-align:center"><img src="${im.url}" width="380"><br>${im.n} pcs${im.missing.length ? ` (not drawn: ${im.missing.join(" ")})` : ""}</td>`).join("")}</tr>`).join("")}
</table></body>`;
const q = await b.newPage();
await q.setContent(html);
await q.waitForTimeout(500);
await q.screenshot({ path: out, fullPage: true });
await b.close();
console.log("wrote", out);
