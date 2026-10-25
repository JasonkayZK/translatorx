// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { catalogs, formatDate, formatNumber, getLocale, interpolate, languageName, resolveLocale, setLocale, subscribeLocale, t, useI18n } from "./i18n";
import type { Locale } from "./i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => setLocale("en", "en-US"));

describe("locale resolution", () => {
  it.each([
    ["system", "fr-FR", "en"], ["system", "ja-JP", "ja"], ["en", "zh-CN", "en"],
    ["system", "zh-TW", "zh-CN"], ["system", "zh-Hant-HK", "zh-CN"], ["system", "JA_jp", "ja"],
    ["system", "en-GB", "en"], ["system", "", "en"], ["ja", "en-US", "ja"],
  ] as const)("resolves %s with %s to %s", (preference, system, expected) => {
    expect(resolveLocale(preference, system)).toBe(expected);
  });

  it("retains the native system locale when switching preferences", () => {
    setLocale("en", "ja-JP");
    setLocale("system");
    expect(getLocale()).toBe("ja");
    expect(document.documentElement.lang).toBe("ja");
  });

  it("updates mounted React consumers without remounting or changing user content", async () => {
    setLocale("en");
    const host = document.createElement("div");
    const root = createRoot(host);
    let mounts = 0;
    function Labels() {
      useI18n();
      const [draft] = useState(() => { mounts++; return "私の原文 — my original text"; });
      return createElement("div", null, createElement("button", null, t("Settings")), createElement("textarea", { value: draft, readOnly: true }));
    }
    await act(async () => root.render(createElement(Labels)));
    expect(host.querySelector("button")?.textContent).toBe("Settings");
    await act(async () => { setLocale("zh-CN"); });
    expect(host.querySelector("button")?.textContent).toBe("设置");
    await act(async () => { setLocale("ja"); });
    expect(host.querySelector("button")?.textContent).toBe("設定");
    expect(host.querySelector("textarea")?.value).toBe("私の原文 — my original text");
    expect(mounts).toBe(1);
    await act(async () => root.unmount());
  });

  it("notifies only on an effective change and supports unsubscribe", () => {
    setLocale("en");
    const callback = vi.fn();
    const off = subscribeLocale(callback);
    setLocale("en");
    setLocale("ja");
    off();
    setLocale("zh-CN");
    expect(callback).toHaveBeenCalledTimes(1);
  });
});


describe("catalogs and interpolation", () => {
  it("interpolates numbers and repeated parameters without evaluating replacement syntax", () => {
    setLocale("en");
    expect(interpolate("{name}: {count}; {name}", { name: "$& {count}", count: 1234 })).toBe("$& {count}: 1,234; $& {count}");
    expect(interpolate("{missing}")).toBe("{missing}");
    expect(t("bubble.disableApp", { app: "Notes" })).toBe("Hide in Notes");
    setLocale("ja");
    expect(t("bubble.disableApp", { app: "Notes" })).toBe("Notes では表示しない");
  });

  it("uses English when a translation is unavailable", () => {
    setLocale("ja");
    const entry = catalogs.ja.Settings;
    delete (catalogs.ja as Partial<typeof catalogs.ja>).Settings;
    try { expect(t("Settings")).toBe("Settings"); }
    finally { catalogs.ja.Settings = entry; }
    expect(t("unknown.runtime.key")).toBe("unknown.runtime.key");
  });

  it("has complete translations and matching interpolation parameters", () => {
    const keys = Object.keys(catalogs.en).sort();
    const placeholders = (value: string) => [...new Set(value.match(/\{\w+\}/g) ?? [])].sort();
    for (const locale of ["zh-CN", "ja"] as Locale[]) {
      expect(Object.keys(catalogs[locale]).sort()).toEqual(keys);
      for (const [key, value] of Object.entries(catalogs.en)) {
        const translation = catalogs[locale][key as keyof typeof catalogs.en];
        expect(translation.trim(), `${locale}: ${key}`).not.toBe("");
        expect(placeholders(translation), `${locale}: ${key}`).toEqual(placeholders(value));
      }
    }
    for (const key of ["tray.quick", "tray.show", "tray.quit", "bubble.translate", "bubble.disableApp", "bubble.enable", "bubble.disable", "bubble.pin", "bubble.unpin", "bubble.settings", "windows.mini"]) {
      expect(keys).toContain(key);
    }
  });

  it("keeps every static UI translation key in the catalogs", () => {
    const root = resolve("src");
    for (const file of readdirSync(root, { recursive: true }) as string[]) {
      if (!/\.tsx?$/.test(file) || file.includes(".test.")) continue;
      const source = ts.createSourceFile(file, readFileSync(`${root}/${file}`, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ["tr", "t"].includes(node.expression.text) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
          expect(Object.hasOwn(catalogs.en, node.arguments[0].text), `${file}: ${node.arguments[0].text}`).toBe(true);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  });

  it("formats local calendar dates, legacy week labels, and language names", () => {
    setLocale("en");
    expect(formatNumber(1234)).toBe("1,234");
    expect(formatDate("2026-09-29", { year: "numeric", month: "2-digit", day: "2-digit" })).toBe("09/29/2026");
    expect(formatDate("09/29")).toBe("Sep 29");
    expect(languageName("ja")).toBe("Japanese");
    setLocale("ja");
    expect(languageName("en")).toBe("英語");
    expect(formatDate("2026-09-29", { year: "numeric", month: "2-digit", day: "2-digit" })).toBe("2026/09/29");
  });
});
