import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Scene, hoverStore, type Nav, type Tool } from "./scene/Scene";
import { PartThumb } from "./ui/PartThumb";
import { Choice } from "./ui/Choice";
import { setThemePref, useThemePref, type ThemePref } from "./ui/theme";
import { Button, Card, Chip, IconButton, Input, Select, Switch } from "pane-react";
// Heavy screens load when first opened, so the editor itself starts fast.
const MyLibrary = lazy(() => import("./ui/MyLibrary").then((m) => ({ default: m.MyLibrary })));
// The generators load ahead (soon after start, or on hovering ✦ Create): loaded on
// the click, their panel would replace a "Loading…" card mid-animation and restart it.
// (React.lazy shows its fallback on a first render even when the code is in, so
// once it is, the panel renders straight from the module.)
let IdeasReady: typeof import("./ui/Ideas").Ideas | undefined;
const loadIdeas = () => import("./ui/Ideas").then((m) => ((IdeasReady = m.Ideas), m));
const IdeasLazy = lazy(() => loadIdeas().then((m) => ({ default: m.Ideas })));
const Learning = lazy(() => import("./ui/Learning").then((m) => ({ default: m.Learning })));
const Instructions = lazy(() => import("./ui/Instructions").then((m) => ({ default: m.Instructions })));
import { CreatePicker, type Start } from "./ui/CreatePicker";
import { invKey, parseKey, shoppingCSV, totalPieces, usage, type Inventory } from "./engine/inventory";
import { analyzeStability } from "./engine/stability";
import { PART_LIST, PARTS, footprint, resolvePartId, type PartDef, type Rot } from "./engine/parts";
import { ALL_COLORS, COLORS, colorOf } from "./engine/colors";
import { OUTSIDE, bounds, buildOccupancy, type PlacedBrick } from "./engine/grid";
import { toLDraw } from "./engine/ldraw";
import { PLATE_MM, STUD_MM } from "./engine/units";

const STORAGE_KEY = "lego-builder:model";
const NAV_KEY = "lego-builder:nav";
const INVENTORY_KEY = "lego-builder:inventory";
const WELCOME_KEY = "lego-builder:welcomed";
const TOOLS_KEY = "brick-forge:tools";

function loadInventory(): Inventory {
  try {
    const raw = JSON.parse(localStorage.getItem(INVENTORY_KEY) ?? "{}");
    const out: Inventory = {};
    for (const [k, q] of Object.entries(raw)) {
      const [id, c] = [k.slice(0, k.lastIndexOf(":")), k.slice(k.lastIndexOf(":") + 1)];
      const partId = resolvePartId(id);
      if (partId && typeof q === "number" && q > 0) out[invKey(partId, Number(c))] = q;
    }
    return out;
  } catch {
    return {};
  }
}

/** One decimal at most (posed and imported parts make sizes fractional). */
const r1 = (v: number) => Math.round(v * 10) / 10;

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = IS_MAC ? "⌘" : "Ctrl ";

const PAGE = 60; // parts rendered per "Show more"
// Categories that get a chip; the rest go in the "More" menu.
const PRIMARY_CATEGORIES = ["Brick", "Plate", "Tile", "Slope"];

/** Category names with part counts, primary ones first. */
function categoryList() {
  const counts = new Map<string, number>();
  for (const p of PART_LIST) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  const primary = PRIMARY_CATEGORIES.filter((c) => counts.has(c));
  const rest = [...counts.keys()].filter((c) => !primary.includes(c)).sort();
  return { primary, rest, counts };
}

const NAV_HINTS: Record<Nav, string[]> = {
  trackpad: ["Scroll: orbit", "Pinch: zoom", "Shift+scroll: pan", "Two-finger tap: rotate part"],
  mouse: ["Drag: orbit", "Right-drag: pan", "Wheel: zoom", "R: rotate part"],
};

function loadModel(): PlacedBrick[] {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(saved)) return [];
    // Drop parts this catalog doesn't know; map renamed LDraw numbers to current ones.
    return saved.flatMap((b: PlacedBrick) => {
      const partId = resolvePartId(b.partId);
      return partId ? [{ ...b, partId }] : [];
    });
  } catch {
    return [];
  }
}

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

