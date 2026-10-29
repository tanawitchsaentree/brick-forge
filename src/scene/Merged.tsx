import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { footprint, PARTS, type PartDef } from "../engine/parts";
import { renderPlacement, type PlacedBrick } from "../engine/grid";
import { PLATE_H } from "../engine/units";
import { bodyGeometry } from "./geometry";
import { edgeMaterial, isMain, loadTemplate } from "./ldraw";

// Big models (an imported Speed Champions car is ~300 parts, ~900 draw calls
// with shadows) drawn as one mesh per colour plus one line set per edge
// colour: a dozen draw calls, so orbiting stays smooth. Each part keeps an
// invisible box for picking, so hovering, building on and erasing still work.

export const MERGE_FROM = 120;

const noRaycast = () => {};

/** Part-local frame → world, matching Brick's group nesting. */
export function brickMatrix(b: PlacedBrick, part: PartDef): THREE.Matrix4 {
  const { x, y, z, rot, pose } = renderPlacement(b);
  const { w, d } = footprint(part, rot);
  const m = new THREE.Matrix4()
    .makeTranslation(x + w / 2, y * PLATE_H, z + d / 2)
    .multiply(new THREE.Matrix4().makeRotationY((-rot * Math.PI) / 2))
    .multiply(new THREE.Matrix4().makeTranslation(-part.w / 2, 0, -part.d / 2));
  return pose ? new THREE.Matrix4().fromArray(pose).multiply(m) : m;
}

/** Position (+ normal) as plain float arrays without an index, so any two merge. */
function flat(geo: THREE.BufferGeometry, mesh: boolean): THREE.BufferGeometry {
  const src = geo.index ? geo.toNonIndexed() : geo;
  const out = new THREE.BufferGeometry();
  for (const name of mesh ? ["position", "normal"] : ["position"]) {
    const a = src.getAttribute(name);
    if (!a) return out;
    const f = new Float32Array(a.count * 3);
    for (let i = 0; i < a.count; i++) {
      f[i * 3] = a.getX(i);
      f[i * 3 + 1] = a.getY(i);
      f[i * 3 + 2] = a.getZ(i);
    }
    out.setAttribute(name, new THREE.BufferAttribute(f, 3));
  }
  return out;
}

/** Vertices [start, start + count) of a flattened geometry (group ranges count indices, which flattening made vertices). */
function slice(g: THREE.BufferGeometry, start: number, count: number): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  for (const name of ["position", "normal"]) {
    const a = g.getAttribute(name);
    if (!a) continue;
    const end = Math.min(a.count, start + count);
    out.setAttribute(name, new THREE.BufferAttribute((a.array as Float32Array).slice(start * 3, end * 3), 3));
  }
  return out;
}

interface Props {
  bricks: PlacedBrick[];
  colorOf: (b: PlacedBrick) => { hex: string; alpha: number };
}

/**
 * The merged scene itself, outside React: one mesh per colour and one line set
 * per edge colour for every part with a template. The editor's scene draws it
 * (MergedBricks), and so do model pictures of big builds (scene/thumbnails.ts),
 * where one object per part took 8–10 s for 5,000 parts.
 */
export function buildMerged(bricks: PlacedBrick[], templates: Map<string, THREE.Group>, colorOf: Props["colorOf"]) {
  const meshes = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[] }>();
  const lines = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[] }>();
  const own = new Map<string, THREE.Material>();
  const add = (to: typeof meshes, key: string, mat: THREE.Material, g: THREE.BufferGeometry) => {
    const e = to.get(key) ?? { mat, geos: [] };
    e.geos.push(g);
    to.set(key, e);
  };
  for (const b of bricks) {
    const part = PARTS[b.partId];
    const t = templates.get(b.partId);
    if (!part || !t) continue;
    const { hex, alpha } = colorOf(b);
    const M = brickMatrix(b, part);
    t.updateMatrixWorld(true);
    t.traverse((o) => {
      const isLine = (o as THREE.LineSegments).isLineSegments;
      const mesh = o as THREE.Mesh;
      if (!isLine && !mesh.isMesh) return;
      const world = new THREE.Matrix4().multiplyMatrices(M, o.matrixWorld);
      const all = flat(mesh.geometry, !isLine).applyMatrix4(world);
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const groups = Array.isArray(mesh.material) && mesh.geometry.groups.length ? mesh.geometry.groups : null;
      for (const [mat, g] of groups
        ? groups.map((gr) => [mats[gr.materialIndex ?? 0], slice(all, gr.start, gr.count)] as const)
        : [[mats[0], all] as const]) place(mat, g, isLine);
    });
    function place(mat: THREE.Material, g: THREE.BufferGeometry, isLine: boolean) {
      if (!g.getAttribute("position")?.count) return;
      if (isLine) {
        const m = isMain(mat) ? edgeMaterial(hex) : mat;
        add(lines, m.uuid, m, g);
      } else if (isMain(mat)) {
        const key = `${hex}:${alpha}`;
        let m = own.get(key);
        if (!m) {
          m = new THREE.MeshStandardMaterial({
            color: hex,
            roughness: 0.3,
            transparent: alpha < 1,
            opacity: alpha < 1 ? Math.max(0.35, alpha * 0.85) : 1,
            depthWrite: alpha >= 1,
          });
          own.set(key, m);
        }
        add(meshes, key, m, g);
      } else add(meshes, mat.uuid, mat, g);
    }
  }
  const root = new THREE.Group();
  for (const { mat, geos } of meshes.values()) {
    const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.raycast = noRaycast; // picking hits the per-part boxes below
    root.add(mesh);
  }
  for (const { mat, geos } of lines.values()) {
    const line = new THREE.LineSegments(mergeGeometries(geos), mat);
    line.raycast = noRaycast;
    root.add(line);
  }
  for (const g of [...meshes.values(), ...lines.values()].flatMap((e) => e.geos)) g.dispose();
  return { root, own: [...own.values()] };
}

export function MergedBricks({ bricks, colorOf }: Props) {
  // Every distinct part's template, loaded once.
  const [templates, setTemplates] = useState<Map<string, THREE.Group> | null>(null);
  const ids = useMemo(() => [...new Set(bricks.map((b) => b.partId))].sort().join(","), [bricks]);
  useEffect(() => {
    let alive = true;
    const list = ids ? ids.split(",") : [];
    Promise.all(list.map((id) => loadTemplate(PARTS[id]).then((t) => [id, t] as const, () => null))).then(
      (got) => alive && setTemplates(new Map(got.filter((g) => g !== null))),
    );
    return () => {
      alive = false;
    };
  }, [ids]);

  const scene = useMemo(() => (templates ? buildMerged(bricks, templates, colorOf) : null), [templates, bricks, colorOf]);

  useEffect(
    () => () => {
      scene?.root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      scene?.own.forEach((m) => m.dispose());
    },
    [scene],
  );

  return (
    <>
      {scene && <primitive object={scene.root} />}
      {bricks.map((b) => {
        const part = PARTS[b.partId];
        if (!part) return null;
        return (
          <mesh
            key={b.uid}
            geometry={bodyGeometry(part)}
            matrix={brickMatrix(b, part)}
            matrixAutoUpdate={false}
            visible={false}
            userData={{ uid: b.uid }}
          />
        );
      })}
    </>
  );
}
