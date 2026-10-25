// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { ActivityHeatmap, ActivityTrend } from "./ActivityCharts";
import { setLocale } from "../../lib/i18n";
import type { ActivityDay } from "../../lib/learning";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const host = document.createElement("div");
const root = createRoot(host);
const days: ActivityDay[] = [
  { date: "2026-09-01", label: "Sep 1", count: 0, totalWords: 0, correctWords: 0, accuracy: null },
  { date: "2026-09-02", label: "Sep 2", count: 4, totalWords: 10, correctWords: 8, accuracy: .8 },
];
afterEach(async () => { await act(async () => root.render(null)); });

it("does not draw activity for a zero-count day", async () => {
  setLocale("en");
  await act(async () => root.render(createElement(ActivityTrend, { days })));
  const mark = host.querySelector<HTMLElement>('button[aria-label$=": 0"] > span');
  expect(mark?.style.height).toBe("0%");
});

it("does not turn missing accuracy into a visible score", async () => {
  setLocale("en");
  await act(async () => root.render(createElement(ActivityTrend, { days, accuracy: true })));
  const mark = host.querySelector<HTMLElement>('button[aria-label$=": —"] > span');
  expect(mark?.style.height).toBe("0%");
});

it("offers the activity calendar as a readable table", async () => {
  setLocale("en");
  await act(async () => root.render(createElement(ActivityHeatmap, { days })));
  const tableButton = [...host.querySelectorAll("button")].find((el) => el.textContent === "Table");
  expect(tableButton).toBeDefined();
  await act(async () => tableButton!.click());
  expect(host.querySelectorAll("tbody tr")).toHaveLength(2);
  expect(host.querySelector("table")?.textContent).toContain("4");
});
