import { Check } from "lucide-react";
import { t as tr } from "../lib/i18n";
import type { MainStyle, MiniTheme, Theme } from "../lib/types";
import { DEFAULT_SETTINGS } from "../lib/types";
import { isTauri } from "../lib/api";
import { MaterialControls } from "./appearance/MaterialControls";
import { BackgroundControls } from "./appearance/BackgroundControls";
import { useApp } from "../store";
import { Select, Toggle } from "./ui";

const STYLES: MainStyle[] = ["paper", "glass", "studio"];

function StyleChoices({ value, onChange, label, mode, surface }: { value: MainStyle; onChange: (style: MainStyle) => void; label: string; mode: Theme; surface: "main" | "mini" }) {
  return (
    <div className="grid grid-cols-3 gap-2.5" role="group" aria-label={label}>
      {STYLES.map((style) => (
        <button key={style} type="button" className="theme-choice" aria-pressed={value === style} onClick={() => onChange(style)}>
          <span className="theme-preview w-full" data-preview={style} data-preview-theme={mode === "system" ? undefined : mode} data-surface={surface} aria-hidden="true">
            <span className="theme-preview-rail"><i /><i /><i /><i /></span>
            <span className="theme-preview-content">
              <span className="theme-preview-title" />
              <span className="theme-preview-editor"><i /><i /><b /></span>
            </span>
          </span>
          <span className="flex items-center gap-1.5 text-[12px] font-medium text-ink">
            {tr(`appearance.${style}`)}
            {value === style && <Check className="ml-auto size-3.5 shrink-0 text-seal" />}
          </span>
          <span className="text-[10.5px] leading-relaxed text-ink-3">{tr(`appearance.${style}Hint`)}</span>
        </button>
      ))}
    </div>
  );
}

export function Appearance() {
  const settings = useApp((s) => s.settings);
  const update = useApp((s) => s.updateSettings);
  const isMac = /Mac/.test(navigator.platform);
  const options = (inherit: boolean) => [
    ...(inherit ? [{ value: "inherit", text: tr("appearance.inherit") }] : []),
    ...(["system", "light", "dark"] as const).map((value) => ({ value, text: tr(`appearance.${value}`) })),
  ];

  return (
    <div className="appearance-panel">
      <div className="space-y-3">
        <div className="appearance-mode">
          <h3 className="text-[13px] font-medium">{tr("appearance.main")}</h3>
          <Select aria-label={`${tr("appearance.main")} · ${tr("appearance.mode")}`} value={settings.theme} onChange={(e) => update({ theme: e.target.value as Theme })} className="max-w-48">
            {options(false).map((o) => <option key={o.value} value={o.value}>{o.text}</option>)}
          </Select>
        </div>
        <StyleChoices label={tr("appearance.main")} mode={settings.theme} surface="main" value={settings.mainStyle} onChange={(mainStyle) => update({ mainStyle })} />
        <MaterialControls scope={tr("appearance.main")} value={settings.mainAppearance}
          onChange={(patch, delayed) => { void update(Object.keys(patch).length ? { mainAppearance: patch } : {}, delayed); }}
          onReset={() => { void update({ mainAppearance: DEFAULT_SETTINGS.mainAppearance }); }} />
        {!isTauri && <p className="material-note">{tr("material.desktopHint")}</p>}
      </div>
      <div className="border-t border-line pt-5"><BackgroundControls /></div>
      <div className="space-y-3 border-t border-line pt-5">
        <div className="appearance-mode">
          <h3 className="text-[13px] font-medium">{tr("appearance.mini")}</h3>
          <Select aria-label={`${tr("appearance.mini")} · ${tr("appearance.mode")}`} value={settings.mini.theme} onChange={(e) => update({ mini: { theme: e.target.value as MiniTheme } })} className="max-w-48">
            {options(true).map((o) => <option key={o.value} value={o.value}>{o.text}</option>)}
          </Select>
        </div>
        <StyleChoices label={tr("appearance.mini")} mode={settings.mini.theme === "inherit" ? settings.theme : settings.mini.theme} surface="mini" value={settings.mini.style} onChange={(style) => update({ mini: { style } })} />
        <MaterialControls scope={tr("appearance.mini")} value={settings.mini}
          onChange={(patch, delayed) => { void update(Object.keys(patch).length ? { mini: patch } : {}, delayed); }}
          onReset={() => { void update({ mini: { opacity: DEFAULT_SETTINGS.mini.opacity, blur: DEFAULT_SETTINGS.mini.blur } }); }} />
      </div>
      {isMac && (
        <div className="flex items-center justify-between gap-5 border-t border-line pt-5">
          <div>
            <div className="text-[13px]">{tr("appearance.dock")}</div>
            <p className="mt-1 text-[12px] leading-relaxed text-ink-3">{tr("appearance.dockHint")}</p>
          </div>
          <Toggle label={tr("appearance.dock")} checked={settings.showDockIcon} onChange={(showDockIcon) => update({ showDockIcon })} />
        </div>
      )}
    </div>
  );
}
