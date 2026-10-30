// Reference rebuild of the T-rex of LEGO 31151 "T. rex" (Creator 3-in-1, 2024; booklet 6520924,
// steps 1–236; the nest accessory 237–243 is left out), from the instructions read page by page
// (see docs/engine/dna-31151.md). Same method as scripts/rebuild-31058.mjs: every module is built in
// its own local frame with its plug joint at the origin; the main model places the modules through
// their joints in the box-photo pose (P). Writes an MPD, one FILE per module.
//
//   node scripts/rebuild-31151.mjs [out.ldr]      (default data/golden/31151-rex.ldr)
//   POSE='{"body":0,...}'                          (override the pose; all zeros = the booklet's lying build)
//
// Frame: LDU, −Y up, head toward −X, the model's left side toward +Z. Stud 20, plate 8, brick 24.

import fs from "node:fs";

// ======================================== shared helpers
// Shared helpers for the 31151 T-rex rebuild (copied from scripts/rebuild-31058.mjs).
// Frame: LDU, −Y up, head toward −X, the model's left side toward +Z. Stud 20 LDU, plate 8, brick 24.
const C = { dkgreen: 288, olive: 330, tan: 19, dktan: 28, dbg: 72, lbg: 71, black: 0, white: 15, dkred: 320, red: 4, blue: 1, tgreen: 35, orange: 25, yellow: 14, rbrown: 70, sandgreen: 378 };
const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1], nX = [-1, 0, 0], nY = [0, -1, 0], nZ = [0, 0, -1];
// ori(px, py, pz) = where the part's +X, +Y, +Z axes go in the parent frame
const ori = (px, py, pz) => [0, 1, 2].map((r) => [px[r], py[r], pz[r]]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const oriYZ = (py, pz) => ori(cross(py, pz), py, pz);
const mul = (A, B) => A.map((r) => [0, 1, 2].map((c) => r[0] * B[0][c] + r[1] * B[1][c] + r[2] * B[2][c]));
const app = (A, v) => A.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const add = (a, b) => a.map((x, i) => x + b[i]);
const sub = (a, b) => a.map((x, i) => x - b[i]);
const I = ori(X, Y, Z);
const RY90 = ori(nZ, Y, X); //  part +Z → +X
const RYm90 = ori(Z, Y, nX); // part −Z → +X
const RY180 = ori(nX, Y, nZ);
const rad = (d) => (d * Math.PI) / 180;
const Rz = (d) => { const c = Math.cos(rad(d)), s = Math.sin(rad(d)); return [[c, -s, 0], [s, c, 0], [0, 0, 1]]; };
const Rx = (d) => { const c = Math.cos(rad(d)), s = Math.sin(rad(d)); return [[1, 0, 0], [0, c, -s], [0, s, c]]; };
const Ry = (d) => { const c = Math.cos(rad(d)), s = Math.sin(rad(d)); return [[c, 0, s], [0, 1, 0], [-s, 0, c]]; };
function mod(name) {
  const m = { name, parts: [], joints: {} };
  m.put = (id, c, x, y, z, R = I, note) => (m.parts.push({ id, c: C[c] ?? c, p: [x, y, z], R, note }), m);
  return m;
}
// copy all parts of sub-module s into m, transformed by R then translated by t
function merge(m, s, R = I, t = [0, 0, 0]) { for (const q of s.parts) m.parts.push({ ...q, p: add(app(R, q.p), t), R: mul(R, q.R) }); return m; }
function rebase(m, o) {
  for (const q of m.parts) q.p = q.p.map((v, i) => v - o[i]);
  for (const k in m.joints) m.joints[k] = m.joints[k].map((v, i) => v - o[i]);
  return m;
}
function turn(m, R) {
  for (const q of m.parts) { q.p = app(R, q.p); q.R = mul(R, q.R); }
  for (const k in m.joints) m.joints[k] = app(R, m.joints[k]);
  return m;
}
// other-hand copy (Z mirrored): each part re-placed as a proper rotation S·R·F, F = a reflection the part is
// symmetric under (default its own X); handed pairs swap ids. Extend SWAP/SYM as needed.
const SWAP = { 41769: "41770", 41770: "41769", 43722: "43723", 43723: "43722", 41767: "41768", 41768: "41767", 29119: "29120", 29120: "29119", 50304: "50305", 50305: "50304" };
const SYM = {};
const F = { x: ori(nX, Y, Z), z: ori(X, Y, nZ), d: ori(Z, Y, X), a: ori(nZ, Y, nX) };
const S = ori(X, Y, nZ);
function mirror(m, name) {
  const n = mod(name);
  for (const q of m.parts) n.parts.push({ ...q, id: SWAP[q.id] ?? q.id, p: [q.p[0], q.p[1], -q.p[2]], R: mul(mul(S, q.R), F[SYM[q.id] ?? "x"]) });
  for (const k in m.joints) n.joints[k] = [m.joints[k][0], m.joints[k][1], -m.joints[k][2]];
  return n;
}
const f = (v) => +(+v).toFixed(3);
const line = (c, p, R, file) => `1 ${c} ${p.map(f).join(" ")} ${R.flat().map(f).join(" ")} ${file}`;
// a single module as a plain LDR (for tests); joints marked with 0 // JOINT lines
function writeModule(m, out) {
  const L = [`0 ${m.name}`, `0 Name: ${m.name}.ldr`];
  for (const k in m.joints) L.push(`0 // JOINT ${k} ${m.joints[k].map(f).join(" ")}`);
  for (const q of m.parts) { if (q.note) L.push(`0 // ${q.note}`); L.push(line(q.c, q.p, q.R, `${q.id}.dat`)); }
  fs.writeFileSync(out, L.join("\n") + "\n");
}


// ======================================== TORSO (steps 1–64)
const { torso } = (() => {
// TORSO of LEGO 31151 T. rex (booklet 6520924, steps 1–64).
// Frame: LDU, −Y up, head toward −X, left (+Z). Origin: top of the tan 4×10 base plate (3030), centre.
// Surfaces: a part "on" surface S has its LDraw origin at S − (its height below the origin):
// plates S−8, bricks S−24, studless curves (11477, 15068, 85984, 29119) S.

Object.assign(SYM, { 26601: "a", 4304: "x", 30414: "x", 87087: "x", 14417: "x", 80563: "x" });

const SIDES = [-1, 1]; // −Z (right) and +Z (left)
const side = (s) => (s < 0 ? I : RY180); // a part whose feature points to its −Z: towards that side

// The flank panel (steps 43–52, again 54–63): three olive 2×4 plates, a row of dark green
// wedged curves along the top edge rolling over the back, dark green tile strips hanging down
// ("scales"), quarter tiles at their ends, a black 2×2 plate under the front corner.
// Built flat, studs up (−y'), x' = down the flank, z' = along the body (+z' to the rear);
// stood up later with its studs facing out.
function flank() {
  const m = mod("flank");
  // three olive 2x4 plates: two along the top edge, one staggered below
  m.put("3020", "olive", 20, 0, 40, RY90, "olive 2x4").put("3020", "olive", 20, 0, 120, RY90, "olive 2x4").put("3020", "olive", 60, 0, 80, RY90, "olive 2x4");
  // top edge (steps 43–50): a wedged curve at each end, three 2x2 curves between, all rolling over the edge (x' < 0)
  m.put("29119", "dkgreen", 0, 0, 10, RY90, "edge wedge").put("29120", "dkgreen", 0, 0, 150, RY90, "edge wedge");
  for (const z of [40, 80, 120]) m.put("15068", "dkgreen", 0, -4.5, z, I, "edge curve");
  // the scales: 1x2 tiles down the flank, quarter tiles at their tips
  for (const z of [50, 70, 90, 110]) m.put("3069b", "dkgreen", 40, -8, z, I, "scale");
  for (const [x, z] of [[30, 10], [30, 30], [30, 130], [30, 150], [70, 90], [70, 110]]) m.put("25269", "dkgreen", x, -8, z, I, "scale tip");
  m.put("26601", "olive", 80, -8, 60, I, "cut corner").put("3070b", "dkgreen", 70, -16, 50, I).put("25269", "dkgreen", 70, -16, 70, I);
  m.put("3022", "black", 60, 8, 100, I, "under the rear corner");
  return m;
}

function torso() {
  const m = mod("torso");
  // ---------- steps 1–5: the tan boat
  m.put("3030", "tan", 0, 0, 0, I, "belly 4x10");
  for (const s of SIDES) m.put("3747b", "tan", 90, -24, 20 * s, RYm90, "rear keel");
  m.put("3008", "tan", 0, -24, -30).put("3008", "tan", 0, -24, 30);
  m.put("3022", "dbg", 100, -32, 0, I);
  m.put("3710", "olive", 80, -32, -30).put("3710", "olive", 80, -32, 30);
  // rear cap: 2 inverted brackets on the rear keel, a 2x2 plate and 4 olive bows on their faces (+X)
  for (const s of SIDES) m.put("99207", "dbg", 130, -32, 20 * s, RYm90, "rear cap bracket");
  const studsPX = ori(Y, nX, Z); // studs → +X
  m.put("3022", "dbg", 152, -44, 0, studsPX, "rear cap plate");
  m.put("11477", "olive", 156.5, -34, 0, studsPX).put("11477", "olive", 156.5, -54, 0, studsPX);
  for (const s of SIDES) m.put("11477", "olive", 148.5, -44, 30 * s, ori(nZ, nX, Y));
  // step 6: studs-on-2-sides brick and the olive cross plate
  m.put("52107", "black", 30, -24, 0, RY90).put("3710", "olive", 30, -32, 0, RY90);
  // step 7: front keel
  for (const s of SIDES) m.put("3747b", "tan", -90, -24, 20 * s, RY90, "front keel");
  // step 8: technic 1x1s with long pins (booklet: 2x 65304 LBG + 2x 6541)
  for (const s of SIDES) m.put("6541", "black", -30, -24, 10 * s, RY90).put("65304", "lbg", -50, -14, 10 * s, I);
  // step 9: 6 black 2x2 plates with side studs (raised row outside, side studs out)
  for (const s of SIDES) for (const x of [-80, -40, 0]) m.put("4304", "black", x, -40, 30 * s, side(s), "side studs");
  // step 10: dark red tiles in the middle, arm balls and a tan tile at the front
  for (const s of SIDES) m.put("6636", "dkred", -40, -40, 10 * s);
  for (const s of SIDES) m.put("14417", "dbg", -120, -32, 30 * s, side(s), "arm ball");
  m.put("3068b", "tan", -120, -32, 0, I, "the chest slides on this tile");
  // steps 11–14: the coloured layers, olive 1x6 bricks, white 2x2 stack
  for (const s of SIDES) {
    m.put("3023", "olive", -80, -48, 30 * s).put("3623", "yellow", -30, -48, 30 * s);
    m.put("3623", "rbrown", -70, -56, 30 * s).put("3023", "olive", -20, -56, 30 * s);
    m.put("3009", "olive", 80, -56, 30 * s);
  }
  m.put("3003", "white", 100, -56, 0).put("3003", "white", 100, -80, 0);
  // step 15: the two 1x10 technic bricks, back to the rear (hip holes at x 80 and 120)
  for (const s of SIDES) m.put("2730", "black", 40, -80, 30 * s, I, "hip beam");
  // steps 16–17: side-stud columns and the front stacks
  for (const s of SIDES) {
    m.put("87087", "olive", -90, -80, 30 * s, side(s)).put("6141", "olive", -90, -88, 30 * s).put("6141", "olive", -90, -96, 30 * s);
    m.put("3004", "olive", -120, -56, 30 * s).put("3004", "olive", -120, -80, 30 * s);
  }
  // steps 18–20: tail socket, rear corners, side-stud bricks, the dark green rear deck
  m.put("67696", "dbg", 100, -104, 0, I, "tail socket, opening +X");
  for (const s of SIDES) {
    m.put("3004", "dkgreen", 100, -104, 30 * s).put("3005", "dkgreen", 130, -104, 30 * s);
    m.put("30414", "dbg", -40, -104, 30 * s, side(s), "side studs for the flank panel");
  }
  m.put("3001", "dkgreen", 40, -104, 0, RY90);
  // step 21: hip sockets on the 1x10 technic bricks
  m.put("80563", "dbg", 100, -70, 50, oriYZ(nZ, X), "hip socket L").put("80563", "dbg", 100, -70, -50, oriYZ(Z, X), "hip socket R");

  // ---------- steps 22–35: the chest. It rests on the tan tile and hangs on the rotation joint;
  // its sides are walls of side studs (73825 – 44728 – 73825), the neck ball points forward.
  m.put("3020", "tan", -140, -40, 0, I, "chest").put("3020", "tan", -120, -48, 0).put("3023", "tan", -170, -48, 0, RY90);
  m.put("3660", "tan", -150, -72, 0, RY90).put("3010", "tan", -100, -72, 10).put("4286", "tan", -90, -72, -10, RY90);
  m.put("3005", "tan", -130, -72, -10);
  m.put("3022", "dbg", -160, -80, 0).put("3623", "orange", -110, -80, 10);
  for (const s of SIDES) m.put("73825", "black", -170, -88, 10 * s, side(s), "side studs, front");
  m.put("73825", "black", -90, -88, 10, RY180, "side studs, rear").put("73825", "black", -90, -80, -10, I, "side studs, rear (on the slope's top stud)");
  m.put("3023", "olive", -150, -88, 0, RY90);
  m.put("57909", "dbg", -160, -112, 0, RY180, "neck ball, forward");
  m.put("3894", "black", -80, -104, -10, I).put("44865", "white", -120, -104, 10, I, "its pin in the 1x6's hole");
  for (const x of [-60, -40]) m.put("89678", "dbg", x, -94, -16, RY90, "INF: half pin in the 1x6");
  for (const s of SIDES) m.put("44728", "lbg", -140, -120, 10 * s, side(s), "side studs, middle");
  m.put("3023", "olive", -140, -128, -10);
  m.put("76959", "black", -90, -128, 0, RY90);
  // steps 32–33: the rotation joint: 80563 on one 1x4 technic brick, 44225 in it, its pin in the other
  for (const s of SIDES) m.put("3701", "black", 20, -128, 30 * s).put("3023", "red", 0, -136, 30 * s).put("3023", "tan", 0, -144, 30 * s);
  m.put("80563", "dbg", 20, -118, -10, oriYZ(nZ, X), "chest joint socket").put("44225", "lbg", 20, -118, 5, ori(X, nZ, Y), "chest joint disk");
  for (const [x, s] of [[0, -1], [40, -1], [20, 1]]) m.put("61332", "black", x, -118, 20 * s, oriYZ(Y, nX));
  m.put("3004", "tan", -90, -152, 0, RY90);
  // step 35: four side-stud plates on the 1x4 technic bricks
  for (const s of SIDES) m.put("4304", "black", 20, -144, 30 * s, side(s));

  // ---------- steps 36–40: the back
  m.put("3020", "olive", 0, -152, 0, RY90, "bridges the two 1x4 technic bricks");
  for (const x of [40, 80, 120, 160]) m.put("3020", "dkgreen", x, -112, 0, RY90);
  for (const [x, y] of [[-20, -160], [-20, -168], [140, -120]]) m.put("41769", "dkgreen", x, y, -40, RY90, "back wedge").put("41770", "dkgreen", x, y, 40, RY90, "back wedge");
  for (const x of [-40, 0]) for (const s of SIDES) m.put("3069b", "dkgreen", x, -176, 50 * s);
  m.put("80545", "dkgreen", 100, -144, 0, I, "hump");
  for (const x of [50, 150, 170]) m.put("85984", "dkgreen", x, -112, 0, RY90, "spine (step 39)");
  m.put("3022", "black", 20, -144, 0).put("15068", "dkgreen", 20, -148.5, 0, I);
  
  for (const s of SIDES) m.put("4304", "black", -60, -120, 30 * s, side(s), "step 35").put("85984", "dkgreen", -60, -120, 30 * s, I, "spine");
  m.put("3010", "olive", -60, -136, 10, I).put("85984", "dkgreen", -60, -112, -10, I, "spine");
  for (const s of SIDES) m.put("6005", "dkgreen", -110, -128, 30 * s, RY90, "shoulder arch").put("6141", "olive", -110, -128, 30 * s);
  m.put("47753", "dkgreen", -140, -152, 0, RY90, "front of the back, over the chest");
  m.put("3710", "dkgreen", 140, -128, -50).put("3710", "dkgreen", 140, -128, 50).put("3710", "dkgreen", 140, -136, 50);
  m.put("3070b", "dkgreen", 170, -136, -50).put("3070b", "dkgreen", 170, -144, 50).put("3069b", "dkgreen", 120, -136, -50);
  for (const s of SIDES) m.put("3040b", "dkgreen", -110, -152, 30 * s, RYm90, "INF: shoulder point, on the arch's stud");

  // ---------- steps 41–42: shoulder plates on the chest's side studs
  for (const s of SIDES) {
    const R = s > 0 ? oriYZ(nZ, X) : oriYZ(Z, X);
    const Rp = s > 0 ? ori(X, nZ, Y) : ori(X, Z, nY);
    m.put(s > 0 ? "41769" : "41770", "olive", -140, -100, 32 * s, R, "shoulder wedge");
    m.put("3710", "dkgreen", -140, -110, 40 * s, Rp).put("3069b", "dkgreen", -160, -110, 48 * s, Rp).put("3069b", "dkgreen", -120, -110, 48 * s, Rp);
  }

  // ---------- steps 43–64: the flank panels (the second one is the mirror), studs out
  const fr = mod("fr");
  merge(fr, flank(), ori(Y, Z, X), [-100, -104, -48]);
  merge(m, fr);
  merge(m, mirror(fr, "fl"));

  m.joints = {
    neck: [-200, -102, 0], //    57909 ball, axis −X
    tail: [136.4, -94, 0], //    67696 socket, opening +X
    hipL: [100, -70, 55], //     80563 rotation-joint socket, axis +Z
    hipR: [100, -70, -55],
    armL: [-120, -28, 50], //    14417 tow ball, axis +Z
    armR: [-120, -28, -50],
  };
  return m;
}

return { torso };
})();

// ======================================== TAIL (steps 65–94) and ARMS (171–186)
const { tail1, tail2, tail3, tail4, armL, armR } = (() => {
// 31151 T. rex — tail (booklet 6520924 steps 65–94) and arms (steps 171–186).
// Frame: head toward −X, −Y up, left +Z. Each module's origin = its plug joint.

// side decoration orientations (left side, +Z): studs → +Z
const WEDGE_L = ori(nY, nZ, X); //  41769 on a +Z face: its 4-stud row up, the tapered half hanging down
const ON_FACE = ori(X, nZ, Y); //   tile on a +Z face (part bottom toward −Z)
const RIB = ori(nX, nZ, nY); //     11477 on a +Z face: bulge at the top, thin end down

// one face of 4 side studs (cols at xs, two rows yTop / yBot, face plane z = 24): wedge on the lower row,
// curves 11477 on the wedge's studs at cols 0 and 2, dark green 1x1 tiles on the upper row at cols 1 and 3
function faceDeco(m, xc, yTop, yBot, wedge = "41769") {
  const xs = [xc - 30, xc - 10, xc + 10, xc + 30];
  m.put(wedge, "olive", xc, yBot + 10, 32, WEDGE_L, "side wedge on the bracket's lower stud row");
  for (const i of [0, 2]) m.put("11477", "olive", xs[i], yBot + 10, 32, RIB, "rib");
  for (const i of [1, 3]) m.put("3070b", "dkgreen", xs[i], yTop, 32, ON_FACE);
}
const BR_L = RY180; // 93274 bracket with its 2x4 face out to +Z

// =============== TAIL 1 (steps 65–79) — 8 long; socket at the front on the torso's tail ball, ball at the rear
function tail1() {
  const m = mod("tail-1");
  // col k (1..8) at x = 20k − 90; base brick top at y = 0
  m.put("3007", "tan", 0, 0, 0, I, "base 2x8 brick");
  m.put("3023", "tan", 70, -8, 0, RY90).put("3020", "tan", 20, -8, 0);
  m.put("3023", "tan", -10, -16, 0, RY90).put("3020", "tan", 40, -16, 0);
  m.put("57909", "dbg", -40, -24, 0, RY180, "plug: 2x2 ball brick, ball forward into the torso's rear 67696");
  m.put("3022", "tan", -40, -32, 0);
  m.put("3002", "black", 10, -40, 0).put("57909", "dbg", 60, -40, 0, I, "ball for tail 2");
  // brackets: 2x4 stud faces down both sides
  const side = mod("s");
  side.put("93274", "black", -40, -40, 10, BR_L, "side face, front").put("93274", "black", 40, -48, 10, BR_L, "side face, rear");
  faceDeco(side, -40, -30, -10);
  faceDeco(side, 40, -38, -18);
  merge(m, side); merge(m, mirror(side, "s2"));
  m.put("3022", "dbg", 0, -48, 0).put("3023", "tan", 70, -48, 0, RY90).put("3023", "olive", 70, -56, 0, RY90);
  // roof: two double slopes, sloped ends to the rear
  m.put("80545", "dkgreen", -40, -72, 0, I, "roof").put("80545", "dkgreen", 40, -80, 0, I, "roof");
  // belly (step 78): two inverted curves, deep end forward, a 1x2 under their thin ends, a 2x2 behind
  m.put("13547", "tan", -70, 24, 10, ori(Z, Y, nX), "belly curve").put("13547", "tan", -70, 24, -10, ori(Z, Y, nX), "belly curve");
  m.put("3023", "tan", -10, 32, 0, RY90).put("3022", "tan", 40, 24, 0);
  m.joints = { plug: [-80, -14, 0], next: [100, -30, 0] };
  return rebase(m, m.joints.plug);
}

// =============== TAIL 2 (steps 80–92) — 8 long on a tan 2x8 plate
function tail2() {
  const m = mod("tail-2");
  m.put("3034", "tan", 0, 0, 0, I, "base 2x8 plate");
  m.put("67696", "dbg", -60, -24, 0, RY180, "plug: wide ball socket on tail 1's ball");
  m.put("3010", "olive", 0, -24, 10).put("3010", "olive", 0, -24, -10).put("3004", "olive", 50, -24, 0, RY90);
  m.put("3023", "olive", 70, -8, 0, RY90).put("3023", "olive", 70, -16, 0, RY90).put("14417", "dbg", 70, -24, 0, RYm90, "ball for tail 3");
  const side = mod("s");
  side.put("93274", "black", -40, -32, 10, BR_L, "side face");
  faceDeco(side, -40, -22, -2);
  merge(m, side); merge(m, mirror(side, "s2"));
  m.put("3023", "tan", -70, -32, 0, RY90).put("3023", "olive", -70, -40, 0, RY90).put("3022", "dbg", 0, -32, 0);
  m.put("80545", "dkgreen", -40, -64, 0, RY180, "roof, sloped end forward").put("80545", "dkgreen", 40, -56, 0, RY180, "roof");
  // underside (steps 84–85)
  m.put("3176", "tan", -60, 8, 0, RY90, "rounded end under the socket").put("3022", "tan", -20, 8, 0).put("3020", "tan", 40, 8, 0);
  m.put("3020", "tan", -20, 16, 0).put("3023", "tan", 30, 16, 0, RY90);
  m.joints = { plug: [-100, -14, 0], next: [90, -20, 0] };
  return rebase(m, m.joints.plug);
}

// =============== TAIL 3 (step 93) — tan 2x4 brick
function tail3() {
  const m = mod("tail-3");
  m.put("3001", "tan", 0, 0, 0, I, "core 2x4 brick");
  for (const x of [-30, -10, 10]) m.put("3023", "olive", x, -8, 0, RY90);
  m.put("14417", "dbg", 30, -8, 0, RYm90, "ball for the tip");
  m.put("14704", "lbg", -30, -16, 0, RY90, "plug: centre side socket");
  m.put("80545", "dkgreen", 0, -40, 0, RY180, "roof, sloped end forward");
  m.joints = { plug: [-50, -12, 0], next: [50, -4, 0] };
  return rebase(m, m.joints.plug);
}

// =============== TAIL 4 / tip (step 94) — 1 wide
function tail4() {
  const m = mod("tail-4");
  m.put("4287c", "tan", 0, 0, 0, RYm90, "inverted 33° 3x1, deep end forward");
  m.put("14418", "lbg", 10, -8, 0, RY180, "plug: end socket on tail 3's ball").put("3023", "olive", 50, -8, 0);
  m.put("3710", "dkgreen", 50, -16, 0);
  m.joints = { plug: [-20, -4, 0] };
  return rebase(m, m.joints.plug);
}

// =============== ARM (steps 171–178; 179–186 the other hand) — origin: the shoulder socket
function armL() {
  const m = mod("arm-l");
  // upper arm: two cut-corner wedge plates sandwich two socket plates set at 90° (a V)
  m.put("26601", "olive", 0, 0, 0, I, "upper arm, bottom");
  m.put("14418", "lbg", 20, -8, 10, I, "elbow socket (end +X)");
  m.put("14418", "lbg", -10, -8, -20, RY90, "shoulder socket (end −Z)");
  m.put("26601", "olive", 0, -16, 0, I, "upper arm, top");
  m.put("11477", "olive", -10, -24, 0, I, "upper arm curve");
  // hand: clip plate under a side-ball plate, olive 1x2 on top; ball in the elbow socket
  m.put("60470b", "black", 70, 0, 10, RYm90, "claw clips, forward");
  m.put("14417", "dbg", 70, -8, 10, RY90, "wrist ball, back into the elbow");
  m.put("3023", "olive", 70, -16, 10, RY90);
  // claw holders: handle in a clip, tube vertical; the claw's bar up into the tube (seat search, conn: bar)
  const HA = [[1, 0, 0], [0, 0, 1], [0, -1, 0]], HB = [[1, 0, 0], [0, 0, -1], [0, 1, 0]];
  const CLAW = ori(nZ, nX, Y);
  m.put("23443", "dbg", 90, 0, -10, HA, "claw holder, handle in the inner clip").put("53451", "black", 90, 4, -10, CLAW, "claw");
  m.put("23443", "dbg", 90, 0, 30, HB, "claw holder, handle in the outer clip").put("53451", "black", 90, 4, 30, CLAW, "claw");
  m.joints = { plug: [-10, -4, -50], elbow: [50, -4, 10] };
  return rebase(m, m.joints.plug);
}
SYM["14418"] = "z"; SYM["26601"] = "a";
const armR = () => mirror(armL(), "arm-r");

return { tail1, tail2, tail3, tail4, armL, armR };
})();

// ======================================== LEGS (steps 95–170)
const { thighR, thighL, footR, footL } = (() => {
// Legs of the 31151 T-rex (booklet 6520924 steps 95–133 right leg, 134–170 left leg = mirror).
// thigh: a slab built flat (studs = outward), the hip cap (79505 rotation disk) at one end, two 67696
// wide ball sockets (ankle) at the other. foot: 2× 85943 holding two 53585 balls on an 87083 axle, three toes.
Object.assign(SYM, { 67696: "z", 65304: "z", 61332: "z", 42924: "z", 89678: "z", 87083: "z", 32062: "z", 26601: "a" });

// ---------- THIGH, flat frame b: studs up (−y) = outward, y = 0 the inner face; x from the ankle (0) to the hip.
// Grid: stud centres at odd multiples of 10 in x and z.
function thighFlat() {
  const m = mod("thigh-r");
  // ankle block (95, 105, 106): two wide sockets, cups → −x, 40 apart (the foot's two balls)
  m.put("67696", "dbg", 0, -24, 0, RY180, "ankle socket 1");
  m.put("79180", "black", 30, -32, 0, RYm90, "bracket: upper 2x3 on socket 1, lower 2x2 flange toward the slab");
  m.put("3023", "olive", 0, -40, 10, I, "spacer under socket 2");
  m.put("67696", "dbg", 0, -64, 0, RY180, "ankle socket 2");
  m.put("44728", "black", 0, -72, -10, I, "bracket on socket 2, 2x2 face → −z (back)");
  m.put("99207", "dbg", 0, 0, -10, I, "inverted bracket under socket 1, 2x2 face → −z");
  // layer 1 on the flange (96–97)
  m.put("50304", "olive", 140, -16, 10, RY90, "8x3 wedge, narrow end on the flange");
  for (const y of [-16, -24, -32]) m.put("3023", "olive", 60, y, 10, I);
  // underside (100, 101)
  m.put("3023", "olive", 160, -8, 10, I, "under the wedge").put("26601", "olive", 200, -8, 0, I, "under the wedge's wide end");
  m.put("41767", "olive", 100, -8, -20, RYm90, "under the wedge, bulging inward");
  // brick layer (98, 99)
  m.put("3004", "olive", 60, -40, -10, I);
  m.put("41767", "olive", 120, -40, 0, RYm90, "wedged brick along the wedge");
  m.put("3001", "dkgreen", 200, -40, 20, I, "2x4 at the wide end (the knee)");
  m.put("41768", "olive", 100, -8, 20, RYm90, "under the wedge, bulging inward");
  // top layer (102–104)
  m.put("43722", "dbg", 50, -48, 0, RY90, "3x2 wedge at the ankle end").put("3022", "black", 40, -56, 0, I);
  m.put("50305", "olive", 160, -48, 10, RYm90, "top 8x3 wedge, reversed: the slab's zigzag");
  m.put("78329", "dbg", 70, -56, 30, I, "1x5 on the top wedge's wide end");
  m.put("3710", "olive", 140, -56, -10, I).put("3023", "olive", 240, -56, -10, I).put("26601", "olive", 140, -56, 20, I);
  // dewclaw on the back face (107): plate with an offset pin hole, curved top, pin, small claw
  const dc = mod("dc");
  dc.put("11458", "dbg", 0, 0, 0, I).put("11477", "olive", -10, 0, 0, RY90).put("61332", "black", 10, -6, 0, ori(Z, Y, nX)).put("53451", "black", 10, -6, -24, oriYZ(nZ, Y), "dewclaw");
  merge(m, dc, ori(X, Z, nY), [0, -42, -32]);
  // top of the ankle (108)
  m.put("50950", "dbg", 10, -96, -10, RY90).put("11153", "olive", 20, -88, 10, RY90);
  // hip cap (109–118), c-frame centred on the hip axis
  const xh = 260, zh = -80; // hip behind the knee (slab wide end, +z): the Z of step 132
  const c = mod("cap");
  c.put("18646", "dkgreen", 0, -8, 0, I, "inner ring, front half").put("18646", "dkgreen", 0, -8, 0, RY180, "inner ring, back half");
  c.put("79505", "black", 0, -22, 0, ori(X, nY, nZ), "hip rotation disk, disk face inward (+y)");
  c.put("61332", "black", -30, -22, 0, I).put("61332", "black", 30, -22, 0, I);
  c.put("3700", "dbg", -50, -32, 0, RY90).put("3700", "dbg", 50, -32, 0, RY90);
  c.put("73109", "lbg", -20, -32, 30, I).put("73109", "lbg", 20, -32, 30, I).put("73109", "lbg", 0, -32, -30, I);
  c.put("3894", "black", 0, -32, -50, I, "front rim");
  c.put("42924", "blue", -40, -22, -40, ori(Z, Y, nX)).put("42924", "blue", 40, -22, -40, ori(Z, Y, nX));
  c.put("89678", "dbg", -20, -22, -60, RYm90).put("89678", "dbg", 20, -22, -60, RYm90);
  c.put("3710", "dkgreen", 0, -22, -72, ori(X, Z, nY), "on the half pins, studs → −z");
  c.put("29119", "dkgreen", -30, -32, -72, ori(nX, Z, Y)).put("85984", "dkgreen", 0, -22, -72, ori(nX, Z, Y)).put("29120", "dkgreen", 30, -32, -72, ori(nX, Z, Y));
  for (const x of [-40, 40]) c.put("3023", "olive", x, -40, -50, I);
  c.put("3023", "red", 0, -40, -50, I);
  for (const x of [-50, 50]) c.put("3023", "olive", x, -40, 0, RY90);
  for (const x of [-20, 20]) c.put("3023", "olive", x, -40, 30, I);
  c.put("3022", "dbg", 0, -40, -20, I);
  c.put("18646", "dkgreen", 0, -48, 0, I, "outer ring").put("18646", "dkgreen", 0, -48, 0, RY180, "outer ring");
  // (the 79505 disk carries its own pin into the torso socket; inventory leaves no 61332 for a hip pin)
  merge(m, c, I, [xh, 0, zh]);
  m.put("3020", "dkgreen", 220, 0, -40, RY90, "under the slab-cap joint (118)");
  // shell over the hip (119): tan 2x4 on a white round 2x2, DBG 2x2, two curved 4x4 wedges
  m.put("4032a", "white", 240, -56, -60, I).put("3020", "tan", 240, -64, -40, RY90).put("3022", "dbg", 240, -72, -40, I);
  m.put("47753", "dkgreen", 240, -88, -60, I).put("47753", "dkgreen", 240, -88, -20, RY180);
  m.joints = { hip: [xh, 0, zh], ankle: [-36.4, -34, 0] };
  return m;
}
// stand up: b x → −Y (up), b y (inner) → +Z, b z → −X (forward). Right leg (−Z side); origin = hip
const R0 = ori(nY, Z, nX);
const STAND = (() => { // b x → up, b y (inner) → +Z, b z → forward; then turned about Z so the hip is 43 LDU in front of the ankle
  const v = app(R0, [260 + 36.4, 0, -80]); const want = Math.atan2(-43, -Math.hypot(v[0], v[1])), now = Math.atan2(v[0], v[1]);
  return mul(Rz((-(want - now) * 180) / Math.PI), R0);
})();
function thighR() { const m = thighFlat(); turn(m, STAND); return rebase(m, m.joints.hip); }
function thighL() { return mirror(thighR(), "thigh-l"); }

// ---------- FOOT, standing frame: studs up, toes → −X, sole at y = 0; origin = midpoint of the two ankle balls
function footRaw() {
  const m = mod("foot-r");
  for (const z of [-30, 30]) {
    m.put("3710", "olive", -20, -8, z, I, "outer toe");
    m.put("3386", "black", -50, -24, z, RY90, "toe tip, side stud forward");
    for (const y of [-16, -24, -32]) m.put("35480", "dbg", 0, y, z, I);
    m.put("11477", "olive", -40, -24, z, RY90).put("87747", "black", -70, -18, z, oriYZ(X, Y), "claw");
  }
  m.put("3023", "olive", -40, -8, 0, I, "middle toe").put("3386", "black", -50, -24, 0, RY90).put("73230", "lbg", -30, -32, 0, RY90, "on the red axle");
  m.put("11477", "olive", -40, -32, 0, RY90).put("87747", "black", -70, -18, 0, oriYZ(X, Y), "claw");
  m.put("4032a", "dbg", 20, -8, 0, I).put("32064a", "black", 10, -32, 0, RY90, "axle hole → X").put("32062", "red", -10, -22, 0, I, "red axle into the middle toe");
  m.put("3023", "olive", -10, -40, 20, RY90).put("3023", "olive", -10, -40, -20, RY90);
  m.put("3710", "olive", -10, -48, 0, RY90, "across the toes (129)");
  m.put("85984", "olive", -10, -48, 20, RY90).put("85984", "olive", -10, -48, -20, RY90);
  for (const z of [-20, 20]) { m.put("85943", "dbg", 10, -56, z, RYm90, "beams back"); m.put("53585", "black", 40, -46, z, I, "ankle ball"); }
  m.put("87083", "dbg", 40, -46, 0, RYm90, "ankle axle");
  m.put("4032a", "dbg", 0, -64, 0, I);
  m.joints = { ball: [40, -46, 0] };
  return m;
}
function footR() { const m = footRaw(); return rebase(m, m.joints.ball); }
function footL() { return mirror(footR(), "foot-l"); }

return { thighR, thighL, footR, footL };
})();

// ======================================== HEAD and JAW (steps 187–235)
const { head, jaw } = (() => {
// 31151 T-rex HEAD (steps 187–217) and JAW (218–235), booklet 6520924 pp. 102–118.
// H frame: head toward −X, −Y up, left +Z. Both are built the booklet's way: an upright stack (S frame,
// LDraw axes, stack growing to −Y) laid down; S up → forward (−X).

Object.assign(SYM, { 39613: "a", 2420: "d", 15208: "x", 49668: "x", 18677: "z", 26601: "a", 6541: "z", 61332: "z", 30374: "x", 67696: "z", 76766: "z", 11211: "x", 85984: "x", 54200: "x", 11477: "x", 15068: "x", 25269: "a", 3024: "x", 3023: "x", 6141: "x", 1126: "x", 1748: "x", 63864: "x" });

// S → H: S x → H z, S y → H x, S z → H y
const MS = ori(Z, X, Y);
const sput = (m) => (id, c, x, y, z, R = I, note) => m.put(id, c, ...app(MS, [x, y, z]), mul(MS, R), note);

// =============== HEAD — origin: the centre of the 67696 ball socket (plugs on a ball at the torso front)
function head() {
  const m = mod("head");
  const s = sput(m);
  // the core stack (steps 187–196), S frame: lower 67329 at the bottom (= the back of the head)
  s("67329", "dbg", 0, 0, 0, I, "back core: studs on 3 sides (up face, both sides)");
  s("50340", "red", 0, -8, 0, RY180, "jaw hinge, two fingers pointing down");
  s("3023", "olive", 0, -16, 0);
  s("26604", "lbg", 10, -40, 0, I); s("26604", "lbg", -10, -40, 0, RY90);
  s("67329", "dbg", 0, -80, 0, I, "snout core");
  s("3022", "black", 0, 20, -18, ori(nX, Z, Y), "on the back core's up face");
  // sub-assembly of step 203: the snout front, continuing the stack forward on the snout core's front studs
  s("67329", "dbg", 0, -120, 0, I, "snout front core");
  s("3023", "dkred", 0, -128, 0, I, "front of the palate");
  // up face of the snout front: olive plates
  const up = ori(nX, Z, Y); // plate studs → S −Z (H up)
  s("3023", "olive", 0, -110, -18, ori(nX, Z, Y)); s("3023", "olive", 0, -90, -18, ori(nX, Z, Y));
  s("3024", "olive", 10, -110, -26, up); s("3024", "olive", -10, -110, -26, up);
  s("3023", "olive", 0, -90, -26, up);
  // one side (S +X = H left), mirrored below
  const side = mod("side");
  const ss = sput(side);
  ss("6141", "tan", 28, -30, 0, ori(Y, nX, Z), "spacer under the wedge");
  ss("39613", "black", 28, 10, 0, ori(nY, nX, nZ), "cheek disc");
  ss("15208", "white", 28, -60, 0, ori(nY, nX, nZ), "upper teeth");
  ss("41769", "olive", 36, -40, -10, ori(Z, nX, nY), "snout side, on the teeth plate, the spacer and the disc");
  ss("2420", "dbg", 10, -30, -18, ori(Y, Z, X), "on the 26604's up stud, arm out over the side");
  ss("2420", "dbg", 28, -90, 0, ori(nY, nX, nZ), "snout front side frame, arm up");
  ss("49668", "white", 36, -110, 0, ori(nY, nX, nZ), "front corner tooth");
  ss("49668", "white", 36, -90, 0, ori(nY, nX, nZ), "side tooth");
  ss("11477", "olive", 28, -100, -20, ori(nZ, nX, Y), "nose side");
  merge(m, side); merge(m, mirror(side, "side-r"));
  // top: olive plate and slopes on the 2420s (198), dark green curved bricks (197)
  m.put("3023", "olive", -30, -26, 0, RY90, "carries the skull bracket's front").put("54200", "olive", -30, -18, 30, RYm90).put("54200", "olive", -30, -18, -30, RY90);
  m.put("29119", "dkgreen", -10, -18, 20, RY180).put("29120", "dkgreen", -10, -18, -20, I);
  m.put("3022", "black", -60, -18, 0, I, "on the snout core's up face");
  // the back tower (199–201): ball socket, two 1x1 technic bricks with pins (the eyes' axle), 2x3
  m.put("67696", "dbg", 20, -42, 0, I, "neck ball socket, open to the back");
  for (const z of [10, -10]) m.put("6541", "black", 10, -66, z);
  m.put("61332", "black", 10, -56, 20, RYm90, "eye pin").put("61332", "black", 10, -56, -20, RYm90, "eye pin");
  m.put("3021", "black", 30, -74, 0);
  // skull (204–209): Z bracket — 2x3 top on the 2x3 plate, 2x2 step on the olive 1x2; 2x4 forward, nose
  m.put("76766", "dkgreen", -10, -82, 0, RY90, "skull: high at the back, low over the snout");
  m.put("3020", "dkgreen", -60, -42, 0, I, "snout top");
  m.put("85984", "dkgreen", -90, -66, 0, RY90).put("85984", "dkgreen", -70, -66, 0, RY90);
  // per side (mirrored): nose brick with side studs, eye socket and brow, cheek plates on the disc
  const eye = mod("eye");
  eye.put("11211", "olive", -80, -66, 10, RY180, "nose side, studs out");
  eye.put("3023", "olive", -80, -56, 28, ori(X, nZ, Y), "on the nose brick's side studs");
  eye.put("15068", "dkgreen", -80, -46, 28, ori(X, nZ, Y), "side panel over the snout");
  eye.put("25269", "dkgreen", -110, -34, 10, I, "rounded nose corner");
  eye.put("18677", "black", 0, -66, 30, I, "eye socket on the pin");
  eye.put("29119", "dkgreen", 0, -66, 30, RY90, "brow");
  eye.put("26601", "olive", 20, -10, 36, ori(X, nZ, Y), "cheek plate on the disc");
  eye.put("26601", "olive", 20, 30, 36, ori(X, nZ, Y), "cheek plate on the disc");
  eye.put("26601", "olive", 20, 10, 44, ori(X, nZ, Y), "cheek plate tying the two below");
  merge(m, eye); merge(m, mirror(eye, "eye-r"));
  m.put("30374", "tgreen", 10, -56, -40, ori(X, Z, nY), "eyes: one bar through both pins");
  m.joints = { jaw: [-6, 16, 0] };
  return rebase(m, [56.4, -32, 0]);
}

// =============== JAW — origin: the 44301b finger's axis (in the head's 50340); the jaw runs along −X
function jaw() {
  const m = mod("jaw");
  // S' frame upright stack, laid: S' x → −Y (up), S' y → X, S' z → Z
  const MJ = ori(nY, X, Z);
  const s = (id, c, x, y, z, R = I, note) => m.put(id, c, ...app(MJ, [x, y, z]), mul(MJ, R), note);
  s("3023", "olive", 0, 0, 0);
  s("44301b", "dbg", 0, 8, 0, I, "hinge finger, up into the head's 50340");
  s("52107", "black", 0, -24, 0);
  s("3386", "black", -10, -40, 0, I, "step 219: 1x1x2/3 half round with side stud"); s("54200", "tan", 10, -24, 0, RY180);
  s("4733", "dbg", -10, -64, 0);
  s("3023", "dkred", 8, -64, 0, ori(Y, nX, Z), "mouth floor");
  s("85861", "black", -10, -72, 0); s("85861", "black", -10, -80, 0);
  s("4733", "dbg", -10, -104, 0);
  s("63864", "tan", -28, -74, 0, ori(Y, X, nZ), "under the chin");
  s("93273", "dkred", 8, -64, 0, ori(nZ, nX, Y), "tongue (lies on the mouth floor; the library puts its anti-studs 25 LDU low)");
  s("54200", "dkred", 0, -94, 0, ori(nZ, nX, Y));
  s("3024", "tan", -10, -112, 0); s("3024", "tan", -10, -120, 0); s("3070b", "tan", -10, -128, 0, I, "chin tip");
  s("4733", "dbg", -10, 16, 0, I, "rear, under the hinge plate");
  const side = mod("js");
  const ss = (id, c, x, y, z, R = I, note) => side.put(id, c, ...app(MJ, [x, y, z]), mul(MJ, R), note);
  ss("15208", "white", -10, -44, 18, ori(Y, nZ, nX), "lower teeth"); ss("15208", "white", -10, -84, 18, ori(Y, nZ, nX), "lower teeth");
  ss("41769", "tan", 0, -64, 26, ori(nX, nZ, nY), "jaw side, on the teeth plates");
  ss("11477", "tan", 0, -14, 10, ori(nY, nZ, X), "cheek, on the 52107 side studs");
  ss("39613", "black", -10, 26, 18, ori(nY, nZ, X), "jaw disc");
  ss("1126", "tan", -10, 36, 26, ori(Y, nZ, nX)); ss("1748", "tan", 10, 16, 26, ori(Y, nZ, nX));
  merge(m, side); merge(m, mirror(side, "js-r"));
  s("3024", "tan", 8, 26, 0, ori(Y, nX, Z)).put; s("3024", "tan", -28, 26, 0, ori(nY, X, Z));
  s("11477", "tan", 8, 36, 0, ori(nZ, nX, Y)); s("11477", "tan", -28, 36, 0, ori(Z, X, Y));
  m.joints = {};
  return rebase(m, app(MJ, [20, 10, 0]));
}

return { head, jaw };
})();

// ======================================== ASSEMBLY
// pose (degrees): body = torso pitch (nose up); head, jaw, tail segments relative to their parent; arms [Rz, Ry, Rx]
// about the shoulder ball; thighs about the hip axis relative to the torso; feet about the ankle (world: 0 = flat)
const P = JSON.parse(process.env.POSE ?? "null") ?? {
  body: 30, head: -30, jaw: 35, tail: [-36, -6, -8, -14], armL: [110, 0, 0], armR: [125, 0, 0], thighL: -24, thighR: -36, footL: 0, footR: 0,
};
const M = {};
const place = (m, R, t) => (M[m.name] = { m, R, t });
const at = (name, j) => add(app(M[name].R, M[name].m.joints[j]), M[name].t);
const Rb = Rz(P.body);
place(torso(), Rb, [0, 0, 0]);
place(head(), mul(Rb, Rz(P.head)), at("torso", "neck"));
place(jaw(), mul(M.head.R, Rz(-P.jaw)), at("head", "jaw"));
const T = [tail1(), tail2(), tail3(), tail4()];
let R = Rb, prev = ["torso", "tail"];
T.forEach((t, i) => { R = mul(R, Rz(P.tail[i])); place(t, R, at(...prev)); prev = [t.name, "next"]; });
const ar = (a) => mul(Rz(a[0]), mul(Ry(a[1]), Rx(a[2])));
place(armL(), mul(Rb, ar(P.armL)), at("torso", "armL"));
place(armR(), mul(Rb, ar(P.armR)), at("torso", "armR"));
place(thighL(), Rz(P.body + P.thighL), at("torso", "hipL"));
place(thighR(), Rz(P.body + P.thighR), at("torso", "hipR"));
place(footL(), Rz(P.footL), at("thigh-l", "ankle"));
place(footR(), Rz(P.footR), at("thigh-r", "ankle"));
// stand on the ground: lowest foot point at y = 0 (approx: part origins)
let maxY = -1e9; for (const k of ["foot-l", "foot-r"]) for (const q of M[k].m.parts) maxY = Math.max(maxY, add(app(M[k].R, q.p), M[k].t)[1]);
const out = process.argv[2] ?? "data/golden/31151-rex.ldr";
const Lines = ["0 FILE 31151-rex.ldr", "0 LEGO 31151 T. rex — T. rex build (reference rebuild)", "0 Name: 31151-rex.ldr", "0 Author: scripts/rebuild-31151.mjs", ""];
for (const k in M) Lines.push(line(16, add(M[k].t, [0, -maxY, 0]), M[k].R, `${k}.ldr`));
const counts = {}; let total = 0;
for (const k in M) {
  const m = M[k].m;
  Lines.push("", "0 NOFILE", `0 FILE ${k}.ldr`, `0 ${k}`, `0 Name: ${k}.ldr`);
  for (const q of m.parts) { if (q.note) Lines.push(`0 // ${q.note}`); Lines.push(line(q.c, q.p, q.R, `${q.id}.dat`)); }
  counts[k] = m.parts.length; total += m.parts.length;
}
Lines.push("0 NOFILE");
fs.writeFileSync(out, Lines.join("\n") + "\n");
console.log(Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(", "), "| total", total);
