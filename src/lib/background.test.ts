// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { api } from "./api";
import { refreshBackground, useBackgroundAsset } from "./background";
afterEach(() => vi.restoreAllMocks());

it("loads a background separately from application settings", async () => {
  vi.spyOn(api, "getBackgroundImage").mockResolvedValue("data:image/png;base64,fixture");
  await refreshBackground();
  expect(useBackgroundAsset.getState()).toMatchObject({ dataUrl: "data:image/png;base64,fixture", loading: false, error: "" });
});
it("does not resurrect an image when an older load finishes after removal", async () => {
  let old!: (s: string | null) => void;
  vi.spyOn(api, "getBackgroundImage").mockImplementationOnce(() => new Promise((r) => { old = r; })).mockResolvedValueOnce(null);
  const first = refreshBackground();
  await refreshBackground();
  old("old-image");
  await first;
  expect(useBackgroundAsset.getState().dataUrl).toBeNull();
});
it("falls back to the theme and reports a corrupt or unreadable image", async () => {
  vi.spyOn(api, "getBackgroundImage").mockRejectedValue(new Error("invalid image"));
  await refreshBackground();
  expect(useBackgroundAsset.getState()).toMatchObject({ dataUrl: null, loading: false, error: "invalid image" });
});
