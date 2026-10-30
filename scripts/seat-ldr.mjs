// Seat hand-placed parts: for each part the app's connection check (engine/connect.ts, via
// engine/stability.ts) finds attached to nothing, try small moves along its own axes (up to
// 6 LDU, half-LDU steps) and keep the smallest one that attaches it without new loose parts.
// Run after a rebuild script writes a reference model.
//   node scripts/seat-ldr.mjs data/golden/31151-rex.ldr
import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";

const ROOT = path.resolve(import.meta.dirname, "..");
globalThis.fetch = async (u) => {
  const p = path.join(ROOT, "public", String(u));
  return { ok: fs.existsSync(p), headers: { get: () => "application/json" }, json: async () => JSON.parse(fs.readFileSync(p, "utf8")) };
};
const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
await (await vite.ssrLoadModule("/src/engine/catalog.ts")).loadCatalog();
const { importLDraw } = await vite.ssrLoadModule("/src/engine/ldrawImport.ts");
const { analyzeStability } = await vite.ssrLoadModule("/src/engine/stability.ts");
const file = process.argv[2];
let lines = fs.readFileSync(file, "latin1").split(/\r?\n/);
const floatingLines = (ls) => {
  const r = importLDraw(ls.join("\n"), "x");
  const st = analyzeStability(r.bricks);
  // importLDraw keeps the source line of each part's top-level reference; parts are in sub-model FILEs,
  // so map floating parts back by (part id, colour, order of appearance).
  return { count: st.floating.size, bricks: r.bricks, floating: st.floating };
};
const shift = (l, axis, d) => {
  const t = l.trim().split(/\s+/);
  const a = t.slice(2, 14).map(Number);
  const R = a.slice(3);
  const col = [R[axis], R[3 + axis], R[6 + axis]];
  t[2] = (a[0] + col[0] * d).toFixed(3);
  t[3] = (a[1] + col[1] * d).toFixed(3);
  t[4] = (a[2] + col[2] * d).toFixed(3);
  return t.join(" ");
};
const first = floatingLines(lines);
let base = first.count;
// Candidates: lines of the part types that float (the importer doesn't keep sub-model lines).
const loose = new Set(first.bricks.filter((b) => first.floating.has(b.uid)).map((b) => b.partId));
console.log("loose parts before:", base, [...loose].join(" "));
const partLines = [];
lines.forEach((l, i) => {
  const t = l.trim().split(/\s+/);
  if (t[0] === "1" && t.length >= 15 && loose.has(t[14].toLowerCase().replace(/\.dat$/, ""))) partLines.push(i);
});
const tries = [];
for (let d = 0.5; d <= 6; d += 0.5) tries.push(d, -d);
if (process.env.WIDE) tries.push(10, -10, 20, -20, 8, -8, 16, -16, 24, -24);
for (const i of partLines) {
  if (base === 0) break;
  // Only lines whose part currently floats: test by moving it and seeing the count drop.
  let best = null;
  for (const axis of [1, 0, 2])
    for (const d of tries) {
      const trial = [...lines];
      trial[i] = shift(lines[i], axis, d);
      const c = floatingLines(trial).count;
      if (c < base && (!best || c < best.c || (c === best.c && Math.abs(d) < Math.abs(best.d)))) best = { c, d, axis };
      if (best && best.c < base && Math.abs(d) >= 2) break;
    }
  if (best) {
    lines[i] = shift(lines[i], best.axis, best.d);
    console.log(`  line ${i + 1}: ${lines[i].trim().split(/\s+/).at(-1)} moved ${best.d} LDU along its ${"xyz"[best.axis]} → loose ${best.c}`);
    base = best.c;
  }
}
fs.writeFileSync(file, lines.join("\n"));
console.log("loose parts after:", base);
await vite.close();
