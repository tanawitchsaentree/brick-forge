// Analysis by synthesis for a dinosaur's head: render the rig's head
// (engine/assembly/dino.ts) from many views and with different construction
// choices and proportions, and score each render against a reference photo
// of a real LEGO head (e.g. 31058's T. rex). Higher is closer.
//
//   node scripts/dino-head-fit.mjs <reference.png> [out-dir]     (needs `npm run dev` on :5173)
//
// The score compares what is where, not exact pixels:
//   • both images are split into colour classes (skin, belly, teeth, mouth,
//     eye, dark) by nearest reference colour, the background removed (the
//     photo's by flood fill from its border, the render's by alpha);
//   • both are cropped to the object and resampled to a 128 × 128 grid;
//   • IoU is taken with a 2-cell tolerance (masks grown first), so thin
//     features like teeth count when they're roughly in the right place;
//   • score = 0.3 · IoU(silhouette) + 0.5 · mean IoU(class) over the classes
//     the photo has + 0.2 · (1 − ½ Σ|share_c − share′_c|), the last term
//     comparing how much of the object each class is (so a green blob from
//     behind can't win on silhouette alone).
// The view (azimuth, elevation, mirrored or not) is searched, since a photo's
// camera is unknown, over 3/4 views only (35°–110° off the snout): a head is
// photographed from where you see its side and face. Crop the photo to the head first.

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const ref = process.argv[2];
const out = process.argv[3] ?? "/tmp/dino-head-fit";
if (!ref) {
  console.error("usage: node scripts/dino-head-fit.mjs <reference.png> [out-dir]");
  process.exit(1);
}
fs.mkdirSync(out, { recursive: true });
const refURL = `data:image/png;base64,${fs.readFileSync(ref).toString("base64")}`;

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("page:", e.message));
await page.goto("http://localhost:5173/");
await page.waitForTimeout(3000);

