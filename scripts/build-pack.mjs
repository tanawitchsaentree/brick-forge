// Bakes LDraw parts into a sharded geometry pack (public/ldraw-pack), so the
// app shows real parts without parsing LDraw or fetching its thousands of
// small files: one request brings dozens of parts.
//
// Which parts: every part with a scanned shape (public/shapes.json: all the
// design corpus uses, plus the shaping library) and every part the generators
// place. Order: by how often designers use them (summed from the learned
// forms): the most used go in one core shard, the rest are a file each.
// index.json says which (0 = core, 1 = its own file).
//
// Usage: node scripts/build-pack.mjs
// Needs the catalog, shapes and forms (npm run catalog / shapes / forms) and Playwright's Chromium.

import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright";

const OUT = path.resolve("public/ldraw-pack");
const CORE = 3_000_000; // bytes of JSON in the core shard (brotli shrinks it ~3×)
fs.mkdirSync(OUT, { recursive: true });
// The page must not be served an old pack while it packs: set the folder aside.
const OLD = OUT + ".old";
fs.rmSync(OLD, { recursive: true, force: true });
fs.renameSync(OUT, OLD);
fs.mkdirSync(OUT, { recursive: true });

// How much designers use each part (from every tier's learned forms).
const use = new Map();
for (const f of fs.readdirSync("public/forms")) {
  for (const [id, , , , , n] of JSON.parse(fs.readFileSync(path.join("public/forms", f), "utf8"))) use.set(id, (use.get(id) ?? 0) + n);
}
const shapes = Object.keys(JSON.parse(fs.readFileSync("public/shapes.json", "utf8")));

const server = await createServer({ server: { port: 0 }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("page error:", e.message));
await page.goto(`${server.resolvedUrls.local[0]}thumbs.html`);
await page.evaluate(() => window.thumbsReady);

const generator = await page.evaluate(() => window.packIds());
const ids = [...new Set([...generator, ...shapes])].sort((a, b) => (use.get(b) ?? 0) - (use.get(a) ?? 0));
console.log(`${ids.length} parts to pack`);
const pack = {};
for (let i = 0; i < ids.length; i += 25) {
  Object.assign(pack, await page.evaluate((batch) => window.packParts(batch), ids.slice(i, i + 25)));
  process.stdout.write(`\r${Object.keys(pack).length}/${ids.length}`);
}
// The core shard: the most used parts, until CORE bytes (nearly every model
// needs them, so they come in one request). Every other part is a file of its
// own (p/<id>.json): a model fetches just the rare parts it uses, in parallel
// from the CDN, instead of whole shards for one part each.
const index = { core: "core.json", part: {} };
const core = {};
let size = 0;
fs.mkdirSync(path.join(OUT, "p"), { recursive: true });
for (const id of ids) {
  if (!pack[id]) continue;
  const json = JSON.stringify(pack[id]);
  if (size + json.length <= CORE) {
    core[id] = pack[id];
    index.part[id] = 0;
    size += json.length;
  } else {
    fs.writeFileSync(path.join(OUT, "p", `${encodeURIComponent(id)}.json`), json);
    index.part[id] = 1;
  }
}
fs.writeFileSync(path.join(OUT, "core.json"), JSON.stringify(core));
fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(index));
fs.rmSync(OLD, { recursive: true, force: true });
const singles = Object.values(index.part).filter((v) => v === 1).length;
console.log(`\npack: ${Object.keys(index.part).length} parts: ${Object.keys(core).length} in core (${(fs.statSync(path.join(OUT, "core.json")).size / 1048576).toFixed(1)} MB), ${singles} as single files`);
await browser.close();
await server.close();
