import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

// Browser-only mock data, isolated from both the desktop database and normal browser profiles.
const project = fileURLToPath(new URL("../", import.meta.url));
const output = process.env.UI_ARTIFACT_DIR ?? resolve(tmpdir(), "translatorx-ui");
const base = process.env.UI_BASE_URL ?? "http://127.0.0.1:1425";
const pages = ["write", "read", "notebook", "review", "stats", "settings"];
const styles = ["paper", "glass", "studio"];
const locales = ["en", "zh-CN", "ja"];
const errors = [];
let screenshots = 0;
let browser;
let server;
let serverLog = "";

async function waitForServer() {
  if (!process.env.UI_BASE_URL) {
    server = spawn(process.execPath, [resolve(project, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", "1425"], { cwd: project, stdio: ["ignore", "pipe", "pipe"] });
    server.stdout.on("data", (data) => { serverLog += data; });
    server.stderr.on("data", (data) => { serverLog += data; });
  }
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server?.exitCode !== null && server?.exitCode !== undefined) throw new Error(serverLog);
    try { if ((await fetch(base)).ok) return; } catch { /* Waiting for Vite. */ }
    await new Promise((done) => setTimeout(done, 150));
  }
  throw new Error(`Preview server did not start: ${serverLog}`);
}

async function open(context, path = "/", viewport = { width: 1180, height: 780 }) {
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize(viewport);
  await page.clock.setFixedTime(new Date("2026-09-30T12:00:00Z"));
  await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  return page;
}

async function setAppearance(page, style, theme, locale) {
  await page.evaluate(async ({ style, theme, locale }) => {
    const { useApp } = await import("/src/store.ts");
    const settings = useApp.getState().settings;
    await useApp.getState().updateSettings({ mainStyle: style, theme, uiLanguage: locale, mini: { ...settings.mini, style, theme: "inherit" } });
  }, { style, theme, locale });
  await page.waitForFunction(({ style, theme, locale }) => document.documentElement.dataset.style === style && document.documentElement.dataset.theme === theme && document.documentElement.lang === locale, { style, theme, locale });
}

async function navigate(page, index) {
  await page.locator(".app-sidebar .nav-item").nth(index).click();
  await page.locator("main h1").first().waitFor();
  if (pages[index] === "stats") await page.locator(".stat-tile").first().waitFor();
}

async function checkContrast(page, name) {
  const failures = await page.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    const rgb = (value) => value.startsWith("#") ? value.slice(1).match(/../g).map((h) => parseInt(h, 16)) : value.match(/[\d.]+/g).map(Number);
    const color = (key) => rgb(css.getPropertyValue(`--${key}`).trim());
    const blend = (fg, bg) => fg.slice(0, 3).map((v, i) => v * (fg[3] ?? 1) + bg[i] * (1 - (fg[3] ?? 1)));
    const luminance = (c) => c.slice(0, 3).map((v) => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((n, v, i) => n + v * [.2126, .7152, .0722][i], 0);
    const ratio = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
    const base = color("paper");
    const backgrounds = [base, color("paper-2"), blend(color("card"), base)];
    return ["ink", "ink-2", "ink-3", "danger"].flatMap((key) => backgrounds.flatMap((bg, index) => {
      const contrast = ratio(color(key), bg);
      return contrast < 4.5 ? [{ key, surface: index, contrast }] : [];
    }));
  });
  assert.deepEqual(failures, [], `${name}: text contrast below 4.5:1`);
}

