// Real LEGO dimensions (mm). The app stores everything in grid units:
//   x, z → studs (8 mm)   y → plates (3.2 mm, a brick is 3 plates)
export const STUD_MM = 8;
export const PLATE_MM = 3.2;
export const STUD_DIAMETER_MM = 4.8;
export const STUD_HEIGHT_MM = 1.7;
export const GAP_MM = 0.1; // clearance on each side of a part

// World units for rendering: 1 world unit = 1 stud.
export const PLATE_H = PLATE_MM / STUD_MM; // 0.4
export const STUD_R = STUD_DIAMETER_MM / 2 / STUD_MM;
export const STUD_H = STUD_HEIGHT_MM / STUD_MM;
export const GAP = GAP_MM / STUD_MM;

// LDraw units (LDU) for export: 1 stud = 20 LDU, 1 plate = 8 LDU.
export const LDU_PER_STUD = 20;
export const LDU_PER_PLATE = 8;

// Build volume.
export const BASE_SIZE = 32; // 32x32 baseplate
export const MAX_HEIGHT = 120; // plates (= 40 bricks)
