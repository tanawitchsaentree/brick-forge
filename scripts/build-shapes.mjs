// Scans part shapes (src/scene/shapeScan.ts) into public/shapes.json: every
// part the design corpus uses plus the library's shaping parts (bricks,
// plates, tiles, slopes, curves, wedges, rounds…). The engine matches parts to
// target shapes on these.
//
//   node scripts/build-shapes.mjs      (after npm run catalog and the corpus)

import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "public/shapes.json");
const SHAPING = /^(Brick|Plate|Tile|Slope|Wedge|Cylinder|Cone|Dish|Arch|Panel|Window|Windscreen|Bracket|Hinge|Wing|Car|Round)/;

const server = await createServer({ root: ROOT, server: { port: 5287, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.warn("page:", e.message));
  await page.goto("http://localhost:5287/");
  await page.waitForFunction(() => document.querySelector("canvas"), null, { timeout: 60000 });
  const ids = await page.evaluate(async (shaping) => {
    const [{ PART_LIST, PARTS }, { importLDraw }] = await Promise.all([import("/src/engine/parts.ts"), import("/src/engine/ldrawImport.ts")]);
    const ids = new Set(PART_LIST.filter((p) => !p.printed && new RegExp(shaping).test(p.category) && p.w <= 8 && p.d <= 8 && p.h <= 18).map((p) => p.id));
    const index = await (await fetch("/corpus/index.json")).json();
    for (const m of index.models) for (const b of importLDraw(await (await fetch(`/corpus/${m.id}.mpd`)).text(), m.id).bricks) ids.add(b.partId);
    return [...ids].filter((id) => PARTS[id]?.shape.type === "ldraw" && PARTS[id].w * PARTS[id].d * PARTS[id].h <= 2000);
  }, SHAPING.source);
  console.log(`${ids.length} parts to scan`);
  const table = {};
  for (let i = 0; i < ids.length; i += 50) {
    Object.assign(
      table,
      await page.evaluate(async (chunk) => {
        const [{ PARTS }, { scanPart }, { resetLDraw }] = await Promise.all([import("/src/engine/parts.ts"), import("/src/scene/shapeScan.ts"), import("/src/scene/ldraw.ts")]);
        const out = {};
        for (const id of chunk) {
          try {
            const s = await scanPart(PARTS[id]);
            let bin = "";
            for (const b of s.bits) bin += String.fromCharCode(b);
            out[id] = [s.nx, s.ny, s.nz, btoa(bin)];
          } catch {
            // no geometry: the engine falls back to the part's box
          }
        }
        resetLDraw();
        return out;
      }, ids.slice(i, i + 50)),
    );
    process.stdout.write(`\r${Math.min(i + 50, ids.length)}/${ids.length}`);
  }
  fs.writeFileSync(OUT, JSON.stringify(table));
  console.log(`\n${Object.keys(table).length} shapes → public/shapes.json (${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB)`);
} finally {
  await browser.close();
  await server.close();
}
