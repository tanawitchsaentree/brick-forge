import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Brick } from "../scene/Brick";
import { Baseplate } from "../scene/Scene";
import { Controls } from "../scene/Controls";
import { Label } from "../scene/Label";
import { PARTS } from "../engine/parts";
import { colorOf } from "../engine/colors";
import { BASE_SIZE, PLATE_H } from "../engine/units";
import { invKey, type Inventory } from "../engine/inventory";
import { planInstructions, type Instructions as Plan, type Step } from "../engine/instructions";
import { renderPlacement, type PlacedBrick } from "../engine/grid";
import { apply, partMatrix, worldBox } from "../engine/pose";
import { renderModelImageLDraw } from "../scene/thumbnails";
import { PartThumb } from "./PartThumb";
import { whyText } from "../engine/why";
import { SCENE, useTheme } from "./theme";
import { Badge, Button, Card, Chip, IconButton, Slider } from "pane-react";

interface Props {
  bricks: PlacedBrick[];
  title: string;
  inventory: Inventory;
  onClose: () => void;
}

const NEW_GLOW = "#3b82f6";

/** Group a step's parts into callout lines: part × colour → quantity. */
function callout(step: Step) {
  const m = new Map<string, { partId: string; color: number; qty: number }>();
  for (const p of step.parts) {
    const k = `${p.partId}:${p.color}`;
    const row = m.get(k) ?? { partId: p.partId, color: p.color, qty: 0 };
    row.qty++;
    m.set(k, row);
  }
  return [...m.values()];
}

/** World point above the middle of a part's top face (where its marker goes). */
function topOf(b: PlacedBrick): [number, number, number] {
  const part = PARTS[b.partId];
  return apply(partMatrix(b), [part.w / 2, part.h * PLATE_H, part.d / 2]);
}

/** Where an exactly placed part goes: its stud position and height, as the grid rulers read. */
function placeText(b: PlacedBrick) {
  const { lo, hi } = worldBox(b);
  const up = lo[1] / PLATE_H;
  return `x${Math.round((lo[0] + hi[0]) / 2)} · z${Math.round((lo[2] + hi[2]) / 2)} · ${up < 0.5 ? "on the baseplate" : `${(up * 3.2).toFixed(1)} mm up`}`;
}

