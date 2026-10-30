import { useEffect, useRef, useState } from "react";
import { KINDS, type Kind } from "../engine/assembly/kinds";
import { SPECIES, evaluateBuild, kindLabel, type Build } from "../engine/assembly";
import { totalPieces, type Inventory } from "../engine/inventory";
import type { PlacedBrick } from "../engine/grid";
import { TIERS, tierLabel, type Tier } from "../engine/style";
import { corpusIndex, inBand, inTier, loadDesign, loadDesignText, recolor, LIVERY_SCHEMES, SCHEME_COUNT, type CorpusModel } from "../scene/corpus";
import { describe, engineDesign, parallel, rigBuild, type EngineDesign, type Variation } from "../scene/engine";
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
const generatedOn = () => typeof localStorage !== "undefined" && localStorage.getItem("lego-builder:generated") === "1";

// Tile pictures one at a time, each in its own task after a yield: drawing one blocks the
// page for 50–300 ms, and several landing together froze it for half a second or more.
let drawing: Promise<unknown> = Promise.resolve();
function draw<T>(f: () => Promise<T>): Promise<T> {
  const next = drawing.then(() => new Promise((r) => setTimeout(r))).then(f);
  drawing = next.catch(() => {});
  return next;
}

interface Tile {
  id: number;
  status: "pending" | "done" | "failed";
  label: string;
  build?: Build;
  from?: string;
  img?: string;
  /** When it started (the pending tile shows how long it's been). */
  t0?: number;
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
  const viewingRef = useRef<number | null>(null);
  viewingRef.current = viewing;
  const [working, setWorking] = useState(false);
  const run = useRef(0);
  const later = useRef<(() => Promise<void>)[]>([]); // best-of-K refinements waiting for the batch to finish
  const nextId = useRef(1);
  const level: Tier = technic ? "technic" : tier;

