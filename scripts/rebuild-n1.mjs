// Coarse N-1 rebuild (75325), from the instructions read: spine box + nose + one wing span + 2 axial nacelles.
import fs from "node:fs";
const I = [1,0,0,0,1,0,0,0,1], RY90 = [0,0,1,0,1,0,-1,0,0], RX90 = [1,0,0,0,0,-1,0,1,0], RXm90 = [1,0,0,0,0,1,0,-1,0];
const C = { lbg: 71, dbg: 72, black: 0, white: 15, tan: 19, red: 4, blo: 191, clear: 47, ti: 179, nougat: 84, tlb: 43 };
const L = [];
const put = (id, c, x, y, z, R = I, note) => { if (note) L.push(`0 // ${note}`); L.push(`1 ${C[c] ?? c} ${x} ${y} ${z} ${R.join(" ")} ${id}.dat`); };
// --- core: belly of inverted slopes, two white rails, two 2x12 spine plates
L.push("0 // CORE");
for (const x of [-30, -10, 10, 30]) put("42023", "lbg", x, 48, -40);
put("60219", "lbg", 0, 48, 20); put("29115", "dbg", 0, 48, 140);
for (const x of [-50, 50]) for (const z of [-60, 100]) put("3008", "white", x, 24, z, RY90);
for (const x of [-20, 20]) put("2445", "dbg", x, 16, -20, RY90);
put("47397", "dbg", -50, 16, -20); put("47398", "dbg", 50, 16, -20);
// outer belly skin over the rails (the rails are inside the hull)
for (const x of [-70, 70]) for (const z of [-40, 80]) put("42023", "lbg", x, 24, z);
// --- skin: curved 3x1 sides, the yellow stripe under the cockpit
L.push("0 // SKIN");
for (const x of [-70, 70]) for (const z of [-100, -40, 20, 80]) { put("70681", z === -40 ? "blo" : "lbg", x, -8, z); put("70681", "lbg", x, -32, z); }
// --- cockpit and Grogu's bubble
put("92279", "clear", 0, -8, 10); put("18990", "clear", 0, -8, -60);
// --- nose: wedge, twin bar plates, spear
L.push("0 // NOSE");
put("14181", "lbg", 0, 24, -230);
for (const x of [-20, 20]) put("42445", "black", x, 16, -260);
put("61406", "lbg", 0, 8, -380);
// --- wing span: 8x8 centre, 2x12 arms, wingtip pin bricks
L.push("0 // WING");
put("41948", "nougat", 0, 8, 140);
// covered on top: rear hump (curved 2x4s), the vent hatch, tiles
for (const x of [-40, 40]) for (const z of [110, 150]) put("87079", "dbg", x, 0, z, RY90);
put("3031", "black", 0, 0, 150); for (const z of [110, 190]) put("88930", "lbg", 0, -16, z);
for (const s of [-1, 1]) {
  for (const z of [120, 160]) { put("2445", "dbg", s * 200, 8, z); put("73109", "lbg", s * 330, -16, z); }
  // swept edges: wedge plates, a mirrored pair per side (the other side turned the other way)
  const R = s < 0 ? RY90 : [0,0,-1,0,1,0,1,0,0];
  put(s < 0 ? "47397" : "47398", "lbg", s * 200, 8, 70, R); // leading edge
  put(s < 0 ? "47398" : "47397", "lbg", s * 200, 8, 210, R); // trailing edge
}
// --- nacelles, built along their axle
L.push("0 // NACELLES");
for (const s of [-1, 1]) {
  const x = s * 390, y = -24;
  put("24482", "dbg", x, y, 16, RX90); put("3942c", "dbg", x, y, 20, RX90); put("60208", "lbg", x, y, 80);
  for (const [z, c] of [[120, "lbg"], [160, "dbg"], [200, "dbg"], [240, "lbg"], [280, "lbg"]]) put("41531", c, x, y, z);
  put("79850", "lbg", x, y, 316, RXm90);
}
// node scripts/rebuild-n1.mjs out.ldr   (see docs/engine/dna-n1.md)
fs.writeFileSync(process.argv[2], L.join("\n") + "\n");
console.log(L.filter((l) => l[0] === "1").length, "parts");
