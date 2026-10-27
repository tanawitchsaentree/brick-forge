import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

interface Props {
  text: string;
  position: [number, number, number];
  color?: string;
  background?: string;
  size?: number; // height as a fraction of the viewport height
  opacity?: number;
}

const FONT_PX = 48;
const noRaycast = () => null;

// With sizeAttenuation off, sprite scale is in view-space units per unit of
// depth; for the 45° fov camera the viewport is ~0.83 of those units tall.
const VIEW_H = 2 * Math.tan((45 / 2) * (Math.PI / 180));

/** Camera-facing text with a constant on-screen size; always rendered on top. */
export function Label({ text, position, color = "#5b6573", background, size = 0.022, opacity = 1 }: Props) {
  const mat = useRef<THREE.SpriteMaterial>(null);
  // Fade in on mount and ease toward the target opacity.
  useFrame((state, dt) => {
    const m = mat.current;
    if (!m || Math.abs(m.opacity - opacity) <= 0.002) return;
    m.opacity += (opacity - m.opacity) * (1 - Math.exp(-dt * 10));
    state.invalidate(); // frames are on demand: ask for the next one until settled
  });

  const { texture, aspect } = useMemo(() => {
    const pad = background ? 14 : 2;
    const font = `600 ${FONT_PX}px ui-monospace, Menlo, monospace`;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    ctx.font = font;
    canvas.width = Math.ceil(ctx.measureText(text).width) + pad * 2;
    canvas.height = FONT_PX + pad * 2;
    ctx.font = font; // resizing the canvas resets context state
    if (background) {
      ctx.fillStyle = background;
      ctx.beginPath();
      ctx.roundRect(0, 0, canvas.width, canvas.height, 12);
      ctx.fill();
    }
    ctx.fillStyle = color;
    ctx.textBaseline = "middle";
    ctx.fillText(text, pad, canvas.height / 2 + 2);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return { texture: tex, aspect: canvas.width / canvas.height };
  }, [text, color, background]);

  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <sprite
      position={position}
      scale={[size * VIEW_H * aspect, size * VIEW_H, 1]}
      renderOrder={background ? 11 : 10}
      raycast={noRaycast}
    >
      <spriteMaterial ref={mat} map={texture} depthTest={false} transparent opacity={0} sizeAttenuation={false} />
    </sprite>
  );
}
