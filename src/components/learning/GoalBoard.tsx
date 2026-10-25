import { Target } from "lucide-react";
import { t as tr, formatNumber } from "../../lib/i18n";
import { goalRows } from "../../lib/learning";
import type { GoalProgress } from "../../lib/learning";
import { GOAL_KINDS } from "../../lib/types";
import type { GoalKind, Goals } from "../../lib/types";
import { useApp } from "../../store";
import { Button, cx } from "../ui";

export const goalLabel = (kind: GoalKind) => tr(`goals.kind.${kind}`);
export const goalUnit = (kind: GoalKind) => tr(`goals.unit.${kind}`);
export const goalHint = (kind: GoalKind) => tr(`goals.hint.${kind}`);

/** Targets offered when a goal kind is switched on. */
export const SUGGESTED_TARGETS: Goals = { practice: 10, words: 60, reviews: 20, lookups: 10, translations: 5, reads: 3, minutes: 15, activities: 20 };

export function goalText(value: number, target: number, kind: GoalKind): string {
  return target > 0 ? `${formatNumber(value)} / ${formatNumber(target)} ${goalUnit(kind)}` : `${formatNumber(value)} ${goalUnit(kind)}`;
}

/** Opens the goals section of the settings page. */
export function openGoalSettings() {
  useApp.getState().go("settings");
  requestAnimationFrame(() => document.getElementById("goals")?.scrollIntoView({ block: "start" }));
}

export function GoalBar({ value, target, done, label }: { value: number; target: number; done: boolean; label: string }) {
  return (
    <div className="goal-bar" data-done={done} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={target} aria-valuenow={Math.min(value, target)}>
      <i style={{ width: `${Math.min(1, value / Math.max(1, target)) * 100}%` }} />
    </div>
  );
}

/** Every goal with a target, with the progress made today. */
export function GoalBoard({ goals, today }: { goals: Goals; today: GoalProgress }) {
  const rows = goalRows(goals, GOAL_KINDS.filter((kind) => goals[kind] > 0), today);
  const done = rows.filter((row) => row.done).length;
  return (
    <section className="card px-5 py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-medium">{tr("goals.today")}</h2>
          <p className="mt-1 text-[12px] text-ink-3">{rows.length ? tr("goals.completedCount", { done, total: rows.length }) : tr("goals.none")}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={openGoalSettings} icon={<Target className="size-3.5" />}>{tr("goals.configure")}</Button>
      </div>
      {rows.length > 0 && (
        <div className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2">
          {rows.map((row) => (
            <div key={row.kind} className="goal-row">
              <span className="goal-row-label !text-[12px]">{goalLabel(row.kind)}</span>
              <span className={cx("goal-row-value", row.done && "text-moss")}>{goalText(row.value, row.target, row.kind)}</span>
              <GoalBar value={row.value} target={row.target} done={row.done} label={goalLabel(row.kind)} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
