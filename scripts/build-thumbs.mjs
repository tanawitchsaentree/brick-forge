// Pre-renders a WebP thumbnail for every catalog part into public/thumbs/,
// so the parts library never renders 3D on the main thread.
//
// Usage: node scripts/build-thumbs.mjs [--limit N] [--force]
// Needs the LDraw catalog (npm run catalog) and Playwright's Chromium.

import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;
const force = args.includes("--force");
const OUT = path.resolve("public/thumbs");
const BATCH = 24;

const catalog = JSON.parse(fs.readFileSync("public/catalog.json", "utf8"));
fs.mkdirSync(OUT, { recursive: true });
const todo = catalog.parts
  .map((p) => p.id)
  .filter((id) => force || !fs.existsSync(path.join(OUT, `${id}.webp`)))
  .slice(0, limit);
console.log(`${todo.length} thumbnails to render`);

const server = await createServer({ server: { port: 0 }, logLevel: "error" });
await server.listen();
const url = server.resolvedUrls.local[0];

// Prefer the real GPU; fall back to software GL where there isn't one.
const browser = await chromium.launch({
  args: ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=metal", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("\npage error:", e.message));
page.on("crash", () => console.error("\npage crashed"));
await page.goto(`${url}thumbs.html`);
await page.evaluate(() => window.thumbsReady);

const started = Date.now();
let done = 0;
let failed = 0;
for (let i = 0; i < todo.length; i += BATCH) {
  const ids = todo.slice(i, i + BATCH);
  let images;
  try {
    images = await Promise.race([
      page.evaluate((batch) => window.renderThumbs(batch), ids),
      new Promise((_, rej) => setTimeout(() => rej(new Error("batch timeout")), 120000)),
    ]);
  } catch (err) {
    console.error(`\nbatch at ${i} failed (${err.message}); reloading page`);
    failed += ids.length;
    await page.reload();
    await page.evaluate(() => window.thumbsReady);
    continue;
  }
  for (const [id, dataUrl] of Object.entries(images)) {
    if (!dataUrl?.startsWith("data:image/webp")) {
      failed++;
      continue;
    }
    fs.writeFileSync(path.join(OUT, `${id}.webp`), Buffer.from(dataUrl.split(",")[1], "base64"));
    done++;
  }
  const rate = done / ((Date.now() - started) / 1000);
  process.stdout.write(`\r${done}/${todo.length} rendered, ${failed} failed, ${rate.toFixed(1)}/s   `);
}

// Previews for the "What do you want to build?" picker (always redrawn: designs change).
const builds = await page.evaluate(() => window.renderBuildPreviews());
fs.mkdirSync(path.join(OUT, "builds"), { recursive: true });
for (const [kind, url] of Object.entries(builds)) fs.writeFileSync(path.join(OUT, "builds", `${kind}.webp`), Buffer.from(url.split(",")[1], "base64"));
console.log(`\n${Object.keys(builds).length} build previews in public/thumbs/builds`);

// Index of available thumbnails, so the app never requests one that doesn't exist.
const have = fs.readdirSync(OUT).filter((f) => f.endsWith(".webp")).map((f) => f.slice(0, -5));
fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(have));
console.log(`\n${have.length} thumbnails in public/thumbs`);

await browser.close();
await server.close();
