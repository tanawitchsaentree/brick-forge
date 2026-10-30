import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { BASE_SIZE } from "../engine/units";
import { SCENE, useTheme } from "../ui/theme";

// The work table the model stands on (there is no baseplate): a cutting-mat grid drawn analytically in
// a shader, so lines stay crisp at any zoom.
//
//  • Spacing follows the bricks: minor line every stud (8 mm), major every
//    4 studs (32 mm, matching the rulers), a dot at each major crossing.
//  • Each line is anti-aliased with screen-space derivatives:
//        line(p, s) = 1 − min(|fract(p/s − ½) − ½| / fwidth(p/s), 1)
//    and fades out once cells shrink below a few pixels (no moiré far away):
//        density(s) = 1 − smoothstep(0.15, 0.45, fwidth(p/s))
//  • Ink falls off with a Gaussian from the middle, e^−(r/R)², so the
//    table melts into the background instead of ending at a hard edge.
//  • A Gaussian "lamp" under the cursor, e^−d²/2σ², lifts nearby lines; its
//    position and strength are eased with 1 − e^−k·dt for a smooth follow.
//  • A soft contact shadow, e^−λ·sd, using the signed distance to the plate.

const TABLE_Y = -0.002; // the ground itself: parts at level 0 stand on it (no baseplate)
const FADE_RADIUS = 90; // studs
const LAMP_SIGMA = 5.5; // studs
const noRaycast = () => null;

const vertexShader = /* glsl */ `
  varying vec2 vXZ;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vXZ = world.xz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  varying vec2 vXZ;
  uniform vec2 uCenter;
  uniform float uHalf;
  uniform vec2 uCursor;
  uniform float uLamp;
  uniform vec3 uInk;
  uniform vec3 uAccent;

  float line(vec2 p, float s) {
    vec2 q = p / s;
    vec2 g = abs(fract(q - 0.5) - 0.5) / fwidth(q);
    return 1.0 - min(min(g.x, g.y), 1.0);
  }

  float density(vec2 p, float s) {
    vec2 w = fwidth(p / s);
    return 1.0 - smoothstep(0.15, 0.45, max(w.x, w.y));
  }

  void main() {
    vec2 p = vXZ;
    float minor = line(p, 1.0) * density(p, 1.0);
    float major = line(p, 4.0) * density(p, 4.0);

    // Dot where major lines cross.
    vec2 m = (abs(fract(p / 4.0 - 0.5) - 0.5)) * 4.0;
    float aa = fwidth(length(p));
    float knot = 1.0 - smoothstep(0.11, 0.11 + aa * 1.5, length(m));

    float r = length(p - uCenter);
    float fade = exp(-pow(r / ${FADE_RADIUS.toFixed(1)}, 2.0));
    vec2 dc = p - uCursor;
    float lamp = uLamp * exp(-dot(dc, dc) / (2.0 * ${(LAMP_SIGMA * LAMP_SIGMA).toFixed(1)}));

    float ink = (minor * 0.045 + major * 0.09 + knot * 0.14) * fade
              + (minor * 0.11 + major * 0.14 + knot * 0.12) * lamp;

    // Contact shadow around a plate (signed distance to its square); none with uHalf 0.
    vec2 q = abs(p - uCenter) - vec2(uHalf);
    float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
    float shadow = uHalf > 0.0 && sd > 0.0 ? 0.14 * exp(-sd * 0.55) : 0.0;

    vec3 inkColor = mix(uInk, uAccent, clamp(lamp, 0.0, 1.0) * 0.55);
    float alpha = ink + shadow * (1.0 - ink);
    vec3 color = alpha > 0.0 ? (inkColor * ink + vec3(0.06, 0.08, 0.12) * shadow * (1.0 - ink)) / alpha : inkColor;
    gl_FragColor = vec4(color, alpha);
  }
`;

export function Table() {
  const get = useThree((s) => s.get);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const inside = useRef(false);
  const target = useMemo(() => new THREE.Vector3(), []);
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), -TABLE_Y), []);
  const ink = SCENE[useTheme()].ink;

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        uniforms: {
          uCenter: { value: new THREE.Vector2(BASE_SIZE / 2, BASE_SIZE / 2) },
          uHalf: { value: 0 },
          uCursor: { value: new THREE.Vector2(BASE_SIZE / 2, BASE_SIZE / 2) },
          uLamp: { value: 0 },
          uInk: { value: new THREE.Color("#4a5566") },
          uAccent: { value: new THREE.Color("#1f6feb") },
        },
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => {
    material.uniforms.uInk.value.set(ink);
    invalidate();
  }, [material, ink, invalidate]);

  useEffect(() => {
    const el = gl.domElement;
    const enter = () => {
      inside.current = true;
      invalidate(); // the lamp follows the pointer even when nothing else changes
    };
    const leave = () => {
      inside.current = false;
      invalidate();
    };
    el.addEventListener("pointerenter", enter);
    el.addEventListener("pointermove", enter);
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("pointerenter", enter);
      el.removeEventListener("pointermove", enter);
      el.removeEventListener("pointerleave", leave);
    };
  }, [gl, invalidate]);

  useFrame((state, dt) => {
    const { raycaster, pointer, camera } = get();
    raycaster.setFromCamera(pointer, camera);
    const hit = inside.current && raycaster.ray.intersectPlane(plane, target);
    const u = material.uniforms;
    // Exponential easing: frame-rate independent, never overshoots.
    let moving = false;
    if (hit) {
      const k = 1 - Math.exp(-dt * 14);
      const dx = target.x - u.uCursor.value.x, dz = target.z - u.uCursor.value.y;
      u.uCursor.value.x += dx * k;
      u.uCursor.value.y += dz * k;
      moving = Math.abs(dx) + Math.abs(dz) > 0.01;
    }
    const lampTo = hit ? 1 : 0;
    u.uLamp.value += (lampTo - u.uLamp.value) * (1 - Math.exp(-dt * 6));
    if (moving || Math.abs(lampTo - u.uLamp.value) > 0.003) state.invalidate();
  });

  return (
    <mesh
      position={[BASE_SIZE / 2, TABLE_Y, BASE_SIZE / 2]}
      rotation={[-Math.PI / 2, 0, 0]}
      material={material}
      raycast={noRaycast}
      renderOrder={-1}
    >
      <planeGeometry args={[420, 420]} />
    </mesh>
  );
}
