import { useEffect, useState } from "react";
import * as THREE from "three";
import { PLATE_H, STUD_H, STUD_R } from "../engine/units";
import { PARTS, footprint, type PartDef } from "../engine/parts";
import type { PlacedBrick } from "../engine/grid";
import { colorOf } from "../engine/colors";
import { partMatrix } from "../engine/pose";
import { bodyGeometry, edgeGeometry } from "./geometry";
import { edgeMaterial, instantiate, loadTemplate } from "./ldraw";
import { buildMerged } from "./Merged";
/** Above this many parts a picture is drawn merged (off: measured slower, see docs/engine/phase2.md). */
const MERGE_FROM_PARTS = Infinity;

// Catalogue-style 3D thumbnails, rendered off-screen by one shared renderer
// and cached as data URLs (per part and colour).
const SIZE = 160; // px; shown at ~64 px, so this stays sharp on retina
const VIEW = new THREE.Vector3(-0.85, 0.8, 1).normalize(); // front-left, from above

const cache = new Map<string, string>();
let ctx: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.OrthographicCamera } | null = null;
const studGeo = new THREE.CylinderGeometry(STUD_R, STUD_R, STUD_H, 24);

function setup() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(SIZE, SIZE, false);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight("#ffffff", "#8a94a6", 1.2));
  const sun = new THREE.DirectionalLight("#ffffff", 1.8);
  sun.position.set(-2, 5, 3);
  scene.add(sun);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  // A fill from the viewer, as a product shot has: without it faces turned from the sun
  // (most of a side view) got only the sky and read far darker than the part's colour.
  const fill = new THREE.DirectionalLight("#ffffff", 1.2);
  fill.position.set(0, 0, 1);
  camera.add(fill);
  scene.add(camera);
  return { renderer, scene, camera };
}

/** Render one part to an image data URL (also used by scripts/build-thumbs.mjs). */
export function renderPartImage(
  part: PartDef,
  hex: string,
  template: THREE.Group | null,
  type = "image/png",
): string {
  ctx ??= setup();
  const { renderer, scene, camera } = ctx;

  const material = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.3 });
  const lineMat = new THREE.LineBasicMaterial({ color: "#000", transparent: true, opacity: 0.18 });
  let model: THREE.Group;
  if (template) {
    model = instantiate(template, material, lineMat);
  } else {
    model = new THREE.Group();
    model.add(new THREE.Mesh(bodyGeometry(part), material));
    model.add(new THREE.LineSegments(edgeGeometry(part), lineMat));
    for (const [i, k] of part.studs) {
      const stud = new THREE.Mesh(studGeo, material);
      stud.position.set(i + 0.5, part.h * PLATE_H + STUD_H / 2, k + 0.5);
      model.add(stud);
    }
  }
  const wrapper = new THREE.Group().add(model);

  // Centre the part and fit an orthographic camera around its bounding sphere.
  const box = new THREE.Box3().setFromObject(wrapper);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  wrapper.position.sub(sphere.center);
  const r = sphere.radius * 1.02;
  Object.assign(camera, { left: -r, right: r, top: r, bottom: -r });
  camera.position.copy(VIEW).multiplyScalar(r * 4);
  camera.lookAt(0, 0, 0);
  // Depth range around the model: big models (a 37-stud dinosaur) would cross a fixed far plane.
  camera.near = r * 0.5;
  camera.far = r * 8;
  camera.updateProjectionMatrix();

  scene.add(wrapper);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL(type, 0.86);
  scene.remove(wrapper);
  material.dispose();
  lineMat.dispose();
  return url;
}

// Render a few thumbnails per frame so opening a big category never freezes the UI.
const queue: (() => void)[] = [];
let scheduled = false;
function schedule(job: () => void) {
  queue.push(job);
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(function flush() {
    const start = performance.now();
    while (queue.length && performance.now() - start < 10) queue.shift()!();
    if (queue.length) requestAnimationFrame(flush);
    else scheduled = false;
  });
}

