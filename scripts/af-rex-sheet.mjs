// One sheet per iteration of the 31058 T-rex goal: the photo | the reference rebuild |
// what the app makes today (the dinosaur rig, engine/assembly/dino.ts, as Studio's
// Dinosaur tile calls it at Junior / Creator / Advanced, size S). Same renderer as
// render-ldr.mjs. Dev server on :5174.
//
//   node scripts/af-rex-sheet.mjs out.png [--photo p.jpg] [--ref ref.ldr] [--seed 1]
//   VIEWS="0.7,0.45 -1.57,0.15"  azimuth,elevation pairs (default: ¾ and side)
//   TURN=3.1416  extra azimuth for our rows (the rig faces the other way from the reference)

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const out = args[0];
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const photo = opt("--photo"), ref = opt("--ref"), seed = +(opt("--seed") ?? 1);
const views = (process.env.VIEWS ?? "0.7,0.45 -1.57,0.15").split(" ").map((v) => v.split(",").map(Number));
const turn = +(process.env.TURN ?? Math.PI);

const b = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
await p.goto("http://localhost:5174/");
await p.waitForTimeout(3000);
const render = (src) =>
  p.evaluate(async ({ src, views, seed, turn }) => {
    const { PARTS } = await import("/src/engine/parts.ts");
    const T = await import("/src/scene/thumbnails.ts");
    let bricks;
    if (src.text) bricks = (await import("/src/engine/ldrawImport.ts")).importLDraw(src.text, "ref").bricks;
    else bricks = (await import("/src/engine/assembly/index.ts")).generateBuild("dino", { size: 0, level: src.level, seed, mode: "any", inv: {}, species: "rex" }).bricks;
    const known = bricks.filter((x) => PARTS[x.partId]);
    const imgs = [];
    for (const [azimuth, elevation] of views) imgs.push(await T.renderModelImageLDraw(known, 420, { azimuth: azimuth + (src.text ? 0 : turn), elevation }));
    return { imgs, n: bricks.length, missing: bricks.length - known.length };
  }, { src, views, seed, turn });

const rows = [];
if (photo) rows.push({ label: `photo (${path.basename(photo).replace(/\.\w+$/, "")})`, imgs: [`data:image/${path.extname(photo).slice(1).replace("jpg", "jpeg")};base64,${fs.readFileSync(photo).toString("base64")}`], note: "" });
if (ref) {
  const r = await render({ text: fs.readFileSync(ref, "latin1") });
  rows.push({ label: "reference", imgs: r.imgs, note: `${r.n} pcs${r.missing ? `, ${r.missing} not drawn` : ""}` });
}
for (const [level, name] of [[0, "Junior"], [1, "Creator"], [2, "Advanced"]]) {
  const r = await render({ level });
  rows.push({ label: `ours · ${name}`, imgs: r.imgs, note: `${r.n} pcs${r.missing ? `, ${r.missing} not drawn` : ""}` });
}
const html = `<body style="margin:0;font:13px system-ui;background:#fff"><table style="border-collapse:collapse">
${rows.map((r) => `<tr><td style="padding:4px;writing-mode:vertical-rl">${r.label}</td>${r.imgs.map((u) => `<td style="padding:2px;text-align:center"><img src="${u}" width="340" style="max-height:340px;object-fit:contain"></td>`).join("")}<td style="padding:6px">${r.note}</td></tr>`).join("")}
</table></body>`;
const q = await b.newPage();
await q.setContent(html);
await q.waitForTimeout(500);
await q.screenshot({ path: out, fullPage: true });
await b.close();
console.log("wrote", out);
