import { t as tr } from "../../lib/i18n";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { ArrowLeft, ArrowRight, Bookmark, Check, Eye, Lightbulb, Sparkles, Volume2 } from "lucide-react";
import { api } from "../../lib/api";
import type { CheckOptions } from "../../lib/check";
import { lang } from "../../lib/languages";
import { speak } from "../../lib/speech";
import { llmReady } from "../../lib/types";
import type { AiReview } from "../../lib/types";
import { Markup, MarkupLegend } from "../../components/Markup";
import { WordPicker } from "../../components/WordPicker";
import { Button, cx, IconButton, Kbd, MOD, Segmented } from "../../components/ui";
import { useApp } from "../../store";
import type { PracticeSegment } from "../../store";
import { MODES } from "./Compose";
import { ClozeMode, RecallMode, TypingMode } from "./modes";
import type { ModeHandle, ModeResult } from "./modes";

export function useCheckOptions(): CheckOptions {
  const { ignoreCase, ignorePunctuation, ignoreAccents } = useApp((s) => s.settings);
  return useMemo(() => ({ ignoreCase, ignorePunctuation, ignoreAccents }), [ignoreCase, ignorePunctuation, ignoreAccents]);
}

function StatusDot({ seg, active }: { seg: PracticeSegment; active: boolean }) {
  if (seg.status === "pending")
    return <span className={cx("size-[15px] rounded-full border-[1.5px]", active ? "border-seal bg-seal-soft" : "border-line-2")} />;
  if (seg.status === "revealed") return <span className="flex size-[15px] items-center justify-center rounded-full bg-seal-soft text-seal"><Eye className="size-2.5" strokeWidth={3} /></span>;
  const perfect = seg.score >= 0.999;
  return (
    <span className={cx("flex size-[15px] items-center justify-center rounded-full", perfect ? "bg-moss text-paper" : "bg-amber-soft text-amber")}>
      <Check className="size-2.5" strokeWidth={3.5} />
    </span>
  );
}