/**
 * Data URL of a 3D thumbnail for the part in the given colour; undefined while
 * loading, or until `enabled` (e.g. the tile has scrolled into view).
 */
export function useThumbnail(part: PartDef, hex: string, enabled = true): string | undefined {
  const key = `${part.id}:${hex}`;
  const [url, setUrl] = useState(() => cache.get(key));

  useEffect(() => {
    const hit = cache.get(key);
    if (hit) return setUrl(hit);
    setUrl(undefined);
    if (!enabled) return;
    let alive = true;
    const draw = (template: THREE.Group | null) =>
      schedule(() => {
        if (!alive) return;
        let u = cache.get(key);
        if (!u) {
          u = renderPartImage(part, hex, template);
          cache.set(key, u);
        }
        setUrl(u);
      });
    if (part.shape.type === "ldraw") loadTemplate(part).then(draw, () => draw(null));
    else draw(null);
    return () => {
      alive = false;
    };
  }, [key, part, hex, enabled]);

  return url;
}

// ------------------------------------------------- pre-rendered thumbnails

let prerendered = new Set<string>();

/** Load the list of thumbnails made by scripts/build-thumbs.mjs (if any). */
export async function loadThumbIndex() {
  try {
    const res = await fetch("/thumbs/index.json");
    if (res.ok) prerendered = new Set(await res.json());
  } catch {
    // none built yet: the library falls back to rendering live
  }
}

export const hasPrerendered = (id: string) => prerendered.has(id);

// ------------------------------------------------------- model previews

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const previewMats = new Map<string, THREE.MeshStandardMaterial>();

/** Render a whole model (as plain blocks; fast enough for a gallery of ideas). */
export function renderModelImage(bricks: PlacedBrick[], size = 360): string {
  ctx ??= setup();
  const { renderer, scene, camera } = ctx;
  const model = new THREE.Group();
  for (const b of bricks) {
    const part = PARTS[b.partId];
    if (!part) continue;
    const { w, d } = footprint(part, b.rot);
    const h = part.h * PLATE_H;
    const hex = colorOf(b.color).hex;
    let mat = previewMats.get(hex);
    if (!mat) previewMats.set(hex, (mat = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.35 })));
    const m = new THREE.Mesh(boxGeo, mat);
    m.scale.set(w - 0.06, h - 0.03, d - 0.06);
    m.position.set(b.x + w / 2, b.y * PLATE_H + h / 2, b.z + d / 2);
    if (b.pose || b.place) {
      m.position.set(part.w / 2, h / 2, part.d / 2);
      m.scale.set(part.w - 0.06, h - 0.03, part.d - 0.06);
      m.applyMatrix4(new THREE.Matrix4().fromArray(partMatrix(b)));
    }
    model.add(m);
  }
  const wrapper = new THREE.Group().add(model);
  const sphere = new THREE.Box3().setFromObject(wrapper).getBoundingSphere(new THREE.Sphere());
  wrapper.position.sub(sphere.center);
  const r = sphere.radius * 1.02 || 1;
  Object.assign(camera, { left: -r, right: r, top: r, bottom: -r });
  camera.position.copy(VIEW).multiplyScalar(r * 4);
  camera.lookAt(0, 0, 0);
  // Depth range around the model: big models (a 37-stud dinosaur) would cross a fixed far plane.
  camera.near = r * 0.5;
  camera.far = r * 8;
  camera.updateProjectionMatrix();
  renderer.setSize(size, size, false);
  scene.add(wrapper);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL("image/webp", 0.9);
  scene.remove(wrapper);
  renderer.setSize(SIZE, SIZE, false);
  return url;
}

/**
 * Render a model with real LDraw parts (slower than block previews, but faces
 * show: eyes are tiles on the front). Seen from front-right, so a creature
 * facing +z and a car facing +x both look at the camera.
 */
