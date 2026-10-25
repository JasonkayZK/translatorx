import { t as tr } from "../../lib/i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Clock3, Mail, MessageCircle, MessagesSquare, Trash2 } from "lucide-react";
import { activityContext } from "../../lib/learning";
import { api, onEvent } from "../../lib/api";
import { lang } from "../../lib/languages";
import { recoverBreaks, splitDraft } from "../../lib/segment";
import type { PracticeMode, Session } from "../../lib/types";
import { LangPair } from "../../components/LangPair";
import { Button, ConfirmIconButton, cx, MOD, PageHeader, Segmented } from "../../components/ui";
import { useApp } from "../../store";
import type { PracticeSegment } from "../../store";

const SAMPLES = [
  { icon: Mail, get label() { return tr("Reply to an email"); }, text: "你好 Alex，\n感谢你的回复。我们周五下午三点见，我会把方案带过去。" },
  { icon: MessageCircle, get label() { return tr("Work message"); }, text: "今天的会议改到明天上午了，你方便吗？" },
  { icon: MessagesSquare, get label() { return tr("Web comment"); }, text: "这篇文章写得很清楚，帮我解决了一个困扰很久的问题。" },
];

export const MODES: { value: PracticeMode; label: string; hint: string }[] = [
  { value: "recall", get label() { return tr("Recall"); }, get hint() { return tr("Read the native text and write the full sentence from memory"); } },
  { value: "cloze", get label() { return tr("Cloze"); }, get hint() { return tr("Fill in the missing words"); } },
  { value: "typing", get label() { return tr("Typing"); }, get hint() { return tr("Type the translation character by character"); } },
];

export function toPractice(segs: { source: string; target: string; breakAfter: boolean }[]): PracticeSegment[] {
  return segs.map((s) => ({
    source: s.source,
    target: s.target,
    breakAfter: s.breakAfter,
    answer: "",
    status: "pending",
    correct: 0,
    total: 0,
    score: 0,
    hints: 0,
    attempts: 0,
    tries: [],
    saved: false,
  }));
}

function ago(ms: number) {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return tr("Just now");
  if (m < 60) return tr("{p0} minutes ago", { p0: m });
  const h = Math.round(m / 60);
  if (h < 24) return tr("{p0} hours ago", { p0: h });
  return tr("{p0} days ago", { p0: Math.round(h / 24) });
}

