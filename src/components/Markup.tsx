import { t as tr } from "../lib/i18n";
import type { Op } from "../lib/check";
import { lang } from "../lib/languages";
import { cx } from "./ui";

/** Renders an answer the way a teacher marks it: strike the slip, write the fix above in red. */
/** With `reveal` off, errors are marked but the right words stay hidden so the learner must recall them. */
export function Markup({ ops, code, className, reveal = true }: { ops: Op[]; code: string; className?: string; reveal?: boolean }) {
  const spaced = lang(code).spaced;
  return (
    <div className={cx("selectable flex flex-wrap items-end font-display text-[21px] leading-none", spaced ? "gap-x-[0.42em] gap-y-3" : "gap-x-[0.06em] gap-y-3", className)}>
      {ops.map((op, i) => {
        const needsNote = op.kind === "wrong" || op.kind === "typo" || op.kind === "missing";
        const note = needsNote ? (reveal ? op.expected.text : op.kind === "typo" ? tr("Spelling") : "?") : "";
        return (
          <span key={i} className="inline-flex flex-col items-center">
            <span className={cx("pen-note h-[1.05em] text-[14px] whitespace-nowrap", !note && "invisible")}>{note || "·"}</span>
            {op.kind === "ok" && <span className="pen-ok pb-1">{op.got.text}</span>}
            {op.kind === "typo" && <span className="pen-typo pb-1">{op.got.text}</span>}
            {op.kind === "wrong" && <span className="pen-strike pb-1">{op.got.text}</span>}
            {op.kind === "extra" && <span className="pen-strike pb-1 opacity-70">{op.got.text}</span>}
            {op.kind === "missing" && (
              <span className="pb-1 text-danger" aria-label={tr("Missing {p0}", { p0: op.expected.text })}>
                ‸
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

export function MarkupLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-ink-3">
      <span><span className="pen-ok text-ink-2">{tr("common.exampleWord")}</span> {tr("Correct")}</span>
      <span><span className="pen-typo text-ink-2">{tr("common.exampleWord")}</span> {tr("Minor spelling error")}</span>
      <span><span className="pen-strike">{tr("common.exampleWord")}</span> {tr("Incorrect or extra")}</span>
      <span><span className="text-danger">‸</span> {tr("Missing")}</span>
    </div>
  );
}
