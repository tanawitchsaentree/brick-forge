import { Builder, RIDGE, type Pool } from "./pool";
import { dinosaur, SPECIES, type Plan, type Species } from "./dino";
import { rng } from "../generate/math";

// Assembly Grammar: an object is a sequence of modules, a module is a few
// purposeful parts. Nothing is filled solid — walls are walls, a car is a tub
// on a chassis — so designs stay lean, and each part is chosen for its job:
// slopes shape, tiles finish, grilles and headlights detail, SNOT bricks
// carry eyes. Proportions follow simple rules (golden sections for axles,
// running bond for walls, one stud of overhang per course for roofs).
//
// Size (0 small, 1 medium, 2 large) stretches lengths; detail (0 easy … 2
// hard) adds finishing modules; the seed picks colours and nudges
// proportions by a stud or two, so no two designs on a page match. Coordinates: x right, z toward the viewer,
// y up in plates; vehicles and animals face +x.

import type { Kind } from "./kinds";
export { KINDS, type Kind } from "./kinds";

export interface Palette {
  main: number;
  accent: number;
  dark: number;
  light: number;
  glass: number;
  lamp: number;
}

export interface Design {
  b: Builder;
  /** Posed sections (a dinosaur's tail, legs, head…), each on its own grid. */
  sections?: Builder[];
  species?: Species;
  title: string;
  rule: string; // the proportions / grammar used, shown on the card
}

const TRANS_CLEAR = 47, TRANS_RED = 36;
const WHITE = 15, BLACK = 0, LBG = 71, DBG = 72, TAN = 19, GREEN = 2, BROWN = 70, RED = 4, DARK_RED = 320;

const pickOf = <T,>(r: () => number, xs: T[]) => xs[Math.floor(r() * xs.length)];

/** Colour schemes per kind; in mine mode the main colour is the one the user owns most of. */
function scheme(kind: Kind, r: () => number, owned: number[]): Palette {
  const mains: Record<Kind, number[]> = {
    racer: [RED, 1, 14, 25, 2, BLACK],
    car: [1, RED, 14, 73, WHITE, 25],
    house: [WHITE, TAN, RED, 14, 73],
    dino: [GREEN, 288, 25, 378, 28],
    robot: [LBG, 1, 14, RED, WHITE, 73],
    rocket: [WHITE, LBG, RED],
  };
  const pool = owned.filter((c) => mains[kind].includes(c));
  const main = pool.length ? pool[0] : pickOf(r, mains[kind]);
  const accentFor: Record<Kind, number[]> = {
    racer: [WHITE, 14, BLACK, DBG],
    car: [WHITE, BLACK, DBG],
    house: [DARK_RED, DBG, 1, BROWN],
    dino: [TAN, 14, WHITE, 28],
    robot: [1, RED, 14, 25],
    rocket: [RED, 1, 25],
  };
  const accent = pickOf(r, accentFor[kind].filter((c) => c !== main));
  return { main, accent, dark: kind === "house" ? DBG : BLACK, light: kind === "dino" ? WHITE : LBG, glass: TRANS_CLEAR, lamp: TRANS_RED };
}

// ------------------------------------------------------------------ racer