export function Compose() {
  const { draft, setDraft, from, to, setPair, mode, setMode, settings, updateSettings, startPractice, toast, composeNonce } = useApp();
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<Session[]>([]);
  const operation = useRef<{ key: string; activity: ReturnType<typeof activityContext> } | null>(null);
  const submitting = useRef(false);
  const area = useRef<HTMLTextAreaElement>(null);

  const preview = useMemo(() => splitDraft(draft, from, settings.segmentMode), [draft, from, settings.segmentMode]);

  useEffect(() => {
    area.current?.focus();
  }, [composeNonce]);

  useEffect(() => {
    let alive = true;
    const load = () => api.listSessions(6).then((rows) => { if (alive) setRecent(rows); }).catch(() => {});
    void load();
    const off = onEvent("learning-changed", load);
    return () => { alive = false; void off.then((fn) => fn()); };
  }, []);

  const start = async () => {
    if (!preview.length || submitting.current) return;
    if (from === to) {
      toast(tr("Native and target languages must be different"), "error");
      return;
    }
    submitting.current = true;
    const key = JSON.stringify([draft, from, to, settings.segmentMode]);
    if (operation.current?.key !== key) operation.current = { key, activity: activityContext("translate") };
    setBusy(true);
    try {
      const out = await api.prepareSession(draft, preview.map((p) => p.source), from, to, operation.current.activity);
      if (!out.length) throw new Error(tr("No translation is available for practice"));
      operation.current = null;
      const breaks = recoverBreaks(draft, out.map((o) => o.source));
      startPractice(toPractice(out.map((o, i) => ({ ...o, breakAfter: breaks[i] }))));
    } catch (e) {
      toast(tr("Translation failed: {p0}", { p0: (e as Error).message }), "error");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  const replay = (s: Session) => {
    try {
      const segs = JSON.parse(s.detail) as { source: string; target: string; breakAfter?: boolean }[];
      if (!segs.length) throw new Error();
      setPair(s.sourceLang, s.targetLang);
      setDraft(s.draft);
      startPractice(toPractice(segs.map((x) => ({ source: x.source, target: x.target, breakAfter: !!x.breakAfter }))));
    } catch {
      setDraft(s.draft);
      toast(tr("This record has no saved segments. The source text was loaded."), "info");
    }
  };

  const remove = async (id: number) => {
    try {
      await api.deleteSession(id);
      setRecent((r) => r.filter((x) => x.id !== id));
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <div className="page-shell">
      <PageHeader eyebrow={tr("ui.writeHint")} title={tr("Writing practice")} />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <LangPair from={from} to={to} onChange={setPair} />
        <span className="text-[11px] text-ink-3">{tr("ui.practiceHint")}</span>
      </div>

      <div className="card editor-card">
        <div className="editor-label"><span className="size-1.5 rounded-full bg-seal" />{tr("ui.draft")}</div>
        <textarea
          ref={area}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              start();
            }
          }}
          aria-label={tr("ui.draft")}
          placeholder={tr("ui.draftPlaceholder", { language: lang(from).label })}
          className="editor-area"
          style={{ fieldSizing: "content" } as React.CSSProperties}
        />
        <div className="editor-options">
          <Segmented value={mode} onChange={setMode} options={MODES} size="sm" />
          <Segmented
            size="sm"
            value={settings.segmentMode}
            onChange={(v) => updateSettings({ segmentMode: v })}
            options={[{ value: "sentence", label: tr("practice.sentenceMode"), hint: tr("Split into sentences") }, { value: "clause", label: tr("Clauses"), hint: tr("Split long sentences at commas to make them easier to remember") }]}
          />
          <span className="ml-auto text-[10px] text-ink-3">
            {preview.length ? tr("{p0} segments · {p1} characters", { p0: preview.length, p1: draft.replace(/\s/g, "").length }) : tr("No text yet")}
          </span>
        </div>
      </div>
      <div className="editor-submit">
        <div className="flex flex-wrap items-center gap-2">
          {SAMPLES.map((sample) => (
            <button key={sample.label} type="button" className="sample-chip" onClick={() => { setDraft(sample.text); area.current?.focus(); }}>
              <sample.icon className="size-3.5 text-ink-3" />{sample.label}
            </button>
          ))}
        </div>
        <Button variant="seal" size="lg" onClick={start} loading={busy} disabled={!preview.length}>
          {busy ? tr("Translating text…") : tr("Start writing")}
          <span className="ml-1 font-mono text-[10px] opacity-75">{MOD}↵</span>
          {!busy && <ArrowRight className="ml-1 size-3.5" />}
        </Button>
      </div>

      {preview.length > 0 && (
        <section className="mt-10">
          <div className="eyebrow mb-3">{tr("Segment preview")}</div>
          <ol className="stagger grid gap-2">
            {preview.map((p, i) => (
              <li key={`${i}-${p.source}`} className="flex items-baseline gap-4 rounded-lg px-1 text-[14px] text-ink-2">
                <span className="w-6 shrink-0 text-right font-mono text-[11px] text-seal">{String(i + 1).padStart(2, "0")}</span>
                <span className="font-display">{p.source}</span>
                {p.breakAfter && <span className="font-mono text-[10px] text-ink-3">¶</span>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {recent.length > 0 && (
        <section className="mt-12">
          <div className="mb-3 flex items-center gap-2">
            <Clock3 className="size-3.5 text-ink-3" />
            <span className="eyebrow">{tr("Recent practices")}</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {recent.map((s) => {
              const acc = s.totalWords ? s.correctWords / s.totalWords : 0;
              return (
                <div key={s.id} className="recent-item group">
                  <button type="button" className="block w-full rounded text-left" onClick={() => replay(s)}>
                    <span className="block truncate text-[13px] font-medium text-ink">{s.draft}</span>
                    <span className="mt-1.5 block truncate text-[12px] text-ink-3">{s.result}</span>
                  </button>
                  <div className="mt-4 flex items-center gap-3 text-[10px] text-ink-3">
                    <span className={cx(acc >= 0.9 ? "text-moss" : acc >= 0.6 ? "text-amber" : "text-seal")}>{Math.round(acc * 100)}%</span>
                    <span>{tr("write.segments", { count: s.segments })}</span>
                    <span>{ago(s.createdAt)}</span>
                    <ConfirmIconButton label={tr("Delete record")} onConfirm={() => remove(s.id)} className="ml-auto h-6 min-w-6 opacity-0 group-hover:opacity-100">
                      <Trash2 className="size-3.5" />
                    </ConfirmIconButton>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
