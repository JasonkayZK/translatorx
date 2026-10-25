export interface DraftSegment {
  source: string;
  breakAfter: boolean;
}

const CLAUSE_BREAK = /(?<=[，,;；:：、])/u;
const CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u;

function weight(s: string): number {
  // CJK text has no spaces, so count characters; otherwise count words.
  const t = s.replace(/[\p{P}\s]/gu, "");
  return CJK.test(t) ? t.length : s.trim().split(/\s+/).filter(Boolean).length * 2;
}

function sentences(paragraph: string, locale: string): string[] {
  const seg = new Intl.Segmenter(locale, { granularity: "sentence" });
  return Array.from(seg.segment(paragraph), (s) => s.segment.trim()).filter(Boolean);
}

/** Splits a sentence at commas when both halves are substantial enough to practise alone. */
function clauses(sentence: string): string[] {
  const pieces = sentence.split(CLAUSE_BREAK).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of pieces) {
    const last = out[out.length - 1];
    if (last !== undefined && (weight(last) < 4 || weight(p) < 4)) out[out.length - 1] = `${last}${CJK.test(p) ? "" : " "}${p}`;
    else out.push(p);
  }
  return out;
}

export function splitDraft(text: string, locale: string, mode: "sentence" | "clause" = "sentence"): DraftSegment[] {
  const paragraphs = text.replace(/\r\n?/g, "\n").split(/\n+/).map((p) => p.trim()).filter(Boolean);
  const out: DraftSegment[] = [];
  for (const p of paragraphs) {
    const parts = sentences(p, locale).flatMap((s) => (mode === "clause" ? clauses(s) : [s]));
    parts.forEach((source, i) => out.push({ source, breakAfter: i === parts.length - 1 }));
  }
  if (out.length) out[out.length - 1].breakAfter = false;
  return out;
}

/**
 * LLM segmentation loses paragraph structure; recover it by locating each chunk in the
 * original draft and checking whether a newline follows before the next chunk.
 */
export function recoverBreaks(text: string, sources: string[]): boolean[] {
  let pos = 0;
  const ends: number[] = [];
  for (const s of sources) {
    const probe = s.trim().slice(0, 6);
    const at = probe ? text.indexOf(probe, pos) : -1;
    if (at >= 0) pos = at + s.trim().length;
    ends.push(Math.min(pos, text.length));
  }
  return sources.map((_, i) => {
    if (i === sources.length - 1) return false;
    const nextProbe = sources[i + 1].trim().slice(0, 6);
    const nextAt = nextProbe ? text.indexOf(nextProbe, ends[i]) : -1;
    const gap = text.slice(ends[i], nextAt >= 0 ? nextAt : ends[i]);
    return gap.includes("\n");
  });
}
