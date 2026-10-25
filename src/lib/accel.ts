// Shortcut display helpers, free of React so the bubble page can use them too.

export const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const IS_WINDOWS = typeof navigator !== "undefined" && /^Win/.test(navigator.platform);

/** "CommandOrControl+Shift+Y" → "⌘ ⇧ Y". */
export function prettyAccel(a: string): string {
  const names: Record<string, string> = {
    CommandOrControl: IS_MAC ? "⌘" : "Ctrl",
    Control: IS_MAC ? "⌃" : "Ctrl",
    Shift: "⇧",
    Alt: IS_MAC ? "⌥" : "Alt",
  };
  return a.split("+").map((p) => names[p] ?? p).join(" ");
}
