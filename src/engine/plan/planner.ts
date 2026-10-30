import type { Vec3 } from "./library";
import type { Node } from "./ldraw";
import type { Edge } from "./graph";
import type { Blocking } from "./blocking";
import { subassemblies } from "./decompose";

// Layer C, search: the assembly sequence by disassembly. From the finished model, take
// off one unit at a time — a unit is a part, or a sub-assembly built on its own — when
//   (1) every joint it still has with the rest lets it leave along some direction d,
//   (2) nothing still there is in its way along d (the blocking sets), and
//   (3) what is left stays one connected piece (each partial build holds together);
// then reverse. A beam of partial plans is kept, scored by how a designer orders a
// build (bottom first, inside out, one direction for a run of steps, one area at a
// time) — weights in `PlanWeights`, learnable from official steps (Layer E). Validators
// (stability, robot reach…) plug in as extra checks every `checkEvery` removals.
//
// Sub-assemblies come from the model's own sub-models (an .mpd's FILE sections, each
// instance planned once on its own and then placed as one unit), the cheapest and most
// designer-like decomposition there is (Layer B adds clusters for flat models).

export interface PlanWeights {
  height: number; // build low parts first (take high ones off first)
  outward: number; // inner parts first
  sameDir: number; // keep the insertion direction (no reorienting)
  near: number; // stay near the last part
  leaf: number; // take off parts held by few joints first
  split?: number; // cost of a step that joins two separate pieces
  official?: number; // (diagnostic) the file's own order
}
export const DEFAULT_WEIGHTS: PlanWeights = { height: 1, outward: 0.3, sameDir: 0.6, near: 0.4, leaf: 0.2 };

export interface Validator {
  name: string;
  /** Check the build made of `present` (node indices). Return a cost (Infinity rejects). */
  check(present: number[]): number;
}

export interface PlanStep {
  unit: number[]; // node indices put on in this step
  dir: Vec3; // insertion direction (the reverse of how it came off)
  scope: string; // the sub-model being built ("" for the main model)
  forced?: string; // a constraint that had to be relaxed to go on
  /** It joins two pieces of the build standing apart (allowed, at a cost). */
  joins?: boolean;
}
export interface Plan {
  steps: PlanStep[];
  violations: { blocked: number; disconnected: number; noDirection: number; validator: number };
  /** Sub-assemblies made from the joint graph (Layer B). */
  clusters: number;
  ms: number;
}

interface Unit {
  parts: number[];
  sub?: string; // sub-model instance it stands for
}

