import { describe, expect, it } from "vitest";
import { calendarDays, localDay, rangeStart, shiftDay, summarizeActivities } from "./learning";
import type { ActivityMetric } from "./types";

const metric = (patch: Partial<ActivityMetric> = {}): ActivityMetric => ({ createdAt: new Date(2026, 8, 29, 12).getTime(), kind: "practice", sourceLang: "zh-CN", targetLang: "en", segments: 1, totalWords: 1, correctWords: 1, durationMs: 1000, ...patch });
const now = new Date(2026, 8, 29, 18).getTime();

describe("learning summaries", () => {
  it("weights practice by words and excludes every other activity from accuracy", () => {
    const data = [metric(), metric({ totalWords: 9, correctWords: 0 }), ...(["translate", "read", "lookup", "review"] as const).map((kind) => metric({ kind, totalWords: 100, correctWords: 100 }))];
    const summary = summarizeActivities(data, now);
    expect(summary).toMatchObject({ count: 6, accuracy: 0.1, totalWords: 10, correctWords: 1, activeDays: 1, durationMs: 2000, todaySegments: 2, todayCount: 6, practiceSegments: 2 });
    expect(summary.kinds).toEqual({ practice: 2, translate: 1, read: 1, lookup: 1, review: 1 });
    expect(summary.languages[0].count).toBe(6);
  });

  it("represents no activity and no practice without a fabricated score", () => {
    expect(summarizeActivities([], now)).toMatchObject({ count: 0, accuracy: null, streak: 0, activeDays: 0 });
    expect(summarizeActivities([metric({ kind: "translate" })], now).accuracy).toBeNull();
  });

  it("counts local days across midnight and keeps yesterday's streak until today ends", () => {
    const rows = [metric({ createdAt: new Date(2026, 8, 27, 23, 59).getTime() }), metric({ createdAt: new Date(2026, 8, 28, 0, 1).getTime(), kind: "lookup" })];
    const summary = summarizeActivities(rows, now, "ja");
    expect(summary.days.map((x) => x.date)).toEqual(["2026-09-27", "2026-09-28"]);
    expect(summary.streak).toBe(2);
    expect(summarizeActivities(rows, new Date(2026, 8, 30).getTime()).streak).toBe(0);
    expect(summary.days[0].label).toContain("9月");
  });

  it("uses calendar ranges over daylight-saving changes and ignores future timestamps", () => {
    const end = new Date(2026, 2, 10, 12).getTime();
    const since = rangeStart("7", end)!;
    expect(localDay(since)).toBe("2026-03-04");
    expect(calendarDays([], since, end).map((x) => x.date)).toEqual(["2026-03-04", "2026-03-05", "2026-03-06", "2026-03-07", "2026-03-08", "2026-03-09", "2026-03-10"]);
    expect(localDay(shiftDay(new Date(2026, 2, 8), 1))).toBe("2026-03-09");
    expect(rangeStart("all", now)).toBeUndefined();
    expect(summarizeActivities([metric({ createdAt: now + 1 })], now).count).toBe(0);
  });
});
