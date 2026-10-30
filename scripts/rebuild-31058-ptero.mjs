// Reference rebuild of the Pterodactyl of LEGO 31058 "Mighty Dinosaurs" (booklet 6437440, steps 1–30),
// from the instructions read page by page (see docs/engine/dna-31058-alts.md).
// Every module is built in its own local frame, with its plug joint at the origin; the main model
// places the modules through their joints in the booklet / box-photo pose. Writes an MPD, one FILE per module.
//
//   node scripts/rebuild-31058-ptero.mjs [out.ldr]      (default data/golden/31058-ptero.ldr)
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

// SNOT orientations
const studsPZ = oriYZ(nZ, Y); //  plate studs → +Z (part −Y → +Z)
const studsNZ = oriYZ(Z, Y); //   plate studs → −Z

// =============== BODY (steps 1–12) — origin: top of the tan 2×6 belly plate (laid across, Z)
function body() {
  const m = mod("body");
  m.put("3795", "tan", 0, 0, 0, RY90, "belly plate 2x6, across");
  m.put("3660", "tan", 10, -24, 0, RYm90, "rear row, overhang back");
  // step 2: green bricks on the front row; the 2x2 overhangs one row forward
  m.put("3003", "green", -20, -24, 0).put("3004", "green", -10, -24, -40, RY90).put("3004", "green", -10, -24, 40, RY90);
  // step 3: leg holders on the rear row, beams back, red axle and ball between the beams
  for (const z of [-40, 40]) {
    m.put("85943", "dbg", 10, -24, z, RYm90, "leg holder, beams back");
    m.put("32062", "red", 40, -14, z, RYm90).put("53585", "black", 40, -14, z, oriYZ(Z, nY), "leg ball");
  }
  m.put("3020", "green", 0, -32, 0, RY90, "step 4, across"); // on 3004/3003/3660/85943
  m.put("14417", "dbg", 30, -32, 0, RYm90, "tail ball, on the 3660 overhang");
  // step 6: dark green wedge pair, a triangle pointing back
  m.put("43722", "dkgreen", 10, -40, -20, oriYZ(Y, X)).put("43723", "dkgreen", 10, -40, 20, oriYZ(Y, X));
  // step 7: tan 2x4 under the 3003 overhang, forward
  m.put("3020", "tan", -60, 0, 0, I, "neck underside");
  // step 8: wing hub (two 10.2 mm balls, across) and the tan inverted 33° front
  m.put("17114", "dbg", -60, -24, 0, RY90, "wing balls").put("3747b", "tan", -90, -24, 0, RY90, "chest, overhang forward");
  // step 9
  m.put("3010", "dkgreen", -60, -48, -10).put("3010", "dkgreen", -60, -48, 10);
  m.put("3023", "green", -110, -32, 0, RY90).put("14417", "dbg", -130, -32, 0, RY90, "neck ball, forward");
  m.put("4032a", "dkgreen", -120, -40, 0, I, "step 10");
  // step 11: dark red saddle and the curved front
  m.put("3023", "dkred", -50, -56, 0, RY90).put("3023", "dkred", -30, -56, 0, RY90);
  m.put("15068", "green", -80, -48, 0, RY90, "curved 2x2, down to the front");
  m.put("43712", "green", -40, -80, 0, RYm90, "back shell, studs at the front"); // step 12
  m.joints = { head: [-150, -28, 0], tail: [50, -28, 0], wingL: [-60, -14, 40], wingR: [-60, -14, -40], footL: [40, -14, 40], footR: [40, -14, -40] };
  return m;
}

// =============== TAIL (step 13) — origin: the socket on the tail ball; runs along +X
function tail() {
  const m = mod("tail");
  m.put("14418", "lbg", 30, -4, 0, RY180, "socket");
  m.put("3024", "green", 20, -12, 0).put("11153", "green", 50, -36, 0, RYm90, "high end at the body");
  return m;
}

// =============== FOOT (steps 14, 15 mirrored) — origin: the socket on the leg ball; claws along +X
function foot() {
  const m = mod("foot-l");
  m.put("3022", "green", 0, 0, 0).put("3023", "dkgreen", 0, -8, -10);
  const claws = (x, y, z) => {
    m.put("87747", "black", x + 4, y, z, oriYZ(nX, Y), "long claw, forward");
    m.put("53451", "black", x - 4, y, z, oriYZ(nY, nX), "short claw, back");
  };
  m.put("4081b", "black", 10, -8, 10, RY180, "claw ring"); claws(10, -6, 30);
  m.put("92013", "dkgreen", 0, -32, 0, RY180, "ankle socket");
  m.put("4081b", "black", 10, -40, 10, RY180, "claw ring"); claws(10, -38, 30);
  m.put("11477", "tan", 0, -40, 10, RYm90, "heel");
  m.joints = { ball: [-36, -22, 0] };
  return rebase(m, m.joints.ball);
}

// =============== WING ROOT (step 16, ×2) — built with X outward; origin: socket on the body's wing ball
function wingRoot() {
  const m = mod("wing-root-l");
  m.put("3021", "tan", 0, 0, 0, I, "underside 2x3");
  m.put("3023", "dkgreen", 20, -8, 0, RY90).put("14704", "lbg", 20, -16, 0, RYm90, "socket for the mid wing").put("3023", "dkgreen", 20, -24, 0, RY90);
  m.put("92013", "dkgreen", -10, -24, 0, RY180, "socket on the wing ball");
  m.put("30357", "green", -20, -32, 10, I, "rounded at the outer end").put("30357", "green", -20, -32, -10, RY90);
  m.put("2431", "tan", 0, -40, 0, RY90, "tan stripe");
  m.joints = { ball: [-46, -14, 0], mid: [40, -12, 0] };
  return rebase(m, m.joints.ball);
}

