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
import type { Build } from "../engine/assembly";
import type { Recipe } from "../engine/learn/cookbook";
import { teachChoice } from "../engine/learn/client";

/** A design built from a learned recipe carries it, so your choice can teach the engine. */
type Learned = Idea & { learned?: Pick<Recipe, "id" | "features" | "fitness" | "origin" | "gen"> };
import type { Start } from "./CreatePicker";
import { imageToGrid, modelToGrid } from "../engine/convert";
import type { PlacedBrick } from "../engine/grid";
import { renderModelImage, renderModelImageLDraw } from "../scene/thumbnails";
import { Studio } from "./Studio";
import { Choice } from "./Choice";
import { Button, Card, IconButton, Select, Slider, Switch } from "pane-react";

interface Props {
  /** What the user chose to build before opening (the picker), if anything. */
  start?: Start;
  inventory: Inventory;
  onBuild: (bricks: PlacedBrick[]) => void;
  onInstructions: (bricks: PlacedBrick[], title: string) => void;
  onClose: () => void;
}

// Builds is the journey; photo and 3D file are the way in from a file of your own.
// (Characters and shapes, the older voxel generators, are no longer offered.)
type Source = "builds" | "characters" | "shapes" | "photo" | "model";
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
          if (!palette.length) throw new Error("My pieces has no plates or tiles yet: add some, or turn off Only my pieces.");
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
          if (!palette.length) throw new Error("My pieces has no plain parts of that height yet: add some, or turn off Only my pieces.");
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
    <Card as="section" className="ideas card" role="dialog" aria-label="Ideas">
      <header className="ideas-head">
        <div className="ideas-title">
          <h2 className="ideas-name">{source === "builds" ? "New designs" : "From a file"}</h2>
          {(source === "photo" || source === "model") && (
            <Choice
              label="File"
              value={source}
              onChange={(v) => {
                const s = v as typeof source;
                setSource(s);
                setFile(null);
                setIdeas([]);
                setSize(s === "model" ? 16 : 32);
              }}
              options={[
                { value: "photo", label: "Photo" },
                { value: "model", label: "3D file" },
              ]}
            />
          )}
          {source !== "builds" && totalPieces(inventory) > 0 && (
            <span title="Only what you own, or design at full size and see what to buy">
              <Switch label="Only my pieces" checked={!dream} onCheckedChange={(on) => setDream(!on)} />
            </span>
          )}
        </div>
        <div className="ideas-actions">
          {(source === "shapes" || source === "characters") && (
            <Button variant="glass" size="sm" onClick={() => setSeed((s) => s + 1)} disabled={!!busy}>
              ↻ Shuffle
            </Button>
          )}
          <IconButton variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            ✕
          </IconButton>
        </div>
      </header>

      {source === "characters" && (
        <div className="ideas-input persona">
          <Choice label="Character" value={arch} onChange={(v) => setArch(v as typeof arch)} options={ARCHETYPES.map((a) => ({ value: a, label: ARCH_LABEL[a] }))} />
          <Slider label="Pieces" min={20} max={400} step={10} value={pieces} onValueChange={setPieces} />
          <Choice
            label="Difficulty"
            title="Easy: big parts, brick layers · Hard: plate layers, more detail"
            value={level}
            onChange={(v) => setLevel(v as Level)}
            options={(["easy", "medium", "hard"] as Level[]).map((lv) => ({ value: lv, label: lv[0].toUpperCase() + lv.slice(1) }))}
          />
          {(["cute", "fierce", "quirky"] as (keyof Personality)[]).map((k) => (
            <Slider
              key={k}
              label={k[0].toUpperCase() + k.slice(1)}
              min={0}
              max={1}
              step={0.05}
              value={persona[k]}
              format={(v) => String(Math.round(v * 100))}
              onValueChange={(v) => setPersona((p) => ({ ...p, [k]: v }))}
            />
          ))}
        </div>
      )}

      {(source === "photo" || source === "model") && (
        <div className="ideas-input">
          <label className="file">
            <input type="file" accept={accept} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <span>{file ? file.name : source === "photo" ? "Choose a photo…" : "Choose a .glb / .stl / .obj…"}</span>
          </label>
          <Select
            size="sm"
            label={source === "photo" ? "Width" : "Widest side"}
            value={String(size)}
            onValueChange={(v) => setSize(Number(v))}
            options={(source === "photo" ? [16, 24, 32] : [8, 12, 16, 20, 24, 32]).map((n) => ({ value: String(n), label: `${n} studs · ${n * 8} mm` }))}
          />
          {source === "photo" ? (
            <Switch label="Also dithered" checked={dither} onCheckedChange={setDither} />
          ) : (
            <>
              <Select
                size="sm"
                label="Layers"
                value={String(layers)}
                onValueChange={(v) => setLayers(Number(v) as 1 | 3)}
                options={[
                  { value: "3", label: "Bricks (9.6 mm)" },
                  { value: "1", label: "Plates (3.2 mm, finer)" },
                ]}
              />
              <Switch label="Hollow inside" checked={hollow} onCheckedChange={setHollow} />
            </>
          )}
        </div>
      )}

      {source !== "builds" && (
        <p className="hint ideas-note">
          {busy ?? note ?? ""}
          {dream && !busy && " · Any pieces: standard parts in any quantity; each card shows what you'd need to buy."}
        </p>
      )}

      {source === "builds" ? (
        <Studio start={start?.source === "builds" ? start.kind : "all"} inventory={inventory} onBuild={onBuild} onInstructions={onInstructions} />
      ) : busy || !ideas ? (
        <div className="ideas-loading">{busy ?? "…"}</div>
      ) : ideas.length === 0 ? (
        <div className="ideas-loading">
          {source === "shapes" || source === "characters"
            ? "Not enough plain bricks, plates or tiles yet. Add some, try the sample bucket, or turn off Only my pieces."
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
              <Card as="article" key={k} className="idea">
                <div className="idea-img">
                  {images[k] ? <img src={images[k]} alt="" /> : <span className="thumb loading" />}
                </div>
                <div className="idea-body">
                  <h3>{idea.title}</h3>
                  <p className="hint">{idea.math}</p>
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
                      {[...(idea as Build).modules].sort((a, b) => b.parts - a.parts).slice(0, 6).map((m) => (
                        <span key={m.name}>
                          {m.name} <b>{m.parts}</b>
                        </span>
                      ))}
                      {(idea as Build).modules.length > 6 && <span className="muted">+{(idea as Build).modules.length - 6} more</span>}
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
                      {"held" in idea && (idea as Build).held !== undefined ? (
                        <dd className={(idea as Build).held! >= 0.95 ? "ok" : "bad"} title="Share of parts held together by studs, pins and clips">
                          Held {pct((idea as Build).held!)}
                        </dd>
                      ) : "real" in idea && (idea as Build).real ? (
                        // Exact (off-grid) parts aren't load-tested yet; the design itself shipped as a set.
                        <dd className="ok" title="An official LEGO design, built and sold as a set">Real set</dd>
                      ) : (
                        <dd className={idea.stress <= 1 ? "ok" : "bad"}>
                          {idea.stress <= 1 ? "Holds" : "Weak"} <span className="muted">{pct(Math.min(idea.stress, 9.99))}</span>
                        </dd>
                      )}
                    </div>
                    <div>
                      <dt>You have</dt>
                      <dd className={buy === 0 ? "ok" : ""}>{pct(idea.pieces ? have / idea.pieces : 0)}</dd>
                    </div>
                  </dl>
                  {(idea.substituted > 0 || idea.missing > 0) && (
                    <p className="hint">
                      {idea.substituted > 0 && `${idea.substituted} studs in a stand-in colour. `}
                      {idea.missing > 0 && `${idea.missing} spots left open (no piece fits).`}
                    </p>
                  )}
                  <div className="idea-actions">
                    <Button variant="accent" size="sm" onClick={() => { lesson(idea, 1); onInstructions(idea.bricks, idea.title); }} title="Step-by-step instructions">
                      Build it
                    </Button>
                    <Button variant="glass" size="sm" onClick={() => { lesson(idea, 0.5); onBuild(idea.bricks); }} title="Put it on the baseplate to change it">
                      Edit
                    </Button>
                    {buy > 0 && (
                      <Button variant="glass" size="sm" onClick={() => setOpen(open === k ? null : k)} title="Pieces to buy" aria-expanded={open === k}>
                        Buy {buy}
                      </Button>
                    )}
                  </div>
                  {open === k && <ShoppingList idea={idea} />}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </Card>
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
      <Button variant="glass" size="sm" onClick={() => download(`${idea.recipe}-shopping.csv`, shoppingCSV(rows))}>
        Download CSV (Rebrickable format)
      </Button>
    </div>
  );
}
