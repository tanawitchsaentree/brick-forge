import { chromium } from "/Users/tanawitch.saentree/Downloads/lego builder/node_modules/playwright/index.mjs";
import fs from "node:fs";
const steps = JSON.parse(fs.readFileSync("/tmp/pdf30714/steps.json"));
const cand = JSON.parse(fs.readFileSync("/tmp/pdf30714/candidates.json"));
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1300, height: 900 } });
await p.goto("http://localhost:5173/"); await p.waitForTimeout(2500);
const renders = await p.evaluate(async (list) => {
  const { renderModelImageLDraw } = await import("/src/scene/thumbnails.ts");
  const out = {};
  for (const c of list) out[c.rb + "|" + c.colorName] = await renderModelImageLDraw([{ uid: "c", partId: c.id, x: 0, y: 0, z: 0, rot: 0, color: c.color }], 120, { azimuth: 0.9 });
  return out;
}, cand);
const changed = new Set(["22", "11", "13", "15"]);
await p.setContent(`<body style="margin:0;font:11px system-ui;display:grid;grid-template-columns:repeat(8,160px);background:#eee">${steps.map((r) => `<div style="background:#fff;margin:2px;padding:3px;${r.part !== r.top[0].part ? "outline:2px solid #e11" : ""}"><div style="display:flex;align-items:center;gap:4px"><img src="data:image/png;base64,${fs.readFileSync(r.png).toString("base64")}" style="max-width:70px;max-height:60px"><img src="${renders[r.part + "|" + r.color]}" width=70></div><div>step ${r.step} · ${r.qty}x ${r.part} ${r.color}</div></div>`).join("")}</body>`);
await p.screenshot({ path: "/tmp/prev/match3.png", fullPage: true }); await b.close();
