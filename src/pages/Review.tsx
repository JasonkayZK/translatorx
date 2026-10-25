import { t as tr, formatNumber } from "../lib/i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, Headphones, PartyPopper, Repeat2, RotateCcw, Volume2 } from "lucide-react";
import { api } from "../lib/api";
import { blankMatches, compare, hintText, sentenceHint } from "../lib/check";
import type { CheckResult } from "../lib/check";
import { lang } from "../lib/languages";
import { speak } from "../lib/speech";
import type { ReviewMethod, ReviewPrefs, ReviewScope, Sentence, Word } from "../lib/types";
import { Markup } from "../components/Markup";
import { Button, cx, Empty, IconButton, Kbd, MOD, PageHeader, Segmented, Toggle } from "../components/ui";
import { useApp } from "../store";
import { useCheckOptions } from "./Write/Practice";

type Card = { kind: "word"; item: Word } | { kind: "sentence"; item: Sentence };
type Due = { words: Word[]; sentences: Sentence[] };

const GRADES = [
  { g: 0, get label() { return tr("Forgot"); }, key: "1", tone: "text-danger border-danger/30 hover:bg-danger-soft" },
  { g: 1, get label() { return tr("Uncertain"); }, key: "2", tone: "text-amber border-amber/30 hover:bg-amber-soft" },
  { g: 2, get label() { return tr("review.gradeRemembered"); }, key: "3", tone: "text-ink border-line-2 hover:bg-paper-2" },
  { g: 3, get label() { return tr("Easy"); }, key: "4", tone: "text-moss border-moss/30 hover:bg-moss-soft" },
];

const METHODS: ReviewMethod[] = ["write", "flip", "listen"];
const LIMITS = [10, 20, 50, 0];

/** Hides the saved word inside its example sentence. */
function blankOut(context: string, word: string): string {
  const i = context.toLowerCase().indexOf(word.toLowerCase());
  if (!word || i < 0) return context;
  return `${context.slice(0, i)}＿＿＿${context.slice(i + word.length)}`;
}

function interleave(words: Word[], sentences: Sentence[]): Card[] {
  const out: Card[] = [];
  const n = Math.max(words.length, sentences.length);
  for (let i = 0; i < n; i++) {
    if (words[i]) out.push({ kind: "word", item: words[i] });
    if (sentences[i]) out.push({ kind: "sentence", item: sentences[i] });
  }
  return out;
}

function shuffle<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** One session out of everything due, following the remembered preferences. */
export function buildQueue(due: Due, prefs: ReviewPrefs, random: <T>(list: T[]) => T[] = shuffle): Card[] {
  let cards = interleave(prefs.kind === "sentence" ? [] : due.words, prefs.kind === "word" ? [] : due.sentences);
  if (prefs.shuffle) cards = random(cards);
  return prefs.limit > 0 ? cards.slice(0, prefs.limit) : cards;
}

