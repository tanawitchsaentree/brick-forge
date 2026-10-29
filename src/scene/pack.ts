import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// A geometry pack: LDraw parts parsed once (scripts/build-pack.mjs): the most
// used in one core shard, the rest a small file each, so a model's parts
// arrive in a few requests instead of fetching and parsing dozens of .dat
// files each. Positions are 16-bit, normals 8-bit, vertices
// shared; each mesh keeps its LDraw colour code so main-colour faces can still
// be repainted. Parts not in the pack load through LDrawLoader as before.


interface Chunk {
  c: string; // LDraw colour code (16 = the part's own colour)
  h: string; // colour as parsed (for fixed colours: a printed eye, a black tyre)
  o: number; // opacity
  p: string; // positions, Uint16 quantized to the part's box
  n?: string; // normals, Int8 (meshes)
  i?: string; // indices (meshes)
  w?: 1; // indices are 32-bit
}

export interface PackEntry {
  b: [number, number, number, number, number, number]; // box min, size
  m: Chunk[];
  l: Chunk[];
}

const b64 = (a: ArrayBufferView) => {
  const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string) => {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
};

/** Serialise a loaded template (part-local frame) into a pack entry. */
export function packTemplate(root: THREE.Object3D): PackEntry {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const pieces: { geo: THREE.BufferGeometry; mat: THREE.Material; line: boolean }[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.geometry || !(mesh.isMesh || (o as THREE.LineSegments).isLineSegments)) return;
    const local = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const groups = mesh.geometry.groups.length ? mesh.geometry.groups : [{ start: 0, count: Infinity, materialIndex: 0 }];
    const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
    for (const g of groups) {
      const pos = src.getAttribute("position");
      const end = Math.min(pos.count, g.start + g.count);
      const geo = new THREE.BufferGeometry();
      for (const name of mesh.isMesh ? ["position", "normal"] : ["position"]) {
        const a = src.getAttribute(name);
        if (!a) continue;
        geo.setAttribute(name, new THREE.BufferAttribute(new Float32Array((a.array as Float32Array).slice(g.start * 3, end * 3)), 3));
      }
      geo.applyMatrix4(local);
      pieces.push({ geo, mat: mats[g.materialIndex ?? 0], line: !mesh.isMesh });
    }
  });
  const box = new THREE.Box3();
  for (const p of pieces) {
    p.geo.computeBoundingBox();
    box.union(p.geo.boundingBox!);
  }
  const min = box.min, size = box.getSize(new THREE.Vector3()).max(new THREE.Vector3(1e-6, 1e-6, 1e-6));
  const quant = (a: THREE.BufferAttribute) => {
    const out = new Uint16Array(a.count * 3);
    for (let i = 0; i < a.count; i++) {
      out[i * 3] = Math.round(((a.getX(i) - min.x) / size.x) * 65535);
      out[i * 3 + 1] = Math.round(((a.getY(i) - min.y) / size.y) * 65535);
      out[i * 3 + 2] = Math.round(((a.getZ(i) - min.z) / size.z) * 65535);
    }
    return out;
  };
  const chunk = (p: (typeof pieces)[number]): Chunk => {
    const m = p.mat as THREE.Material & { color?: THREE.Color };
    const head = { c: String(m.userData?.code ?? "16"), h: m.color ? m.color.getHexString() : "000000", o: m.opacity ?? 1 };
    if (p.line) return { ...head, p: b64(quant(p.geo.getAttribute("position") as THREE.BufferAttribute)) };
    const g = mergeVertices(p.geo, 1e-4);
    const n = g.getAttribute("normal") as THREE.BufferAttribute;
    const nq = new Int8Array(n.count * 3);
    for (let i = 0; i < n.count * 3; i++) nq[i] = Math.round((n.array as Float32Array)[i] * 127);
    const idx = g.index!.array;
    const wide = g.getAttribute("position").count > 65535;
    return {
      ...head,
      p: b64(quant(g.getAttribute("position") as THREE.BufferAttribute)),
      n: b64(nq),
      i: b64(wide ? new Uint32Array(idx) : new Uint16Array(idx)),
      ...(wide ? { w: 1 as const } : {}),
    };
  };
  return {
    b: [min.x, min.y, min.z, size.x, size.y, size.z],
    m: pieces.filter((p) => !p.line).map(chunk),
    l: pieces.filter((p) => p.line).map(chunk),
  };
}

/** The pack's index (scripts/build-pack.mjs): 0 = in the core shard, 1 = a file of its own. */
interface PackIndex {
  core: string;
  part: Record<string, 0 | 1>;
}
let index: Promise<PackIndex | null> | null = null;
let core: Promise<Record<string, PackEntry>> | null = null;
const singles = new Map<string, Promise<PackEntry | null>>();

const fetchJson = <T,>(url: string): Promise<T | null> =>
  fetch(url)
    .then((r) => (r.ok && r.headers.get("content-type")?.includes("json") ? (r.json() as Promise<T>) : null))
    .catch(() => null);

/** A part's pack entry: from the core shard (fetched once) or its own file (null if not packed). */
export async function packEntry(id: string): Promise<PackEntry | null> {
  index ??= fetchJson<PackIndex>("/ldraw-pack/index.json");
  const ix = await index;
  const where = ix?.part[id];
  if (where === undefined) return null;
  if (where === 0) {
    core ??= fetchJson<Record<string, PackEntry>>(`/ldraw-pack/${ix!.core}`).then((o) => o ?? {});
    return (await core)[id] ?? null;
  }
  let s = singles.get(id);
  if (!s) {
    s = fetchJson<PackEntry>(`/ldraw-pack/p/${encodeURIComponent(id)}.json`);
    singles.set(id, s);
  }
  return s;
}

const materials = new Map<string, THREE.Material>();
function material(c: Chunk, line: boolean) {
  const key = `${line}:${c.c}:${c.h}:${c.o}`;
  let m = materials.get(key);
  if (!m) {
    m = line
      ? new THREE.LineBasicMaterial({ color: `#${c.h}` })
      : new THREE.MeshStandardMaterial({ color: `#${c.h}`, roughness: 0.3, transparent: c.o < 1, opacity: c.o });
    m.userData.code = c.c;
    materials.set(key, m);
  }
  return m;
}

/** A template (same frame and colour codes as LDrawLoader's) from a pack entry. */
export function fromPack(e: PackEntry): THREE.Group {
  const [mx, my, mz, sx, sy, sz] = e.b;
  const positions = (s: string) => {
    const q = new Uint16Array(unb64(s));
    const out = new Float32Array(q.length);
    for (let i = 0; i < q.length; i += 3) {
      out[i] = mx + (q[i] / 65535) * sx;
      out[i + 1] = my + (q[i + 1] / 65535) * sy;
      out[i + 2] = mz + (q[i + 2] / 65535) * sz;
    }
    return new THREE.BufferAttribute(out, 3);
  };
  const root = new THREE.Group();
  for (const c of e.m) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", positions(c.p));
    g.setAttribute("normal", new THREE.BufferAttribute(new Int8Array(unb64(c.n!)), 3, true));
    g.setIndex(new THREE.BufferAttribute(c.w ? new Uint32Array(unb64(c.i!)) : new Uint16Array(unb64(c.i!)), 1));
    root.add(new THREE.Mesh(g, material(c, false)));
  }
  for (const c of e.l) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", positions(c.p));
    root.add(new THREE.LineSegments(g, material(c, true)));
  }
  return root;
}
