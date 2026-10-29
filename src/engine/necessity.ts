import type { PlacedBrick } from "./grid";
import { connections } from "./connect";
import { partCells, studCells, vkey, type Voxels } from "./shape";

// Is every part needed? A part earns its place by at least one of:
//   • shape: target cells only it fills (remove it and the shape has a hole);
//   • structure: it's an articulation point of the connection graph (remove
//     it and the model falls into pieces) — found with Tarjan's algorithm,
//     one depth-first search keeping each part's discovery time and the
//     lowest time reachable from below it (low[v] ≥ disc[u] ⇒ u holds v's side);
//   • finish: it covers a stud that would otherwise show on a smooth surface.
// Parts with none of these are taken out, one at a time, re-checking as we go.

/** Articulation points of an undirected graph (Tarjan, iterative). */
export function articulationPoints(n: number, edges: [number, number][]): Set<number> {
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const [a, b] of edges) {
    adj[a].push(b);
    adj[b].push(a);
  }
  const disc = new Array(n).fill(-1), low = new Array(n).fill(0), parent = new Array(n).fill(-1);
  const cut = new Set<number>();
  let time = 0;
  for (let root = 0; root < n; root++) {
    if (disc[root] >= 0) continue;
    let rootKids = 0;
    const stack: [number, number][] = [[root, 0]];
    disc[root] = low[root] = time++;
    while (stack.length) {
      const top = stack[stack.length - 1];
      const [u, i] = top;
      if (i < adj[u].length) {
        top[1]++;
        const v = adj[u][i];
        if (disc[v] < 0) {
          parent[v] = u;
          if (u === root) rootKids++;
          disc[v] = low[v] = time++;
          stack.push([v, 0]);
        } else if (v !== parent[u]) low[u] = Math.min(low[u], disc[v]);
      } else {
        stack.pop();
        const p = parent[u];
        if (p >= 0) {
          low[p] = Math.min(low[p], low[u]);
          if (p !== root && low[u] >= disc[p]) cut.add(p);
        }
      }
    }
    if (rootKids > 1) cut.add(root);
  }
  return cut;
}

export interface Necessity {
  kept: PlacedBrick[];
  removed: PlacedBrick[];
}

/** Remove parts that add no shape, hold nothing together and hide no stud. */
export function prune(bricks: PlacedBrick[], target: Voxels): Necessity {
  let list = [...bricks];
  const removed: PlacedBrick[] = [];
  for (let pass = 0; pass < 4; pass++) {
    const fills = new Map<number, number>(); // cell → how many parts fill it
    const cellsOf = list.map((b) => {
      const c: number[] = [];
      partCells(b, (x, y, z) => c.push(vkey(x, y, z)));
      for (const k of c) fills.set(k, (fills.get(k) ?? 0) + 1);
      return c;
    });
    // Studs other parts put into each part (a part covering a stud hides it).
    const studAt = new Set<number>();
    for (const b of list) for (const k of studCells(b)) if (!target.studs?.has(k)) studAt.add(k);
    const cut = articulationPoints(list.length, connections(list).map((l) => [l.a, l.b]));
    const out = list.filter((b, i) => {
      if (b.why?.role === "kept" || b.why?.role === "made") return false; // the designer's or made to measure: always kept
      if (cut.has(i)) return false;
      const own = cellsOf[i].filter((k) => fills.get(k) === 1 && target.cells.has(k)).length;
      if (own > 0) return false;
      if (cellsOf[i].some((k) => studAt.has(k))) return false;
      return true;
    });
    if (!out.length) break;
    removed.push(...out);
    const gone = new Set(out);
    list = list.filter((b) => !gone.has(b));
  }
  // Each part left says what it's needed for.
  return { kept: list, removed };
}
