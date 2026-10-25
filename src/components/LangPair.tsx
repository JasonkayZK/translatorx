import { t as tr } from "../lib/i18n";
import { ArrowRightLeft } from "lucide-react";
import { LANGUAGES } from "../lib/languages";
import { cx } from "./ui";

function LangSelect({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <label className="group relative flex items-center">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 max-w-[176px] min-w-0 cursor-pointer appearance-none rounded-md bg-transparent pr-2 pl-2 text-[12px] font-medium text-ink hover:bg-ink/5"
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label} · {l.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function LangPair({ from, to, onChange, className }: { from: string; to: string; onChange: (from: string, to: string) => void; className?: string }) {
  return (
    <div className={cx("inline-flex items-center gap-0.5 rounded-lg border border-line bg-card/70 px-1", className)}>
      <LangSelect label={tr("Native language")} value={from} onChange={(v) => onChange(v, v === to ? from : to)} />
      <button
        onClick={() => onChange(to, from)}
        className="flex size-7 items-center justify-center rounded-md text-ink-3 transition-transform hover:rotate-180 hover:text-seal"
        aria-label={tr("Swap languages")}
        title={tr("Swap languages")}
      >
        <ArrowRightLeft className="size-3.5" />
      </button>
      <LangSelect label={tr("Target language")} value={to} onChange={(v) => onChange(v === from ? to : from, v)} />
    </div>
  );
}
