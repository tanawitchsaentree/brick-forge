import { useEffect, useState } from "react";
import * as THREE from "three";
import { LDrawLoader } from "three/examples/jsm/loaders/LDrawLoader.js";
import { LDrawConditionalLineMaterial } from "three/examples/jsm/materials/LDrawConditionalLineMaterial.js";
import type { PartDef } from "../engine/parts";
import { partOrigin } from "../engine/parts";
import { fromPack, loadPack } from "./pack";

// Real part geometry from the LDraw library in public/ldraw. Each part file is
// loaded once into a template; instances are cheap clones that share geometry.

const LIBRARY = "/ldraw/";
const MAIN_COLOUR = "16"; // LDraw "use the colour you're given"
const LDU = 1 / 20; // world units (studs) per LDraw unit
const noRaycast = () => {};

let loaderPromise: Promise<LDrawLoader> | null = null;
function getLoader() {
  loaderPromise ??= (async () => {
    const loader = new LDrawLoader();
    loader.setPartsLibraryPath(LIBRARY);
    // Required by the loader even though conditional lines are stripped later.
    loader.setConditionalLineMaterial(LDrawConditionalLineMaterial);
    const [primitives] = await Promise.all([
      fetch("/ldraw-filemap.json").then((r) => r.json() as Promise<Record<string, string>>),
      loader.preloadMaterials(`${LIBRARY}LDConfig.ldr`),
    ]);
    // The loader finds subfiles by probing parts/, p/, models/… until one isn't
    // a 404. That's slow, and breaks on servers that answer unknown paths with
    // index.html. Instead, strip whatever folders it guessed and point every
    // request straight at the real file: primitives are in p/, the rest in parts/.
    loader.manager.setURLModifier((url) => {
      const at = url.indexOf(LIBRARY);
      if (at < 0 || !url.toLowerCase().endsWith(".dat")) return url;
      const key = url
        .slice(at + LIBRARY.length)
        .toLowerCase()
        .replace(/^((parts|p|models)\/)+/, "");
      // Parts composed by the catalog script (people) live next to the library.
      if (key.startsWith("lb-")) return `${url.slice(0, at)}/ldraw-gen/parts/${key}`;
      return url.slice(0, at) + LIBRARY + (primitives[key] ?? `parts/${key}`);
    });
    return loader;
  })();
  return loaderPromise;
}

const templates = new Map<string, Promise<THREE.Group>>();

/** Drop every cached template and the loader's own parse cache (batch rendering frees memory with this). */
export function resetLDraw() {
  for (const t of templates.values())
    t.then((g) => g.traverse((o) => (o as THREE.Mesh).geometry?.dispose())).catch(() => {});
  templates.clear();
  loaderPromise = null;
}

/**
 * The part in its local grid frame: x ∈ [0, w], y ∈ [0, height], z ∈ [0, d]
 * (LDraw is y-down; flipping y and z is a rotation, so normals stay correct).
 */
export function loadTemplate(part: PartDef): Promise<THREE.Group> {
  let t = templates.get(part.id);
  if (!t) {
    // From the geometry pack when it has the part (no parsing), else LDrawLoader.
    t = loadPack().then((pack) => {
      const e = pack.get(part.id);
      return e ? fromPack(e) : parseTemplate(part);
    });
    templates.set(part.id, t);
  }
  return t;
}

/** Parse a part with LDrawLoader (also how the pack is made). */
export function parseTemplate(part: PartDef): Promise<THREE.Group> {
  {
    const t = getLoader().then(
      (loader) =>
        new Promise<THREE.Group>((resolve, reject) => {
          loader.load(
            `${LIBRARY}parts/${part.id}.dat`,
            (model) => {
              const [ox, oy, oz] = partOrigin(part);
              model.scale.set(LDU, -LDU, -LDU);
              model.position.set(ox, oy, oz);
              const doomed: THREE.Object3D[] = [];
              model.traverse((o) => {
                // Conditional lines need LDraw's special shader; plain edges are enough here.
                if ((o as { isConditionalLine?: boolean }).isConditionalLine) doomed.push(o);
                else if ((o as THREE.LineSegments).isLineSegments) o.raycast = noRaycast;
              });
              for (const o of doomed) o.removeFromParent();
              const root = new THREE.Group();
              root.add(model);
              resolve(root);
            },
            undefined,
            reject,
          );
        }),
    );
    return t;
  }
}

const isMain = (m: THREE.Material) => m.userData?.code === MAIN_COLOUR;

/**
 * Clone a template, painting its main-colour faces with `material` and main
 * edges with `edges`. A `ghost` paints every face and hides edges.
 */
export function instantiate(
  template: THREE.Group,
  material: THREE.Material,
  edges: THREE.Material | null,
  ghost = false,
): THREE.Group {
  const obj = template.clone(true);
  obj.traverse((o) => {
    if ((o as THREE.LineSegments).isLineSegments) {
      const line = o as THREE.LineSegments;
      if (ghost || !edges) line.visible = false;
      else if (isMain(line.material as THREE.Material)) line.material = edges;
      return;
    }
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const swap = (m: THREE.Material) => (ghost || isMain(m) ? material : m);
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
    mesh.castShadow = !ghost;
    mesh.receiveShadow = true;
    mesh.raycast = noRaycast; // Brick adds a box proxy for picking
  });
  return obj;
}

/** The loaded template for an LDraw part, or null while loading / for built-in parts. */
export function useLDrawTemplate(part: PartDef): THREE.Group | null {
  const [tpl, setTpl] = useState<THREE.Group | null>(null);
  useEffect(() => {
    setTpl(null);
    if (part.shape.type !== "ldraw") return;
    let alive = true;
    loadTemplate(part).then(
      (t) => alive && setTpl(t),
      (err) => console.warn(`LDraw part ${part.id} failed to load`, err),
    );
    return () => {
      alive = false;
    };
  }, [part]);
  return tpl;
}