export async function renderModelImageLDraw(
  bricks: PlacedBrick[],
  size = 360,
  opts: { fresh?: Set<string>; azimuth?: number; elevation?: number } = {},
): Promise<string> {
  const parts = [...new Set(bricks.map((b) => b.partId))].filter((id) => PARTS[id]);
  const templates = new Map(
    await Promise.all(parts.map(async (id) => [id, await loadTemplate(PARTS[id]).catch(() => null)] as const)),
  );
  ctx ??= setup();
  const { renderer, scene, camera } = ctx;
  const lineMat = new THREE.LineBasicMaterial({ color: "#000", transparent: true, opacity: 0.22 });
  // Big builds as one merged mesh per colour (scene/Merged.tsx): a group per part
  // took 8–10 s for 5,000 parts. Instruction pages (fresh) keep their own path.
  const ready = new Map([...templates].filter((e): e is [string, THREE.Group] => !!e[1]));
  const merged = !opts.fresh && bricks.length > MERGE_FROM_PARTS ? buildMerged(bricks, ready, (b) => ({ hex: colorOf(b.color).hex, alpha: colorOf(b.color).alpha ?? 1 })) : null;
  const model = merged ? merged.root : new THREE.Group();
  for (const b of merged ? [] : bricks) {
    const part = PARTS[b.partId];
    const tpl = templates.get(b.partId);
    if (!part) continue;
    // Instruction pages: earlier parts washed out, this step's parts in full colour.
    const faded = opts.fresh && !opts.fresh.has(b.uid);
    const hex = faded ? `#${new THREE.Color(colorOf(b.color).hex).lerp(new THREE.Color("#ffffff"), 0.55).getHexString()}` : colorOf(b.color).hex;
    const alpha = colorOf(b.color).alpha ?? 1;
    const key = `${hex}:${alpha}`;
    let mat = previewMats.get(key);
    if (!mat)
      previewMats.set(
        key,
        (mat = new THREE.MeshStandardMaterial({ color: hex, roughness: alpha < 1 ? 0.1 : 0.35, transparent: alpha < 1, opacity: alpha < 1 ? Math.max(0.35, alpha * 0.85) : 1, depthWrite: alpha >= 1 })),
      );
    // Everything through the part's world matrix (grid placement, segment pose, or exact).
    const holder = new THREE.Group();
    holder.applyMatrix4(new THREE.Matrix4().fromArray(partMatrix(b)));
    holder.add(tpl ? instantiate(tpl, mat, faded ? lineMat : edgeMaterial(hex)) : new THREE.Mesh(bodyGeometry(part), mat));
    model.add(holder);
  }
  const wrapper = new THREE.Group().add(model);
  const sphere = new THREE.Box3().setFromObject(wrapper).getBoundingSphere(new THREE.Sphere());
  wrapper.position.sub(sphere.center);
  const r = sphere.radius * 1.02 || 1;
  Object.assign(camera, { left: -r, right: r, top: r, bottom: -r });
  const el = opts.elevation;
  const view =
    opts.azimuth === undefined
      ? FRONT_RIGHT
      : el === undefined
        ? new THREE.Vector3(Math.cos(opts.azimuth), 0.62, Math.sin(opts.azimuth)).normalize()
        : new THREE.Vector3(Math.cos(opts.azimuth) * Math.cos(el), Math.sin(el), Math.sin(opts.azimuth) * Math.cos(el));
  camera.position.copy(view).multiplyScalar(r * 4);
  camera.lookAt(0, 0, 0);
  // Depth range around the model: big models (a 37-stud dinosaur) would cross a fixed far plane.
  camera.near = r * 0.5;
  camera.far = r * 8;
  camera.updateProjectionMatrix();
  renderer.setSize(size, size, false);
  scene.add(wrapper);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL("image/webp", 0.9);
  scene.remove(wrapper);
  renderer.setSize(SIZE, SIZE, false);
  lineMat.dispose();
  if (merged) {
    merged.root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    merged.own.forEach((m) => m.dispose());
  }
  return url;
}

const FRONT_RIGHT = new THREE.Vector3(0.75, 0.55, 1).normalize();
