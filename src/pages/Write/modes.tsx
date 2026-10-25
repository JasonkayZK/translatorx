import { t as tr } from "../../lib/i18n";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { blankMatches, buildCloze, compare, hintText, nextHintIndex, tokenize, typingState } from "../../lib/check";
import type { CheckOptions, CheckResult } from "../../lib/check";
import { lang } from "../../lib/languages";
import { cx } from "../../components/ui";

export interface ModeResult {
  answer: string;
  correct: number;
  total: number;
  hints: number;
  revealed: boolean;
  result?: CheckResult;
}

export interface ModeHandle {
  check: () => void;
  hint: () => void;
  reveal: () => void;
  focus: () => void;
}

interface ModeProps {
  target: string;
  code: string;
  opts: CheckOptions;
  onDone: (r: ModeResult) => void;
  onAttempt?: (r: CheckResult) => void;
  /** Smaller type for the quick-translate window. */
  compact?: boolean;
}

const composing = (e: React.KeyboardEvent) => e.nativeEvent.isComposing || e.keyCode === 229;

// ------------------------------------------------------------------ Recall (默写)

export const RecallMode = forwardRef<ModeHandle, ModeProps>(function RecallMode({ target, code, opts, onDone, onAttempt, compact }, ref) {
  const [answer, setAnswer] = useState("");
  const [last, setLast] = useState<CheckResult | null>(null);
  const [first, setFirst] = useState<number | null>(null);
  const [levels, setLevels] = useState<Record<number, number>>({});
  const [hints, setHints] = useState(0);
  const [shake, setShake] = useState(0);
  const input = useRef<HTMLTextAreaElement>(null);

  const expected = useMemo(() => tokenize(target, code, opts), [target, code, opts]);
  const live = useMemo(() => compare(target, answer, code, opts), [target, answer, code, opts]);
  const okSlots = useMemo(() => {
    const s = new Set<number>();
    let k = 0;
    for (const op of live.ops) {
      if (op.kind === "extra") continue;
      if (op.kind === "ok") s.add(k);
      k++;
    }
    return s;
  }, [live]);

  useEffect(() => {
    input.current?.focus();
  }, []);

  // Auto-grow the textarea.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.max(el.scrollHeight, compact ? 56 : 92)}px`;
  }, [answer, compact]);

  const finish = (r: CheckResult, revealed: boolean) => {
    const fullHints = Object.values(levels).filter((l) => l >= 2).length;
    const base = first ?? r.correct;
    onDone({ answer, correct: Math.max(0, Math.min(base, r.total) - fullHints), total: r.total, hints, revealed, result: r });
  };

  const check = () => {
    if (!answer.trim()) {
      setShake((n) => n + 1);
      return;
    }
    const r = compare(target, answer, code, opts);
    setLast(r);
    onAttempt?.(r);
    if (first === null) setFirst(r.correct);
    if (r.perfect) finish(r, false);
    else setShake((n) => n + 1);
  };

  useImperativeHandle(ref, () => ({
    check,
    hint: () => {
      let idx = nextHintIndex(live);
      if (idx < 0) idx = expected.findIndex((_, k) => !okSlots.has(k));
      if (idx < 0) return;
      setLevels((l) => ({ ...l, [idx]: Math.min(2, (l[idx] ?? 0) + 1) }));
      setHints((h) => h + 1);
      input.current?.focus();
    },
    reveal: () => {
      const r = last ?? live;
      const fullHints = Object.values(levels).filter((l) => l >= 2).length;
      onDone({ answer, correct: Math.max(0, (first ?? 0) - fullHints), total: r.total, hints, revealed: true, result: answer.trim() ? r : undefined });
    },
    focus: () => input.current?.focus(),
  }));

  const spaced = lang(code).spaced;
  return (
    <div>
      <div key={shake} className={cx(shake > 0 && "animate-shake")}>
        <textarea
          ref={input}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !composing(e)) {
              e.preventDefault();
              check();
            }
          }}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          placeholder={tr("Write in {p0} from memory…", { p0: lang(code).label })}
          className={cx(
            "practice-input w-full resize-none bg-transparent font-display text-ink outline-none placeholder:text-ink-3/70",
            compact ? "text-[16px] leading-[1.75rem]" : "text-[23px] leading-[2.4rem]",
          )}
          style={{ ["--rule" as string]: compact ? "1.75rem" : "2.4rem" }}
        />
      </div>

      {/* Word slots: one per expected word, lit as you get each one right. */}
      <div className={cx("flex flex-wrap items-end", compact ? "mt-2.5 gap-y-2" : "mt-4 gap-y-3", spaced ? "gap-x-2" : "gap-x-1")} aria-label={tr("Word progress")}>
        {expected.map((t, k) => {
          const lvl = levels[k] ?? 0;
          const len = Array.from(t.text).length;
          return (
            <div key={k} className="flex flex-col items-center gap-1">
              <span className={cx("h-4 font-display text-[13px] leading-4 whitespace-nowrap italic", lvl ? "text-amber" : "invisible")}>
                {lvl ? hintText(t.text, lvl) : "·"}
              </span>
              <span
                className={cx("h-[5px] rounded-full transition-all duration-300", okSlots.has(k) ? "bg-moss" : lvl ? "bg-amber/60" : "bg-line-2")}
                style={{ width: `${Math.min(7, Math.max(spaced ? 1.1 : 0.9, len * (spaced ? 0.5 : 0.9)))}rem` }}
              />
            </div>
          );
        })}
        <span className="ml-2 font-mono text-[11px] text-ink-3">
          {okSlots.size}/{expected.length}
        </span>
      </div>
    </div>
  );
});

