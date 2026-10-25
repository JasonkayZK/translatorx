import { t as tr } from "../lib/i18n";
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from "react";
import type { TextareaHTMLAttributes } from "react";
import { BookmarkCheck, BookmarkPlus, Copy, Volume2 } from "lucide-react";
import { api, copyText } from "../lib/api";
import { speak } from "../lib/speech";
import { Button, cx, MOD } from "../components/ui";
import { CAN_INSERT, primaryAction, useMini } from "./store";

type AutoProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value"> & {
  value: string;
  onChange: (v: string) => void;
  minHeight?: number;
};

/** A textarea that grows with its content (WebKit has no `field-sizing` yet). */
export const AutoTextarea = forwardRef<HTMLTextAreaElement, AutoProps>(function AutoTextarea({ value, onChange, minHeight = 0, ...rest }, ref) {
  const inner = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => inner.current as HTMLTextAreaElement);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.max(el.scrollHeight, minHeight)}px`;
  }, [value, minHeight]);
  return <textarea ref={inner} rows={1} value={value} onChange={(e) => onChange(e.target.value)} {...rest} />;
});

/** Where the text will go: the app the user was typing in, or the clipboard. */
export function TargetLabel({ className }: { className?: string }) {
  const trusted = useMini((s) => s.trusted);
  const target = useMini((s) => s.target);
  const text = !CAN_INSERT ? tr("Will copy to clipboard") : !trusted ? tr("Permission needed · Will copy") : target ? tr("Insert into {p0}", { p0: target.app || tr("the original app") }) : tr("Will copy to clipboard");
  return <span className={cx("min-w-0 truncate text-[11px] glass-muted", className)} title={text}>{text}</span>;
}

export function PrimaryButton() {
  const p = primaryAction(useMini());
  return (
    <Button variant="seal" size="sm" loading={p.busy} disabled={p.disabled} onClick={p.run} className="mini-primary">
      {p.label}
      <span className="font-mono text-[10.5px] opacity-75">{MOD}↵</span>
    </Button>
  );
}

/** The editable translation with its actions; shared by direct mode and the practice summary. */
export function ResultCard() {
  const { result, setResult, stale, saved, saveSentence, to, settings, notify } = useMini();

  const say = () =>
    speak(result, to, { engine: settings.ttsEngine, rate: settings.speechRate }).catch((e) => notify({ tone: "error", text: tr("Could not read aloud: {p0}", { p0: (e as Error).message }) }));
  const copy = () =>
    copyText(result)
      .then(() => notify({ tone: "success", text: tr("Copied") }))
      .catch((e) => notify({ tone: "error", text: (e as Error).message }));

  return (
    <>
      <section className="mini-result">
        <div className="mini-result-heading">
          <span>{tr("Translation")}</span>
          <div className="flex items-center gap-0.5">
            <button type="button" className="glass-icon" aria-label={tr("Read aloud")} title={tr("Read aloud")} onClick={say}>
              <Volume2 className="size-3.5" />
            </button>
            <button type="button" className="glass-icon" aria-label={tr("Copy")} title={tr("Copy")} onClick={copy}>
              <Copy className="size-3.5" />
            </button>
            <button type="button" className="glass-icon" data-on={saved} aria-label={saved ? tr("Saved to sentences") : tr("Save sentence")} title={saved ? tr("Saved to sentences") : tr("Save sentence")} onClick={saveSentence} disabled={saved}>
              {saved ? <BookmarkCheck className="size-3.5" /> : <BookmarkPlus className="size-3.5" />}
            </button>
          </div>
        </div>
        <AutoTextarea
          value={result}
          onChange={setResult}
          spellCheck={false}
          aria-label={tr("Translation")}
          className={cx("mini-textarea", stale && "opacity-60")}
        />
        {stale && <div role="status" className="mt-2 text-[11px] leading-relaxed text-amber">{tr("mini.sourceChanged", { shortcut: MOD })}</div>}
      </section>
      <div className="mini-footer">
        <TargetLabel className="flex-1" />
        <PrimaryButton />
      </div>
    </>
  );
}

export function NoticeBar() {
  const notice = useMini((s) => s.notice);
  const record = useMini((s) => s.practiceRecord);
  const retry = useMini((s) => s.retryPractice);
  const failed = record?.status === "error";
  if (!notice && !failed && record?.status !== "saving") return null;
  if (failed || record?.status === "saving") return <div role="status" className={cx("rounded-[10px] border px-2.5 py-2 text-[12px]", failed ? "border-danger/30 bg-danger-soft text-danger" : "border-line bg-[var(--glass-res)] text-ink-2")}>
    {failed ? tr("Could not save practice: {p0}", { p0: record.error }) : tr("learning.saving")}
    {failed && <button className="ml-2 font-semibold underline" onClick={retry}>{tr("learning.retry")}</button>}
  </div>;
  if (!notice) return null;
  return (
    <div
      role={notice.tone === "error" ? "alert" : "status"}
      className={cx(
        "animate-rise rounded-[10px] border px-2.5 py-2 text-[12px] leading-relaxed",
        notice.tone === "info" && "border-line bg-[var(--glass-res)] text-ink-2",
        notice.tone === "error" && "border-danger/30 bg-danger-soft text-danger",
        notice.tone === "success" && "border-moss/30 bg-moss-soft text-moss",
      )}
    >
      {notice.text}
      {notice.grant && (
        <button className="ml-1.5 font-semibold text-seal hover:underline" onClick={() => api.axRequest().catch(() => {})}>
          {tr("Grant access →")}</button>
      )}
    </div>
  );
}
