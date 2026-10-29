import { useEffect, useRef, useState } from "react";
import { KINDS, type Kind } from "../engine/assembly/kinds";
import { F1_ANCHOR, LIVERIES, SPECIES, evaluateBuild, generateBuild, kindLabel, type Build } from "../engine/assembly";
import { totalPieces, type Inventory } from "../engine/inventory";
import type { PlacedBrick } from "../engine/grid";
import { TIERS, tierLabel, type Tier } from "../engine/style";
import { corpusIndex, inBand, loadDesign, recolor, SCHEME_COUNT, type CorpusModel } from "../scene/corpus";
import { describe, engineDesign, parallel, type Variation } from "../scene/engine";
import { renderModelImageLDraw } from "../scene/thumbnails";
import { colorOf } from "../engine/colors";
import { PARTS } from "../engine/parts";
import { Badge, Button, Card, IconButton, Select, Switch, Tag } from "pane-react";
import { Choice } from "./Choice";
import { ModelPreview } from "./ModelPreview";

// The build studio: say what you want, and it makes it — again and again.
// Every press of Generate designs new models (a real design varied: longer,
// shorter, crossed with another; repainted; rebuilt by the learned engine),
// added to what's already there. LEGO's own sets are one switch away, as
// inspiration.

const LEVELS: Tier[] = ["junior", "creator", "advanced", "expert", "master"];
const SIZES = ["S", "M", "L"];
const BATCH = 6;

interface Tile {
  id: number;
  status: "pending" | "done" | "failed";
  label: string;
  build?: Build;
  from?: string;
  img?: string;
}

interface Props {
  start: Kind | "all";
  inventory: Inventory;
  onBuild: (bricks: PlacedBrick[]) => void;
  onInstructions: (bricks: PlacedBrick[], title: string) => void;
}

const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];
const pct = (v: number) => `${Math.round(v * 100)}%`;

/**
 * A new variation of a design, chosen at random each time: longer or
 * shorter by whole studs, or (houses, rockets) wider, each rebuilt from the
 * designer's own parts with a copied section. (Crossing two designs by
 * blending their shapes is left out: the blend is a shape no designer made,
 * so few original parts fit and it came out messy and slow.)
 */
function variation(kind: Kind): Variation {
  const r = Math.random();
  if ((kind === "house" || kind === "rocket") && r < 0.3) return { kind: "wider", studs: 1 + Math.floor(Math.random() * 2) };
  if (r < 0.75) return { kind: "longer", studs: 1 + Math.floor(Math.random() * 4) };
  return { kind: "shorter", studs: -1 - Math.floor(Math.random() * 2) };
}

