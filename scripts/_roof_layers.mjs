import fs from "node:fs"; import path from "node:path"; import { createServer } from "vite";
const ROOT = process.cwd();
globalThis.fetch = async (u) => { const p = path.join(ROOT, "public", String(u)); return { ok: fs.existsSync(p), headers: { get: () => "application/json" }, json: async () => JSON.parse(fs.readFileSync(p, "utf8")) }; };
const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const L = (m) => vite.ssrLoadModule(m);
await (await L("/src/engine/catalog.ts")).loadCatalog();
const S = await L("/src/engine/shape.ts"); const { importLDraw } = await L("/src/engine/ldrawImport.ts");
S.installShapes(JSON.parse(fs.readFileSync("public/shapes.json", "utf8")));
const id = process.argv[2] || "31009-1-310091";
const v = S.voxelize(importLDraw(fs.readFileSync(`public/corpus/${id}.mpd`, "latin1"), id).bricks);
const fill = new Map(); for (const k of v.cells.keys()) { const [x, y, z] = S.unkey(k); const u = S.vkey(Math.floor(x / 4), Math.floor(y / 2), Math.floor(z / 4)); fill.set(u, (fill.get(u) ?? 0) + 1); }
const L2 = new Map(); for (const [u, n] of fill) if (n * 2 >= 32) { const [x, y, z] = S.unkey(u); (L2.get(y) ?? L2.set(y, []).get(y)).push([x, z]); }
for (const y of [...L2.keys()].sort((a, b) => b - a).slice(0, 26)) { const c = L2.get(y); const xs = c.map((p) => p[0]), zs = c.map((p) => p[1]);
  // Row profile across z at the middle x, to see the roof's cross-section.
  const midx = Math.round((Math.min(...xs) + Math.max(...xs)) / 2); const zr = c.filter((p) => p[0] === midx).map((p) => p[1]);
  console.log(`y${String(y).padStart(3)} area ${String(c.length).padStart(4)} x ${Math.min(...xs)}..${Math.max(...xs)} z ${Math.min(...zs)}..${Math.max(...zs)} | at x=${midx}: z ${zr.length ? Math.min(...zr) + ".." + Math.max(...zr) : "-"} (${zr.length})`); }
await vite.close();