// ------------------------------------------------------------------ Cloze (填空)

export const ClozeMode = forwardRef<ModeHandle, ModeProps & { ratio: number }>(function ClozeMode({ target, code, opts, ratio, onDone, compact }, ref) {
  const parts = useMemo(() => buildCloze(target, code, ratio), [target, code, ratio]);
  const blanks = parts.filter((p) => p.type === "blank") as { type: "blank"; id: number; answer: string }[];
  const [values, setValues] = useState<Record<number, string>>({});
  const [bad, setBad] = useState<Set<number>>(new Set());
  const [firstBad, setFirstBad] = useState<Set<number> | null>(null);
  const [hinted, setHinted] = useState<Record<number, number>>({});
  const [focused, setFocused] = useState(0);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  const ok = (id: number) => blankMatches(blanks[id].answer, values[id] ?? "", opts);
  const allOk = (v: Record<number, string>) => blanks.every((b) => blankMatches(b.answer, v[b.id] ?? "", opts));

  useEffect(() => {
    inputs.current[0]?.focus();
  }, []);

  const done = (revealed: boolean, fb: Set<number>, vals: Record<number, string>, hintMap: Record<number, number>) => {
    const answer = parts.map((p) => (p.type === "text" ? p.text : vals[p.id] ?? "")).join("");
    // A blank counts when it was right on the first check and not fully given away by hints.
    const correct = blanks.filter((b) => !fb.has(b.id) && (hintMap[b.id] ?? 0) < 2 && (!revealed || blankMatches(b.answer, values[b.id] ?? "", opts))).length;
    onDone({ answer, correct, total: blanks.length, hints: Object.values(hintMap).reduce((a, b) => a + b, 0), revealed });
  };

  const setValue = (id: number, v: string, hintMap = hinted) => {
    const next = { ...values, [id]: v };
    setValues(next);
    setBad((b) => {
      const n = new Set(b);
      n.delete(id);
      return n;
    });
    if (blankMatches(blanks[id].answer, v, opts)) {
      if (allOk(next)) {
        done(false, firstBad ?? new Set(), next, hintMap);
        return;
      }
      const nextId = blanks.findIndex((b, k) => k > id && !blankMatches(b.answer, next[b.id] ?? "", opts));
      const fallback = blanks.findIndex((b) => !blankMatches(b.answer, next[b.id] ?? "", opts));
      inputs.current[nextId >= 0 ? nextId : fallback]?.focus();
    }
  };

  const check = () => {
    const wrong = new Set(blanks.filter((b) => !ok(b.id)).map((b) => b.id));
    const fb = firstBad ?? wrong;
    if (!firstBad) setFirstBad(wrong);
    if (wrong.size === 0) done(false, fb, values, hinted);
    else {
      setBad(wrong);
      inputs.current[[...wrong][0]]?.focus();
    }
  };

  useImperativeHandle(ref, () => ({
    check,
    hint: () => {
      const id = !ok(focused) ? focused : blanks.findIndex((b) => !ok(b.id));
      if (id < 0) return;
      const lvl = Math.min(2, (hinted[id] ?? 0) + 1);
      const hintMap = { ...hinted, [id]: lvl };
      setHinted(hintMap);
      setValue(id, hintText(blanks[id].answer, lvl).replace("…", ""), hintMap);
      inputs.current[id]?.focus();
    },
    reveal: () => {
      const full = Object.fromEntries(blanks.map((b) => [b.id, b.answer]));
      setValues(full);
      done(true, firstBad ?? new Set(blanks.filter((b) => !ok(b.id)).map((b) => b.id)), full, hinted);
    },
    focus: () => inputs.current[focused]?.focus(),
  }));

  return (
    <div className={cx("font-display text-ink", compact ? "text-[16px] leading-[2.2rem]" : "text-[23px] leading-[2.9rem]")}>
      {parts.map((p, i) =>
        p.type === "text" ? (
          <span key={i} className="whitespace-pre-wrap">{p.text}</span>
        ) : (
          <input
            key={i}
            ref={(el) => {
              inputs.current[p.id] = el;
            }}
            value={values[p.id] ?? ""}
            onChange={(e) => setValue(p.id, e.target.value)}
            onFocus={() => setFocused(p.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !composing(e)) {
                e.preventDefault();
                check();
              }
            }}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            aria-label={tr("Blank {p0}", { p0: p.id + 1 })}
            className={cx(
              "mx-[0.08em] inline-block border-0 border-b-2 bg-transparent px-1 text-center font-display outline-none transition-colors",
              compact ? "text-[16px] leading-6" : "text-[23px] leading-8",
              ok(p.id) ? "border-moss text-moss" : bad.has(p.id) ? "animate-shake border-seal text-seal" : "border-ink-3/50 focus:border-ink",
              (hinted[p.id] ?? 0) > 0 && !ok(p.id) && "text-amber",
            )}
            style={{ width: `calc(${Math.max(2, Array.from(p.answer).length) * (lang(code).spaced ? 0.62 : 1.15)}em + 0.6em)` }}
          />
        ),
      )}
    </div>
  );
});

