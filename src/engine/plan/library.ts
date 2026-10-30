// Part geometry and connectors for assembly planning (docs/engine/assembly-planning.md),
// in LDraw units (LDU: a stud is 20, a plate 8, a brick 24; −y is up).
//
// Connectors come from the LDraw primitives by default (primitiveSnaps, below: the LDraw
// library's own licence, shippable). Optionally from LDCad's shadow library (github.com/RolandMelkert/LDCadShadowLibrary,
// CC BY-SA 4.0, local use only — the user's decision): SNAP_CYL lines give studs, anti-studs, pins, holes, axles and bars with
// their gender, cross-section and axis; SNAP_CLP clips, SNAP_FGR hinge fingers, SNAP_GEN
// ball joints. A part inherits the connectors of every file it references (stud.dat,
// connhole.dat, a subpart), moved by that reference's matrix, unless its own shadow
// entry starts with SNAP_CLEAR. Files are read through `read`, so this runs in Node
// (scripts) or anywhere a reader is given.

export type Vec3 = [number, number, number];
/** Row-major 3×3 rotation and a translation: p' = R·p + t. */
export interface Xf { R: number[]; t: Vec3 }

export type Shape = "R" | "A" | "S"; // round, axle (cross), square (a stud receptor)
export interface Snap {
  kind: "cyl" | "clip" | "finger" | "ball";
  gender: "M" | "F";
  /** Main section: its shape and radius (the longest section), and the total length. */
  shape: Shape;
  radius: number;
  length: number;
  /** Closed ends ("one": the far end, as LDCad), for the insertion sense. */
  caps: "none" | "one" | "two";
  /** Axis start, and the unit axis (the snap's local −y: from `pos` toward the far end). */
  pos: Vec3;
  axis: Vec3;
  center: boolean;
  group?: string;
  /** How a scaled reference stretches it (LDCad `scale`): axle.dat is one LDU, stretched to length. */
  scale?: "none" | "YOnly" | "ROnly" | "full";
}

/** Flexible parts drawn as segments (hoses, cables, strings): routed by hand at the end, not planned. */
const FLEX = /^~.*(Segment|Hose|Cable|String|Strap|Tube|Belt)/i;

export interface PartInfo {
  id: string;
  name: string;
  flex: boolean;
  box: [Vec3, Vec3]; // local min, max
  snaps: Snap[];
}

const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const SHRINK = 0.75; // LDU
export const mulR = (a: number[], b: number[]) => {
  const o = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return o;
};
export const apR = (R: number[], p: Vec3): Vec3 => [R[0] * p[0] + R[1] * p[1] + R[2] * p[2], R[3] * p[0] + R[4] * p[1] + R[5] * p[2], R[6] * p[0] + R[7] * p[1] + R[8] * p[2]];
export const apX = (x: Xf, p: Vec3): Vec3 => {
  const q = apR(x.R, p);
  return [q[0] + x.t[0], q[1] + x.t[1], q[2] + x.t[2]];
};
export const compose = (a: Xf, b: Xf): Xf => ({ R: mulR(a.R, b.R), t: apX(a, b.t) });
const norm = (v: Vec3): Vec3 => {
  const n = Math.hypot(...v) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
};

/** Bracketed LDCad meta parameters: "[gender=M] [secs=R 6 4]" → { gender: "M", secs: "R 6 4" }. */
function params(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of line.matchAll(/\[(\w+)=([^\]]*)\]/g)) out[m[1].toLowerCase()] = m[2].trim();
  return out;
}

/** Grid offsets: "C 4 C 2 20 20" → 8 offsets, centred where marked C. */
function gridOffsets(g: string | undefined): Vec3[] {
  if (!g) return [[0, 0, 0]];
  const t = g.split(/\s+/);
  let i = 0;
  const cx = t[i] === "C" ? (i++, true) : false;
  const nx = +t[i++];
  const cz = t[i] === "C" ? (i++, true) : false;
  const nz = +t[i++];
  const sx = +t[i++], sz = +t[i++];
  const out: Vec3[] = [];
  for (let a = 0; a < nx; a++) for (let b = 0; b < nz; b++) out.push([(a - (cx ? (nx - 1) / 2 : 0)) * sx, 0, (b - (cz ? (nz - 1) / 2 : 0)) * sz]);
  return out;
}

