// Serves the LDraw library from R2. The library is ~37,000 small files (more
// than Pages hosts), so scripts/pack-ldraw-shards.mjs packs it into a few
// shards plus an index { path: [shard, offset, length] }; each request reads
// just its file's byte range. Files never change, so they cache for a year.

interface Env {
  LDRAW: R2Bucket;
}

type Index = Record<string, [number, number, number]>;
let index: Promise<Index> | null = null;

export const onRequestGet: PagesFunction<Env> = async ({ env, params, request }) => {
  index ??= env.LDRAW.get("index.json").then(async (o) => (o ? ((await o.json()) as Index) : {}));
  const key = (Array.isArray(params.path) ? params.path.join("/") : String(params.path ?? "")).toLowerCase();
  const at = (await index)[key];
  if (!at) return new Response("Not found", { status: 404 });
  const cache = caches.default;
  const hit = await cache.match(request);
  if (hit) return hit;
  const [shard, offset, length] = at;
  const obj = await env.LDRAW.get(`shard-${shard}.bin`, { range: { offset, length } });
  if (!obj) return new Response("Not found", { status: 404 });
  const res = new Response(obj.body, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=31536000, immutable" },
  });
  await cache.put(request, res.clone());
  return res;
};