async function checkMiniContrast(page, name) {
  // Default material readability. Extreme user-selected transparency has an
  // explicit UI warning; it must not be hidden by a fixed .92 surface floor.
  const failures = await page.evaluate(() => {
    const rgb = (value) => {
      const parts = value.match(/[\d.]+/g).map(Number);
      return value.startsWith("color(srgb ") ? [...parts.slice(0, 3).map((v) => v * 255), parts[3] ?? 1] : parts;
    };
    const blend = (fg, bg) => fg.slice(0, 3).map((v, i) => v * (fg[3] ?? 1) + bg[i] * (1 - (fg[3] ?? 1)));
    const luminance = (c) => c.slice(0, 3).map((v) => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((n, v, i) => n + v * [.2126, .7152, .0722][i], 0);
    const ratio = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
    const backdrop = getComputedStyle(document.querySelector(".window-backdrop"));
    const base = rgb(backdrop.backgroundColor);
    base[3] = (base[3] ?? 1) * Number(backdrop.opacity);
    return [...document.querySelectorAll(".mini-titlebar > span, .mini-modebar > span, .mini-source .glass-muted, .mini-textarea, .mini-footer .glass-muted")].flatMap((el) => {
      const ancestors = [];
      for (let parent = el; parent; parent = parent.parentElement) ancestors.unshift(parent);
      return [[0, 0, 0], [255, 255, 255]].flatMap((outside) => {
        const background = ancestors.reduce((bg, node) => blend(rgb(getComputedStyle(node).backgroundColor), bg), blend(base, outside));
        const contrast = ratio(rgb(getComputedStyle(el).color), background);
        return contrast < 4.5 ? [{ element: el.className, outside, contrast }] : [];
      });
    });
  });
  assert.deepEqual(failures, [], `${name}: default material text contrast below 4.5:1`);
}

async function checkLayout(page, name) {
  const overflow = await page.evaluate(() => {
    const width = window.innerWidth;
    return [...document.querySelectorAll("button, input, textarea, select")].flatMap((el) => {
      const box = el.getBoundingClientRect();
      if (!box.width || !box.height || box.bottom < 0 || box.top > innerHeight) return [];
      let ancestor = el.parentElement;
      while (ancestor) {
        const css = getComputedStyle(ancestor);
        if ((ancestor.classList.contains("overflow-x-auto") || ancestor.classList.contains("chart-table-wrap")) && ["auto", "scroll"].includes(css.overflowX) && ancestor.scrollWidth > ancestor.clientWidth + 1) return [];
        ancestor = ancestor.parentElement;
      }
      return box.left < -1 || box.right > width + 1 ? [{ label: el.getAttribute("aria-label") || el.textContent?.slice(0, 50), left: box.left, right: box.right }] : [];
    });
  });
  assert.deepEqual(overflow, [], `${name}: controls overflow horizontally`);
}

async function shot(page, name, selector) {
  await checkLayout(page, name);
  const target = selector ? page.locator(selector) : page;
  await target.screenshot({ path: resolve(output, `${name}.png`), animations: "disabled" });
  screenshots++;
}

async function exerciseFlows(main, context, locale) {
  for (const [index, mode] of ["recall", "cloze", "typing"].entries()) {
    await navigate(main, 0);
    await main.locator(".editor-area").fill("感谢你的回复。");
    await main.locator(".editor-options .segmented").first().getByRole("tab").nth(index).click();
    await main.locator(".editor-submit .btn-seal").click();
    await main.locator(".practice-desk").waitFor();
    await main.setViewportSize({ width: 960, height: 640 });
    await shot(main, `${locale}-practice-${mode}-small`);
    const expected = await main.evaluate(async () => {
      const { useApp } = await import("/src/store.ts");
      const { buildCloze } = await import("/src/lib/check.ts");
      const state = useApp.getState();
      const target = state.segments[0].target;
      return { target, blanks: buildCloze(target, state.to, state.settings.clozeRatio).filter((p) => p.type === "blank").map((p) => p.answer) };
    });
    if (mode === "cloze") {
      const inputs = main.locator(".practice-desk input");
      assert.equal(await inputs.count(), expected.blanks.length);
      for (let i = 0; i < expected.blanks.length; i++) await inputs.nth(i).fill(expected.blanks[i]);
    } else {
      await main.locator(".practice-desk textarea").fill(expected.target);
    }
    const finish = main.locator(".practice-rail .btn-seal");
    if (!(await finish.isVisible())) await main.keyboard.press("Enter");
    await finish.waitFor();
    await finish.click();
    await main.locator(".seal-stamp").waitFor();
    await main.waitForFunction(async () => (await import("/src/store.ts")).useApp.getState().practiceSave === "saved");
    await shot(main, `${locale}-finish-${mode}-small`);
    const nextLabel = await main.evaluate(async () => (await import("/src/lib/i18n.ts")).t("Write another"));
    await main.getByRole("button", { name: nextLabel, exact: true }).click();
    await main.setViewportSize({ width: 1180, height: 780 });
  }
  await navigate(main, 1);
  await main.locator("main textarea").fill("The model was trained on a curated dataset.");
  const compareLabel = await main.evaluate(async () => (await import("/src/lib/i18n.ts")).t("Compare sentence by sentence"));
  await main.getByRole("button", { name: compareLabel, exact: true }).click();
  const breakdownLabel = await main.evaluate(async () => (await import("/src/lib/i18n.ts")).t("Breakdown"));
  await main.getByRole("button", { name: breakdownLabel, exact: true }).first().click();
  await main.locator(".reading-panel").waitFor();
  await main.setViewportSize({ width: 960, height: 640 });
  await shot(main, `${locale}-reading-panel-small`);
  await main.setViewportSize({ width: 1180, height: 780 });

  const mini = await open(context, "/mini.html", { width: 420, height: 560 });
  await mini.locator(".mini-source textarea").fill("感谢你的回复。");
  await mini.locator(".mini-primary").click();
  await mini.locator(".mini-result").waitFor();
  await mini.locator(".mini-modebar").getByRole("tab").nth(1).click();
  await mini.locator(".mini-practice-source").waitFor();
  for (const [index, mode] of ["recall", "cloze", "typing"].entries()) {
    await mini.locator(".glass-seg.xs").getByRole("tab").nth(index).click();
    await shot(mini, `${locale}-mini-practice-${mode}`, ".mini-window");
  }
  await mini.locator(".mini-modebar").getByRole("tab").first().click();
  await mini.locator(".mini-source textarea").fill("A long message stays editable.\n".repeat(60));
  await mini.locator(".mini-header").scrollIntoViewIfNeeded();
  await shot(mini, `${locale}-mini-long`, ".mini-window");
  const geometry = await mini.locator(".mini-window").evaluate((el) => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height }));
  assert.equal(geometry.width, 420);
  assert.ok(geometry.height <= 560);
  await mini.locator(".mini-primary").scrollIntoViewIfNeeded();
  await checkLayout(mini, `${locale}-mini-long-footer`);
  await mini.close();
}