export function ReviewPage() {
  const { settings, toast, go, updateSettings } = useApp();
  const prefs = settings.review;
  const opts = useCheckOptions();
  const [due, setDue] = useState<Due | null>(null);
  const [reload, setReload] = useState(0);
  // `null` shows the session setup; a session runs through the queue.
  const [queue, setQueue] = useState<Card[] | null>(null);
  const [method, setMethod] = useState<ReviewMethod>("write");
  const [idx, setIdx] = useState(0);
  const [answer, setAnswer] = useState("");
  const [hint, setHint] = useState(0);
  const [result, setResult] = useState<{ ok: boolean; check?: CheckResult; revealed: boolean; flipped?: boolean } | null>(null);
  const [tally, setTally] = useState({ done: 0, good: 0 });
  const operation = useRef<{ id: string; grade: number } | null>(null);
  const submitting = useRef(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let active = true;
    api
      .dueItems(200)
      .then((d) => { if (active) setDue(d); })
      .catch((e) => {
        if (!active) return;
        toast((e as Error).message, "error");
        setDue({ words: [], sentences: [] });
      });
    return () => { active = false; };
  }, [toast, reload]);

  const setPrefs = (patch: Partial<ReviewPrefs>) => { void updateSettings({ review: patch }); };
  const planned = useMemo(() => (due ? buildQueue(due, { ...prefs, shuffle: false }).length : 0), [due, prefs]);

  const start = () => {
    if (!due) return;
    setMethod(prefs.method);
    setQueue(buildQueue(due, prefs));
    setIdx(0);
    setAnswer("");
    setHint(0);
    setResult(null);
    setTally({ done: 0, good: 0 });
    setSaveError("");
    operation.current = null;
  };
  const backToSetup = () => { setQueue(null); setReload((n) => n + 1); };

  const card = queue?.[idx];
  const code = card ? (card.kind === "word" ? card.item.lang : card.item.targetLang) : "en";
  const expected = card ? (card.kind === "word" ? card.item.text : card.item.target) : "";
  const flip = method === "flip";
  const listen = method === "listen";

  useEffect(() => {
    input.current?.focus();
  }, [idx, queue]);

  const say = () => speak(expected, code, { engine: settings.ttsEngine, rate: settings.speechRate }).catch((e) => toast((e as Error).message, "error"));

  // A listening card opens with its audio; the text stays hidden until the answer is checked.
  useEffect(() => {
    if (listen && card) void say();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, queue, listen]);

  // Suggest a grade from how the answer went; the learner can still override.
  const suggested = useMemo(() => {
    if (!result || result.flipped) return 2;
    if (result.revealed || !result.ok) return 0;
    if (hint > 0) return 1;
    return result.check && result.check.typos > 0 ? 1 : 2;
  }, [result, hint]);

  const check = () => {
    if (!card || result) return;
    if (!answer.trim()) return reveal();
    if (card.kind === "word") setResult({ ok: blankMatches(expected, answer, opts), revealed: false });
    else {
      const c = compare(expected, answer, code, opts);
      setResult({ ok: c.score >= 0.85, check: c, revealed: false });
    }
    if (settings.autoSpeak && !listen) say();
  };

  const reveal = () => {
    if (!card || result) return;
    setResult({ ok: false, revealed: true, check: answer.trim() && card.kind === "sentence" ? compare(expected, answer, code, opts) : undefined });
  };

  // Flip cards have nothing to check: the learner recalls silently, then grades honestly.
  const flipOver = () => {
    if (!card || result) return;
    setResult({ ok: true, revealed: false, flipped: true });
  };

  const grade = async (g: number) => {
    if (!card || !result || submitting.current) return;
    submitting.current = true;
    if (!operation.current) operation.current = { id: crypto.randomUUID(), grade: g };
    const choice = operation.current;
    g = choice.grade;
    setSaving(true);
    setSaveError("");
    try {
      await api.reviewItem(card.kind, card.item.id, g, choice.id);
      operation.current = null;
      setTally((t) => ({ done: t.done + 1, good: t.good + (g >= 2 ? 1 : 0) }));
      // Forgotten cards come back at the end of this session.
      if (g === 0) setQueue((q) => (q ? [...q, card] : q));
      setIdx((i) => i + 1);
      setAnswer("");
      setHint(0);
      setResult(null);
    } catch (e) {
      setSaveError((e as Error).message);
      toast((e as Error).message, "error");
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      const typing = e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement;
      if (!result) {
        if ((e.metaKey || e.ctrlKey) && e.key === "/") {
          e.preventDefault();
          setHint((h) => Math.min(2, h + 1));
        } else if (flip && card && (e.key === "Enter" || e.key === " ") && !e.metaKey && !e.ctrlKey && !e.altKey && !typing) {
          e.preventDefault();
          flipOver();
        }
        return;
      }
      // Leave ⌘1–6 and other chords to the app shortcuts.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const g = GRADES.find((x) => x.key === e.key);
      if (g) {
        e.preventDefault();
        grade(g.g);
      } else if (e.key === "Enter") {
        e.preventDefault();
        grade(suggested);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (due === null) return null;

  if (queue === null) {
    const total = due.words.length + due.sentences.length;
    const scopes: { value: ReviewScope; label: string }[] = [
      { value: "all", label: tr("review.scope.all") },
      { value: "word", label: tr("Words {p0}", { p0: due.words.length }) },
      { value: "sentence", label: tr("Sentences {p0}", { p0: due.sentences.length }) },
    ];
    return (
      <div className="page-shell max-w-[880px]">
        <PageHeader eyebrow={tr("Review · Spaced repetition")} title={tr("Spaced review")} />
        {total === 0 ? (
          <Empty icon={<Repeat2 className="size-5" />} title={tr("Nothing to review right now")}>
            {tr("Saved words and sentences follow a spaced review schedule: the better you remember, the longer the interval.")}<div className="mt-5"><Button variant="outline" onClick={() => go("notebook")}>{tr("Open notebook")}</Button></div>
          </Empty>
        ) : (
          <div className="card px-7 py-6">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-display text-[30px] leading-none text-ink">{formatNumber(total)}</span>
              <span className="text-[13px] text-ink-3">{tr("review.dueBreakdown", { words: due.words.length, sentences: due.sentences.length })}</span>
            </div>
            <div className="mt-5">
              <div className="review-option">
                <div>
                  <div className="text-[13.5px] text-ink">{tr("review.method")}</div>
                  <div className="mt-0.5 max-w-md text-[12px] leading-relaxed text-ink-3">{tr(`review.method.${prefs.method}Hint`)}</div>
                </div>
                <Segmented size="sm" label={tr("review.method")} value={prefs.method} onChange={(method) => setPrefs({ method })} options={METHODS.map((m) => ({ value: m, label: tr(`review.method.${m}`) }))} />
              </div>
              <div className="review-option">
                <div className="text-[13.5px] text-ink">{tr("review.scope")}</div>
                <Segmented size="sm" label={tr("review.scope")} value={prefs.kind} onChange={(kind) => setPrefs({ kind })} options={scopes} />
              </div>
              <div className="review-option">
                <div className="text-[13.5px] text-ink">{tr("review.limit")}</div>
                <Segmented size="sm" label={tr("review.limit")} value={String(prefs.limit)} onChange={(value) => setPrefs({ limit: Number(value) })} options={LIMITS.map((n) => ({ value: String(n), label: n ? formatNumber(n) : tr("review.limitAll") }))} />
              </div>
              <div className="review-option">
                <div>
                  <div className="text-[13.5px] text-ink">{tr("review.shuffle")}</div>
                  <div className="mt-0.5 text-[12px] text-ink-3">{tr("review.shuffleHint")}</div>
                </div>
                <Toggle label={tr("review.shuffle")} checked={prefs.shuffle} onChange={(shuffle) => setPrefs({ shuffle })} />
              </div>
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
              <span className="text-[12px] text-ink-3">{tr("review.sessionSize", { count: planned })}</span>
              <Button variant="seal" size="lg" disabled={planned === 0} onClick={start} icon={<Repeat2 className="size-4" />}>{tr("review.start")}</Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  const total = queue.length;
  if (!card) {
    return (
      <div className="page-shell max-w-[880px]">
        <PageHeader eyebrow={tr("Review · Spaced repetition")} title={tr("Spaced review")} />
        {tally.done > 0 ? (
          <Empty icon={<PartyPopper className="size-5" />} title={tr("review.sessionDone")}>
            {tr("review.summary", { done: tally.done, good: tally.good })}
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Button variant="outline" onClick={backToSetup} icon={<RotateCcw className="size-4" />}>{tr("review.again")}</Button>
              <Button variant="ink" onClick={() => go("write")}>{tr("Write something new")}</Button>
            </div>
          </Empty>
        ) : (
          <Empty icon={<Repeat2 className="size-5" />} title={tr("Nothing to review right now")}>
            {tr("Saved words and sentences follow a spaced review schedule: the better you remember, the longer the interval.")}<div className="mt-5"><Button variant="outline" onClick={backToSetup}>{tr("review.back")}</Button></div>
          </Empty>
        )}
      </div>
    );
  }

  const word = card.kind === "word" ? card.item : null;
  const sentence = card.kind === "sentence" ? card.item : null;
  const modeLabel = flip ? tr("review.method.flip") : listen ? tr("review.method.listen") : card.kind === "word" ? tr("Spell the word") : tr("Recall the sentence");

  return (
    <div className="page-shell max-w-[880px]">
      <PageHeader eyebrow={tr("review.eyebrow", { mode: modeLabel })} title={tr("Spaced review")}>
        <span className="font-mono text-[12px] text-ink-3">{idx + 1} / {total}</span>
        <Button variant="ghost" size="sm" onClick={backToSetup}>{tr("review.back")}</Button>
      </PageHeader>
      <div className="mb-5 h-1 overflow-hidden rounded-full bg-line">
        <div className="h-full bg-seal transition-[width] duration-500" style={{ width: `${(idx / total) * 100}%` }} />
      </div>

      <div key={`${idx}-${card.item.id}`} className="card animate-rise">
        <div className="px-7 py-7">
          {listen && !result ? (
            <>
              <div className="eyebrow mb-3">{tr("review.method.listen")}</div>
              <div className="flex items-center gap-4">
                <button type="button" onClick={say} aria-label={tr("Read aloud")} className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-seal-soft text-seal transition-colors hover:bg-seal hover:text-seal-ink">
                  <Headphones className="size-6" />
                </button>
                <div>
                  <p className="text-[15px] text-ink">{tr("review.listenPrompt")}</p>
                  <p className="mt-1 text-[12px] text-ink-3">{tr("review.listenHint")}</p>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="eyebrow mb-3">{word ? tr("Meaning") : tr("Source · {p0}", { p0: lang(sentence!.sourceLang).label })}</div>
              {word ? (
                <>
                  <p className="font-display text-[26px] leading-snug text-ink">{word.meaning || tr("(No meaning)")}</p>
                  {word.context && <p className="mt-4 border-l-2 border-line-2 pl-3 font-display text-[15px] leading-relaxed text-ink-2">{result ? word.context : blankOut(word.context, word.text)}</p>}
                </>
              ) : (
                <p className="font-display text-[25px] leading-[1.5] text-ink">{sentence!.source}</p>
              )}
            </>
          )}
        </div>
        <div className="border-t border-line bg-paper-2/20 px-7 py-6">
          <span className="mb-4 block text-[11px] font-medium text-ink-3">{flip ? tr("review.flipLabel", { language: lang(code).label }) : tr("practice.writeLanguage", { language: lang(code).label })}</span>
          {!result ? (
            flip ? (
              <button type="button" onClick={flipOver} className="review-flip w-full transition-colors hover:border-seal hover:text-ink">{tr("review.flipHint")}</button>
            ) : (
              <>
                <textarea
                  ref={input}
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      check();
                    }
                  }}
                  rows={word ? 1 : 2}
                  spellCheck={false}
                  autoCorrect="off"
                  autoCapitalize="off"
                  placeholder={listen ? tr("review.listenPlaceholder") : word ? tr("Spell this word…") : tr("Write the whole sentence from memory…")}
                  className="practice-input w-full resize-none bg-transparent font-display text-[23px] leading-[2.4rem] text-ink outline-none placeholder:text-ink-3/70"
                  style={{ ["--rule" as string]: "2.4rem" }}
                />
                {hint > 0 && <p className="mt-3 font-display text-[15px] text-amber italic">{tr("practice.hintText", { hint: word ? hintText(expected, hint) : sentenceHint(expected, code, hint) })}</p>}
              </>
            )
          ) : (
            <div className="animate-rise space-y-5">
              {!result.flipped && (
                <span className={cx("inline-block rounded-full px-2.5 py-0.5 text-[12.5px] font-medium", result.ok ? "bg-moss-soft text-moss" : "bg-seal-soft text-seal")}>
                  {result.revealed ? tr("Answer revealed") : result.ok ? tr("You got it") : tr("Not quite")}
                </span>
              )}
              {result.check && !result.check.perfect && <Markup ops={result.check.ops} code={code} className="text-[18px]" />}
              {word && !result.ok && !result.flipped && answer.trim() && <p className="pen-strike font-display text-[18px]">{answer}</p>}
              <p className="selectable font-display text-[24px] leading-snug text-ink">{expected}</p>
              {card.item.note && <p className="rounded-lg bg-paper-2/70 px-3 py-2 text-[13px] leading-relaxed text-ink-2">{tr("common.note", { note: card.item.note })}</p>}
            </div>
          )}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <IconButton label={tr("Read aloud")} onClick={say}><Volume2 className="size-4" /></IconButton>
        {!result ? (
          flip ? (
            <div className="ml-auto">
              <Button variant="ink" onClick={flipOver} icon={<Eye className="size-4" />}>{tr("Show answer")}<Kbd>↵</Kbd></Button>
            </div>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={() => setHint((h) => Math.min(2, h + 1))}>{tr("Hint")}<Kbd>{MOD}/</Kbd></Button>
              <div className="ml-auto flex flex-wrap gap-2">
                <Button variant="ghost" onClick={reveal} icon={<Eye className="size-4" />}>{tr("I cannot remember")}</Button>
                <Button variant="ink" onClick={check}>{tr("Check")}<Kbd>↵</Kbd></Button>
              </div>
            </>
          )
        ) : (
          <div className="ml-auto flex flex-wrap gap-2">
            {GRADES.map((g) => (
              <button
                key={g.g}
                disabled={saving || !!saveError}
                onClick={() => grade(g.g)}
                className={cx("flex h-10 min-w-20 items-center justify-center gap-2 rounded-xl border bg-card px-3 text-[13px] font-medium transition-colors", g.tone, suggested === g.g && "ring-2 ring-offset-2 ring-offset-paper ring-ink/20")}
              >
                {g.label} <span className="font-mono text-[10px] opacity-60">{g.key}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {saveError && <div role="alert" className="mt-4 flex items-center justify-end gap-3 text-[12px] text-danger"><span>{saveError}</span><Button size="sm" loading={saving} onClick={() => grade(operation.current?.grade ?? suggested)}>{tr("learning.retry")}</Button></div>}
      {result && <p className="mt-3 text-right text-[11.5px] text-ink-3">{tr("review.shortcuts")}</p>}
    </div>
  );
}
