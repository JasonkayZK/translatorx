import { afterEach, expect, it, vi } from "vitest";
import { createSettingsWriter } from "./settings-writer";
import { DEFAULT_SETTINGS, mergeSettings, normalizeSettings } from "./types";
import type { Settings, SettingsPatch } from "./types";

function fixture() {
  let view = normalizeSettings(DEFAULT_SETTINGS);
  const requests: { patch: SettingsPatch; resolve: (s: Settings) => void; reject: (e: Error) => void }[] = [];
  const error = vi.fn();
  const writer = createSettingsWriter({ read: () => view, apply: (s) => { view = s; }, error,
    save: (patch) => new Promise((resolve, reject) => requests.push({ patch, resolve, reject })),
  });
  return { writer, requests, error, view: () => view };
}
afterEach(() => vi.useRealTimers());

it("previews immediately and coalesces a slider into a single partial request", async () => {
  vi.useFakeTimers();
  const f = fixture();
  void f.writer.update({ mainAppearance: { opacity: .7 } }, true);
  const done = f.writer.update({ mainAppearance: { opacity: .4 } }, true);
  expect(f.view().mainAppearance.opacity).toBe(.4);
  expect(f.requests).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(300);
  expect(f.requests).toHaveLength(1);
  expect(f.requests[0].patch).toEqual({ mainAppearance: { opacity: .4 } });
  f.requests[0].resolve(f.view());
  await done;
});

it("preserves pending local fields over incoming changes from another window", async () => {
  const f = fixture();
  const first = f.writer.update({ mini: { opacity: .4 } });
  const second = f.writer.update({ mini: { opacity: .6 } });
  f.writer.receive(mergeSettings(DEFAULT_SETTINGS, { mini: { pinned: true, opacity: .4 } }));
  expect(f.view().mini).toMatchObject({ opacity: .6, pinned: true });
  f.requests[0].resolve(mergeSettings(DEFAULT_SETTINGS, { mini: { opacity: .4 } }));
  await first;
  expect(f.requests[1].patch).toEqual({ mini: { opacity: .6 } });
  f.requests[1].resolve(f.view());
  await second;
  expect(f.view().mini.pinned).toBe(true);
});

it("does not replace newer remote settings with a late acknowledgement", async () => {
  const f = fixture();
  const done = f.writer.update({ background: { blur: 12 } });
  const old = mergeSettings(DEFAULT_SETTINGS, { background: { blur: 12 } });
  f.writer.receive(mergeSettings(old, { background: { blur: 24 }, uiLanguage: "ja" }));
  f.requests[0].resolve(old);
  await done;
  expect(f.view().background.blur).toBe(24);
  expect(f.view().uiLanguage).toBe("ja");
});

it("rolls back a failed field without losing unrelated remote changes", async () => {
  const f = fixture();
  const done = f.writer.update({ mainAppearance: { opacity: .4 } });
  f.writer.receive(mergeSettings(DEFAULT_SETTINGS, { mini: { pinned: true } }));
  f.requests[0].reject(new Error("disk full"));
  await done;
  expect(f.view().mainAppearance.opacity).toBe(.85);
  expect(f.view().mini.pinned).toBe(true);
  expect(f.error).toHaveBeenCalledOnce();
});
