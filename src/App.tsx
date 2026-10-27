import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Scene, hoverStore, type Nav, type Tool } from "./scene/Scene";
import { PartThumb } from "./ui/PartThumb";
// Heavy screens load when first opened, so the editor itself starts fast.
const MyLibrary = lazy(() => import("./ui/MyLibrary").then((m) => ({ default: m.MyLibrary })));
const Ideas = lazy(() => import("./ui/Ideas").then((m) => ({ default: m.Ideas })));
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
const VIEW_KEY = "lego-builder:library-view";
const INVENTORY_KEY = "lego-builder:inventory";
const WELCOME_KEY = "lego-builder:welcomed";

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

type LibraryView = "icon" | "3d";

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = IS_MAC ? "⌘" : "Ctrl ";

const PAGE = 60; // parts rendered per "Show more"
// Categories that get a chip; the rest go in the "More" menu.
const PRIMARY_CATEGORIES = ["Brick", "Plate", "Tile", "Slope", "People", "Wedge", "Arch", "Round", "Cylinder", "Panel", "Technic", "Minifig"];

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
  const flashTimer = useRef<number>(0);
  const flash = (id: string) => {
    setPressed(id);
    clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setPressed(null), 220);
  };
  const Key = ({ id, children }: { id: string; children: ReactNode }) => (
    <kbd className={pressed === id ? "key hit" : "key"}>{children}</kbd>
  );
  const [libView, setLibView] = useState<LibraryView>(
    () => (localStorage.getItem(VIEW_KEY) as LibraryView) ?? "3d",
  );
  // Creating comes first: the Create tab leads, and an empty scene opens on the picker.
  const [tab, setTab] = useState<"create" | "catalog" | "mine" | "learn">("create");
  // The learning engine starts once the editor is up, in its own worker.
  useEffect(() => {
    const t = window.setTimeout(() => import("./engine/learn/client").then((m) => m.start()), 2500);
    return () => clearTimeout(t);
  }, []);
  const [inventory, setInventory] = useState<Inventory>(loadInventory);
  const [ideasStart, setIdeasStart] = useState<Start | null>(null);
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
  useEffect(() => localStorage.setItem(VIEW_KEY, libView), [libView]);
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
    <div className="app">
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

      <aside className="card left">
        <header className="card-head">
          <h1>Lego Builder</h1>
          <div className="seg small" title="Library view">
            <button className={libView === "icon" ? "on" : ""} onClick={() => setLibView("icon")}>
              Icon
            </button>
            <button className={libView === "3d" ? "on" : ""} onClick={() => setLibView("3d")}>
              3D
            </button>
          </div>
        </header>
        <div className="seg tabs">
          <button className={tab === "create" ? "on" : ""} onClick={() => setTab("create")}>
            ✦ Create
          </button>
          <button className={tab === "catalog" ? "on" : ""} onClick={() => setTab("catalog")}>
            Catalog
          </button>
          <button className={tab === "mine" ? "on" : ""} onClick={() => setTab("mine")}>
            My Library{totalPieces(inventory) > 0 && <span className="count-badge">{totalPieces(inventory)}</span>}
          </button>
          <button className={tab === "learn" ? "on" : ""} onClick={() => setTab("learn")} title="The learning engine">
            Learn
          </button>
        </div>

        {tab === "create" ? (
          <div className="create-tab">
            <p className="small muted">Pick what to build. You get six designs to choose from, each with step-by-step instructions — no pieces needed up front.</p>
            <CreatePicker compact onPick={create} />
            <p className="small muted">
              Have a collection? Add it under <button className="link" onClick={() => setTab("mine")}>My Library</button> and switch designs to “Only mine”.
            </p>
          </div>
        ) : tab === "learn" ? (
          <Suspense fallback={<p className="muted small">Loading…</p>}>
            <Learning />
          </Suspense>
        ) : tab === "mine" ? (
          <Suspense fallback={<p className="muted small">Loading…</p>}>
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
        <input
          className="search"
          type="search"
          placeholder="Search parts or part #"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {!query && (
          <div className="chips">
            {cats.primary.map((c) => (
              <button key={c} className={c === category ? "chip on" : "chip"} onClick={() => setCategory(c)}>
                {c}
              </button>
            ))}
            {cats.rest.length > 0 && (
              <select
                className={cats.rest.includes(category) ? "chip on" : "chip"}
                value={cats.rest.includes(category) ? category : ""}
                onChange={(e) => e.target.value && setCategory(e.target.value)}
              >
                <option value="">More…</option>
                {cats.rest.map((c) => (
                  <option key={c} value={c}>
                    {c} ({cats.counts.get(c)})
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
        <div className="count-row">
          <p className="muted count">
            {visibleParts.length.toLocaleString()} part{visibleParts.length === 1 ? "" : "s"}
            {query ? ` matching “${query}”` : ` in ${category}`}
            {!ldraw && " · built-in set (run npm run catalog for LDraw)"}
          </p>
          {ldraw && (
            <label className="toggle small" title="Parts with printed patterns">
              <input type="checkbox" checked={showPrints} onChange={(e) => setShowPrints(e.target.checked)} /> Prints
            </label>
          )}
        </div>

        <div className={libView === "3d" ? "parts thumbs" : "parts"}>
          {visibleParts.slice(0, limit).map((p) => (
            <div key={p.id} className={bump === p.id ? "part-wrap bumped" : "part-wrap"}>
              <button
                className={p.id === partId ? "part on" : "part"}
                onClick={() => pick(p)}
                title={`${p.name} (#${p.id})`}
              >
                {libView === "3d" ? <PartThumb part={p} hex={colorOf(color).hex} /> : <PartIcon part={p} />}
                <span>{p.label}</span>
              </button>
              <button
                className="add"
                onClick={(e) => addToLibrary(p, e.shiftKey ? 10 : 1)}
                title={`Add 1 ${colorOf(color).name} to My Library (⇧ adds 10)`}
                aria-label="Add to My Library"
              >
                +
              </button>
              {(inventory[invKey(p.id, color)] ?? 0) > 0 && (
                <span className="owned" title="In My Library, this colour">
                  {inventory[invKey(p.id, color)]}
                </span>
              )}
            </div>
          ))}
          {visibleParts.length > limit && (
            <button className="more" onClick={() => setLimit((l) => l + PAGE)}>
              Show more ({(visibleParts.length - limit).toLocaleString()} left)
            </button>
          )}
          {visibleParts.length === 0 && <p className="muted">No parts match “{query}”.</p>}
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
              onClick={() => setColor(c.code)}
            />
          ))}
        </div>
          </>
        )}
      </aside>

      <aside className="card right">
        <h2>Model</h2>
        {box ? (
          <table className="dims">
            <tbody>
              <tr>
                <td>Width (X)</td>
                <td>{box.maxX - box.minX} studs</td>
                <td>{(box.maxX - box.minX) * STUD_MM} mm</td>
              </tr>
              <tr>
                <td>Depth (Z)</td>
                <td>{box.maxZ - box.minZ} studs</td>
                <td>{(box.maxZ - box.minZ) * STUD_MM} mm</td>
              </tr>
              <tr>
                <td>Height (Y)</td>
                <td>{box.maxY - box.minY} plates</td>
                <td>{((box.maxY - box.minY) * PLATE_MM).toFixed(1)} mm</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <p className="muted">Empty. Click the baseplate to place a part.</p>
        )}

        {box && (
          <>
            <h2>Physics</h2>
            <table className="dims">
              <tbody>
                <tr>
                  <td>Weight</td>
                  <td>{physics.massG < 1000 ? `${physics.massG.toFixed(1)} g` : `${(physics.massG / 1000).toFixed(2)} kg`}</td>
                  <td>ABS est.</td>
                </tr>
                {physics.com && (
                  <tr>
                    <td>Centre of mass</td>
                    <td>
                      {physics.com[0].toFixed(1)}, {physics.com[2].toFixed(1)}
                    </td>
                    <td>{(physics.com[1] * PLATE_MM).toFixed(0)} mm up</td>
                  </tr>
                )}
                <tr>
                  <td>Stability</td>
                  <td className={physics.worst <= 1 ? "ok" : "bad"}>
                    {physics.floating.size ? `${physics.floating.size} loose` : physics.worst <= 1 ? "Holds" : "Weak joint"}
                  </td>
                  <td>{Number.isFinite(physics.worst) ? `${Math.round(physics.worst * 100)}% max` : "—"}</td>
                </tr>
              </tbody>
            </table>
            {physics.weak.length > 0 && (
              <ul className="weak">
                {physics.weak.slice(0, 3).map((j) => {
                  const b = bricks.find((x) => x.uid === j.a);
                  return (
                    <li key={j.a}>
                      <span>{b ? PARTS[b.partId].name : "Part"}</span>
                      <span className="muted">
                        {j.studs} stud{j.studs === 1 ? "" : "s"} · {Math.round(j.ratio * 100)}%
                      </span>
                    </li>
                  );
                })}
                <li className="muted small">Press S to see the load as colour.</li>
              </ul>
            )}
          </>
        )}

        <h2>Parts list · {bricks.length}</h2>
        <div className="bom-wrap">
          <table className="bom">
            <tbody>
              {bom.map((r) => (
                <tr key={`${r.partId}:${r.color}`}>
                  <td>
                    <i className="dot" style={{ background: colorOf(r.color).hex }} />
                  </td>
                  <td>{PARTS[r.partId].name}</td>
                  <td className="muted">#{r.partId}</td>
                  <td className="qty">×{r.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {missing.length > 0 && (
          <button
            className="missing"
            onClick={() => download("missing-pieces.csv", shoppingCSV(missing))}
            title="Download what this model needs beyond My Library (Rebrickable CSV)"
          >
            Missing from My Library: <b>{missing.reduce((a, r) => a + r.qty, 0)}</b> · CSV
          </button>
        )}

        <button className="steps-open" onClick={() => setSteps({ bricks, title: "My model" })} disabled={bricks.length === 0}>
          ▤ Building instructions
        </button>

        <div className="card-actions">
          <button onClick={() => commit([])} disabled={bricks.length === 0}>
            Clear
          </button>
          <button
            className="primary"
            disabled={bricks.length === 0}
            onClick={() => download("model.ldr", toLDraw(bricks))}
          >
            Export .ldr
          </button>
        </div>
      </aside>

      {steps && (
        <Suspense fallback={<div className="steps-view" />}>
          <Instructions bricks={steps.bricks} title={steps.title} inventory={inventory} onClose={() => setSteps(null)} />
        </Suspense>
      )}

      {welcome && (
        <div className="welcome" role="dialog" aria-label="What do you want to build?">
          <div className="welcome-card">
            <h2>What do you want to build?</h2>
            <p className="muted">Choose one — you'll get six designs, real parts, and instructions. No setup.</p>
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
          </div>
        </div>
      )}

      {ideasStart && (
        <Suspense fallback={<div className="card ideas"><div className="ideas-loading">Loading the generators…</div></div>}>
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
          <div className="seg small nav-switch" title="How you move around: detected from your scrolling">
            <button className={nav === "trackpad" ? "on" : ""} onClick={() => setNav("trackpad")} title={navAuto ? "Detected automatically" : undefined}>
              Trackpad{navAuto && nav === "trackpad" && <span className="auto">auto</span>}
            </button>
            <button className={nav === "mouse" ? "on" : ""} onClick={() => setNav("mouse")} title={navAuto ? "Detected automatically" : undefined}>
              Mouse{navAuto && nav === "mouse" && <span className="auto">auto</span>}
            </button>
          </div>
        {NAV_HINTS[nav].map((h) => (
          <span key={h}>{h}</span>
        ))}
      </div>

      <div className="dock">
        <div className="status">
          {tool === "build" ? (
            <>
              <b>{part.name}</b>
              <span className="muted">
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
          <button className="create" onClick={() => setShowIdeas(true)} title="Generate dinosaurs, racers, monsters… from any pieces">
            ✦ Create
          </button>
          <span className="sep" />
          <div className="seg">
            <button className={tool === "build" ? "on" : ""} onClick={() => setTool("build")} title="Build (B)">
              Build <Key id="build">B</Key>
            </button>
            <button className={tool === "erase" ? "on" : ""} onClick={() => setTool("erase")} title="Erase (E)">
              Erase <Key id="erase">E</Key>
            </button>
          </div>
          <span className="sep" />
          <button className="icon" onClick={() => rotate(-1)} title="Rotate left (Shift+R)">
            <RotateIcon flip /> <Key id="rotL">⇧R</Key>
          </button>
          <button className="icon" onClick={() => rotate(1)} title="Rotate right (R, or two-finger tap)">
            <RotateIcon /> <Key id="rotR">R</Key>
          </button>
          <span className="sep" />
          <button onClick={undo} disabled={history.length === 0} title={`Undo (${MOD}Z)`}>
            Undo <Key id="undo">{MOD}Z</Key>
          </button>
          <button className={showDims ? "on" : ""} onClick={() => setShowDims((s) => !s)} title="Dimensions (D)">
            Dimensions <Key id="dims">D</Key>
          </button>
          <button
            className={stressView ? "on" : ""}
            onClick={() => setStressView((v) => !v)}
            title="Stress view: colour parts by how hard their joint works (S)"
          >
            Stability <Key id="stress">S</Key>
          </button>

        </div>
      </div>
    </div>
  );
}

/** Where the ghost would land. Subscribes to the hover store on its own, so pointer moves re-render only this. */
function AimStatus() {
  const hover = hoverStore.use();
  if (!hover || hover.eraseUid) return null;
  if (hover.ok)
    return (
      <span className="ok">
        x {hover.x} · y {hover.y} · z {hover.z}
      </span>
    );
  if (hover.reason === OUTSIDE) return <span className="muted">Move onto the baseplate to place</span>;
  return <span className="bad">{hover.reason}</span>;
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
