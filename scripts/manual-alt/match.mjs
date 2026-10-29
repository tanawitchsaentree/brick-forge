import { chromium } from "/Users/tanawitch.saentree/Downloads/lego builder/node_modules/playwright/index.mjs";
import fs from "node:fs";
const cands = JSON.parse(fs.readFileSync("/tmp/pdf30714/candidates.json"));
const callouts = JSON.parse(fs.readFileSync("/tmp/pdf30714/callouts.json")).map((c) => ({ ...c, data: "data:image/png;base64," + fs.readFileSync(c.png).toString("base64") }));
const b = await chromium.launch(); const p = await b.newPage();
p.on("pageerror", (e) => console.log("ERR", e.message));
await p.goto("http://localhost:5173/"); await p.waitForTimeout(2500);
const res = await p.evaluate(async ({ cands, callouts }) => {
  const { renderModelImageLDraw } = await import("/src/scene/thumbnails.ts");
  const { PARTS } = await import("/src/engine/parts.ts");
  const N = 32;
  // Crop to what's drawn (alpha, or not-near-white), fit into N×N keeping aspect; → mask + rgb.
  const load = (src) => new Promise((ok) => { const im = new Image(); im.onload = () => ok(im); im.src = src; });
  const vec = (im) => {
    const c = document.createElement("canvas"); c.width = im.width; c.height = im.height;
    const g = c.getContext("2d"); g.drawImage(im, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    // Background: transparency if there is any, else the corner colour (a callout box's tint).
    const opaque = d[3] > 250 && d[(c.width - 1) * 4 + 3] > 250;
    const bg = [d[0], d[1], d[2]];
    const on = (i) => (opaque ? Math.hypot(d[i] - bg[0], d[i + 1] - bg[1], d[i + 2] - bg[2]) > 38 : d[i + 3] > 40);
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (on((y * c.width + x) * 4)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    if (x1 < 0) return null;
    const w = x1 - x0 + 1, h = y1 - y0 + 1, s = Math.max(w, h);
    const o = document.createElement("canvas"); o.width = o.height = N;
    const og = o.getContext("2d"); og.imageSmoothingQuality = "high";
    og.drawImage(c, x0, y0, w, h, ((s - w) / 2) * N / s, ((s - h) / 2) * N / s, (w * N) / s, (h * N) / s);
    const od = og.getImageData(0, 0, N, N).data;
    const mask = [], rgb = [];
    for (let i = 0; i < N * N; i++) {
      const fg = opaque ? Math.hypot(od[i * 4] - bg[0], od[i * 4 + 1] - bg[1], od[i * 4 + 2] - bg[2]) > 38 && od[i * 4 + 3] > 128 : od[i * 4 + 3] > 128;
      mask.push(fg ? 1 : 0);
      rgb.push([od[i * 4], od[i * 4 + 1], od[i * 4 + 2]]);
    }
    let r = 0, g2 = 0, bl = 0, n = 0; for (let i = 0; i < N * N; i++) if (mask[i]) { r += rgb[i][0]; g2 += rgb[i][1]; bl += rgb[i][2]; n++; }
    return { mask, rgb, mean: [r / n, g2 / n, bl / n], aspect: w / h };
  };
  const views = [];
  for (const c of cands) {
    for (const az of [0.6, 0.9, 1.2, 2.2, 2.6, 3.8, 4.2, 5.4]) {
      const url = await renderModelImageLDraw([{ uid: "c", partId: c.id, x: 0, y: 0, z: 0, rot: 0, color: c.color }], 160, { azimuth: az });
      const v = vec(await load(url));
      if (v) views.push({ c, az, v, size: Math.hypot(PARTS[c.id].w, PARTS[c.id].d, PARTS[c.id].h * 0.4) });
    }
  }
  const out = [];
  for (const co of callouts) {
    const v = vec(await load(co.data));
    if (!v) { out.push({ ...co, data: undefined, best: null }); continue; }
    const scored = views.map(({ c, az, v: w }) => {
      let inter = 0, uni = 0, cd = 0, cn = 0;
      for (let i = 0; i < N * N; i++) {
        if (v.mask[i] || w.mask[i]) uni++;
        if (v.mask[i] && w.mask[i]) { inter++; cd += Math.hypot(v.rgb[i][0] - w.rgb[i][0], v.rgb[i][1] - w.rgb[i][1], v.rgb[i][2] - w.rgb[i][2]); cn++; }
      }
      const iou = inter / Math.max(1, uni);
      const meanD = Math.hypot(v.mean[0] - w.mean[0], v.mean[1] - w.mean[1], v.mean[2] - w.mean[2]);
      return { c, az, iou, meanD, size: views.find((x) => x.c === c).size, score: (1 - iou) + meanD / 200 + Math.abs(Math.log(v.aspect / w.aspect)) * 0.3 };
    }).sort((a, b) => a.score - b.score);
    // Best per candidate (any view), top 3.
    const seen = new Set(), top = [];
    for (const s of scored) { const k = s.c.rb + s.c.colorName; if (seen.has(k)) continue; seen.add(k); top.push({ part: s.c.rb, id: s.c.id, color: s.c.colorName, iou: +s.iou.toFixed(2), meanD: Math.round(s.meanD), score: +s.score.toFixed(3), size: s.size }); }
    out.push({ page: co.page, step: co.step, qty: co.qty, png: co.png, diag: co.diag, top });
  }
  return out;
}, { cands, callouts });
fs.writeFileSync("/tmp/pdf30714/matches.json", JSON.stringify(res, null, 1));
for (const r of res) console.log(`step ${String(r.step).padStart(2)} ${r.qty}x → ${r.top?.[0]?.part} ${r.top?.[0]?.color} (iou ${r.top?.[0]?.iou}, colour Δ ${r.top?.[0]?.meanD}) | 2nd ${r.top?.[1]?.part} ${r.top?.[1]?.color} ${r.top?.[1]?.score} vs ${r.top?.[0]?.score}`);
await b.close();
