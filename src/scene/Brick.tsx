import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { PLATE_H, STUD_H, STUD_R } from "../engine/units";
import { footprint, type PartDef, type Rot } from "../engine/parts";
import { bodyGeometry, edgeGeometry } from "./geometry";
import { instantiate, useLDrawTemplate } from "./ldraw";

const studGeo = new THREE.CylinderGeometry(STUD_R, STUD_R, STUD_H, 20);
const noRaycast = () => null;
const ldrawEdges = new THREE.LineBasicMaterial({ color: "#000", transparent: true, opacity: 0.3 });
const builtinEdges = new THREE.LineBasicMaterial({ color: "#000", transparent: true, opacity: 0.25 });
const ERASE_GLOW = new THREE.Color("#ff3344");
const DROP = 0.7; // studs: placed parts fall in from this high
const DROP_TIME = 0.26; // seconds

interface Props {
  part: PartDef;
  rot: Rot;
  x: number;
  y: number;
  z: number;
  color: string;
  uid?: string;
  ghost?: boolean;
  outline?: string; // ghost only: x-ray outline colour
  opacity?: number; // ghost only
  highlight?: boolean;
  /** Colour of the highlight glow (default: the erase red). */
  glow?: string;
  enterDelay?: number; // seconds before the drop-in animation starts
  noDrop?: boolean; // appear in place (already-built steps in the instructions)
  alpha?: number; // transparent LEGO colours (trans-clear windows, lights)
  /** Segment pose (engine/pose.ts): carries the part's grid into the world. */
  pose?: number[];
}

/** A part rendered in its local frame, then rotated about its footprint centre. */
export function Brick({ part, rot, x, y, z, color, uid, ghost, outline, opacity = 0.45, highlight, glow, enterDelay = 0, noDrop, alpha = 1, pose }: Props) {
  const { w, d } = footprint(part, rot);
  const height = part.h * PLATE_H;

  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.3,
        metalness: 0,
        transparent: !!ghost || alpha < 1,
        opacity: ghost ? opacity : alpha < 1 ? Math.max(0.35, alpha * 0.85) : 1,
        emissive: glow ? new THREE.Color(glow) : ERASE_GLOW,
        emissiveIntensity: 0,
        depthWrite: !ghost && alpha >= 1,
      }),
    [color, ghost, opacity, glow, alpha],
  );
  useEffect(() => () => material.dispose(), [material]);

  // Drop-in on mount (ease-out cubic), and an erase glow that eases in and out.
  const drop = useRef<THREE.Group>(null);
  const born = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (ghost || noDrop || !drop.current) return;
    drop.current.position.y = DROP;
    drop.current.visible = enterDelay === 0; // staggered parts stay hidden until their turn
  }, []);
  const lit = useRef<number | null>(null);
  useFrame(({ clock, invalidate }, dt) => {
    // A coloured glow (instructions) flashes as the part lands, then fades to a
    // faint trace so the part shows its true colour — black must read as black.
    lit.current ??= clock.elapsedTime;
    const fresh = clock.elapsedTime - lit.current < 0.9 + enterDelay;
    const target = highlight ? (glow ? (fresh ? 0.4 : 0.03) : 0.6) : 0;
    if (glow && highlight && fresh) invalidate();
    if (Math.abs(material.emissiveIntensity - target) > 0.005) {
      material.emissiveIntensity += (target - material.emissiveIntensity) * (1 - Math.exp(-dt * 14));
      invalidate();
    }
    const g = drop.current;
    if (ghost || !g || g.position.y === 0) return;
    invalidate();
    born.current ??= clock.elapsedTime + enterDelay;
    const t = Math.min(Math.max((clock.elapsedTime - born.current) / DROP_TIME, 0), 1);
    g.visible = clock.elapsedTime >= born.current;
    g.position.y = t >= 1 ? 0 : DROP * (1 - t) ** 3;
  });

  const raycast = ghost ? noRaycast : undefined;

  // LDraw parts carry their own studs and detail.
  const isLDraw = part.shape.type === "ldraw";
  const template = useLDrawTemplate(part);
  const real = useMemo(
    () => (template ? instantiate(template, material, ldrawEdges, ghost) : null),
    [template, material, ghost],
  );

  // A rigid pose as position + rotation (plain props, so three keeps its matrices current).
  const poseTRS = useMemo(() => {
    if (!pose) return null;
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    new THREE.Matrix4().fromArray(pose).decompose(p, q, s);
    return { p, q };
  }, [pose]);

  const placed = (
    <group
      position={[x + w / 2, y * PLATE_H, z + d / 2]}
      rotation={[0, (-rot * Math.PI) / 2, 0]}
      userData={{ uid }}
    >
      <group ref={drop}>
      <group position={[-part.w / 2, 0, -part.d / 2]}>
        {real ? (
          <>
            <primitive object={real} />
            {/* Pointer hits use the part's box, not thousands of LDraw triangles. */}
            {!ghost && <mesh geometry={bodyGeometry(part)} visible={false} />}
          </>
        ) : (
          // Built-in parametric body, or a stand-in box while an LDraw part loads.
          <mesh
            geometry={bodyGeometry(part)}
            material={material}
            castShadow={!ghost}
            receiveShadow
            raycast={raycast}
          >
            {!ghost && <lineSegments geometry={edgeGeometry(part)} material={builtinEdges} raycast={noRaycast} />}
          </mesh>
        )}
        {ghost && (
          // Drawn without depth test so the outline stays visible behind other parts.
          <lineSegments geometry={edgeGeometry(part)} renderOrder={5} raycast={noRaycast}>
            <lineBasicMaterial color={outline ?? color} depthTest={false} transparent opacity={0.95} />
          </lineSegments>
        )}
        {!isLDraw && part.studs.map(([i, k]) => (
          <mesh
            key={`${i},${k}`}
            geometry={studGeo}
            material={material}
            position={[i + 0.5, height + STUD_H / 2, k + 0.5]}
            castShadow={!ghost}
            raycast={raycast}
          />
        ))}
      </group>
      </group>
    </group>
  );
  return poseTRS ? (
    <group position={poseTRS.p} quaternion={poseTRS.q}>
      {placed}
    </group>
  ) : (
    placed
  );
}
