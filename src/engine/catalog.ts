import { installCatalog, type PartDef } from "./parts";
import { installColors, type LegoColor } from "./colors";

/** One row of public/catalog.json (see scripts/build-catalog.mjs). */
interface CatalogEntry {
  id: string;
  n: string; // LDraw description, e.g. "Brick 2 x 4"
  c: string; // category
  w: number;
  d: number;
  h: number;
  s: [number, number][];
  o: [number, number, number];
  a?: 1;
  pr?: 1;
  x?: string[];
  t?: string;
  ss?: number;
}

/** "Brick 2 x 4" → "2×4"; anything else keeps its full name. */
function shortLabel(name: string, category: string) {
  const rest = name.startsWith(category + " ") ? name.slice(category.length + 1) : name;
  return rest.replace(/\s*x\s*/g, "×");
}

/**
 * Switch to the LDraw catalog if one has been built (npm run catalog).
 * Returns false and keeps the built-in parts otherwise.
 */
export async function loadCatalog(): Promise<boolean> {
  try {
    const res = await fetch("/catalog.json");
    if (!res.ok) return false;
    const { parts: rows, moved, colors }: { parts: CatalogEntry[]; moved: Record<string, string>; colors: LegoColor[] } =
      await res.json();
    installColors(colors);
    installCatalog(
      rows.map(
        (r): PartDef => ({
          id: r.id,
          name: r.n.replace(/ x /g, "×"),
          label: shortLabel(r.n, r.c),
          category: r.c,
          w: r.w,
          d: r.d,
          h: r.h,
          shape: { type: "ldraw" },
          studs: r.s,
          origin: r.o,
          approx: r.a === 1,
          printed: r.pr === 1,
          components: r.x,
          tags: r.t ? r.t.split(",") : undefined,
          side: r.ss,
        }),
      ),
      moved,
    );
    return true;
  } catch {
    return false;
  }
}
