export interface LegoColor {
  code: number; // LDraw color code
  name: string;
  hex: string;
  alpha?: number; // transparent colours
}

/** The quick palette. */
export const COLORS: LegoColor[] = [
  { code: 4, name: "Red", hex: "#C91A09" },
  { code: 25, name: "Orange", hex: "#FE8A18" },
  { code: 14, name: "Yellow", hex: "#F2CD37" },
  { code: 2, name: "Green", hex: "#237841" },
  { code: 1, name: "Blue", hex: "#0055BF" },
  { code: 73, name: "Medium Blue", hex: "#5A93DB" },
  { code: 15, name: "White", hex: "#FFFFFF" },
  { code: 71, name: "Light Bluish Gray", hex: "#A0A5A9" },
  { code: 72, name: "Dark Bluish Gray", hex: "#6C6E68" },
  { code: 0, name: "Black", hex: "#1B2A34" },
  { code: 19, name: "Tan", hex: "#E4CD9E" },
  { code: 70, name: "Reddish Brown", hex: "#582A12" },
  { code: 320, name: "Dark Red", hex: "#720E0F" },
  { code: 27, name: "Lime", hex: "#BBE90B" },
  { code: 272, name: "Dark Blue", hex: "#0A3463" },
  { code: 28, name: "Dark Tan", hex: "#958A73" },
  { code: 378, name: "Sand Green", hex: "#A0BCAC" },
  { code: 29, name: "Bright Pink", hex: "#E4ADC8" },
];

/** Every known colour: the palette, plus all of LDConfig once the catalog loads. */
export const ALL_COLORS: LegoColor[] = [...COLORS];
export const COLOR_BY_CODE: Record<number, LegoColor> = Object.fromEntries(COLORS.map((c) => [c.code, c]));

/** Adopt LDraw's official colour table (keeps palette order; LDraw values win). */
export function installColors(list: LegoColor[]) {
  for (const c of list) COLOR_BY_CODE[c.code] = c;
  for (const p of COLORS) Object.assign(p, COLOR_BY_CODE[p.code]);
  ALL_COLORS.splice(0, ALL_COLORS.length, ...list);
}

/** Colour lookup that never fails (unknown codes from imports render grey). */
export function colorOf(code: number): LegoColor {
  return COLOR_BY_CODE[code] ?? { code, name: `Colour ${code}`, hex: "#9BA19D" };
}
