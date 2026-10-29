// Builds and deploys to Cloudflare Pages (project "brick-forge", wrangler.toml).
//
//   node scripts/deploy-pages.mjs [--dry]
//
// The LDraw library isn't uploaded with the site: it's served from R2 by
// functions/ldraw (pack it once with scripts/pack-ldraw-shards.mjs and upload
// the shards). Models that aren't ours to publish (a MOC someone sold or gave
// us for study) stay out of the public build.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIST = path.join(ROOT, "dist");
const run = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, stdio: "inherit" });

run("npm", ["run", "build"]);
fs.rmSync(path.join(DIST, "ldraw"), { recursive: true, force: true });
// Local-only models (booklets/local-models.json): their index and files.
const corpus = path.join(DIST, "corpus");
fs.rmSync(path.join(corpus, "private.json"), { force: true });
for (const f of fs.readdirSync(corpus)) if (f.startsWith("moc-")) fs.rmSync(path.join(corpus, f));
if (JSON.parse(fs.readFileSync(path.join(corpus, "index.json"), "utf8")).models.some((m) => m.id.startsWith("moc-"))) throw new Error("a local-only model is in corpus/index.json");

let files = 0;
const count = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) e.isDirectory() ? count(path.join(d, e.name)) : files++;
};
count(DIST);
console.log(`dist: ${files} files (Pages takes up to 20,000)`);
if (process.argv.includes("--dry")) process.exit(0);
run("npx", ["wrangler", "pages", "deploy", "dist", "--project-name", "brick-forge", "--branch", "main", "--commit-dirty=true"]);
