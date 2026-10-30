// The T. rex rig (engine/assembly/dino.ts) at every level and size: pieces and the
// worst joint stress (stability.ts; under 1 holds). Run after each 31058 iteration.
//   node scripts/c5-rex-check.mjs "$PWD"
import fs from "node:fs"; import path from "node:path"; import { createServer } from "vite";
const ROOT = process.argv[2];
globalThis.fetch = async (u) => { const p = path.join(ROOT, "public", String(u)); return { ok: fs.existsSync(p), headers: { get: () => "application/json" }, json: async () => JSON.parse(fs.readFileSync(p, "utf8")) }; };
const vite = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: false }, appType: "custom", logLevel: "error" });
const L = (m) => vite.ssrLoadModule(m);
await (await L("/src/engine/catalog.ts")).loadCatalog();
const { generateBuild } = await L("/src/engine/assembly/index.ts");
for (const level of [0, 1, 2]) for (const size of [0, 1, 2]) {
  const b = generateBuild("dino", { size, level, seed: 1, mode: "any", inv: {}, species: "rex" });
  const s = { stress: b.stress, floating: b.floating?.length ?? b.floating, ...(b.stats ?? {}) };
  console.log(level, size, b.bricks.length, JSON.stringify(Object.fromEntries(Object.entries(s).filter(([k, v]) => typeof v !== "object"))).slice(0, 200));
}
await vite.close();
