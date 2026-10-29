// Packs the LDraw library (public/ldraw, ~37,000 small files) into a few
// large shard files plus an index, for hosting on Cloudflare R2: Pages takes
// at most 20,000 files, and R2 serves byte ranges, so a Pages Function
// (functions/ldraw/[[path]].ts) answers /ldraw/<path> by reading the file's
// range out of its shard. The app keeps fetching /ldraw/... as before.
//
//   node scripts/pack-ldraw-shards.mjs <out-dir>

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "public/ldraw");
const OUT = process.argv[2] ?? "/tmp/ldraw-shards";
const MAX = 200 * 1024 * 1024; // per shard (wrangler uploads up to 300 MB)

fs.mkdirSync(OUT, { recursive: true });
const files = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else files.push(p);
  }
};
walk(SRC);
files.sort();
const index = {};
let shard = 0, offset = 0, fd = fs.openSync(path.join(OUT, `shard-${shard}.bin`), "w");
for (const f of files) {
  const data = fs.readFileSync(f);
  if (offset + data.length > MAX && offset > 0) {
    fs.closeSync(fd);
    shard++;
    offset = 0;
    fd = fs.openSync(path.join(OUT, `shard-${shard}.bin`), "w");
  }
  fs.writeSync(fd, data);
  // Keys as the app asks for them (case-insensitive: LDraw file names are).
  index[path.relative(SRC, f).split(path.sep).join("/").toLowerCase()] = [shard, offset, data.length];
  offset += data.length;
}
fs.closeSync(fd);
fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(index));
console.log(`${files.length} files → ${shard + 1} shards + index (${(fs.statSync(path.join(OUT, "index.json")).size / 1e6).toFixed(1)} MB) in ${OUT}`);
