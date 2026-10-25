import { t as tr, setLocale } from "../lib/i18n";
// The bubble shown in the corner of other apps' input boxes. Plain DOM, no React: the page is
// tiny and should load instantly.
import { api, onEvent } from "../lib/api";
import { prettyAccel } from "../lib/accel";
import { applyTheme, miniTheme } from "../lib/theme";
import { normalizeSettings } from "../lib/types";
import type { Settings } from "../lib/types";
import "./bubble.css";

const bubble = document.getElementById("bubble") as HTMLButtonElement;
let stopTheme = () => {};

function apply(incoming: Settings) {
  const s = normalizeSettings(incoming);
  setLocale(s.uiLanguage);
  stopTheme();
  stopTheme = applyTheme(miniTheme(s), s.mini.style, "bubble");
  bubble.setAttribute("aria-label", tr("bubble.translate"));
  bubble.title = s.shortcut ? tr("Translate and insert · {p0}", { p0: prettyAccel(s.shortcut) }) : tr("Translate and insert");
}

setLocale("system");
bubble.setAttribute("aria-label", tr("bubble.translate"));
Promise.all([api.getSettings(), api.systemLocale().catch(() => navigator.language)]).then(([s, native]) => {
  setLocale(s.uiLanguage, native);
  apply(s);
}).catch(() => {});
onEvent<Settings>("settings-changed", apply);

// React on press, not click: the bubble may be hidden before the button is released.
bubble.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  api.bubbleClick().catch(() => {});
});

bubble.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  api.bubbleMenu().catch(() => {});
});