export default function App({ ldraw }: { ldraw: boolean }) {
  const [bricks, setBricks] = useState<PlacedBrick[]>(loadModel);
  const [bricksOnLoad] = useState(() => bricks.length);
  const [history, setHistory] = useState<PlacedBrick[][]>([]);
  const [partId, setPartId] = useState(() => resolvePartId("3001") ?? PART_LIST[0].id);
  const [color, setColor] = useState(4);
  const [rot, setRot] = useState<Rot>(0);
  const [tool, setTool] = useState<Tool>("build");
  // Navigation style: what the user picked, or detected from how their wheel events look.
  const [nav, setNavState] = useState<Nav>(() => (localStorage.getItem(NAV_KEY) as Nav) ?? (IS_MAC ? "trackpad" : "mouse"));
  const [navAuto, setNavAuto] = useState(() => !localStorage.getItem(NAV_KEY));
  const setNav = (n: Nav) => {
    setNavState(n);
    setNavAuto(false);
    localStorage.setItem(NAV_KEY, n);
  };
  useEffect(() => {
    const id = setTimeout(() => void loadIdeas(), 1500); // after the editor's own start
    return () => clearTimeout(id);
  }, []);
  useEffect(() => {
    if (!navAuto) return;
    // Trackpads send pixel deltas with sideways motion and fractions; mouse wheels
    // send whole notches (±100 or ±120) straight up and down. Three alike decide.
    let votes = 0, last: Nav | null = null;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return; // pinch
      const notch = e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50 && Math.abs(e.deltaY) % 25 === 0;
      const guess: Nav = notch || e.deltaMode !== 0 ? "mouse" : "trackpad";
      votes = guess === last ? votes + 1 : 1;
      last = guess;
      if (votes >= 3) setNavState(guess);
    };
    window.addEventListener("wheel", onWheel, { passive: true, capture: true });
    return () => window.removeEventListener("wheel", onWheel, { capture: true });
  }, [navAuto]);
  const [showDims, setShowDims] = useState(true);
  const cats = useMemo(categoryList, []);
  const [category, setCategory] = useState(cats.primary[0] ?? cats.rest[0]);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  // Which shortcut was just used, so its key badge can flash.
  const [pressed, setPressed] = useState<string | null>(null);
  // Tools out of the way (H, or the button at the end of the dock): the panels slide
  // off and the dock shrinks to the one button that brings them back.
  const [tools, setTools] = useState(() => localStorage.getItem(TOOLS_KEY) !== "hidden");
  useEffect(() => localStorage.setItem(TOOLS_KEY, tools ? "shown" : "hidden"), [tools]);
  const flashTimer = useRef<number>(0);
  const openFile = useRef<HTMLInputElement>(null);
  const flash = (id: string) => {
    setPressed(id);
    clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setPressed(null), 220);
  };
  const Key = ({ id, children }: { id: string; children: ReactNode }) => (
    <kbd className={pressed === id ? "key hit" : "key"}>{children}</kbd>
  );
  // The left card is for building: the parts, or your own pieces. Creating starts
  // from the picker (on an empty scene, and from ✦ Create in the dock). The
  // learning engine is a lab tool, shown only with #lab in the address.
  const [tab, setTab] = useState<"catalog" | "mine" | "learn">("catalog");
  const lab = location.hash === "#lab";
  // The learning engine starts once the editor is up, in its own worker.
  useEffect(() => {
    const t = window.setTimeout(() => import("./engine/learn/client").then((m) => m.start()), 2500);
    return () => clearTimeout(t);
  }, []);
  const [inventory, setInventory] = useState<Inventory>(loadInventory);
  const [ideasStart, setIdeasStart] = useState<Start | null>(null);
  // Chosen once per opening (see loadIdeas): swapping it while open would remount the panel.
  const Ideas = useMemo(() => IdeasReady ?? IdeasLazy, [ideasStart]);
  const setShowIdeas = (on: boolean) => setIdeasStart(on ? { source: "builds", kind: "all" } : null);
  const [welcome, setWelcome] = useState(() => bricksOnLoad === 0 && !localStorage.getItem(WELCOME_KEY));
  const create = (s: Start) => {
    setWelcome(false);
    localStorage.setItem(WELCOME_KEY, "1");
    setIdeasStart(s);
  };
  const [showPrints, setShowPrints] = useState(false);
  const [allColors, setAllColors] = useState(false);
  const [bump, setBump] = useState<string | null>(null); // tile that just got "+1"
  const [stressView, setStressView] = useState(false);
  const [steps, setSteps] = useState<{ bricks: PlacedBrick[]; title: string } | null>(null);

  const part = PARTS[partId];
  const occ = useMemo(() => buildOccupancy(bricks), [bricks]);

  useEffect(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(bricks)), [bricks]);
  useEffect(() => localStorage.setItem(INVENTORY_KEY, JSON.stringify(inventory)), [inventory]);
  const used = useMemo(() => usage(bricks), [bricks]);
  const physics = useMemo(() => analyzeStability(bricks), [bricks]);
  // What the model needs beyond My Library (only meaningful once the library has something).
  const missing = useMemo(() => {
    if (totalPieces(inventory) === 0) return [];
    return Object.entries(used)
      .map(([k, n]) => ({ ...parseKey(k), qty: n - (inventory[k] ?? 0) }))
      .filter((r) => r.qty > 0)
      .sort((a, b) => b.qty - a.qty);
  }, [used, inventory]);
  const addToLibrary = (p: PartDef, n = 1) => {
    const k = invKey(p.id, color);
    setInventory((inv) => ({ ...inv, [k]: (inv[k] ?? 0) + n }));
    setBump(p.id);
    window.setTimeout(() => setBump((b) => (b === p.id ? null : b)), 500);
  };

  const commit = useCallback(
    (next: PlacedBrick[]) => {
      setHistory((h) => [...h.slice(-99), bricks]);
      setBricks(next);
    },
    [bricks],
  );

  const undo = useCallback(() => {
    if (history.length === 0) return;
    setBricks(history[history.length - 1]);
    setHistory(history.slice(0, -1));
  }, [history]);

  const place = (x: number, y: number, z: number) =>
    commit([...bricks, { uid: crypto.randomUUID(), partId, x, y, z, rot, color }]);
  const erase = (uid: string) => {
    commit(bricks.filter((b) => b.uid !== uid));
    hoverStore.set(null);
  };
  const rotate = (dir: 1 | -1) => setRot((r) => ((r + dir + 4) % 4) as Rot);
  const pick = (p: PartDef) => {
    setPartId(p.id);
    setTool("build");
  };

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      // Physical key position (e.code), not the character: shortcuts keep working
      // with a Thai (or any non-Latin) keyboard layout, where R types "พ".
      const k = e.code.startsWith("Key") ? e.code.slice(3).toLowerCase() : "";
      if ((e.metaKey || e.ctrlKey) && k === "z") {
        e.preventDefault();
        undo();
        flash("undo");
      } else if (e.metaKey || e.ctrlKey || e.altKey) {
        return;
      } else if (k === "r") {
        rotate(e.shiftKey ? -1 : 1);
        flash(e.shiftKey ? "rotL" : "rotR");
      } else if (k === "e") {
        setTool("erase");
        flash("erase");
      } else if (k === "b") {
        setTool("build");
        flash("build");
      } else if (k === "d") {
        setShowDims((s) => !s);
        flash("dims");
      } else if (k === "s") {
        setStressView((v) => !v);
        flash("stress");
      } else if (k === "h") {
        setTools((v) => !v);
        flash("tools");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);

  const visibleParts = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return PART_LIST.filter((p) => p.category === category && (showPrints || !p.printed));
    // Exact part number first, then numbers starting with the query, then plain parts before printed ones.
    const rank = (p: PartDef) => (p.id === q ? 0 : p.id.startsWith(q) ? 1 : 2) * 2 + (p.printed ? 1 : 0);
    return PART_LIST.filter((p) => (showPrints || !p.printed || p.id === q) && (p.id.includes(q) || p.name.toLowerCase().includes(q))).sort(
      (a, b) => rank(a) - rank(b),
    );
  }, [category, query, showPrints]);
  useEffect(() => setLimit(PAGE), [category, query, showPrints]);

  const bom = useMemo(() => {
    const counts = new Map<string, { partId: string; color: number; qty: number }>();
    for (const b of bricks) {
      const k = `${b.partId}:${b.color}`;
      const row = counts.get(k) ?? { partId: b.partId, color: b.color, qty: 0 };
      row.qty++;
      counts.set(k, row);
    }
    return [...counts.values()].sort((a, b) => b.qty - a.qty);
  }, [bricks]);

  const box = bounds(bricks);
  const fp = footprint(part, rot);

  return (
    <div className={tools ? "app" : "app tools-hidden"}>
      <main
        className="viewport"
        onContextMenu={(e) => {
          e.preventDefault();
          if (nav === "trackpad" && tool === "build") {
            rotate(1);
            flash("rotR");
          }
        }}
      >
        <Scene
          bricks={bricks}
          occ={occ}
          tool={tool}
          nav={nav}
          part={part}
          rot={rot}
          color={color}
          showDims={showDims}
          stress={stressView ? physics : null}
          onPlace={place}
          onErase={erase}
        />
      </main>

      <Card as="aside" className="card left">
        <header className="card-head">
          <h1>Brick Forge</h1>
          <span className="head-actions">
            <ThemeSwitch />
            <IconButton
              variant="ghost"
              size="sm"
              className={pressed === "tools" ? "hit" : undefined}
              onClick={() => setTools((v) => !v)}
              aria-expanded={tools}
              aria-label={tools ? "Hide the tools (H)" : "Show the tools (H)"}
              title={tools ? "Hide the tools (H)" : "Show the tools (H)"}
            >
              <ToolsIcon open={tools} />
            </IconButton>
          </span>
        </header>
        <div className="tabs">
          <Choice
            label="Panel"
            value={tab}
            onChange={(v) => setTab(v as typeof tab)}
            options={[
              { value: "catalog", label: "Parts" },
              {
                value: "mine",
                label: (
                  <>
                    My pieces{totalPieces(inventory) > 0 && <span className="count-badge">{totalPieces(inventory)}</span>}
                  </>
                ),
              },
              ...(lab ? [{ value: "learn", label: "Lab", title: "The learning engine" }] : []),
            ]}
          />
        </div>

        {tab === "learn" ? (
          <Suspense fallback={<p className="hint">Loading…</p>}>
            <Learning />
          </Suspense>
        ) : tab === "mine" ? (
          <Suspense fallback={<p className="hint">Loading…</p>}>
            <MyLibrary
              inventory={inventory}
              used={used}
              selected={invKey(partId, color)}
              onChange={setInventory}
              onPick={(id, c) => {
                setPartId(id);
                setColor(c);
                setTool("build");
              }}
              onIdeas={() => setShowIdeas(true)}
            />
          </Suspense>
        ) : (
          <>
            <Input size="sm" type="search" placeholder="Search parts or part #" aria-label="Search parts" value={query} onChange={(e) => setQuery(e.target.value)} />
            {!query && (
              <div className="chips">
                {cats.primary.map((c) => (
                  <Chip key={c} selected={c === category} onSelectedChange={() => setCategory(c)}>
                    {c}
                  </Chip>
                ))}
                {cats.rest.length > 0 && (
                  <Select
                    size="sm"
                    label="More categories"
                    hideLabel
                    placeholder="More…"
                    value={cats.rest.includes(category) ? category : undefined}
                    onValueChange={setCategory}
                    options={cats.rest.map((c) => ({ value: c, label: `${c} (${cats.counts.get(c)})` }))}
                  />
                )}
              </div>
            )}
            <div className="count-row">
              <p className="hint count">
                {visibleParts.length.toLocaleString()} part{visibleParts.length === 1 ? "" : "s"}
                {query ? ` matching “${query}”` : ` in ${category}`}
                {!ldraw && " · built-in set (run npm run catalog for LDraw)"}
              </p>
              {ldraw && (
                <span title="Parts with printed patterns">
                  <Switch label="Prints" checked={showPrints} onCheckedChange={setShowPrints} />
                </span>
              )}
            </div>

            <div className="parts">
              {visibleParts.slice(0, limit).map((p) => (
                <div key={p.id} className={bump === p.id ? "part-wrap bumped" : "part-wrap"}>
                  <button className={p.id === partId ? "part on" : "part"} onClick={() => pick(p)} title={`${p.name} (#${p.id})`}>
                    {ldraw ? <PartThumb part={p} hex={colorOf(color).hex} /> : <PartIcon part={p} />}
                    <span>{p.label}</span>
                  </button>
                  <button
                    className="add"
                    onClick={(e) => addToLibrary(p, e.shiftKey ? 10 : 1)}
                    title={`Add 1 ${colorOf(color).name} to My pieces (⇧ adds 10)`}
                    aria-label="Add to My pieces"
                  >
                    +
                  </button>
                  {(inventory[invKey(p.id, color)] ?? 0) > 0 && (
                    <span className="owned" title="In My pieces, this colour">
                      {inventory[invKey(p.id, color)]}
                    </span>
                  )}
                </div>
              ))}
              {visibleParts.length > limit && (
                <Button variant="glass" size="sm" className="more" onClick={() => setLimit((l) => l + PAGE)}>
                  Show more ({(visibleParts.length - limit).toLocaleString()} left)
                </Button>
              )}
              {visibleParts.length === 0 && <p className="hint">No parts match “{query}”.</p>}
            </div>

            <h2 className="color-head">
              Color · {colorOf(color).name}
              <button className="link" onClick={() => setAllColors((v) => !v)}>
                {allColors ? "Fewer" : `All ${ALL_COLORS.length}`}
              </button>
            </h2>
            <div className={allColors ? "colors all" : "colors"}>
              {(allColors ? ALL_COLORS : COLORS).map((c) => (
                <button
                  key={c.code}
                  className={c.code === color ? "swatch on" : "swatch"}
                  style={{ background: c.hex }}
                  title={c.name}
                  aria-label={c.name}
                  onClick={() => setColor(c.code)}
                />
              ))}
            </div>
          </>
        )}
        <p className="credits-line">
          A fan project. LEGO® is a trademark of the LEGO Group, which does not sponsor or endorse it. <a href="/credits.html">Credits</a>
        </p>
      </Card>

      <Card as="aside" className="card right model-card">
        {box ? (
          <>
            {/* At a glance: how big it is, whether it holds, what it's made of; then the one thing to do next. */}
            <header className="model-head">
              <p className="model-count">
                <b>{bricks.length.toLocaleString()}</b> {bricks.length === 1 ? "piece" : "pieces"}
              </p>
              <p className="model-size">
                {r1(box.maxX - box.minX)} × {r1(box.maxZ - box.minZ)} studs · {heightLabel(box.maxY - box.minY)}
                <span className="hint">
                  {" "}
                  {Math.round((box.maxX - box.minX) * STUD_MM)} × {Math.round((box.maxZ - box.minZ) * STUD_MM)} × {Math.round((box.maxY - box.minY) * PLATE_MM)} mm ·{" "}
                  {physics.massG < 1000 ? `${Math.max(0.1, Math.round(physics.massG * 10) / 10)} g` : `${(physics.massG / 1000).toFixed(2)} kg`}
                </span>
              </p>
            </header>
            <ModelStatus physics={physics} bricks={bricks} />
            <section className="model-parts" aria-label="Parts">
              <h2>
                Parts <span className="hint">{bom.length} {bom.length === 1 ? "kind" : "kinds"}</span>
              </h2>
              <ul>
                {bom.map((r) => (
                  <li key={`${r.partId}:${r.color}`} title={`${PARTS[r.partId].name} · ${colorOf(r.color).name} · #${r.partId}`}>
                    <i className="dot" style={{ background: colorOf(r.color).hex }} />
                    <span className="name">{PARTS[r.partId].name}</span>
                    <b className="qty">{r.qty}</b>
                  </li>
                ))}
              </ul>
            </section>
            {missing.length > 0 && (
              <p className="model-missing">
                {missing.reduce((a, r) => a + r.qty, 0)} of these aren't in My pieces ·{" "}
                <button className="link" onClick={() => download("missing-pieces.csv", shoppingCSV(missing))} title="Rebrickable CSV of what to buy">
                  shopping list
                </button>
              </p>
            )}
            <Button variant="accent" onClick={() => setSteps({ bricks, title: "My model" })}>
              Build it step by step
            </Button>
            <nav className="model-tools" aria-label="Model file">
              <button className="link" onClick={() => download("model.ldr", toLDraw(bricks))} title="LDraw file: opens in BrickLink Studio, LDCad, LeoCAD">
                Export .ldr
              </button>
              <button className="link" onClick={() => openFile.current?.click()} title="Open a model from BrickLink Studio (.io) or LDraw (.ldr, .mpd)">
                Open…
              </button>
              <button className="link danger" onClick={() => commit([])} title="Remove everything (Undo brings it back)">
                Clear
              </button>
            </nav>
          </>
        ) : (
          <div className="model-empty">
            <p className="model-count">Nothing built yet</p>
            <p className="hint">Click the baseplate to place a part, or press ✦ Create for a design to build.</p>
            <button className="link" onClick={() => openFile.current?.click()} title="BrickLink Studio (.io) or LDraw (.ldr, .mpd)">
              Open a model file…
            </button>
          </div>
        )}
        <input
          ref={openFile}
          hidden
          type="file"
          accept=".io,.ldr,.mpd,.dat"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            try {
              const [{ readIoModel }, { importLDraw, partsToMake }, { makeParts }] = await Promise.all([
                import("./engine/ioFile"),
                import("./engine/ldrawImport"),
                import("./scene/ldraw"),
              ]);
              const text = /\.io$/i.test(f.name) ? await readIoModel(await f.arrayBuffer()) : await f.text();
              // Parts the catalog lacks are made from their LDraw geometry, not left out.
              await makeParts(partsToMake(text));
              const m = importLDraw(text, f.name);
              const left = Object.values(m.missing).reduce((a, b) => a + b, 0);
              commit(m.bricks);
              if (left) alert(`${m.bricks.length} parts loaded; ${left} not in the parts library were left out.`);
            } catch (err) {
              alert(`Couldn't open ${f.name}: ${(err as Error).message}`);
            }
          }}
        />
      </Card>

      {steps && (
        <Suspense fallback={<div className="steps-view" />}>
          <Instructions bricks={steps.bricks} title={steps.title} inventory={inventory} onClose={() => setSteps(null)} />
        </Suspense>
      )}

      {welcome && (
        <div className="welcome" role="dialog" aria-label="What do you want to build?">
          <Card className="welcome-card">
            <h2>What do you want to build?</h2>
            <p className="hint">Choose one — you'll get six designs, real parts, and instructions. No setup.</p>
            <CreatePicker onPick={create} />
            <button
              className="link"
              onClick={() => {
                setWelcome(false);
                localStorage.setItem(WELCOME_KEY, "1");
              }}
            >
              I'll build freely on the baseplate
            </button>
          </Card>
        </div>
      )}

      {ideasStart && (
        <Suspense
          fallback={
            <Card className="card ideas">
              <div className="ideas-loading">Loading the generators…</div>
            </Card>
          }
        >
          <Ideas
            key={JSON.stringify(ideasStart)}
            start={ideasStart}
            inventory={inventory}
            onInstructions={(b, title) => setSteps({ bricks: b, title })}
            onClose={() => setShowIdeas(false)}
            onBuild={(next) => {
              commit(next);
              setShowIdeas(false);
            }}
          />
        </Suspense>
      )}

      <div className="hints">
        <div className="nav-switch" title={`How you move around (detected from your scrolling): ${NAV_HINTS[nav].join(" · ")}`}>
          <Choice
            label="Navigation"
            value={nav}
            onChange={(v) => setNav(v as Nav)}
            options={(["trackpad", "mouse"] as Nav[]).map((n) => ({
              value: n,
              label: (
                <>
                  {n === "trackpad" ? "Trackpad" : "Mouse"}
                  {navAuto && nav === n && <span className="auto">auto</span>}
                </>
              ),
              title: navAuto ? "Detected automatically" : undefined,
            }))}
          />
        </div>
      </div>

      <div className="dock">
        <div className="status">
          {tool === "build" ? (
            <>
              <b>{part.name}</b>
              <span className="hint">
                {fp.d}×{fp.w} studs · {part.h} plate{part.h > 1 ? "s" : ""} · {rot * 90}°
              </span>
              <AimStatus />
              <span className="keys-hint">
                <Key id="rotR">R</Key>
                {nav === "trackpad" ? "or 2-finger tap to rotate" : "to rotate"}
              </span>
            </>
          ) : (
            <>
              <span>Erase: click a part</span>
              <span className="keys-hint">
                <Key id="shift">⇧</Key>+ click also erases in Build · <Key id="build">B</Key> back to Build
              </span>
            </>
          )}
        </div>

        <div className="toolbar">
          <Button variant="accent" size="sm" className="generate" onPointerEnter={() => void loadIdeas()} onClick={() => setShowIdeas(true)} title="Generate dinosaurs, racers, monsters… from any pieces">
            ✦ Create
          </Button>
          <span className="sep" />
          <Choice
            label="Tool"
            value={tool}
            onChange={(v) => setTool(v as Tool)}
            options={[
              { value: "build", label: <>Build <Key id="build">B</Key></>, title: "Build (B)" },
              { value: "erase", label: <>Erase <Key id="erase">E</Key></>, title: "Erase (E)" },
            ]}
          />
          <span className="sep" />
          <Button variant="glass" size="sm" onClick={(e) => rotate(e.shiftKey ? -1 : 1)} title="Rotate (R; ⇧R the other way; or two-finger tap)" aria-label="Rotate">
            <RotateIcon /> <Key id="rotR">R</Key>
          </Button>
          <Button variant="glass" size="sm" onClick={undo} disabled={history.length === 0} title={`Undo (${MOD}Z)`}>
            Undo <Key id="undo">{MOD}Z</Key>
          </Button>
          <Chip selected={showDims} onSelectedChange={setShowDims} title="Dimensions (D)">
            Dimensions <Key id="dims">D</Key>
          </Chip>
          <Chip selected={stressView} onSelectedChange={setStressView} title="Stress view: colour parts by how hard their joint works (S)">
            Stability <Key id="stress">S</Key>
          </Chip>

        </div>
      </div>
    </div>
  );
}