try {
  await mkdir(output, { recursive: true });
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  for (const locale of locales) {
    const context = await browser.newContext({ locale, colorScheme: "light", reducedMotion: "reduce", permissions: ["clipboard-read", "clipboard-write"] });
    const main = await open(context);
    for (const style of styles) {
      for (const theme of ["light", "dark"]) {
        const prefix = `${locale}-${style}-${theme}`;
        await setAppearance(main, style, theme, locale);
        await checkContrast(main, prefix);
        for (let index = 0; index < pages.length; index++) {
          await navigate(main, index);
          await shot(main, `${prefix}-${pages[index]}`);
        }
        // The minimum supported native main-window size must remain usable.
        await main.setViewportSize({ width: 960, height: 640 });
        await shot(main, `${prefix}-settings-small`);
        await navigate(main, 0);
        await shot(main, `${prefix}-write-small`);
        await main.setViewportSize({ width: 1180, height: 780 });

        const mini = await open(context, "/mini.html", { width: 420, height: 560 });
        await mini.locator(".mini-window").waitFor();
        await mini.waitForFunction(({ style, theme }) => document.documentElement.dataset.style === style && document.documentElement.dataset.theme === theme, { style, theme });
        await shot(mini, `${prefix}-mini-empty`, ".mini-window");
        await mini.locator(".mini-source textarea").fill("感谢你的回复。我们周五下午三点见。");
        await mini.locator(".mini-primary").click();
        await mini.locator(".mini-result textarea").waitFor();
        assert.ok((await mini.locator(".mini-result textarea").inputValue()).length > 0);
        await shot(mini, `${prefix}-mini-result`, ".mini-window");
        await checkMiniContrast(mini, prefix);
        await mini.locator("[data-opacity-toggle]").click();
        assert.equal(await mini.locator("[data-opacity-toggle]").getAttribute("aria-expanded"), "true");
        await shot(mini, `${prefix}-mini-appearance`, ".mini-window");
        await mini.keyboard.press("Escape");
        assert.equal(await mini.locator("[data-opacity-toggle]").getAttribute("aria-expanded"), "false");
        // Keep checking a live draft while changing the main theme independently.
        await main.evaluate(async () => {
          const { useApp } = await import("/src/store.ts");
          const s = useApp.getState().settings;
          await useApp.getState().updateSettings({ mini: { ...s.mini, theme: s.theme === "dark" ? "light" : "dark" } });
        });
        await mini.waitForFunction((theme) => document.documentElement.dataset.theme !== theme, theme);
        assert.equal(await mini.locator(".mini-source textarea").inputValue(), "感谢你的回复。我们周五下午三点见。");
        await mini.close();
        await setAppearance(main, style, theme, locale);
        const bubble = await open(context, "/bubble.html", { width: 28, height: 28 });
        await bubble.waitForFunction(({ style, theme }) => document.documentElement.dataset.style === style && document.documentElement.dataset.theme === theme, { style, theme });
        await shot(bubble, `${prefix}-bubble`);
        await bubble.close();
      }
    }

    await exerciseFlows(main, context, locale);

    // Real navigation, not conditional tab mounts: retain the unsaved provider key.
    await navigate(main, 5);
    await main.locator('.settings-nav a[href="#services"]').click();
    const key = main.locator('input[type="password"]').last();
    await key.fill("ui-test-unsaved-not-a-real-key");
    const appearanceLink = main.locator('.settings-nav a[href="#appearance"]');
    assert.equal(await appearanceLink.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return hit === el || el.contains(hit);
    }), true, "Sticky settings links must not be covered by the native drag region");
    const linkBox = await appearanceLink.boundingBox();
    await main.mouse.click(linkBox.x + linkBox.width / 2, linkBox.y + linkBox.height / 2);
    assert.equal(await key.inputValue(), "ui-test-unsaved-not-a-real-key");
    await context.close();
  }
  assert.deepEqual(errors, [], "Browser runtime errors");
  const report = { screenshots, locales, styles, colorModes: ["light", "dark"], runtimeErrors: errors, directory: output };
  await writeFile(resolve(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  server?.kill("SIGTERM");
}
