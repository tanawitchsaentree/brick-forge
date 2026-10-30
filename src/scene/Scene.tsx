import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Brick } from "./Brick";
import { MERGE_FROM, MergedBricks } from "./Merged";
import { Controls } from "./Controls";
import { Label } from "./Label";
import { Table } from "./Table";
import { SCENE, useTheme } from "../ui/theme";
import { BASE_SIZE, PLATE_H, PLATE_MM, STUD_H, STUD_MM } from "../engine/units";
import { PARTS, footprint, type PartDef, type Rot } from "../engine/parts";
import { colorOf } from "../engine/colors";
import { OUTSIDE, bounds, canPlace, renderPlacement, type Occupancy, type PlacedBrick } from "../engine/grid";
import { createStore } from "../state/store";
import { stressColor, type Stability } from "../engine/stability";

export type Tool = "build" | "erase";
export type Nav = "trackpad" | "mouse";

export interface Hover {
  x: number;
  y: number;
  z: number;
  ok: boolean;
  reason?: string;
  eraseUid?: string;
}

/** What the pointer is aiming at. Kept outside React state so pointer moves don't re-render the app. */
export const hoverStore = createStore<Hover | null>(null);

const sameHover = (a: Hover | null, b: Hover | null) =>
  a === b ||
  (!!a && !!b && a.x === b.x && a.y === b.y && a.z === b.z && a.ok === b.ok && a.reason === b.reason && a.eraseUid === b.eraseUid);

function setHover(h: Hover | null) {
  if (!sameHover(hoverStore.get(), h)) hoverStore.set(h);
}

interface Props {
  bricks: PlacedBrick[];
  occ: Occupancy;
  tool: Tool;
  nav: Nav;
  part: PartDef;
  rot: Rot;
  color: number;
  showDims: boolean;
  /** When set, parts are painted by how hard their joint is working (Stress view). */
  stress: Stability | null;
  /** Changes when a whole model arrives: the camera frames it (there's no baseplate to size the view by). */
  frame?: number;
  onPlace: (x: number, y: number, z: number) => void;
  onErase: (uid: string) => void;
}

interface Hit {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  object: THREE.Object3D;
}

const UP = new THREE.Vector3(0, 1, 0);
const OK_COLOR = "#1f6feb";
const BAD_COLOR = "#e5484d";
const CARRY_COLOR = "#8a94a3";
const noRaycast = () => null;

function findUid(obj: THREE.Object3D | null): string | undefined {
  for (let o = obj; o; o = o.parent) if (o.userData.uid) return o.userData.uid;
  return undefined;
}

/** World-space face normal, turned to face the viewer (LDraw winding isn't always consistent). */
function faceNormal(face: THREE.Face | null | undefined, object: THREE.Object3D, ray: THREE.Ray) {
  if (!face) return UP.clone();
  const n = face.normal.clone().transformDirection(object.matrixWorld);
  return n.dot(ray.direction) > 0 ? n.negate() : n;
}

function toHit(e: ThreeEvent<PointerEvent | MouseEvent>): Hit {
  return { point: e.point.clone(), normal: faceNormal(e.face, e.object, e.ray), object: e.object };
}

export function Scene(props: Props) {
  const { bricks, nav, showDims } = props;
  const center = BASE_SIZE / 2;
  const look = SCENE[useTheme()];

  return (
    <Canvas
      shadows
      dpr={[1, 1.75]} // retina-sharp without rendering 4× the pixels on 3× displays
      gl={{ powerPreference: "high-performance" }}
      frameloop="demand" // render only when something changes; animations request their own frames
      onCreated={({ gl }) => {
        gl.debug.checkShaderErrors = import.meta.env.DEV; // the check stalls the GPU on every compile
      }}
      camera={{ position: [center + 28, 34, center + 38], fov: 45 }}
    >
      <color attach="background" args={[look.background]} />
      <hemisphereLight args={[look.sky, look.ground, 1.1]} />
      <directionalLight
        position={[center + 20, 40, center + 10]}
        intensity={1.6}
        castShadow
        shadow-mapSize={[1536, 1536]}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
      />

      <Table />
      <Workspace {...props} />
      {showDims && <DimensionBox bricks={bricks} />}

      {/* Trackpad: a two-finger tap rotates the part, so right-drag must not pan. */}
      <Controls target={[center, 0, center]} maxPolarAngle={Math.PI / 2.05} rightPan={nav === "mouse"} />
      <FrameModel bricks={bricks} frame={props.frame ?? 0} />
      <TrackpadNav enabled={nav === "trackpad"} />
    </Canvas>
  );
}

