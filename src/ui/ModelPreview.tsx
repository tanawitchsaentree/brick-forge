import { useEffect, useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { PlacedBrick } from "../engine/grid";
import { colorOf } from "../engine/colors";
import { MergedBricks } from "../scene/Merged";
import { Controls } from "../scene/Controls";
import { SCENE, useTheme } from "./theme";
import { Button, Card, IconButton } from "pane-react";

// A design looked at before anything is done with it: in 3D, turning slowly
// until you take hold of it, with what you can do next under it. Building
// steps are the main thing (that's why you'd pick one); editing it on the
// baseplate is the other.

interface Props {
  title: string;
  from?: string;
  bricks: PlacedBrick[];
  facts: string[];
  onInstructions: () => void;
  onEdit: () => void;
  onClose: () => void;
}

const merged = (b: PlacedBrick) => {
  const c = colorOf(b.color);
  return { hex: c.hex, alpha: c.alpha ?? 1 };
};

export function ModelPreview({ title, from, bricks, facts, onInstructions, onEdit, onClose }: Props) {
  const look = SCENE[useTheme()];
  const model = useRef<THREE.Group>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), onClose());
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="preview-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <Card as="section" className="preview" role="dialog" aria-label={`${title}: preview`}>
        <div className="preview-stage">
          <Canvas frameloop="demand" dpr={[1, 1.75]} camera={{ position: [30, 24, 30], fov: FOV }}>
            <color attach="background" args={[look.background]} />
            <hemisphereLight args={[look.sky, look.ground, 1.15]} />
            <directionalLight position={[60, 100, 40]} intensity={1.6} />
            <group ref={model}>
              <MergedBricks bricks={bricks} colorOf={merged} />
            </group>
            <Controls target={[0, 0, 0]} maxPolarAngle={Math.PI * 0.62} rightPan={false} />
            <Fit model={model} />
            <Spin />
          </Canvas>
          <IconButton className="preview-close" variant="glass" size="sm" onClick={onClose} aria-label="Close">
            ✕
          </IconButton>
          <p className="preview-tip">Drag to turn · scroll to zoom</p>
        </div>
        <footer className="preview-foot">
          <div className="preview-text">
            <h2>{title}</h2>
            {from && <p className="hint">{from}</p>}
            <p className="preview-facts">{facts.join(" · ")}</p>
          </div>
          <div className="preview-actions">
            <Button variant="glass" onClick={onEdit} title="Put it on the baseplate to change it">
              Edit on baseplate
            </Button>
            <Button variant="accent" onClick={onInstructions} title="Step-by-step instructions">
              Build it step by step
            </Button>
          </div>
        </footer>
      </Card>
    </div>
  );
}

const FOV = 32;

/**
 * Frame the model from what was drawn: from the front right and a little above,
 * the whole of it in view with a margin. Its parts load in batches, so it keeps
 * re-framing while the bounds still change, and stops once they've held for 15
 * frames, or when you take hold of it.
 */
function Fit({ model }: { model: React.RefObject<THREE.Group | null> }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void; addEventListener: (t: string, f: () => void) => void; removeEventListener: (t: string, f: () => void) => void } | null;
  const invalidate = useThree((s) => s.invalidate);
  const state = useRef({ done: false, still: 0, last: "" });
  useEffect(() => {
    if (!controls) return;
    const stop = () => (state.current.done = true);
    controls.addEventListener("start", stop);
    return () => controls.removeEventListener("start", stop);
  }, [controls]);
  useFrame(() => {
    const st = state.current;
    if (st.done || !model.current || !controls) return;
    invalidate(); // keep frames coming until it's settled
    const box = new THREE.Box3().setFromObject(model.current);
    if (box.isEmpty()) return;
    const key = [...box.min.toArray(), ...box.max.toArray()].map((v) => v.toFixed(2)).join(",");
    if (key === st.last) {
      if (++st.still >= 15) st.done = true;
      return;
    }
    st.last = key;
    st.still = 0;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const dist = (sphere.radius / Math.sin(((FOV / 2) * Math.PI) / 180)) * 1.08;
    const dir = new THREE.Vector3(0.62, 0.45, 0.64).normalize();
    camera.position.copy(sphere.center).addScaledVector(dir, dist);
    camera.near = dist / 50;
    camera.far = dist * 10;
    camera.updateProjectionMatrix();
    controls.target.copy(sphere.center);
    controls.update();
  });
  useEffect(() => invalidate(), [invalidate]);
  return null;
}

/** A slow turn until the first touch: the model shows all its sides by itself. */
function Spin() {
  const controls = useThree((s) => s.controls) as unknown as {
    autoRotate: boolean;
    autoRotateSpeed: number;
    addEventListener: (t: string, f: () => void) => void;
    removeEventListener: (t: string, f: () => void) => void;
  } | null;
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (!controls) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.2;
    const stop = () => (controls.autoRotate = false);
    controls.addEventListener("start", stop);
    invalidate();
    return () => controls.removeEventListener("start", stop);
  }, [controls, invalidate]);
  return null;
}
