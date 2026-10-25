export interface CheckOptions {
  ignoreCase: boolean;
  ignorePunctuation: boolean;
  ignoreAccents: boolean;
}

export const DEFAULT_CHECK: CheckOptions = { ignoreCase: true, ignorePunctuation: true, ignoreAccents: false };

export interface Token {
  text: string;
  norm: string;
  word: boolean;
}

export type Op =
  | { kind: "ok"; expected: Token; got: Token }
  | { kind: "typo"; expected: Token; got: Token }
  | { kind: "wrong"; expected: Token; got: Token }
  | { kind: "missing"; expected: Token }
  | { kind: "extra"; got: Token };

export interface CheckResult {
  ops: Op[];
  total: number;
  correct: number;
  typos: number;
  score: number; // 0..1
  perfect: boolean;
}

const APOSTROPHES = /[‘’ʼ＇]/g;
const QUOTES = /[“”«»「」]/g;

export function normalize(s: string, o: CheckOptions): string {
  let t = s.normalize("NFKC").replace(APOSTROPHES, "'").replace(QUOTES, '"');
  if (o.ignoreCase) t = t.toLocaleLowerCase();
  if (o.ignoreAccents) t = t.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC");
  return t;
}

const segmenters = new Map<string, Intl.Segmenter>();
function wordSegmenter(locale: string): Intl.Segmenter {
  let s = segmenters.get(locale);
  if (!s) {
    s = new Intl.Segmenter(locale, { granularity: "word" });
    segmenters.set(locale, s);
  }
  return s;
}

export interface RawSegment {
  text: string;
  word: boolean;
}

/** All segments including whitespace and punctuation, in order. */
export function rawSegments(text: string, locale: string): RawSegment[] {
  return Array.from(wordSegmenter(locale).segment(text), (s) => ({ text: s.segment, word: !!s.isWordLike }));
}

export function tokenize(text: string, locale: string, o: CheckOptions): Token[] {
  return rawSegments(text, locale)
    .filter((s) => s.word || (!o.ignorePunctuation && /\p{P}/u.test(s.text)))
    .map((s) => ({ text: s.text, norm: normalize(s.text, o), word: s.word }));
}

export function levenshtein(a: string, b: string): number {
  const A = Array.from(a);
  const B = Array.from(b);
  let prev = Array.from({ length: B.length + 1 }, (_, i) => i);
  for (let i = 1; i <= A.length; i++) {
    const cur = [i];
    for (let j = 1; j <= B.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[B.length];
}

/** A near miss: one slip in a medium word, two in a long one. */
export function isTypo(expected: string, got: string): boolean {
  const len = Array.from(expected).length;
  if (len < 4) return false;
  const d = levenshtein(expected, got);
  return d > 0 && d <= (len >= 8 ? 2 : 1);
}

/** Word-level alignment between the reference and the learner's answer. */
export function compare(expected: string, answer: string, locale: string, o: CheckOptions = DEFAULT_CHECK): CheckResult {
  const E = tokenize(expected, locale, o);
  const G = tokenize(answer, locale, o);
  const n = E.length;
  const m = G.length;
  const sub = (i: number, j: number) => (E[i].norm === G[j].norm ? 0 : isTypo(E[i].norm, G[j].norm) ? 0.5 : 1);

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i][0] = i;
  for (let j = 0; j <= m; j++) dp[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = Math.min(dp[i - 1][j - 1] + sub(i - 1, j - 1), dp[i - 1][j] + 1, dp[i][j - 1] + 1);
    }
  }

  const ops: Op[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + sub(i - 1, j - 1)) {
      const c = sub(i - 1, j - 1);
      const kind = c === 0 ? "ok" : c === 0.5 ? "typo" : "wrong";
      ops.push({ kind, expected: E[i - 1], got: G[j - 1] });
      i--;
      j--;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      ops.push({ kind: "missing", expected: E[i - 1] });
      i--;
    } else {
      ops.push({ kind: "extra", got: G[j - 1] });
      j--;
    }
  }
  ops.reverse();

  const correct = ops.filter((x) => x.kind === "ok").length;
  const typos = ops.filter((x) => x.kind === "typo").length;
  const extras = ops.filter((x) => x.kind === "extra").length;
  const total = n;
  const score = total === 0 ? 1 : Math.max(0, (correct + typos * 0.5 - extras * 0.25) / total);
  return { ops, total, correct, typos, score, perfect: total > 0 && correct === total && extras === 0 };
}