/** A height in the units a builder counts: bricks when it's whole bricks, else plates. */
function heightLabel(plates: number) {
  const p = Math.round(plates * 10) / 10;
  if (p % 3 === 0) return `${p / 3} brick${p === 3 ? "" : "s"} high`;
  return `${p} plate${p === 1 ? "" : "s"} high`;
}

/** Does it hold? One line in words, and the weak spot if there is one (S paints the load). */
function ModelStatus({ physics, bricks }: { physics: ReturnType<typeof analyzeStability>; bricks: PlacedBrick[] }) {
  const loose = physics.floating.size;
  const weak = physics.weak.find((j) => j.ratio > 1);
  const name = (uid: string) => PARTS[bricks.find((b) => b.uid === uid)?.partId ?? ""]?.name ?? "a part";
  if (loose)
    return (
      <p className="model-status bad">
        <b>{loose} loose {loose === 1 ? "part" : "parts"}</b> not attached to anything · <kbd className="key">S</kbd> shows them
      </p>
    );
  if (weak)
    return (
      <p className="model-status warn">
        <b>Weak joint</b> at {name(weak.a)} · <kbd className="key">S</kbd> shows the load
      </p>
    );
  return (
    <p className="model-status ok">
      <b>Holds together</b>
    </p>
  );
}

