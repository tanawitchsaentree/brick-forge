// Reference rebuild of the Triceratops, the first alternate build of LEGO 31058 "Mighty Dinosaurs"
// (booklet 6437438, steps 1–47), from the instructions read page by page (see docs/engine/dna-31058-alts.md).
// Every module is built in its own local frame, with its plug joint at the origin; the main model
// places the modules through their joints in the booklet's final pose. Writes an MPD, one FILE per module.
//
//   node scripts/rebuild-31058-trike.mjs [out.ldr]      (default data/golden/31058-trike.ldr)
//
// Frame: LDU, −Y up, head toward −X, the model's left side toward +Z. A plate/brick at y = Y has its top at Y.
import fs from "node:fs";

const C = { green: 2, dkgreen: 288, tan: 19, dktan: 28, dbg: 72, lbg: 71, black: 0, white: 15, dkred: 320, torange: 57, red: 4 };

// ---- 3×3 matrices (rows); ori(px, py, pz) = where the part's +X, +Y, +Z axes go in the parent frame
const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1], nX = [-1, 0, 0], nY = [0, -1, 0], nZ = [0, 0, -1];
const ori = (px, py, pz) => [0, 1, 2].map((r) => [px[r], py[r], pz[r]]);
const mul = (A, B) => A.map((r) => [0, 1, 2].map((c) => r[0] * B[0][c] + r[1] * B[1][c] + r[2] * B[2][c]));
const app = (A, v) => A.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const add = (a, b) => a.map((x, i) => x + b[i]);
const I = ori(X, Y, Z);
const RY90 = ori(nZ, Y, X); //   part +Z → +X, part −Z → −X (front)
const RYm90 = ori(Z, Y, nX); //  part −Z → +X (back)
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
// the other-hand copy (Z mirrored): each part re-placed as a proper rotation S·R·F, F a reflection the
// part is symmetric under (default: its own X); handed pairs swap ids.
const SWAP = { 41769: "41770", 41770: "41769", 43722: "43723", 43723: "43722" };
const SYM = { 92013: "z", 3021: "x", 41769: "x", 41770: "x", 43722: "x", 43723: "x" };
const F = { x: ori(nX, Y, Z), z: ori(X, Y, nZ) };
const S = ori(X, Y, nZ);
function mirror(m, name) {
  const n = mod(name);
  for (const q of m.parts) n.parts.push({ ...q, id: SWAP[q.id] ?? q.id, p: [q.p[0], q.p[1], -q.p[2]], R: mul(mul(S, q.R), F[SYM[q.id] ?? "x"]) });
  for (const k in m.joints) n.joints[k] = [m.joints[k][0], m.joints[k][1], -m.joints[k][2]];
  return n;
}

