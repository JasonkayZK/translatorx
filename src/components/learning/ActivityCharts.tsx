import { useMemo, useState } from "react";
import { t as tr, formatDate, formatNumber } from "../../lib/i18n";
import type { ActivityDay } from "../../lib/learning";
import { cx, Segmented } from "../ui";
import "./charts.css";

/** A bounded number of bars; each bucket retains sums for weighted accuracy. */
function buckets(days: ActivityDay[]) {
  const size = Math.max(1, Math.ceil(days.length / 30));
  const out: (ActivityDay & { end: string })[] = [];
  for (let i = 0; i < days.length; i += size) {
    const group = days.slice(i, i + size);
    const totalWords = group.reduce((n, d) => n + d.totalWords, 0);
    const correctWords = group.reduce((n, d) => n + d.correctWords, 0);
    out.push({ ...group[0], end: group.at(-1)!.date, count: group.reduce((n, d) => n + d.count, 0), totalWords, correctWords, accuracy: totalWords ? correctWords / totalWords : null });
  }
  return out;
}

export function ActivityTrend({ days, accuracy = false }: { days: ActivityDay[]; accuracy?: boolean }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const bars = useMemo(() => buckets(days), [days]);
  const [hover, setHover] = useState<number | null>(null);
  const max = accuracy ? 1 : Math.max(1, ...bars.map((d) => d.count));
  const value = (day: ActivityDay) => accuracy ? day.accuracy === null ? "—" : formatNumber(day.accuracy, { style: "percent", maximumFractionDigits: 0 }) : formatNumber(day.count);
  const date = (day: typeof bars[number]) => day.date === day.end ? formatDate(day.date) : `${formatDate(day.date)} – ${formatDate(day.end)}`;
  const highlighted = hover === null ? undefined : bars[hover];
  const title = accuracy ? tr("learning.accuracyTrend") : tr("learning.activityTrend");
  return (
    <section className="card chart-card">
      <div className="section-heading">
        <h2>{title}</h2>
        <Segmented label={title} value={view} onChange={setView} size="sm" options={[{ value: "chart", label: tr("Chart") }, { value: "table", label: tr("Table") }]} />
      </div>
      <p className="chart-description">{accuracy ? tr("learning.accuracyHint") : tr("learning.trendHint")}</p>
      {accuracy && !bars.some((b) => b.totalWords > 0) ? (
        <div className="flex h-[196px] items-center justify-center text-[12px] text-ink-3">{tr("learning.noPractice")}</div>
      ) : view === "table" ? (
        <div className="chart-table-wrap">
          <table className="chart-table"><thead><tr><th>{tr("learning.date")}</th><th>{accuracy ? tr("Practice accuracy") : tr("learning.activities")}</th></tr></thead>
            <tbody>{[...bars].reverse().map((d) => <tr key={d.date}><td>{date(d)}</td><td>{value(d)}</td></tr>)}</tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="chart-plot" role="group" aria-label={title}>
            <div className="chart-grid" aria-hidden><i /><i /><i /></div>
            <div className="chart-axis" aria-hidden><span>{accuracy ? "100%" : formatNumber(max)}</span><span>0</span></div>
            <div className="chart-bars">
              {bars.map((d, i) => <button key={d.date} type="button"
                className="chart-hit" aria-label={`${date(d)}: ${value(d)}`} title={`${date(d)}: ${value(d)}`}
                onFocus={() => setHover(i)} onBlur={() => setHover(null)} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <span className={cx("chart-bar", hover !== null && hover !== i && "opacity-40")}
                  style={{ height: `${((accuracy ? d.accuracy ?? 0 : d.count) / max) * 100}%` }} />
              </button>)}
            </div>
          </div>
          <div className="mt-3 ml-7 flex justify-between text-[10px] text-ink-3"><span>{bars[0] && formatDate(bars[0].date)}</span><span>{bars.at(-1) && formatDate(bars.at(-1)!.end)}</span></div>
          <p className="chart-readout" aria-live="polite">{highlighted ? <><span>{date(highlighted)}</span><b>{value(highlighted)}</b></> : tr("learning.chartHint")}</p>
        </>
      )}
    </section>
  );
}

const HEAT_LEVELS = [55, 70, 85, 100];
function heatColor(count: number, max: number) {
  const level = HEAT_LEVELS[Math.min(3, Math.ceil(count / max * 4) - 1)];
  return count ? `color-mix(in srgb, var(--heatmap-high) ${level}%, var(--card))` : "var(--line)";
}

export function ActivityHeatmap({ days }: { days: ActivityDay[] }) {
  const [hover, setHover] = useState<ActivityDay | null>(null);
  const [view, setView] = useState<"chart" | "table">("chart");
  const pad = days.length ? (new Date(`${days[0].date}T00:00:00`).getDay() + 6) % 7 : 0;
  const max = Math.max(1, ...days.map((d) => d.count));
  const label = (d: ActivityDay) => tr("learning.dayCount", { date: formatDate(d.date, { year: "numeric", month: "short", day: "numeric" }), count: d.count });
  return (
    <section className="card chart-card">
      <div className="section-heading">
        <h2>{tr("Daily activity")}</h2>
        <Segmented label={tr("Daily activity")} value={view} onChange={setView} size="sm" options={[{ value: "chart", label: tr("Chart") }, { value: "table", label: tr("Table") }]} />
      </div>
      <p className="mb-5 text-[11px] text-ink-3">{tr("learning.calendarHint")}</p>
      {view === "table" ? (
        <div className="chart-table-wrap">
          <table className="chart-table"><thead><tr><th>{tr("learning.date")}</th><th>{tr("learning.activities")}</th></tr></thead>
            <tbody>{[...days].reverse().map((d) => <tr key={d.date}><td>{formatDate(d.date)}</td><td>{formatNumber(d.count)}</td></tr>)}</tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto pb-2">
            <div className="grid w-max grid-flow-col grid-rows-7 gap-1" role="group" aria-label={tr("Daily activity")}>
              {[tr("Mon"), "", tr("Wed"), "", tr("Fri"), "", tr("Sun")].map((d, i) => <span className="mr-2 flex h-4 items-center text-[10px] text-ink-3" key={`label-${i}`}>{d}</span>)}
              {Array.from({ length: pad }, (_, i) => <span key={`pad-${i}`} />)}
              {days.map((d) => <button key={d.date} type="button" aria-label={label(d)} title={label(d)}
                onFocus={() => setHover(d)} onBlur={() => setHover(null)} onMouseEnter={() => setHover(d)} onMouseLeave={() => setHover(null)}
                className="heatmap-cell" style={{ background: heatColor(d.count, max) }} />)}
            </div>
          </div>
          <div className="mt-3 flex items-center justify-end gap-1.5 text-[10px] text-ink-3" aria-hidden>
            <span className="mr-1">{tr("Less")}</span>
            {[0, 1, 2, 3, 4].map((n) => <span key={n} className="size-2.5 rounded-[2px]" style={{ background: heatColor(n, 4) }} />)}
            <span className="ml-1">{tr("More")}</span>
          </div>
          <p className="chart-readout" aria-live="polite">{hover ? label(hover) : tr("learning.chartHint")}</p>
        </>
      )}
    </section>
  );
}