/** Index (into expected tokens) of the first word the learner has not got right yet. */
export function nextHintIndex(result: CheckResult): number {
  let idx = 0;
  for (const op of result.ops) {
    if (op.kind === "extra") continue;
    if (op.kind !== "ok") return idx;
    idx++;
  }
  return -1;
}

/** Progressive hint: first a prefix of about a third of the word, then the whole word. */
export function hintText(word: string, level: number): string {
  const chars = Array.from(word);
  if (level >= 2 || chars.length <= 2) return word;
  const n = Math.max(1, Math.ceil(chars.length / 3));
  return chars.slice(0, n).join("") + "…";
}

/**
 * Sentence hint that works with and without spaces: reveals the opening words (about a quarter,
 * then half) using the word segmenter, but never the whole sentence.
 */
export function sentenceHint(text: string, locale: string, level: number): string {
  const segs = rawSegments(text.trim(), locale);
  const words = segs.filter((s) => s.word).length;
  if (words <= 1) return hintText(text.trim(), level);
  const want = Math.min(words - 1, Math.max(1, Math.ceil(words * (level >= 2 ? 0.5 : 0.25))));
  let seen = 0;
  let out = "";
  for (const s of segs) {
    out += s.text;
    if (s.word && ++seen === want) break;
  }
  return `${out.trimEnd()}…`;
}

// ---------------------------------------------------------------- cloze

export type ClozePart = { type: "text"; text: string } | { type: "blank"; id: number; answer: string };

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Blanks out a share of the words, favouring longer (content) words so blanks carry meaning.
 * `ratio` 1 turns every word into a blank: full dictation with length hints.
 */
export function buildCloze(text: string, locale: string, ratio: number, salt = 0): ClozePart[] {
  const segs = rawSegments(text, locale);
  const words = segs.map((s, i) => ({ s, i })).filter((x) => x.s.word);
  const count = words.length === 0 ? 0 : Math.min(words.length, Math.max(1, Math.round(words.length * ratio)));
  const rand = seeded(hash(text) + salt);
  const chosen = new Set(
    words
      .map((w) => ({ i: w.i, score: Array.from(w.s.text).length + rand() * 3 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, count)
      .map((w) => w.i),
  );
  const parts: ClozePart[] = [];
  let id = 0;
  segs.forEach((s, i) => {
    if (chosen.has(i)) parts.push({ type: "blank", id: id++, answer: s.text });
    else {
      const last = parts[parts.length - 1];
      if (last && last.type === "text") last.text += s.text;
      else parts.push({ type: "text", text: s.text });
    }
  });
  return parts;
}

export function blankMatches(answer: string, input: string, o: CheckOptions): boolean {
  return normalize(answer.trim(), o) === normalize(input.trim(), o);
}

// ---------------------------------------------------------------- typing

export type CharState = "ok" | "bad" | "pending";

export interface TypingState {
  chars: { ch: string; state: CharState }[];
  errors: number;
  done: boolean;
  progress: number;
}

export function typingState(target: string, input: string, o: CheckOptions): TypingState {
  const T = Array.from(target);
  const I = Array.from(input);
  const eq = (a: string, b: string) => normalize(a, o) === normalize(b, o);
  let errors = 0;
  const chars = T.map((ch, k) => {
    if (k >= I.length) return { ch, state: "pending" as const };
    const ok = eq(ch, I[k]);
    if (!ok) errors++;
    return { ch, state: ok ? ("ok" as const) : ("bad" as const) };
  });
  errors += Math.max(0, I.length - T.length);
  return { chars, errors, done: I.length === T.length && errors === 0, progress: Math.min(1, I.length / Math.max(1, T.length)) };
}
