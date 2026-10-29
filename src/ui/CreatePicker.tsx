import { useState } from "react";
import { KINDS, type Kind } from "../engine/assembly/kinds";

export type Start = { source: "builds"; kind: Kind | "all" } | { source: "characters" | "photo" | "model" | "shapes" };

// What each choice builds from: real designs in the corpus (scripts/build-corpus.mjs).
const BLURB: Record<Kind, string> = {
  racer: "Built like Speed Champions: wings, halo, driver",
  car: "68 real cars: Speed Champions, Racers, Creator",
  house: "35 real houses: cottages, lodges, town houses",
  dino: "Nine species, built from their anatomy",
  robot: "17 real robots and Mixels",
  rocket: "Real rockets and shuttles, up to Saturn V",
};

// Previews are pre-rendered by scripts/build-thumbs.mjs (public/thumbs/builds),
// so this screen needs none of the engine to show up.
function Preview({ kind }: { kind: Kind }) {
  const [failed, setFailed] = useState(false);
  return failed ? <span className="thumb loading" /> : <img src={`/thumbs/builds/${kind}.webp`} alt="" onError={() => setFailed(true)} />;
}

/**
 * "What do you want to build?" — the one first choice. The six kinds are the
 * answer; everything else is a quiet way round it (let it pick, or start from
 * a file), so nothing competes with them.
 */
export function CreatePicker({ onPick }: { onPick: (s: Start) => void }) {
  return (
    <div className="picker">
      <div className="picker-grid">
        {KINDS.map((k) => (
          <button key={k.id} className="pick" onClick={() => onPick({ source: "builds", kind: k.id })}>
            <span className="pick-img">
              <Preview kind={k.id} />
            </span>
            <b>{k.label}</b>
            <span className="hint">{BLURB[k.id]}</span>
          </button>
        ))}
      </div>
      <p className="picker-more">
        <button className="link" onClick={() => onPick({ source: "builds", kind: "all" })}>
          Can't choose? Mix them all
        </button>
        <span aria-hidden>·</span>
        <button className="link" onClick={() => onPick({ source: "photo" })}>
          Turn a photo or 3D file into bricks
        </button>
      </p>
    </div>
  );
}
