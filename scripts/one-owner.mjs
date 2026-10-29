// Whose cells our 1×1 parts fill (docs/engine/one-owner.md). For each 1×1 part in
// the saved bench builds, the designer part that owns most of the target cells it
// fills, classed as in scripts/vocab-breakdown.mjs: covered (its form is among the
// 1,500 tried), (a) in the table past 1,500, (b) pose not in the table (grid,
// upright offset half-stud / height / yaw, sideways, upside down, tilted), policy, (c).
// The form table is the bench's: leave-one-set-out per model.
//
//   BENCH_OUT=dir node scripts/bench-engine.mjs @core8+levels ...; node scripts/one-owner.mjs dir

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
  const { learnForms, learnMotifs, gridForms, isStructure, sigOf, formSigOf, keepPart } = await L("/src/engine/sculpt.ts");
  const { importLDraw, toGrid } = await L("/src/engine/ldrawImport.ts");
  const { connections } = await L("/src/engine/connect.ts");
  const { PARTS } = await L("/src/engine/parts.ts");
  const shapes = JSON.parse(fs.readFileSync(path.join(ROOT, "public/shapes.json"), "utf8"));
  S.installShapes(shapes);
  const corpus = JSON.parse(fs.readFileSync(path.join(ROOT, "public/corpus/index.json"), "utf8")).models;
  const read = (id) => importLDraw(fs.readFileSync(path.join(ROOT, "public/corpus", `${id}.mpd`), "latin1"), id).bricks;
  const all = new Map(corpus.filter((m) => m.tier !== "technic").map((m) => [m.id, read(m.id)]));
  const links = new Map([...all].map(([id, b]) => [id, connections(b)]));
  const keep = (id) => keepPart(id, (x) => !!shapes[x]);
  const poseOf = (b) => {
    if (!b.place && !b.pose) return "grid";
    if (b.pose) return "tilted";
    if (toGrid(b)) return "grid";
    const m = b.place;
    const upright = Math.abs(m[5] - 1) < 1e-3 && Math.abs(m[1]) < 1e-3 && Math.abs(m[9]) < 1e-3;
    if (upright) {
      const quarter = [m[0], m[2], m[8], m[10]].every((v) => Math.abs(Math.abs(v) - Math.round(Math.abs(v))) < 1e-3);
      if (!quarter) return "yaw";
      return Math.abs(m[13] / 0.4 - Math.round(m[13] / 0.4)) > 1e-3 ? "heightOffset" : "halfStud";
    }
    const axis = [0, 1, 2, 4, 5, 6, 8, 9, 10].every((i) => Math.abs(Math.abs(m[i]) - Math.round(Math.abs(m[i]))) < 1e-3);
    if (!axis) return "tilted";
    return Math.abs(m[5] + 1) < 1e-3 ? "upsideDown" : "sideways";
  };
  const src = (b) => (b.uid.startsWith("c") ? "capStuds" : /^bridge/.test(b.why?.motif ?? "") ? "bridge" : /^merged/.test(b.why?.motif ?? "") ? "merge" : /^made-/.test(b.partId) ? "made" : /finish|tile instead/i.test(b.why?.motif ?? "") ? "finishTops" : "greedy");
  const T = {}; // source → owner class → count
  for (const f of fs.readdirSync(dir).filter((f) => f.startsWith("out-"))) {
    const id = f.slice(4, -5);
    const set = corpus.find((m) => m.id === id).set;
    const tr = corpus.filter((m) => m.set !== set && m.tier !== "technic");
    const train = tr.map((m) => all.get(m.id));
    const learned = learnForms(train, keep).filter((x) => x.use >= 2);
    const parts = [...new Set(learned.map((x) => x.partId))];
    const table = [...learned, ...parts.flatMap((p) => gridForms(p, 0)), ...learnMotifs(train, tr.map((m) => links.get(m.id)), keep, 4)];
    const order = [...table].sort((a, b) => b.use - a.use);
    const rank = new Map();
    order.forEach((x, i) => !x.extra && !rank.has(sigOf(x)) && rank.set(sigOf(x), i));
    const real = all.get(id);
    const classOf = real.map((b) => {
      if (!PARTS[b.partId] || !shapes[b.partId]) return "c_catalog";
      if (!keep(b.partId)) return isStructure(b.partId) ? "policy_size_or_print" : "policy_notStructure";
      const r = rank.get(formSigOf(b));
      if (r !== undefined) return r < 1500 ? "covered" : "a_pastTop";
      return `b_${poseOf(b)}`;
    });
    const owner = new Map(); // target cell → designer part index
    real.forEach((b, i) => S.partCells(b, (x, y, z) => owner.set(S.vkey(x, y, z), i)));
    for (const b of JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))) {
      const p = PARTS[b.partId];
      if (!p || p.w !== 1 || p.d !== 1) continue;
      const votes = new Map();
      S.partCells(b, (x, y, z) => {
        const o = owner.get(S.vkey(x, y, z));
        if (o !== undefined) votes.set(o, (votes.get(o) ?? 0) + 1);
      });
      const top = [...votes].sort((a, c) => c[1] - a[1])[0];
      const cls = top ? classOf[top[0]] : "no target cells";
      const grid = !b.place && !b.pose ? "on" : b.pose ? "off" : toGrid(b) ? "on" : "off";
      const k = `${src(b)} · ${grid} grid`;
      ((T[k] ??= {})[cls] = (T[k][cls] ?? 0) + 1);
    }
    process.stderr.write(".");
  }
  console.log();
  for (const [k, m] of Object.entries(T)) {
    const n = Object.values(m).reduce((s, v) => s + v, 0);
    console.log(`${k}: ${n}`);
    for (const [c, v] of Object.entries(m).sort((a, b) => b[1] - a[1])) console.log(`   ${String(v).padStart(5)} ${(100 * v / n).toFixed(1).padStart(5)} %  owner: ${c}`);
  }
} finally {
  await vite.close();
}
