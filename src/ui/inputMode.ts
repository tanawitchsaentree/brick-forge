// How the user is driving the page right now: "pointer" after a click or tap,
// "keyboard" after a key. Pane draws its focus ring on :focus-visible, which
// Chrome also matches when a component moves focus itself on click (Radix tabs
// do). styles.css hides the ring in pointer mode, so it shows for keyboard users only.

const root = document.documentElement;
const set = (mode: "pointer" | "keyboard") => {
  if (root.dataset.input !== mode) root.dataset.input = mode;
};
addEventListener("pointerdown", () => set("pointer"), { capture: true, passive: true });
addEventListener("keydown", (e) => (e.key === "Tab" || e.key.startsWith("Arrow") || e.key === "Enter" || e.key === " ") && set("keyboard"), { capture: true });
set("pointer");
