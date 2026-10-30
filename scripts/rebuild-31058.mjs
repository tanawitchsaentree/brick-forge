// Reference rebuild of the T-rex of LEGO 31058 "Mighty Dinosaurs" (booklet 6437442, steps 1–52),
// from the instructions read page by page (see docs/engine/dna-31058.md).
// Every module is built in its own local frame, with its plug joint at the origin; the main model
// places the modules through their joints in the box-photo pose. Writes an MPD, one FILE per module.
//
//   node scripts/rebuild-31058.mjs [out.ldr]      (default data/golden/31058-rex.ldr)
//
// Frame: LDU, −Y up, head toward −X, the model's left side toward +Z.
import fs from "node:fs";

const C = { green: 2, dkgreen: 288, tan: 19, dktan: 28, dbg: 72, lbg: 71, black: 0, white: 15, dkred: 320, torange: 57, red: 4 };

// ---- 3×3 matrices (rows); ori(px, py, pz) = where the part's +X, +Y, +Z axes go in the parent frame
const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1], nX = [-1, 0, 0], nY = [0, -1, 0], nZ = [0, 0, -1];
const ori = (px, py, pz) => [0, 1, 2].map((r) => [px[r], py[r], pz[r]]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const oriYZ = (py, pz) => ori(cross(py, pz), py, pz);
const mul = (A, B) => A.map((r) => [0, 1, 2].map((c) => r[0] * B[0][c] + r[1] * B[1][c] + r[2] * B[2][c]));
const app = (A, v) => A.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const add = (a, b) => a.map((x, i) => x + b[i]);
const I = ori(X, Y, Z);
const RY90 = ori(nZ, Y, X); //   part +Z → +X (a part's −Z feature points to −X, the front)
const RYm90 = ori(Z, Y, nX); //  part −Z → +X (points back)
const RY180 = ori(nX, Y, nZ);
const rad = (d) => (d * Math.PI) / 180;
const Rz = (d) => { const c = Math.cos(rad(d)), s = Math.sin(rad(d)); return [[c, -s, 0], [s, c, 0], [0, 0, 1]]; };
const Rx = (d) => { const c = Math.cos(rad(d)), s = Math.sin(rad(d)); return [[1, 0, 0], [0, c, -s], [0, s, c]]; };
const Ry = (d) => { const c = Math.cos(rad(d)), s = Math.sin(rad(d)); return [[c, 0, s], [0, 1, 0], [-s, 0, c]]; };

// ---- modules
function mod(name) {
  const m = { name, parts: [], joints: {} };
  m.put = (id, c, x, y, z, R = I, note) => (m.parts.push({ id, c: C[c] ?? c, p: [x, y, z], R, note }), m);
  return m;
}
// move a module so that point o becomes its origin
function rebase(m, o) {
  for (const q of m.parts) q.p = q.p.map((v, i) => v - o[i]);
  for (const k in m.joints) m.joints[k] = m.joints[k].map((v, i) => v - o[i]);
  return m;
}
// rotate a whole module about its origin
function turn(m, R) {
  for (const q of m.parts) { q.p = app(R, q.p); q.R = mul(R, q.R); }
  for (const k in m.joints) m.joints[k] = app(R, m.joints[k]);
  return m;
}
// the other-hand copy (Z mirrored). Each part is re-placed as a proper rotation: S·R·F, where F is a
// reflection the part is symmetric under (default: its own X); handed pairs swap ids.
const SWAP = { 41769: "41770", 41770: "41769", 43722: "43723", 43723: "43722" };
const SYM = { 14418: "z", 60478: "z", 63868: "z", 92013: "z", 17114: "z", "44302a": "z", 11458: "z", 3010: "z", 30357: "d", 26604: "a" };
const F = { x: ori(nX, Y, Z), z: ori(X, Y, nZ), d: ori(Z, Y, X), a: ori(nZ, Y, nX) };
const S = ori(X, Y, nZ);
function mirror(m, name) {
  const n = mod(name);
  for (const q of m.parts) n.parts.push({ ...q, id: SWAP[q.id] ?? q.id, p: [q.p[0], q.p[1], -q.p[2]], R: mul(mul(S, q.R), F[SYM[q.id] ?? "x"]) });
  for (const k in m.joints) n.joints[k] = [m.joints[k][0], m.joints[k][1], -m.joints[k][2]];
  return n;
}

// Orientations used for SNOT pieces (studs pointing sideways):
const studsPZ = ori(X, nZ, Y); //          plate studs → +Z, length along X, part +Z → +Y
const studsPZ_tDown = oriYZ(nZ, nY); //    studs → +Z, part −Z feature (teeth, clip) → down
const studsPZ_tUp = oriYZ(nZ, Y); //       studs → +Z, part −Z feature → up
const wedgePZ = oriYZ(nZ, X); //           studs → +Z, plate length (part Z) along X

// =============== TORSO (steps 1–10) — origin: top of the tan 2×6 belly plate
function torso() {
  const m = mod("torso");
  m.put("3795", "tan", 0, 0, 0, I, "belly plate 2x6");
  m.put("3660", "tan", -50, -24, 0, RY90).put("3001", "tan", 0, -24, 0).put("3660", "tan", 50, -24, 0, RYm90);
  // level 2: arm balls at the front sides, green plates
  m.put("14417", "dbg", -60, -32, -10, I, "arm ball").put("14417", "dbg", -60, -32, 10, RY180, "arm ball");
  m.put("3020", "green", 0, -32, 0).put("3023", "green", 50, -32, 0, RY90);
  // level 3: green inverted slopes widen the front to 4, 2x2, 1x2s, the hip brick with its two 10.2 mm balls
  m.put("3660", "green", -60, -56, -10, I).put("3660", "green", -60, -56, 10, RY180);
  m.put("3003", "green", -20, -56, 0).put("3004", "green", 10, -56, 0, RY90);
  m.put("17114", "dbg", 40, -56, 0, RY90, "hip balls").put("3004", "green", 70, -56, 0, RY90);
  // level 4: neck hinges at the front, dark green stripes, green 2x4, the tail ball pointing back
  m.put("30383", "dbg", -60, -64, -10, RY180, "neck hinge").put("30383", "dbg", -60, -64, 10, RY180, "neck hinge");
  m.put("3023", "dkgreen", -60, -64, -30).put("3023", "dkgreen", -60, -64, 30);
  m.put("3020", "green", 20, -64, 0).put("14417", "dbg", 70, -64, 0, RYm90, "tail ball");
  // level 5: the back — 2x2 and 45° slopes in front, curved 6x4 wedge behind
  m.put("3003", "green", -40, -88, 0).put("3040b", "green", -30, -88, -30, RY90).put("3040b", "green", -30, -88, 30, RY90);
  m.put("43712", "green", 0, -88, 0, RYm90, "back shell");
  m.joints = { armL: [-60, -28, 30], armR: [-60, -28, -30], neck: [-70, -68, 0], hipL: [40, -46, 40], hipR: [40, -46, -40], tail: [90, -60, 0] };
  return m;
}

// =============== ARM (step 11) — origin: the socket on the shoulder ball; the arm runs along −X
function arm() {
  const m = mod("arm-l");
  m.put("14418", "lbg", -30, -4, 0, I, "shoulder socket");
  m.put("60478", "dkgreen", -30, -12, 0, RY180, "upper arm, handle forward");
  const hand = ori(Z, Y, nX); // clip on the handle, plate across
  m.put("11476", "lbg", -80, -10, 0, hand, "hand");
  for (const z of [-10, 10]) {
    m.put("15712", "dbg", -80, -18, z);
    m.put("53451", "black", -82, -26, z, oriYZ(X, Y), "claw");
  }
  return m;
}

// =============== TAIL 1 (steps 12–17) — origin: socket on the torso's tail ball; runs along +X
function tail1() {
  const m = mod("tail-1");
  m.put("3020", "tan", 70, 20, 10, I, "underside");
  m.put("4032a", "dkgreen", 30, 12, 10).put("3022", "green", 70, 12, 10).put("14417", "dbg", 100, 12, 10, RYm90, "ball for tail 2");
  m.put("3020", "green", 50, 4, 10);
  m.put("14418", "lbg", 30, -4, 0, RY180, "socket").put("3023", "dkgreen", 30, -4, 20).put("3023", "dkgreen", 70, -4, 10, RY90);
  m.put("11153", "green", 50, -28, 0, RY90).put("11153", "green", 50, -28, 20, RY90);
  m.joints = { next: [120, 16, 10] };
  return m;
}
// =============== TAIL 2 (step 18)
function tail2() {
  const m = mod("tail-2");
  m.put("14704", "lbg", 20, -4, 0, RY90, "socket").put("3710", "tan", 50, 4, 0, I, "underside");
  m.put("60478", "dkgreen", 70, -4, 0, I, "handle for the tip");
  m.put("3023", "dkgreen", 30, -12, 0).put("3024", "green", 60, -12, 0);
  m.put("11153", "green", 50, -36, 0, RY90);
  m.joints = { next: [100, -2, 0] };
  return m;
}
// =============== TAIL 3 / tip (step 19)
function tail3() {
  const m = mod("tail-3");
  m.put("63868", "black", 30, 0, 0, RY180, "clip on the handle").put("3710", "tan", 50, 8, 0);
  m.put("3024", "green", 60, 0, 0).put("11153", "green", 50, -24, 0, RY90);
  return m;
}

// =============== THIGH (steps 21–22): a slab built flat, then stood up with its studs facing out (+Z)
function thigh() {
  const m = mod("thigh-l");
  // flat: x' back, z' down, studs up (−y')
  m.put("30357", "green", 20, 0, 20, RY180, "hip 3x3").put("41769", "green", 70, 0, 10, RY90);
  m.put("92013", "dkgreen", -10, -24, -10, RY90, "hip socket").put("3062b", "black", 20, -24, -20);
  m.put("3010", "dkgreen", 40, -24, 20).put("92013", "dkgreen", 100, -24, 10, RYm90, "ankle socket");
  m.put("30357", "green", 20, -32, 20, RY180).put("41770", "green", 70, -32, 10, RY90);
  m.joints = { hip: [-10, -14, -46], ankle: [100, -14, 46] };
  turn(m, Rx(-90)); // (x', y', z') → (x', z', −y'): z' down, studs → +Z
  return rebase(m, m.joints.hip);
}

// =============== FOOT (steps 23–30) — origin: the ankle ball; toes toward −X
function foot() {
  const m = mod("foot-l");
  m.put("3021", "tan", 0, 0, 0, I, "sole");
  m.put("60470b", "black", -20, -8, 0, RY90, "toe clips");
  m.put("4081b", "black", 0, -8, 10, RY180).put("4081b", "black", 0, -8, -10, I);
  // heel: technic brick whose two beams rise up-back and hold the ankle ball on a red axle
  const heel = mod("h");
  heel.put("85943", "dbg", 0, -12, 0, RYm90, "heel, beams up-back").put("32062", "red", 30, -2, 0, RYm90).put("53585", "black", 30, -2, 0, oriYZ(Z, nY), "ankle ball");
  heel.joints.ball = [30, -2, 0];
  turn(heel, Rz(-P.heel));
  for (const q of heel.parts) m.put(q.id, q.c, ...add(q.p, [20, -12, 0]), q.R, q.note);
  m.put("11477", "green", -10, -8, 0, I).put("54200", "green", -30, -8, -10, RY90).put("54200", "green", -30, -8, 10, RY90);
  m.put("99021", "dbg", -36, -2, 0, I);
  const claw = ori(Z, X, Y); // grows forward, curls down
  m.put("87747", "black", -44, -8, -10, claw, "claw").put("87747", "black", -44, -8, 10, claw, "claw").put("87747", "black", -42, -22, 0, claw, "claw");
  m.joints = { ball: add(heel.joints.ball, [20, -12, 0]) };
  return rebase(m, m.joints.ball);
}

// =============== HEAD (steps 31–49)
function head() {
  const m = mod("head");
  // the core: a stack of 15 plates' height built upright (S frame), then laid on its side: S up → −X (forward),
  // S −Z (the 22885's four studs) → up, S X → Z.
  const MS = [[0, 1, 0], [0, 0, 1], [1, 0, 0]];
  const s = (id, c, x, y, z, R = I, note) => m.put(id, c, ...app(MS, [x, y, z]), mul(MS, R), note);
  s("3023", "green", 0, 0, 0);
  s("26604", "tan", 10, -24, 0, I); s("26604", "tan", -10, -24, 0, RY90);
  s("22885", "lbg", 0, -64, 0);
  s("6141", "torange", -10, -72, 0); s("6141", "torange", 10, -72, 0);
  s("3023", "dkred", 0, -80, 0, I, "mouth roof");
  s("26604", "tan", 10, -104, 0, I); s("26604", "tan", -10, -104, 0, RY90);
  s("3023", "dkred", 0, -112, 0, I, "mouth roof");
  // core now spans x −112..8, y −10..10 (top at −10), z ±20; side studs at x −92 and −12
  // top: 2x2 on the 4 studs, the eye plates behind, the neck socket, brow wedges, the wheel-arch brow, curved tops
  m.put("3003", "green", -44, -34, 0);
  m.put("11458", "dbg", -2, -18, 10).put("11458", "dbg", -2, -18, -10);
  for (const z of [1, -1]) {
    m.put("4274", "lbg", 8, -24, 14 * z, z > 0 ? RY90 : ori(Z, Y, nX));
    m.put("58176", "torange", 8, -24, 18 * z, z > 0 ? oriYZ(nZ, Y) : oriYZ(Z, Y), "eye");
  }
  m.put("14704", "lbg", -12, -26, 0, RYm90, "neck socket").put("3023", "green", -12, -34, 0, RY90);
  m.put("15068", "green", -24, -34, 0, I);
  m.put("43722", "dkgreen", -94, -18, 20, RY90).put("43723", "dkgreen", -94, -18, -20, RY90);
  m.put("47755", "dkgreen", -44, -42, 0, RY90, "brow ridge");
  m.put("11153", "green", -84, -50, 10, RY90).put("11153", "green", -84, -50, -10, RY90);
  // snout front: tri-tooth plate on the front studs, green 1x2 over it
  const front = oriYZ(X, nY); // studs → −X, teeth (part −Z) → down
  m.put("15208", "white", -120, 0, 0, front, "front teeth").put("3023", "green", -128, 0, 0, front);
  // side wall (left), SNOT on the 26604 side studs; mirrored below for the right
  const wall = mod("w");
  wall.put("15208", "white", -92, 0, 28, studsPZ_tDown, "upper teeth").put("3023", "dkgreen", -52, 0, 28, studsPZ);
  wall.put("60897", "tan", -12, 0, 28, studsPZ_tDown, "jaw hinge clip");
  wall.put("15068", "green", -92, -10, 28, oriYZ(nZ, X)).put("41769", "green", -32, -10, 36, wedgePZ, "cheek");
  for (const q of [...wall.parts, ...mirror(wall, "w2").parts]) m.parts.push(q);
  m.put("87994", "black", -12, 20, -30, ori(X, Z, nY), "jaw hinge bar");
  m.joints = { neck: [8, -22, 0], jaw: [-12, 20, 0] };
  return rebase(m, m.joints.neck);
}

// =============== JAW (step 50) — origin: the hinge bar; runs along −X
function jaw() {
  const m = mod("jaw");
  for (const x of [-20, -60, -100]) m.put("52107", "dktan", x, 0, 0);
  m.put("2431", "dkred", -60, -8, 0, I, "tongue");
  const side = mod("s");
  side.put("15208", "white", -80, 12, 18, studsPZ_tUp, "lower teeth").put("15208", "white", -40, 12, 18, studsPZ_tUp, "lower teeth");
  side.put("2431", "tan", -60, 12, 26, studsPZ).put("60897", "tan", -10, 12, 18, studsPZ_tUp, "hinge clip");
  side.put("11477", "tan", -110, 12, 10, oriYZ(nZ, X), "chin");
  for (const q of [...side.parts, ...mirror(side, "s2").parts]) m.parts.push(q);
  m.joints = { hinge: [-10, -8, 0] };
  return rebase(m, m.joints.hinge);
}

// =============== NECK (step 51) — origin: the click-hinge axis at the torso; runs along −X
function neck() {
  const m = mod("neck");
  m.put("44302a", "dbg", -30, -4, -10).put("44302a", "dbg", -30, -4, 10);
  m.put("3747b", "tan", -20, 4, 0, RY90, "throat");
  m.put("14417", "dbg", -60, -4, 0, RY90, "head ball");
  m.put("3022", "green", -30, -12, 0).put("3023", "dkgreen", -60, -12, 0, RY90).put("15068", "green", -30, -12, 0);
  m.joints = { head: [-80, 0, 0] };
  return m;
}

// =============== assembly in the photo's pose
const P = {
  neckUp: 38, headTilt: -24, jawOpen: 35, // head about level: −(neck up) + a little nose-up
  tail: [-12, -18, -24], // each segment's extra lift (negative = up for +X parts)
  armDown: -28, thighL: 80, thighR: 30, footL: 14, heel: 60, // L = left (+Z, the far side in the photo: the front leg)
};
const M = {};
const place = (m, R, t) => (M[m.name] = { m, R, t });
const at = (name, j) => add(app(M[name].R, M[name].m.joints[j]), M[name].t);

const T = torso(); place(T, I, [0, 0, 0]);
const A = arm(); place(A, mul(Ry(-20), Rz(P.armDown)), at("torso", "armL"));
place(mirror(A, "arm-r"), mul(Ry(20), Rz(P.armDown)), at("torso", "armR"));
const N = neck(); place(N, Rz(P.neckUp), at("torso", "neck"));
const H = head(); place(H, mul(M.neck.R, Rz(P.headTilt)), at("neck", "head"));
const J = jaw(); place(J, mul(M.head.R, Rz(-P.jawOpen)), at("head", "jaw"));
const T1 = tail1(); place(T1, Rz(P.tail[0]), at("torso", "tail"));
const T2 = tail2(); place(T2, mul(M["tail-1"].R, Rz(P.tail[1])), at("tail-1", "next"));
const T3 = tail3(); place(T3, mul(M["tail-2"].R, Rz(P.tail[2])), at("tail-2", "next"));
const TL = thigh(); place(TL, Rz(P.thighL), at("torso", "hipL"));
place(mirror(TL, "thigh-r"), Rz(P.thighR), at("torso", "hipR"));
const FL = foot(); place(FL, Rz(P.footL), at("thigh-l", "ankle"));
place(mirror(FL, "foot-r"), I, at("thigh-r", "ankle"));

// ---- write the MPD
const f = (v) => +v.toFixed(3);
const line = (c, p, R, file) => `1 ${c} ${p.map(f).join(" ")} ${R.flat().map(f).join(" ")} ${file}`;
const out = process.argv[2] ?? "data/golden/31058-rex.ldr";
const L = ["0 FILE 31058-rex.ldr", "0 LEGO 31058 Mighty Dinosaurs — T. rex (reference rebuild)", "0 Name: 31058-rex.ldr", "0 Author: scripts/rebuild-31058.mjs", ""];
for (const k in M) L.push(line(16, M[k].t, M[k].R, `${k}.ldr`));
let total = 0;
const counts = {};
for (const k in M) {
  const m = M[k].m;
  L.push("", "0 NOFILE", `0 FILE ${k}.ldr`, `0 ${k}`, `0 Name: ${k}.ldr`);
  for (const q of m.parts) { if (q.note) L.push(`0 // ${q.note}`); L.push(line(q.c, q.p, q.R, `${q.id}.dat`)); }
  counts[k] = m.parts.length; total += m.parts.length;
}
L.push("0 NOFILE");
fs.writeFileSync(out, L.join("\n") + "\n");
console.log(Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(", "), "| total", total, "→", out);
