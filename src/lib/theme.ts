import { useEffect } from "react";
import { materialStyle } from "./appearance";
import { bounded, DEFAULT_SETTINGS } from "./types";
import type { MainStyle, MaterialPrefs, Settings, Theme } from "./types";

type Surface = "main" | "mini" | "bubble";

export function miniTheme(settings: Settings): Theme {
  return settings.mini.theme === "inherit" ? settings.theme : settings.mini.theme;
}

/** Apply appearance to this webview only. The cache contains only small visual scalars. */
export function applyTheme(theme: Theme, style: MainStyle = "paper", surface: Surface = "main", material?: MaterialPrefs): () => void {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const root = document.documentElement;
  const apply = () => {
    root.dataset.theme = theme === "dark" || (theme === "system" && mq.matches) ? "dark" : "light";
    root.dataset.style = style;
    root.dataset.surface = surface;
  };
  apply();
  const defaults = surface === "main" ? DEFAULT_SETTINGS.mainAppearance : DEFAULT_SETTINGS.mini;
  const fill = { opacity: bounded(material?.opacity, .3, 1, defaults.opacity), blur: typeof material?.blur === "boolean" ? material.blur : defaults.blur };
  if (surface !== "bubble") {
    root.dataset.frost = String(fill.blur);
    for (const [key, value] of Object.entries(materialStyle(fill))) root.style.setProperty(key, String(value));
  }
  try {
    localStorage.setItem(`translatorx.appearance.${surface}`, JSON.stringify({ theme, style, ...(surface !== "bubble" ? { material: fill } : {}) }));
  } catch { /* storage may be disabled */ }
  mq.addEventListener("change", apply);
  return () => mq.removeEventListener("change", apply);
}

export function restoreTheme(surface: Surface) {
  let theme: Theme = "system";
  let style: MainStyle = "paper";
  let material: MaterialPrefs | undefined;
  try {
    const saved = JSON.parse(localStorage.getItem(`translatorx.appearance.${surface}`) ?? "null");
    if (["system", "light", "dark"].includes(saved?.theme)) theme = saved.theme;
    if (["paper", "glass", "studio"].includes(saved?.style)) style = saved.style;
    if (saved?.material && typeof saved.material === "object") material = saved.material;
  } catch { /* corrupted cache falls back to the system */ }
  applyTheme(theme, style, surface, material)();
}

export function useTheme(theme: Theme, style: MainStyle = "paper", ready = true, surface: Surface = "main", material?: MaterialPrefs) {
  useEffect(() => ready ? applyTheme(theme, style, surface, material) : undefined, [theme, style, ready, surface, material?.opacity, material?.blur]);
}