const transformSnap = (s: Snap, x: Xf): Snap => {
  const v = apR(x.R, s.axis), k = Math.hypot(...v);
  const stretch = s.scale === "YOnly" || s.scale === "full";
  return { ...s, pos: apX(x, s.pos), axis: norm(v), length: stretch ? s.length * k : s.length };
};

/** A part's triangles (flat x0 y0 z0 x1 … per triangle, part-local) for the narrow-phase collision test. */
export interface Mesh { tris: Float32Array; verts: Float32Array }

export interface Library {
  part(id: string): PartInfo | null;
  mesh(id: string): Mesh | null;
  /** Is `name` a part file in the library (not a sub-model)? */
  isPart(name: string): boolean;
}

/**
 * A library over an LDraw folder and a shadow-library folder, through `read(path)`
 * (null when missing). `ldraw` and `shadow` are folder prefixes.
 */
/**
 * `shadow`: a folder with LDCad's shadow library (CC BY-SA 4.0: local use only), or null to read
 * connectors from the LDraw primitives alone (see `primitiveSnaps`): the LDraw library's own
 * licence, nothing else, so it can ship.
 */
export function makeLibrary(read: (path: string) => string | null, ldraw: string, shadow: string | null): Library {
  const norm1 = (n: string) => n.trim().toLowerCase().replace(/\\/g, "/");
  const fileCache = new Map<string, string | null>();
  const ldFile = (n: string) => {
    n = norm1(n);
    if (fileCache.has(n)) return fileCache.get(n)!;
    let text: string | null = null;
    for (const d of ["parts/", "p/", "parts/s/", "p/48/", "p/8/"]) if ((text = read(`${ldraw}/${d}${n}`)) !== null) break;
    fileCache.set(n, text);
    return text;
  };
  const shadowFile = (n: string) => {
    n = norm1(n);
    for (const d of ["parts/", "p/"]) {
      const t = read(`${shadow}/${d}${n}`);
      if (t !== null) return t;
    }
    return null;
  };

  /** Own snaps of a file from its shadow entry, and whether it clears inherited ones. */
  const ownCache = new Map<string, { snaps: Snap[]; clear: boolean }>();
  const own = (n: string, depth = 0): { snaps: Snap[]; clear: boolean } => {
    n = norm1(n);
    const hit = ownCache.get(n);
    if (hit) return hit;
    const res = { snaps: [] as Snap[], clear: false };
    ownCache.set(n, res);
    if (shadow === null) {
      res.snaps = primitiveSnaps(n);
      return res;
    }
    const text = depth < 8 ? shadowFile(n) : null;
    if (text)
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^\s*0\s+!LDCAD\s+(SNAP_\w+)(.*)$/);
        if (!m) continue;
        const kind = m[1], p = params(m[2]);
        if (kind === "SNAP_CLEAR") {
          res.clear = true;
          continue;
        }
        const pos: Vec3 = p.pos ? (p.pos.split(/\s+/).map(Number) as Vec3) : [0, 0, 0];
        const R = p.ori ? p.ori.split(/\s+/).map(Number) : I3;
        const base: Xf = { R, t: pos };
        const grid = gridOffsets(p.grid);
        const place = (s: Snap) => {
          for (const g of grid) res.snaps.push(transformSnap(s, compose({ R: I3, t: g }, base)));
        };
        if (kind === "SNAP_INCL") {
          for (const s of snapsOf(p.ref ?? "", depth + 1)) place(s);
          continue;
        }
        const s = snapOf(kind, p);
        if (s) place(s);
      }
    return res;
  };

  // Snaps in a file's own frame: its shadow entry plus (unless cleared) its references'.
  const allCache = new Map<string, Snap[]>();
  const inherited = (n: string, depth: number): Snap[] => {
    const text = ldFile(n);
    if (!text || depth > 12) return [];
    const out: Snap[] = [];
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim().split(/\s+/);
      if (t[0] !== "1" || t.length < 15) continue;
      const [x, y, z, a, b, c, d, e, f, g, h, i] = t.slice(2, 14).map(Number);
      const xf: Xf = { R: [a, b, c, d, e, f, g, h, i], t: [x, y, z] };
      for (const s of snapsOf(t.slice(14).join(" "), depth + 1)) out.push(transformSnap(s, xf));
    }
    return out;
  };
  const snapsOf = (n: string, depth = 0): Snap[] => {
    n = norm1(n);
    const hit = allCache.get(n);
    if (hit) return hit;
    allCache.set(n, []); // cycles
    const o = own(n, depth);
    const res = o.clear ? o.snaps : o.snaps.concat(inherited(n, depth));
    allCache.set(n, res);
    return res;
  };

  const boxCache = new Map<string, [Vec3, Vec3] | null>();
  const boxOf = (n: string, depth = 0): [Vec3, Vec3] | null => {
    n = norm1(n);
    if (boxCache.has(n)) return boxCache.get(n)!;
    boxCache.set(n, null);
    const text = ldFile(n);
    if (!text || depth > 12) return null;
    const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
    const add = (p: Vec3) => {
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], p[k]);
        hi[k] = Math.max(hi[k], p[k]);
      }
    };
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim().split(/\s+/);
      if (t[0] === "1" && t.length >= 15) {
        const [x, y, z, a, b, c, d, e, f, g, h, i] = t.slice(2, 14).map(Number);
        const sub = boxOf(t.slice(14).join(" "), depth + 1);
        if (!sub) continue;
        const xf: Xf = { R: [a, b, c, d, e, f, g, h, i], t: [x, y, z] };
        for (const cx of [sub[0][0], sub[1][0]]) for (const cy of [sub[0][1], sub[1][1]]) for (const cz of [sub[0][2], sub[1][2]]) add(apX(xf, [cx, cy, cz]));
      } else if (t[0] === "3" || t[0] === "4") for (let k = 2; k + 2 < t.length; k += 3) add([+t[k], +t[k + 1], +t[k + 2]]);
    }
    const box: [Vec3, Vec3] | null = lo[0] <= hi[0] ? [lo, hi] : null;
    boxCache.set(n, box);
    return box;
  };

  // Triangles of a file in its own frame (quads split), with their references'.
  const triCache = new Map<string, number[]>();
  const trisOf = (n: string, depth = 0): number[] => {
    n = norm1(n);
    const hit = triCache.get(n);
    if (hit) return hit;
    triCache.set(n, []);
    const text = ldFile(n);
    const out: number[] = [];
    if (text && depth <= 12)
      for (const line of text.split(/\r?\n/)) {
        const t = line.trim().split(/\s+/);
        if (t[0] === "1" && t.length >= 15) {
          const [x, y, z, a, b, c, d, e, f, g, h, i] = t.slice(2, 14).map(Number);
          const sub = trisOf(t.slice(14).join(" "), depth + 1);
          for (let k = 0; k < sub.length; k += 3) {
            const px = sub[k], py = sub[k + 1], pz = sub[k + 2];
            out.push(a * px + b * py + c * pz + x, d * px + e * py + f * pz + y, g * px + h * py + i * pz + z);
          }
        } else if (t[0] === "3" && t.length >= 11) out.push(...t.slice(2, 11).map(Number));
        else if (t[0] === "4" && t.length >= 14) {
          const v = t.slice(2, 14).map(Number);
          out.push(...v.slice(0, 9), ...v.slice(0, 3), ...v.slice(6, 12));
        }
      }
    triCache.set(n, out);
    return out;
  };
  const meshCache = new Map<string, Mesh | null>();
  const partCache = new Map<string, PartInfo | null>();
  return {
    mesh(id) {
      const n = norm1(id.endsWith(".dat") ? id : `${id}.dat`);
      if (meshCache.has(n)) return meshCache.get(n)!;
      const t = trisOf(n);
      // Sample vertices: distinct triangle corners, thinned to a few hundred.
      const seen = new Set<string>(), v: number[] = [];
      for (let k = 0; k < t.length; k += 3) {
        const key = `${Math.round(t[k])},${Math.round(t[k + 1])},${Math.round(t[k + 2])}`;
        if (!seen.has(key)) seen.add(key), v.push(t[k], t[k + 1], t[k + 2]);
      }
      const nv = v.length / 3, keep = Math.min(nv, 400), stride = nv / keep;
      // Pulled in by SHRINK on each axis toward the box centre: a pin's rim (radius 6) then passes a
      // hole's rim (radius 6) instead of grazing it, and faces that touch don't count as blocking.
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let k = 0; k < v.length; k += 3) for (let a = 0; a < 3; a++) (lo[a] = Math.min(lo[a], v[k + a])), (hi[a] = Math.max(hi[a], v[k + a]));
      const verts = new Float32Array(keep * 3);
      for (let q = 0; q < keep; q++)
        for (let a = 0; a < 3; a++) {
          const x = v[Math.floor(q * stride) * 3 + a], c = (lo[a] + hi[a]) / 2;
          verts[q * 3 + a] = x - Math.sign(x - c) * Math.min(SHRINK, Math.abs(x - c));
        }
      const m = t.length ? { tris: new Float32Array(t), verts } : null;
      meshCache.set(n, m);
      return m;
    },
    isPart: (name) => {
      const t = ldFile(name);
      return t !== null && read(`${ldraw}/parts/${norm1(name)}`) !== null;
    },
    part(id) {
      const n = norm1(id.endsWith(".dat") ? id : `${id}.dat`);
      if (partCache.has(n)) return partCache.get(n)!;
      // Only files in parts/ are parts (not primitives in p/, not subparts in parts/s/).
      const text = n.startsWith("s/") ? null : read(`${ldraw}/parts/${n}`);
      const box = text ? boxOf(n) : null;
      let name = text ? (text.split(/\r?\n/)[0] ?? "").replace(/^0\s*/, "").trim() : "";
      const moved = name.match(/^~Moved to\s+(\S+)/i);
      if (moved) name = this.part(moved[1])?.name ?? name; // a stub: the name of what it moved to
      const snaps = text && box ? (shadow === null ? partSnapsFromPrimitives(snapsOf(n), box, name) : snapsOf(n)) : [];
      const info = text && box ? { id: n.replace(/\.dat$/, ""), name, box, snaps, flex: FLEX.test(name) } : null;
      partCache.set(n, info);
      return info;
    },
  };
}

