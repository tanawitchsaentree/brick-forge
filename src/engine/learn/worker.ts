// The learning loop, off the main thread: loads the catalog and the saved
// cookbook, then improves it for as long as the page is open — in short
// bursts (so the machine stays cool), saving every few seconds. No network:
// everything it learns from is the engine's own measurements and your choices.
import { loadCatalog } from "../catalog";
import { rng } from "../generate/math";
import {
  COOKBOOK_VERSION,
  ingest,
  learnChoice,
  like,
  merge,
  seedCookbook,
  step,
  type Cookbook,
  type Features,
  type Origin,
} from "./cookbook";

export type ToWorker =
  | { type: "run"; on: boolean; turbo?: boolean }
  | { type: "choice"; shown: Features[]; chosen: Features; id?: string; strength: number }
  | { type: "like"; id: string }
  | { type: "import"; cookbook: Cookbook }
  | { type: "ingest"; text: string; origin: Origin; ticket: number }
  | { type: "reset" };

export type FromWorker =
  | { type: "cookbook"; cookbook: Cookbook; running: boolean; rate: number }
  | { type: "ingested"; ticket: number; results?: ReturnType<typeof ingest>; error?: string }
  | { type: "imported"; added: number };

const DB = "lego-builder-learn", STORE = "cookbook", KEY = "main";

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function load(): Promise<Cookbook | null> {
  const d = await db();
  return new Promise((resolve) => {
    const r = d.transaction(STORE).objectStore(STORE).get(KEY);
    r.onsuccess = () => resolve((r.result as Cookbook) ?? null);
    r.onerror = () => resolve(null);
  });
}
async function save(cb: Cookbook) {
  const d = await db();
  d.transaction(STORE, "readwrite").objectStore(STORE).put(cb, KEY);
}

let cb: Cookbook | null = null;
let running = true, turbo = false;
let r = rng(Date.now() % 2147483647);
const post = (m: FromWorker) => self.postMessage(m);
let rate = 0; // evaluations per minute

const ready = (async () => {
  await loadCatalog();
  const saved = await load().catch(() => null);
  cb = saved && saved.version === COOKBOOK_VERSION ? saved : seedCookbook();
  await save(cb);
  post({ type: "cookbook", cookbook: cb, running, rate });
})();

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  await ready;
  const m = e.data;
  if (!cb) return;
  if (m.type === "run") {
    running = m.on;
    turbo = !!m.turbo;
  } else if (m.type === "choice") {
    learnChoice(cb, m.shown, m.chosen, m.strength);
    if (m.id) like(cb, m.id, m.strength);
  } else if (m.type === "like") like(cb, m.id);
  else if (m.type === "import") post({ type: "imported", added: merge(cb, m.cookbook) });
  else if (m.type === "ingest") {
    try {
      post({ type: "ingested", ticket: m.ticket, results: ingest(cb, m.text, m.origin) });
    } catch (err) {
      post({ type: "ingested", ticket: m.ticket, error: (err as Error).message });
    }
  } else if (m.type === "reset") {
    cb = seedCookbook();
    r = rng(Date.now() % 2147483647);
  }
  await save(cb);
  post({ type: "cookbook", cookbook: cb, running, rate });
};

// The loop: work a slice, rest a slice (more work, less rest in turbo).
(async () => {
  await ready;
  let lastPost = performance.now(), count = 0, since = performance.now();
  for (;;) {
    if (running && cb) {
      const until = performance.now() + (turbo ? 400 : 120);
      while (performance.now() < until) {
        step(cb, r);
        count++;
      }
    }
    const now = performance.now();
    if (now - lastPost > 3000 && cb) {
      rate = Math.round((count / (now - since)) * 60000);
      count = 0;
      since = now;
      lastPost = now;
      await save(cb);
      post({ type: "cookbook", cookbook: cb, running, rate });
    }
    await new Promise((res) => setTimeout(res, running ? (turbo ? 30 : 240) : 500));
  }
})();
