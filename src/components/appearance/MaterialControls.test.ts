// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { MaterialControls } from "./MaterialControls";
import { setLocale } from "../../lib/i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const host = document.createElement("div");
const root = createRoot(host);
afterEach(async () => { await act(async () => root.render(null)); });

it("labels transparency in the same direction as the slider and flushes on release", async () => {
  setLocale("en");
  const onChange = vi.fn();
  await act(async () => root.render(createElement(MaterialControls, { value: { opacity: .62, blur: true }, onChange })));
  const slider = host.querySelector<HTMLInputElement>('input[type="range"]');
  expect(slider).not.toBeNull();
  expect(slider?.value).toBe("38");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(slider, "70");
    slider!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(onChange).toHaveBeenCalledWith({ opacity: .3 }, true);
  await act(async () => slider!.dispatchEvent(new Event("pointerup", { bubbles: true })));
  expect(onChange).toHaveBeenLastCalledWith({}, false);
});

it("warns at high transparency and exposes the frost switch", async () => {
  setLocale("en");
  const onChange = vi.fn();
  await act(async () => root.render(createElement(MaterialControls, { value: { opacity: .3, blur: true }, onChange })));
  expect(host.querySelector('[role="status"]')?.textContent).toContain("High transparency");
  const toggle = host.querySelector<HTMLButtonElement>('[role="switch"]');
  expect(toggle?.getAttribute("aria-checked")).toBe("true");
  await act(async () => toggle!.click());
  expect(onChange).toHaveBeenCalledWith({ blur: false }, false);
});
