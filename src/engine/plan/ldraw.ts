import { apX, compose, type Library, type Vec3, type Xf } from "./library";

// An LDraw model flattened for planning: every part with its world pose (LDU,
// LDraw axes: −y up), the chain of sub-models it sits in, and the official step it
// goes on in (STEP lines, counted the way a booklet walks the model: a sub-model
// built in its own steps where it is first used).

export interface Node {
  i: number;
  id: string; // part file, lower case, no ".dat"
  color: number;
  xf: Xf;
  /** Sub-model chain from the main model down, with an instance number: "chassis#1/wheel#3". */
  path: string;
  step: number;
}

export interface Flat {
  nodes: Node[];
  /** Part references the library couldn't load (parts embedded in the file, missing parts). */
  unknown: Record<string, number>;
  /** Flexible segments left out (hoses, cables): routed by hand once the rigid build is done. */
  flex: Record<string, number>;
}

const embedded = (lines: string[]) => lines.some((l) => /^\s*0\s+!LDRAW_ORG\s+.*(Part|Subpart|Primitive|Shortcut)/i.test(l) || /^\s*[2-5]\s/.test(l));

export function flatten(text: string, lib: Library): Flat {
  const files = new Map<string, string[]>();
  let cur: string[] | null = null, main = "";
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*0\s+FILE\s+(.+?)\s*$/i);
    if (m) {
      const name = m[1].toLowerCase();
      cur = [];
      files.set(name, cur);
      if (!main) main = name;
      continue;
    }
    if (/^\s*0\s+NOFILE/i.test(line)) {
      cur = null;
      continue;
    }
    if (!main) {
      main = "<main>";
      cur = [];
      files.set(main, cur);
    }
    cur?.push(line);
  }
  const nodes: Node[] = [];
  const unknown: Record<string, number> = {};
  const flex: Record<string, number> = {};
  const count = new Map<string, number>();
  const built = new Set<string>();
  let step = 0;
  const walk = (name: string, X: Xf, color: number, path: string, depth: number, replay: boolean) => {
    if (depth > 20) return;
    for (const line of files.get(name) ?? []) {
      const t = line.trim().split(/\s+/);
      if (t[0] === "0" && /^(STEP|ROTSTEP)$/i.test(t[1] ?? "")) {
        if (!replay) step++;
        continue;
      }
      if (t[0] !== "1" || t.length < 15) continue;
      const c = t[1] === "16" ? color : Number(t[1]);
      const [x, y, z, a, b, cc, d, e, f, g, h, i] = t.slice(2, 14).map(Number);
      const ref = t.slice(14).join(" ").toLowerCase().replace(/\\/g, "/");
      const W = compose(X, { R: [a, b, cc, d, e, f, g, h, i], t: [x, y, z] });
      // A part embedded in the file (its own geometry, or an LDraw.org part header) isn't a sub-model.
      if (files.has(ref) && embedded(files.get(ref)!)) {
        unknown[ref] = (unknown[ref] ?? 0) + 1;
        continue;
      }
      if (files.has(ref)) {
        const k = (count.get(ref) ?? 0) + 1;
        count.set(ref, k);
        const again = built.has(ref);
        built.add(ref);
        walk(ref, W, c, path ? `${path}/${ref}#${k}` : `${ref}#${k}`, depth + 1, replay || again);
        continue;
      }
      const info = lib.part(ref);
      if (!info) {
        unknown[ref] = (unknown[ref] ?? 0) + 1;
        continue;
      }
      if (info.flex) {
        flex[info.id] = (flex[info.id] ?? 0) + 1;
        continue;
      }
      nodes.push({ i: nodes.length, id: info.id, color: c, xf: W, path, step });
    }
  };
  walk(main, { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] }, 7, "", 0, false);
  return { nodes, unknown, flex };
}

/** World corners of a part's box. */
export function corners(lib: Library, n: Node): Vec3[] {
  const [lo, hi] = lib.part(n.id)!.box;
  const out: Vec3[] = [];
  for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) out.push(apX(n.xf, [x, y, z]));
  return out;
}
