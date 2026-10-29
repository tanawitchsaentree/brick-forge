// The app's generated data (catalog, corpus, geometry pack, thumbnails, learned
// forms: about 300 MB, built from the LDraw library by `npm run setup:ldraw`)
// isn't in git. It lives in R2 as a few tarballs, and scripts/data.lock.json
// (in git) says which, so a fresh clone or the CI deploy gets exactly the data
// the code was built against.
//
//   node scripts/data-bundle.mjs push   after rebuilding data: pack, upload what changed, update the lock
//   node scripts/data-bundle.mjs pull   fetch and unpack what the lock names (skips groups already in place)
//
// Uses wrangler with CLOUDFLARE_API_TOKEN (and CLOUDFLARE_ACCOUNT_ID in CI).
// Local-only models (public/corpus/moc-*, private.json) are never packed.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const LOCK = path.join(ROOT, "scripts/data.lock.json");
const HAVE = path.join(ROOT, ".data.json"); // what this checkout has unpacked (gitignored)
const BUCKET = "brick-forge-ldraw";
const LIMIT = 300 * 2 ** 20; // wrangler's single-upload limit is 315 MB

// Paths relative to public/. A group is re-uploaded only when its files change.
const GROUPS = {
  base: ["catalog.json", "ldraw-filemap.json", "ldraw-gen", "shapes.json", "forms.json", "forms"],
  corpus: ["corpus"],
  pack: ["ldraw-pack"],
  thumbs: ["thumbs"],
};
const skip = (rel) => /^corpus\/(moc-|private\.json$)/.test(rel) || rel.startsWith("thumbs/builds/"); // local only; in git

const wrangler = (...args) => execFileSync("npx", ["wrangler", ...args], { cwd: ROOT, stdio: ["ignore", "inherit", "inherit"] });
const sha = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const readJson = (file, or) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : or);

function files(group) {
  const out = [];
  const walk = (rel) => {
    const abs = path.join(PUBLIC, rel);
    if (!fs.existsSync(abs)) return;
    if (fs.statSync(abs).isDirectory()) for (const e of fs.readdirSync(abs).sort()) walk(`${rel}/${e}`);
    else if (!skip(rel)) out.push(rel);
  };
  for (const p of GROUPS[group]) walk(p);
  return out;
}

/** A hash of the group's paths and contents (tarballs themselves differ by timestamps). */
function contentHash(list) {
  const h = crypto.createHash("sha256");
  for (const rel of list) h.update(rel).update("\0").update(fs.readFileSync(path.join(PUBLIC, rel))).update("\0");
  return h.digest("hex").slice(0, 16);
}

function push() {
  const lock = readJson(LOCK, {});
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bf-data-"));
  for (const group of Object.keys(GROUPS)) {
    const list = files(group);
    if (!list.length) throw new Error(`${group}: no files in public/ (run npm run setup:ldraw first)`);
    const hash = contentHash(list);
    if (lock[group]?.hash === hash) {
      console.log(`${group.padEnd(7)} unchanged (${list.length} files)`);
      continue;
    }
    const listFile = path.join(tmp, `${group}.txt`);
    fs.writeFileSync(listFile, list.join("\n") + "\n");
    const tar = path.join(tmp, `${group}.tar.gz`);
    execFileSync("tar", ["-czf", tar, "-C", PUBLIC, "-T", listFile]);
    const bytes = fs.statSync(tar).size;
    if (bytes > LIMIT) throw new Error(`${group}: ${(bytes / 2 ** 20).toFixed(0)} MB is over the upload limit; split the group`);
    const key = `data/${group}-${hash}.tar.gz`;
    console.log(`${group.padEnd(7)} ${list.length} files, ${(bytes / 2 ** 20).toFixed(1)} MB → ${key}`);
    wrangler("r2", "object", "put", `${BUCKET}/${key}`, "--file", tar, "--remote", "--content-type", "application/gzip");
    lock[group] = { key, hash, sha256: sha(tar), bytes, files: list.length };
    fs.writeFileSync(LOCK, JSON.stringify(lock, null, 1) + "\n"); // after each upload, so a failure keeps what's done
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  // What's in public/ now is what the lock names.
  fs.writeFileSync(HAVE, JSON.stringify(Object.fromEntries(Object.entries(lock).map(([g, e]) => [g, e.hash]))));
}

function pull() {
  const lock = readJson(LOCK, null);
  if (!lock) throw new Error("scripts/data.lock.json is missing");
  const have = readJson(HAVE, {});
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bf-data-"));
  for (const [group, e] of Object.entries(lock)) {
    if (have[group] === e.hash) {
      console.log(`${group.padEnd(7)} in place`);
      continue;
    }
    const tar = path.join(tmp, `${group}.tar.gz`);
    console.log(`${group.padEnd(7)} ${(e.bytes / 2 ** 20).toFixed(1)} MB ← ${e.key}`);
    wrangler("r2", "object", "get", `${BUCKET}/${e.key}`, "--file", tar, "--remote");
    if (sha(tar) !== e.sha256) throw new Error(`${group}: download doesn't match the lock`);
    execFileSync("tar", ["-xzf", tar, "-C", PUBLIC]);
    fs.rmSync(tar);
    have[group] = e.hash;
    fs.writeFileSync(HAVE, JSON.stringify(have));
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

const cmd = process.argv[2];
if (cmd === "push") push();
else if (cmd === "pull") pull();
else {
  console.error("usage: node scripts/data-bundle.mjs push|pull");
  process.exit(1);
}
