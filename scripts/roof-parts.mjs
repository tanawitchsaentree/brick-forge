// What roofs are made of (the DNA experiment, docs/engine/dna-rules.md): in house
// designs, the parts whose top is open sky (no cell of another part right above
// any of their top cells) in the upper 40 % of the model's height. Designers'
// houses against our builds of them (saved bench builds, BENCH_OUT), by part
// name and role.
//
//   node scripts/roof-parts.mjs [dir of builds]
import fs from "node:fs"; import path from "node:path"; import { createServer } from "vite";
const ROOT = path.resolve(import.meta.dirname, "..");
globalThis.fetch = async (u) => { const p = path.join(ROOT, "public", String(u)); return { ok: fs.existsSync(p), headers: { get: () => "application/json" }, json: async () => JSON.parse(fs.readFileSync(p, "utf8")) }; };
const dir = process.argv[2];
const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
try {
  const L = (m) => vite.ssrLoadModule(m);
  await (await L("/src/engine/catalog.ts")).loadCatalog();
  const S = await L("/src/engine/shape.ts"); const { importLDraw } = await L("/src/engine/ldrawImport.ts"); const { PARTS } = await L("/src/engine/parts.ts"); const { rolesOf } = await L("/src/engine/roles.ts");
  S.installShapes(JSON.parse(fs.readFileSync(path.join(ROOT, "public/shapes.json"), "utf8")));
  const roofOf = (bricks) => {
    const own = new Map(); let ylo = Infinity, yhi = -Infinity;
    bricks.forEach((b, i) => S.partCells(b, (x, y, z) => { own.set(S.vkey(x, y, z), i); ylo = Math.min(ylo, y); yhi = Math.max(yhi, y); }));
    const cut = ylo + 0.6 * (yhi - ylo);
    const roof = new Set();
    bricks.forEach((b, i) => {
      let top = -Infinity; const cells = []; S.partCells(b, (x, y, z) => { cells.push([x, y, z]); top = Math.max(top, y); });
      if (top < cut) return;
      // Open sky over its highest column cells: nothing of another part right above.
      const tops = new Map(); for (const [x, y, z] of cells) { const k = `${x},${z}`; tops.set(k, Math.max(tops.get(k) ?? -Infinity, y)); }
      let open = 0; for (const [k, y] of tops) { const [x, z] = k.split(",").map(Number); const o = own.get(S.vkey(x, y + 1, z)); if (o === undefined || o === i) open++; }
      if (open >= tops.size * 0.5) roof.add(i);
    });
    return [...roof].map((i) => bricks[i]);
  };
  const src = (b) => (b.uid?.startsWith("c") ? "capStuds" : /finish|tile instead/i.test(b.why?.motif ?? "") ? "finishTops" : /^bridge/.test(b.why?.motif ?? "") ? "bridge" : b.why ? "greedy" : "designer");
  const tally = (list, m) => { for (const b of list) { m.src[src(b)] = (m.src[src(b)] ?? 0) + 1; const r = rolesOf(b.partId); const k = r.includes("slope") || r.includes("curved") || r.includes("wedge") ? "slope/curve/wedge" : r.includes("tile") ? "tile" : r.includes("plate") ? "plate (studs up)" : r.includes("brick") ? "brick (studs up)" : r.includes("round") ? "round" : "other"; m.k[k] = (m.k[k] ?? 0) + 1; const n = PARTS[b.partId]?.name ?? b.partId; m.n[n] = (m.n[n] ?? 0) + 1; m.total++; } };
  const corpus = JSON.parse(fs.readFileSync(path.join(ROOT, "public/corpus/index.json"), "utf8")).models.filter((m) => m.kind === "house");
  const D = { k: {}, n: {}, src: {}, total: 0 }, O = { k: {}, n: {}, src: {}, total: 0 };
  let houses = 0;
  for (const m of corpus) tally(roofOf(importLDraw(fs.readFileSync(path.join(ROOT, "public/corpus", `${m.id}.mpd`), "latin1"), m.id).bricks.filter((b) => PARTS[b.partId])), D), houses++;
  if (dir) for (const f of fs.readdirSync(dir).filter((f) => /^out-.*[^e]\.json$/.test(f) && !f.endsWith(".made.json"))) {
    const id = f.slice(4, -5); if (corpus.find((m) => m.id === id)) tally(roofOf(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")).filter((b) => PARTS[b.partId])), O);
  }
  const show = (t, label) => { console.log(`${label}: ${t.total} roof parts`); console.log("  by kind: " + Object.entries(t.k).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(100 * v / t.total).toFixed(1)}%`).join(" · ")); console.log("  by pass: " + JSON.stringify(t.src)); console.log("  most used: " + Object.entries(t.n).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k} ${v}`).join(" · ")); };
  show(D, `designers, ${houses} houses`); if (O.total) show(O, "ours (bench builds of the houses among them)");
} finally { await vite.close(); }
