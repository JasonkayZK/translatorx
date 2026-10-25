import { setLocale } from "../lib/i18n";
import { describe, expect, it } from "vitest";
import { duration, finishSegment, nextPending, resultText, sessionPayload, summary, toSegments } from "./logic";

const draft = "周五下午三点见。\n我会把方案带过去。有问题随时找我。";
const out = [
  { source: "周五下午三点见。", target: "See you at 3 pm on Friday." },
  { source: "我会把方案带过去。", target: "I'll bring the proposal." },
  { source: "有问题随时找我。", target: "Let me know if you have questions." },
];

describe("quick window logic", () => {
  it("restores paragraph breaks and joins like the target language", () => {
    const segs = toSegments(out, draft);
    expect(segs.map((s) => s.breakAfter)).toEqual([true, false, false]);
    expect(resultText(segs, "en")).toBe("See you at 3 pm on Friday.\nI'll bring the proposal. Let me know if you have questions.");
  });

  it("walks to the next unfinished segment, wrapping around", () => {
    const segs = toSegments(out, draft);
    segs[1] = finishSegment(segs[1], { answer: "x", correct: 4, total: 4, hints: 0, revealed: false });
    expect(nextPending(segs, 0)).toBe(2);
    expect(nextPending(segs, 2)).toBe(0);
    segs[0] = finishSegment(segs[0], { answer: "", correct: 0, total: 7, hints: 0, revealed: true });
    segs[2] = finishSegment(segs[2], { answer: "y", correct: 5, total: 7, hints: 2, revealed: false });
    expect(nextPending(segs, 2)).toBe(-1);
    expect(segs[0].status).toBe("revealed");
  });

  it("sums the practice and records it like the main window", () => {
    const segs = toSegments(out, draft).map((s, i) => finishSegment(s, { answer: s.target, correct: i + 1, total: 4, hints: i, revealed: false }));
    expect(summary(segs)).toMatchObject({ total: 12, correct: 6, hints: 3, score: 0.5, revealed: 0 });
    const p = sessionPayload({ draft, from: "zh-CN", to: "en", mode: "recall", segs, durationMs: 72_000 });
    expect(p).toMatchObject({ segments: 3, totalWords: 12, correctWords: 6, hints: 3, mode: "recall" });
    expect(JSON.parse(p.detail)).toHaveLength(3);
  });

  it("formats durations in each interface language", () => {
    setLocale("zh-CN");
    expect(duration(40_000)).toBe("40 秒");
    expect(duration(72_000)).toBe("1 分 12 秒");
    setLocale("en");
    expect(duration(72_000)).toBe("1 min 12 sec");
    setLocale("ja");
    expect(duration(40_000)).toBe("40 秒");
    setLocale("en");
  });
});
