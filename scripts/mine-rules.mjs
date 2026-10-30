// Attachment rules around feature parts, mined from the corpus (program v2, the
// DNA experiment; docs/engine/dna-rules.md). For every window, windscreen, door,
// wheel, light and grille in a designer's build, every part it's connected to
// (engine/connect.ts): which part, where it sits in the feature part's own frame
// (studs, plates, to a half), how it's turned (a quarter-turn signature, or
// "angled"), and on which side (above, below, beside, front, back). Counted per
// set, so a test can leave its own set out (rule 3).
//
//   node scripts/mine-rules.mjs [out.json]      → data/rules/adjacency.json + a report

import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";

const ROOT = path.resolve(import.meta.dirname, "..");
globalThis.fetch = async (u) => {
  const p = path.join(ROOT, "public", String(u));
  return { ok: fs.existsSync(p), headers: { get: () => "application/json" }, json: async () => JSON.parse(fs.readFileSync(p, "utf8")) };
};
const OUT = process.argv[2] || "data/rules/adjacency.json";
const FEATURES = ["window", "windscreen", "door", "wheel", "light", "grille"];

const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
try {
  const L = (m) => vite.ssrLoadModule(m);
  await (await L("/src/engine/catalog.ts")).loadCatalog();
  const { importLDraw } = await L("/src/engine/ldrawImport.ts");
  const { PARTS } = await L("/src/engine/parts.ts");
  const { connections } = await L("/src/engine/connect.ts");
  const { partMatrix, invertRigid, mul } = await L("/src/engine/pose.ts");
  const { PLATE_H } = await L("/src/engine/units.ts");
  const { rolesOf } = await L("/src/engine/roles.ts");
  const corpus = JSON.parse(fs.readFileSync(path.join(ROOT, "public/corpus/index.json"), "utf8")).models.filter((m) => m.tier !== "technic");

  const half = (v) => Math.round(v * 2) / 2;
  const turnSig = (m) => {
    const r = [0, 1, 2, 4, 5, 6, 8, 9, 10].map((i) => m[i]);
    return r.every((v) => Math.abs(v - Math.round(v)) < 1e-3) ? r.map((v) => Math.round(v) + 0).join(",") : "angled";
  };
  const rules = new Map(); // key → { feature, neighbour, side, at, turn, n, sets: {set: n} }
  const featureCount = new Map(); // feature part → { n, sets }
  let links = 0;
  for (const m of corpus) {
    const bricks = importLDraw(fs.readFileSync(path.join(ROOT, "public/corpus", `${m.id}.mpd`), "latin1"), m.id).bricks.filter((b) => PARTS[b.partId]);
    const feat = bricks.map((b) => FEATURES.find((r) => rolesOf(b.partId).includes(r)));
    if (!feat.some(Boolean)) continue;
    bricks.forEach((b, i) => {
      if (!feat[i]) return;
      const e = featureCount.get(b.partId) ?? { role: feat[i], n: 0, sets: {} };
      e.n++;
      e.sets[m.set] = (e.sets[m.set] ?? 0) + 1;
      featureCount.set(b.partId, e);
    });
    const mats = bricks.map((b) => partMatrix(b));
    for (const l of connections(bricks))
      for (const [a, c] of [[l.a, l.b], [l.b, l.a]]) {
        if (!feat[a]) continue;
        links++;
        const rel = mul(invertRigid(mats[a]), mats[c]);
        const pa = PARTS[bricks[a].partId], pc = PARTS[bricks[c].partId];
        // The neighbour's centre in the feature part's frame (x, z studs; y plates).
        const cx = rel[0] * pc.w / 2 + rel[4] * (pc.h * PLATE_H) / 2 + rel[8] * pc.d / 2 + rel[12];
        const cy = (rel[1] * pc.w / 2 + rel[5] * (pc.h * PLATE_H) / 2 + rel[9] * pc.d / 2 + rel[13]) / PLATE_H;
        const cz = rel[2] * pc.w / 2 + rel[6] * (pc.h * PLATE_H) / 2 + rel[10] * pc.d / 2 + rel[14];
        // Side, against the feature part's own box (0..w, 0..h, 0..d).
        const side = cy < 0 ? "below" : cy > pa.h ? "above" : cz < 0 ? "front" : cz > pa.d ? "back" : "beside";
        const at = [half(rel[12]), half(rel[13] / PLATE_H), half(rel[14])].join(",");
        const turn = turnSig(rel);
        const key = `${bricks[a].partId}|${bricks[c].partId}|${at}|${turn}`;
        // The first exact relative matrix seen for this rule (glass sits a fraction of a stud in).
        const r = rules.get(key) ?? { feature: bricks[a].partId, role: feat[a], neighbour: bricks[c].partId, side, at, turn, exact: rel.map((v) => Math.round(v * 1000) / 1000), color: bricks[c].color, n: 0, sets: {} };
        r.n++;
        r.sets[m.set] = (r.sets[m.set] ?? 0) + 1;
        rules.set(key, r);
      }
  }
  const list = [...rules.values()].sort((a, b) => b.n - a.n);
  fs.mkdirSync(path.dirname(path.join(ROOT, OUT)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, OUT), JSON.stringify({ features: Object.fromEntries(featureCount), rules: list }));

  // Report: per role, the feature parts used most, and for the top ones what holds them, by side.
  const name = (id) => PARTS[id]?.name ?? id;
  console.log(`${links} feature–neighbour links, ${list.length} distinct rules, ${featureCount.size} feature parts`);
  for (const role of FEATURES) {
    const parts = [...featureCount].filter(([, e]) => e.role === role).sort((a, b) => b[1].n - a[1].n);
    const total = parts.reduce((s, [, e]) => s + e.n, 0);
    console.log(`\n== ${role}: ${total} uses, ${parts.length} parts; most used: ${parts.slice(0, 4).map(([id, e]) => `${name(id)} ×${e.n}`).join(", ")}`);
    for (const [id, e] of parts.slice(0, 2)) {
      const mine = list.filter((r) => r.feature === id);
      const bySide = {};
      for (const r of mine) (bySide[r.side] ??= []).push(r);
      console.log(`  ${name(id)} (×${e.n}, in ${Object.keys(e.sets).length} sets)`);
      for (const [s, rs] of Object.entries(bySide)) {
        const n = rs.reduce((t, r) => t + r.n, 0);
        const byPart = {};
        for (const r of rs) byPart[r.neighbour] = (byPart[r.neighbour] ?? 0) + r.n;
        console.log(`    ${s.padEnd(6)} ${String(n).padStart(4)}: ${Object.entries(byPart).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([p, k]) => `${name(p)} ${Math.round((100 * k) / n)}%`).join(" · ")}`);
      }
    }
  }
} finally {
  await vite.close();
}
