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
  k?: [number, number, number, number][];
  g?: [number, number, number];
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
export interface CatalogData {
  parts: CatalogEntry[];
  moved: Record<string, string>;
  colors: LegoColor[];
}

let data: Promise<CatalogData | null> | null = null;
/** The catalog file, fetched once per page (workers get it from the page instead of fetching again). */
export function catalogData(): Promise<CatalogData | null> {
  data ??= fetch("/catalog.json")
    .then((r) => (r.ok ? (r.json() as Promise<CatalogData>) : null))
    .catch(() => null);
  return data;
}

export async function loadCatalog(given?: CatalogData): Promise<boolean> {
  try {
    const got = given ?? (await catalogData());
    if (!got) return false;
    const { parts: rows, moved, colors } = got;
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
          connectors: r.k,
          geo: r.g,
        }),
      ),
      moved,
    );
    return true;
  } catch {
    return false;
  }
}
