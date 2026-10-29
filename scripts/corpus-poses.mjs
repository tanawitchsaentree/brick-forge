// Corpus statistics for scoping Phase 2 and Phase 5 (docs/engine/phase2.md, phase5.md):
//
//   • what keep() leaves out, per level, by part count and by volume (cells), for
//     each reason: not structure, printed, larger than 8 × 8 × 9, no shape;
//   • per model, the share of parts that need a local frame (tilted, or upright but
//     turned by a non-quarter angle): bench/results/local-frame.json;
//   • the angles those parts sit at: the tilt of the part's nearest axis from the
//     vertical, and the yaw (mod 90°) of upright ones, to the nearest 0.5°.
//
// Every non-Technic corpus model, bench models included (this measures the corpus,
// it learns nothing).
//
//   node scripts/corpus-poses.mjs

import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";

const ROOT = path.resolve(import.meta.dirname, "..");
globalThis.fetch = async (u) => {
  const p = path.join(ROOT, "public", String(u));
  return { ok: fs.existsSync(p), headers: { get: () => "application/json" }, json: async () => JSON.parse(fs.readFileSync(p, "utf8")) };
};
const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
try {
  const load = (m) => vite.ssrLoadModule(m);
  await (await load("/src/engine/catalog.ts")).loadCatalog();
  const S = await load("/src/engine/shape.ts");
  const { isStructure } = await load("/src/engine/sculpt.ts");
  const { importLDraw, toGrid } = await load("/src/engine/ldrawImport.ts");
  const { PARTS } = await load("/src/engine/parts.ts");
  const shapes = JSON.parse(fs.readFileSync(path.join(ROOT, "public/shapes.json"), "utf8"));
  S.installShapes(shapes);
  const corpus = JSON.parse(fs.readFileSync(path.join(ROOT, "public/corpus/index.json"), "utf8")).models.filter((m) => m.tier !== "technic");

  const reason = (id) => {
    const p = PARTS[id];
    if (!p || !shapes[id]) return "noShape";
    if (!isStructure(id)) return "notStructure";
    if (p.printed) return "printed";
    if (p.w > 8 || p.d > 8 || p.h > 9) return "oversize";
    return "kept";
  };
  const cellsOf = (b) => {
    let n = 0;
    if (PARTS[b.partId] && shapes[b.partId]) S.partCells(b, () => n++);
    return n;
  };
  const DEG = 180 / Math.PI;
  const frameOf = (b) => {
    const m = b.place;
    if (!m || toGrid(b)) return null;
    const upright = Math.abs(m[5] - 1) < 1e-3 && Math.abs(m[1]) < 1e-3 && Math.abs(m[9]) < 1e-3;
    const axisAligned = [0, 1, 2, 4, 5, 6, 8, 9, 10].every((i) => Math.abs(Math.abs(m[i]) - Math.round(Math.abs(m[i]))) < 1e-3);
    if (upright) {
      const yaw = ((Math.atan2(m[2], m[0]) * DEG) % 90 + 90) % 90;
      return Math.min(yaw, 90 - yaw) < 0.05 ? null : { kind: "yaw", angle: Math.round(yaw * 2) / 2 };
    }
    if (axisAligned) return null;
    // Tilt: the angle of the part's axis nearest to vertical, from the vertical (0–54.7°).
    const ys = [Math.abs(m[1]), Math.abs(m[5]), Math.abs(m[9])]; // world-y component of each part axis
    const tilt = Math.acos(Math.min(1, Math.max(...ys))) * DEG;
    return { kind: "tilt", angle: Math.round(tilt * 2) / 2 };
  };

  const policy = {}; // tier → reason → { parts, cells }
  const perModel = [];
  const angles = { tilt: new Map(), yaw: new Map() };
  for (const m of corpus) {
    const bricks = importLDraw(fs.readFileSync(path.join(ROOT, "public/corpus", `${m.id}.mpd`), "latin1"), m.id).bricks;
    const P = (policy[m.tier] ??= {});
    let local = 0;
    for (const b of bricks) {
      const r = reason(b.partId);
      const e = (P[r] ??= { parts: 0, cells: 0 });
      e.parts++;
      e.cells += cellsOf(b);
      const f = frameOf(b);
      if (f) {
        local++;
        angles[f.kind].set(f.angle, (angles[f.kind].get(f.angle) ?? 0) + 1);
      }
    }
    perModel.push({ id: m.id, tier: m.tier, parts: bricks.length, localFrame: +(local / Math.max(1, bricks.length)).toFixed(4) });
  }

  const share = {};
  for (const [tier, R] of Object.entries(policy)) {
    const parts = Object.values(R).reduce((s, e) => s + e.parts, 0), cells = Object.values(R).reduce((s, e) => s + e.cells, 0);
    share[tier] = Object.fromEntries(Object.entries(R).map(([r, e]) => [r, { parts: +((100 * e.parts) / parts).toFixed(2), volume: +((100 * e.cells) / Math.max(1, cells)).toFixed(2) }]));
  }
  const top = (map, n) => {
    const tot = [...map.values()].reduce((s, v) => s + v, 0);
    return { total: tot, top: [...map].sort((a, b) => b[1] - a[1]).slice(0, n).map(([a, v]) => ({ deg: a, n: v, pct: +((100 * v) / tot).toFixed(2) })) };
  };
  const out = { keepByTier: share, angles: { tilt: top(angles.tilt, 15), yaw: top(angles.yaw, 10) }, perModel };
  fs.mkdirSync(path.join(ROOT, "bench/results"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "bench/results/local-frame.json"), JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ keepByTier: share, angles: out.angles }, null, 1));
  const lf = perModel.map((x) => x.localFrame).sort((a, b) => a - b);
  console.log(`local frame per model: median ${lf[lf.length >> 1]}, < 10 %: ${perModel.filter((x) => x.localFrame < 0.1).length} of ${perModel.length}`);
} finally {
  await vite.close();
}
