import { Builder, type Pool } from "./pool";
import { IDENTITY, rotX } from "../pose";
import { PLATE_H } from "../units";
import type { Part } from "./pool";

// Open-wheel race cars, from a study of LEGO Speed Champions 77244 (see
// docs/knowledge/77244-f1.md). One architecture, as LEGO uses it for the
// whole 2024 range, with proportions as ratios of the length and a livery:
//
//   floor + Technic axle lines → tub (4 wide) → sidepods (body 8 wide)
//   → engine cover → nose → front wing (10 wide) → rear wing on a pillar
//   → cockpit: driver on a jumper (centred on a 4-wide tub), halo on two
//     jumpers, airbox behind the head → wheels outside the body on axles.
//
// Grid: the car faces +x (nose at x = L − 1, tail at x = 0), z across with
// the centre line at z = 0, y up in plates. The axles are 2 plates above the
// ground, so the tub's floor is at y = 2 and the wheels stand on the baseplate.

export interface F1Plan {
  L: number; // overall length, studs (77244: 21)
  frontAxle: number; // wheel centre, studs from the nose (6)
  rearAxle: number; // wheel centre, studs from the tail (3)
  cockpit: number; // driver, as a fraction of L from the tail (0.55)
  podH: number; // sidepod height above the body plate, plates (4)
  coverRise: number; // airbox top over the tub, plates (3)
  rearWingY: number; // rear wing plate, plates above the ground (12)
  frontWing: number; // front wing half-span, studs (5)
  rearWing: number; // rear wing half-span, studs (4)
  livery: number; // index into LIVERIES
}

export const F1_ANCHOR = (size: number): F1Plan => ({
  L: [17, 21, 25][size],
  frontAxle: [5, 6, 7][size],
  rearAxle: 3,
  cockpit: 0.55,
  podH: 4,
  coverRise: 3,
  rearWingY: 12,
  frontWing: 5,
  rearWing: 4,
  livery: 0,
});

/** Team-style liveries (main, accent, detail; floor in accent like the booklet's teal plank). */
export const LIVERIES: { name: string; main: number; accent: number; detail: number }[] = [
  { name: "Black & teal", main: 0, accent: 3, detail: 4 },
  { name: "Racing red", main: 4, accent: 15, detail: 0 },
  { name: "Navy & red", main: 272, accent: 4, detail: 14 },
  { name: "Papaya", main: 25, accent: 0, detail: 322 },
  { name: "Racing green", main: 288, accent: 27, detail: 0 },
  { name: "Blue & pink", main: 1, accent: 13, detail: 15 },
  { name: "Navy & sky", main: 272, accent: 15, detail: 321 },
  { name: "Black & lime", main: 0, accent: 10, detail: 15 },
  { name: "White & red", main: 15, accent: 0, detail: 4 },
  { name: "White & blue", main: 15, accent: 1, detail: 4 },
];

const AXLE = "lb-axle-f1";
const DRIVER = "lb-driver";
const JUMPER = "3794b"; // Plate 1×2 with 1 centre stud: half-stud offset
const ARCH = "3659"; // Arch 1×4: the halo
const WING_R = "41769a", WING_L = "41770a"; // Wing 2×4 right / left
const CURVED_1x2 = "11477", CURVED_4x1 = "61678", CHEESE_1x2 = "85984";
const SLOPE_2x2 = "3039", ROUND_1x1 = "6141";
const SIDE_STUDS = "52107", TILE_1x2 = "3069b";
const SLOPE_45_2x1 = "3040"; // end plates: a slope, not a brick standing on the tip // Brick 1×2 with studs on sides; the tile it carries

export interface F1Design {
  b: Builder;
  title: string;
  rule: string;
}

/** Put a part and give it a joint id (a part held off-grid by it, e.g. the halo on a jumper). */
function putTagged(b: Builder, id: string, x: number, y: number, z: number, rot: 0 | 1 | 2 | 3, color: number, joint: string) {
  if (!b.put(id, x, y, z, rot, color)) return false;
  (b.parts[b.parts.length - 1] as Part).joints = [joint];
  return true;
}