const mmss = (s: number) => (s < 60 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`);

/** A stable key for a model, so its build progress can be saved and resumed. */
function modelKey(bricks: PlacedBrick[]) {
  let h = 2166136261;
  for (const b of bricks) for (const c of `${b.partId}${b.x},${b.y},${b.z},${b.rot},${b.color}${b.seg ?? ""};`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return `lego-builder:progress:${(h >>> 0).toString(36)}:${bricks.length}`;
}

interface Progress {
  step: number;
  done: number[];
}

function loadProgress(key: string): Progress | null {
  try {
    const p = JSON.parse(localStorage.getItem(key) ?? "null");
    return p && Array.isArray(p.done) ? p : null;
  } catch {
    return null;
  }
}

export function Instructions({ bricks, title, inventory, onClose }: Props) {
  const look = SCENE[useTheme()];
  const plan = useMemo(() => planInstructions(bricks), [bricks]);
  const N = plan.steps.length;
  // Build progress is saved per model: where you were, and which steps are done.
  const key = useMemo(() => modelKey(bricks), [bricks]);
  const saved = useMemo(() => loadProgress(key), [key]);
  const [step, setStep] = useState(() => Math.min(saved?.step ?? 0, Math.max(0, plan.steps.length - 1)));
  const [doneSteps, setDoneSteps] = useState<Set<number>>(() => new Set(saved?.done ?? []));
  const [resumed, setResumed] = useState(() => !!saved && (saved.step > 0 || saved.done.length > 0));
  const [showList, setShowList] = useState(false); // chapters on demand: the step comes first
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify({ step, done: [...doneSteps] } satisfies Progress));
  }, [key, step, doneSteps]);
  useEffect(() => {
    if (!resumed) return;
    const t = window.setTimeout(() => setResumed(false), 3500);
    return () => clearTimeout(t);
  }, [resumed]);
  /** Mark this step built and go on (or just go on if it already was). */
  const finishStep = () => {
    setDoneSteps((d) => new Set(d).add(step));
    setStep((s) => Math.min(N - 1, s + 1));
  };
  const toggleDone = (k: number) =>
    setDoneSteps((d) => {
      const n = new Set(d);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const [xray, setXray] = useState(false);
  const [auto, setAuto] = useState(false);
  const [printing, setPrinting] = useState<string | null>(null);
  const owns = Object.keys(inventory).length > 0;
  const go = (s: number) => setStep(Math.min(N - 1, Math.max(0, s)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        finishStepRef.current();
      } else if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        setStep((s) => Math.min(N - 1, s + 1));
      } else if (e.key === "ArrowLeft") setStep((s) => Math.max(0, s - 1));
      else if (e.key === "Home") setStep(0);
      else if (e.key === "End") setStep(N - 1);
      else if (e.key === "Escape") onClose();
      else if (e.code === "KeyX") setXray((v) => !v); // key position, so Thai layouts work too
      else return;
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [N, onClose]);

  const finishStepRef = useRef(finishStep);
  finishStepRef.current = finishStep;

  useEffect(() => {
    if (!auto) return;
    if (step >= N - 1) return setAuto(false);
    // Time to find and place this step's pieces, not a fixed beat.
    const pieces = plan.steps[step]?.parts.length ?? 1;
    const t = window.setTimeout(() => setStep((s) => s + 1), 1500 + 1000 * pieces);
    return () => clearTimeout(t);
  }, [auto, step, N, plan]);

  const current = plan.steps[step];
  const done = new Set(plan.steps.slice(0, step).flatMap((s) => s.parts.map((p) => p.index)));
  const now = new Set(current.parts.map((p) => p.index));
  const left = plan.steps.reduce((a, s, k) => (doneSteps.has(k) ? a : a + s.seconds), 0);
  const chapterNo = plan.chapters.findIndex((c) => step >= c.first && step < c.first + c.steps);
  const placedSoFar = done.size + now.size;

  return (
    <div className="steps-view" role="dialog" aria-label="Building instructions">
      <Canvas
        shadows
        frameloop="demand"
        dpr={[1, 1.75]}
        camera={{ position: [BASE_SIZE / 2 + 20, 24, BASE_SIZE / 2 + 26], fov: 40 }}
      >
        <color attach="background" args={[look.background]} />
        <hemisphereLight args={[look.sky, look.ground, 1.15]} />
        <directionalLight position={[BASE_SIZE / 2 + 18, 40, BASE_SIZE / 2 + 12]} intensity={1.6} castShadow shadow-mapSize={[1536, 1536]} shadow-camera-left={-30} shadow-camera-right={30} shadow-camera-top={30} shadow-camera-bottom={-30} />
        <Baseplate />
        {[...done].map((i) => {
          const b = bricks[i];
          return (
            <Brick
              key={b.uid}
              part={PARTS[b.partId]}
              {...renderPlacement(b)}
              color={colorOf(b.color).hex}
              alpha={colorOf(b.color).alpha}
              ghost={xray}
              opacity={0.22}
              noDrop
            />
          );
        })}
        {/* Each new part: first its shadow where it goes, and the part held above it;
            then, one after another, it's lowered in and clicks (a flash). */}
        {current.parts.map((p, n) => {
          const b = bricks[p.index];
          const delay = ARRIVE + n * STAGGER;
          return (
            <group key={`${b.uid}@${step}`}>
              <Landing until={delay + LOWER}>
                <Brick part={PARTS[b.partId]} {...renderPlacement(b)} color={NEW_GLOW} ghost opacity={0.16} outline={NEW_GLOW} />
              </Landing>
              <Brick
                part={PARTS[b.partId]}
                {...renderPlacement(b)}
                color={colorOf(b.color).hex}
                alpha={colorOf(b.color).alpha}
                highlight
                glow={NEW_GLOW}
                enterDelay={delay}
                dropHeight={HOLD_HEIGHT}
                dropTime={LOWER}
              />
            </group>
          );
        })}
        <Markers bricks={bricks} step={current} />
        {/* The step card covers the left, the chapter list (when open) the right: aim at what's left between them. */}
        <StepCamera plan={plan} step={current} left={16 + 300 + 16} right={showList ? 16 + 260 + 16 : 0} />
        <Controls target={[plan.modelCenter[0], plan.modelCenter[1] * PLATE_H, plan.modelCenter[2]]} maxPolarAngle={Math.PI / 2.05} rightPan />
      </Canvas>

      <Card as="header" className="steps-top">
        <div>
          <h2>{title}</h2>
          <p className="hint">
            {bricks.length} pieces · {N} steps · ~{mmss(plan.steps.reduce((a, s) => a + s.seconds, 0))} total
          </p>
        </div>
        <div className="progress" aria-label={`${doneSteps.size} of ${N} steps done`} title={`${doneSteps.size} of ${N} steps done`}>
          <i style={{ width: `${(doneSteps.size / N) * 100}%` }} />
        </div>
        <span className="hint">{Math.round((doneSteps.size / N) * 100)}% built</span>
        <div className="steps-actions">
          <Chip selected={xray} onSelectedChange={setXray} title="Fade earlier steps (X)">
            X-ray <kbd className="key">X</kbd>
          </Chip>
          <Button variant="glass" size="sm" onClick={() => setAuto((v) => !v)}>
            {auto ? "❚❚ Pause" : "▶ Play"}
          </Button>
          <Button
            variant="glass"
            size="sm"
            disabled={!!printing}
            onClick={async () => {
              setPrinting("Preparing…");
              await printBooklet(plan, title, setPrinting);
              setPrinting(null);
            }}
          >
            {printing ?? "Print booklet"}
          </Button>
          <Button
            variant="glass"
            size="sm"
            title="The same steps as an LPub3D book (.mpd): open it in LPub3D for print-ready pages, callouts and a parts list"
            onClick={async () => {
              const { toLPub } = await import("../engine/lpub");
              const url = URL.createObjectURL(new Blob([toLPub(plan, title)], { type: "text/plain" }));
              Object.assign(document.createElement("a"), { href: url, download: `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "model"}.mpd` }).click();
              URL.revokeObjectURL(url);
            }}
          >
            LPub3D file
          </Button>
          <Chip selected={showList} onSelectedChange={setShowList} title="Chapters and steps">
            ☰ Steps
          </Chip>
          <IconButton variant="ghost" size="sm" onClick={onClose} aria-label="Close instructions">
            ✕
          </IconButton>
        </div>
      </Card>

      {showList && (
        <Card as="aside" className="steps-list" aria-label="Chapters and steps">
          <div className="steps-list-head">
            <b>Chapters</b>
            <button className="link" onClick={() => setDoneSteps(new Set())} disabled={!doneSteps.size}>
              Reset progress
            </button>
          </div>
          {plan.chapters.map((c, ci) => {
            const doneHere = Array.from({ length: c.steps }, (_, i) => c.first + i).filter((k) => doneSteps.has(k)).length;
            return (
              <div key={`${c.name}-${ci}`} className={ci === chapterNo ? "chap on" : "chap"}>
                <button className="chap-title" onClick={() => go(c.first)}>
                  <span className={doneHere === c.steps ? "chk full" : "chk"}>{doneHere === c.steps ? "✓" : ci + 1}</span>
                  {c.name}
                  <span className="hint">
                    {doneHere}/{c.steps}
                  </span>
                </button>
                <div className="dots">
                  {Array.from({ length: c.steps }, (_, i) => c.first + i).map((k) => (
                    <button
                      key={k}
                      className={`dot-step${doneSteps.has(k) ? " done" : ""}${k === step ? " cur" : ""}`}
                      onClick={() => go(k)}
                      onDoubleClick={() => toggleDone(k)}
                      title={`Step ${k + 1}${doneSteps.has(k) ? " · done" : ""} (double-click to toggle done)`}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </Card>
      )}

      <Card as="aside" className={showList ? "steps-card" : "steps-card solo"}>
        {resumed && <p className="resumed">↺ Welcome back — resumed at step {step + 1}.</p>}
        <p className="chapter-name">
          Chapter {chapterNo + 1} · <b>{current.chapter}</b>
        </p>
        <div className="step-no">
          <span>Step</span>
          <b>{step + 1}</b>
          <span className="hint">/ {N}</span>
          {doneSteps.has(step) && <Badge tone="positive">✓ done</Badge>}
        </div>
        {current.subassemblies.map((s) => (
          <div key={s.partId} className="subasm">
            <p>
              <b>First build {s.count}×</b> {PARTS[s.partId]?.name}
            </p>
            <div className="subasm-row">
              {s.components.map((c, i) => (
                <span key={i} className="comp">
                  {PARTS[c.partId] ? <PartThumb part={PARTS[c.partId]} hex={colorOf(c.color).hex} size={40} /> : <span className="thumb loading" style={{ width: 40, height: 40 }} />}
                  {i < s.components.length - 1 && <em>+</em>}
                </span>
              ))}
              <em>→</em>
              <PartThumb part={PARTS[s.partId]} hex={colorOf(s.color).hex} size={44} />
            </div>
          </div>
        ))}
        <ul className="callout">
          {callout(current).map((r) => {
            const part = PARTS[r.partId];
            const have = inventory[invKey(r.partId, r.color)] ?? 0;
            return (
              <li key={`${r.partId}:${r.color}`}>
                <PartThumb part={part} hex={colorOf(r.color).hex} size={48} />
                <b className="qty">{r.qty}×</b>
                <span className="cname">
                  {part.name}
                  <span className="hint">
                    {colorOf(r.color).name} · #{part.id}
                    {owns && (have > 0 ? <span className="have"> · in library</span> : <span className="lack"> · not in library</span>)}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
        <p className="where hint">
          {current.parts.map((p, n) => {
            const b = bricks[p.index];
            return (
              // Why the engine chose the part is there on hover, not in the builder's way.
              <span key={p.index} title={b.why ? `${PARTS[b.partId]?.name}: ${whyText(b.why)}` : undefined}>
                <b>{n + 1}</b> {b.pose ? `on the ${current.chapter.toLowerCase()}` : b.place ? placeText(b) : <>x{b.x} · z{b.z} · {b.y === 0 ? "on the baseplate" : `${(b.y * 3.2).toFixed(1)} mm up`}</>}
              </span>
            );
          })}
        </p>
        {current.tip && <p className="tip">↻ {current.tip}</p>}
        {current.warn && <p className="warn">⚠ {current.warn}</p>}
        <p className="hint">
          ~{mmss(current.seconds)} this step · {placedSoFar}/{bricks.length} pieces · ~{mmss(left)} to go
        </p>
      </Card>

      <Card as="div" className="steps-nav">
        <Button variant="glass" size="sm" onClick={() => go(step - 1)} disabled={step === 0}>
          ← Back <kbd className="key">←</kbd>
        </Button>
        <Slider label="Step" min={0} max={N - 1} value={step} onValueChange={go} format={(v) => `${v + 1} / ${N}`} className="steps-scrub" />
        <Button variant="glass" size="sm" onClick={() => go(step + 1)} disabled={step === N - 1}>
          Skip <kbd className="key">→</kbd>
        </Button>
        <Button variant="accent" size="sm" onClick={finishStep} disabled={doneSteps.size === N}>
          {doneSteps.size === N ? "Built 🎉" : step === N - 1 && doneSteps.has(step) ? "Built 🎉" : "✓ Done"} <kbd className="key">⏎</kbd>
        </Button>
      </Card>
    </div>
  );
}

// Step choreography: the new parts appear held above the model (HOLD_HEIGHT studs)
// with their outline where they go, then go in one by one.
const HOLD_HEIGHT = 4;
const ARRIVE = 0.55; // s: look at the step first
const STAGGER = 0.35; // s between parts
const LOWER = 0.75; // s to set a part down

/** Shows its children until `until` seconds after mounting (a landing spot, gone once the part is in). */
function Landing({ until, children }: { until: number; children: React.ReactNode }) {
  const [on, setOn] = useState(true);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const t = window.setTimeout(() => {
      setOn(false);
      invalidate();
    }, until * 1000);
    return () => clearTimeout(t);
  }, [until, invalidate]);
  return on ? <>{children}</> : null;
}

/** Numbered tags and a drop line above each new part, so it's obvious where it goes. */
function Markers({ bricks, step }: { bricks: PlacedBrick[]; step: Step }) {
  const lines = useMemo(() => {
    const pts: number[] = [];
    for (const p of step.parts) {
      const [x, top, z] = topOf(bricks[p.index]);
      pts.push(x, top, z, x, top + 2.2, z);
    }
    return new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  }, [bricks, step]);
  useEffect(() => () => lines.dispose(), [lines]);
  return (
    <group>
      <lineSegments geometry={lines} raycast={() => null}>
        <lineBasicMaterial color={NEW_GLOW} transparent opacity={0.7} />
      </lineSegments>
      {step.parts.map((p, n) => {
        const [x, top, z] = topOf(bricks[p.index]);
        return (
          <Label
            key={p.index}
            text={String(n + 1)}
            position={[x, top + 2.5, z]}
            color="#ffffff"
            background={NEW_GLOW}
            size={0.03}
          />
        );
      })}
    </group>
  );
}

/** Glides the camera to look at each step's new parts from the side they face. */
function StepCamera({ plan, step, left, right }: { plan: Plan; step: Step; left: number; right: number }) {
  const get = useThree((s) => s.get);
  const size = useThree((s) => s.size);
  // Shift the picture's centre into the uncovered part of the window (a view
  // offset moves the frustum, not the camera, so orbiting still turns about the model).
  useEffect(() => {
    const cam = get().camera as THREE.PerspectiveCamera;
    cam.setViewOffset(size.width, size.height, -(left - right) / 2, 0, size.width, size.height);
    cam.updateProjectionMatrix();
    get().invalidate();
    return () => {
      cam.clearViewOffset();
      cam.updateProjectionMatrix();
    };
  }, [get, size.width, size.height, left, right]);
  const goal = useRef<{ pos: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  useEffect(() => {
    const target = new THREE.Vector3(step.center[0], step.center[1] * PLATE_H, step.center[2]);
    const dist = Math.max(20, plan.radius * 3.4); // far enough to see the step in the model, not just the part
    const elev = (32 * Math.PI) / 180;
    const pos = new THREE.Vector3(
      target.x + Math.cos(step.azimuth) * Math.cos(elev) * dist,
      target.y + Math.sin(elev) * dist,
      target.z + Math.sin(step.azimuth) * Math.cos(elev) * dist,
    );
    goal.current = { pos, target };
    get().invalidate();
  }, [step, plan, get]);
  useFrame((state, dt) => {
    const g = goal.current;
    const controls = state.controls as unknown as { target: THREE.Vector3; update: () => void } | null;
    if (!g || !controls) return;
    const k = 1 - Math.exp(-dt * 5);
    state.camera.position.lerp(g.pos, k);
    controls.target.lerp(g.target, k);
    controls.update();
    if (state.camera.position.distanceTo(g.pos) < 0.05) goal.current = null;
    else state.invalidate();
  });
  return null;
}

/**
 * A printable booklet: every step rendered with real parts (earlier steps
 * washed out, new parts in full colour, from the step's own angle) with its
 * parts callout, two steps per page. The browser's print dialog saves a PDF.
 */
async function printBooklet(plan: Plan, title: string, progress: (s: string) => void) {
  const w = window.open("", "_blank");
  if (!w) return;
  const css = `
    body{font:13px system-ui,sans-serif;color:#1c2430;margin:24px}
    h1{font-size:22px;margin:0 0 4px} .meta{color:#6b7685;margin:0 0 20px}
    .page{display:grid;grid-template-columns:1fr 1fr;gap:18px;page-break-after:always}
    .step{border:1px solid #e3e8ee;border-radius:12px;padding:12px;break-inside:avoid}
    .no{font-size:28px;font-weight:700} .step img.view{width:100%;display:block}
    .parts{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}
    .p{display:flex;align-items:center;gap:4px;font-weight:600}
    .t{position:relative;width:40px;height:40px;display:inline-block}
    .t::before{content:"";position:absolute;inset:0;background:var(--tint);-webkit-mask:var(--src) center/contain no-repeat;mask:var(--src) center/contain no-repeat}
    .t img{position:absolute;inset:0;width:100%;height:100%;mix-blend-mode:multiply}
    .warn{color:#8a5a00} .sub{color:#1f6feb;font-size:12px}
    @media print{body{margin:10mm}}`;
  w.document.write(`<!doctype html><title>${title} — instructions</title><style>${css}</style><h1>${title}</h1><p class="meta">${plan.bricks.length} pieces · ${plan.steps.length} steps</p><div id="out">Rendering…</div>`);
  const out = w.document.getElementById("out")!;
  out.textContent = "";
  let page: HTMLElement | null = null;
  const placed: PlacedBrick[] = [];
  for (let s = 0; s < plan.steps.length; s++) {
    progress(`Rendering ${s + 1}/${plan.steps.length}…`);
    const step = plan.steps[s];
    const fresh = new Set(step.parts.map((p) => plan.bricks[p.index].uid));
    placed.push(...step.parts.map((p) => plan.bricks[p.index]));
    const img = await renderModelImageLDraw(placed, 520, { fresh, azimuth: step.azimuth });
    if (s % 2 === 0) {
      page = w.document.createElement("div");
      page.className = "page";
      out.appendChild(page);
    }
    const parts = callout(step)
      .map((r) => {
        const src = `${location.origin}/thumbs/${r.partId}.webp`;
        return `<span class="p"><span class="t" style="--tint:${colorOf(r.color).hex};--src:url(${src})"><img src="${src}"></span>${r.qty}×</span>`;
      })
      .join("");
    const subs = step.subassemblies.map((x) => `<div class="sub">First build ${x.count}× ${PARTS[x.partId]?.name}</div>`).join("");
    const el = w.document.createElement("div");
    el.className = "step";
    el.innerHTML = `<div class="no">${s + 1}</div>${subs}<img class="view" src="${img}"><div class="parts">${parts}</div>${step.warn ? `<p class="warn">⚠ ${step.warn}</p>` : ""}`;
    page!.appendChild(el);
  }
  w.focus();
  w.print();
}