// =============== MID WING (step 17, ×2) — X outward; origin: its ball in the root's 14704
function wingMid() {
  const m = mod("wing-mid-l");
  m.put("3020", "green", 0, 0, 0);
  m.put("14417", "dbg", -30, -8, 0, RY90, "ball, inward");
  m.put("15208", "white", 0, -8, 10, RY180, "teeth under the edge").put("15208", "white", 0, -8, -10, I, "teeth");
  m.put("11476", "lbg", 30, -8, 0, RYm90, "clip for the tip");
  m.put("41769", "green", 0, -16, -20, ori(Z, Y, nX)).put("41770", "green", 0, -16, 20, ori(Z, Y, nX));
  m.joints = { ball: [-50, -4, 0], tip: [52, -6, 0] };
  return rebase(m, m.joints.ball);
}

// =============== WING TIP (steps 18, 19) — X outward; origin: the handle bar in the mid wing's clip
function wingTip(name, wedge) {
  const m = mod(name);
  m.put("60478", "dkgreen", 30, 0, 0, RY180, "handle inward");
  m.put(wedge, "green", 50, -8, -10, ori(Z, Y, nX));
  m.joints = { bar: [0, 2, 0] };
  return rebase(m, m.joints.bar);
}

// =============== HEAD (steps 20–29) — one stud wide; origin: the neck socket; beak toward −X
function head() {
  const m = mod("head");
  m.put("3710", "tan", 0, 0, 0, I, "jaw");
  m.put("3023", "dkgreen", -20, -8, 0).put("14418", "lbg", 20, -8, 0, I, "neck socket, back");
  // step 22: the skull brick with eyes and cheek slopes on its side studs
  m.put("52107", "dktan", 20, -32, 0);
  for (const s of [1, -1]) {
    m.put("6141", "torange", 10, -22, 18 * s, s > 0 ? studsPZ : studsNZ, "eye");
    m.put("54200", "green", 30, -22, 10 * s, s > 0 ? oriYZ(nZ, nX) : oriYZ(Z, nX), "cheek");
  }
  m.put("3710", "tan", -80, 0, 0, I, "beak underside").put("3023", "dkgreen", -60, -8, 0);
  m.put("3023", "green", -40, -16, 0).put("3024", "green", -10, -16, 0);
  m.put("3023", "green", -20, -24, 0);
  m.put("11153", "green", -80, -40, 0, RY90, "beak top, on the step-23 plate");
  m.put("3023", "green", 20, -40, 0, I, "on the skull brick");
  m.put("11153", "green", -20, -64, 0, RY90, "crest");
  m.put("11477", "green", 40, -40, 0, RYm90, "crest end");
  m.joints = { neck: [50, -4, 0] };
  return rebase(m, m.joints.neck);
}

// =============== assembly in the booklet's final pose
const P = {
  head: 0, tail: -12, // tail lift (negative = up)
  dihedral: -10, midSweep: 15, midDihedral: -8, tipSweep: 25, // wing angles (°)
  foot: 55, // foot hangs back-down
};
const M = {};
const place = (m, R, t) => (M[m.name] = { m, R, t });
const at = (name, j) => add(app(M[name].R, M[name].m.joints[j]), M[name].t);

const B = body(); place(B, I, [0, 0, 0]);
place(head(), Rz(P.head), at("body", "head"));
place(tail(), Rz(P.tail), at("body", "tail"));
const WR = wingRoot(), WM = wingMid();
const outL = Ry(-90), outR = Ry(90); // wing X → +Z (left) / −Z (right)
place(WR, mul(outL, Rz(P.dihedral)), at("body", "wingL"));
place(mirror(WR, "wing-root-r"), mul(outR, Rz(P.dihedral)), at("body", "wingR"));
place(WM, mul(M["wing-root-l"].R, mul(Ry(P.midSweep), Rz(P.midDihedral))), at("wing-root-l", "mid"));
place(mirror(WM, "wing-mid-r"), mul(M["wing-root-r"].R, mul(Ry(-P.midSweep), Rz(P.midDihedral))), at("wing-root-r", "mid"));
const TL = wingTip("wing-tip-l", "41769");
place(TL, mul(M["wing-mid-l"].R, Ry(P.tipSweep)), at("wing-mid-l", "tip"));
place(mirror(wingTip("wing-tip-r", "41769"), "wing-tip-r"), mul(M["wing-mid-r"].R, Ry(-P.tipSweep)), at("wing-mid-r", "tip"));
const FL = foot();
place(FL, Rz(P.foot), at("body", "footL"));
place(mirror(FL, "foot-r"), Rz(P.foot), at("body", "footR"));

// ---- write the MPD
const f = (v) => +v.toFixed(3);
const line = (c, p, R, file) => `1 ${c} ${p.map(f).join(" ")} ${R.flat().map(f).join(" ")} ${file}`;
const out = process.argv[2] ?? "data/golden/31058-ptero.ldr";
const L = ["0 FILE 31058-ptero.ldr", "0 LEGO 31058 Mighty Dinosaurs — Pterodactyl (reference rebuild, booklet 6437440)", "0 Name: 31058-ptero.ldr", "0 Author: scripts/rebuild-31058-ptero.mjs", ""];
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