// ------------------------------------------------------------------ Typing (跟打)

export const TypingMode = forwardRef<ModeHandle, ModeProps>(function TypingMode({ target, code, opts, onDone, compact }, ref) {
  const [value, setValue] = useState("");
  const [mistakes, setMistakes] = useState(0);
  const [focused, setFocused] = useState(true);
  const input = useRef<HTMLTextAreaElement>(null);
  const state = useMemo(() => typingState(target, value, opts), [target, value, opts]);
  const total = useMemo(() => tokenize(target, code, opts).length, [target, code, opts]);

  useEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    if (state.done) onDone({ answer: value, correct: Math.max(0, total - mistakes), total, hints: 0, revealed: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.done]);

  const onChange = (v: string) => {
    if (Array.from(v).length > Array.from(target).length + 3) return;
    if (v.length > value.length) {
      const s = typingState(target, v, opts);
      const newBad = s.chars.slice(value.length, v.length).filter((c) => c.state === "bad").length;
      if (newBad) setMistakes((m) => m + newBad);
    }
    setValue(v);
  };

  useImperativeHandle(ref, () => ({
    check: () => input.current?.focus(),
    hint: () => input.current?.focus(),
    reveal: () => onDone({ answer: value, correct: 0, total, hints: 0, revealed: true }),
    focus: () => input.current?.focus(),
  }));

  const caret = Array.from(value).length;
  const caretCls = compact ? "h-[1.2rem]" : "h-[1.6rem]";
  return (
    <div className="relative cursor-text" onClick={() => input.current?.focus()}>
      <textarea
        ref={input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        aria-label={tr("Typing input")}
        className="absolute inset-0 resize-none opacity-0"
      />
      <div className={cx("font-mono break-words whitespace-pre-wrap transition-opacity", compact ? "text-[15px] leading-[1.7rem]" : "text-[21px] leading-[2.3rem]", !focused && "opacity-60")}>
        {state.chars.map((c, i) => (
          <span key={i} className="relative">
            {i === caret && focused && <span className={cx("absolute -left-px w-[2px] animate-blink rounded bg-seal", caretCls, compact ? "top-[0.25rem]" : "top-[0.35rem]")} />}
            <span className={cx(c.state === "ok" && "text-ink", c.state === "bad" && "rounded-sm bg-danger-soft text-danger", c.state === "pending" && "text-ink-3/55")}>
              {c.state === "bad" && c.ch === " " ? "·" : c.ch}
            </span>
          </span>
        ))}
        {caret >= state.chars.length && focused && <span className={cx("ml-px inline-block w-[2px] translate-y-1 animate-blink rounded bg-seal", caretCls)} />}
      </div>
      <div className={cx("flex items-center gap-4 font-mono text-[11px] text-ink-3", compact ? "mt-2.5" : "mt-4")}>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-line">
          <div className="h-full bg-ink transition-[width] duration-150" style={{ width: `${state.progress * 100}%` }} />
        </div>
        <span>{Math.round(state.progress * 100)}%</span>
        <span className={mistakes ? "text-danger" : ""}>{tr("errors")}{mistakes}</span>
        {!focused && <span className="text-ink-2">{tr("Click to continue")}</span>}
      </div>
    </div>
  );
});
