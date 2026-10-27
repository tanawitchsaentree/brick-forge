// What the Assembly Grammar can build (kept apart so menus can list them without loading the engine).

export type Kind = "racer" | "car" | "house" | "dino" | "robot" | "rocket";

export const KINDS: { id: Kind; label: string }[] = [
  { id: "racer", label: "Race car" },
  { id: "car", label: "City car" },
  { id: "house", label: "House" },
  { id: "dino", label: "Dinosaur" },
  { id: "robot", label: "Robot" },
  { id: "rocket", label: "Rocket" },
];
