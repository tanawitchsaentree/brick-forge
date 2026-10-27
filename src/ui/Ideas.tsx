import { useEffect, useRef, useState } from "react";
import { colorOf } from "../engine/colors";
import { PARTS } from "../engine/parts";
import type { Inventory } from "../engine/inventory";
import {
  buildPalette,
  jitter,
  generateCharacter,
  requestGrid,
  requestIdeas,
  shoppingCSV,
  type Archetype,
  type Idea,
  type Level,
  type Personality,
} from "../engine/generate";
import { totalPieces } from "../engine/inventory";
import { KINDS, SPECIES, generateBuild, type Build, type Kind, type Species } from "../engine/assembly";
import { choose, type Recipe } from "../engine/learn/cookbook";
import { cookbook, teachChoice } from "../engine/learn/client";

/** A design built from a learned recipe carries it, so your choice can teach the engine. */
type Learned = Idea & { learned?: Pick<Recipe, "id" | "features" | "fitness" | "origin" | "gen"> };
import type { Start } from "./CreatePicker";
import { imageToGrid, modelToGrid } from "../engine/convert";
import type { PlacedBrick } from "../engine/grid";
import { renderModelImage, renderModelImageLDraw } from "../scene/thumbnails";

interface Props {
  /** What the user chose to build before opening (the picker), if anything. */
  start?: Start;
  inventory: Inventory;
  onBuild: (bricks: PlacedBrick[]) => void;
  onInstructions: (bricks: PlacedBrick[], title: string) => void;
  onClose: () => void;
}

type Source = "builds" | "characters" | "shapes" | "photo" | "model";
const SOURCES: { id: Source; label: string }[] = [
  { id: "builds", label: "Builds" },
  { id: "characters", label: "Voxel characters" },
  { id: "shapes", label: "Shapes" },
  { id: "photo", label: "Photo" },
  { id: "model", label: "3D model" },
];
const SIZES = ["S", "M", "L"];
const LEVELS = ["Easy", "Medium", "Hard"];
const ARCHETYPES: (Archetype | "all")[] = ["all", "dino", "racer", "monster", "robot", "car"];
const ARCH_LABEL: Record<Archetype | "all", string> = {
  all: "Surprise",
  dino: "Dinosaur",
  racer: "Race car",
  monster: "Monster",
  robot: "Robot",
  car: "Critter car",
};
const SURPRISE: Archetype[] = ["dino", "racer", "monster", "robot", "car", "dino"];
const stars = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);

const pct = (v: number) => `${Math.round(v * 100)}%`;

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  URL.revokeObjectURL(url);
}