// =============== BODY (steps 1–13) — origin: top of the tan 2×4 belly plate
function body() {
  const m = mod("body");
  // 1–3: belly plate; inverted slopes widen it: green to the front, tan ×2 back to back to the sides, tan 3×2 to the back
  m.put("3020", "tan", 0, 0, 0, I, "belly plate 2x4");
  m.put("3660", "green", -30, -24, 0, RY90, "front, overhang forward");
  m.put("3660", "tan", 0, -24, -10, I, "right side").put("3660", "tan", 0, -24, 10, RY180, "left side");
  m.put("3747b", "tan", 30, -24, 0, RYm90, "rear, overhang back 2");
  m.put("3022", "green", 40, -32, 0).put("3023", "dkgreen", 70, -32, 0, RY90);
  // 4–5: two 3×3 round corners make a 6-wide deck, rounded at the rear corners; dark green 1×2 on the front studs
  m.put("30357", "green", -30, -32, 10, I, "left deck").put("30357", "green", -30, -32, -10, RY90, "right deck");
  m.put("3023", "dkgreen", -50, -32, 0, RY90);
  // 6–8: tan 2×4 brick spine, green inverted slope at the front, hip brick with the two 10.2 mm balls, side slopes
  m.put("3001", "tan", 0, -56, 0, I, "spine");
  m.put("3660", "green", -50, -56, 0, RY90, "on the dark green 1x2, overhang forward");
  m.put("17114", "dbg", 60, -56, 0, RY90, "hip balls");
  m.put("3040b", "green", -10, -56, 30, RY180).put("3040b", "green", -10, -56, -30, I);
  m.put("3023", "green", 40, -64, 10).put("3023", "green", 40, -64, -10);
  m.put("14417", "dbg", 70, -64, 0, RYm90, "tail ball");
  // 9: shoulders — technic bricks with a ball on a red axle between their beams, beams forward
  for (const z of [40, -40]) {
    m.put("85943", "dbg", -30, -56, z, RY90, "shoulder");
    m.put("32062", "red", -60, -46, z, RY90).put("53585", "black", -60, -46, z, ori(X, Z, nY), "shoulder ball");
  }
  // 10–11: dark green plates over shoulder + side slope, cheese slopes on the outer shoulder studs, dark green 1×4 spine
  m.put("3023", "dkgreen", -20, -64, 30).put("3023", "dkgreen", -20, -64, -30);
  m.put("54200", "green", -30, -56, 50, RY180).put("54200", "green", -30, -56, -50, I);
  m.put("3010", "dkgreen", -20, -80, 10).put("3010", "dkgreen", -20, -80, -10);
  // 12–13: neck ball pointing forward under a dark green 1×2; curved 6×4 back shell; curved 2×2 over the neck
  m.put("14417", "dbg", -70, -64, 0, RY90, "neck ball").put("3023", "dkgreen", -70, -72, 0, RY90);
  m.put("43712", "green", -40, -104, 0, RYm90, "back shell: 2x2 studs at the front, curving down to the tail");
  m.put("15068", "green", -80, -72, 0, RY90, "over the neck, curving down forward");
  m.joints = { neck: [-90, -60, 0], tail: [90, -60, 0], shL: [-60, -46, 40], shR: [-60, -46, -40], hipL: [60, -46, 40], hipR: [60, -46, -40] };
  return m;
}

// =============== TAIL 1 (steps 14–18) — origin: the side socket on the body's tail ball; runs along +X
function tail1() {
  const m = mod("tail-1");
  m.put("3020", "green", 40, 0, 0, I, "base");
  m.put("14417", "dbg", 70, -8, 0, RYm90, "ball for tail 2");
  m.put("3023", "dkgreen", 10, -8, 0, RY90).put("3023", "dkgreen", 40, -8, 10).put("3023", "dkgreen", 40, -8, -10);
  m.put("3022", "green", 20, -16, 0);
  m.put("14704", "lbg", 10, -24, 0, RY90, "socket, on the 2x2's front row");
  m.put("11153", "green", 40, -48, 10, RYm90, "high at the front").put("11153", "green", 40, -48, -10, RYm90);
  m.joints = { socket: [-10, -20, 0], next: [90, -4, 0] };
  return rebase(m, m.joints.socket);
}
// =============== TAIL 2 / tip (step 19) — origin: the end socket on tail 1's ball
function tail2() {
  const m = mod("tail-2");
  m.put("14418", "lbg", 30, -4, 0, RY180, "end socket at the front");
  m.put("3024", "green", 20, -12, 0).put("11477", "green", 30, -12, 0, RYm90, "tip, high at the front");
  return m;
}

