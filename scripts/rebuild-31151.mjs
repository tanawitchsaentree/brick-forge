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

Object.assign(SYM, { 26601: "a", 25269: "a", 4304: "x", 30414: "x", 87087: "x", 14417: "x", 80563: "x" });

const SIDES = [-1, 1]; // −Z (right) and +Z (left)
const side = (s) => (s < 0 ? I : RY180); // a part whose feature points to its −Z: towards that side

// the axis-aligned rotation that takes each local vector a[i] to the world direction b[i]
const ROTS = (() => { const V = [X, Y, Z, nX, nY, nZ], out = [];
  for (const px of V) for (const py of V) { const pz = cross(px, py); if (pz.some((v) => v !== 0) && px.every((v, i) => v * py[i] === 0)) out.push(ori(px, py, pz)); }
  return out; })();
const dir = (v) => v.map(Math.sign);
function rotTo(...pairs) {
  for (const R of ROTS) if (pairs.every(([a, b]) => dir(app(R, a)).every((v, i) => v === Math.sign(b[i])))) return R;
  throw new Error("no rotation " + JSON.stringify(pairs));
}

// The flank panel (steps 43–52; the second one, steps 54–63, is its mirror image). Built in place on the
// left (+Z) wall, studs out: three olive 2x4 plates stood on end side by side, a black 2x2 and an olive
// cut-corner 2x2 at the front; a row of dark green curves along the top edge rolls over the back; dark
// green 1x2 tiles hang down between bare olive studs ("scales"), quarter tiles at their tips.
// Panel grid: v = column along the body (v1 rear x 50 … v8 front x -90), u = row up the wall
// (u1 y -74 … u4 y -134, u5 = the curves' overhang above the top edge). Its anti-studs (inner face z 40)
// sit on the 1x4 side-stud brick's four studs (step 19, x -70…-10, y -94 = row u2).
const PX = [0, 50, 30, 10, -10, -30, -50, -70, -90], PY = [0, -74, -94, -114, -134, -154];
const Rpan = oriYZ(nZ, X); //   plate studs → +Z, plate length (local x) → up (−Y)
const Rcur = ori(X, nZ, Y); //  curved slope: studless face → +Z, its length (local z) → down the wall
const R26 = rotTo([Y, nZ], [[1, 0, -1], [-1, 1, 0]]); // cut corner (local +x −z) → front-bottom
const RQ_DOWN = rotTo([Y, nZ], [[1, 0, -1], [-1, 1, 0]]); // quarter tile: round corner (local +x −z) → front-bottom
const RQ_UP = RQ_DOWN;
function flank() {
  const m = mod("flank");
  const at = (v, u) => [(PX[Math.floor(v)] + PX[Math.ceil(v)]) / 2, (PY[Math.floor(u)] + PY[Math.ceil(u)]) / 2];
  const P = (id, c, v, u, z, R, note) => { const [x, y] = at(v, u); m.put(id, c, x, y, z, R, note); };
  // step 43–47: the plates (a curve bridges each joint, so they hold together before the panel is hung)
  P("3020", "olive", 1.5, 2.5, 48, Rpan, "panel plate (v1-2)");
  P("3020", "olive", 3.5, 2.5, 48, Rpan, "panel plate (v3-4)");
  P("3020", "olive", 5.5, 2.5, 48, Rpan, "panel plate (v5-6)");
  // steps 43–48, 50: the top edge, rolling over the back: wedged curve at each end, 2x2 curves between
  P("29119", "dkgreen", 1, 4.5, 48, Rcur, "top edge, rear end");
  for (const v of [2.5, 4.5, 6.5]) P("15068", "dkgreen", v, 4.5, 48, Rcur, "top edge");
  // step 49: black 2x2 under the front of the top edge; step 51: olive cut-corner 2x2 below it
  P("3022", "black", 7.5, 3.5, 48, Rpan, "front corner, under the last curve");
  P("26601", "olive", 7.5, 1.5, 48, R26, "front bottom corner (cut corner at u1 v8)");
  P("29120", "dkgreen", 8, 4.5, 48, Rcur, "top edge, front end");
  // step 50: the scales, quarter tiles beside the curves, a 1x1 tile; step 52: quarter tiles at the scale tips
  for (const v of [2, 4, 6, 8]) P("3069b", "dkgreen", v, 2.5, 56, Rpan, "scale");
  for (const v of [1, 3, 5]) P("25269", "dkgreen", v, 3, 56, RQ_UP, "quarter tile under the curve");
  for (const v of [2, 4, 6]) P("25269", "dkgreen", v, 1, 56, RQ_DOWN, "scale tip");
  P("25269", "dkgreen", 7, 2, 56, RQ_DOWN, "scale tip");
  P("3070b", "dkgreen", 7, 3, 56, Rpan);
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
  // orientations used below
  const RSL = RY180, RSR = I; //               spine slopes, high edge on the centre line
  const RCAP = I, RHUMP = I;
  // step 35: four side-stud plates, two behind each red/tan stack (booklet p.24–25): one on the 1x4 technic
  // brick's rear studs, one on the rear deck riser; raised row with the side studs outside
  for (const s of SIDES) m.put("4304", "black", 40, -144, 30 * s, side(s)).put("4304", "black", 80, -144, 30 * s, side(s), "step 35");

  // ---------- step 20 (parts listed in the back) and steps 36–38: the rear deck, raised in plates from the tail
  // socket / 1x2 / 1x1 deck (y -104) to the 4304s' level (y -144); the rear 4304s stand on it
  m.put("3020", "dkgreen", 100, -112, 0, RY90, "step 20: rear deck").put("3710", "dkgreen", 130, -112, 0, RY90, "step 20: rear deck, last row");
  m.put("3710", "dkgreen", 90, -120, 0, RY90, "step 37").put("3020", "dkgreen", 120, -120, 0, RY90, "step 20: rear deck");
  m.put("3020", "dkgreen", 100, -128, 0, RY90, "step 36: rear riser (carries the rear 4304s)").put("3710", "dkgreen", 130, -128, 0, RY90, "step 37");
  m.put("3020", "dkgreen", 120, -136, 0, RY90, "step 38: rear riser");
  m.put("41770", "dkgreen", 120, -144, 0, RY180, "step 38: rear riser, across").put("41769", "dkgreen", 140, -152, 0, I, "step 38: rear end of the deck, across");
  for (const s of SIDES) m.put("3070b", "dkgreen", 150, -160, 30 * s, I, "step 20: tile on the rear corner");
  m.put("3010", "olive", 70, -128, 0, RY90, "INF: under the rear 4304s, behind the 1x4 technic bricks");
  // ---------- steps 36–39: the back. Olive 2x4 between the 4304 rows, two wedge-plate pairs as the deck
  // (stud rows on the spine, tapered edges outside), the 85984 ridge on the spine, the double wedge as the hump.
  m.put("3020", "olive", 60, -144, 0, I, "step 36: between the two 4304 rows");
  m.put("41769", "dkgreen", 0, -152, -20, RYm90, "step 37 deck: arch ledges, tan plates, 4304s; narrows to the rear").put("41770", "dkgreen", 0, -152, 20, RYm90, "step 37 deck");
  m.put("41769", "dkgreen", 80, -152, 20, RY90, "step 36 deck: narrows to the front (a notch at the joint shows the 4304 studs)").put("41770", "dkgreen", 80, -152, -20, RY90, "step 36 deck");
  for (const x of [-20, 20, 60]) m.put("85984", "dkgreen", x, -152, 10, RSL, "step 39: spine ridge").put("85984", "dkgreen", x, -152, -10, RSR, "step 39: spine ridge");
  m.put("80545", "dkgreen", 120, -184, 0, RHUMP, "step 39: hump");
  // step 38: shoulder arches, foot on the side-stud brick's front stud, ledge behind under the step-37 deck
  for (const s of SIDES) m.put("6005", "dkgreen", -30, -152, 30 * s, RY90, "step 38: shoulder arch, ledge under the deck");
  // step 40: the chest cover; the curved cap between the shoulders; a tile on the tan 1x2 brick
  m.put("47753", "dkgreen", -140, -152, 0, RY90, "step 40: over the chest");
  m.put("3021", "black", -50, -136, 0, I, "step 37: black 2x3, front centre between the shoulders (on the slopes' studs)");
  m.put("3022", "black", -60, -144, 0, I, "step 40: on the 2x3").put("15068", "dkgreen", -60, -144, 0, RCAP, "step 40: between the shoulders");
  m.put("3069b", "dkgreen", -90, -160, 0, RY90, "step 40: on the tan 1x2 brick");

  // INF (no place in steps 36–42 of the booklet): two slopes on the 1x6 technic brick carry the step-40 cap;
  // two round plates in the cavity under it, a tile in each arch's hollow
  for (const z of [-10, 10]) m.put("3040b", "dkgreen", -50, -128, z, RYm90, "INF: under the step-40 cap");
  m.put("6141", "olive", -70, -112, -10, I, "INF: in the cavity").put("6141", "olive", -70, -120, -10, I, "INF");
  for (const s of SIDES) m.put("3069b", "dkgreen", -40, -112, 30 * s, I, "INF: in the arch's hollow, on the side-stud brick");
  for (const s of SIDES) m.put("3069b", "dkgreen", 80, -138, 48 * s, s > 0 ? ori(X, nZ, Y) : ori(X, Z, nY), "INF: on the rear 4304s' side studs");

  // ---------- steps 41–42: cheek plates flat on the chest's side-stud walls, studs out
  for (const s of SIDES) {
    const R = s > 0 ? oriYZ(nZ, X) : oriYZ(Z, X);
    const Rp = s > 0 ? ori(X, nZ, Y) : ori(X, Z, nY);
    const Rt = s > 0 ? ori(Y, nZ, nX) : ori(Y, Z, X);
    m.put(s > 0 ? "41769" : "41770", "olive", -140, -100, 32 * s, R, "cheek wedge plate");
    m.put("3710", "dkgreen", -140, -110, 40 * s, Rp).put("3069b", "dkgreen", -170, -100, 48 * s, Rt).put("3069b", "dkgreen", -130, -100, 48 * s, Rt);
  }

  // ---------- steps 43–64: the flank panels (the second one is the mirror), hung on the side-stud bricks
  const fl = flank();
  merge(m, fl);
  merge(m, mirror(fl, "fr"));
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
const { HIP, thighFlat, TILT, thighR, thighL, footR, footL } = (() => {
// Legs of the 31151 T-rex (booklet 6520924 steps 95–133 right leg, 134–170 left leg = mirror).
// thigh: a slab built flat (studs = outward), two 67696 wide ball sockets (ankle) at one end of a 79180
// bracket, the slab running along x from the bracket's flange, turning sideways (−z) at the knee into the
// hip cap (79505 rotation disk in a ring of 18646). foot: 2× 85943 holding two 53585 balls on an 87083 axle.
Object.assign(SYM, { 67696: "z", 65304: "z", 61332: "z", 42924: "z", 89678: "z", 87083: "z", 32062: "z", 26601: "a" });

// ---------- THIGH, flat frame: studs up (−y) = outward, y = 0 the inner face.
// Booklet grid: stud (i, j) at x = 20i + 10, z = −20j − 70 (i along the slab from the ankle, j across it toward
// the hip). Sockets at i −1..0, j −4..−3 (x = 0, z = 0); flange of the 79180 at j −1..0; slab i 0..9, j 0..4;
// hip ring centred on (i 6.5, j 7.5). Levels: flange/wedge −16..−8, bricks −40..−16, top plates −48..−40.
const gx = (i) => 20 * i + 10, gz = (j) => -20 * j - 70;
const HIP = [gx(6.5), 0, gz(7.5)]; // (140, 0, −220)
function thighFlat(capR = I) {
  const m = mod("thigh-r");
  // ankle block (95, 105, 106)
  m.put("67696", "dbg", 0, -24, 0, RY180, "ankle socket 1, cup → −x");
  m.put("79180", "black", 0, -32, -30, I, "bracket: 2x3 on socket 1, 2x2 flange one brick lower toward −z (j −1..0)");
  for (const y of [-16, -24, -32]) m.put("3023", "olive", gx(-1), y, gz(-0.5), RY90, "stack on the flange (96–97)");
  m.put("50305", "olive", gx(3.5), -16, gz(1), RY90, "8x3 wedge: tip on the flange (i0 j0), straight edge j0, wide end (3) at i6–7");
  // brick layer (98, 99, 101)
  m.put("3004", "olive", gx(0.5), -40, gz(0), I);
  m.put("41767", "olive", gx(3.5), -40, gz(0.5), RYm90, "4x2 wedge brick, studs j0, 2 wide at i2 tapering to 1 at i5");
  m.put("3001", "dkgreen", gx(6.5), -40, gz(1.5), RY90, "2x4 at the knee, across the slab (j0..3)");
  m.put("41768", "olive", gx(4.5), -40, gz(2.5), RY180, "4x2 wedge brick, studs i5 j1..4, 1 wide at j1, 2 wide (i4) at j4");
  m.put("41767", "olive", gx(8.5), -40, gz(2.5), RY180, "4x2 wedge brick, studs i8 j1..4, widening to i9 at j4");
  // under the far end (100): bridge the wedge to the 3020 of step 118
  m.put("26601", "olive", gx(6.5), -8, gz(1.5), RY180, "under the wedge's wide end");
  m.put("3023", "olive", gx(6.5), -8, gz(0), I, "under the wedge's wide end");
  // top layer (102–104)
  m.put("78329", "dbg", gx(-1), -40, gz(-2), RY90, "1x5 on the bracket and the stack (i−1, j−4..0)");
  m.put("43722", "dbg", gx(0.5), -40, gz(-3), RY180, "3x2 wedge plate: studs i0 j−4..−2, wing over i1");
  m.put("3022", "black", gx(-0.5), -48, gz(-1.5), I);
  m.put("50305", "olive", gx(2.5), -48, gz(1), RY90, "top 8x3 wedge: tip i−1, straight edge j0, wide end at i5–6");
  m.put("3710", "olive", gx(7), -48, gz(1.5), RY90, "across the knee (i7, j0..3)");
  m.put("3023", "olive", gx(5.5), -48, gz(3), I, "i5–6, j3");
  m.put("26601", "olive", gx(8.5), -48, gz(1.5), RYm90, "on the far wedge brick (i8–9, j1–2)");
  // second socket (105), brackets for the dewclaw on the +z (free) face (106–107)
  m.put("3023", "olive", gx(-0.5), -56, gz(-2), I, "on the black 2x2, beside socket 2");
  m.put("67696", "dbg", 0, -64, 0, RY180, "ankle socket 2 on the 1x5 / 3x2 wedge");
  m.put("44728", "black", 0, -72, 10, RY180, "bracket on socket 2, 2x2 face → +z");
  m.put("99207", "dbg", 0, 0, 10, RY180, "inverted bracket under socket 1, 2x2 face → +z");
  const dc = mod("dc");
  dc.put("11458", "dbg", 0, 0, 0, I).put("11477", "olive", -10, 0, 0, RY90).put("61332", "black", 10, -6, 0, ori(Z, Y, nX)).put("53451", "black", 10, -6, -24, oriYZ(nZ, Y), "dewclaw");
  merge(m, dc, ori(nX, nZ, nY), [0, -42, 32]);
  // top of the ankle (108)
  m.put("50950", "dbg", gx(-1), -96, -10, I, "curved slopes run down from the ankle top toward the slab").put("11153", "olive", gx(0), -96, -20, I);
  // hip cap (109–118), c-frame centred on the hip axis
  merge(m, cap(), capR, HIP);
  m.put("3020", "dkgreen", gx(6.5), 0, gz(3.5), RY90, "under the slab-cap joint (118): wedge underside j1..2 to the inner ring");
  // shell over the hip (119)
  m.put("3020", "tan", gx(6.5), -56, gz(3.5), RY90, "from the knee's top plates (i6–7, j2..3) onto the outer ring (j5)").put("3022", "dbg", gx(6.5), -64, gz(4.5), I);
  m.put("4032a", "white", gx(6.5), -56, HIP[2] - 20, I, "on the outer ring");
  m.put("47753", "dkgreen", gx(6.5), -80, HIP[2] + 80, RY180, "shell, low end on the tan plate").put("47753", "dkgreen", gx(6.5), -80, HIP[2], I, "shell, low end on the white round plate");
  m.joints = { hip: [...HIP], ankle: [-36.4, -34, 0] };
  return m;
}
function cap() { // code cap of v2 (unchanged internals)
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
  return c;
}

// stand up: flat x (along the slab, ankle → knee) → forward (−X), flat −z (toward the hip) → up (−Y),
// flat y (inner face) → +Z (right leg on the −Z side); then pitched about Z by TILT degrees (+ = toes up: knee rises, hip moves back over the ankle).
const R0 = ori(nX, Z, Y);
const TILT = +(process.env.TILT ?? 5);
const STAND = mul(Rz(TILT), R0);
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

return { HIP, thighFlat, TILT, thighR, thighL, footR, footL };
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
  body: 40, head: -36, jaw: 35, tail: [-46, -6, -8, -12], armL: [100, 0, 0], armR: [115, 0, 0], thighL: -2, thighR: -11.3, footL: 0, footR: 0,
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