function racer(b: Builder, size: number, detail: number, pal: Palette, r: () => number): Design {
  const W = 4, L = [12, 16, 20][size] + pickOf(r, [0, 2]);
  const axR = Math.round(L * 0.191), axF = Math.round(L * 0.809) - 1; // golden sections
  const c0 = Math.round(L * 0.42), c1 = c0 + 2; // cockpit
  const n0 = Math.round(L * 0.66); // nose begins
  b.module("Axles", () => {
    b.put("lb-axle-4", axR, 0, 0, 1, WHITE);
    b.put("lb-axle-4", axF, 0, 0, 1, WHITE);
  });
  b.module("Chassis", () => b.rect("plate", 0, 0, L, W, 3, pal.dark));
  b.module("Driver", () => b.put("lb-driver", c0, 4, 1, 3, pal.accent));
  b.module("Tub", () => {
    b.rect("brick", 0, 0, 2, W, 4, pal.main); // engine block at the tail
    b.run("brick", 2, 0, n0 - 2, true, 4, pal.main); // sidepods
    b.run("brick", 2, W - 1, n0 - 2, true, 4, pal.main);
    b.rect("brick", 2, 1, c0 - 2, 2, 4, pal.accent); // engine cover
    b.rect("brick", c1, 1, L - 2 - c1, 2, 4, pal.main); // nose
    b.put("3039", L - 2, 4, 1, 3, pal.main); // nose tip slope, facing forward
  });
  b.module("Front wing", () => {
    b.rect("tile", n0, 0, L - n0, 1, 4, pal.accent);
    b.rect("tile", n0, W - 1, L - n0, 1, 4, pal.accent);
  });
  if (detail >= 1)
    b.module("Windscreen", () => b.put(["81911", "30841", "3823"], c1, 7, 0, 3, pal.glass));
  b.module("Rear wing", () => {
    b.put("3062b", 0, 7, 0, 0, pal.dark);
    b.put("3062b", 0, 7, W - 1, 0, pal.dark);
    b.rect("plate", 0, 0, 2, W, 10, pal.accent);
    if (detail >= 1) b.rect("tile", 0, 0, 2, W, 11, pal.accent);
  });
  if (detail >= 1)
    b.module("Sidepod grilles", () => {
      for (let x = 2; x + 1 < c0; x += 2) {
        b.put("2412b", x, 7, 0, 0, pal.dark);
        b.put("2412b", x, 7, W - 1, 0, pal.dark);
      }
    });
  if (detail >= 1)
    b.module("Exhausts", () => {
      b.put("4589", 2, 7, 1, 0, LBG);
      b.put("4589", 2, 7, 2, 0, LBG);
    });
  if (detail >= 2)
    b.module("Finish", () => {
      b.rect("tile", 3, 1, c0 - 3, 2, 7, pal.accent);
      b.rect("tile", c1 + 2, 1, L - 4 - c1, 2, 7, pal.main);
    });
  return { b, title: L >= 20 ? "Grand Prix Racer" : "Race Car", rule: `L=${L}, W=4 · axles at 0.191L, 0.809L · cockpit at 0.42L · nose from 0.66L` };
}

// -------------------------------------------------------------------- car

function car(b: Builder, size: number, detail: number, pal: Palette, r: () => number): Design {
  const W = 4, L = [8, 10, 12][size] + pickOf(r, [0, 2]);
  const ws = L - 4; // windscreen at the front of the cabin
  const winX = Math.max(1, ws - 2);
  b.module("Axles", () => {
    b.put("lb-axle-4", 1, 0, 0, 1, WHITE);
    b.put("lb-axle-4", L - 2, 0, 0, 1, WHITE);
  });
  b.module("Chassis", () => b.rect("plate", 0, 0, L, W, 3, pal.dark));
  b.module("Front", () => {
    b.put(["4070", "87087"], L - 1, 4, 0, 3, pal.main); // headlights look forward (+x)
    b.put(["4070", "87087"], L - 1, 4, W - 1, 3, pal.main);
    b.run("brick", L - 1, 1, 2, false, 4, pal.main);
    if (detail >= 1) b.put("2412b", L - 1, 7, 1, 1, LBG);
    b.rect(detail >= 1 ? "tile" : "plate", L - 2, 0, 2, W, 7, pal.main); // bonnet
  });
  b.module("Body", () => {
    b.run("brick", 1, 0, L - 2, true, 4, pal.main);
    b.run("brick", 1, W - 1, L - 2, true, 4, pal.main);
    b.run("brick", 0, 0, W, false, 4, pal.main);
  });
  b.module("Cabin", () => {
    b.put(["3823", "4594"], ws, 7, 0, 3, pal.glass);
    b.put("lb-window", winX, 7, W - 1, 0, WHITE);
    b.put("lb-window", winX, 7, 0, 2, WHITE);
    for (const y of [7, 10]) {
      b.run("brick", 0, 0, W, false, y, pal.main);
      if (winX > 1) {
        b.run("brick", 1, 0, winX - 1, true, y, pal.main);
        b.run("brick", 1, W - 1, winX - 1, true, y, pal.main);
      }
    }
  });
  b.module("Roof", () => {
    b.rect("plate", 0, 0, ws, W, 13, pal.accent);
    if (detail >= 2) {
      // Roof lights first; the tiles then finish around them.
      b.put("98138", 0, 14, 0, 0, pal.lamp);
      b.put("98138", 0, 14, W - 1, 0, pal.lamp);
    }
    if (detail >= 1) b.rect("tile", 0, 0, ws, W, 14, pal.accent);
  });
  return { b, title: "City Car", rule: `L=${L}, W=4 · axles at the ends · windscreen 4 from the nose · cabin 2 bricks + roof` };
}

// ------------------------------------------------------------------ house