export function f1Car(pool: Pool, size: number, detail: number, plan: F1Plan): F1Design {
  const b = new Builder(pool);
  const P = plan;
  const liv = LIVERIES[((P.livery % LIVERIES.length) + LIVERIES.length) % LIVERIES.length];
  const L = P.L;
  const R = P.rearAxle; // rear wheel centre x
  const F = L - P.frontAxle; // front wheel centre x
  const ck = Math.round(P.cockpit * L); // driver column
  const BODY = 5; // the bonding plate over the axles
  const top = BODY + 4; // tub top: 3 plates of tub sides over the body plate, then tiles
  const plate = (x: number, z: number, w: number, d: number, y: number, c: number) => b.rect("plate", x, z, w, d, y, c);

  const p0 = R + 2, p1 = F - 2; // sidepods: clear of both wheels (Ø3)
  const podLen = p1 - p0;

  // 1 · Floor and axle lines: Technic bricks on the axle lines (the composite
  // carries the 10L axle and both wheels), an accent plank between them, two
  // plates of tub, then one plate over everything that ties it together —
  // 8 wide where the sidepods will stand (their floor), 4 wide elsewhere.
  b.module("Floor and axles", () => {
    b.put(AXLE, R - 1, 0, -1, 0, 0);
    b.put(AXLE, F - 1, 0, -1, 0, 0);
    plate(1, -2, F + 1, 4, 2, liv.accent); // plank (underside livery)
    plate(1, -2, F + 1, 4, 3, liv.main);
    plate(1, -2, F + 1, 4, 4, liv.main);
    if (podLen >= 3) plate(p0, -4, podLen, 8, BODY, liv.main);
    plate(0, -2, L, 4, BODY, liv.main);
  });

  // 2 · Tub and cockpit: the 4-wide spine from the tail to the front axle, the
  // middle open at the cockpit; the driver sits on a jumper, so a 1-wide seat
  // is on the centre line of a 4-wide car — the booklet's half-stud trick.
  b.module("Cockpit", () => {
    // One course of bricks (3 plates): the walls were three layers of long plates,
    // a third of the car's parts for what one brick course does.
    b.rect("brick", 0, -2, F + 1, 1, BODY + 1, liv.main);
    b.rect("brick", 0, 1, F + 1, 1, BODY + 1, liv.main);
    b.rect("brick", 0, -1, ck, 2, BODY + 1, liv.main);
    b.rect("brick", ck + 2, -1, F + 1 - (ck + 2), 2, BODY + 1, liv.main);
    putTagged(b, JUMPER, ck, BODY + 1, -1, 1, 0, "seat");
    // Seat brick from BODY + 2; its top (the LDraw origin) 3 plates up.
    b.exact(DRIVER, [ck + 0.5, (BODY + 5) * PLATE_H, 0], IDENTITY, liv.accent, { joints: ["seat"] });
    b.block(ck, BODY + 2, -1, 2, 3, 2);
    // The tub's top: deck behind and in front, cockpit rims, and at the halo's
    // two feet a jumper each (detail ≥ 1) between 1×1 plates.
    plate(0, -2, ck - 1, 4, top, liv.main);
    for (const x of [ck - 1, ck + 2]) {
      if (detail >= 1) putTagged(b, JUMPER, x, top, -1, 1, 0, x < ck ? "halo-back" : "halo-front");
      else plate(x, -1, 1, 2, top, liv.main);
      plate(x, -2, 1, 1, top, liv.main);
      plate(x, 1, 1, 1, top, liv.main);
    }
    plate(ck, -2, 2, 1, top, liv.accent);
    plate(ck, 1, 2, 1, top, liv.accent);
    plate(ck + 3, -2, F + 1 - (ck + 3), 4, top, liv.main);
    // In front of the cockpit the deck is smooth (tiles), as in the booklet.
    b.rect("tile", ck + 3, -2, F + 1 - (ck + 3), 4, top + 1, liv.main);
  });

  // 3 · Nose: two studs wide, falling from the tub to the tip, an accent stripe on top.
  b.module("Nose", () => {
    // Closed underneath down to the wing's level (it was open from the front axle to the wing).
    plate(F + 1, -1, L - 3 - F, 2, 3, liv.main);
    plate(F + 1, -1, L - 3 - F, 2, 4, liv.main);
    plate(F + 1, -1, L - 4 - F, 2, BODY + 1, liv.main);
    plate(F + 1, -1, L - 4 - F, 2, BODY + 2, liv.accent);
    b.rect("tile", F + 1, -1, L - 4 - F, 2, BODY + 3, liv.accent);
    b.put(CURVED_1x2, L - 3, BODY + 1, -1, 3, liv.main);
    b.put(CURVED_1x2, L - 3, BODY + 1, 0, 3, liv.main);
  });

  // 4 · Sidepods on that floor, open underneath like the real undercut. The
  // outer wall is bricks with studs on their sides (52107) carrying tiles
  // turned outward — the booklet's smooth, sticker-ready flanks — the inner
  // wall plain bricks; rounded tops fall outward, an intake faces forward.
  if (podLen >= 3)
    b.module("Sidepods", () => {
      const y0 = BODY + 1;
      let n = 0;
      for (const [outer, inner, face] of [[-4, -3, -1], [3, 2, 1]] as const) {
        for (let x = p0; x < p1; x += 2) {
          if (x + 1 < p1) {
            const jid = `pod${n++}`;
            if (putTagged(b, SIDE_STUDS, x, y0, outer, 0, liv.main, jid))
              // Tile 1×2 on the two side studs (10 LDU under the brick's top), its face turned out.
              b.exact(TILE_1x2, [x + 1, (y0 + 3) * PLATE_H - 0.5, outer + (face > 0 ? 1 : 0) + face * 0.4], rotX((face * Math.PI) / 2), liv.accent, { joints: [jid] });
          } else b.put("3005", x, y0, outer, 0, liv.main);
        }
        b.rect("brick", p0, inner, podLen, 1, y0, liv.main);
        const z0 = Math.min(outer, inner);
        for (let x = p0; x < p1 - 1; x++) b.put(CURVED_1x2, x, y0 + 3, z0, face < 0 ? 2 : 0, liv.main);
        b.put(CHEESE_1x2, p1 - 1, y0 + 3, z0, 3, liv.main);
      }
    });

  // 5 · Front wing: a separate assembly in the booklet, hung from the nose by
  // one connection; mirrored wing plates fan out to the full width, end plates
  // in the detail colour.
  b.module("Front wing", () => {
    const y = 3;
    const hw = P.frontWing;
    // The hanger: a plate under the nose tip wide enough to clamp the inner
    // studs of both wing plates (the one connection that holds the wing).
    plate(L - 2, -3, 2, 6, y + 1, liv.main);
    plate(L - 2, -1, 2, 2, y, liv.main);
    if (hw >= 5) {
      b.put(WING_R, L - 2, y, 1, 0, liv.main);
      b.put(WING_L, L - 2, y, -5, 0, liv.main);
    } else {
      plate(L - 2, -hw, 2, hw - 1, y, liv.main);
      plate(L - 2, 1, 2, hw - 1, y, liv.main);
    }
    // End plates: slopes rising toward the back (plain 1×2 bricks read as blocks).
    if (detail >= 1) {
      b.put(SLOPE_45_2x1, L - 2, y + 1, -hw, 3, liv.detail);
      b.put(SLOPE_45_2x1, L - 2, y + 1, hw - 1, 3, liv.detail);
    }
    // The hanger's ends beside the nose show: tiled.
    b.rect("tile", L - 2, -3, 2, 1, y + 2, liv.main);
    b.rect("tile", L - 2, 2, 2, 1, y + 2, liv.main);
  });

  // 6 · Engine cover and airbox: behind the head the airbox (detail colour),
  // then the spine falls in long curved slopes to the rear wing.
  b.module("Engine cover", () => {
    const ab = ck - 3;
    if (ab < 3) return;
    b.rect("brick", ab, -1, 2, 2, top + 1, liv.main);
    b.put(SLOPE_2x2, ab, top + 4, -1, 1, liv.detail);
    const fall = ab - 2; // studs from the rear-wing pillar to the airbox
    const id = fall >= 4 ? CURVED_4x1 : fall === 3 ? "50950" : CURVED_1x2;
    const n = fall >= 4 ? 4 : fall === 3 ? 3 : 2;
    for (const z of [-1, 0]) b.put(id, ab - n, top + 1, z, 1, liv.main);
    // The cover's shoulders: 1×2 cheese slopes, half the parts of 1×1s, odd end in a 1×1.
    for (let x = 0; x < ck - 1; x += 2)
      for (const [z, r] of [[-2, 2], [1, 0]] as const)
        if (x + 1 < ck - 1) b.put(CHEESE_1x2, x, top + 1, z, r, liv.main);
        else b.put("54200", x, top + 1, z, r, liv.main);
  });

  // 7 · Rear wing on its central pillar, end plates hanging from the tips.
  b.module("Rear wing", () => {
    const wy = P.rearWingY;
    for (let y = top + 1; y < wy; y++) plate(0, -1, 2, 2, y, liv.main);
    const hw = P.rearWing;
    plate(0, -hw, 2, hw * 2, wy, liv.main);
    if (detail >= 1) {
      b.rect("tile", 0, -hw, 2, hw * 2, wy + 1, liv.accent);
      b.put(SLOPE_45_2x1, 0, wy - 3, -hw, 3, liv.detail);
      b.put(SLOPE_45_2x1, 0, wy - 3, hw - 1, 3, liv.detail);
    }
  });

  // 8 · Halo: an arch on the two jumpers, over the driver's head.
  if (detail >= 1)
    b.module("Halo", () => {
      b.exact(ARCH, [ck + 1, (top + 4) * PLATE_H, 0], IDENTITY, 0, { joints: ["halo-back", "halo-front"] });
    });
  if (detail >= 2)
    b.module("Details", () => {
      b.put(ROUND_1x1, ck + 2, top + 1, -2, 0, liv.detail); // mirrors
      b.put(ROUND_1x1, ck + 2, top + 1, 1, 0, liv.detail);
    });

  return {
    b,
    title: `F1 car · ${liv.name}`,
    rule: `L=${L} · wheelbase ${F - R} (${((F - R) / L).toFixed(2)} L) · tub 4, body 8, track 9 · cockpit at ${P.cockpit} L · from LEGO 77244`,
  };
}
