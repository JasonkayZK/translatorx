import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, normalizeSettings, mergeSettings } from "./types";

describe("settings migration", () => {
  it("adds material defaults without changing existing mini preferences", () => {
    expect(normalizeSettings({ mini: { opacity: .4, blur: false } })).toMatchObject({
      mainAppearance: { opacity: .85, blur: true }, background: { opacity: .45, blur: 8, fit: "cover" },
      mini: { opacity: .4, blur: false, useBackground: false },
    });
  });
  it("bounds material values and recovers malformed nested preferences", () => {
    expect(normalizeSettings({ mainAppearance: { opacity: -1, blur: "yes" }, background: { opacity: 2, blur: 99, fit: "bad" }, mini: { opacity: NaN } })).toMatchObject({
      mainAppearance: { opacity: .3, blur: true }, background: { opacity: 1, blur: 32, fit: "cover" }, mini: { opacity: .62 },
    });
    expect(normalizeSettings({ mainAppearance: null, background: "bad" }).background).toEqual(DEFAULT_SETTINGS.background);
  });
  it("merges only dirty nested fields without erasing other window preferences", () => {
    const previous = normalizeSettings({ mini: { pinned: true, opacity: .4 }, llm: { apiKey: "keep" } });
    const next = mergeSettings(previous, { mini: { blur: false }, mainAppearance: { opacity: .6 } });
    expect(next.mini).toMatchObject({ pinned: true, opacity: .4, blur: false });
    expect(next.llm.apiKey).toBe("keep");
    expect(previous.mini.blur).toBe(true);
  });
  it("adds new defaults while retaining old provider and mini preferences", () => {
    const saved = { theme: "dark", shortcut: "Alt+Y", llm: { apiKey: "existing-key" }, mini: { opacity: 0.4, blur: false, pinned: true, mode: "practice" }, bubbleBlocklist: [{ id: "custom.app", name: "Custom" }] };
    const settings = normalizeSettings(saved);
    expect(settings).toMatchObject({ ...saved, uiLanguage: "system", mainStyle: "paper", showDockIcon: true, mini: { ...saved.mini, style: "paper", theme: "inherit" } });
    expect(settings.llm.baseUrl).toBe(DEFAULT_SETTINGS.llm.baseUrl);
    expect(saved.mini).not.toHaveProperty("theme");
  });

  it("keeps explicit locale and window selections", () => {
    expect(normalizeSettings({ uiLanguage: "ja", mainStyle: "glass", showDockIcon: false, mini: { style: "studio", theme: "dark" } })).toMatchObject({ uiLanguage: "ja", mainStyle: "glass", showDockIcon: false, mini: { style: "studio", theme: "dark" } });
  });

  it("recovers missing and invalid new settings safely", () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ uiLanguage: "fr", mainStyle: null, showDockIcon: "no", mini: { style: "invalid", theme: "invalid" } })).toMatchObject({ uiLanguage: "system", mainStyle: "paper", showDockIcon: true, mini: { style: "paper", theme: "inherit" } });
    expect(normalizeSettings({ mini: null, llm: null })).toEqual(DEFAULT_SETTINGS);
  });
});
