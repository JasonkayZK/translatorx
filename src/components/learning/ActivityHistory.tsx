import { useEffect, useState } from "react";
import { ChevronDown, Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import { t as tr, formatDate, formatNumber } from "../../lib/i18n";
import { ACTIVITY_KINDS } from "../../lib/learning";
import { lang } from "../../lib/languages";
import type { ActivityKind, LearningActivity } from "../../lib/types";
import { Button, ConfirmIconButton, Select } from "../ui";

export function activityLabel(kind: ActivityKind) { return tr(`learning.kind.${kind}`); }
export function languagePair(source: string, target: string) { return target ? `${lang(source).label} → ${lang(target).label}` : lang(source).label; }
const PAGE_SIZE = 15;

function Detail({ activity: a }: { activity: LearningActivity }) {
  let segments: { source?: string; target?: string; answer?: string }[] = [];
  if (a.kind === "practice") {
    try { const parsed = JSON.parse(a.detail); if (Array.isArray(parsed)) segments = parsed.filter((item) => item && typeof item === "object" && typeof item.source === "string" && typeof item.target === "string"); } catch { /* Legacy details may be absent. */ }
  }
  return <div className="space-y-4 border-t border-line bg-paper-2/40 px-5 py-4 text-[13px]">
    <div className="grid gap-4 md:grid-cols-2">
      <div><div className="eyebrow mb-1">{lang(a.sourceLang).label}</div><p className="selectable whitespace-pre-wrap break-words">{a.source}</p></div>
      <div><div className="eyebrow mb-1">{a.targetLang ? lang(a.targetLang).label : tr("Meaning")}</div><p className="selectable whitespace-pre-wrap break-words text-ink-2">{a.target}</p></div>
    </div>
    {a.kind === "practice" && <p className="text-[12px] text-ink-3">{tr("learning.practiceDetail", { correct: a.correctWords, total: a.totalWords, segments: a.segments, minutes: formatNumber(a.durationMs / 60_000, { maximumFractionDigits: 1 }) })}</p>}
    {a.kind === "review" && a.grade !== null && <p className="text-[12px] text-ink-3">{tr("learning.reviewGrade", { grade: [tr("Forgot"), tr("Uncertain"), tr("review.gradeRemembered"), tr("Easy")][a.grade] ?? a.grade })}</p>}
    {segments.length > 0 && <ol className="space-y-2">{segments.map((s, i) => <li key={i} className="border-l-2 border-line-2 pl-3"><div className="text-ink-3">{s.source}</div><div>{s.target}</div>{s.answer && <div className="mt-1 text-moss">{tr("learning.yourAnswer", { answer: s.answer })}</div>}</li>)}</ol>}
    <p className="text-[11px] text-ink-3">{tr("learning.origin", { origin: tr(`learning.origin.${a.origin === "mini" ? "mini" : a.origin === "legacy" ? "legacy" : "main"}`) })}</p>
  </div>;
}

export function ActivityHistory({ since, revision, counts, onDelete }: { since?: number; revision: number; counts: Record<ActivityKind, number>; onDelete: () => void }) {
  const [kind, setKind] = useState<ActivityKind | "all">("all");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<LearningActivity[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [expanded, setExpanded] = useState<number | null>(null);
  const total = kind === "all" ? Object.values(counts).reduce((n, value) => n + value, 0) : counts[kind];
  const currentPage = Math.min(page, Math.max(0, Math.ceil(total / PAGE_SIZE) - 1));
  useEffect(() => { setPage(0); setExpanded(null); }, [since, kind]);
  useEffect(() => {
    let active = true;
    setBusy(true); setError("");
    api.listActivities({ limit: PAGE_SIZE, offset: currentPage * PAGE_SIZE, kind: kind === "all" ? undefined : kind, since })
      .then((rows) => { if (active) setRows(rows); })
      .catch((e) => { if (active) setError((e as Error).message); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [since, revision, kind, currentPage, retry]);
  const remove = async (id: number) => {
    try { await api.deleteActivity(id); setRows((rows) => rows.filter((a) => a.id !== id)); onDelete(); }
    catch (e) { setError((e as Error).message); }
  };
  return <section className="card overflow-hidden">
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-4">
      <div><h2 className="text-[14px] font-medium">{tr("learning.history")}</h2><p className="mt-1 text-[12px] text-ink-3">{tr("learning.historyHint")}</p></div>
      <Select aria-label={tr("learning.activityType")} value={kind} onChange={(e) => setKind(e.target.value as ActivityKind | "all")}>
        <option value="all">{tr("learning.allTypes")}</option>{ACTIVITY_KINDS.map((k) => <option key={k} value={k}>{activityLabel(k)}</option>)}
      </Select>
    </div>
    {error && <div role="alert" className="flex items-center gap-3 px-5 py-3 text-[12px] text-danger">{error}<Button size="sm" onClick={() => setRetry((n) => n + 1)}>{tr("learning.retry")}</Button></div>}
    {busy ? <p role="status" className="px-5 py-8 text-[13px] text-ink-3">{tr("learning.loading")}</p> : rows.length === 0 ? <p className="px-5 py-8 text-[13px] text-ink-3">{tr("learning.emptyPeriod")}</p> : <ul className="divide-y divide-line border-t border-line">
      {rows.map((a) => <li key={a.id}>
        <div className="flex items-center gap-2 px-3 py-1">
          <button className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-3 text-left hover:bg-paper-2/60" aria-expanded={expanded === a.id} onClick={() => setExpanded(expanded === a.id ? null : a.id)}>
            <ChevronDown className="size-4 shrink-0 text-ink-3 transition-transform" style={{ transform: expanded === a.id ? "rotate(180deg)" : undefined }} />
            <div className="min-w-0 flex-1"><div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-3"><span className="rounded bg-paper-2 px-1.5 py-0.5 font-medium text-ink-2">{activityLabel(a.kind)}</span><span>{languagePair(a.sourceLang, a.targetLang)}</span><time dateTime={new Date(a.createdAt).toISOString()}>{formatDate(a.createdAt, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time></div><p className="mt-1 truncate text-[13px] font-medium">{a.source || a.target}</p></div>
            {a.kind === "practice" && a.totalWords > 0 && <span className="font-mono text-[12px] text-moss">{formatNumber(a.correctWords / a.totalWords, { style: "percent", maximumFractionDigits: 0 })}</span>}
          </button>
          <ConfirmIconButton label={tr("Delete record")} onConfirm={() => remove(a.id)}><Trash2 className="size-4" /></ConfirmIconButton>
        </div>
        {expanded === a.id && <Detail activity={a} />}
      </li>)}
    </ul>}
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3 text-[12px] text-ink-3">
      <span>{tr("learning.page", { current: currentPage + 1, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), count: total })}</span>
      <div className="flex gap-2"><Button size="sm" disabled={currentPage === 0 || busy} onClick={() => setPage(currentPage - 1)}>{tr("learning.previous")}</Button><Button size="sm" disabled={(currentPage + 1) * PAGE_SIZE >= total || busy} onClick={() => setPage(currentPage + 1)}>{tr("learning.next")}</Button></div>
    </div>
  </section>;
}
