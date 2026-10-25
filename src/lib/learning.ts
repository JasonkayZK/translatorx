import { GOAL_KINDS } from "./types";
import type { ActivityContext, ActivityKind, ActivityMetric, GoalKind } from "./types";

export const ACTIVITY_KINDS: ActivityKind[] = ["translate", "read", "lookup", "practice", "review"];

/** Today's progress toward every goal kind, derived from learning activity alone. */
export type GoalProgress = Record<GoalKind, number>;
export type DateRange = "7" | "30" | "90" | "all";

/** Generated at the user action boundary, never as part of an effect submission. */
export function activityContext(kind: ActivityContext["kind"], origin: ActivityContext["origin"] = "main"): ActivityContext {
  return { eventId: crypto.randomUUID(), kind, origin };
}

export function localDay(value: number | Date): string {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function shiftDay(value: number | Date, offset: number): Date {
  const day = new Date(value);
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() + offset);
  return day;
}

export function rangeStart(range: DateRange, now = Date.now()): number | undefined {
  return range === "all" ? undefined : shiftDay(now, 1 - Number(range)).getTime();
}

export interface ActivityDay {
  date: string;
  label: string;
  count: number;
  totalWords: number;
  correctWords: number;
  accuracy: number | null;
}

/** Calendar arithmetic deliberately uses setDate: local days may be 23 or 25 hours. */
export function summarizeActivities(activities: ActivityMetric[], now = Date.now(), locale = "en") {
  const daily = new Map<string, ActivityDay>();
  const kinds = Object.fromEntries(ACTIVITY_KINDS.map((kind) => [kind, 0])) as Record<ActivityKind, number>;
  const languages = new Map<string, { sourceLang: string; targetLang: string; count: number }>();
  let totalWords = 0, correctWords = 0, durationMs = 0, todaySegments = 0, practiceSegments = 0, todayDurationMs = 0;
  const todayKey = localDay(now);
  const today = Object.fromEntries(GOAL_KINDS.map((kind) => [kind, 0])) as GoalProgress;
  const formatter = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" });
  for (const a of activities) {
    if (a.createdAt > now) continue;
    const date = localDay(a.createdAt);
    const isToday = date === todayKey;
    if (isToday) {
      today.activities++;
      if (a.kind === "translate") today.translations++;
      else if (a.kind === "read") today.reads++;
      else if (a.kind === "lookup") today.lookups++;
      else if (a.kind === "review") today.reviews++;
    }
    const entry = daily.get(date) ?? { date, label: formatter.format(new Date(a.createdAt)), count: 0, totalWords: 0, correctWords: 0, accuracy: null };
    entry.count++;
    kinds[a.kind] = (kinds[a.kind] ?? 0) + 1;
    const pair = `${a.sourceLang}\0${a.targetLang}`;
    const language = languages.get(pair) ?? { sourceLang: a.sourceLang, targetLang: a.targetLang, count: 0 };
    language.count++;
    languages.set(pair, language);
    if (a.kind === "practice") {
      const words = Math.max(0, a.totalWords);
      const correct = Math.max(0, Math.min(words, a.correctWords));
      entry.totalWords += words;
      entry.correctWords += correct;
      totalWords += words;
      practiceSegments += Math.max(0, a.segments);
      correctWords += correct;
      durationMs += Math.max(0, a.durationMs);
      if (isToday) {
        todaySegments += a.segments;
        today.practice += Math.max(0, a.segments);
        today.words += words;
        todayDurationMs += Math.max(0, a.durationMs);
      }
    }
    entry.accuracy = entry.totalWords ? entry.correctWords / entry.totalWords : null;
    daily.set(date, entry);
  }
  let cursor = shiftDay(now, daily.has(localDay(now)) ? 0 : -1);
  let streak = 0;
  while (daily.has(localDay(cursor))) {
    streak++;
    cursor = shiftDay(cursor, -1);
  }
  const todayCount = daily.get(todayKey)?.count ?? 0;
  today.minutes = Math.floor(todayDurationMs / 60_000);
  const days = [...daily.values()].sort((a, b) => a.date.localeCompare(b.date));
  return { count: days.reduce((sum, d) => sum + d.count, 0), activeDays: days.length, days, kinds,
    languages: [...languages.values()].sort((a, b) => b.count - a.count),
    totalWords, correctWords, durationMs, todayCount, practiceSegments, accuracy: totalWords ? correctWords / totalWords : null, streak, todaySegments, today };
}

export type LearningSummary = ReturnType<typeof summarizeActivities>;

/** Goals with a target, in the order chosen for the "Today" card, with the progress made today. */
export function goalRows(goals: Record<GoalKind, number>, order: GoalKind[], today: GoalProgress) {
  return order.map((kind) => ({ kind, value: today[kind], target: goals[kind], done: goals[kind] > 0 && today[kind] >= goals[kind] }));
}

export function calendarDays(days: ActivityDay[], since: number, now = Date.now(), locale = "en"): ActivityDay[] {
  const entries = new Map(days.map((d) => [d.date, d]));
  const result: ActivityDay[] = [];
  const formatter = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" });
  for (let d = shiftDay(since, 0); d.getTime() <= now; d = shiftDay(d, 1)) {
    const date = localDay(d);
    result.push(entries.get(date) ?? { date, label: formatter.format(d), count: 0, totalWords: 0, correctWords: 0, accuracy: null });
  }
  return result;
}
