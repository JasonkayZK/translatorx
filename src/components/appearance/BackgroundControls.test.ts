// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BackgroundControls } from "./BackgroundControls";
import { api } from "../../lib/api";
import { useBackgroundAsset } from "../../lib/background";
import { normalizeBackgroundImage } from "../../lib/background-image";
import { setLocale } from "../../lib/i18n";
vi.mock("../../lib/background-image", async (original) => ({ ...await original<typeof import("../../lib/background-image")>(), normalizeBackgroundImage: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const host = document.createElement("div");
const root = createRoot(host);
beforeEach(() => { setLocale("en"); useBackgroundAsset.setState({ dataUrl: "old-image", error: "", loading: false }); });
afterEach(async () => { await act(async () => root.render(null)); vi.restoreAllMocks(); vi.clearAllMocks(); });

it("keeps the old asset when a chosen image cannot be decoded", async () => {
  const save = vi.spyOn(api, "saveBackgroundImage").mockResolvedValue();
  vi.mocked(normalizeBackgroundImage).mockRejectedValue(new Error("Invalid test image"));
  await act(async () => root.render(createElement(BackgroundControls)));
  const input = host.querySelector<HTMLInputElement>('input[type="file"]');
  expect(input).not.toBeNull();
  await act(async () => {
    Object.defineProperty(input, "files", { value: [new File(["bad"], "bad.png")], configurable: true });
    input!.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(save).not.toHaveBeenCalled();
  expect(useBackgroundAsset.getState().dataUrl).toBe("old-image");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Invalid test image");
});
it("does nothing when file selection is cancelled", async () => {
  await act(async () => root.render(createElement(BackgroundControls)));
  const input = host.querySelector<HTMLInputElement>('input[type="file"]');
  expect(input).not.toBeNull();
  await act(async () => input!.dispatchEvent(new Event("change", { bubbles: true })));
  expect(normalizeBackgroundImage).not.toHaveBeenCalled();
  expect(useBackgroundAsset.getState().dataUrl).toBe("old-image");
});
