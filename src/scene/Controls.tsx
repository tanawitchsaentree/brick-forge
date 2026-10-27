import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

interface Props {
  target: [number, number, number];
  maxPolarAngle: number;
  rightPan: boolean;
}

/** three's OrbitControls, registered as R3F's default controls (no drei needed). */
export function Controls({ target, maxPolarAngle, rightPan }: Props) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const set = useThree((s) => s.set);
  const invalidate = useThree((s) => s.invalidate);
  const controls = useMemo(() => new OrbitControls(camera, gl.domElement), [camera, gl]);

  useEffect(() => {
    controls.target.set(...target);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.update();
    set({ controls });
    const onChange = () => invalidate();
    controls.addEventListener("change", onChange);
    return () => {
      controls.removeEventListener("change", onChange);
      controls.dispose();
      set({ controls: null });
    };
    // target is the initial focus only; afterwards the user owns it
  }, [controls, set, invalidate]);

  useEffect(() => {
    controls.maxPolarAngle = maxPolarAngle;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: rightPan ? THREE.MOUSE.PAN : (-1 as THREE.MOUSE),
    };
  }, [controls, maxPolarAngle, rightPan]);

  // update() reports whether the camera moved (e.g. damping still easing out).
  useFrame(() => {
    if (controls.update()) invalidate();
  }, -1);
  return null;
}
