import type { Cookbook, Features, Origin } from "./cookbook";
import type { FromWorker, ToWorker } from "./worker";

// The app's side of the learning engine: starts the worker once the page has
// settled, keeps the latest cookbook for the generators, and passes on what
// you do (builds, finished instructions) as lessons.

let worker: Worker | null = null;
let latest: Cookbook | null = null;
let state = { running: true, rate: 0 };
const listeners = new Set<() => void>();
const tickets = new Map<number, (m: Extract<FromWorker, { type: "ingested" }>) => void>();
let nextTicket = 1;
const RUN_KEY = "lego-builder:learning";

function send(m: ToWorker) {
  start();
  worker!.postMessage(m);
}

/** Start learning (idempotent). Called after first paint so loading isn't slowed. */
export function start() {
  if (worker) return;
  worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<FromWorker>) => {
    const m = e.data;
    if (m.type === "cookbook") {
      latest = m.cookbook;
      state = { running: m.running, rate: m.rate };
      listeners.forEach((fn) => fn());
    } else if (m.type === "ingested") {
      tickets.get(m.ticket)?.(m);
      tickets.delete(m.ticket);
    }
  };
  const on = localStorage.getItem(RUN_KEY) !== "off";
  worker.postMessage({ type: "run", on } satisfies ToWorker);
  // Rest while the tab is hidden.
  document.addEventListener("visibilitychange", () => {
    if (localStorage.getItem(RUN_KEY) === "off") return;
    worker?.postMessage({ type: "run", on: !document.hidden } satisfies ToWorker);
  });
}

export const cookbook = () => latest;
export const learningState = () => state;

export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export function setRunning(on: boolean, turbo = false) {
  localStorage.setItem(RUN_KEY, on ? "on" : "off");
  send({ type: "run", on, turbo });
}

/** You built (strength 1) or finished the steps of (2) one of the designs shown. */
export function teachChoice(shown: Features[], chosen: Features, id?: string, strength = 1) {
  send({ type: "choice", shown, chosen, id, strength });
}

export function importCookbook(cb: Cookbook) {
  send({ type: "import", cookbook: cb });
}

export function resetCookbook() {
  send({ type: "reset" });
}

/** Offer proposals (an LLM's reply, notes from a building booklet). */
export function teach(text: string, origin: Origin) {
  const ticket = nextTicket++;
  return new Promise<Extract<FromWorker, { type: "ingested" }>>((resolve) => {
    tickets.set(ticket, resolve);
    send({ type: "ingest", text, origin, ticket });
  });
}

/**
 * Ask a local LLM (Ollama on this machine — no internet) with the brief, and
 * teach the engine its reply. Any model works; each brings its own ideas.
 */
export async function askLocalLLM(model: string, prompt: string) {
  const res = await fetch("http://localhost:11434/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, stream: false, format: "json" }),
  });
  if (!res.ok) throw new Error(`Ollama answered ${res.status}`);
  const { response } = (await res.json()) as { response: string };
  // format:"json" may wrap the array in an object.
  const text = response.trim().startsWith("[") ? response : JSON.stringify(Object.values(JSON.parse(response)).find(Array.isArray) ?? []);
  return teach(text, "llm");
}
