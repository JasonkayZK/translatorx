// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockInvoke, mockOnEvent } from "./mock";
import { DEFAULT_SETTINGS } from "./types";
import type { ActivityMetric, LearningActivity, NewSession, Settings, Stats, Word } from "./types";

const KEY = "translatorx.mock.v1";
const session: NewSession = { sourceLang: "zh-CN", targetLang: "en", draft: "你好", result: "Hello", mode: "recall", segments: 1, totalWords: 1, correctWords: 1, durationMs: 1000, hints: 0, detail: "[]" };
function empty() { return { settings: DEFAULT_SETTINGS, words: [], sentences: [], sessions: [], activities: [], receipts: {}, seq: 1 }; }
beforeEach(() => { localStorage.setItem(KEY, JSON.stringify(empty())); vi.restoreAllMocks(); });

describe("browser learning persistence", () => {
  it("merges independent settings patches against the latest stored settings", async () => {
    await Promise.all([
      mockInvoke("patch_settings", { patch: { mini: { pinned: true } } }),
      mockInvoke("patch_settings", { patch: { mainAppearance: { opacity: .4 }, mini: { useBackground: true } } }),
    ]);
    expect(await mockInvoke("get_settings", {})).toMatchObject({ mini: { pinned: true, useBackground: true }, mainAppearance: { opacity: .4 } });
  });
  it("migrates old sessions once and deeply normalizes old settings", async () => {
    const old = { ...empty(), activities: undefined, receipts: undefined, settings: { nativeLang: "ja", mini: { opacity: 0.9 } }, sessions: [{ ...session, id: 2, createdAt: 10 }], seq: 3 };
    localStorage.setItem(KEY, JSON.stringify(old));
    const settings = await mockInvoke<Settings>("get_settings", {});
    expect(settings).toMatchObject({ nativeLang: "ja", uiLanguage: "system", mini: { opacity: 0.9, theme: "inherit", style: "paper" } });
    const [row] = await mockInvoke<LearningActivity[]>("list_activities", {});
    expect(row).toMatchObject({ kind: "practice", eventId: "legacy-session:2" });
    await mockInvoke("delete_activity", { id: row.id });
    expect(await mockInvoke("list_activities", {})).toEqual([]);
    expect(await mockInvoke("list_sessions", {})).toEqual([]);
  });

  it("records without favorites, deduplicates retries and retains deletion receipts", async () => {
    const params = { session, eventId: "same-practice", origin: "mini" };
    const id = await mockInvoke("add_session", params);
    expect(await mockInvoke("add_session", params)).toBe(id);
    const rows = await mockInvoke<LearningActivity[]>("list_activities", {});
    expect(rows).toHaveLength(1);
    expect(await mockInvoke("list_words", {})).toEqual([]);
    await mockInvoke("delete_activity", { id: rows[0].id });
    expect(await mockInvoke("add_session", params)).toBe(id);
    expect(await mockInvoke("list_sessions", {})).toEqual([]);
    expect(await mockInvoke("list_activities", {})).toEqual([]);
  });

  it("does not record internal lookups and never uses favorites for streaks", async () => {
    await mockInvoke("lookup_word", { text: "hello", lang: "en", native: "zh-CN" });
    const word = await mockInvoke<Word>("add_word", { word: { text: "hello", lang: "en" } });
    expect((await mockInvoke<Stats>("get_stats", {})).streakDays).toBe(0);
    await mockInvoke("lookup_word", { text: "hello", lang: "en", native: "zh-CN", activity: { eventId: "lookup-one", kind: "lookup", origin: "main" } });
    await mockInvoke("delete_item", { kind: "word", id: word.id });
    expect(await mockInvoke("list_activities", {})).toHaveLength(1);
    expect((await mockInvoke<Stats>("get_stats", {}))).toMatchObject({ streakDays: 1, practicedWords: 0, accuracy: 0, wordsTotal: 0 });
  });

  it("retries review once, keeps history after favorite deletion and leaves schedules after history deletion", async () => {
    const word = await mockInvoke<Word>("add_word", { word: { text: "hello", lang: "en" } });
    const choice = { kind: "word", id: word.id, grade: 2, eventId: "review-one" };
    const due = await mockInvoke("review_item", choice);
    expect(await mockInvoke("review_item", choice)).toBe(due);
    expect((await mockInvoke<Word[]>("list_words", {}))[0].reps).toBe(1);
    const [row] = await mockInvoke<LearningActivity[]>("list_activities", {});
    await mockInvoke("delete_activity", { id: row.id });
    expect(await mockInvoke("review_item", choice)).toBe(due);
    expect((await mockInvoke<Word[]>("list_words", {}))[0].dueAt).toBe(due);
    await mockInvoke("review_item", { ...choice, eventId: "review-two" });
    await mockInvoke("delete_item", { kind: "word", id: word.id });
    expect(await mockInvoke("list_activities", {})).toHaveLength(1);
  });

  it("filters and paginates stable order while metrics omit content", async () => {
    for (let i = 0; i < 5; i++) await mockInvoke("add_session", { session, eventId: `practice-${i}` });
    const first = await mockInvoke<LearningActivity[]>("list_activities", { limit: 2, offset: 0, kind: "practice" });
    const next = await mockInvoke<LearningActivity[]>("list_activities", { limit: 2, offset: 2 });
    expect(first).toHaveLength(2); expect(next).toHaveLength(2);
    expect(new Set([...first, ...next].map((x) => x.id)).size).toBe(4);
    expect(await mockInvoke("list_activities", { since: Date.now() + 1000 })).toEqual([]);
    const metrics = await mockInvoke<ActivityMetric[]>("activity_metrics", {});
    expect(metrics).toHaveLength(5);
    expect(metrics[0]).not.toHaveProperty("source");
    expect(metrics[0]).not.toHaveProperty("detail");
  });

  it("notifies this window and other windows after persistence", async () => {
    const learning = vi.fn(), settings = vi.fn();
    const offLearning = mockOnEvent("learning-changed", learning), offSettings = mockOnEvent("settings-changed", settings);
    await mockInvoke("add_session", { session, eventId: "local-event" });
    expect(learning).toHaveBeenCalledTimes(1);
    const previous = localStorage.getItem(KEY);
    const next = JSON.stringify({ ...empty(), settings: { ...DEFAULT_SETTINGS, uiLanguage: "ja" } });
    localStorage.setItem(KEY, next);
    window.dispatchEvent(new StorageEvent("storage", { key: KEY, oldValue: previous, newValue: next }));
    expect(learning).toHaveBeenCalledTimes(2);
    expect(settings).toHaveBeenCalledWith(expect.objectContaining({ uiLanguage: "ja", mini: expect.objectContaining({ theme: "inherit" }) }));
    offLearning(); offSettings();
  });

  it("rolls failed practice persistence back so the same event can retry", async () => {
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => { throw new Error("disk full"); });
    await expect(mockInvoke("add_session", { session, eventId: "retry" })).rejects.toThrow("disk full");
    write.mockRestore();
    expect(await mockInvoke("list_activities", {})).toEqual([]);
    await mockInvoke("add_session", { session, eventId: "retry" });
    expect(await mockInvoke("list_activities", {})).toHaveLength(1);
  });
});

it("keeps a lookup result usable and emits the native unit warning if history saving fails", async () => {
  const failed = vi.fn();
  const off = mockOnEvent("learning-save-failed", failed);
  vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => { throw new Error("disk full"); });
  const result = await mockInvoke<{ text: string }>("lookup_word", { text: "hello", lang: "en", native: "zh-CN", activity: { eventId: "unsaved-lookup", kind: "lookup", origin: "main" } });
  expect(result.text).toBe("hello");
  expect(failed).toHaveBeenCalledWith(undefined);
  expect(await mockInvoke("list_activities", {})).toEqual([]);
  off();
});

it("keeps the completion date when a practice is saved the following day", async () => {
  const completedAt = Date.now() - 86_400_000;
  await mockInvoke("add_session", { session, eventId: "yesterday", completedAt });
  const [activity] = await mockInvoke<LearningActivity[]>("list_activities", {});
  const [saved] = await mockInvoke<{ createdAt: number }[]>("list_sessions", {});
  expect(activity.createdAt).toBe(completedAt);
  expect(saved.createdAt).toBe(completedAt);
  expect((await mockInvoke<Stats>("get_stats", {})).todaySegments).toBe(0);
});
