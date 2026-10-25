import { useEffect, useId, useRef } from "react";
import { RotateCcw } from "lucide-react";
import { t as tr, formatNumber } from "../../lib/i18n";
import { materialStyle } from "../../lib/appearance";
import type { MaterialPrefs } from "../../lib/types";
import { Button, Toggle } from "../ui";

export function PreferenceRange({ label, value, min = 0, max = 100, unit = "%", disabled = false, onChange, onCommit }: {
  label: string; value: number; min?: number; max?: number; unit?: string; disabled?: boolean;
  onChange: (value: number) => void; onCommit: () => void;
}) {
  const id = useId();
  return (
    <label className="material-range" htmlFor={id}>
      <span>{label}</span>
      <input id={id} type="range" min={min} max={max} step={1} value={value} disabled={disabled}
        aria-valuetext={`${formatNumber(value)}${unit}`}
        onChange={(event) => onChange(Number(event.target.value))}
        onPointerUp={onCommit} onKeyUp={onCommit} onBlur={onCommit} />
      <output htmlFor={id}>{formatNumber(value)}{unit}</output>
    </label>
  );
}

export function MaterialControls({ value, onChange, onReset, scope, compact = false }: {
  value: MaterialPrefs; onChange: (patch: Partial<MaterialPrefs>, delayed?: boolean) => void;
  onReset?: () => void; scope?: string; compact?: boolean;
}) {
  const latest = useRef(onChange);
  latest.current = onChange;
  useEffect(() => () => latest.current({}, false), []);
  const label = (key: string) => scope ? `${scope} · ${tr(key)}` : tr(key);
  return (
    <div className="material-controls">
      {!compact && <div className="material-preview" style={materialStyle(value)} role="img" aria-label={label("material.preview")}>
        <div className="material-preview-pane">{tr("material.preview")}</div>
      </div>}
      <PreferenceRange label={label("material.transparency")} value={100 - Math.round(value.opacity * 100)} max={70}
        onChange={(transparency) => onChange({ opacity: (100 - transparency) / 100 }, true)} onCommit={() => onChange({}, false)} />
      <div className="flex items-start justify-between gap-5">
        <div>
          <div className="text-[12px] font-medium">{tr("material.frost")}</div>
          {!compact && <p className="material-note mt-1">{tr("material.frostHint")}</p>}
        </div>
        <Toggle label={label("material.frost")} checked={value.blur} onChange={(blur) => onChange({ blur }, false)} />
      </div>
      {value.opacity < .55 && <p role="status" className="rounded-lg bg-amber-soft px-3 py-2 text-[11px] leading-relaxed text-ink-2">{tr("material.readabilityHint")}</p>}
      {onReset && <div><Button variant="ghost" size="sm" onClick={onReset} icon={<RotateCcw className="size-3" />}>{tr("material.reset")}</Button></div>}
    </div>
  );
}