export function Studio({ start, inventory, onBuild, onInstructions }: Props) {
  const [kind, setKind] = useState<Kind | "all">(start);
  const [tier, setTier] = useState<Tier>("advanced");
  const [technic, setTechnic] = useState(false);
  const [size, setSize] = useState(1);
  const [mine, setMine] = useState(false);
  const [mode, setMode] = useState<"new" | "sets">("new");
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [viewing, setViewing] = useState<number | null>(null); // the tile shown in 3D
  const [working, setWorking] = useState(false);
  const run = useRef(0);
  const nextId = useRef(1);
  const level: Tier = technic ? "technic" : tier;

  const update = (id: number, patch: Partial<Tile>) => setTiles((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  /** Add a batch of new tiles and fill them one by one. */
  const opened = useRef(false);
  async function generate(fresh = false) {
    const token = fresh ? ++run.current : run.current;
    const models = await corpusIndex();
    const batch: Tile[] = Array.from({ length: BATCH }, () => ({ id: nextId.current++, status: "pending", label: "Designing…" }));
    setTiles((ts) => (fresh ? batch : [...ts, ...batch]));
    setWorking(true);
    // The first batch waits for the panel's opening rise (--slow, 420 ms): building
    // runs on this thread in long tasks (up to ~350 ms) that would freeze it midway.
    if (!opened.current) {
      await new Promise((r) => setTimeout(r, 460));
      if (run.current !== token) return; // (a re-run during the wait waits too: the flag is set after)
      opened.current = true;
    }
    // Several at once (one per worker); each tile fills in as soon as it's built.
    const queue = [...batch];
    const lane = async () => {
      for (let t = queue.shift(); t; t = queue.shift()) {
        if (run.current !== token) return;
        const k = kind === "all" ? pick(KINDS).id : kind;
        try {
          if (mode === "sets") await fillSet(t, k, models);
          else await fillNew(t, k, models, token);
        } catch {
          update(t.id, { status: "failed", label: "Couldn't build this one" });
        }
      }
    };
    await Promise.all(Array.from({ length: mode === "sets" ? 2 : parallel() }, lane));
    if (run.current === token) setWorking(false);
  }

  async function fillNew(t: Tile, k: Kind, models: CorpusModel[], token: number) {
    if (k === "dino" && level !== "technic") return fillDino(t);
    if (k === "racer" && level !== "technic") return fillRacer(t);
    const pool = level === "technic" ? models.filter((m) => m.tier === "technic").map((m) => ({ ...m, kind: k })) : inBand(models, k, size);
    if (!pool.length) return update(t.id, { status: "failed", label: "No designs to start from" });
    const base = pick(pool);
    const v = variation(k);
    update(t.id, { label: `${base.name}…` });
    const d = await engineDesign(base, v, level, k === "dino" || k === "robot");
    if (run.current !== token) return;
    let bricks = d.bricks;
    let scheme = "";
    // Half the time, a new paint job too.
    if (Math.random() < 0.5) {
      const r = recolor(bricks, Math.floor(Math.random() * SCHEME_COUNT));
      if (r) ({ bricks, name: scheme } = r);
    }
    const build = evaluateBuild(
      k,
      { title: technic ? "Technic model" : kindLabel(k), rule: `${tierLabel(level)} · shape fit ${pct(d.fit)}${d.made ? ` · ${d.made} made to measure` : ""}`, size, seed: t.id, recipe: `studio-${t.id}` },
      bricks.map((b) => ({ ...b, group: "Build" })),
      inventory,
    );
    const from = `From ${base.name}, ${describe(v)}${scheme ? `, in ${scheme}` : ""}`;
    update(t.id, { status: "done", build: { ...build, held: d.held }, from, label: "" });
    update(t.id, { img: await renderModelImageLDraw(bricks, 360) });
  }

  /**
   * Dinosaurs come from their DNA, not from the corpus: the corpus has only three,
   * small 3-in-1 alternates, and stretching those breaks them. The rig
   * (engine/assembly/dino.ts) builds a species from its body plan: torso, neck,
   * head and jaw, tail sections on ball joints, legs solved by two-bone IK,
   * lofted bodies with curved slopes. Level sets the detail and, for Expert and
   * Master, the scale.
   */
  async function fillDino(t: Tile) {
    const sp = pick(SPECIES);
    update(t.id, { label: `${sp.label}…` });
    await new Promise((r) => setTimeout(r)); // let the tile show before the build runs
    const detail = level === "junior" ? 0 : level === "creator" ? 1 : 2;
    // Expert goes a scale up (still posable, ×1.9 at most); Master is a statue on the
    // grid: about 1,000 / 3,400 / 5,000+ pieces for S / M / L (engine/assembly/dino.ts).
    const scale = level === "master" ? [4, 6, 7][size] : Math.min(3, size + (level === "expert" ? 1 : 0));
    const build = generateBuild("dino", { size: scale, level: detail, seed: (Math.random() * 1e9) | 0, mode: "any", inv: inventory, species: sp.id });
    update(t.id, { status: "done", build, from: `${sp.latin}, from its body plan · ${tierLabel(level)}`, label: "" });
    update(t.id, { img: await renderModelImageLDraw(build.bricks, 360) });
  }

  /**
   * F1 cars from the 77244 study (engine/assembly/f1.ts): floor and axle lines,
   * 4-wide tub, sidepods, nose and front wing, rear wing on its pillar, driver,
   * halo and airbox, wheels outside the body. The corpus F1s are 30–40-part
   * Creator cars, and stretching them moves the wheels off their axles.
   */
  async function fillRacer(t: Tile) {
    const livery = Math.floor(Math.random() * LIVERIES.length);
    update(t.id, { label: `${LIVERIES[livery].name}…` });
    await new Promise((r) => setTimeout(r));
    const detail = level === "junior" ? 0 : level === "creator" ? 1 : 2;
    const scale = Math.min(2, size + (level === "expert" || level === "master" ? 1 : 0));
    const build = generateBuild("racer", { size: scale, level: detail, seed: (Math.random() * 1e9) | 0, mode: "any", inv: inventory, plan: { ...F1_ANCHOR(scale), livery } });
    update(t.id, { status: "done", build, from: `${LIVERIES[livery].name} livery · built like Speed Champions 77244`, label: "" });
    update(t.id, { img: await renderModelImageLDraw(build.bricks, 360) });
  }

  async function fillSet(t: Tile, k: Kind, models: CorpusModel[]) {
    const pool = inBand(models, k, size);
    if (!pool.length) return update(t.id, { status: "failed", label: "No sets of this kind" });
    const m = pick(pool);
    update(t.id, { label: `${m.name}…` });
    const bricks = await loadDesign(m.id);
    const title = `${m.name}${m.model && !m.name.includes(m.model) ? ` · ${m.model}` : ""}`;
    const build = evaluateBuild(k, { title, rule: `LEGO ${m.set.replace(/-1$/, "")}${m.year ? ` (${m.year})` : ""}`, size, seed: t.id, recipe: `set-${m.id}-${t.id}` }, bricks, inventory);
    update(t.id, { status: "done", build: { ...build, real: { set: m.set, scheme: "" } }, from: `LEGO ${m.set.replace(/-1$/, "")} · ${m.theme}`, label: "" });
    update(t.id, { img: await renderModelImageLDraw(bricks, 360) });
  }

  // A new brief starts a new gallery.
  useEffect(() => {
    generate(true);
    return () => {
      run.current++;
    };
  }, [kind, tier, technic, size, mode]);

  const owned = totalPieces(inventory) > 0;

  return (
    <div className="studio">
      <div className="studio-bar">
        <Choice label="What to build" value={kind} onChange={(v) => setKind(v as Kind | "all")} options={[{ value: "all", label: "All" }, ...KINDS.map((k) => ({ value: k.id, label: k.label }))]} />
        <span className="spacer" />
        <Button variant="accent" onClick={() => generate(false)} disabled={working}>
          {working ? "Designing…" : mode === "new" ? "Generate" : "More sets"}
        </Button>
      </div>

      <div className="studio-bar refine">
        {mode === "new" && (
          <span title={TIERS.find((x) => x.id === level)!.rule}>
            <Select
              size="sm"
              label="Level"
              hideLabel
              value={level}
              onValueChange={(v) => {
                if (v === "technic") setTechnic(true);
                else {
                  setTier(v as Tier);
                  setTechnic(false);
                }
              }}
              options={[...LEVELS, "technic" as Tier].map((t) => ({ value: t, label: tierLabel(t) }))}
            />
          </span>
        )}
        <Choice label="Size" value={String(size)} onChange={(v) => setSize(Number(v))} options={SIZES.map((label, i) => ({ value: String(i), label }))} />
        <span className="spacer" />
        {owned && (
          <span title="Count what you'd need to buy from My pieces">
            <Switch label="My pieces" checked={mine} onCheckedChange={setMine} />
          </span>
        )}
        <span title="LEGO's own sets, for inspiration, instead of new designs">
          <Switch label="LEGO originals" checked={mode === "sets"} onCheckedChange={(on) => setMode(on ? "sets" : "new")} />
        </span>
      </div>

      <div className="gallery">
        {tiles.map((t) => {
          const b = t.build;
          const buy = b ? b.needs.reduce((s, n) => s + n.need - n.have, 0) : 0;
          return (
            <Card as="article" key={t.id} className={`tile ${t.status}`}>
              {/* The picture opens the 3D view too: it's what you'd click to look closer. */}
              <button type="button" className="tile-img" disabled={!b} onClick={() => setViewing(t.id)} aria-label={b ? `View ${b.title} in 3D` : undefined}>
                {t.img ? <img src={t.img} alt="" /> : <span className="tile-wait">{t.status === "failed" ? "—" : <i className="spinner" />}</span>}
              </button>
              <div className="tile-body">
                {b ? (
                  <>
                    <h3>{b.title}</h3>
                    <p className="tile-from">{t.from}</p>
                    <div className="chips">
                      <Tag>{b.pieces} pieces</Tag>
                      <Tag>{"real" in b && b.real ? "LEGO set" : tierLabel(level)}</Tag>
                      {b.held !== undefined && <Badge tone={b.held >= 0.95 ? "positive" : "warning"}>held {pct(b.held)}</Badge>}
                      {mine && <Badge tone={buy === 0 ? "positive" : "neutral"}>{buy ? `${buy} to buy` : "you have all"}</Badge>}
                    </div>
                    <div className="tile-actions">
                      {/* Look first: the main action is the 3D view, where building and editing are. */}
                      <Button variant="accent" size="sm" onClick={() => setViewing(t.id)} title="Turn it around in 3D before you build it">
                        View
                      </Button>
                      <Button variant="glass" size="sm" onClick={() => onInstructions(b.bricks, b.title)} title="Step-by-step instructions">
                        Build it
                      </Button>
                      <IconButton variant="ghost" size="sm" onClick={() => setOpen(open === t.id ? null : t.id)} aria-label="Details" aria-expanded={open === t.id}>
                        {open === t.id ? "−" : "⋯"}
                      </IconButton>
                    </div>
                    {open === t.id && <Details build={b} />}
                  </>
                ) : (
                  <p className="tile-from">{t.label}</p>
                )}
              </div>
            </Card>
          );
        })}
      </div>
      {(() => {
        const t = tiles.find((x) => x.id === viewing), b = t?.build;
        if (!t || !b) return null;
        const label = "real" in b && b.real ? "LEGO set" : tierLabel(level);
        return (
          <ModelPreview
            title={b.title}
            from={t.from}
            bricks={b.bricks}
            facts={[`${b.pieces} pieces`, label, ...(b.held !== undefined ? [`held ${pct(b.held)}`] : [])]}
            onInstructions={() => onInstructions(b.bricks, b.title)}
            onEdit={() => onBuild(b.bricks)}
            onClose={() => setViewing(null)}
          />
        );
      })()}
      {mode === "new" && tiles.length > 0 && !working && (
        <Button variant="glass" className="wide" onClick={() => generate(false)}>
          {BATCH} more designs
        </Button>
      )}
    </div>
  );
}

/** The numbers and reasons behind a design, folded away until asked for. */
function Details({ build }: { build: Build }) {
  const top = [...build.needs].sort((a, b) => b.need - a.need).slice(0, 6);
  const reasons = build.bricks.filter((b) => b.why?.motif).slice(0, 3);
  return (
    <div className="details">
      <dl>
        <dt>Size</dt>
        <dd>{build.mm.map((v) => Math.round(v)).join(" × ")} mm</dd>
        <dt>Weight</dt>
        <dd>{Math.round(build.massG)} g</dd>
        <dt>Level</dt>
        <dd>
          {build.difficulty.label} · ages {build.difficulty.age}+ · ~{build.difficulty.minutes} min
        </dd>
        <dt>Made by</dt>
        <dd>{build.math}</dd>
      </dl>
      <p className="muted">Most used</p>
      <ul>
        {top.map((n) => (
          <li key={`${n.partId}:${n.color}`}>
            <i className="dot" style={{ background: colorOf(n.color).hex }} /> {n.need}× {PARTS[n.partId]?.name ?? n.partId}
          </li>
        ))}
      </ul>
      {reasons.length > 0 && (
        <>
          <p className="muted">Techniques it used</p>
          <ul>
            {reasons.map((b) => (
              <li key={b.uid}>{b.why!.motif}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