/** Models the generator can make: from geometry recipes, a photo, or any 3D model. */
export function Ideas({ start, inventory, onBuild, onInstructions, onClose }: Props) {
  const [source, setSource] = useState<Source>(start?.source ?? "builds");
  const [kind, setKind] = useState<Kind | "all">(start?.source === "builds" ? start.kind : "all");
  const [species, setSpecies] = useState<Species | "all">("all");
  const [buildSize, setBuildSize] = useState(1);
  const [lvl, setLvl] = useState<0 | 1 | 2>(1);
  const [arch, setArch] = useState<Archetype | "all">("all");
  const [persona, setPersona] = useState<Personality>({ cute: 0.65, fierce: 0.35, quirky: 0.4 });
  // With an empty library there's nothing to limit to: design from any pieces.
  const [dream, setDream] = useState(() => totalPieces(inventory) === 0);
  const [pieces, setPieces] = useState(60);
  const [level, setLevel] = useState<Level>("medium");
  const [seed, setSeed] = useState(1);
  const [ideas, setIdeas] = useState<Idea[] | null>(start?.source === "photo" || start?.source === "model" ? [] : null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [images, setImages] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null); // idea whose parts list is open
  // Photo / model settings.
  const [file, setFile] = useState<File | null>(null);
  const [size, setSize] = useState(start?.source === "model" ? 16 : 32);
  const [dither, setDither] = useState(true);
  const [layers, setLayers] = useState<1 | 3>(3);
  const [hollow, setHollow] = useState(true);
  const run = useRef(0);

  // Picking one design over the others shown is a lesson in taste.
  const lesson = (chosen: Learned, strength: number) => {
    const shown = ((ideas ?? []) as Learned[]).flatMap((x) => (x.learned ? [x.learned.features] : []));
    if (chosen.learned && shown.length > 1) teachChoice(shown, chosen.learned.features, chosen.learned.id, strength);
  };

  const show = (list: Idea[], ms: number, extra = "", real = false) => {
    const id = ++run.current;
    setIdeas(list);
    setImages({});
    setNote(`${list.length} idea${list.length === 1 ? "" : "s"} in ${ms} ms${extra}`);
    // Render previews one at a time so the panel stays responsive. Characters
    // use real parts (their eyes are tiles on the front, invisible as blocks).
    let i = 0;
    const next = async () => {
      if (run.current !== id || i >= list.length) return;
      const idea = list[i++];
      const url = real ? await renderModelImageLDraw(idea.bricks) : renderModelImage(idea.bricks);
      if (run.current !== id) return;
      setImages((m) => ({ ...m, [key(idea)]: url }));
      requestAnimationFrame(next);
    };
    requestAnimationFrame(next);
  };

  // Builds (Assembly Grammar): instant, so no worker — six variants per click.
  useEffect(() => {
    if (source !== "builds") return;
    const kinds = kind === "all" ? KINDS.map((k) => k.id) : [kind];
    const list: (Build & Learned)[] = [];
    const t0 = performance.now();
    for (let i = 0; i < 6; i++) {
      const k = kinds[i % kinds.length];
      const s = seed * 31 + i;
      // Dinosaurs: one species asked for, or a different one on every card,
      // built from the best recipes the learning engine has found so far.
      const sp = k === "dino" ? (species !== "all" ? species : SPECIES[s % SPECIES.length].id) : undefined;
      const rec = sp ? choose(cookbook(), sp, buildSize, s) : null;
      const b = generateBuild(k, { size: buildSize, level: lvl, seed: s, mode: dream ? "any" : "mine", inv: inventory, species: sp, plan: rec?.plan });
      list.push({
        ...b,
        recipe: `build-${k}-${i}`,
        ...(rec ? { learned: { id: rec.id, features: rec.features, fitness: rec.fitness, origin: rec.origin, gen: rec.gen }, math: `${b.math} · recipe ${rec.origin} (gen ${rec.gen}), score ${(rec.fitness * 100).toFixed(0)}` } : {}),
      });
    }
    setBusy(null);
    show(list, Math.round(performance.now() - t0), "", true);
  }, [inventory, seed, dream, source, kind, species, buildSize, lvl]);

  // Characters: a family of six around the personality sliders.
  useEffect(() => {
    if (source !== "characters") return;
    let alive = true;
    setIdeas(null);
    setBusy("Sketching characters…");
    const palette = buildPalette(inventory, true, 3);
    const owned = new Set(buildPalette(inventory, false, 3));
    // Prefer colours the user owns for the body; fall back to the full palette.
    const pal = !dream && owned.size >= 3 ? [...owned] : palette;
    (async () => {
      const list: Idea[] = [];
      let ms = 0;
      for (let i = 0; i < 6; i++) {
        const s = seed * 97 + i;
        const a = arch === "all" ? SURPRISE[i] : arch;
        const r = await generateCharacter(inventory, a, jitter(persona, s), s, pal, pieces, level, dream);
        if (!alive) return;
        list.push({ ...r.idea, recipe: `char-${a}-${i}`, seed: s });
        ms += r.ms;
      }
      if (!alive) return;
      setBusy(null);
      show(list, ms, "", true);
    })();
    return () => {
      alive = false;
    };
  }, [inventory, seed, dream, source, arch, persona, pieces, level]);

  // Recipes: rerun whenever the library, seed or mode changes.
  useEffect(() => {
    if (source !== "shapes") return;
    let alive = true;
    setIdeas(null);
    setBusy("Searching shapes your pieces can finish…");
    requestIdeas(inventory, seed, dream).then(({ ideas, ms }) => {
      if (!alive) return;
      setBusy(null);
      show(ideas, ms);
    });
    return () => {
      alive = false;
    };
  }, [inventory, seed, dream, source]);

  // Photo / model: rerun when the file or settings change.
  useEffect(() => {
    if (source === "shapes" || !file) return;
    let alive = true;
    setIdeas(null);
    setBusy(source === "photo" ? "Matching colours…" : "Voxelising the model…");
    (async () => {
      try {
        if (source === "photo") {
          const palette = buildPalette(inventory, dream, 1);
          if (!palette.length) throw new Error("My Library has no plates or tiles yet: add some, or switch to Any pieces.");
          const variants = dither ? [true, false] : [false];
          const out: Idea[] = [];
          let ms = 0;
          for (const d of variants) {
            const { grid, roleColors } = await imageToGrid(file, size, palette, d);
            const r = await requestGrid(inventory, grid, roleColors, {
              recipe: d ? "photo-dither" : "photo-flat",
              title: d ? "Photo mosaic · dithered" : "Photo mosaic · posterised",
              math: d
                ? "Floyd–Steinberg error diffusion in CIELAB: each pixel's colour error flows to its neighbours."
                : "Nearest LEGO colour per stud by ΔE in CIELAB, no diffusion: flat poster look.",
            }, dream);
            out.push(r.idea);
            ms += r.ms;
          }
          if (alive) show(out, ms, ` · ${out[0].W}×${out[0].D} studs`);
        } else {
          const palette = buildPalette(inventory, dream, layers);
          if (!palette.length) throw new Error("My Library has no plain parts of that height yet: add some, or switch to Any pieces.");
          const { grid, roleColors, triangles } = await modelToGrid(file, size, layers, palette, hollow);
          const r = await requestGrid(inventory, grid, roleColors, {
            recipe: "model",
            title: file.name.replace(/\.[^.]+$/, ""),
            math: `Voxelised from ${triangles.toLocaleString()} triangles: surface sampling, outside flood-fill, ${hollow ? "2-stud shell" : "solid"}.`,
          }, dream);
          if (alive) show([r.idea], r.ms, ` · ${grid.W}×${grid.D}×${grid.L} cells`);
        }
      } catch (err) {
        if (alive) setNote(err instanceof Error ? err.message : String(err));
        if (alive) setIdeas([]);
      } finally {
        if (alive) setBusy(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [file, size, dither, layers, hollow, dream, source, inventory]);

  const accept = source === "photo" ? "image/*" : ".glb,.gltf,.stl,.obj";

  return (
    <section className="ideas card" role="dialog" aria-label="Ideas">
      <header className="ideas-head">
        <div className="ideas-title">
          <h2>Ideas</h2>
          <div className="seg small">
            {SOURCES.map(({ id: s, label }) => (
              <button
                key={s}
                className={source === s ? "on" : ""}
                onClick={() => {
                  setSource(s);
                  setFile(null);
                  setIdeas(s === "photo" || s === "model" ? [] : null);
                  setSize(s === "model" ? 16 : 32);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="seg small" title="Only what you own, or design at full size and see what to buy">
            <button className={dream ? "on" : ""} onClick={() => setDream(true)}>
              Any pieces
            </button>
            <button
              className={!dream ? "on" : ""}
              onClick={() => setDream(false)}
              disabled={totalPieces(inventory) === 0}
              title={totalPieces(inventory) === 0 ? "Add pieces to My Library first" : "Build only from My Library"}
            >
              Only mine
            </button>
          </div>
        </div>
        <div className="ideas-actions">
          {(source === "shapes" || source === "characters" || source === "builds") && (
            <button onClick={() => setSeed((s) => s + 1)} disabled={!!busy}>
              ↻ Shuffle
            </button>
          )}
          <button onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
      </header>

      {source === "builds" && (
        <div className="ideas-input persona">
          <div className="seg small">
            <button className={kind === "all" ? "on" : ""} onClick={() => setKind("all")}>
              Surprise
            </button>
            {KINDS.map((k) => (
              <button key={k.id} className={kind === k.id ? "on" : ""} onClick={() => setKind(k.id)}>
                {k.label}
              </button>
            ))}
          </div>
          {kind === "dino" && (
            <div className="seg small wrap" title="Species">
              <button className={species === "all" ? "on" : ""} onClick={() => setSpecies("all")}>
                All species
              </button>
              {SPECIES.map((sp) => (
                <button key={sp.id} className={species === sp.id ? "on" : ""} onClick={() => setSpecies(sp.id)} title={sp.latin}>
                  {sp.label}
                </button>
              ))}
            </div>
          )}
          <div className="seg small" title="Size">
            {SIZES.map((label, i) => (
              <button key={label} className={buildSize === i ? "on" : ""} onClick={() => setBuildSize(i)}>
                {label}
              </button>
            ))}
          </div>
          <div className="seg small" title="Easy: the essentials · Hard: finishing tiles, grilles, details">
            {LEVELS.map((label, i) => (
              <button key={label} className={lvl === i ? "on" : ""} onClick={() => setLvl(i as 0 | 1 | 2)}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {source === "characters" && (
        <div className="ideas-input persona">
          <div className="seg small">
            {ARCHETYPES.map((a) => (
              <button key={a} className={arch === a ? "on" : ""} onClick={() => setArch(a)}>
                {ARCH_LABEL[a]}
              </button>
            ))}
          </div>
          <label className="slider" title="Target number of pieces">
            <span>Pieces</span>
            <input type="range" min={20} max={400} step={10} value={pieces} onChange={(e) => setPieces(Number(e.target.value))} />
            <b>{pieces}</b>
          </label>
          <div className="seg small" title="Easy: big parts, brick layers · Hard: plate layers, more detail">
            {(["easy", "medium", "hard"] as Level[]).map((lv) => (
              <button key={lv} className={level === lv ? "on" : ""} onClick={() => setLevel(lv)}>
                {lv[0].toUpperCase() + lv.slice(1)}
              </button>
            ))}
          </div>
          {(["cute", "fierce", "quirky"] as (keyof Personality)[]).map((k) => (
            <label key={k} className="slider">
              <span>{k[0].toUpperCase() + k.slice(1)}</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={persona[k]}
                onChange={(e) => setPersona((p) => ({ ...p, [k]: Number(e.target.value) }))}
              />
              <b>{Math.round(persona[k] * 100)}</b>
            </label>
          ))}
        </div>
      )}

      {(source === "photo" || source === "model") && (
        <div className="ideas-input">
          <label className="file">
            <input type="file" accept={accept} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <span>{file ? file.name : source === "photo" ? "Choose a photo…" : "Choose a .glb / .stl / .obj…"}</span>
          </label>
          <label>
            {source === "photo" ? "Width" : "Widest side"}
            <select value={size} onChange={(e) => setSize(Number(e.target.value))}>
              {(source === "photo" ? [16, 24, 32] : [8, 12, 16, 20, 24, 32]).map((n) => (
                <option key={n} value={n}>
                  {n} studs · {n * 8} mm
                </option>
              ))}
            </select>
          </label>
          {source === "photo" ? (
            <label className="toggle">
              <input type="checkbox" checked={dither} onChange={(e) => setDither(e.target.checked)} /> Also dithered
            </label>
          ) : (
            <>
              <label>
                Layers
                <select value={layers} onChange={(e) => setLayers(Number(e.target.value) as 1 | 3)}>
                  <option value={3}>Bricks (9.6 mm)</option>
                  <option value={1}>Plates (3.2 mm, finer)</option>
                </select>
              </label>
              <label className="toggle">
                <input type="checkbox" checked={hollow} onChange={(e) => setHollow(e.target.checked)} /> Hollow inside
              </label>
            </>
          )}
        </div>
      )}

      <p className="muted small ideas-note">
        {busy ?? note ?? ""}
        {dream && !busy && " · Any pieces: standard parts in any quantity; each card shows what you'd need to buy."}
      </p>

      {busy || !ideas ? (
        <div className="ideas-loading">{busy ?? "…"}</div>
      ) : ideas.length === 0 ? (
        <div className="ideas-loading">
          {source === "shapes" || source === "characters"
            ? "Not enough plain bricks, plates or tiles yet. Add some, try the sample bucket, or switch to Any pieces."
            : file
              ? ""
              : source === "photo"
                ? "Pick a photo: it becomes a flat mosaic in LEGO colours."
                : "Pick a 3D model: anything becomes bricks."}
        </div>
      ) : (
        <div className="ideas-grid">
          {ideas.map((idea) => {
            const k = key(idea);
            const buy = idea.needs.reduce((s, n) => s + n.need - n.have, 0);
            const have = idea.pieces - buy;
            return (
              <article key={k} className="idea">
                <div className="idea-img">
                  {images[k] ? <img src={images[k]} alt="" /> : <span className="thumb loading" />}
                </div>
                <div className="idea-body">
                  <h3>{idea.title}</h3>
                  <p className="muted small">{idea.math}</p>
                  {idea.recipe !== "model" && !idea.recipe.startsWith("photo") && !idea.recipe.startsWith("char") && (
                    <div className="palette">
                      {idea.palette.map((p) => (
                        <span key={p.role} title={`${p.role}: ${colorOf(p.color).name}`}>
                          <i className="dot" style={{ background: colorOf(p.color).hex }} />
                          {p.role}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="level-line" title={`Difficulty score ${idea.difficulty.score.toFixed(1)} · ${idea.difficulty.types} part types · ${idea.difficulty.subassemblies} sub-assemblies`}>
                    <span className="stars">{stars(idea.difficulty.stars)}</span>
                    <b>{idea.difficulty.label}</b>
                    <span className="muted">
                      Ages {idea.difficulty.age}+ · ~{idea.difficulty.minutes} min
                    </span>
                  </p>
                  {"modules" in idea && (
                    <div className="modules" title="What it's made of: modules (sub-assemblies) and their parts">
                      {(idea as Build).modules.map((m) => (
                        <span key={m.name}>
                          {m.name} <b>{m.parts}</b>
                        </span>
                      ))}
                    </div>
                  )}
                  {"metrics" in idea && (
                    <div className="metrics small">
                      <span title="Studs of volume per piece: higher means fewer, better-used parts">
                        Efficiency <b>{(idea as Build).metrics.efficiency.toFixed(1)}</b>
                      </span>
                      <span title="Share of pieces that are not plain bricks, plates or tiles">
                        Special parts <b>{Math.round((idea as Build).metrics.special * 100)}%</b>
                      </span>
                      <span title="Pieces with a mirror twin">
                        Symmetry <b>{Math.round((idea as Build).metrics.symmetry * 100)}%</b>
                      </span>
                      <span>
                        Part types <b>{(idea as Build).metrics.types}</b>
                      </span>
                    </div>
                  )}
                  <dl className="stats">
                    <div>
                      <dt>Size</dt>
                      <dd>
                        {idea.mm.map((v) => Math.round(v)).join("×")}
                        <span className="muted"> mm</span>
                      </dd>
                    </div>
                    <div>
                      <dt>Pieces</dt>
                      <dd>
                        {idea.pieces}
                        {idea.slopes > 0 && <span className="muted"> · {idea.slopes}◢</span>}
                      </dd>
                    </div>
                    <div>
                      <dt>Weight</dt>
                      <dd>
                        {Math.round(idea.massG)}
                        <span className="muted"> g</span>
                      </dd>
                    </div>
                    <div>
                      <dt>Complete</dt>
                      <dd className={idea.coverage > 0.95 ? "ok" : ""}>{pct(idea.coverage)}</dd>
                    </div>
                    <div title="Load ÷ clutch capacity at the weakest joint; under 100 % holds">
                      <dt>Stability</dt>
                      <dd className={idea.stress <= 1 ? "ok" : "bad"}>
                        {idea.stress <= 1 ? "Holds" : "Weak"} <span className="muted">{pct(Math.min(idea.stress, 9.99))}</span>
                      </dd>
                    </div>
                    <div>
                      <dt>You have</dt>
                      <dd className={buy === 0 ? "ok" : ""}>{pct(idea.pieces ? have / idea.pieces : 0)}</dd>
                    </div>
                  </dl>
                  {(idea.substituted > 0 || idea.missing > 0) && (
                    <p className="muted small">
                      {idea.substituted > 0 && `${idea.substituted} studs in a stand-in colour. `}
                      {idea.missing > 0 && `${idea.missing} spots left open (no piece fits).`}
                    </p>
                  )}
                  <div className="idea-actions">
                    <button className="primary" onClick={() => { lesson(idea, 1); onBuild(idea.bricks); }}>
                      Build this
                    </button>
                    <button className="steps-btn" onClick={() => { lesson(idea, 0.5); onInstructions(idea.bricks, idea.title); }} title="Step-by-step instructions">
                      Steps
                    </button>
                    {buy > 0 && (
                      <button onClick={() => setOpen(open === k ? null : k)} title="Pieces to buy">
                        Buy {buy}
                      </button>
                    )}
                  </div>
                  {open === k && <ShoppingList idea={idea} />}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

const key = (i: Idea) => `${i.recipe}:${i.size}:${i.seed}`;

function ShoppingList({ idea }: { idea: Idea }) {
  const rows = idea.needs
    .map((n) => ({ ...n, qty: n.need - n.have }))
    .filter((r) => r.qty > 0)
    .sort((a, b) => b.qty - a.qty);
  return (
    <div className="shopping">
      <ul>
        {rows.slice(0, 12).map((r) => (
          <li key={`${r.partId}:${r.color}`}>
            <i className="dot" style={{ background: colorOf(r.color).hex }} />
            <span>{PARTS[r.partId]?.name ?? r.partId}</span>
            <span className="muted">{colorOf(r.color).name}</span>
            <b>×{r.qty}</b>
          </li>
        ))}
        {rows.length > 12 && <li className="muted">…and {rows.length - 12} more lines</li>}
      </ul>
      <button onClick={() => download(`${idea.recipe}-shopping.csv`, shoppingCSV(rows))}>
        Download CSV (Rebrickable format)
      </button>
    </div>
  );
}