  const update = (id: number, patch: Partial<Tile>) => setTiles((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  /** Add a batch of new tiles and fill them one by one. */
  const opened = useRef(false);
  // Costly levels (Master; Expert at L) take about a minute a design on the
  // engine's workers: a batch of as many as there are workers, so none waits in
  // a queue behind the others (a sixth design came in after 2 min 17 s).
  const batchSize = () => (level === "master" || (level === "expert" && size === 2) ? parallel() : BATCH);
  async function generate(fresh = false) {
    const token = fresh ? ++run.current : run.current;
    const models = await corpusIndex();
    const batch: Tile[] = Array.from({ length: batchSize() }, () => ({ id: nextId.current++, status: "pending", label: "Designing…", t0: Date.now() }));
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
    // Best-of-K, after the batch: each tile switches once, when all its builds are back.
    const jobs = later.current.splice(0);
    const refineLane = async () => {
      for (let j = jobs.shift(); j && run.current === token; j = jobs.shift()) await j().catch(() => {});
    };
    await Promise.all(Array.from({ length: parallel() }, refineLane));
  }

  function stop() {
    run.current++;
    later.current = [];
    setWorking(false);
    setTiles((ts) => ts.filter((t) => t.status !== "pending"));
  }

  async function fillNew(t: Tile, k: Kind, models: CorpusModel[], token: number) {
    // Only LEGO's own builds pass the user's eye ("Creator M is very OK, why are the
    // others terrible?"): every tile is a real design, rebuilt or from the corpus, in a
    // new paint job at most. The generators (sculptor variations, the dinosaur rig) stay
    // reachable for engine work with localStorage "lego-builder:generated" = "1".
    if (!generatedOn()) {
      if (level === "technic") return fillTechnic(t, models);
      if (k === "dino") return fillRex(t);
      if (k === "racer") return fillRacer(t, models);
      return fillReal(t, k, models);
    }
    if (k === "dino" && level !== "technic") return fillDino(t);
    if (k === "racer" && level !== "technic") return fillRacer(t, models);
    if ((k === "car" || k === "robot") && level !== "technic") return fillReal(t, k, models);
    const pool = level === "technic" ? models.filter((m) => m.tier === "technic").map((m) => ({ ...m, kind: k })) : inBand(models, k, size);
    if (!pool.length) return update(t.id, { status: "failed", label: "No designs to start from" });
    const base = pick(pool);
    const v = variation(k);
    update(t.id, { label: `${base.name}…` });
    const d = await engineDesign(base, v, level, k === "dino" || k === "robot");
    if (run.current !== token) return;
    // Half the time, a new paint job too (the same one if a better build replaces this one).
    const paint = Math.random() < 0.5 ? Math.floor(Math.random() * SCHEME_COUNT) : -1;
    const show = async (d: EngineDesign, best?: boolean) => {
      let bricks = d.bricks;
      let scheme = "";
      if (paint >= 0) {
        const r = recolor(bricks, paint);
        if (r) ({ bricks, name: scheme } = r);
      }
      const build = evaluateBuild(
        k,
        { title: technic ? "Technic model" : kindLabel(k), rule: `${tierLabel(level)} · shape fit ${pct(d.fit)}${d.made ? ` · ${d.made} made to measure` : ""}${best ? " · best of 4 builds" : ""}`, size, seed: t.id, recipe: `studio-${t.id}` },
        bricks.map((b) => ({ ...b, group: "Build" })),
        inventory,
      );
      const from = `From ${base.name}, ${describe(v)}${scheme ? `, in ${scheme}` : ""}`;
      update(t.id, { status: "done", build: { ...build, held: d.held }, from, label: "" });
      update(t.id, { img: await draw(() => renderModelImageLDraw(bricks, 360)) });
    };
    await show(d);
    // The other ways to build it run once the batch is in, so the first designs come as fast as before.
    if (d.refine) {
      const refine = d.refine;
      later.current.push(async () => {
        const better = await refine();
        // Not under the user's eyes: a tile open in 3D keeps the build they're looking at.
        if (better && run.current === token && viewingRef.current !== t.id) await show(better, true);
      });
    }
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
    // The T. rex at Junior and Creator, S and M, is LEGO 31058's (the user's target):
    // our rebuild from its booklet (data/golden/31058-rex.ldr, scripts/rebuild-31058.mjs),
    // in its own colours, until the rig's T. rex looks as much like it.
    if ((level === "junior" || level === "creator") && size < 2) return fillRex(t);
    const sp = pick(SPECIES);
    // A T. rex at any other level or size too: a higher level should mean more detail,
    // not the same rex made bigger (a 148-stud plate statue). 31151 comes for Expert.
    if (sp.id === "rex") return fillRex(t);
    update(t.id, { label: `${sp.label}…` });
    await new Promise((r) => setTimeout(r)); // let the tile show before the build runs
    const detail = level === "junior" ? 0 : level === "creator" ? 1 : 2;
    // Expert and Master a size up; the rig caps the scale at ×1.4 and builds no statues
    // (engine/assembly/dino.ts), so a higher level is not just more pieces.
    const scale = Math.min(3, size + (level === "expert" || level === "master" ? 1 : 0));
    const build = await rigBuild("dino", { size: scale, level: detail, seed: (Math.random() * 1e9) | 0, mode: "any", inv: inventory, species: sp.id });
    update(t.id, { status: "done", build, from: `${sp.latin}, from its body plan · ${tierLabel(level)}`, label: "" });
    update(t.id, { img: await draw(() => renderModelImageLDraw(build.bricks, 360)) });
  }

  /**
   * Dinosaurs as LEGO builds them, rebuilt from the booklets (data/golden): up to Advanced
   * 31058's three models (T. rex 161, Triceratops 110, Pterodactyl 101 pieces) in turn
   * across a batch; at Expert and Master 31151's T. rex (603, far more detail).
   */
  async function fillRex(t: Tile) {
    const big = level === "expert" || level === "master";
    const SMALL = [
      { id: "31058", key: "rex", name: "T. rex", latin: "Tyrannosaurus rex", load: () => import("../../data/golden/31058-rex.ldr?raw") },
      { id: "31058", key: "trike", name: "Triceratops", latin: "Triceratops horridus", load: () => import("../../data/golden/31058-trike.ldr?raw") },
      { id: "31058", key: "ptero", name: "Pterodactyl", latin: "Pteranodon", load: () => import("../../data/golden/31058-ptero.ldr?raw") },
    ];
    const set = big ? { id: "31151", key: "rex", name: "T. rex", latin: "Tyrannosaurus rex", load: () => import("../../data/golden/31151-rex.ldr?raw") } : SMALL[t.id % SMALL.length];
    update(t.id, { label: `${set.name}…` });
    const bricks = await loadDesignText(`${set.id}-${set.key}`, () => set.load().then((m) => m.default));
    const build = evaluateBuild("dino", { title: set.name, rule: `LEGO ${set.id}, rebuilt from its booklet`, size, seed: t.id, recipe: `${set.key}-${set.id}` }, bricks, inventory);
    update(t.id, { status: "done", build, from: `${set.latin}, as LEGO ${set.id} builds it`, label: "" });
    update(t.id, { img: await draw(() => renderModelImageLDraw(bricks, 360)) });
  }

  /**
   * A real design repainted: the designer's parts where the designer put them,
   * in a scheme (scene/corpus.ts recolor), wheels and tyres in their own colours.
   * For vehicles: stretching one moved its wheels off their axles or lost them,
   * and turned small racers into black blocks.
   */
  async function repainted(t: Tile, k: Kind, m: CorpusModel, scheme: number, title: (name: string) => string) {
    update(t.id, { label: `${m.name}…` });
    const all = await loadDesign(m.id);
    const wheel = (b: (typeof all)[number]) => /^(Wheel|Tyre|Tire)/i.test(PARTS[b.partId]?.name ?? "") || /^(Wheel|Tyre)/.test(PARTS[b.partId]?.category ?? "");
    const painted = recolor(all.filter((b) => !wheel(b)), scheme);
    const body = painted?.bricks[Symbol.iterator]();
    const bricks = body ? all.map((b) => (wheel(b) ? b : body.next().value!)) : all;
    // Named after the scheme only if it repainted a real share of the model (a white racer keeps its white).
    const changed = bricks.filter((b, i) => b.color !== all[i].color).length;
    const scheme_ = painted && changed >= bricks.length * 0.15 ? painted.name : "its own colours";
    const set = m.set.replace(/-1$/, "");
    const build = evaluateBuild(k, { title: title(scheme_), rule: `LEGO ${set} (${m.name}), ${scheme_}`, size, seed: t.id, recipe: `paint-${m.id}-${t.id}` }, bricks, inventory);
    update(t.id, { status: "done", build, from: `LEGO ${set} ${m.name}, in ${scheme_}`, label: "" });
    update(t.id, { img: await draw(() => renderModelImageLDraw(bricks, 360)) });
  }

  /**
   * F1 cars: real designers' F1s in a team livery. The hand recipe
   * (engine/assembly/f1.ts) was 6.5 % connectors where 77244 is 36.5 % (mix L1
   * 0.81). Junior: 30190 (Ferrari 150°, 32 parts); Creator and up: 5540
   * (Formula 1 Racer, 429). 392 (1970s, studs everywhere) is left out.
   */
  async function fillRacer(t: Tile, models: CorpusModel[]) {
    // Each level its own open-wheel cars from the corpus, taken in turn across a
    // batch. Advanced and up have only 5540 in the corpus (Expert and Master too).
    const ids = level === "junior" ? ["30190-1", "7452-1", "8123-1-2", "8123-1-3"] : level === "creator" ? ["4939-1-formula1", "6604-1"] : ["5540-1-55401"];
    const pool = ids.map((id) => models.find((x) => x.id === id)).filter((x): x is CorpusModel => !!x);
    if (!pool.length) return update(t.id, { status: "failed", label: "No F1 design to start from" });
    await repainted(t, "racer", pool[t.id % pool.length], t.id % LIVERY_SCHEMES, (n) => `F1 car · ${n}`);
  }

  /**
   * City cars and robots: the real ones of the size asked for, repainted. Not
   * stretched (cars lost wheels) and not articulated (robots came apart into
   * floating arms and legs).
   */
  async function fillReal(t: Tile, k: Kind, models: CorpusModel[]) {
    const pool = inTier(models, k, level, size);
    if (!pool.length) return update(t.id, { status: "failed", label: `No ${kindLabel(k).toLowerCase()} designs of this size` });
    const m = pool[(t.id * 7) % pool.length]; // different ones across a batch
    await repainted(t, k, m, Math.floor(Math.random() * SCHEME_COUNT), () => m.name);
  }

  /** A Technic set from the corpus, in its own colours (the band by size, like the other kinds). */
  async function fillTechnic(t: Tile, models: CorpusModel[]) {
    const all = models.filter((m) => m.tier === "technic").sort((a, b) => a.parts - b.parts);
    const pool = all.slice(Math.floor((all.length * size) / 3), Math.max(1, Math.floor((all.length * (size + 1)) / 3)));
    if (!pool.length) return update(t.id, { status: "failed", label: "No Technic sets of this size" });
    const m = pool[(t.id * 7) % pool.length];
    update(t.id, { label: `${m.name}…` });
    const bricks = await loadDesign(m.id);
    const build = evaluateBuild("car", { title: m.name, rule: `LEGO ${m.set.replace(/-1$/, "")} (${m.name})`, size, seed: t.id, recipe: `technic-${m.id}-${t.id}` }, bricks, inventory);
    update(t.id, { status: "done", build: { ...build, real: { set: m.set, scheme: "" } }, from: `LEGO ${m.set.replace(/-1$/, "")} ${m.name}`, label: "" });
    update(t.id, { img: await draw(() => renderModelImageLDraw(bricks, 360)) });
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
    update(t.id, { img: await draw(() => renderModelImageLDraw(bricks, 360)) });
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
        {working ? (
          // Stop: designs not started yet are dropped (one already building finishes in its worker).
          <Button variant="glass" onClick={stop} title="Stop designing more">
            Stop
          </Button>
        ) : (
          <Button variant="accent" onClick={() => generate(false)}>
            {mode === "new" ? "Generate" : "More sets"}
          </Button>
        )}
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
                      {/* The main action: onto the table, to change it there. Steps and the 3D look are one click too. */}
                      <Button variant="accent" size="sm" onClick={() => onBuild(b.bricks)} title="Put it on the table to change it">
                        Place
                      </Button>
                      <Button variant="glass" size="sm" onClick={() => onInstructions(b.bricks, b.title)} title="Step-by-step instructions">
                        Build it
                      </Button>
                      <Button variant="glass" size="sm" onClick={() => setViewing(t.id)} title="Turn it around in 3D">
                        View
                      </Button>
                      <IconButton variant="ghost" size="sm" onClick={() => setOpen(open === t.id ? null : t.id)} aria-label="Details" aria-expanded={open === t.id}>
                        {open === t.id ? "−" : "⋯"}
                      </IconButton>
                    </div>
                    {open === t.id && <Details build={b} />}
                  </>
                ) : (
                  <p className="tile-from">
                    {t.label}
                    {t.status === "pending" && t.t0 && <Elapsed since={t.t0} />}
                  </p>
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
          {batchSize()} more designs
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

/** "· 0:42": how long a design has been building, so a minute's wait reads as work, not a hang. */
function Elapsed({ since }: { since: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const s = Math.floor((Date.now() - since) / 1000);
  return s < 3 ? null : <span className="elapsed"> · {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}</span>;
}
