import { LDU_PER_STUD, PLATE_H } from "./units";
import { PARTS, footprint, partOrigin } from "./parts";
import type { PlacedBrick } from "./grid";
import { chain, partMatrix, scale, translate, type Mat4 } from "./pose";

const round = (v: number) => Math.round(v * 1000) / 1000 || 0;
// Tilted parts' rotations need more digits to stay rotations.
const round5 = (v: number) => Math.round(v * 1e5) / 1e5 || 0;

// LDraw is y-down; z is negated as well so the exported model is not mirrored.
// ROT_MATRIX[r] is our clockwise quarter turn r expressed in LDraw axes.
const ROT_MATRIX = [
  "1 0 0 0 1 0 0 0 1",
  "0 0 1 0 1 0 -1 0 0",
  "-1 0 0 0 1 0 0 0 -1",
  "0 0 -1 0 1 0 1 0 0",
];

/** Apply a placement (rotation r, position t) to a type-1 line; colour 16 becomes `color`. */
function composeLine(line: string, rot: number, t: [number, number, number], color: number): string {
  const tok = line.trim().split(/\s+/);
  const n = tok.slice(2, 14).map(Number);
  const R = ROT_MATRIX[rot].split(" ").map(Number);
  const M = n.slice(3, 12);
  const mul = (i: number, j: number) => R[i * 3] * M[j] + R[i * 3 + 1] * M[3 + j] + R[i * 3 + 2] * M[6 + j];
  const m = [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => round(mul(i, j))));
  const p = [0, 1, 2].map((i) => round(R[i * 3] * n[0] + R[i * 3 + 1] * n[1] + R[i * 3 + 2] * n[2] + t[i]));
  const c = tok[1] === "16" ? color : tok[1];
  return `1 ${c} ${p.join(" ")} ${m.join(" ")} ${tok.slice(14).join(" ")}`;
}

/**
 * A posed part as LDraw lines: its full transform, LDraw axes (y down, z
 * flipped) and units (20 LDU per stud) on both sides.
 */
function posedLines(b: PlacedBrick): string[] {
  const part = PARTS[b.partId];
  const [ox, oy, oz] = partOrigin(part);
  const M = chain(scale(LDU_PER_STUD, -LDU_PER_STUD, -LDU_PER_STUD), partMatrix(b), translate(ox, oy, oz), scale(1 / LDU_PER_STUD, -1 / LDU_PER_STUD, -1 / LDU_PER_STUD));
  const line = (m: Mat4, color: number | string, file: string) =>
    `1 ${color} ${[m[12], m[13], m[14]].map(round).join(" ")} ${[m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]].map(round5).join(" ")} ${file}`;
  if (!part.components) return [line(M, b.color, `${part.id}.dat`)];
  return part.components.map((l) => {
    const t = l.trim().split(/\s+/);
    const n = t.slice(2, 14).map(Number);
    const sub: Mat4 = [n[3], n[6], n[9], 0, n[4], n[7], n[10], 0, n[5], n[8], n[11], 0, n[0], n[1], n[2], 1];
    return line(chain(M, sub), t[1] === "16" ? b.color : t[1], t.slice(14).join(" "));
  });
}

/** Serialise a model as an .ldr file (opens in BrickLink Studio, LDCad, LeoCAD). */
export function toLDraw(bricks: PlacedBrick[], name = "model"): string {
  const lines = [
    `0 ${name}`,
    `0 Name: ${name}.ldr`,
    "0 Author: Brick Forge",
    "",
  ];
  // Bottom layer first, so the file doubles as rough build order.
  const sorted = [...bricks].sort((a, b) => a.y - b.y);
  for (const b of sorted) lines.push(...partLines(b));
  return withMadeParts(lines, bricks, name);
}

/** One placed part as LDraw type-1 lines (several for a composite such as a person). */
export function partLines(b: PlacedBrick): string[] {
  if (b.pose || b.place) return posedLines(b);
  const lines: string[] = [];
  {
    const part = PARTS[b.partId];
    const { w, d } = footprint(part, b.rot);
    // Part origin relative to the footprint centre, turned like the part (-rot × 90° about y).
    const [ox, oy, oz] = partOrigin(part);
    const lx = ox - part.w / 2;
    const lz = oz - part.d / 2;
    const a = (-b.rot * Math.PI) / 2;
    const rx = lx * Math.cos(a) + lz * Math.sin(a);
    const rz = -lx * Math.sin(a) + lz * Math.cos(a);
    const x = round((b.x + w / 2 + rx) * LDU_PER_STUD);
    const y = round(-(b.y * PLATE_H + oy) * LDU_PER_STUD);
    const z = round(-(b.z + d / 2 + rz) * LDU_PER_STUD);
    if (part.components) {
      // Composite (a person): emit its real parts so other LDraw tools can open the file.
      for (const line of part.components) lines.push(composeLine(line, b.rot, [x, y, z], b.color));
    } else {
      lines.push(`1 ${b.color} ${x} ${y} ${z} ${ROT_MATRIX[b.rot]} ${part.id}.dat`);
    }
  }
  return lines;
}

/**
 * Parts made from a model's own geometry travel with the file: the lines
 * become the MPD's first file (unless they already start one) and each made
 * part follows as its own FILE.
 */
export function withMadeParts(lines: string[], bricks: PlacedBrick[], name: string): string {
  const made = [...new Set(bricks.map((b) => PARTS[b.partId]).filter((p) => p.made))];
  if (made.length) {
    if (!/^0\s+FILE/i.test(lines[0] ?? "")) lines.unshift(`0 FILE ${name}.ldr`);
    for (const p of made)
      lines.push("0 NOFILE", ...(/^0\s+FILE/i.test(p.made!) ? [p.made!] : [`0 FILE ${p.id}.dat`, `0 ${p.name}`, `0 Name: ${p.id}.dat`, p.made!]));
  }
  return lines.join("\n") + "\n";
}
