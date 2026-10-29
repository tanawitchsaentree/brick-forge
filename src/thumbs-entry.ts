// Headless entry point for scripts/build-thumbs.mjs: renders parts in white so
// the app can tint them to any colour with CSS (mask + multiply).
import { loadCatalog } from "./engine/catalog";
import { PARTS } from "./engine/parts";
import { loadTemplate, parseTemplate, resetLDraw } from "./scene/ldraw";
import { packTemplate } from "./scene/pack";
import * as learn from "./engine/learn/cookbook";
import { plainIds } from "./engine/assembly/pool";
import { renderModelImage, renderModelImageLDraw, renderPartImage } from "./scene/thumbnails";
import { KINDS, SPECIES, generateBuild } from "./engine/assembly";
import { analyzeStability } from "./engine/stability";
import { toLDraw } from "./engine/ldraw";
import { planInstructions } from "./engine/instructions";
import { importLDraw } from "./engine/ldrawImport";
import { loadDesign } from "./scene/corpus";

declare global {
  interface Window {
    thumbsReady: Promise<boolean>;
    renderThumbs: (ids: string[]) => Promise<Record<string, string | null>>;
    renderBuildPreviews: () => Promise<Record<string, string>>;
    /** The engine on this page's module graph, for scripts that inspect designs. */
    lb: Record<string, unknown>;
    packIds: () => string[];
    packParts: (ids: string[]) => Promise<Record<string, unknown>>;
  }
}

/** Parts for the geometry pack: everything the generators place, and every plain brick/plate/tile. */
window.packIds = () => {
  const ids = new Set<string>(plainIds());
  for (const k of KINDS) for (const size of [0, 1, 2]) for (const level of [0, 1, 2] as const) for (let seed = 1; seed <= 6; seed++) {
    if (k.id === "dino") continue;
    generateBuild(k.id, { size, level, seed, mode: "any", inv: {} }).bricks.forEach((b) => ids.add(b.partId));
  }
  for (const sp of SPECIES) for (const size of [0, 1, 2]) for (const level of [0, 1, 2] as const)
    generateBuild("dino", { size, level, seed: 1, mode: "any", inv: {}, species: sp.id }).bricks.forEach((b) => ids.add(b.partId));
  return [...ids].filter((id) => PARTS[id]?.shape.type === "ldraw");
};
window.packParts = async (ids) => {
  const out: Record<string, unknown> = {};
  for (const id of ids) {
    try {
      out[id] = packTemplate(await parseTemplate(PARTS[id]));
    } catch {
      // left to LDrawLoader at run time
    }
  }
  return out;
};

window.lb = { importLDraw, learn, loadTemplate, PARTS, generateBuild, SPECIES, analyzeStability, renderModelImage, renderModelImageLDraw, toLDraw, planInstructions };

window.thumbsReady = loadCatalog();
/** The picker's previews: one design per kind, as on the "What do you want to build?" screen. */
/** The real design each "What do you want to build?" card shows (from the corpus). */
const PREVIEW: Record<string, string> = { racer: "8123-1-2", car: "75870-1", house: "31009-1-310091", dino: "7219-1", robot: "4917-1-49171", rocket: "31066-1-shuttle" };

window.renderBuildPreviews = async () => {
  const out: Record<string, string> = {};
  for (const k of KINDS) out[k.id] = await renderModelImageLDraw(await loadDesign(PREVIEW[k.id]), 360);
  return out;
};

let sinceReset = 0;
window.renderThumbs = async (ids) => {
  // Templates and the loader's parse cache grow with every part; start fresh regularly.
  if ((sinceReset += ids.length) > 300) {
    resetLDraw();
    sinceReset = ids.length;
  }
  const out: Record<string, string | null> = {};
  await Promise.all(
    ids.map(async (id) => {
      const part = PARTS[id];
      try {
        out[id] = part ? renderPartImage(part, "#ffffff", await loadTemplate(part), "image/webp") : null;
      } catch {
        out[id] = null;
      }
    }),
  );
  return out;
};