function AiPanel({ state }: { state: AiReview | "loading" | string }) {
  if (state === "loading") return <div className="flex items-center gap-2 text-[13px] text-ink-3"><Sparkles className="size-4 animate-pulse text-seal" />{tr("The AI tutor is reviewing…")}</div>;
  if (typeof state === "string") return <div className="text-[13px] text-seal">{state}</div>;
  const tone = state.verdict === "correct" ? "bg-moss-soft text-moss" : state.verdict === "acceptable" ? "bg-amber-soft text-amber" : "bg-seal-soft text-seal";
  const label = state.verdict === "correct" ? tr("Natural") : state.verdict === "acceptable" ? tr("Acceptable") : tr("Needs revision");
  return (
    <div className="animate-rise space-y-3 rounded-xl border border-line bg-paper/60 p-4">
      <div className="flex items-center gap-2">
        <span className={cx("rounded-full px-2 py-0.5 text-[11.5px] font-semibold", tone)}>{label}</span>
        <span className="font-mono text-[11px] text-ink-3">{Math.round(state.score)} / 100</span>
      </div>
      <p className="text-[13.5px] leading-relaxed text-ink-2">{state.feedback}</p>
      {state.corrected && <p className="font-display text-[16px] text-ink">{state.corrected}</p>}
      {state.notes?.length > 0 && (
        <ul className="space-y-1.5">
          {state.notes.map((n, i) => (
            <li key={i} className="text-[12.5px] text-ink-2">
              <span className="pen-strike">{n.wrong}</span> <span className="pen-note">{n.right}</span> <span className="text-ink-3">— {n.why}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Practice() {
  const { segments, current, setCurrent, patchSegment, mode, setMode, from, to, settings, setStage, toast, startedAt } = useApp();
  const opts = useCheckOptions();
  const seg = segments[current];
  const mref = useRef<ModeHandle>(null);

  const doneCount = segments.filter((s) => s.status !== "pending").length;
  const allDone = doneCount === segments.length;
  const speakOpts = { engine: settings.ttsEngine, rate: settings.speechRate };

  const say = useCallback(
    (text: string) => speak(text, to, speakOpts).catch((e) => toast(tr("Could not read aloud: {p0}", { p0: (e as Error).message }), "error")),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [to, settings.ttsEngine, settings.speechRate],
  );

  const next = useCallback(() => {
    const after = segments.findIndex((s, i) => i > current && s.status === "pending");
    const any = segments.findIndex((s) => s.status === "pending");
    const target = after >= 0 ? after : any;
    if (target >= 0) setCurrent(target);
    else setStage("finish");
  }, [segments, current, setCurrent, setStage]);

  const onDone = (r: ModeResult) => {
    patchSegment(current, {
      answer: r.answer,
      status: r.revealed ? "revealed" : "done",
      correct: r.correct,
      total: r.total,
      score: r.total ? r.correct / r.total : 0,
      hints: r.hints,
      attempts: seg.attempts + 1,
    });
    if (settings.autoSpeak) say(seg.target);
  };

  // Async results land on the segment they were started for, and are dropped if a new
  // practice has begun in the meantime (the page may even have been left and re-entered).
  const patchLater = (i: number, patch: Partial<PracticeSegment>) => {
    if (useApp.getState().startedAt === startedAt) useApp.getState().patchSegment(i, patch);
  };

  const saveSentence = async () => {
    const i = current;
    if (seg.saved) return;
    try {
      await api.addSentence({ source: seg.source, target: seg.target, sourceLang: from, targetLang: to, origin: "write" });
      patchLater(i, { saved: true });
      toast(tr("Added to sentence notebook"), "success");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const review = async () => {
    const i = current;
    if (!seg.answer.trim()) return;
    patchSegment(i, { ai: "loading" });
    try {
      patchLater(i, { ai: await api.aiReview(seg.source, seg.target, seg.answer, from, to) });
    } catch (e) {
      patchLater(i, { ai: (e as Error).message });
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "/") {
        e.preventDefault();
        mref.current?.hint();
      } else if (mod && e.key.toLowerCase() === "j") {
        e.preventDefault();
        say(seg.target);
      } else if (mod && e.key.toLowerCase() === "e") {
        e.preventDefault();
        if (seg.status === "pending") mref.current?.reveal();
      } else if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveSentence();
      } else if (e.key === "Enter" && !mod && seg.status !== "pending" && !(e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!seg) return null;
  const targetName = lang(to).label;
  const tries = seg.tries;
  const lastTry = tries[tries.length - 1];
  const firstTry = tries[0];

  return (
    <div className="flex h-full min-h-0">
      {/* Manuscript rail */}
      <aside className="practice-rail flex shrink-0 flex-col border-r border-line">
        <div className="px-5 pt-12 pb-4">
          <button onClick={() => setStage("compose")} className="flex items-center gap-1.5 text-[12px] text-ink-3 hover:text-ink">
            <ArrowLeft className="size-3.5" /> {tr("Edit source")}</button>
          <div className="mt-4 flex items-baseline justify-between">
            <span className="font-display text-[22px]">{doneCount}<span className="text-ink-3"> / {segments.length}</span></span>
            <span className="eyebrow">{tr("Completed")}</span>
          </div>
          <div className="mt-2 flex gap-1">
            {segments.map((s, i) => (
              <span key={i} className={cx("h-1 flex-1 rounded-full", s.status === "pending" ? (i === current ? "bg-seal/50" : "bg-line") : s.status === "revealed" ? "bg-seal" : s.score >= 0.999 ? "bg-moss" : "bg-amber")} />
            ))}
          </div>
        </div>
        <ol className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 pb-6">
          {segments.map((s, i) => (
            <li key={i}>
              <button
                onClick={() => setCurrent(i)}
                className={cx("flex w-full items-start gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors", i === current ? "bg-card shadow-[0_1px_2px_rgb(0_0_0/0.06)]" : "hover:bg-ink/[0.03]")}
              >
                <span className="mt-[3px]"><StatusDot seg={s} active={i === current} /></span>
                <span className="min-w-0 flex-1">
                  <span className={cx("line-clamp-2 font-display text-[13.5px] leading-snug", i === current ? "text-ink" : "text-ink-2")}>{s.source}</span>
                  {s.status !== "pending" && <span className="mt-1 line-clamp-1 text-[11.5px] text-ink-3">{s.target}</span>}
                </span>
              </button>
            </li>
          ))}
        </ol>
        {allDone && (
          <div className="border-t border-line p-4">
            <Button variant="seal" className="w-full" onClick={() => setStage("finish")} icon={<ArrowRight className="size-4" />}>{tr("View results")}</Button>
          </div>
        )}
      </aside>

      {/* Desk */}
      <section className="min-w-0 flex-1 overflow-y-auto">
        <div className="page-shell practice-desk">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <span className="eyebrow">{tr("practice.segment", { number: current + 1 })}</span>
            <Segmented value={mode} onChange={setMode} options={MODES} size="sm" />
          </div>

          <div key={current} className="card animate-rise">
            <div className="px-7 py-7">
              <div className="eyebrow mb-3">{tr("Source · {p0}", { p0: lang(from).label })}</div>
              <p className="selectable font-display text-[25px] leading-[1.5] text-ink" style={{ fontVariationSettings: '"opsz" 72' }}>{seg.source}</p>
            </div>

            <div className="border-t border-line bg-paper-2/20 px-7 py-6">
              <span className="mb-4 block text-[11px] font-medium text-ink-3">{tr("practice.writeLanguage", { language: targetName })}</span>

              {seg.status === "pending" ? (
                <>
                  {mode === "recall" && <RecallMode key={`r${current}`} ref={mref} target={seg.target} code={to} opts={opts} onDone={onDone} onAttempt={(r) => patchSegment(current, { tries: [...seg.tries, r] })} />}
                  {mode === "cloze" && <ClozeMode key={`c${current}`} ref={mref} target={seg.target} code={to} opts={opts} ratio={settings.clozeRatio} onDone={onDone} />}
                  {mode === "typing" && <TypingMode key={`t${current}`} ref={mref} target={seg.target} code={to} opts={opts} onDone={onDone} />}
                  {mode === "recall" && lastTry && (
                    <div className="mt-7 animate-rise rounded-xl border border-danger/20 bg-danger-soft/30 px-5 pt-3 pb-4">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="eyebrow !text-danger">{tr("Corrections · Fix your answer and press ↵")}</span>
                        <span className="font-mono text-[11px] text-ink-3">{lastTry.correct}/{lastTry.total}</span>
                      </div>
                      <Markup ops={lastTry.ops} code={to} reveal={false} />
                      <div className="mt-3"><MarkupLegend /></div>
                    </div>
                  )}
                </>
              ) : (
                <div className="animate-rise space-y-6">
                  <div className="flex items-center gap-2 text-[13px]">
                    {seg.status === "revealed" ? (
                      <span className="rounded-full bg-seal-soft px-2.5 py-0.5 font-medium text-seal">{tr("Answer revealed")}</span>
                    ) : seg.score >= 0.999 && seg.hints === 0 ? (
                      <span className="rounded-full bg-moss-soft px-2.5 py-0.5 font-medium text-moss">{tr("Correct on the first try")}</span>
                    ) : (
                      <span className="rounded-full bg-amber-soft px-2.5 py-0.5 font-medium text-amber">{tr("Done")}</span>
                    )}
                    <span className="font-mono text-[11.5px] text-ink-3">
                      {tr("practice.remembered", { correct: seg.correct, total: seg.total })}{seg.hints ? tr(" · {p0} hints", { p0: seg.hints }) : ""}
                    </span>
                  </div>
                  {firstTry && !firstTry.perfect && (
                    <div>
                      <div className="eyebrow mb-2">{tr("First attempt · Corrections")}</div>
                      <Markup ops={firstTry.ops} code={to} className="text-[18px]" />
                    </div>
                  )}
                  <div>
                    <div className="eyebrow mb-2 flex items-center gap-2">{tr("Reference translation")}<span className="normal-case tracking-normal text-ink-3/80">{tr("· Click words to look up and save")}</span></div>
                    <WordPicker text={seg.target} code={to} native={from} translation={seg.source} className="font-display text-[23px] leading-[1.6] text-ink" />
                  </div>
                  {llmReady(settings) && seg.answer.trim() && (
                    seg.ai ? <AiPanel state={seg.ai} /> : (
                      <Button variant="soft" size="sm" onClick={review} icon={<Sparkles className="size-3.5 text-seal" />}>{tr("Ask the AI tutor to review my writing")}</Button>
                    )
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Action bar */}
          <div className="mt-5 flex flex-wrap items-center gap-1.5">
            <IconButton label={tr("Hint the next word ({p0}/)", { p0: MOD })} onClick={() => mref.current?.hint()} disabled={seg.status !== "pending" || mode === "typing"}>
              <Lightbulb className="size-4" />
            </IconButton>
            <IconButton label={tr("Read translation ({p0}J)", { p0: MOD })} onClick={() => say(seg.target)}>
              <Volume2 className="size-4" />
            </IconButton>
            <IconButton label={seg.saved ? tr("Saved to sentences") : tr("Save sentence ({p0}S)", { p0: MOD })} onClick={saveSentence} active={seg.saved} disabled={seg.saved}>
              {seg.saved ? <Check className="size-4" /> : <Bookmark className="size-4" />}
            </IconButton>
            <span className="ml-2 hidden items-center gap-1 text-[11px] text-ink-3 md:flex">
              <Kbd>{MOD}</Kbd><Kbd>/</Kbd> {tr("Hint")}<span className="mx-1.5 text-line-2">|</span>
              <Kbd>{MOD}</Kbd><Kbd>J</Kbd> {tr("Listen once")}</span>
            <div className="ml-auto flex items-center gap-2">
              {seg.status === "pending" ? (
                <>
                  <Button variant="ghost" onClick={() => mref.current?.reveal()} icon={<Eye className="size-4" />}>{tr("Show answer")}</Button>
                  {mode !== "typing" && (
                    <Button variant="ink" onClick={() => mref.current?.check()}>
                      {tr("Check")}<Kbd>↵</Kbd>
                    </Button>
                  )}
                </>
              ) : (
                <Button variant={allDone ? "seal" : "ink"} onClick={next} icon={<ArrowRight className="size-4" />}>
                  {allDone ? tr("View results") : tr("Next segment")} <Kbd>↵</Kbd>
                </Button>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
