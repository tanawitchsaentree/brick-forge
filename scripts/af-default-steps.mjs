// The app's default steps for a model without a designer's (engine/instructions.ts), written
// as LDraw with STEP lines, so a step renderer can put them next to the booklet and the
// assembly planner. (af: the planner goes on in the app only where it beats this, by eye.)
//
//   node scripts/af-default-steps.mjs 31009-1-310091 [...]   → bench/results/af-plan-repro/<id>-default.ldr

import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";

const ROOT = path.resolve(import.meta.dirname, "..");
const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const L = (m) => vite.ssrLoadModule(m);
await (await L("/src/engine/catalog.ts")).loadCatalog();
const { importLDraw } = await L("/src/engine/ldrawImport.ts");
const { planInstructions } = await L("/src/engine/instructions.ts");
const { partLines, withMadeParts } = await L("/src/engine/ldraw.ts");
fs.mkdirSync(path.join(ROOT, "bench/results/af-plan-repro"), { recursive: true });
for (const id of process.argv.slice(2)) {
  const text = fs.readFileSync(path.join(ROOT, "public/corpus", `${id}.mpd`), "latin1");
  // As if the file had no STEP lines.
  const bricks = importLDraw(text, id).bricks.map(({ step, ...b }) => b);
  const plan = planInstructions(bricks);
  const lines = [`0 ${id} default steps`, `0 Name: ${id}-default.ldr`, "0 Author: Brick Forge", ""];
  for (const s of plan.steps) lines.push(...s.parts.flatMap((p) => partLines(bricks[p.index])), "0 STEP");
  const out = path.join(ROOT, "bench/results/af-plan-repro", `${id}-default.ldr`);
  fs.writeFileSync(out, withMadeParts(lines, bricks, `${id}-default`));
  console.log(`${id}: ${bricks.length} parts, ${plan.steps.length} default steps → ${path.relative(ROOT, out)}`);
}
await vite.close();