function house(b: Builder, size: number, detail: number, pal: Palette, r: () => number): Design {
  const W = [6, 8, 10][size] + pickOf(r, [0, 2]), D = [6, 6, 8][size], m = 2;
  const x0 = m, z0 = m, xs = x0 + W - 1, zf = z0 + D - 1;
  const rows = 4;
  const door = x0 + Math.floor(W / 2) - 1;
  // Openings: {wall, start, rows}, windows two courses high from course 1.
  const windows: { x: number; z: number; rot: 0 | 1 | 2 | 3 }[] = [];
  if (W >= 8) windows.push({ x: x0 + 1, z: zf, rot: 0 }, { x: xs - 2, z: zf, rot: 0 });
  windows.push({ x: x0 + Math.floor(W / 2) - 1, z: z0, rot: 2 });
  if (D >= 6) windows.push({ x: x0, z: z0 + Math.floor(D / 2) - 1, rot: 1 }, { x: xs, z: z0 + Math.floor(D / 2) - 1, rot: 3 });
  b.module("Garden base", () => b.rect("plate", 0, 0, W + 2 * m, D + 2 * m, 0, GREEN));
  b.module("Windows", () => windows.forEach((w) => b.put("lb-window", w.x, 4, w.z, w.rot, WHITE)));
  b.module("Walls", () => {
    for (let c = 0; c < rows; c++) {
      const y = 1 + 3 * c;
      // Corner bond: front/back courses own the corners on even courses, the sides on odd ones.
      const ownX = c % 2 === 0;
      const shift = c % 2 ? 2 : 0;
      const front = (from: number, to: number, z: number) => {
        for (let x = from; x <= to; ) {
          // Leave the doorway open on the two lowest courses.
          if (z === zf && c < 2 && x === door) {
            x += 2;
            continue;
          }
          let end = x;
          while (end + 1 <= to && !(z === zf && c < 2 && end + 1 === door)) end++;
          b.run("brick", x, z, end - x + 1, true, y, pal.main, shift);
          x = end + 1;
        }
      };
      front(ownX ? x0 : x0 + 1, ownX ? xs : xs - 1, zf);
      front(ownX ? x0 : x0 + 1, ownX ? xs : xs - 1, z0);
      b.run("brick", x0, ownX ? z0 + 1 : z0, ownX ? D - 2 : D, false, y, pal.main, shift);
      b.run("brick", xs, ownX ? z0 + 1 : z0, ownX ? D - 2 : D, false, y, pal.main, shift);
    }
  });
  b.module("Roof", () => {
    const top = 1 + 3 * rows;
    const courses = D / 2 - 1;
    for (let k = 0; k < courses; k++) {
      b.slopes(x0, zf - 1 - k, W, top + 3 * k, "+z", pal.accent);
      b.slopes(x0, z0 + k, W, top + 3 * k, "-z", pal.accent);
    }
    const ridgeZ = z0 + D / 2 - 1;
    for (let x = x0; x < x0 + W; x += 2) b.put(x + 1 < x0 + W ? RIDGE[2] : RIDGE[1], x, top + 3 * courses, ridgeZ, 0, pal.accent);
  });
  if (detail >= 1)
    b.module("Path", () => {
      b.put("3068b", door, 1, zf + 1, 0, TAN);
    });
  if (detail >= 1)
    b.module("Flowers", () => {
      const colors = [RED, 14, 1, 13 /* pink */, WHITE];
      for (let x = 0; x < W + 2 * m; x += 2)
        if (Math.abs(x - door) > 1 && b.put("6141", x, 1, zf + 1 + (x % 4 === 0 ? 1 : 0), 0, GREEN))
          b.put("3742", x, 2, zf + 1 + (x % 4 === 0 ? 1 : 0), 0, pickOf(r, colors));
    });
  if (detail >= 2)
    b.module("Tree", () => {
      const tx = W + 2 * m - 2, tz = 0;
      b.put("3941", tx, 1, tz, 0, BROWN);
      b.put("3941", tx, 4, tz, 0, BROWN);
      b.put(["3942c", "3942b"], tx, 7, tz, 0, GREEN);
    });
  return { b, title: W >= 10 ? "Family House" : "Cottage", rule: `${W}×${D} · ${rows} courses in running + corner bond · roof steps 1 stud per course · ridge of double slopes` };
}

// ------------------------------------------------------------------ robot

