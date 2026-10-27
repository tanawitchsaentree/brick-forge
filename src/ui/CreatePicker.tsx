import { useState } from "react";
import { KINDS, type Kind } from "../engine/assembly/kinds";

export type Start = { source: "builds"; kind: Kind | "all" } | { source: "characters" | "photo" | "model" | "shapes" };

const BLURB: Record<Kind, string> = {
  racer: "Open cockpit, driver, rear wing",
  car: "Headlights, windscreen, windows",
  house: "Walls, windows, roof, garden",
  dino: "9 species: T. rex, Triceratops, Stegosaurus…",
  robot: "Big eyes, arms, antenna",
  rocket: "Boosters, fins, nose cone",
};

// Previews are pre-rendered by scripts/build-thumbs.mjs (public/thumbs/builds),
// so this screen needs none of the engine to show up.
function Preview({ kind }: { kind: Kind }) {
  const [failed, setFailed] = useState(false);
  return failed ? <span className="thumb loading" /> : <img src={`/thumbs/builds/${kind}.webp`} alt="" onError={() => setFailed(true)} />;
}

/** "What do you want to build?" — the first choice, before any pieces or libraries. */
export function CreatePicker({ onPick, compact = false }: { onPick: (s: Start) => void; compact?: boolean }) {
  return (
    <div className={compact ? "picker compact" : "picker"}>
      <div className="picker-grid">
        {KINDS.map((k) => (
          <button key={k.id} className="pick" onClick={() => onPick({ source: "builds", kind: k.id })}>
            <span className="pick-img">
              <Preview kind={k.id} />
            </span>
            <b>{k.label}</b>
            {!compact && <span className="muted small">{BLURB[k.id]}</span>}
          </button>
        ))}
      </div>
      <div className="picker-more">
        <button onClick={() => onPick({ source: "builds", kind: "all" })}>✦ Surprise me</button>
        <button onClick={() => onPick({ source: "photo" })}>📷 From a photo</button>
        <button onClick={() => onPick({ source: "model" })}>⬚ From a 3D model</button>
        <button onClick={() => onPick({ source: "characters" })}>Voxel characters</button>
      </div>
    </div>
  );
}
