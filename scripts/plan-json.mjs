// Precomputed build plans (src/engine/plan/build.ts BuildPlan) for models, as JSON.
//   node scripts/plan-json.mjs id|file ...   → bench/results/plan-json/<name>.json

import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";

const ROOT = path.resolve(import.meta.dirname, "..");
const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const { makeLibrary } = await vite.ssrLoadModule("/src/engine/plan/library.ts");
const { buildPlan } = await vite.ssrLoadModule("/src/engine/plan/build.ts");
const read = (p) => {
  try {
    return fs.readFileSync(path.join(ROOT, p), "latin1");
  } catch {
    return null;
  }
};
const lib = makeLibrary(read, "public/ldraw", "booklets/shadow");
const dir = path.join(ROOT, "bench/results/plan-json");
fs.mkdirSync(dir, { recursive: true });
for (const t of process.argv.slice(2)) {
  const file = fs.existsSync(t) ? t : path.join(ROOT, "public/corpus", `${t}.mpd`);
  const name = path.basename(t).replace(/\.(mpd|ldr)$/i, "");
  const plan = buildPlan(fs.readFileSync(file, "latin1"), lib);
  fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(plan));
  console.log(name, JSON.stringify(plan.stats));
}
await vite.close();
