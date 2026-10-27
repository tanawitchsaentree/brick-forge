// Turning outside things into build targets: photos into mosaics, 3D models
// into voxels. Both end as a Grid of colour roles the solver can build.

import * as THREE from "three";
import { colorOf } from "./colors";
import { deltaE, hexToLab, type Lab } from "./generate/math";
import type { Grid } from "./generate";

interface PaletteEntry {
  code: number;
  lab: Lab;
}

const paletteOf = (codes: number[]): PaletteEntry[] => codes.map((code) => ({ code, lab: hexToLab(colorOf(code).hex) }));

function nearest(p: PaletteEntry[], lab: Lab) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < p.length; i++) {
    const d = deltaE(p[i].lab, lab);
    if (d < bd) [best, bd] = [i, d];
  }
  return best;
}

const rgbToLab = (r: number, g: number, b: number) =>
  hexToLab(`#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`);

/** Map palette indices to compact roles: roles are only the colours actually used. */
function compact(indices: Int16Array, p: PaletteEntry[]) {
  const roleOf = new Map<number, number>();
  const role = new Int8Array(indices.length).fill(-1);
  indices.forEach((ix, i) => {
    if (ix < 0) return;
    let r = roleOf.get(ix);
    if (r === undefined) roleOf.set(ix, (r = roleOf.size));
    role[i] = r;
  });
  const roleColors: number[] = [];
  for (const [ix, r] of roleOf) roleColors[r] = p[ix].code;
  return { role, roleColors };
}

// --------------------------------------------------------------------- photo

/**
 * A flat mosaic from an image. Colours are matched in CIELAB, and with
 * `dither` the rounding error is spread to neighbours (Floyd–Steinberg:
 * 7/16 right, 3/16 down-left, 5/16 down, 1/16 down-right), scanning in a
 * serpentine so the error doesn't streak in one direction.
 */
export async function imageToGrid(file: Blob, size: number, palette: number[], dither: boolean) {
  const bmp = await createImageBitmap(file);
  const aspect = bmp.width / bmp.height;
  const W = aspect >= 1 ? size : Math.max(1, Math.round(size * aspect));
  const D = aspect >= 1 ? Math.max(1, Math.round(size / aspect)) : size;
  const canvas = new OffscreenCanvas(W, D);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, W, D);
  const px = ctx.getImageData(0, 0, W, D).data;

  const p = paletteOf(palette);
  const lab = new Float32Array(W * D * 3);
  for (let i = 0; i < W * D; i++) lab.set(rgbToLab(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]), i * 3);
  const out = new Int16Array(W * D);

  for (let z = 0; z < D; z++) {
    const rtl = z % 2 === 1;
    for (let xx = 0; xx < W; xx++) {
      const x = rtl ? W - 1 - xx : xx;
      const i = z * W + x;
      if (px[i * 4 + 3] < 128) {
        out[i] = -1; // transparent pixels stay open
        continue;
      }
      const cur: Lab = [lab[i * 3], lab[i * 3 + 1], lab[i * 3 + 2]];
      const k = nearest(p, cur);
      out[i] = k;
      if (!dither) continue;
      const err = [0, 1, 2].map((c) => cur[c] - p[k].lab[c]);
      const dx = rtl ? -1 : 1;
      const spread = (sx: number, sz: number, f: number) => {
        if (sx < 0 || sx >= W || sz >= D) return;
        const j = (sz * W + sx) * 3;
        for (let c = 0; c < 3; c++) lab[j + c] += err[c] * f;
      };
      spread(x + dx, z, 7 / 16);
      spread(x - dx, z + 1, 3 / 16);
      spread(x, z + 1, 5 / 16);
      spread(x + dx, z + 1, 1 / 16);
    }
  }

  const { role, roleColors } = compact(out, p);
  const grid: Grid = { W, D, L: 1, lh: 1, role };
  return { grid, roleColors };
}

// --------------------------------------------------------------------- model

interface Tri {
  a: THREE.Vector3;
  b: THREE.Vector3;
  c: THREE.Vector3;
  color: THREE.Color;
}