/** Pointer handling, the ghost part that follows the cursor, and placement. */
function Workspace(props: Props) {
  const { bricks, occ, tool, part, rot, color, stress, onPlace, onErase } = props;
  const hover = hoverStore.use();
  const onHover = setHover;
  const group = useRef<THREE.Group>(null);
  const inside = useRef(false);
  const get = useThree((s) => s.get);
  const byUid = useMemo(() => new Map(bricks.map((b) => [b.uid, b])), [bricks]);

  /** Turn a ray hit into the grid cell the new part would occupy. */
  function target({ point, normal: n, object }: Hit): Hover {
    // Step off the surface by more than the 0.0125-stud clearance around each part.
    const p = point.clone().addScaledVector(n, 0.05);
    const cx = Math.floor(p.x);
    const cz = Math.floor(p.z);
    const cy = Math.max(0, Math.floor(p.y / PLATE_H + 1e-6));
    const { w, d } = footprint(part, rot);

    // Centre the footprint on the cursor, except when building off a side face:
    // then the part starts at the face and grows away from it.
    let x = cx - Math.floor((w - 1) / 2);
    let z = cz - Math.floor((d - 1) / 2);
    if (n.x > 0.5) x = cx;
    if (n.x < -0.5) x = cx - w + 1;
    if (n.z > 0.5) z = cz;
    if (n.z < -0.5) z = cz - d + 1;
    let y = n.y < -0.5 ? cy - part.h + 1 : cy;
    // Building off the side of a part: line up with its base, like laying a wall.
    const side = Math.abs(n.y) < 0.5 ? byUid.get(findUid(object) ?? "") : undefined;
    if (side) y = side.y;

    const res = canPlace(occ, part, rot, x, y, z);
    return { x, y, z, ok: res.ok, reason: res.ok ? undefined : res.reason };
  }

  /** Raycast at the current pointer position, without waiting for a pointer event. */
  function hitUnderPointer() {
    const { raycaster, pointer, camera } = get();
    group.current!.updateMatrixWorld(true); // parts added this commit haven't rendered yet
    raycaster.setFromCamera(pointer, camera);
    return raycaster
      .intersectObject(group.current!, true)
      .find((h) => (h.object as THREE.Mesh).isMesh && h.face);
  }

  /** Recompute the ghost (or erase highlight) for wherever the pointer is now. */
  function reaim() {
    if (!inside.current) return;
    const h = hitUnderPointer();
    if (!h) return onHover(null);
    if (tool === "erase") {
      const uid = findUid(h.object);
      onHover(uid ? { x: 0, y: 0, z: 0, ok: true, eraseUid: uid } : null);
    } else {
      const normal = faceNormal(h.face, h.object, get().raycaster.ray);
      onHover(target({ point: h.point, normal, object: h.object }));
    }
  }

  // When the part, rotation or model changes, keep the ghost under the cursor:
  // after placing, it moves straight onto the new part.
  useEffect(reaim, [part, rot, occ, tool]);

  // Only drop the ghost when the pointer actually leaves the canvas.
  useEffect(() => {
    const el = get().gl.domElement;
    const leave = () => {
      inside.current = false;
      onHover(null);
    };
    el.addEventListener("pointerleave", leave);
    return () => el.removeEventListener("pointerleave", leave);
  }, [get]);

  function handleMove(e: ThreeEvent<PointerEvent>) {
    e.stopPropagation();
    inside.current = true;
    if (tool === "erase") {
      const uid = findUid(e.object);
      onHover(uid ? { x: 0, y: 0, z: 0, ok: true, eraseUid: uid } : null);
    } else {
      onHover(target(toHit(e)));
    }
  }

  function handleClick(e: ThreeEvent<MouseEvent>) {
    e.stopPropagation();
    if (e.delta > 4) return; // it was an orbit drag, not a click
    if (tool === "erase" || e.shiftKey) {
      const uid = findUid(e.object);
      if (uid) onErase(uid);
      return;
    }
    const t = target(toHit(e));
    if (t.ok) onPlace(t.x, t.y, t.z);
  }

  const ghost = tool === "build" && hover && !hover.eraseUid ? hover : null;
  // Off the baseplate the part is just being carried: show it faint, not as an error.
  const carried = ghost && !ghost.ok && ghost.reason === OUTSIDE;

  return (
    <>
      <group
        ref={group}
        onPointerMove={handleMove}
        // R3F also sends "out" when the hovered child changes under a still
        // pointer (e.g. right after placing), so re-aim instead of hiding.
        onPointerOut={reaim}
        onClick={handleClick}
      >
        <BrickList bricks={bricks} eraseUid={hover?.eraseUid} stress={stress} />
        {/* The ground: invisible (the table draws it), so parts go down anywhere on it. */}
        <mesh position={[BASE_SIZE / 2, -0.01, BASE_SIZE / 2]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[600, 600]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
        </mesh>
      </group>

      {ghost && (
        <>
          <Glide to={ghostCenter(ghost, part, rot)} pulse={`${part.id}:${rot}`}>
            <Brick
              part={part}
              rot={rot}
              x={-footprint(part, rot).w / 2}
              y={0}
              z={-footprint(part, rot).d / 2}
              color={ghost.ok || carried ? colorOf(color).hex : BAD_COLOR}
              outline={ghost.ok ? OK_COLOR : carried ? CARRY_COLOR : BAD_COLOR}
              opacity={carried ? 0.3 : 0.45}
              ghost
            />
          </Glide>
          {!carried && <PlacementGuides hover={ghost} part={part} rot={rot} />}
        </>
      )}
    </>
  );
}

function ghostCenter(h: Hover, part: PartDef, rot: Rot): [number, number, number] {
  const { w, d } = footprint(part, rot);
  return [h.x + w / 2, h.y * PLATE_H, h.z + d / 2];
}

/**
 * Glides its children toward `to` with exponential easing (snapping on first
 * appearance), and gives a small scale "pop" whenever `pulse` changes.
 * Placement guides stay snapped to the cell, so precision isn't lost.
 */
function Glide({ to, pulse, children }: { to: [number, number, number]; pulse: string; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  const last = useRef(pulse);
  const scale = useRef(1);
  useLayoutEffect(() => {
    ref.current?.position.set(...to);
  }, []);
  useFrame((state, dt) => {
    const g = ref.current;
    if (!g) return;
    const k = 1 - Math.exp(-dt * 24);
    const far = Math.abs(to[0] - g.position.x) + Math.abs(to[1] - g.position.y) + Math.abs(to[2] - g.position.z);
    if (far > 0.002 || Math.abs(1 - scale.current) > 0.002 || pulse !== last.current) state.invalidate();
    g.position.x += (to[0] - g.position.x) * k;
    g.position.y += (to[1] - g.position.y) * k;
    g.position.z += (to[2] - g.position.z) * k;
    if (pulse !== last.current) {
      last.current = pulse;
      scale.current = 0.86;
    }
    scale.current += (1 - scale.current) * (1 - Math.exp(-dt * 16));
    g.scale.setScalar(scale.current);
  });
  return <group ref={ref}>{children}</group>;
}

const BrickList = memo(function BrickList({
  bricks,
  eraseUid,
  stress,
}: {
  bricks: PlacedBrick[];
  eraseUid?: string;
  stress: Stability | null;
}) {
  // On first load, bricks drop in one after another (bottom layer first).
  const intro = useRef(true);
  useEffect(() => {
    intro.current = false;
  }, []);
  const order = useMemo(() => new Map([...bricks].sort((a, b) => a.y - b.y).map((b, i) => [b.uid, i])), [bricks]);
  const look = useCallback(
    (b: PlacedBrick) =>
      stress
        ? { hex: stressColor(stress.ratio.get(b.uid), stress.floating.has(b.uid)), alpha: 1 }
        : { hex: colorOf(b.color).hex, alpha: colorOf(b.color).alpha ?? 1 },
    [stress],
  );

  // Big models: LDraw parts drawn merged (a few draw calls instead of hundreds);
  // built-in parts and the part under the eraser stay individual.
  const big = bricks.length >= MERGE_FROM;
  const merged = useMemo(() => (big ? bricks.filter((b) => PARTS[b.partId]?.shape.type === "ldraw") : []), [big, bricks]);
  if (big) {
    const inMerge = new Set(merged.map((b) => b.uid));
    const erased = bricks.find((b) => b.uid === eraseUid);
    return (
      <>
        <MergedBricks bricks={merged} colorOf={look} />
        {bricks
          .filter((b) => !inMerge.has(b.uid) || b === erased)
          .map((b) => (
            <Brick
              key={b.uid}
              noDrop
              uid={b.uid}
              part={PARTS[b.partId]}
              {...renderPlacement(b)}
              color={look(b).hex}
              alpha={look(b).alpha}
              highlight={b === erased}
            />
          ))}
      </>
    );
  }

  return (
    <>
      {bricks.map((b) => (
        <Brick
          key={b.uid}
          enterDelay={intro.current ? Math.min(order.get(b.uid)! * 0.03, 1.2) : 0}
          uid={b.uid}
          part={PARTS[b.partId]}
          {...renderPlacement(b)}
          color={stress ? stressColor(stress.ratio.get(b.uid), stress.floating.has(b.uid)) : colorOf(b.color).hex}
          alpha={stress ? 1 : colorOf(b.color).alpha}
          highlight={b.uid === eraseUid}
        />
      ))}
    </>
  );
});

/**
 * Aids for precise placement: the footprint projected onto the baseplate with
 * its stud cells, drop lines from the ghost's corners, leader lines to the
 * rulers with exact coordinates, and the height (or why placement is blocked).
 */
function PlacementGuides({ hover, part, rot }: { hover: Hover; part: PartDef; rot: Rot }) {
  const { x, y, z, ok, reason } = hover;
  const { w, d } = footprint(part, rot);
  const col = ok ? OK_COLOR : BAD_COLOR;
  const gy = STUD_H + 0.02; // just above the baseplate studs
  const bottom = y * PLATE_H;
  const top = bottom + part.h * PLATE_H;

  const [cellLines, leaderLines] = useMemo(() => {
    const cells: number[] = [];
    for (let i = 0; i <= w; i++) cells.push(x + i, gy, z, x + i, gy, z + d);
    for (let k = 0; k <= d; k++) cells.push(x, gy, z + k, x + w, gy, z + k);
    if (y > 0)
      for (const [cx, cz] of [[x, z], [x + w, z], [x, z + d], [x + w, z + d]])
        cells.push(cx, gy, cz, cx, bottom, cz);

    // Short ticks out from the footprint to its coordinate labels (no baseplate edge to run to).
    const leaders = [
      x, gy, z + d, x, gy, z + d + 0.8,
      x + w, gy, z + d, x + w, gy, z + d + 0.8,
      x, gy, z, x - 0.8, gy, z,
      x, gy, z + d, x - 0.8, gy, z + d,
    ];
    const geo = (pts: number[]) =>
      new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return [geo(cells), geo(leaders)];
  }, [x, y, z, w, d, gy, bottom]);

  useEffect(
    () => () => {
      cellLines.dispose();
      leaderLines.dispose();
    },
    [cellLines, leaderLines],
  );

  const tag = { color: "#ffffff", background: col, size: 0.024, opacity: 0.92 };

  return (
    <group>
      <mesh position={[x + w / 2, gy - 0.005, z + d / 2]} rotation={[-Math.PI / 2, 0, 0]} raycast={noRaycast}>
        <planeGeometry args={[w, d]} />
        <meshBasicMaterial color={col} transparent opacity={0.22} depthWrite={false} />
      </mesh>
      <lineSegments geometry={cellLines} raycast={noRaycast}>
        <lineBasicMaterial color={col} transparent opacity={0.9} />
      </lineSegments>
      <lineSegments geometry={leaderLines} raycast={noRaycast}>
        <lineBasicMaterial color={col} transparent opacity={0.45} />
      </lineSegments>

      <Label {...tag} text={`x ${x}→${x + w}`} position={[x + w / 2, 0.1, z + d + 1.4]} />
      <Label {...tag} text={`z ${z}→${z + d}`} position={[x - 1.8, 0.1, z + d / 2]} />
      <Label
        {...tag}
        text={ok ? `y ${y} · ${(y * PLATE_MM).toFixed(1)} mm` : (reason ?? "")}
        position={[x + w / 2, top + 0.9, z + d / 2]}
      />
    </group>
  );
}

/**
 * Trackpad navigation: two-finger scroll orbits, Shift+scroll pans, pinch zooms
 * (pinch arrives as a ctrl+wheel event, which OrbitControls already handles).
 */
function TrackpadNav({ enabled }: { enabled: boolean }) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as {
    target: THREE.Vector3;
    maxPolarAngle: number;
    update: () => void;
  } | null;

  const invalidate = useThree((s) => s.invalidate);
  // Wheel events only add to a pending delta; each frame applies a share of
  // it (1 − e^−k·dt), so trackpad orbiting glides instead of stepping.
  const pending = useRef({ theta: 0, phi: 0, panX: 0, panY: 0 });

  useEffect(() => {
    if (!enabled || !controls) return;
    const el = gl.domElement;
    function onWheel(e: WheelEvent) {
      if (e.ctrlKey) return;
      e.preventDefault();
      e.stopImmediatePropagation(); // keep OrbitControls from treating it as zoom
      const p = pending.current;
      invalidate();
      if (e.shiftKey) {
        p.panX += e.deltaX;
        p.panY += e.deltaY;
      } else {
        p.theta += e.deltaX * 0.005;
        p.phi += e.deltaY * 0.005;
      }
    }
    el.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => el.removeEventListener("wheel", onWheel, { capture: true });
  }, [enabled, controls, gl, invalidate]);

  const offset = useMemo(() => new THREE.Vector3(), []);
  const sph = useMemo(() => new THREE.Spherical(), []);
  const right = useMemo(() => new THREE.Vector3(), []);
  const up = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, dt) => {
    const p = pending.current;
    if (!controls || Math.abs(p.theta) + Math.abs(p.phi) + Math.abs(p.panX) + Math.abs(p.panY) < 1e-4) return;
    const k = 1 - Math.exp(-dt * 16);
    const [dTheta, dPhi, dX, dY] = [p.theta * k, p.phi * k, p.panX * k, p.panY * k];
    p.theta -= dTheta;
    p.phi -= dPhi;
    p.panX -= dX;
    p.panY -= dY;
    invalidate();

    offset.copy(camera.position).sub(controls.target);
    sph.setFromVector3(offset);
    sph.theta += dTheta;
    sph.phi = THREE.MathUtils.clamp(sph.phi + dPhi, 0.05, controls.maxPolarAngle);
    offset.setFromSpherical(sph);

    const s = offset.length() * 0.0015;
    right.setFromMatrixColumn(camera.matrix, 0).multiplyScalar(dX * s);
    up.setFromMatrixColumn(camera.matrix, 1).multiplyScalar(-dY * s);
    controls.target.add(right).add(up);
    camera.position.copy(controls.target).add(offset);
    controls.update();
  });

  return null;
}

