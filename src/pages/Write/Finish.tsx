import { t as tr, formatNumber } from "../../lib/i18n";
import { useEffect, useMemo, useState } from "react";
import { BookmarkPlus, Check, Copy, PenLine, RotateCcw, Volume2 } from "lucide-react";
import { api, copyText } from "../../lib/api";
import { joinSegments, lang } from "../../lib/languages";
import { speak } from "../../lib/speech";
import { WordPicker } from "../../components/WordPicker";
import { Button, cx, IconButton, Segmented } from "../../components/ui";
import { useApp } from "../../store";
import { toPractice } from "./Compose";


export function grade(score: number): { mark: string; label: string } {
  if (score >= 0.9) return { mark: tr("A"), label: tr("Well written") };
  if (score >= 0.75) return { mark: tr("B"), label: tr("Mostly mastered") };
  if (score >= 0.6) return { mark: tr("C"), label: tr("Almost there") };
  return { mark: tr("D"), label: tr("Practice again") };
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="eyebrow">{label}</div>
      <div className="mt-1.5 font-display text-[26px] leading-none">{value}{sub && <span className="ml-1 text-[13px] text-ink-3">{sub}</span>}</div>
    </div>
  );
}

export function Finish() {
  const { segments, from, to, startedAt, completedAt, practiceSave, practiceError, savePractice, settings, toast, newDraft, startPractice } = useApp();
  const [useMine, setUseMine] = useState<"ref" | "mine">("ref");
  const [savedAll, setSavedAll] = useState(false);
  const elapsed = completedAt - startedAt;

  const total = segments.reduce((a, s) => a + s.total, 0);
  const correct = segments.reduce((a, s) => a + s.correct, 0);
  const hints = segments.reduce((a, s) => a + s.hints, 0);
  const score = total ? correct / total : 0;
  const g = grade(score);
  const firstTime = segments.filter((s) => s.status === "done" && s.score >= 0.999 && s.hints === 0).length;
  const weak = segments.filter((s) => s.status === "revealed" || s.score < 0.999);

  const finalText = useMemo(
    () => joinSegments(segments.map((s) => ({ text: useMine === "mine" && s.status === "done" && s.answer.trim() ? s.answer : s.target, breakAfter: s.breakAfter })), to),
    [segments, useMine, to],
  );

  useEffect(() => { void savePractice(); }, [savePractice]);

  const copy = async () => {
    try {
      await copyText(finalText);
      toast(tr("Copied. Paste it and send."), "success");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const saveAll = async () => {
    if (savedAll) return;
    try {
      for (const s of segments) await api.addSentence({ source: s.source, target: s.target, sourceLang: from, targetLang: to, origin: "write" });
      setSavedAll(true);
      toast(tr("Saved {p0} sentences", { p0: segments.length }), "success");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const mins = Math.floor(elapsed / 60000);
  const secs = Math.round((elapsed % 60000) / 1000);

  return (
    <div className="page-shell">
      <div className="card relative overflow-hidden px-7 py-7">
        <div className="flex flex-wrap items-start gap-6">
          <div className="relative flex size-[88px] shrink-0 animate-stamp items-center justify-center">
            <div className="seal-stamp flex size-full flex-col items-center justify-center">
              <span className="text-[28px] leading-none font-semibold tracking-tight">{Math.round(score * 100)}<span className="ml-0.5 text-[14px]">%</span></span>
              <span className="mt-2 px-1 text-center text-[9px] leading-tight text-ink-2">{tr("Practice accuracy")}</span>
            </div>
          </div>
          <div className="min-w-0 flex-1 stagger">
            <div className="eyebrow">{tr("This practice")}</div>
            <h1 className="mt-2 font-display text-[34px] leading-tight">{g.label}</h1>
            <div className="mt-6 grid grid-cols-2 gap-5 lg:grid-cols-4">
              <Stat label={tr("Words remembered")} value={formatNumber(correct)} sub={`/ ${formatNumber(total)}`} />
              <Stat label={tr("Correct on the first try")} value={formatNumber(firstTime)} sub={tr("/ {p0} segments", { p0: segments.length })} />
              <Stat label={tr("Hint")} value={formatNumber(hints)} sub={tr("times")} />
              <Stat label={tr("Time")} value={mins ? `${mins}:${String(secs).padStart(2, "0")}` : `${secs}`} sub={mins ? "" : tr("sec")} />
            </div>
          </div>
        </div>
      </div>

      <div role="status" className={cx("mt-4 flex items-center gap-3 text-[12px]", practiceSave === "error" ? "text-danger" : "text-ink-3")}>
        {practiceSave === "saving" ? tr("learning.saving") : practiceSave === "saved" ? tr("learning.saved") : practiceSave === "error" ? tr("Could not save practice: {p0}", { p0: practiceError }) : ""}
        {practiceSave === "error" && <Button size="sm" onClick={savePractice}>{tr("learning.retry")}</Button>}
      </div>
      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="eyebrow">{tr("finish.work", { language: lang(to).label })}</div>
          <Segmented size="sm" value={useMine} onChange={setUseMine} options={[{ value: "ref", label: tr("Reference translation") }, { value: "mine", label: tr("My writing") }]} />
        </div>
        <div className="card relative">
          <div className="selectable px-8 py-7 font-display text-[20px] leading-[1.75] whitespace-pre-wrap text-ink">{finalText}</div>
          <div className="flex flex-wrap items-center gap-2 border-t border-line bg-paper-2/50 px-4 py-3">
            <Button variant="seal" onClick={copy} icon={<Copy className="size-4" />}>{tr("Copy finished text")}</Button>
            <IconButton label={tr("Read full text aloud")} onClick={() => speak(finalText, to, { engine: settings.ttsEngine, rate: settings.speechRate }).catch((e) => toast((e as Error).message, "error"))}>
              <Volume2 className="size-4" />
            </IconButton>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" onClick={saveAll} disabled={savedAll} icon={savedAll ? <Check className="size-4 text-moss" /> : <BookmarkPlus className="size-4" />}>{savedAll ? tr("finish.savedAll") : tr("Save all sentences")}</Button>
              {weak.length > 0 && (
                <Button variant="outline" disabled={practiceSave !== "saved"} onClick={() => startPractice(toPractice(weak))} icon={<RotateCcw className="size-4" />}>{tr("practice.repeatSegments", { count: weak.length })}</Button>
              )}
              <Button variant="ink" disabled={practiceSave !== "saved"} onClick={newDraft} icon={<PenLine className="size-4" />}>{tr("Write another")}</Button>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-10">
        <div className="eyebrow mb-3">{tr("Segment review · Click words to add them to vocabulary")}</div>
        <ol className="stagger divide-y divide-line rounded-2xl border border-line bg-card/50">
          {segments.map((s, i) => (
            <li key={i} className="grid grid-cols-[2.2rem_1fr_auto] gap-4 px-5 py-4">
              <span className="pt-1 font-mono text-[11px] text-seal">{String(i + 1).padStart(2, "0")}</span>
              <div className="min-w-0">
                <div className="text-[13px] text-ink-3">{s.source}</div>
                <WordPicker text={s.target} code={to} native={from} translation={s.source} className="mt-1 font-display text-[17px] text-ink" />
              </div>
              <span className={cx("self-start rounded-full px-2 py-0.5 font-mono text-[11px]", s.status === "revealed" ? "bg-seal-soft text-seal" : s.score >= 0.999 ? "bg-moss-soft text-moss" : "bg-amber-soft text-amber")}>
                {s.status === "revealed" ? tr("Show answer") : `${s.correct}/${s.total}`}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