async function loadTriangles(file: File): Promise<Tri[]> {
  const name = file.name.toLowerCase();
  let root: THREE.Object3D;
  if (name.endsWith(".glb") || name.endsWith(".gltf")) {
    const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
    root = (await new GLTFLoader().parseAsync(await file.arrayBuffer(), "")).scene;
  } else if (name.endsWith(".stl")) {
    const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js");
    const geo = new STLLoader().parse(await file.arrayBuffer());
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: "#a0a5a9" }));
    mesh.rotation.x = -Math.PI / 2; // STL files are usually Z-up
    root = new THREE.Group().add(mesh);
  } else if (name.endsWith(".obj")) {
    const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js");
    root = new OBJLoader().parse(await file.text());
  } else {
    throw new Error("Use a .glb, .gltf (single file), .stl or .obj model");
  }
  root.updateMatrixWorld(true);

  // Textures are sampled once per triangle at its centroid's UV.
  const texData = new Map<THREE.Texture, ImageData | null>();
  const sampleTexture = (tex: THREE.Texture, u: number, v: number): THREE.Color | null => {
    let data = texData.get(tex);
    if (data === undefined) {
      const img = tex.image as CanvasImageSource & { width: number; height: number };
      data = null;
      if (img?.width) {
        const c = new OffscreenCanvas(Math.min(img.width, 512), Math.min(img.height, 512));
        const g = c.getContext("2d")!;
        g.drawImage(img, 0, 0, c.width, c.height);
        data = g.getImageData(0, 0, c.width, c.height);
      }
      texData.set(tex, data);
    }
    if (!data) return null;
    const x = Math.floor(((u % 1) + 1) % 1 * data.width);
    const y = Math.floor((1 - (((v % 1) + 1) % 1)) * data.height);
    const i = (Math.min(y, data.height - 1) * data.width + Math.min(x, data.width - 1)) * 4;
    return new THREE.Color().setRGB(data.data[i] / 255, data.data[i + 1] / 255, data.data[i + 2] / 255, THREE.SRGBColorSpace);
  };

  const tris: Tri[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geo = mesh.geometry as THREE.BufferGeometry;
    const pos = geo.getAttribute("position");
    const col = geo.getAttribute("color");
    const uv = geo.getAttribute("uv");
    const index = geo.getIndex();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const groups = geo.groups.length ? geo.groups : [{ start: 0, count: index ? index.count : pos.count, materialIndex: 0 }];
    const v = (i: number) => new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    for (const g of groups) {
      const mat = mats[g.materialIndex ?? 0] as THREE.MeshStandardMaterial;
      for (let t = g.start; t + 2 < g.start + g.count; t += 3) {
        const [i0, i1, i2] = [t, t + 1, t + 2].map((k) => (index ? index.getX(k) : k));
        let color = mat?.color?.clone() ?? new THREE.Color("#a0a5a9");
        if (col) color = new THREE.Color(col.getX(i0), col.getY(i0), col.getZ(i0));
        else if (mat?.map && uv) {
          const u = (uv.getX(i0) + uv.getX(i1) + uv.getX(i2)) / 3;
          const w = (uv.getY(i0) + uv.getY(i1) + uv.getY(i2)) / 3;
          const s = sampleTexture(mat.map, u, w);
          if (s) color = s.multiply(mat.color ?? new THREE.Color(1, 1, 1));
        }
        tris.push({ a: v(i0), b: v(i1), c: v(i2), color });
      }
    }
  });
  if (!tris.length) throw new Error("No triangles found in that file");
  return tris;
}

/**
 * Voxelise a 3D model to the stud grid:
 *  1. scale so its widest side spans `width` studs (layers keep true height: a brick is 1.2 studs tall);
 *  2. mark every cell a triangle passes through, by sampling points on each triangle
 *     at under half a cell apart, averaging their colours;
 *  3. flood-fill the outside from the grid's border; whatever the flood can't reach is inside;
 *  4. colour the inside from the nearest surface cell (multi-source BFS), or keep
 *     only a shell `hollow` cells thick to save parts.
 */