/** Bounding box of the model with its size in studs/plates and millimetres. */
function DimensionBox({ bricks }: { bricks: PlacedBrick[] }) {
  const b = bounds(bricks);
  // Posed parts (a tilted tail) make the box fractional; show it to a tenth.
  const r = (v: number) => Math.round(v * 10) / 10;
  const w = b ? r(b.maxX - b.minX) : 0;
  const d = b ? r(b.maxZ - b.minZ) : 0;
  const h = b ? r(b.maxY - b.minY) : 0;
  const hw = h * PLATE_H;
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(w, hw, d)), [w, hw, d]);
  useEffect(() => () => edges.dispose(), [edges]);
  if (!b) return null;
  const y0 = b.minY * PLATE_H;
  const tag = { color: "#ffffff", background: "#7d8794", size: 0.02, opacity: 0.62 };

  return (
    <group>
      <lineSegments geometry={edges} position={[b.minX + w / 2, y0 + hw / 2, b.minZ + d / 2]} raycast={noRaycast}>
        <lineBasicMaterial color="#7d8794" transparent opacity={0.35} />
      </lineSegments>
      <Label {...tag} text={`W ${w} studs · ${w * STUD_MM} mm`} position={[b.minX + w / 2, y0, b.maxZ + 1]} />
      <Label {...tag} text={`D ${d} studs · ${d * STUD_MM} mm`} position={[b.maxX + 1, y0, b.minZ + d / 2]} />
      <Label
        {...tag}
        text={`H ${h} plates · ${(h * PLATE_MM).toFixed(1)} mm`}
        position={[b.minX - 1, y0 + hw / 2, b.maxZ]}
      />
    </group>
  );
}

/** Point the camera at the whole model, from the direction it already looks, close enough to fill the view. */
function FrameModel({ bricks, frame }: { bricks: PlacedBrick[]; frame: number }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update(): void } | null;
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (!frame || !controls) return;
    const b = bounds(bricks);
    if (!b) return;
    const lo = new THREE.Vector3(b.minX, b.minY * PLATE_H, b.minZ), hi = new THREE.Vector3(b.maxX, b.maxY * PLATE_H, b.maxZ);
    const c = lo.clone().add(hi).multiplyScalar(0.5);
    const r = Math.max(4, lo.distanceTo(hi) / 2);
    const dir = camera.position.clone().sub(controls.target).normalize();
    const dist = (r / Math.sin(((camera.fov ?? 45) * Math.PI) / 360)) * 1.05;
    controls.target.copy(c);
    camera.position.copy(c).addScaledVector(dir, dist);
    controls.update();
    invalidate();
    // Only when a model arrives, not on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame, controls]);
  return null;
}