/** Where the ghost would land. Subscribes to the hover store on its own, so pointer moves re-render only this. */
function AimStatus() {
  const hover = hoverStore.use();
  if (!hover || hover.eraseUid) return null;
  if (hover.ok)
    return (
      <span className="aim-ok">
        x {hover.x} · y {hover.y} · z {hover.z}
      </span>
    );
  if (hover.reason === OUTSIDE) return <span className="hint">Move onto the baseplate to place</span>;
  return <span className="aim-bad">{hover.reason}</span>;
}

/** One quiet button that steps through the themes: follow the system, light, dark. */
const THEMES: { id: ThemePref; glyph: string; label: string }[] = [
  { id: "system", glyph: "◐", label: "Theme: same as the system" },
  { id: "light", glyph: "☀", label: "Theme: light" },
  { id: "dark", glyph: "☾", label: "Theme: dark" },
];
function ThemeSwitch() {
  const pref = useThemePref();
  const at = THEMES.findIndex((t) => t.id === pref);
  const next = THEMES[(at + 1) % THEMES.length];
  return (
    <IconButton variant="ghost" size="sm" aria-label={`${THEMES[at].label}. Switch to ${next.id}`} title={THEMES[at].label} onClick={() => setThemePref(next.id)}>
      <span aria-hidden className="theme-glyph">{THEMES[at].glyph}</span>
    </IconButton>
  );
}

