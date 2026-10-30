import type { Edge } from "./graph";
import type { Blocking } from "./blocking";

// Layer B: sub-assemblies for a model (or a sub-model) too big to plan part by part and
// without sub-models of its own. Communities of the joint graph (Louvain, Blondel et al.
// 2008: move each part to the neighbouring group that most raises modularity, then merge
// groups and repeat), weighted by how strongly parts hold (studs count, an axle more
// than a pin, a resting contact little). A community is kept as a sub-assembly only if
//   (a) it is one connected piece,
//   (b) it has 20–150 parts (smaller ones dissolve back; bigger ones are split again), and
//   (c) all its joints to the rest let it come off along one shared direction.
// The rest stay loose parts of their scope.

const STRENGTH: Record<string, number> = { stud: 1, pin: 2, axle: 3, axleFree: 1.5, bar: 1, hinge: 1, ball: 1, fit: 1, contact: 0.3, gear: 0 };

export function louvain(parts: number[], edges: Edge[]): number[][] {
  const idx = new Map(parts.map((p, k) => [p, k]));
  const n = parts.length;
  let adj: Map<number, number>[] = parts.map(() => new Map());
  for (const e of edges) {
    const a = idx.get(e.a), b = idx.get(e.b);
    if (a === undefined || b === undefined || a === b) continue;
    const w = (STRENGTH[e.type] ?? 1) * (e.type === "stud" ? e.n : 1);
    if (!w) continue;
    adj[a].set(b, (adj[a].get(b) ?? 0) + w);
    adj[b].set(a, (adj[b].get(a) ?? 0) + w);
  }
  let members: number[][] = parts.map((_, k) => [k]);
  for (let level = 0; level < 10; level++) {
    const m = adj.length;
    const deg = adj.map((a) => [...a.values()].reduce((s, v) => s + v, 0));
    const total = deg.reduce((s, v) => s + v, 0) / 2 || 1;
    const comm = Array.from({ length: m }, (_, k) => k);
    const ctot = [...deg];
    let moved = true, rounds = 0;
    while (moved && rounds++ < 20) {
      moved = false;
      for (let v = 0; v < m; v++) {
        const links = new Map<number, number>();
        for (const [u, w] of adj[v]) if (u !== v) links.set(comm[u], (links.get(comm[u]) ?? 0) + w);
        const own = comm[v];
        ctot[own] -= deg[v];
        let best = own, gain = (links.get(own) ?? 0) - (ctot[own] * deg[v]) / (2 * total);
        for (const [c, w] of links) {
          const g = w - (ctot[c] * deg[v]) / (2 * total);
          if (g > gain + 1e-12) (gain = g), (best = c);
        }
        ctot[best] += deg[v];
        if (best !== own) (comm[v] = best), (moved = true);
      }
    }
    const ids = [...new Set(comm)];
    if (ids.length === m) break;
    const remap = new Map(ids.map((c, k) => [c, k]));
    const nextMembers: number[][] = ids.map(() => []);
    const nextAdj: Map<number, number>[] = ids.map(() => new Map());
    for (let v = 0; v < m; v++) {
      const c = remap.get(comm[v])!;
      nextMembers[c].push(...members[v]);
      for (const [u, w] of adj[v]) {
        const d = remap.get(comm[u])!;
        if (d !== c) nextAdj[c].set(d, (nextAdj[c].get(d) ?? 0) + w);
      }
    }
    members = nextMembers;
    adj = nextAdj;
  }
  void n;
  return members.map((g) => g.map((k) => parts[k]));
}

/** Sub-assemblies for `parts`: Louvain communities that pass the checks (a)–(c). */
export function subassemblies(parts: number[], edges: Edge[], blk: Blocking, min = 20, max = 150): number[][] {
  const out: number[][] = [];
  const inside = new Set(parts);
  const byPart = new Map<number, Edge[]>();
  for (const e of edges) {
    if (e.type === "gear" || !inside.has(e.a) || !inside.has(e.b)) continue;
    (byPart.get(e.a) ?? byPart.set(e.a, []).get(e.a)!).push(e);
    (byPart.get(e.b) ?? byPart.set(e.b, []).get(e.b)!).push(e);
  }
  const connected = (g: number[]) => {
    const set = new Set(g), seen = new Set([g[0]]), q = [g[0]];
    while (q.length) {
      const x = q.pop()!;
      for (const e of byPart.get(x) ?? []) {
        const y = e.a === x ? e.b : e.a;
        if (set.has(y) && !seen.has(y)) seen.add(y), q.push(y);
      }
    }
    return seen.size === g.length;
  };
  const removable = (g: number[]) => {
    const set = new Set(g);
    const crossing = g.flatMap((p) => (byPart.get(p) ?? []).filter((e) => !set.has(e.a === p ? e.b : e.a)).map((e) => ({ e, p })));
    const dirs = g.flatMap((p) => blk.dirs[p]);
    return dirs.some((d) => crossing.every(({ e, p }) => blk.permits(e, p, d)));
  };
  const visit = (g: number[], depth: number) => {
    if (g.length < min) return;
    if (g.length > max && depth < 4) {
      const sub = louvain(g, edges);
      if (sub.length > 1) return sub.forEach((s) => visit(s, depth + 1));
    }
    if (g.length <= max * 1.5 && connected(g) && removable(g)) out.push(g);
  };
  for (const g of louvain(parts, edges)) visit(g, 0);
  return out;
}