// =============== LEGS (steps 21–24): slabs built flat, then hung down with their studs facing out (+Z)
// flat frame: x' along the leg (socket end at −x'), studs up (−y')
function hang(m, socket) {
  m.joints = { socket };
  turn(m, Rx(-90)); // studs (−y') → +Z
  turn(m, Rz(90)); //  −x' (socket end) → up
  return rebase(m, m.joints.socket);
}
function rearLeg() {
  const m = mod("rear-leg-l");
  m.put("3021", "tan", 0, 0, 0, I, "back of the leg");
  m.put("3004", "green", 20, -24, 0, RY90, "foot end").put("92013", "dkgreen", -10, -24, 0, RY180, "hip socket");
  m.put("43722", "dkgreen", 0, -32, 0, RYm90, "outer face, narrow end down");
  return hang(m, [-46, -14, 0]);
}
function frontLeg() {
  const m = mod("front-leg-l");
  m.put("41769", "green", 0, 0, 0, RYm90, "inner wedge, wide end down");
  m.put("3003", "green", 20, -24, 0, I, "foot end").put("92013", "dkgreen", -20, -24, 0, RY180, "shoulder socket");
  m.put("41769", "green", 0, -32, 0, RYm90, "outer wedge");
  return hang(m, [-56, -14, 0]);
}

// =============== HEAD (steps 25–39) — origin: the neck socket (side socket at the rear top)
function head() {
  const m = mod("head");
  // 25–28: green 2×4, under it tan 1×4 ×2 (one stud proud at the snout) and a tri-tooth plate at the back; dark green handles behind
  m.put("3020", "green", 0, 0, 0, I, "head base");
  m.put("3710", "tan", -20, 8, 10).put("3710", "tan", -20, 8, -10);
  m.put("15208", "white", 30, 8, 0, RYm90, "teeth under the back of the head");
  m.put("60478", "dkgreen", 20, -8, 10, I, "handle for the frill").put("60478", "dkgreen", 20, -8, -10, I, "handle for the frill");
  // 29–31: 2×2 brick, vertical clips, eye plates with pin holes (outboard, holes facing forward), tan snout bricks, neck socket
  m.put("3003", "green", -20, -24, 0);
  m.put("60897", "tan", 30, -16, -10, I).put("60897", "tan", 30, -16, 10, RY180);
  m.put("11458", "dbg", 10, -16, -20, RY90, "eye plate").put("11458", "dbg", 10, -16, 20, RYm90, "eye plate");
  m.put("26604", "tan", -50, -16, -10, RY90, "snout").put("26604", "tan", -50, -16, 10, RY180, "snout");
  m.put("3023", "dkred", 10, -24, 0, RY90).put("14704", "lbg", 30, -24, 0, RYm90, "neck socket, facing back");
  // 32: eyes on half pins
  for (const z of [-30, 30]) m.put("4274", "lbg", 0, -22, z, RY180).put("58176", "torange", -4, -22, z, ori(nY, X, Z), "eye");
  // 33–34: dark red plate, trans-orange studs, locking hinges at the back, cheese slopes on the snout's side studs
  m.put("3023", "dkred", -30, -32, 0, RY90).put("6141", "torange", -10, -32, 10).put("6141", "torange", -10, -32, -10);
  m.put("30383", "dbg", 20, -32, 10, I, "frill hinge, finger at the back").put("30383", "dbg", 20, -32, -10, I, "frill hinge");
  m.put("54200", "green", -50, -6, -20, ori(Y, Z, X), "cheek").put("54200", "green", -50, -6, 20, ori(nY, nZ, X), "cheek");
  // 35–39: wheel-arch brow from the snout bricks (low end) to the hinge plates (high end), over the eyes; beak plates and
  // curved 2×2 on the snout front; round 2×2 + nose horn on the arch's front studs; curved 2×2 on its back studs
  m.put("47755", "dkgreen", -20, -40, 0, RY90, "brow arch: low end on the tan snout bricks, high end on the hinge plates");
  const front = ori(Z, X, Y); // studs → −X
  m.put("3023", "green", -68, -6, 0, front, "beak").put("3023", "green", -76, -6, 0, front, "beak");
  m.put("15068", "green", -76, -16, 0, ori(Z, X, Y), "beak, curving back at the top");
  m.put("4032a", "dkgreen", -60, -32, 0).put("87747", "white", -60, -36, 0, ori(X, Y, Z), "nose horn");
  m.put("15068", "green", 0, -40, 0, RYm90);
  m.joints = { neck: [50, -20, 0], frill: [30, -36, 0] };
  return rebase(m, m.joints.neck);
}

