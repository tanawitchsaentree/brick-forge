import { useSyncExternalStore } from "react";

// Light, dark, or whatever the system says. Pane draws both themes from
// <html data-theme>; the 3D scene reads the resolved theme for its own colours.
// index.html sets the attribute before the first paint, so there's no flash.

export type ThemePref = "system" | "light" | "dark";
export type Theme = "light" | "dark";

const KEY = "brick-forge:theme";
const media = matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<() => void>();

let pref: ThemePref = (localStorage.getItem(KEY) as ThemePref) || "system";

const resolve = (): Theme => (pref === "system" ? (media.matches ? "dark" : "light") : pref);

function apply() {
  document.documentElement.dataset.theme = resolve();
  listeners.forEach((l) => l());
}

media.addEventListener("change", () => pref === "system" && apply());
apply();

export function setThemePref(next: ThemePref) {
  pref = next;
  localStorage.setItem(KEY, next);
  apply();
}

const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l));

/** The chosen preference (for the switch). */
export const useThemePref = () => useSyncExternalStore(subscribe, () => pref);
/** The theme in effect (for the scene). */
export const useTheme = () => useSyncExternalStore(subscribe, resolve);

/** The scene's own colours per theme: the table and its grid ink. */
export const SCENE = {
  light: { background: "#e9edf2", ink: "#4a5566", sky: "#ffffff", ground: "#8a94a6" },
  dark: { background: "#16181c", ink: "#aab3c0", sky: "#dfe6f0", ground: "#30343c" },
} as const;
