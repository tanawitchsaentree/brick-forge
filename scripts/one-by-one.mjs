// Where our 1×1 parts are, against the designer's (docs/engine/phase2.md): bench
// builds saved with BENCH_OUT, each 1×1 by why it can't be merged into a bigger
// part, and both sides' 1×1 counts by part name.
//
//   BENCH_OUT=dir node scripts/bench-engine.mjs @core8+levels; node scripts/one-by-one.mjs dir
import fs from "node:fs"; import path from "node:path"; import { createServer } from "vite";
const ROOT = path.resolve(import.meta.dirname, "..");
globalThis.fetch = async (u) => { const p = path.join(ROOT, "public", String(u)); return { ok: fs.existsSync(p), headers: { get: () => "application/json" }, json: async () => JSON.parse(fs.readFileSync(p, "utf8")) }; };
const dir = process.argv[2];
const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
try {
  const L = (m) => vite.ssrLoadModule(m);
  await (await L("/src/engine/catalog.ts")).loadCatalog();
  const { toGrid, importLDraw } = await L("/src/engine/ldrawImport.ts"); const { PARTS } = await L("/src/engine/parts.ts");
  const fam = (id) => PARTS[id]?.name.match(/^(Brick|Plate|Tile) \d+ ?× ?\d+( with Groove)?$/)?.[1];
  const g = (b) => (b.pose ? null : b.place ? toGrid(b) : { x: b.x, y: b.y, z: b.z, rot: b.rot });
  const is1 = (b) => PARTS[b.partId] && PARTS[b.partId].w === 1 && PARTS[b.partId].d === 1;
  const why = {}, oursBy = {}, humanBy = {};
  let oursN = 0, humanN = 0;
  for (const f of fs.readdirSync(dir).filter((f) => f.startsWith("out-"))) {
    const id = f.slice(4, -5);
    const bricks = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    const real = importLDraw(fs.readFileSync(path.join(ROOT, "public/corpus", `${id}.mpd`), "latin1"), id).bricks;
    oursN += bricks.length; humanN += real.length;
    for (const b of real.filter(is1)) humanBy[PARTS[b.partId].name] = (humanBy[PARTS[b.partId].name] ?? 0) + 1;
    const cells = new Map();
    for (const b of bricks) {
      if (!fam(b.partId)) continue;
      const q = g(b); if (!q) continue;
      const p = PARTS[b.partId], t = q.rot % 2, w = t ? p.d : p.w, d = t ? p.w : p.d;
      for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) cells.set(`${q.x + x},${q.y},${q.z + z}`, b);
    }
    for (const b of bricks.filter(is1)) {
      const name = PARTS[b.partId].name;
      oursBy[name] = (oursBy[name] ?? 0) + 1;
      const add = (k) => (why[k] = (why[k] ?? 0) + 1);
      if (!fam(b.partId)) { add(`special part (${PARTS[b.partId].category})`); continue; }
      const q = g(b);
      if (!q) { add(b.pose ? "posed" : "exact, off the grid"); continue; }
      const nbrs = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => cells.get(`${q.x + dx},${q.y},${q.z + dz}`)).filter(Boolean);
      if (!nbrs.length) { add("plain, no plain neighbour at its level"); continue; }
      const same = nbrs.filter((o) => fam(o.partId) === fam(b.partId) && PARTS[o.partId].h === PARTS[b.partId].h);
      if (!same.length) { add("plain, neighbours another family or height"); continue; }
      if (!same.some((o) => o.color === b.color)) { add("plain, neighbours another colour"); continue; }
      add("plain, a same-kind neighbour left after the merge pass");
    }
  }
  const top = (m) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${v} ${k}`).join("\n  ");
  const n1 = Object.values(oursBy).reduce((s, v) => s + v, 0), h1 = Object.values(humanBy).reduce((s, v) => s + v, 0);
  console.log(`pieces ours ${oursN}, designer ${humanN}; 1×1 ours ${n1}, designer ${h1}`);
  console.log("ours, why not merged:\n  " + Object.entries(why).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} (${(100 * v / n1).toFixed(1)} %) ${k}`).join("\n  "));
  console.log("ours by name:\n  " + top(oursBy));
  console.log("designer by name:\n  " + top(humanBy));
} finally { await vite.close(); }
