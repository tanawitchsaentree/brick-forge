import { PARTS } from "./parts";

// What a part is for (program v2 T1, source S1: its LDraw name and category).
// A part can have several roles (a 1×1 brick with a headlight is a SNOT bracket
// and a light). Roles are a closed vocabulary; extend it only with evidence.

export const ROLES = [
  // feature: what makes a subject read as itself
  "window", "windscreen", "door", "wheel", "tyre", "light", "grille", "eye", "tooth", "claw", "horn", "antenna", "plant", "figure",
  // connector: how things attach and pose
  "hinge", "clip", "bar", "pin", "axle", "ball", "socket", "bracket-snot", "jumper", "turntable",
  // surface: the skin
  "tile", "slope", "curved", "wedge", "arch", "inverted",
  // structure: the body
  "brick", "plate", "round",
] as const;
export type Role = (typeof ROLES)[number];

const RULES: [Role, RegExp, "name" | "category"][] = [
  ["window", /^(Window|Glass)/, "category"],
  ["window", /\bWindow\b|^Glass for/i, "name"],
  ["windscreen", /^Windscreen/, "category"],
  ["windscreen", /\bWindscreen\b/i, "name"],
  ["door", /^Door/, "category"],
  ["door", /\bDoor\b(?! Rail)/i, "name"],
  ["wheel", /^Wheel/, "category"],
  ["wheel", /^Wheel\b/i, "name"],
  ["tyre", /^(Tyre|Tire)/i, "name"],
  ["light", /Headlight|\bLight\b|Lamp/i, "name"],
  ["grille", /Grille/i, "name"],
  ["eye", /\bEye\b/i, "name"],
  ["tooth", /\bTooth\b|\bTeeth\b/i, "name"],
  ["claw", /\bClaw\b/i, "name"],
  ["horn", /\bHorn\b/i, "name"],
  ["antenna", /Antenna|Aerial/i, "name"],
  ["plant", /^(Plant|Flower)/i, "name"],
  ["figure", /^(Minifig|Figure)/i, "name"],
  ["hinge", /\bHinge\b/i, "name"],
  ["clip", /\bClips?\b/i, "name"],
  ["bar", /\bBar\b|Handle/i, "name"],
  ["pin", /\bPin\b/i, "name"],
  ["axle", /\bAxle\b/i, "name"],
  ["ball", /\bBall\b|Tow Ball/i, "name"],
  ["socket", /\bSocket\b/i, "name"],
  ["bracket-snot", /Bracket|Studs? on (\d )?Sides?|Headlight|with Stud on/i, "name"],
  ["jumper", /1 Centre Stud|Jumper/i, "name"],
  ["turntable", /Turntable/i, "name"],
  ["tile", /^Tile/, "category"],
  ["tile", /^Tile\b/i, "name"],
  ["slope", /^Slope/, "category"],
  ["curved", /Curved/i, "name"],
  ["wedge", /^Wedge|\bWedge\b/i, "name"],
  ["arch", /^Arch|\bArch\b/i, "name"],
  ["inverted", /Inverted/i, "name"],
  ["brick", /^Brick/, "category"],
  ["plate", /^Plate/, "category"],
  ["round", /\bRound\b|Cylinder|Cone|Dish/i, "name"],
];

const cache = new Map<string, Role[]>();

export function rolesOf(id: string): Role[] {
  const hit = cache.get(id);
  if (hit) return hit;
  const p = PARTS[id];
  const out: Role[] = [];
  if (p)
    for (const [role, re, field] of RULES)
      if (re.test(field === "name" ? p.name : p.category) && !out.includes(role)) out.push(role);
  cache.set(id, out);
  return out;
}

export const hasRole = (id: string, r: Role) => rolesOf(id).includes(r);
