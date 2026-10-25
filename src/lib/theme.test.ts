// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyTheme, miniTheme, restoreTheme } from "./theme";
import { DEFAULT_SETTINGS, normalizeSettings } from "./types";

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

describe("independent window themes", () => {
  it("restores material scalars without caching image data or unrelated settings", () => {
    const media = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal("matchMedia", () => media);
    localStorage.setItem("translatorx.appearance.main", JSON.stringify({ theme: "dark", style: "glass", material: { opacity: .4, blur: false, dataUrl: "private-image" } }));
    restoreTheme("main");
    expect(document.documentElement.style.getPropertyValue("--surface-opacity")).toBe("0.4");
    expect(document.documentElement.dataset.frost).toBe("false");
    const cached = JSON.parse(localStorage.getItem("translatorx.appearance.main")!);
    expect(cached.material).toEqual({ opacity: .4, blur: false });
    expect(JSON.stringify(cached)).not.toContain("private-image");
  });
  it("inherits only when requested, otherwise keeps the mini mode", () => {
    const settings = normalizeSettings({ ...DEFAULT_SETTINGS, theme: "dark", mini: { ...DEFAULT_SETTINGS.mini, theme: "light" } });
    expect(miniTheme(settings)).toBe("light");
    settings.mini.theme = "inherit";
    expect(miniTheme(settings)).toBe("dark");
  });
  it("follows system color changes and removes its listener", () => {
    let callback = () => {};
    const media = { matches: false, addEventListener: vi.fn((_event, cb) => { callback = cb; }), removeEventListener: vi.fn() };
    vi.stubGlobal("matchMedia", () => media);
    const cleanup = applyTheme("system", "studio", "mini");
    expect(document.documentElement.dataset).toMatchObject({ theme: "light", style: "studio" });
    media.matches = true; callback();
    expect(document.documentElement.dataset.theme).toBe("dark");
    cleanup();
    expect(media.removeEventListener).toHaveBeenCalledWith("change", callback);
  });
  it("restores a separate surface cache without leaking a listener", () => {
    const media = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal("matchMedia", () => media);
    localStorage.setItem("translatorx.appearance.main", JSON.stringify({ theme: "dark", style: "glass" }));
    restoreTheme("main");
    expect(document.documentElement.dataset).toMatchObject({ theme: "dark", style: "glass" });
    restoreTheme("mini");
    expect(document.documentElement.dataset).toMatchObject({ theme: "light", style: "paper" });
    expect(media.removeEventListener).toHaveBeenCalledTimes(2);
  });
});