function robot(b: Builder, size: number, detail: number, pal: Palette, r: () => number): Design {
  const legs = [1, 2, 2][size] + pickOf(r, [0, 0, 1]), torso = [2, 2, 3][size] + pickOf(r, [0, 1]);
  const ty = 1 + 3 * legs; // hips
  b.module("Feet", () => {
    b.put("3020", 0, 0, 0, 1, pal.dark);
    b.put("3020", 4, 0, 0, 1, pal.dark);
  });
  b.module("Legs", () => {
    for (let i = 0; i < legs; i++) for (const x of [0, 4]) b.put("3003", x, 1 + 3 * i, 1, 0, pal.accent);
  });
  b.module("Torso", () => {
    b.rect("plate", 0, 0, 6, 4, ty, pal.dark);
    for (let i = 0; i < torso; i++) {
      const y = ty + 1 + 3 * i;
      if (i === 0) b.run("brick", 1, 3, 4, true, y, pal.accent); // chest panel
      b.rect("brick", 0, 0, 6, 4, y, pal.main, i % 2 === 0);
    }
  });
  const sy = ty + 1 + 3 * torso; // shoulders
  b.module("Arms", () => {
    b.put("3034", -1, sy, 1, 0, pal.dark); // 2×8 across the shoulders, one stud out each side
    b.rect("plate", 0, 0, 6, 1, sy, pal.dark);
    b.rect("plate", 0, 3, 6, 1, sy, pal.dark);
    for (const x of [-1, 6]) {
      b.put("3004", x, sy - 3, 1, 1, pal.main);
      b.put("3062b", x, sy - 6, 1, 0, pal.dark);
    }
  });
  b.module("Head", () => {
    b.put("3941", 2, sy + 1, 1, 0, pal.dark); // neck
    b.put("lb-eye-big", 1, sy + 4, 3, 0, pal.main);
    b.put("lb-eye-big", 4, sy + 4, 3, 0, pal.main);
    b.put("3004", 2, sy + 4, 3, 0, BLACK); // mouth
    b.rect("brick", 1, 0, 4, 4, sy + 4, pal.main);
    b.rect("plate", 1, 0, 4, 4, sy + 7, pal.accent);
    b.put("3957a", 2, sy + 8, 1, 0, BLACK);
    if (detail >= 1) b.rect("tile", 1, 0, 4, 4, sy + 8, pal.accent);
  });
  if (detail >= 2)
    b.module("Details", () => {
      b.put("2412b", 1, sy + 1, 3, 0, LBG);
      b.put("6141", 4, sy + 1, 3, 0, RED);
    });
  return { b, title: torso > 2 ? "Mega Bot" : "Robot", rule: `legs ${legs} : torso ${torso} : head 1 brick · arms hang from the shoulder plate` };
}

// ----------------------------------------------------------------- rocket

function rocket(b: Builder, size: number, detail: number, pal: Palette, r: () => number): Design {
  const stages = [3, 5, 7][size] + pickOf(r, [0, 1]);
  b.module("Launch pad", () => b.rect("plate", 0, 0, 4, 4, 0, LBG));
  b.module("Fins", () => {
    b.put("3040", 0, 1, 1, 0, pal.accent);
    b.put("3040", 3, 1, 1, 2, pal.accent);
    b.put("3040", 1, 1, 0, 1, pal.accent);
    b.put("3040", 1, 1, 3, 3, pal.accent);
  });
  b.module("Core", () => {
    for (let i = 0; i < stages; i++) {
      const window = i === stages - 2;
      b.put(["3941", "6143"], 1, 1 + 3 * i, 1, 0, window ? 43 /* trans light blue */ : i % 2 ? pal.accent : pal.main);
    }
  });
  if (detail >= 1)
    b.module("Boosters", () => {
      for (const [x, z] of [[0, 0], [3, 0], [0, 3], [3, 3]]) {
        b.put("3062b", x, 1, z, 0, pal.main);
        b.put("3062b", x, 4, z, 0, pal.main);
        b.put("4589", x, 7, z, 0, pal.accent);
      }
    });
  b.module("Nose cone", () => b.put(["3942c", "3942b"], 1, 1 + 3 * stages, 1, 0, pal.accent));
  return { b, title: stages > 5 ? "Moon Rocket" : "Rocket", rule: `${stages} round stages · 4 fins at the base · window band one below the nose` };
}

// --------------------------------------------------------------- dispatch


export function design(kind: Kind, pool: Pool, size: number, detail: number, seed: number, owned: number[], species?: Species, plan?: Plan): Design {
  const r = rng(seed * 2654435761 + kind.length);
  if (kind === "dino") {
    // A different species per seed, unless one was asked for.
    const sp = species ?? SPECIES[((seed % SPECIES.length) + SPECIES.length) % SPECIES.length].id;
    const d = dinosaur(sp, pool, size, detail, r, plan);
    return { b: d.root, sections: d.sections, title: d.title, rule: d.rule, species: sp };
  }
  const pal = scheme(kind, r, owned);
  const b = new Builder(pool);
  switch (kind) {
    case "racer": return racer(b, size, detail, pal, r);
    case "car": return car(b, size, detail, pal, r);
    case "house": return house(b, size, detail, pal, r);
    case "robot": return robot(b, size, detail, pal, r);
    case "rocket": return rocket(b, size, detail, pal, r);
  }
}
