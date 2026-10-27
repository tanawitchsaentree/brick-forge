// Bakes the parts the generators use into public/ldraw-pack/pack.json, so
// Ideas, instructions and previews show real parts without parsing LDraw.
//
// Usage: node scripts/build-pack.mjs
// Needs the LDraw catalog (npm run catalog) and Playwright's Chromium.

import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright";

const OUT = path.resolve("public/ldraw-pack");
fs.mkdirSync(OUT, { recursive: true });
// An old pack would be served to the page while it packs; set it aside.
const file = path.join(OUT, "pack.json");
if (fs.existsSync(file)) fs.renameSync(file, file + ".old");

const server = await createServer({ server: { port: 0 }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("page error:", e.message));
await page.goto(`${server.resolvedUrls.local[0]}thumbs.html`);
await page.evaluate(() => window.thumbsReady);

const ids = await page.evaluate(() => window.packIds());
console.log(`${ids.length} parts to pack`);
const pack = {};
for (let i = 0; i < ids.length; i += 20) {
  Object.assign(pack, await page.evaluate((batch) => window.packParts(batch), ids.slice(i, i + 20)));
  process.stdout.write(`\r${Object.keys(pack).length}/${ids.length}`);
}
fs.writeFileSync(file, JSON.stringify(pack));
fs.rmSync(file + ".old", { force: true });
console.log(`\npack: ${(fs.statSync(file).size / 1048576).toFixed(1)} MB, ${Object.keys(pack).length} parts`);
await browser.close();
await server.close();
