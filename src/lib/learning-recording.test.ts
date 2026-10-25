// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { api } from "./api";
import { DEFAULT_SETTINGS } from "./types";
import { useApp } from "../store";
import { useMini } from "../mini/store";
import { toPractice } from "../pages/Write/Compose";
import { Finish } from "../pages/Write/Finish";
import { toSegments } from "../mini/logic";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  useApp.setState({ settings: DEFAULT_SETTINGS, draft: "你好", from: "zh-CN", to: "en", toasts: [], stage: "compose", practiceSave: "idle" });
  useMini.setState({ settings: DEFAULT_SETTINGS, draft: "你好", from: "zh-CN", to: "en", practiceRecord: null });
});
afterEach(() => { vi.restoreAllMocks(); });
const out = [{ source: "你好", target: "Hello", breakAfter: false }];
function completeMain() {
  useApp.getState().startPractice(toPractice(out));
  useApp.getState().patchSegment(0, { status: "done", total: 1, correct: 1, score: 1 });
  useApp.getState().setStage("finish");
}

describe("practice recording", () => {
  it("coalesces StrictMode effect saves and only marks the main practice saved after success", async () => {
    let resolve!: (id: number) => void;
    const save = vi.spyOn(api, "addSession").mockImplementation(() => new Promise<number>((yes) => { resolve = yes; }));
    completeMain();
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(StrictMode, null, createElement(Finish))));
    expect(save).toHaveBeenCalledTimes(1);
    expect(useApp.getState().practiceSave).toBe("saving");
    await act(async () => { resolve(10); });
    expect(useApp.getState().practiceSave).toBe("saved");
    await act(async () => root.unmount());
    await useApp.getState().savePractice();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("keeps the same main event and duration for retry, and assigns a new ID to the next session", async () => {
    const save = vi.spyOn(api, "addSession").mockRejectedValueOnce(new Error("disk full")).mockResolvedValue(9);
    completeMain();
    await useApp.getState().savePractice();
    expect(useApp.getState().practiceSave).toBe("error");
    await useApp.getState().savePractice();
    expect(save.mock.calls[0]).toEqual(save.mock.calls[1]);
    expect(useApp.getState().practiceSave).toBe("saved");
    const id = useApp.getState().practiceId;
    completeMain();
    expect(useApp.getState().practiceId).not.toBe(id);
  });

  it("does not record incomplete main or mini practices", async () => {
    const save = vi.spyOn(api, "addSession").mockResolvedValue(1);
    useApp.getState().startPractice(toPractice(out));
    await useApp.getState().savePractice();
    useMini.setState({ segments: toSegments(out, "你好"), stage: "practice", current: 0 });
    useMini.getState().next();
    expect(save).not.toHaveBeenCalled();
  });

  it("keeps the mini payload retryable even when the input is reset", async () => {
    const save = vi.spyOn(api, "addSession").mockRejectedValueOnce(new Error("disk full")).mockResolvedValue(2);
    useMini.setState({ segments: toSegments(out, "你好").map((s) => ({ ...s, status: "done", total: 1, correct: 1 })), current: 0, stage: "practice", practiceId: "mini-practice", startedAt: Date.now() - 1000 });
    useMini.getState().next();
    await vi.waitFor(() => expect(useMini.getState().practiceRecord?.status).toBe("error"));
    useMini.getState().reset();
    await useMini.getState().retryPractice();
    expect(useMini.getState().practiceRecord?.status).toBe("saved");
    expect(save.mock.calls[0]).toEqual(save.mock.calls[1]);
    expect(save.mock.calls[1][1]).toBe("mini-practice");
  });
});

it("keeps one review grade and event ID through a failed save and ignores double clicks", async () => {
  const { ReviewPage } = await import("../pages/Review");
  const { setLocale } = await import("./i18n");
  setLocale("en");
  const word = { id: 1, text: "hello", meaning: "你好", lang: "en", context: "", contextTranslation: "", note: "", createdAt: 0, dueAt: 0, intervalDays: 0, ease: 2.5, reps: 0, lapses: 0 };
  vi.spyOn(api, "dueItems").mockResolvedValue({ words: [word], sentences: [] });
  let reject!: (error: Error) => void;
  const save = vi.spyOn(api, "reviewItem").mockImplementationOnce(() => new Promise<number>((_, no) => { reject = no; })).mockResolvedValue(100);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.startsWith(text))!;
  await act(async () => root.render(createElement(ReviewPage)));
  await act(async () => button("Start review").click());
  await act(async () => button("I cannot remember").click());
  await act(async () => { button("Forgot").click(); button("Forgot").click(); });
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => { reject(new Error("disk full")); });
  expect(button("Easy").disabled).toBe(true);
  await act(async () => button("Retry").click());
  expect(save.mock.calls[0]).toEqual(save.mock.calls[1]);
  await act(async () => button("I cannot remember").click());
  await act(async () => button("Easy").click());
  expect(save.mock.calls[2][3]).not.toBe(save.mock.calls[1][3]);
  expect(save.mock.calls[2][2]).toBe(3);
  await act(async () => root.unmount());
  host.remove();
});


it("preserves failed main practice until saved and retries on its original completion date", async () => {
  const save = vi.spyOn(api, "addSession").mockRejectedValueOnce(new Error("disk full")).mockResolvedValue(1);
  completeMain();
  const completedAt = useApp.getState().completedAt;
  const segments = useApp.getState().segments;
  await useApp.getState().savePractice();
  useApp.getState().newDraft();
  // Reading and Notebook drills set their draft and language pair before starting.
  useApp.getState().setPair("ja", "en");
  useApp.getState().setDraft("a different drill");
  useApp.getState().startPractice(toPractice(out));
  expect(useApp.getState().stage).toBe("finish");
  expect(useApp.getState().segments).toBe(segments);
  vi.spyOn(Date, "now").mockReturnValue(completedAt + 86_400_000);
  await useApp.getState().savePractice();
  expect(save.mock.calls[1][3]).toBe(completedAt);
  expect(save.mock.calls[0]).toEqual(save.mock.calls[1]);
  useApp.getState().newDraft();
  expect(useApp.getState().stage).toBe("compose");
});

it("keeps failed mini completion through restart and a new translation attempt", async () => {
  const save = vi.spyOn(api, "addSession").mockRejectedValueOnce(new Error("disk full")).mockResolvedValue(2);
  const translate = vi.spyOn(api, "prepareSession").mockResolvedValue(out);
  const completedAt = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(completedAt);
  useMini.setState({ segments: toSegments(out, "你好").map(s => ({ ...s, status: "done", total: 1, correct: 1 })), current: 0, stage: "practice", practiceId: "stable-mini", startedAt: completedAt - 1000 });
  useMini.getState().next();
  await vi.waitFor(() => expect(useMini.getState().practiceRecord?.status).toBe("error"));
  useMini.getState().restart();
  expect(useMini.getState().stage).toBe("done");
  useMini.getState().reset();
  await useMini.getState().translate();
  expect(translate).not.toHaveBeenCalled();
  vi.spyOn(Date, "now").mockReturnValue(completedAt + 86_400_000);
  await useMini.getState().retryPractice();
  expect(save.mock.calls[1][3]).toBe(completedAt);
  expect(save.mock.calls[0]).toEqual(save.mock.calls[1]);
});