export async function modelToGrid(file: File, width: number, lh: 1 | 3, palette: number[], hollow: boolean) {
  const tris = await loadTriangles(file);
  const box = new THREE.Box3();
  for (const t of tris) box.expandByPoint(t.a).expandByPoint(t.b).expandByPoint(t.c);
  const size = box.getSize(new THREE.Vector3());
  const s = width / Math.max(size.x, size.z, 1e-6); // studs per model unit
  const layerH = lh * 0.4; // studs per layer
  const W = Math.min(32, Math.max(1, Math.ceil(size.x * s)));
  const D = Math.min(32, Math.max(1, Math.ceil(size.z * s)));
  const L = Math.min(Math.floor(120 / lh), Math.max(1, Math.ceil((size.y * s) / layerH)));
  const N = W * D;
  const toGrid = (p: THREE.Vector3) => [(p.x - box.min.x) * s, ((p.y - box.min.y) * s) / layerH, (p.z - box.min.z) * s];

  const rgb = new Float32Array(N * L * 3);
  const hits = new Uint16Array(N * L);
  const cellOf = (x: number, y: number, z: number) => {
    const xi = Math.min(W - 1, Math.max(0, Math.floor(x)));
    const yi = Math.min(L - 1, Math.max(0, Math.floor(y)));
    const zi = Math.min(D - 1, Math.max(0, Math.floor(z)));
    return yi * N + zi * W + xi;
  };
  for (const t of tris) {
    const [a, b, c] = [t.a, t.b, t.c].map(toGrid);
    const edge = Math.max(...[[a, b], [b, c], [c, a]].map(([p, q]) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])));
    const n = Math.min(200, Math.ceil(edge * 2.5) + 1);
    for (let i = 0; i <= n; i++)
      for (let j = 0; j <= n - i; j++) {
        const u = i / n, v = j / n, w = 1 - u - v;
        const k = cellOf(a[0] * w + b[0] * u + c[0] * v, a[1] * w + b[1] * u + c[1] * v, a[2] * w + b[2] * u + c[2] * v);
        hits[k]++;
        rgb[k * 3] += t.color.r; rgb[k * 3 + 1] += t.color.g; rgb[k * 3 + 2] += t.color.b;
      }
  }

  // Flood the outside (6-connected) starting from every empty border cell.
  const outside = new Uint8Array(N * L);
  const queue: number[] = [];
  const push = (k: number) => {
    if (!outside[k] && !hits[k]) {
      outside[k] = 1;
      queue.push(k);
    }
  };
  for (let y = 0; y < L; y++)
    for (let z = 0; z < D; z++)
      for (let x = 0; x < W; x++) if (x === 0 || z === 0 || x === W - 1 || z === D - 1 || y === L - 1) push(y * N + z * W + x);
  for (let qi = 0; qi < queue.length; qi++) {
    const k = queue[qi];
    const y = Math.floor(k / N), z = Math.floor((k % N) / W), x = k % W;
    if (x > 0) push(k - 1);
    if (x < W - 1) push(k + 1);
    if (z > 0) push(k - W);
    if (z < D - 1) push(k + W);
    if (y > 0) push(k - N);
    if (y < L - 1) push(k + N);
  }

  // Inside cells take the colour of the nearest surface cell; distance from the surface allows hollowing.
  const p = paletteOf(palette);
  const out = new Int16Array(N * L).fill(-1);
  const dist = new Int16Array(N * L).fill(-1);
  const front: number[] = [];
  for (let k = 0; k < N * L; k++)
    if (hits[k]) {
      const h = hits[k];
      // Linear RGB average → sRGB → nearest LEGO colour.
      const c = new THREE.Color(rgb[k * 3] / h, rgb[k * 3 + 1] / h, rgb[k * 3 + 2] / h);
      out[k] = nearest(p, hexToLab(`#${c.getHexString(THREE.SRGBColorSpace)}`));
      dist[k] = 0;
      front.push(k);
    }
  for (let qi = 0; qi < front.length; qi++) {
    const k = front[qi];
    const y = Math.floor(k / N), z = Math.floor((k % N) / W), x = k % W;
    for (const [nk, ok] of [[k - 1, x > 0], [k + 1, x < W - 1], [k - W, z > 0], [k + W, z < D - 1], [k - N, y > 0], [k + N, y < L - 1]] as [number, boolean][]) {
      if (!ok || outside[nk] || dist[nk] >= 0) continue;
      dist[nk] = dist[k] + 1;
      out[nk] = out[k];
      front.push(nk);
    }
  }
  if (hollow) for (let k = 0; k < N * L; k++) if (dist[k] > 1 && Math.floor(k / N) > 0) out[k] = -1;

  const { role, roleColors } = compact(out, p);
  const grid: Grid = { W, D, L, lh, role };
  return { grid, roleColors, triangles: tris.length, sizeMM: [W * 8, D * 8, L * lh * 3.2] as [number, number, number] };
}