const result = await page.evaluate(async (refURL) => {
  // The knobs through the same module graph the generator uses (a direct import can be a second copy after a reload).
  const A = await import("/src/engine/assembly/index.ts");
  const T = await import("/src/scene/thumbnails.ts");
  const N = 128;
  const CLASSES = {
    skin: [[88, 171, 65], [52, 140, 60], [24, 70, 50], [40, 100, 55], [120, 190, 90]],
    belly: [[228, 205, 158], [205, 180, 130], [160, 140, 100], [240, 225, 185]],
    teeth: [[246, 246, 242], [222, 222, 216], [196, 196, 192]],
    mouth: [[120, 27, 21], [88, 18, 18], [160, 45, 40]],
    eye: [[245, 140, 30], [205, 95, 15], [255, 190, 80]],
    dark: [[25, 25, 28], [85, 90, 96], [140, 142, 148]],
  };
  const names = Object.keys(CLASSES);
  const classOf = (r, g, b) => {
    let best = 0, bd = Infinity;
    names.forEach((n, k) => {
      for (const [R, G, B] of CLASSES[n]) {
        const d = (r - R) ** 2 + (g - G) ** 2 + (b - B) ** 2;
        if (d < bd) (bd = d), (best = k + 1);
      }
    });
    return best;
  };
  const load = (url) =>
    new Promise((res) => {
      const im = new Image();
      im.onload = () => res(im);
      im.src = url;
    });
  const pixels = (im) => {
    const c = document.createElement("canvas");
    c.width = im.width;
    c.height = im.height;
    const g = c.getContext("2d");
    g.drawImage(im, 0, 0);
    return g.getImageData(0, 0, im.width, im.height);
  };
  /** Class per pixel (0 = background), cropped to the object, on an N × N grid (majority vote). */
  const classify = (img, photo) => {
    const { width: w, height: h, data } = img;
    const cls = new Uint8Array(w * h);
    const bg = new Uint8Array(w * h);
    if (photo) {
      // Background: near-white pixels connected to the border.
      const white = (i) => Math.min(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) > 236;
      const q = [];
      for (let x = 0; x < w; x++) q.push(x, (h - 1) * w + x);
      for (let y = 0; y < h; y++) q.push(y * w, y * w + w - 1);
      while (q.length) {
        const i = q.pop();
        if (bg[i] || !white(i)) continue;
        bg[i] = 1;
        const x = i % w, y = (i / w) | 0;
        if (x > 0) q.push(i - 1);
        if (x < w - 1) q.push(i + 1);
        if (y > 0) q.push(i - w);
        if (y < h - 1) q.push(i + w);
      }
    } else for (let i = 0; i < w * h; i++) bg[i] = data[i * 4 + 3] < 128 ? 1 : 0;
    let x0 = w, x1 = 0, y0 = h, y1 = 0;
    for (let i = 0; i < w * h; i++) {
      if (bg[i]) continue;
      cls[i] = classOf(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
      const x = i % w, y = (i / w) | 0;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    const side = Math.max(x1 - x0, y1 - y0) + 1;
    const ox = x0 - (side - (x1 - x0 + 1)) / 2, oy = y0 - (side - (y1 - y0 + 1)) / 2;
    const grid = new Uint8Array(N * N);
    for (let gy = 0; gy < N; gy++)
      for (let gx = 0; gx < N; gx++) {
        const votes = new Array(names.length + 1).fill(0);
        for (let sy = 0; sy < 3; sy++)
          for (let sx = 0; sx < 3; sx++) {
            const x = Math.floor(ox + ((gx + (sx + 0.5) / 3) * side) / N), y = Math.floor(oy + ((gy + (sy + 0.5) / 3) * side) / N);
            votes[x >= 0 && y >= 0 && x < w && y < h ? cls[y * w + x] : 0]++;
          }
        grid[gy * N + gx] = votes.indexOf(Math.max(...votes));
      }
    return grid;
  };
  const mirror = (g) => {
    const m = new Uint8Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) m[y * N + x] = g[y * N + (N - 1 - x)];
    return m;
  };
  const refGrid = classify(pixels(await load(refURL)), true);
  const present = names.map((_, k) => k + 1).filter((k) => refGrid.filter((v) => v === k).length > N * N * 0.01 && names[k - 1] !== "dark");
  // IoU with a tolerance: both masks grown by R cells first, so a row of teeth a
  // pixel off still counts (at this size teeth are 1–3 cells thick, and an exact
  // IoU of thin features is noise).
  const R = 2;
  const grow = (g, f) => {
    const m = new Uint8Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (!f(g[y * N + x])) continue;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const X = x + dx, Y = y + dy;
        if (X >= 0 && Y >= 0 && X < N && Y < N) m[Y * N + X] = 1;
      }
    }
    return m;
  };
  const iou = (a, b, f) => {
    const A = grow(a, f), B = grow(b, f);
    let i = 0, u = 0;
    for (let p = 0; p < N * N; p++) {
      if (A[p] && B[p]) i++;
      if (A[p] || B[p]) u++;
    }
    return u ? i / u : 1;
  };
  const shares = (g) => {
    const n = g.filter((v) => v > 0).length || 1;
    return present.map((k) => g.filter((v) => v === k).length / n);
  };
  const refShares = shares(refGrid);
  const score = (g) => {
    const comp = 1 - 0.5 * shares(g).reduce((a, v, i) => a + Math.abs(v - refShares[i]), 0);
    const s = (h) => 0.3 * iou(refGrid, h, (v) => v > 0) + 0.5 * (present.reduce((a, k) => a + iou(refGrid, h, (v) => v === k), 0) / present.length) + 0.2 * comp;
    return Math.max(s(g), s(mirror(g)));
  };

  // The candidate: a T. rex in the reference's colours, head and jaw only.
  const headOf = (head, tuning) => {
    Object.assign(A.DINO_TUNING, tuning);
    const plan = { ...A.PLANS.rex, head: { ...A.PLANS.rex.head, ...head }, colors: { main: [2], belly: [19], accent: [288] } };
    const bd = A.generateBuild("dino", { size: 2, level: 2, seed: 4, mode: "any", inv: {}, species: "rex", plan });
    return bd.bricks.filter((b) => /head|jaw/i.test(b.group ?? ""));
  };
  const render = async (bricks, az, el) => {
    const url = await T.renderModelImageLDraw(bricks, 256, { azimuth: az, elevation: el });
    return { url, grid: classify(pixels(await load(url)), false) };
  };
  // Best view of a head: a coarse sweep, then a finer one around the best.
  const bestView = async (bricks, around) => {
    let best = { s: -1, az: 0, el: 0, url: "" };
    const tryView = async (az, el) => {
      const r = await render(bricks, az, el);
      const s = score(r.grid);
      if (s > best.s) best = { s, az, el, url: r.url };
    };
    if (!around) {
      // The head faces +x. A photo of a head shows its side and face (a 3/4 view):
      // azimuth 35°…110° either side (the mirror covers the other), so the search
      // can't settle on a head-on or from-below view where any two heads look alike.
      for (let a = 35; a <= 110; a += 7.5) for (const el of [-0.15, 0.05, 0.25, 0.45]) await tryView((a * Math.PI) / 180, el);
    } else best = { ...around, s: -1 };
    const c = { ...best };
    for (const da of [-0.13, -0.065, 0, 0.065, 0.13]) for (const de of [-0.12, 0, 0.12]) await tryView(c.az + da, c.el + de);
    return best;
  };

  const runs = [];
  const baseHead = A.PLANS.rex.head;
  // "Before": the rig as it was (every technique since off, the old head proportions).
  const OLD = { teeth: "single", coverTiles: false, eye: "printed", nostrils: false, brow: false, profile: "step", belly: "flat", claws: "plate", ends: "square", cheeks: false };
  const NEW = { teeth: "rail", coverTiles: true, eye: "snot", nostrils: true, brow: true, profile: "slope", belly: "inverted", claws: "curved", ends: "cheese", cheeks: true };
  const base = await bestView(headOf({ L: 7, hw: 2, H: 6, snout: 3, bend: -18, jawOpen: 28 }, OLD));
  runs.push({ name: "before: the old rig", ...base });
  const view = { az: base.az, el: base.el };
  const variants = [
    { name: "now: all 31058 techniques", tuning: NEW },
    { name: "now, without cover tiles", tuning: { ...NEW, coverTiles: false } },
    { name: "now, printed eye", tuning: { ...NEW, eye: "printed" } },
    { name: "now, square ends", tuning: { ...NEW, ends: "square" } },
  ];
  // Proportions: head length, height, snout, jaw opening.
  for (const L of [7, 8]) for (const H of [8, 9]) for (const hw of [2, 3]) for (const jawOpen of [30, 40])
    variants.push({ name: `now L${L} H${H} hw${hw} jaw${jawOpen}°`, tuning: NEW, head: { L, H, hw, jawOpen } });
  for (const v of variants) {
    const r = await bestView(headOf(v.head ?? {}, v.tuning), view);
    runs.push({ name: v.name, ...r, head: { ...baseHead, ...(v.head ?? {}) } });
  }
  Object.assign(A.DINO_TUNING, NEW);
  return { present: present.map((k) => names[k - 1]), runs: runs.map(({ name, s, az, el, url, head }) => ({ name, s, az, el, url, head })) };
}, refURL);

result.runs.sort((a, b) => b.s - a.s);
console.log(`classes in the photo: ${result.present.join(", ")}`);
for (const r of result.runs.slice(0, 12)) console.log(`${r.s.toFixed(3)}  ${r.name}  (view ${Math.round((r.az * 180) / Math.PI)}°, ${Math.round((r.el * 180) / Math.PI)}°)`);
const before = result.runs.find((r) => r.name.startsWith("before"));
console.log(`before: ${before.s.toFixed(3)} (rank ${result.runs.indexOf(before) + 1} of ${result.runs.length})`);
const save = (r, f) => fs.writeFileSync(path.join(out, f), Buffer.from(r.url.split(",")[1], "base64"));
save(result.runs[0], "best.webp");
save(before, "before.webp");
fs.writeFileSync(path.join(out, "runs.json"), JSON.stringify(result.runs.map(({ url, ...r }) => r), null, 1));
await browser.close();
