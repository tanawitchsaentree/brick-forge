// Why our unconnected parts are unconnected (F7, docs/engine/track-s.md). For each
// part with no connection at all (engine/connect.ts) in the saved bench builds:
// what it touches (cells next to another part's cells): only sideways (x or z),
// above or below (y) without a stud joining them, or nothing; and which pass
// placed it.
//
//   node scripts/unconnected.mjs <dir of BENCH_OUT builds>

import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";

const ROOT = path.resolve(import.meta.dirname, "..");
globalThis.fetch = async (u) => {
  const p = path.join(ROOT, "public", String(u));
  return { ok: fs.existsSync(p), headers: { get: () => "application/json" }, json: async () => JSON.parse(fs.readFileSync(p, "utf8")) };
};
const dir = process.argv[2];
const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
try {
  const L = (m) => vite.ssrLoadModule(m);
  await (await L("/src/engine/catalog.ts")).loadCatalog();
  const S = await L("/src/engine/shape.ts");
  const { connections } = await L("/src/engine/connect.ts");
  const { PARTS } = await L("/src/engine/parts.ts");
  S.installShapes(JSON.parse(fs.readFileSync(path.join(ROOT, "public/shapes.json"), "utf8")));
  const src = (b) => (b.uid.startsWith("c") ? "capStuds" : b.uid.startsWith("i") ? "inside" : /^bridge/.test(b.why?.motif ?? "") ? "bridge" : /^made-/.test(b.partId) ? "made" : /finish|tile instead/i.test(b.why?.motif ?? "") ? "finishTops" : "greedy");
  const T = {}, byName = {};
  let total = 0, parts = 0;
  for (const f of fs.readdirSync(dir).filter((f) => f.startsWith("out-"))) {
    const bricks = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")).filter((b) => PARTS[b.partId]);
    parts += bricks.length;
    const deg = new Array(bricks.length).fill(0);
    for (const l of connections(bricks)) (deg[l.a]++, deg[l.b]++);
    const owner = new Map();
    bricks.forEach((b, i) => S.partCells(b, (x, y, z) => owner.set(S.vkey(x, y, z), i)));
    bricks.forEach((b, i) => {
      if (deg[i]) return;
      total++;
      let side = false, vert = false;
      S.partCells(b, (x, y, z) => {
        for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) { const o = owner.get(S.vkey(x + dx, y + dy, z + dz)); if (o !== undefined && o !== i) side = true; }
        for (const dy of [1, -1]) { const o = owner.get(S.vkey(x, y + dy, z)); if (o !== undefined && o !== i) vert = true; }
      });
      const kind = vert ? "touches above/below, no stud joins" : side ? "touches only sideways" : "touches nothing";
      const k = `${kind} · ${src(b)}`;
      T[k] = (T[k] ?? 0) + 1;
      const n = `${kind}: ${PARTS[b.partId].name}`;
      byName[n] = (byName[n] ?? 0) + 1;
    });
  }
  console.log(`unconnected ${total} of ${parts} parts`);
  for (const [k, v] of Object.entries(T).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)} ${(100 * v / total).toFixed(1).padStart(5)} %  ${k}`);
  console.log("by part:");
  for (const [k, v] of Object.entries(byName).sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${String(v).padStart(5)}  ${k}`);
} finally {
  await vite.close();
}