/** Panels in or out: a frame with its side bars, or just the frame. */
function ToolsIcon({ open }: { open: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      {open && <path d="M8 4v16M16 4v16" />}
    </svg>
  );
}

function RotateIcon({ flip }: { flip?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" style={flip ? { transform: "scaleX(-1)" } : undefined}>
      <path
        d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Top-down sketch of a part; arches are drawn from the front. */
function PartIcon({ part }: { part: PartDef }) {
  const box = 36;
  const s = Math.min(8, (box - 4) / Math.max(part.w, part.d));
  const ox = (box - part.w * s) / 2;
  const { shape } = part;

  if (shape.type === "arch") {
    const h = Math.min(part.h * 2.6, box - 8);
    const oy = (box - h) / 2;
    const rx = (shape.span / 2) * s;
    const ry = Math.min(rx, h - 3);
    const x0 = ox + ((part.w - shape.span) / 2) * s;
    const d = `M${ox} ${oy + h} V${oy} H${ox + part.w * s} V${oy + h} H${x0 + 2 * rx} A${rx} ${ry} 0 0 0 ${x0} ${oy + h} Z`;
    return (
      <svg width={box} height={box}>
        <path d={d} fill="currentColor" opacity={0.35} />
      </svg>
    );
  }

  const oy = (box - part.d * s) / 2;
  const slopeFrom = shape.type === "slope" ? shape.flat : null;

  return (
    <svg width={box} height={box}>
      {shape.type === "round" ? (
        <circle cx={box / 2} cy={box / 2} r={(part.w * s) / 2} fill="currentColor" opacity={0.25} />
      ) : (
        <rect x={ox} y={oy} width={part.w * s} height={part.d * s} rx={1.5} fill="currentColor" opacity={0.25} />
      )}
      {slopeFrom !== null && (
        <rect
          x={ox}
          y={oy + slopeFrom * s}
          width={part.w * s}
          height={(part.d - slopeFrom) * s}
          fill="url(#slope)"
        />
      )}
      {shape.type === "inverted" && (
        <line
          x1={ox}
          x2={ox + part.w * s}
          y1={oy + (part.d - 1) * s}
          y2={oy + (part.d - 1) * s}
          stroke="currentColor"
          strokeDasharray="2 2"
          opacity={0.6}
        />
      )}
      <defs>
        <linearGradient id="slope" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity={0.45} />
          <stop offset="1" stopColor="currentColor" stopOpacity={0.05} />
        </linearGradient>
      </defs>
      {part.studs.map(([i, k]) => (
        <circle key={`${i},${k}`} cx={ox + (i + 0.5) * s} cy={oy + (k + 0.5) * s} r={s * 0.3} fill="currentColor" />
      ))}
    </svg>
  );
}
