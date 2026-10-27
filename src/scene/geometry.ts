import * as THREE from "three";
import { GAP, PLATE_H } from "../engine/units";
import type { PartDef } from "../engine/parts";

// Body geometries in part-local space: x ∈ [0, w], y ∈ [0, height], z ∈ [0, d].
// Cached per part and shared by every instance.
const bodies = new Map<string, THREE.BufferGeometry>();
const edges = new Map<string, THREE.EdgesGeometry>();

export function bodyGeometry(part: PartDef): THREE.BufferGeometry {
  let g = bodies.get(part.id);
  if (!g) {
    g = build(part);
    bodies.set(part.id, g);
  }
  return g;
}

export function edgeGeometry(part: PartDef): THREE.EdgesGeometry {
  let g = edges.get(part.id);
  if (!g) {
    g = new THREE.EdgesGeometry(bodyGeometry(part), 20);
    edges.set(part.id, g);
  }
  return g;
}

function build(part: PartDef): THREE.BufferGeometry {
  const { w, d, shape } = part;
  const H = part.h * PLATE_H;
  const lo = GAP / 2;
  const hi = H - GAP / 2;

  switch (shape.type) {
    case "box":
    case "ldraw": // bounding box: stand-in while loading, and the ghost outline
      return new THREE.BoxGeometry(w - 2 * GAP, hi - lo, d - 2 * GAP).translate(w / 2, H / 2, d / 2);

    case "round":
      return new THREE.CylinderGeometry(w / 2 - GAP, w / 2 - GAP, hi - lo, 40).translate(w / 2, H / 2, d / 2);

    case "slope":
    case "inverted": {
      // Side profile in (z, y), extruded along x.
      const flat = Math.max(shape.flat, GAP);
      const pts =
        shape.type === "slope"
          ? [[GAP, lo], [d - GAP, lo], [d - GAP, lo + shape.lip], [flat, hi], ...(shape.flat > 0 ? [[GAP, hi]] : [])]
          : [[GAP, lo], [flat, lo], [d - GAP, hi - 0.15], [d - GAP, hi], [GAP, hi]];
      const profile = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
      const g = new THREE.ExtrudeGeometry(profile, { depth: w - 2 * GAP, bevelEnabled: false });
      // Shape x → z, extrusion z → x.
      return g.rotateY(-Math.PI / 2).translate(w - GAP, 0, 0);
    }

    case "arch": {
      // Front profile in (x, y), extruded along z.
      const leg = (w - shape.span) / 2;
      const rx = shape.span / 2;
      const ry = Math.min(shape.span / 2, hi - 0.3);
      const profile = new THREE.Shape();
      profile.moveTo(GAP, lo);
      profile.lineTo(leg, lo);
      profile.absellipse(w / 2, lo, rx, ry, Math.PI, 0, true, 0);
      profile.lineTo(w - GAP, lo);
      profile.lineTo(w - GAP, hi);
      profile.lineTo(GAP, hi);
      profile.closePath();
      const g = new THREE.ExtrudeGeometry(profile, { depth: d - 2 * GAP, bevelEnabled: false, curveSegments: 32 });
      return g.translate(0, 0, GAP);
    }
  }
}
