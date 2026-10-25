import { useSyncExternalStore } from "react";

/**
 * One theme for the whole site. The hero switch, the app header switch and the features section all read and write this.
 * Until the visitor chooses, the system setting decides (and follows it live). A choice is remembered across pages and reloads.
 */
export type Theme = "light" | "dark";
const KEY = "sp-theme";
const systemDark = () => window.matchMedia("(prefers-color-scheme: dark)");

function stored(): Theme | null {
  try { const v = localStorage.getItem(KEY); return v === "light" || v === "dark" ? v : null; } catch { return null; }
}

let explicit: Theme | null = typeof window !== "undefined" ? stored() : null;
const listeners = new Set<() => void>();
const resolve = (): Theme => explicit ?? (systemDark().matches ? "dark" : "light");

// The CSS design tokens are keyed on this attribute (see styles.css).
function apply() { document.documentElement.dataset.theme = resolve(); }
function emit() { apply(); listeners.forEach((l) => l()); }

export function setTheme(t: Theme) {
  explicit = t;
  try { localStorage.setItem(KEY, t); } catch { /* private mode: the choice just won't persist */ }
  emit();
}
export const toggleTheme = () => setTheme(resolve() === "dark" ? "light" : "dark");

if (typeof window !== "undefined") {
  apply();
  systemDark().addEventListener("change", () => { if (!explicit) emit(); });
  window.addEventListener("storage", (e) => { if (e.key === KEY) { explicit = stored(); emit(); } }); // other tabs
}

export function useTheme(): Theme {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, resolve, () => "dark");
}
