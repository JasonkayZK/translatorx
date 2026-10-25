import { t as tr, formatNumber } from "../lib/i18n";
import { useEffect, useState } from "react";
import { BarChart3, BookOpenText, Flame, NotebookPen, PenLine, Repeat2, Settings2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { goalRows, summarizeActivities } from "../lib/learning";
import type { GoalProgress } from "../lib/learning";
import { api, onEvent } from "../lib/api";
import { GOAL_KINDS } from "../lib/types";
import type { Stats } from "../lib/types";
import { useApp } from "../store";
import type { Page } from "../store";
import { GoalBar, goalLabel, goalText, openGoalSettings } from "./learning/GoalBoard";
import { cx, MOD } from "./ui";

const NO_PROGRESS = Object.fromEntries(GOAL_KINDS.map((kind) => [kind, 0])) as GoalProgress;

const NAV: { id: Page; label: string; icon: LucideIcon }[] = [
  { id: "write", get label() { return tr("Writing practice"); }, icon: PenLine },
  { id: "read", get label() { return tr("Reading"); }, icon: BookOpenText },
  { id: "notebook", get label() { return tr("Notebook"); }, icon: NotebookPen },
  { id: "review", get label() { return tr("Spaced review"); }, icon: Repeat2 },
  { id: "stats", get label() { return tr("Learning overview"); }, icon: BarChart3 },
  { id: "settings", get label() { return tr("Settings"); }, icon: Settings2 },
];

export const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

export function Seal({ size = 34 }: { size?: number }) {
  return (
    <div
      className="brand-mark"
      style={{ width: size, height: size, fontSize: size * 0.52 }}
      aria-hidden
    >
      译
    </div>
  );
}

export function Sidebar() {
  const page = useApp((s) => s.page);
  const go = useApp((s) => s.go);
  const goals = useApp((s) => s.settings.goals);
  const shown = useApp((s) => s.settings.todayCard);
  const [stats, setStats] = useState<Stats | null>(null);
  const [today, setToday] = useState<GoalProgress>(NO_PROGRESS);

  useEffect(() => {
    let alive = true;
    const load = () => Promise.all([api.getStats(), api.activityMetrics()]).then(([s, activities]) => {
      const summary = summarizeActivities(activities);
      if (alive) { setStats({ ...s, streakDays: summary.streak, todaySegments: summary.todaySegments }); setToday(summary.today); }
    }).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    const off = onEvent("learning-changed", load);
    return () => {
      alive = false;
      clearInterval(t);
      void off.then((unlisten) => unlisten());
    };
  }, [page]);

  const due = stats ? stats.dueWords + stats.dueSentences : 0;
  const rows = goalRows(goals, shown, today);
  const primary = rows[0];

  const navItem = (n: typeof NAV[number], i: number) => {
    const active = page === n.id;
    const Icon = n.icon;
    return (
      <button key={n.id} type="button" onClick={() => go(n.id)} title={`${n.label}  ${MOD}${i + 1}`}
        className="nav-item group" aria-current={active ? "page" : undefined}>
        <Icon className={cx("size-[16px] shrink-0", active ? "text-seal" : "text-ink-3")} strokeWidth={1.7} />
        <span className="min-w-0 flex-1 text-left font-medium">{n.label}</span>
        {n.id === "review" && due > 0 ? (
          <span className="rounded-md bg-seal-soft px-1.5 py-0.5 text-[10px] font-medium text-seal">{due > 99 ? "99+" : formatNumber(due)}</span>
        ) : (
          <span className="font-mono text-[9px] text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">{MOD}{i + 1}</span>
        )}
      </button>
    );
  };

  return (
    <aside className="app-sidebar">
      <div data-tauri-drag-region className={cx("app-brand", isMac && "app-brand-mac")}>
        <Seal size={32} />
        <div data-tauri-drag-region>
          <div className="text-[15px] font-semibold tracking-[-0.04em]">Translator<span className="text-seal">X</span></div>
          <div className="mt-0.5 text-[10px] text-ink-3">{tr("ui.tagline")}</div>
        </div>
      </div>

      <nav className="space-y-6 px-3">
        <div>
          <div className="nav-group-label">{tr("ui.workspace")}</div>
          <div className="space-y-1">{NAV.slice(0, 2).map(navItem)}</div>
        </div>
        <div>
          <div className="nav-group-label">{tr("ui.learning")}</div>
          <div className="space-y-1">{NAV.slice(2, 5).map((n, i) => navItem(n, i + 2))}</div>
        </div>
      </nav>

      <div className="mt-auto pt-8">
        <div className="daily-goal">
          <div className="flex items-center justify-between gap-2">
            <button type="button" onClick={openGoalSettings} title={tr("goals.configure")} className="text-[11px] font-medium text-ink-2 transition-colors hover:text-seal">{tr("Today")}</button>
            <span className="flex items-center gap-1 text-[10px] text-ink-3">
              <Flame className={cx("size-3", (stats?.streakDays ?? 0) > 0 && "text-seal")} />
              {tr("sidebar.streak", { count: stats?.streakDays ?? 0 })}
            </span>
          </div>
          {primary && (
            <>
              <div className="mt-3 flex items-baseline gap-1.5">
                <span className={cx("text-[25px] leading-none font-semibold tracking-tight", primary.done && "text-moss")}>{formatNumber(primary.value)}</span>
                <span className="min-w-0 truncate text-[10px] text-ink-3">{primary.target > 0 ? tr("goals.of", { target: primary.target, unit: tr(`goals.unit.${primary.kind}`) }) : goalLabel(primary.kind)}</span>
              </div>
              <div className="mt-1 text-[10px] text-ink-3">{goalLabel(primary.kind)}</div>
              {primary.target > 0 && <div className="mt-3"><GoalBar value={primary.value} target={primary.target} done={primary.done} label={goalLabel(primary.kind)} /></div>}
            </>
          )}
          {rows.length > 1 && (
            <div className="mt-3 space-y-2 border-t border-line pt-3">
              {rows.slice(1).map((row) => (
                <div key={row.kind} className="goal-row">
                  <span className="goal-row-label">{goalLabel(row.kind)}</span>
                  <span className={cx("goal-row-value", row.done && "text-moss")}>{goalText(row.value, row.target, row.kind)}</span>
                  {row.target > 0 && <GoalBar value={row.value} target={row.target} done={row.done} label={goalLabel(row.kind)} />}
                </div>
              ))}
            </div>
          )}
        </div>
        <nav className="border-t border-line px-3 py-3">{navItem(NAV[5], 5)}</nav>
      </div>
    </aside>
  );
}
