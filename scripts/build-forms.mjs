// Learns the sculptor's vocabulary (src/engine/sculpt.ts) per tier: every way
// LEGO's designers place a structural part (orientation and offset within a
// stud × plate unit), counted, from the designs of that tier and the tiers it
// draws on, plus each part's upright grid turns. A Junior build only knows
// what Junior and Creator designers do; a Master build knows everything but
// Technic; Technic knows Technic. Written to public/forms/<tier>.json.
//
//   node scripts/build-forms.mjs      (after the catalog, the corpus and npm run shapes)

import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";

const ROOT = path.resolve(import.meta.dirname, "..");
globalThis.fetch = async (u) => {
  const p = path.join(ROOT, "public", String(u));
  return { ok: fs.existsSync(p), headers: { get: () => "application/json" }, json: async () => JSON.parse(fs.readFileSync(p, "utf8")) };
};
// Which designs each tier learns from.
const DRAWS = {
  junior: ["junior", "creator"],
  creator: ["junior", "creator", "advanced"],
  advanced: ["creator", "advanced", "expert"],
  expert: ["advanced", "expert", "master"],
  master: ["advanced", "expert", "master"],
  technic: ["technic"],
};

const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
try {
  const load = (m) => vite.ssrLoadModule(m);
  await (await load("/src/engine/catalog.ts")).loadCatalog();
  const { installShapes } = await load("/src/engine/shape.ts");
  const { learnForms, learnMotifs, gridForms, isStructure, isTechnicStructure, packForms } = await load("/src/engine/sculpt.ts");
  const { connections } = await load("/src/engine/connect.ts");
  const { importLDraw } = await load("/src/engine/ldrawImport.ts");
  const { PARTS } = await load("/src/engine/parts.ts");
  const shapes = JSON.parse(fs.readFileSync(path.join(ROOT, "public/shapes.json"), "utf8"));
  installShapes(shapes);
  const index = JSON.parse(fs.readFileSync(path.join(ROOT, "public/corpus/index.json"), "utf8")).models;
  const bricks = new Map(index.map((m) => [m.id, importLDraw(fs.readFileSync(path.join(ROOT, "public/corpus", `${m.id}.mpd`), "latin1"), m.id).bricks]));
  const links = new Map([...bricks].map(([id, b]) => [id, connections(b)]));
  fs.mkdirSync(path.join(ROOT, "public/forms"), { recursive: true });
  for (const [tier, from] of Object.entries(DRAWS)) {
    const structure = tier === "technic" ? isTechnicStructure : isStructure;
    const keep = (id) => shapes[id] && structure(id) && !PARTS[id].printed && PARTS[id].w <= 10 && PARTS[id].d <= 10 && PARTS[id].h <= 12;
    const chosen = index.filter((m) => from.includes(m.tier));
    const models = chosen.map((m) => bricks.get(m.id));
    let learned = learnForms(models, keep).filter((f) => f.use >= 3);
    // Junior builds stay upright: no SNOT, no half-stud tricks.
    if (tier === "junior") learned = learned.filter((f) => f.rot !== undefined);
    const parts = [...new Set(learned.map((f) => f.partId))]; // tiles too: a smooth top is a form
    // Techniques: pairs of parts designers lock together (tile on plate, bracket and its sideways tile).
    let motifs = learnMotifs(models, chosen.map((m) => links.get(m.id)), keep, 6);
    if (tier === "junior") motifs = motifs.filter((f) => f.base && Math.abs(f.base[5] - 1) < 1e-3);
    const forms = [...learned, ...parts.flatMap((id) => gridForms(id, 0)), ...motifs];
    fs.writeFileSync(path.join(ROOT, "public/forms", `${tier}.json`), JSON.stringify(packForms(forms)));
    console.log(`${tier.padEnd(9)} ${String(models.length).padStart(4)} designs → ${forms.length} forms (${motifs.length} techniques) over ${parts.length} parts`);
  }
} finally {
  await vite.close();
}