function snapOf(kind: string, p: Record<string, string>): Snap | null {
  const axis: Vec3 = [0, -1, 0];
  if (kind === "SNAP_CYL") {
    const t = (p.secs ?? "").split(/\s+/).filter(Boolean);
    let best = { shape: "R" as Shape, radius: 0, len: -1 }, length = 0;
    for (let i = 0; i + 2 < t.length + 1; i += 3) {
      const sh = t[i].replace(/_/g, ""), r = +t[i + 1], len = +t[i + 2];
      if (!Number.isFinite(len)) continue;
      length += len;
      const shape: Shape = sh === "A" ? "A" : sh === "S" ? "S" : "R";
      if (len > best.len) best = { shape, radius: r, len };
    }
    const caps = p.caps === "one" ? "one" : p.caps === "two" ? "two" : "none";
    const scale = (["YOnly", "ROnly", "full"].includes(p.scale) ? p.scale : "none") as Snap["scale"];
    return { kind: "cyl", gender: p.gender === "F" ? "F" : "M", shape: best.shape, radius: best.radius, length, caps, pos: [0, 0, 0], axis, center: p.center === "true", group: p.group, scale };
  }
  if (kind === "SNAP_CLP") return { kind: "clip", gender: "F", shape: "R", radius: +(p.radius ?? 4), length: +(p.length ?? 8), caps: "none", pos: [0, 0, 0], axis, center: p.center === "true", group: p.group };
  if (kind === "SNAP_FGR") {
    const seq = (p.seq ?? "").split(/\s+/).map(Number).filter(Number.isFinite);
    return { kind: "finger", gender: p.genderofs === "F" ? "F" : "M", shape: "R", radius: +(p.radius ?? 4), length: seq.reduce((s, v) => s + v, 0), caps: "none", pos: [0, 0, 0], axis, center: p.center === "true", group: p.group };
  }
  if (kind === "SNAP_GEN") {
    const r = +((p.bounding ?? "").match(/sph\s+([\d.]+)/)?.[1] ?? NaN);
    if (!Number.isFinite(r)) return null; // only ball joints (spherical bounds) are modelled
    return { kind: "ball", gender: p.gender === "F" ? "F" : "M", shape: "R", radius: r, length: 0, caps: "none", pos: [0, 0, 0], axis, center: true, group: p.group };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Connectors from the LDraw primitives alone (no shadow library). LDraw builds parts from
// standard primitives whose geometry is fixed by the library's spec: a stud is a cylinder r 6
// from y 0 to −4; a Technic pin half (connect*, confric*) r 6 over 20; pin holes (peghole*,
// beamhole*, connhole*, npeghol*) r 6; the axle cross section (axle, axlehol*, axl*hol*) is one
// LDU along y, stretched by its reference. Which way a cross-section is (an axle or an axle hole)
// isn't in the primitive: a part with axle ends (axleend*, axl*end) is an axle. Studs are
// received under a part's footprint, on the stud grid (a brick's underside), for System parts.

const AXLE_END = "axle-end"; // a marker, resolved per part
const primCache = new Map<string, Snap[]>();
function primitiveSnaps(n: string): Snap[] {
  const hit = primCache.get(n);
  if (hit) return hit;
  const f = n.replace(/^.*\//, "");
  const ax: Vec3 = [0, -1, 0];
  const cyl = (gender: "M" | "F", shape: Shape, radius: number, length: number, pos: Vec3, caps: Snap["caps"] = "none", scale: Snap["scale"] = "none"): Snap => ({ kind: "cyl", gender, shape, radius, length, caps, pos, axis: ax, center: false, scale });
  let out: Snap[] = [];
  if (/^(stud|stud2|studa|stud2a|stud-logo\d*|stud2-logo\d*|stud6a?|stud10|stud15|studel|studp01)\.dat$/.test(f)) out = [cyl("M", "R", 6, 4, [0, 0, 0], "one")];
  else if (/^(connect\d*|confric\d*)\.dat$/.test(f)) out = [cyl("M", "R", 6, 20, [0, 0, 0])];
  else if (/^(peghole\d*)\.dat$/.test(f)) out = [cyl("F", "R", 6, 2, [0, 2, 0])];
  else if (/^(beamhol\w*|connhol\w*)\.dat$/.test(f)) out = [cyl("F", "R", 6, 20, [0, 10, 0])];
  else if (/^npeghol\w*\.dat$/.test(f)) out = [cyl("F", "R", 6, 1, [0, 1, 0])];
  else if (/^(axle|axlehol\d*|axleho\d+|axl\dhol\w*|axl\dho\d+|axlehole|axl\dhole)\.dat$/.test(f)) out = [{ ...cyl("M", "A", 6, 1, [0, 1, 0], "none", "YOnly"), group: "axle?" }];
  else if (/^(axleend\w*|axl\dend)\.dat$/.test(f)) out = [{ ...cyl("M", "A", 6, 0, [0, 0, 0]), group: AXLE_END }];
  primCache.set(n, out);
  return out;
}

const SYSTEM = /^(Brick|Plate|Tile|Slope|Wedge|Technic Brick|Technic Plate|Bracket|Panel|Hinge|Door|Window|Cone|Dish|Arch|Round|Cylinder|Car|Vehicle|Train|Boat|Baseplate|Support|Fence|Bar|Turntable|Container|Box|Roof)/i;

/** A part's connectors from its inherited primitive snaps: axles told from holes, segments merged, undersides added. */
function partSnapsFromPrimitives(raw: Snap[], box: [Vec3, Vec3], name: string): Snap[] {
  const isAxle = raw.some((s) => s.group === AXLE_END);
  const snaps = raw.filter((s) => s.group !== AXLE_END && s.length > 0).map((s) => (s.group === "axle?" ? { ...s, gender: (isAxle ? "M" : "F") as Snap["gender"], group: undefined } : s));
  // Merge coaxial segments of one kind: an axle drawn in pieces, a hole drawn as two rims.
  const out: Snap[] = [];
  const used = new Set<number>();
  snaps.forEach((s, k) => {
    if (used.has(k)) return;
    if (s.shape === "R" && s.gender === "M" && s.length <= 4) return void out.push(s); // studs stay single
    let lo = 0, hi = s.length; // along s.axis from s.pos
    const proj = (p: Vec3) => (p[0] - s.pos[0]) * s.axis[0] + (p[1] - s.pos[1]) * s.axis[1] + (p[2] - s.pos[2]) * s.axis[2];
    const off = (p: Vec3) => {
      const t = proj(p);
      return Math.hypot(p[0] - s.pos[0] - s.axis[0] * t, p[1] - s.pos[1] - s.axis[1] * t, p[2] - s.pos[2] - s.axis[2] * t);
    };
    for (let changed = true; changed; ) {
      changed = false;
      snaps.forEach((q, j) => {
        if (j === k || used.has(j) || q.gender !== s.gender || q.shape !== s.shape || Math.abs(q.radius - s.radius) > 0.5) return;
        if (Math.abs(q.axis[0] * s.axis[0] + q.axis[1] * s.axis[1] + q.axis[2] * s.axis[2]) < 0.99 || off(q.pos) > 0.5) return;
        const a = proj(q.pos), b = a + (q.axis[0] * s.axis[0] + q.axis[1] * s.axis[1] + q.axis[2] * s.axis[2]) * q.length;
        const [qa, qb] = a < b ? [a, b] : [b, a];
        const gap = s.gender === "F" && s.shape === "R" ? 22 : 1;
        if (qa > hi + gap || qb < lo - gap) return;
        lo = Math.min(lo, qa), hi = Math.max(hi, qb), used.add(j), (changed = true);
      });
    }
    used.add(k);
    out.push({ ...s, pos: [s.pos[0] + s.axis[0] * lo, s.pos[1] + s.axis[1] * lo, s.pos[2] + s.axis[2] * lo], length: hi - lo });
  });
  // The underside: anti-studs on the stud grid over the footprint (System parts with a flat bottom).
  if (SYSTEM.test(name.replace(/^~/, ""))) {
    const [lo, hi] = box;
    const nx = Math.round((hi[0] - lo[0]) / 20), nz = Math.round((hi[2] - lo[2]) / 20);
    if (nx >= 1 && nz >= 1 && nx * nz <= 256) {
      const x0 = (lo[0] + hi[0]) / 2 - ((nx - 1) * 20) / 2, z0 = (lo[2] + hi[2]) / 2 - ((nz - 1) * 20) / 2;
      for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) out.push({ kind: "cyl", gender: "F", shape: "S", radius: 6, length: 4, caps: "one", pos: [x0 + i * 20, hi[1], z0 + k * 20], axis: [0, -1, 0], center: false });
    }
  }
  return out;
}
