import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { PartDef } from "../engine/parts";
import { hasPrerendered, useThumbnail } from "../scene/thumbnails";

/**
 * A part's picture in the current colour. Uses the pre-rendered white image
 * tinted with CSS (mask + multiply), so changing colour costs nothing; parts
 * without one are rendered live once they scroll into view.
 */
export function PartThumb({ part, hex, size = 64 }: { part: PartDef; hex: string; size?: number }) {
  if (hasPrerendered(part.id)) {
    const src = `/thumbs/${part.id}.webp`;
    const style = { "--tint": hex, "--src": `url(${src})`, width: size, height: size } as CSSProperties;
    return (
      <span className="tthumb" style={style}>
        <img src={src} alt="" loading="lazy" decoding="async" draggable={false} />
      </span>
    );
  }
  return <LiveThumb part={part} hex={hex} size={size} />;
}

function LiveThumb({ part, hex, size }: { part: PartDef; hex: string; size: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setSeen(true), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  const url = useThumbnail(part, hex, seen);
  return url ? (
    <img className="thumb" src={url} alt="" draggable={false} style={{ width: size, height: size }} />
  ) : (
    <span ref={ref} className="thumb loading" style={{ width: size, height: size }} />
  );
}