export function planAssembly(nodes: Node[], edges: Edge[], blk: Blocking, opts: { beam?: number; weights?: PlanWeights; validators?: Validator[]; checkEvery?: number; hierarchy?: boolean; clusters?: boolean; maxLoose?: number } = {}): Plan {
  const t0 = performance.now();
  const W = opts.weights ?? DEFAULT_WEIGHTS;
  const beamWidth = opts.beam ?? 4;
  const violations = { blocked: 0, disconnected: 0, noDirection: 0, validator: 0 };
  const adj = nodes.map(() => [] as { j: number; e: Edge }[]);
  for (const e of edges) {
    if (e.type === "gear") continue;
    adj[e.a].push({ j: e.b, e });
    adj[e.b].push({ j: e.a, e });
  }
  // Sub-model instances: "a#1/b#2" → the node indices directly in each, children instances.
  const hierarchy = opts.hierarchy ?? true;
  const scopes = new Map<string, { parts: number[]; children: Set<string> }>();
  const scopeOf = (p: string) => scopes.get(p) ?? scopes.set(p, { parts: [], children: new Set() }).get(p)!;
  scopeOf("");
  for (const n of nodes) {
    const path = hierarchy ? n.path : "";
    scopeOf(path).parts.push(n.i);
    const segs = path ? path.split("/") : [];
    for (let k = 0; k < segs.length; k++) {
      const parent = segs.slice(0, k).join("/");
      scopeOf(parent).children.add(segs.slice(0, k + 1).join("/"));
    }
  }
  // Scopes with too many loose parts get sub-assemblies from the joint graph (Layer B).
  let clustered = 0;
  if (opts.clusters ?? true)
    for (const [name, sc] of [...scopes]) {
      if (sc.parts.length <= (opts.maxLoose ?? 150)) continue;
      const groups = subassemblies(sc.parts, edges, blk);
      const taken = new Set<number>();
      groups.forEach((g, k) => {
        const child = `${name ? name + "/" : ""}~cluster${k + 1}`;
        scopes.set(child, { parts: g, children: new Set() });
        sc.children.add(child);
        g.forEach((p) => taken.add(p));
        clustered++;
      });
      sc.parts = sc.parts.filter((p) => !taken.has(p));
    }
  const allParts = new Map<string, number[]>();
  const partsUnder = (s: string): number[] => {
    let v = allParts.get(s);
    if (v) return v;
    v = [...scopeOf(s).parts];
    for (const c of scopeOf(s).children) v.push(...partsUnder(c));
    allParts.set(s, v);
    return v;
  };
  const centre = (ps: number[]): Vec3 => {
    const c: Vec3 = [0, 0, 0];
    for (const p of ps) for (let k = 0; k < 3; k++) c[k] += nodes[p].xf.t[k];
    return c.map((v) => v / Math.max(ps.length, 1)) as Vec3;
  };
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  /** Plan one scope: its loose parts and child sub-assemblies, as units. Returns steps in build order. */
  const planScope = (scope: string): PlanStep[] => {
    const units: Unit[] = [...scopeOf(scope).parts.map((p) => ({ parts: [p] })), ...[...scopeOf(scope).children].map((c) => ({ parts: partsUnder(c), sub: c }))];
    const unitOf = new Map<number, number>();
    units.forEach((u, k) => u.parts.forEach((p) => unitOf.set(p, k)));
    const inScope = (p: number) => unitOf.has(p);
    // Unit adjacency (structural joints between units of this scope).
    const uadj = units.map(() => new Map<number, Edge[]>());
    units.forEach((u, k) => {
      for (const p of u.parts)
        for (const { j, e } of adj[p]) {
          const q = unitOf.get(j);
          if (q === undefined || q === k) continue;
          (uadj[k].get(q) ?? uadj[k].set(q, []).get(q)!).push(e);
        }
    });
    const ucentre = units.map((u) => centre(u.parts));
    const all = centre(units.flatMap((u) => u.parts));
    const ys = ucentre.map((c) => c[1]);
    const ySpan = Math.max(1, Math.max(...ys) - Math.min(...ys));
    const rSpan = Math.max(1, ...ucentre.map((c) => Math.hypot(c[0] - all[0], c[2] - all[2])));
    // Directions a unit might leave along: its parts' candidate directions.
    const udirs = units.map((u) => {
      const out: Vec3[] = [];
      for (const p of u.parts) for (const d of blk.dirs[p]) if (!out.some((o) => dot(o, d) > 0.999)) out.push(d);
      return out;
    });
    const blockCache = new Map<string, number[][]>();
    /** Ways unit k can come off along its direction di, as sets of units that must be gone first. */
    const unitWays = (k: number, di: number): number[][] => {
      const key = `${k}:${di}`;
      let b = blockCache.get(key);
      if (b) return b;
      const u = units[k], d = udirs[k][di];
      let ways: number[][];
      if (u.parts.length === 1) {
        const p = u.parts[0];
        const pk = blk.dirs[p].findIndex((x) => dot(x, d) > 0.999);
        ways = pk >= 0 ? blk.ways(p, pk) : blk.groupWays(u.parts, d);
      } else ways = blk.groupWays(u.parts, d);
      b = ways.map((w) => [...new Set(w.filter(inScope).map((p) => unitOf.get(p)!))].filter((q) => q !== k));
      blockCache.set(key, b);
      return b;
    };
    const free = (k: number, di: number, present: Uint8Array) => unitWays(k, di).some((w) => w.every((q) => !present[q]));
    const blockedCount = (k: number, di: number, present: Uint8Array) => Math.min(...unitWays(k, di).map((w) => w.filter((q) => present[q]).length), 1e9);
    const permitsUnit = (k: number, d: Vec3, present: Uint8Array) => {
      for (const [q, es] of uadj[k]) {
        if (!present[q]) continue;
        for (const e of es) {
          const moving = unitOf.get(e.a) === k ? e.a : e.b;
          if (!blk.permits(e, moving, d)) return false;
        }
      }
      return true;
    };
    /** Is the rest still one piece without unit k? (Its remaining neighbours reach each other.) */
    const staysConnected = (k: number, present: Uint8Array, left: number) => {
      const nb = [...uadj[k].keys()].filter((q) => present[q]);
      if (nb.length <= 1 || left <= 2) return true;
      const want = new Set(nb.slice(1));
      const seen = new Uint8Array(units.length);
      seen[k] = 1;
      seen[nb[0]] = 1;
      const queue = [nb[0]];
      while (queue.length && want.size) {
        const x = queue.pop()!;
        for (const q of uadj[x].keys()) {
          if (!present[q] || seen[q]) continue;
          seen[q] = 1;
          want.delete(q);
          queue.push(q);
        }
      }
      return want.size === 0;
    };
    // Was the scope one piece to begin with? If not, connectivity can't be asked of it.
    const full = new Uint8Array(units.length).fill(1);
    let comps = 0;
    {
      const seen = new Uint8Array(units.length);
      for (let s = 0; s < units.length; s++) {
        if (seen[s]) continue;
        comps++;
        const q = [s];
        seen[s] = 1;
        while (q.length) {
          const x = q.pop()!;
          for (const y of uadj[x].keys()) if (!seen[y]) (seen[y] = 1), q.push(y);
        }
      }
    }
    void comps; // (a scope in several pieces still can't split a piece further)

    interface State { present: Uint8Array; left: number; seq: { k: number; d: Vec3; forced?: string; split?: boolean }[]; cost: number; last: number; lastDir: Vec3 | null }
    let beam: State[] = [{ present: full.slice(), left: units.length, seq: [], cost: 0, last: -1, lastDir: null }];
    const score = (s: State, k: number, d: Vec3) => {
      const c = ucentre[k];
      let v = 0;
      v += W.height * ((all[1] - c[1]) / ySpan); // higher (smaller y) comes off first
      v += W.outward * (Math.hypot(c[0] - all[0], c[2] - all[2]) / rSpan);
      if (s.lastDir) v += W.sameDir * (dot(s.lastDir, d) > 0.999 ? 1 : 0);
      if (s.last >= 0) v += W.near * (1 - Math.min(1, Math.hypot(...([0, 1, 2].map((q) => c[q] - ucentre[s.last][q]) as Vec3)) / (rSpan + ySpan)));
      let deg = 0;
      for (const q of uadj[k].keys()) if (s.present[q]) deg++;
      v += W.leaf * (1 / (1 + deg));
      return v;
    };
    let steps = 0;
    while (beam[0].left > 0) {
      steps++;
      const next: State[] = [];
      for (const s of beam) {
        // Candidates, best first; take the first few that pass every check.
        const cands: { k: number; d: Vec3; v: number }[] = [];
        for (let k = 0; k < units.length; k++) {
          if (!s.present[k]) continue;
          udirs[k].forEach((d, di) => {
            if (!permitsUnit(k, d, s.present)) return;
            if (!free(k, di, s.present)) return;
            cands.push({ k, d, v: score(s, k, d) });
          });
        }
        cands.sort((a, b) => b.v - a.v);
        let taken = 0;
        const used = new Set<number>();
        for (const c of cands) {
          if (taken >= beamWidth) break;
          if (used.has(c.k)) continue;
          // Splitting what's left into pieces is allowed (two halves on the table, joined by
          // the part put on next) but costs: a designer keeps the build in one piece.
          const split = !staysConnected(c.k, s.present, s.left);
          used.add(c.k);
          taken++;
          const present = s.present.slice();
          present[c.k] = 0;
          next.push({ present, left: s.left - 1, seq: [...s.seq, { k: c.k, d: c.d, split }], cost: s.cost - c.v + (split ? W.split ?? 2 : 0), last: c.k, lastDir: c.d });
        }
        if (!taken && s === beam[0] && !next.length) {
          // Stuck: relax — the least-blocked unit comes off anyway, noted.
          let best = -1, bestN = Infinity, bestD: Vec3 = [0, -1, 0], why = "";
          for (let k = 0; k < units.length; k++) {
            if (!s.present[k]) continue;
            udirs[k].forEach((d, di) => {
              const nb = blockedCount(k, di, s.present) + (permitsUnit(k, d, s.present) ? 0 : 1000);
              if (nb < bestN) (bestN = nb), (best = k), (bestD = d), (why = nb >= 1000 ? "no free direction" : nb > 0 ? `blocked by ${nb}` : "disconnects the rest");
            });
          }
          if (why.startsWith("no")) violations.noDirection++;
          else if (why.startsWith("blocked")) violations.blocked++;
          else violations.disconnected++;
          const present = s.present.slice();
          present[best] = 0;
          next.push({ present, left: s.left - 1, seq: [...s.seq, { k: best, d: bestD, forced: why }], cost: s.cost + 10, last: best, lastDir: bestD });
        }
      }
      // Validators on the partial builds every few removals.
      if (opts.validators?.length && steps % (opts.checkEvery ?? 25) === 0)
        for (const s of next) {
          const present = units.flatMap((u, k) => (s.present[k] ? u.parts : []));
          for (const v of opts.validators) s.cost += v.check(present);
        }
      next.sort((a, b) => a.cost - b.cost);
      // Distinct states only (same parts left: keep the cheaper).
      const seen = new Set<string>();
      beam = [];
      for (const s of next) {
        const key = s.seq.map((x) => x.k).sort((a, b) => a - b).join(",");
        if (seen.has(key)) continue;
        seen.add(key);
        beam.push(s);
        if (beam.length >= beamWidth) break;
      }
      if (beam.every((s) => !Number.isFinite(s.cost))) violations.validator++;
    }
    const best = beam[0];
    const out: PlanStep[] = [];
    for (const { k, d, forced, split } of [...best.seq].reverse()) {
      const u = units[k];
      const ins: Vec3 = [-d[0], -d[1], -d[2]];
      if (u.sub) out.push(...planScope(u.sub)); // build the sub-assembly first, then put it on
      out.push({ unit: u.parts, dir: ins, scope, forced, joins: split || undefined });
    }
    return out;
  };
  const steps = planScope("");
  return { steps, violations, clusters: clustered, ms: performance.now() - t0 };
}
