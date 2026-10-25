import { t as tr } from "../lib/i18n";
import { useEffect, useRef } from "react";
import { Droplet, ExternalLink, Pin, X } from "lucide-react";
import { api } from "../lib/api";
import type { MiniPrefs } from "../lib/types";
import { Segmented } from "../components/ui";
import { MaterialControls } from "../components/appearance/MaterialControls";
import { useMini } from "./store";

const MODES: { value: MiniPrefs["mode"]; label: string; hint: string }[] = [
  { value: "direct", get label() { return tr("ui.miniDirect"); }, get hint() { return tr("Translate and insert into the input field"); } },
  { value: "practice", get label() { return tr("ui.miniPractice"); }, get hint() { return tr("Write it from memory, then insert it"); } },
];

function OpacityPopover() {
  const { settings, savePrefs, setPopover } = useMini();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !(e.target as Element).closest?.("[data-opacity-toggle]")) setPopover(false);
    };
    window.addEventListener("mousedown", onDown, true);
    return () => window.removeEventListener("mousedown", onDown, true);
  }, [setPopover]);

  return (
    <div ref={ref} id="mini-appearance" className="mini-appearance">
      <MaterialControls value={settings.mini} compact onChange={(patch, delayed) => savePrefs(patch, !delayed)} />
    </div>
  );
}

export function Header() {
  const { settings, setMode, savePrefs, popover, setPopover, draft, from, to } = useMini();
  const { mode, pinned } = settings.mini;
  const pinLabel = pinned ? tr("Unpin") : tr("Pin: stay on top and keep open after inserting");
  return (
    <header className="mini-header" data-tauri-drag-region
      onMouseDown={(e) => (e.target as HTMLElement).hasAttribute("data-tauri-drag-region") && api.miniDragged().catch(() => {})}>
      <div className="mini-titlebar" data-tauri-drag-region>
        <span data-tauri-drag-region className="glass-logo">译</span>
        <span data-tauri-drag-region className="text-[12px] font-semibold tracking-tight">TranslatorX</span>
        <div data-tauri-drag-region className="h-7 min-w-3 flex-1" />
        <button type="button" className="glass-icon" data-on={pinned} aria-pressed={pinned} aria-label={pinLabel} title={pinLabel} onClick={() => savePrefs({ pinned: !pinned }, true)}><Pin className="size-3.5" /></button>
        <button type="button" className="glass-icon" data-on={popover} data-opacity-toggle aria-expanded={popover} aria-controls="mini-appearance" aria-label={tr("Transparency")} title={tr("Transparency")} onClick={() => setPopover(!popover)}><Droplet className="size-3.5" /></button>
        <button type="button" className="glass-icon" aria-label={tr("Continue in the main window (full practice)")} title={tr("Continue in the main window (full practice)")} onClick={() => api.openInMain(draft, from, to).catch(() => {})}><ExternalLink className="size-3.5" /></button>
        <button type="button" className="glass-icon mini-close" aria-label={tr("Close (Esc)")} title={tr("Close (Esc)")} onClick={() => api.miniHide().catch(() => {})}><X className="size-3.5" /></button>
      </div>
      <div className="mini-modebar" data-tauri-drag-region>
        <Segmented label={tr("Quick translation window")} value={mode} onChange={setMode} options={MODES} size="sm" />
        <span data-tauri-drag-region className="min-w-0 text-right text-[10px] glass-muted">{mode === "direct" ? tr("Insert directly") : tr("Practice first")}</span>
      </div>
      {popover && <OpacityPopover />}
    </header>
  );
}
