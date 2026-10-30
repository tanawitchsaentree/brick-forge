import { planModel, type BuildPlan } from "../engine/plan/build";

// The assembly planner (engine/plan, docs/engine/assembly-planning.md) off the page's
// thread: a 1,000-part model takes a few seconds. Library files come from the app's
// own LDraw library; the file map says where each primitive is, so the planner's
// guesses at folders that don't hold a file are answered without a request.

export interface PlanRequest {
  id: number;
  text: string;
}
export type PlanReply = { id: number; plan: BuildPlan } | { id: number; error: string };

let primitives: Promise<Record<string, string>> | null = null;
const files = new Map<string, Promise<string | null>>();
const get = (url: string) => fetch(url).then((r) => (r.ok && !r.headers.get("content-type")?.includes("html") ? r.text() : null));

async function fetchFile(path: string): Promise<string | null> {
  primitives ??= fetch("/ldraw-filemap.json").then((r) => r.json());
  const rel = path.toLowerCase().replace(/^ldraw\//, "");
  const map = await primitives;
  let url: string | null;
  if (rel.startsWith("p/")) url = map[rel.slice(2)] === rel ? `/ldraw/${rel}` : null;
  else if (rel.startsWith("parts/lb-")) url = `/ldraw-gen/${rel}`; // parts composed by the catalog script
  else if (rel.startsWith("parts/")) url = map[rel.slice(6)] ? null : `/ldraw/${rel}`;
  else url = null;
  if (!url) return null;
  let f = files.get(url);
  if (!f) files.set(url, (f = get(url).catch(() => null)));
  return f;
}

self.onmessage = async (e: MessageEvent<PlanRequest>) => {
  const { id, text } = e.data;
  let reply: PlanReply;
  try {
    reply = { id, plan: await planModel(text, fetchFile, { ldraw: "ldraw", shadow: null }) };
  } catch (err) {
    reply = { id, error: String(err) };
  }
  (self as unknown as Worker).postMessage(reply);
};
