// Runs the generator off the main thread so the UI stays smooth while it searches.
import { generateFromGrid, generateIdeas, type ColorInfo, type Grid, type Level, type Stock } from "./solver";
import { PARTS, installCatalog, type PartDef } from "../parts";
import type { PlacedBrick } from "../grid";

export type GenerateRequest = {
  id: number;
  stock: Stock[];
  colors: ColorInfo[];
  seed: number;
  owned?: [string, number][];
  /** Definitions of the parts in `stock` (the worker has no catalog of its own). */
  parts: PartDef[];
} & (
  | { kind: "recipes"; dream?: boolean }
  | {
      kind: "grid";
      grid: Grid;
      roleColors: number[];
      meta: { recipe: string; title: string; math: string };
      decor?: Omit<PlacedBrick, "uid">[];
      level?: Level;
    }
);

self.onmessage = (e: MessageEvent<GenerateRequest>) => {
  const req = e.data;
  const started = performance.now();
  if (req.parts.some((p) => !PARTS[p.id])) installCatalog([...Object.values(PARTS), ...req.parts], {});
  const ms = () => Math.round(performance.now() - started);
  if (req.kind === "recipes") {
    const ideas = generateIdeas(req.stock, req.colors, req.seed, { dream: req.dream, owned: req.owned });
    self.postMessage({ id: req.id, ideas, ms: ms() });
  } else {
    const idea = generateFromGrid(req.grid, req.roleColors, req.stock, req.colors, req.meta, req.owned, req.decor, req.level);
    self.postMessage({ id: req.id, idea, ms: ms() });
  }
};
