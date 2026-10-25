import { t as tr } from "../lib/i18n";
import { useEffect, useMemo, useRef } from "react";
import { Eye, Lightbulb, Volume2 } from "lucide-react";
import type { CheckOptions } from "../lib/check";
import { speak } from "../lib/speech";
import type { PracticeMode } from "../lib/types";
import { Markup } from "../components/Markup";
import { Button, cx } from "../components/ui";
import { ClozeMode, RecallMode, TypingMode } from "../pages/Write/modes";
import type { ModeHandle, ModeResult } from "../pages/Write/modes";
import { nextPending } from "./logic";
import { useMini } from "./store";

const MODES: { value: PracticeMode; label: string; hint: string }[] = [
  { value: "recall", get label() { return tr("Recall"); }, get hint() { return tr("Read the native text and write the full sentence from memory"); } },
  { value: "cloze", get label() { return tr("Cloze"); }, get hint() { return tr("Fill in the missing words"); } },
  { value: "typing", get label() { return tr("Typing"); }, get hint() { return tr("Type the translation character by character"); } },
];

/** One sentence at a time, the main window's practice modes in compact form. */
export function MiniPractice() {
  const { segments, current, practiceMode, setPracticeMode, finish, addTry, next, backToInput, to, settings, notify } = useMini();
  const { ignoreCase, ignorePunctuation, ignoreAccents } = settings;
  const opts: CheckOptions = useMemo(() => ({ ignoreCase, ignorePunctuation, ignoreAccents }), [ignoreCase, ignorePunctuation, ignoreAccents]);
  const mref = useRef<ModeHandle>(null);
  const seg = segments[current];
  const done = !!seg && seg.status !== "pending";
  const last = nextPending(segments, current) < 0;

  const say = (text: string) =>
    speak(text, to, { engine: settings.ttsEngine, rate: settings.speechRate }).catch((e) => notify({ tone: "error", text: tr("Could not read aloud: {p0}", { p0: (e as Error).message }) }));

  const onDone = (r: ModeResult) => {
    finish(r);
    if (settings.autoSpeak && seg) say(seg.target);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (e.isComposing) return;
      if (e.key === "Enter" && mod) {
        e.preventDefault();
        if (done) next();
        else mref.current?.check();
      } else if (e.key === "Enter" && done && !(e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        next();
      } else if (mod && e.key === "/") {
        e.preventDefault();
        mref.current?.hint();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!seg) return null;
  const lastTry = seg.tries[seg.tries.length - 1];
  const firstTry = seg.tries[0];

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2 text-[11.5px] glass-muted">
        <span>
          {tr("mini.progress", { current: current + 1, total: segments.length })}</span>
        <span className="flex max-w-24 flex-wrap gap-1">
          {segments.map((s, i) => (
            <i
              key={i}
              className={cx(
                "size-1.5 rounded-full",
                s.status === "pending" ? (i === current ? "bg-seal" : "bg-[var(--line)]") : s.status === "revealed" ? "bg-seal/60" : s.score >= 0.999 ? "bg-moss" : "bg-amber",
              )}
            />
          ))}
        </span>
        <button className="ml-1 hover:text-ink hover:underline" onClick={backToInput}>
          {tr("Edit source")}</button>
        <div className="glass-seg xs ml-auto" role="tablist">
          {MODES.map((m) => (
            <button key={m.value} role="tab" title={m.hint} aria-selected={practiceMode === m.value} onClick={() => setPracticeMode(m.value)} disabled={done}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <p className="selectable mini-practice-source">{seg.source}</p>

      {!done ? (
        <>
          {practiceMode === "recall" && <RecallMode key={`r${current}`} ref={mref} compact target={seg.target} code={to} opts={opts} onDone={onDone} onAttempt={addTry} />}
          {practiceMode === "cloze" && <ClozeMode key={`c${current}`} ref={mref} compact target={seg.target} code={to} opts={opts} ratio={settings.clozeRatio} onDone={onDone} />}
          {practiceMode === "typing" && <TypingMode key={`t${current}`} ref={mref} compact target={seg.target} code={to} opts={opts} onDone={onDone} />}
          {practiceMode === "recall" && lastTry && (
            <div className="glass-card animate-rise px-3 pt-1.5 pb-2.5">
              <div className="mb-1 flex items-center justify-between text-[11px]">
                <span className="text-danger">{tr("Corrections · Fix your answer and press ↵")}</span>
                <span className="font-mono glass-muted">
                  {lastTry.correct}/{lastTry.total}
                </span>
              </div>
              <Markup ops={lastTry.ops} code={to} reveal={false} className="!text-[15px]" />
            </div>
          )}
        </>
      ) : (
        <div className="animate-rise space-y-2">
          <div className="flex items-center gap-2 text-[12px]">
            {seg.status === "revealed" ? (
              <span className="rounded-full bg-seal/12 px-2 py-0.5 font-medium text-seal">{tr("Answer revealed")}</span>
            ) : seg.score >= 0.999 && seg.hints === 0 ? (
              <span className="rounded-full bg-moss/15 px-2 py-0.5 font-medium text-moss">{tr("Correct on the first try")}</span>
            ) : (
              <span className="rounded-full bg-amber/15 px-2 py-0.5 font-medium text-amber">{tr("Done")}</span>
            )}
            <span className="font-mono text-[11px] glass-muted">
              {tr("practice.remembered", { correct: seg.correct, total: seg.total })}{seg.hints ? tr(" · {p0} hints", { p0: seg.hints }) : ""}
            </span>
          </div>
          {firstTry && !firstTry.perfect && <Markup ops={firstTry.ops} code={to} className="!text-[15px]" />}
          <p className="selectable font-display text-[16px] leading-[1.55]">{seg.target}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
        {!done && practiceMode !== "typing" && (
          <button className="glass-ghost" onClick={() => mref.current?.hint()}>
            <Lightbulb className="size-3.5" />
            {tr("Hint")}</button>
        )}
        {!done && (
          <button className="glass-ghost" onClick={() => mref.current?.reveal()}>
            <Eye className="size-3.5" />
            {tr("Show answer")}</button>
        )}
        <button className="glass-icon" title={tr("Read translation aloud")} onClick={() => say(seg.target)}>
          <Volume2 className="size-3.5" />
        </button>
        <div className="ml-auto" />
        {done ? (
          <Button variant="seal" size="sm" onClick={next}>
            {last ? tr("Done") : tr("Next sentence")} <span className="font-mono text-[10.5px] opacity-75">↵</span>
          </Button>
        ) : (
          practiceMode !== "typing" && (
            <Button variant="seal" size="sm" onClick={() => mref.current?.check()}>
              {tr("Check")}<span className="font-mono text-[10.5px] opacity-75">↵</span>
            </Button>
          )
        )}
      </div>
    </div>
  );
}
