import { useEffect, useMemo, useState } from "react";
import { BarChart3 } from "lucide-react";
import { t as tr, formatNumber, getLocale } from "../lib/i18n";
import { api, onEvent } from "../lib/api";
import { ACTIVITY_KINDS, calendarDays, rangeStart, shiftDay, summarizeActivities } from "../lib/learning";
import type { DateRange } from "../lib/learning";
import type { ActivityMetric, Stats } from "../lib/types";
import { Button, Empty, PageHeader, Segmented } from "../components/ui";
import { ActivityHeatmap, ActivityTrend } from "../components/learning/ActivityCharts";
import { ActivityHistory, activityLabel, languagePair } from "../components/learning/ActivityHistory";
import { GoalBoard } from "../components/learning/GoalBoard";
import { GOAL_KINDS } from "../lib/types";
import { useApp } from "../store";

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="card stat-tile">
      <div className="text-[11px] font-medium text-ink-2">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="mt-4 text-[10px] leading-relaxed text-ink-3">{sub}</div>
    </div>
  );
}

export function StatsPage() {
  const goals = useApp((s) => s.settings.goals);
  const [data, setData] = useState<{ stats: Stats; activities: ActivityMetric[]; now: number } | null>(null);
  const [range, setRange] = useState<DateRange>("30");
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const locale = getLocale();
  const refresh = () => setRevision((n) => n + 1);
  useEffect(() => {
    const off = onEvent("learning-changed", () => setRevision((n) => n + 1));
    const interval = setInterval(() => setRevision((n) => n + 1), 60_000);
    return () => { clearInterval(interval); void off.then((unlisten) => unlisten()); };
  }, []);
  useEffect(() => {
    let active = true;
    Promise.all([api.getStats(), api.activityMetrics()])
      .then(([stats, activities]) => { if (active) { setData({ stats, activities, now: Date.now() }); setError(""); } })
      .catch((e) => { if (active) setError((e as Error).message); });
    return () => { active = false; };
  }, [revision]);
  const now = data?.now ?? Date.now();
  const since = rangeStart(range, now);
  const all = useMemo(() => summarizeActivities(data?.activities ?? [], now, locale), [data, now, locale]);
  const summary = useMemo(() => summarizeActivities((data?.activities ?? []).filter((a) => since === undefined || a.createdAt >= since), now, locale), [data, since, now, locale]);
  const days = useMemo(() => calendarDays(summary.days, since ?? (summary.days[0] ? new Date(`${summary.days[0].date}T00:00:00`).getTime() : shiftDay(now, -29).getTime()), now, locale), [summary, since, now, locale]);
  const heatmap = days.slice(-112);
  const enabledGoals = GOAL_KINDS.filter((kind) => goals[kind] > 0);
  const goalsDone = enabledGoals.filter((kind) => all.today[kind] >= goals[kind]).length;
  return <div className="page-shell page-shell-wide">
    <PageHeader eyebrow={tr("ui.statisticsHint")} title={tr("Learning overview")}>
      <Segmented value={range} onChange={setRange} size="sm" options={[{ value: "7", label: tr("learning.days7") }, { value: "30", label: tr("learning.days30") }, { value: "90", label: tr("learning.days90") }, { value: "all", label: tr("learning.allTime") }]} />
    </PageHeader>
    {error && <div role="alert" className="card mb-5 flex items-center gap-3 px-5 py-3 text-[13px] text-danger">{error}<Button size="sm" onClick={refresh}>{tr("learning.retry")}</Button></div>}
    {!data ? !error && <p role="status" className="text-[13px] text-ink-3">{tr("learning.loading")}</p> : <>
      <div className="stagger grid grid-cols-2 gap-3 md:grid-cols-3">
        <Tile label={tr("learning.todayActivities")} value={formatNumber(all.todayCount)} sub={tr("learning.periodCount", { count: summary.count })} />
        <Tile label={tr("Practice accuracy")} value={summary.accuracy === null ? "—" : formatNumber(summary.accuracy, { style: "percent", maximumFractionDigits: 0 })} sub={tr("learning.wordsPracticed", { count: summary.totalWords })} />
        <Tile label={tr("Learning streak")} value={tr("{p0} days", { p0: all.streak })} sub={tr("learning.streakHint")} />
        <Tile label={tr("learning.practiceTime")} value={tr("learning.minutes", { count: Math.round(summary.durationMs / 60_000) })} sub={enabledGoals.length ? tr("goals.completedCount", { done: goalsDone, total: enabledGoals.length }) : tr("goals.none")} />
        <Tile label={tr("learning.practiceSegments")} value={formatNumber(summary.practiceSegments)} sub={tr("learning.periodHint")} />
        <Tile label={tr("learning.reviews")} value={formatNumber(summary.kinds.review)} sub={tr("learning.periodHint")} />
      </div>
      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[12px] text-ink-3">
        <span>{tr("learning.favorites", { words: data.stats.wordsTotal, sentences: data.stats.sentencesTotal })}</span>
        <span>{tr("learning.due", { count: data.stats.dueWords + data.stats.dueSentences })}</span>
      </div>
      <div className="mt-4"><GoalBoard goals={goals} today={all.today} /></div>
      {summary.count === 0 ? <div className="card mt-6"><Empty icon={<BarChart3 className="size-5" />} title={tr("learning.emptyPeriod")}>{tr("learning.emptyHint")}</Empty></div> : <>
        <div className="mt-6 grid gap-4 lg:grid-cols-2"><ActivityTrend days={days} /><ActivityTrend days={days} accuracy /></div>
        <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <ActivityHeatmap days={heatmap} />
          <section className="card min-w-0 px-5 py-5">
            <h2 className="text-[14px] font-medium">{tr("learning.byActivity")}</h2>
            <div className="mt-4 space-y-3">{ACTIVITY_KINDS.map((kind) => <div key={kind} className="flex items-center gap-3 text-[12px]"><span className="w-24 shrink-0 text-ink-2">{activityLabel(kind)}</span><div className="h-1.5 min-w-0 flex-1 rounded-full bg-line"><div className="h-full rounded-full bg-series-1" style={{ width: `${100 * summary.kinds[kind] / summary.count}%` }} /></div><span className="w-8 text-right font-mono">{formatNumber(summary.kinds[kind])}</span></div>)}</div>
          </section>
        </div>
        <section className="card mt-4 px-5 py-5">
          <h2 className="text-[14px] font-medium">{tr("learning.byLanguage")}</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">{summary.languages.map((pair) => <div key={`${pair.sourceLang}-${pair.targetLang}`} className="flex items-center justify-between gap-4 rounded-lg bg-paper-2/60 px-3 py-2 text-[12px]"><span>{languagePair(pair.sourceLang, pair.targetLang)}</span><span className="font-mono text-ink-3">{tr("learning.count", { count: pair.count })}</span></div>)}</div>
        </section>
      </>}
      <div className="mt-6"><ActivityHistory since={since} revision={revision} counts={summary.kinds} onDelete={refresh} /></div>
    </>}
  </div>;
}
