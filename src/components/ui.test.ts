// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { Button, Segmented, Select } from "./ui";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const host = document.createElement("div");
document.body.append(host);
let root = createRoot(host);
afterEach(async () => { await act(async () => root.unmount()); root = createRoot(host); });

it("does not accidentally submit forms when a shared button is clicked", async () => {
  await act(async () => root.render(createElement(Button, null, "Action")));
  expect(host.querySelector("button")?.type).toBe("button");
});

it("keeps only the selected segment in the tab order", async () => {
  await act(async () => root.render(createElement(Segmented, {
    value: "light", onChange: () => {}, options: [{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }],
  })));
  expect([...host.querySelectorAll("button")].map((el) => el.tabIndex)).toEqual([0, -1]);
});

it("moves a segmented control with arrow keys and wraps at its ends", async () => {
  const change = vi.fn();
  await act(async () => root.render(createElement(Segmented, {
    value: "light", onChange: change, options: [{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }],
  })));
  const first = host.querySelector("button")!;
  await act(async () => first.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
  expect(change).toHaveBeenCalledWith("dark");
  expect(document.activeElement).toBe(host.querySelectorAll("button")[1]);
});

it("keeps the select affordance when a caller supplies layout styles", async () => {
  await act(async () => root.render(createElement(Select, { style: { width: 180 }, "aria-label": "Language" }, createElement("option", null, "English"))));
  expect(host.querySelector("select")?.style.width).toBe("180px");
  expect(host.querySelector("svg")).not.toBeNull();
});
