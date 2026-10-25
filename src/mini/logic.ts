import { t as tr } from "../lib/i18n";
// Pure helpers behind the quick-translate window, kept apart from React for testing.
import type { CheckResult } from "../lib/check";
import { joinSegments } from "../lib/languages";
import { recoverBreaks } from "../lib/segment";
import type { NewSession, PracticeMode, Segment } from "../lib/types";
import type { ModeResult } from "../pages/Write/modes";

export interface MiniSegment {
  source: string;
  target: string;
  breakAfter: boolean;
  status: "pending" | "done" | "revealed";
  answer: string;
  correct: number;
  total: number;
  hints: number;
  score: number;
  /** Checked recall attempts, for the red-pen markup. */
  tries: CheckResult[];
}

/** Practice segments from translated chunks, with the draft's paragraph breaks restored. */
export function toSegments(out: Segment[], draft: string): MiniSegment[] {
  const breaks = recoverBreaks(draft, out.map((o) => o.source));
  return out.map((o, i) => ({
    source: o.source,
    target: o.target,
    breakAfter: breaks[i],
    status: "pending",
    answer: "",
    correct: 0,
    total: 0,
    hints: 0,
    score: 0,
    tries: [],
  }));
}

/** The whole translation, joined the way the target language is written. */
export function resultText(segs: MiniSegment[], to: string): string {
  return joinSegments(segs.map((s) => ({ text: s.target, breakAfter: s.breakAfter })), to);
}

/** A segment marked as finished by a practice mode. */
export function finishSegment(seg: MiniSegment, r: ModeResult): MiniSegment {
  return {
    ...seg,
    answer: r.answer,
    status: r.revealed ? "revealed" : "done",
    correct: r.correct,
    total: r.total,
    hints: r.hints,
    score: r.total ? r.correct / r.total : 0,
  };
}

/** Index of the next unfinished segment after `current` (wrapping around), or -1 when all are done. */
export function nextPending(segs: MiniSegment[], current: number): number {
  const after = segs.findIndex((s, i) => i > current && s.status === "pending");
  return after >= 0 ? after : segs.findIndex((s) => s.status === "pending");
}

export function summary(segs: MiniSegment[]) {
  const total = segs.reduce((a, s) => a + s.total, 0);
  const correct = segs.reduce((a, s) => a + s.correct, 0);
  const hints = segs.reduce((a, s) => a + s.hints, 0);
  return { total, correct, hints, score: total ? correct / total : 1, revealed: segs.filter((s) => s.status === "revealed").length };
}

/** A practice record in the same shape the main window's finish page saves. */
export function sessionPayload(p: { draft: string; from: string; to: string; mode: PracticeMode; segs: MiniSegment[]; durationMs: number }): NewSession {
  const sum = summary(p.segs);
  return {
    sourceLang: p.from,
    targetLang: p.to,
    draft: p.draft,
    result: resultText(p.segs, p.to),
    mode: p.mode,
    segments: p.segs.length,
    totalWords: sum.total,
    correctWords: sum.correct,
    hints: sum.hints,
    durationMs: p.durationMs,
    detail: JSON.stringify(p.segs.map(({ source, target, breakAfter, answer, score, status }) => ({ source, target, breakAfter, answer, score, status }))),
  };
}

/** "1 分 12 秒" / "40 秒". */
export function duration(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? tr("{p0} sec", { p0: s }) : tr("{p0} min {p1} sec", { p0: Math.floor(s / 60), p1: s % 60 });
}
