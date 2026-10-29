import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button, Input, Select, Textarea } from "pane-react";
import { Choice } from "./Choice";
import { VARIANTS } from "../engine/learn/families";
import { FEATURE_KEYS, brief, cellKey, type Cookbook, type Origin } from "../engine/learn/cookbook";
import { askLocalLLM, cookbook, importCookbook, learningState, resetCookbook, setRunning, subscribe, teach } from "../engine/learn/client";

const FEATURE_LABEL: Record<string, string> = {
  safety: "Holds together",
  fidelity: "True to the animal",
  pieces: "Right size",
  richness: "Special parts",
  efficiency: "Lean build",
  symmetry: "Symmetry",
  fit: "Fits the baseplate",
};
const LLM_KEY = "lego-builder:llm-model";

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

/** The learning engine at work: what it's found, its taste, and the doors in (import, LLMs, booklets). */
export function Learning() {
  const cb = useSyncExternalStore(subscribe, cookbook);
  const st = useSyncExternalStore(subscribe, learningState);
  const [text, setText] = useState("");
  const [origin, setOrigin] = useState<Origin>("llm");
  const [model, setModel] = useState(() => localStorage.getItem(LLM_KEY) ?? "llama3.1");
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const importFile = useRef<HTMLInputElement>(null);
  useEffect(() => localStorage.setItem(LLM_KEY, model), [model]);

  if (!cb) return <p className="hint">Starting the learning engine…</p>;

  const report = (r: Awaited<ReturnType<typeof teach>>) => {
    if (r.error) return setResult(`Couldn't read it: ${r.error}`);
    const ok = r.results!.filter((x) => x.accepted).length;
    setResult(`${ok} of ${r.results!.length} proposals made the cookbook.` + (r.results!.some((x) => x.why) ? ` Rejected: ${[...new Set(r.results!.map((x) => x.why).filter(Boolean))].join(", ")}.` : ""));
  };
  const trend = cb.trend.slice(-60);
  const lo = Math.min(...trend.map((t) => t.best), 1), hi = Math.max(...trend.map((t) => t.best), 0);

  return (
    <div className="learn">
      <div className="learn-status">
        <span className={st.running ? "dot live" : "dot"} />
        <b>{st.running ? "Learning" : "Paused"}</b>
        <span className="hint">
          {cb.evals.toLocaleString()} designs tried · {cb.accepted.toLocaleString()} kept{st.running && st.rate ? ` · ${st.rate}/min` : ""}
        </span>
      </div>
      <div className="learn-actions">
        <Choice
          label="Learning"
          value={st.running ? "run" : "pause"}
          onChange={(v) => setRunning(v === "run")}
          options={[
            { value: "run", label: "Run" },
            { value: "pause", label: "Pause" },
          ]}
        />
        <Button variant="glass" size="sm" onClick={() => setRunning(true, true)} title="Use more of this computer's time">
          Turbo
        </Button>
      </div>

      {trend.length > 1 && (
        <svg className="spark" viewBox="0 0 100 24" preserveAspectRatio="none" aria-label="Average best score over time">
          <polyline
            fill="none"
            stroke="var(--ds-action-accent)"
            strokeWidth="1.5"
            points={trend.map((t, i) => `${(i / (trend.length - 1)) * 100},${22 - ((t.best - lo) / Math.max(1e-6, hi - lo)) * 20}`).join(" ")}
          />
        </svg>
      )}

      <h2>Best recipes</h2>
      <ul className="learn-species">
        {VARIANTS.map((sp) => {
          const cells = [0, 1, 2].map((s) => cb.cells[cellKey(sp.id, s)]);
          const best = cells.map((c) => c?.elites[0]);
          const gens = cells.reduce((a, c) => a + (c?.gen ?? 0), 0);
          return (
            <li key={sp.id}>
              <span className="name">{sp.label}</span>
              <span className="bars">
                {best.map((e, i) => (
                  <i key={i} title={e ? `${"SML"[i]}: ${(e.fitness * 100).toFixed(1)} · ${e.origin}${e.note ? ` — ${e.note}` : ""}` : "none yet"} style={{ width: `${Math.max(0, (e?.fitness ?? 0) * 100)}%` }} className={e?.origin ?? ""} />
                ))}
              </span>
              <span className="hint">gen {gens}</span>
            </li>
          );
        })}
      </ul>

      <h2>What it likes (learned from you)</h2>
      <ul className="learn-weights">
        {FEATURE_KEYS.map((k) => (
          <li key={k}>
            <span>{FEATURE_LABEL[k]}</span>
            <span className="bar"><i style={{ width: `${cb.weights[k] * 250}%` }} /></span>
          </li>
        ))}
      </ul>

      <h2>Teach it</h2>
      <p className="hint">
        Give the brief to any LLM and paste its JSON reply, or ask a model running on this computer (Ollama). Notes from a building booklet go in the same way.
        Every proposal is built and measured; only better ones are kept.
      </p>
      <div className="learn-actions">
        <Button variant="glass" size="sm" onClick={() => navigator.clipboard.writeText(brief(cb)).then(() => setResult("Brief copied — paste it into your LLM."))}>
          Copy brief
        </Button>
        <Button variant="glass" size="sm" onClick={() => download("cookbook.json", JSON.stringify(cb))}>
          Export
        </Button>
        <Button variant="glass" size="sm" onClick={() => importFile.current?.click()}>
          Import
        </Button>
        <input
          ref={importFile}
          hidden
          type="file"
          accept="application/json"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) importCookbook(JSON.parse(await f.text()) as Cookbook);
          }}
        />
      </div>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder='[{"species":"rex","size":1,"plan":{…},"note":"…"}]' rows={4} aria-label="Proposals (JSON)" />
      <div className="learn-actions">
        <Select
          size="sm"
          label="Source"
          hideLabel
          value={origin}
          onValueChange={(v) => setOrigin(v as Origin)}
          options={[
            { value: "llm", label: "From an LLM" },
            { value: "booklet", label: "From a booklet" },
          ]}
        />
        <Button
          variant="accent"
          size="sm"
          disabled={!text.trim() || !!busy}
          onClick={async () => {
            setBusy("Measuring…");
            report(await teach(text, origin));
            setBusy(null);
          }}
        >
          {busy ?? "Teach"}
        </Button>
      </div>
      <div className="learn-actions">
        <Input size="sm" value={model} onChange={(e) => setModel(e.target.value)} aria-label="Local model" title="Ollama model name" />
        <Button
          variant="glass"
          size="sm"
          disabled={!!busy}
          onClick={async () => {
            setBusy("Asking the local model…");
            try {
              report(await askLocalLLM(model, brief(cb)));
            } catch (err) {
              setResult(`No local model answered (${(err as Error).message}). Start Ollama, or paste a reply above.`);
            }
            setBusy(null);
          }}
        >
          Ask local LLM
        </Button>
      </div>
      {result && <p className="learn-result">{result}</p>}
      <button className="link" onClick={() => confirm("Forget everything learned and start again from the anchor plans?") && resetCookbook()}>
        Start over
      </button>
    </div>
  );
}