// =============== FRILL (steps 40–45) — built flat (tan 2×6 along x, hinge edge toward +z), origin: the hinge axis
function frill() {
  const m = mod("frill");
  m.put("3795", "tan", 0, 0, 0, I, "frill core");
  m.put("44302a", "dbg", -10, -8, 0, RYm90, "hinge fingers on the head's 30383").put("44302a", "dbg", 10, -8, 0, RYm90, "hinge fingers");
  m.put("60897", "tan", -30, -8, 10, RY180, "horn clip").put("60897", "tan", 30, -8, 10, RY180, "horn clip");
  m.put("41770", "green", -80, -8, 0, RY90, "side wing").put("41769", "green", 80, -8, 0, RYm90, "side wing");
  m.put("30357", "green", -10, -16, 10, ori(nX, Y, nZ), "rounded at the outer top corner").put("30357", "green", 10, -16, 10, ori(nZ, Y, X));
  m.put("15208", "white", -20, -8, -30, I, "spikes on the rim").put("15208", "white", 20, -8, -30, I, "spikes on the rim");
  m.put("15208", "white", -90, 0, 0, RY90, "spikes").put("15208", "white", 90, 0, 0, RYm90, "spikes");
  for (const x of [-30, 30]) m.put("40379", "white", x, -8, 30, RY180, "brow horn, curving toward the rim");
  m.joints = { hinge: [0, -4, 30] };
  rebase(m, m.joints.hinge);
  // stand it up: frill x → head z, studs (−y) → forward (−X), hinge edge (+z) → down
  return turn(m, ori(Z, X, Y));
}

// =============== assembly in the booklet's final pose
const P = {
  headPitch: -6, frillBack: 45, // Rz: head slightly nose-down; frill leaning back over the neck
  tail: [-14, -10], // each tail segment's lift (negative = up for +X parts)
  frontL: 3, frontR: 3, rearL: -15, rearR: -15, // legs: swing about Z (positive = foot forward)
};
const M = {};
const place = (m, R, t) => (M[m.name] = { m, R, t });
const at = (name, j) => add(app(M[name].R, M[name].m.joints[j]), M[name].t);

place(body(), I, [0, 0, 0]);
const H = head(); place(H, Rz(P.headPitch), at("body", "neck"));
place(frill(), mul(M.head.R, Rz(P.frillBack)), at("head", "frill"));
place(tail1(), Rz(P.tail[0]), at("body", "tail"));
place(tail2(), mul(M["tail-1"].R, Rz(P.tail[1])), at("tail-1", "next"));
const FL = frontLeg(); place(FL, Rz(P.frontL), at("body", "shL"));
place(mirror(FL, "front-leg-r"), Rz(P.frontR), at("body", "shR"));
const RL = rearLeg(); place(RL, Rz(P.rearL), at("body", "hipL"));
place(mirror(RL, "rear-leg-r"), Rz(P.rearR), at("body", "hipR"));

// ---- write the MPD
const f = (v) => +v.toFixed(3);
const line = (c, p, R, file) => `1 ${c} ${p.map(f).join(" ")} ${R.flat().map(f).join(" ")} ${file}`;
const out = process.argv[2] ?? "data/golden/31058-trike.ldr";
const L = ["0 FILE 31058-trike.ldr", "0 LEGO 31058 Mighty Dinosaurs — Triceratops (reference rebuild, booklet 6437438)", "0 Name: 31058-trike.ldr", "0 Author: scripts/rebuild-31058-trike.mjs", ""];
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
