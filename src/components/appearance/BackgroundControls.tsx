import { useEffect, useRef, useState } from "react";
import { ImagePlus, RotateCcw } from "lucide-react";
import { api } from "../../lib/api";
import { refreshBackground, useBackgroundAsset } from "../../lib/background";
import { normalizeBackgroundImage } from "../../lib/background-image";
import { t as tr } from "../../lib/i18n";
import type { BackgroundPrefs } from "../../lib/types";
import { useApp } from "../../store";
import { Button, Select, Toggle } from "../ui";
import { PreferenceRange } from "./MaterialControls";

export function BackgroundControls() {
  const settings = useApp((s) => s.settings);
  const update = useApp((s) => s.updateSettings);
  const { dataUrl, error: loadError } = useBackgroundAsset();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const working = useRef(false);
  const background = settings.background;
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; void useApp.getState().updateSettings({}); };
  }, []);
  const change = (patch: Partial<BackgroundPrefs>, delayed = false) => { void update({ background: patch }, delayed); };
  const commit = () => { void update({}); };

  const choose = async (file: File | undefined) => {
    if (!file || working.current) return;
    working.current = true;
    setBusy(true); setError("");
    try {
      const normalized = await normalizeBackgroundImage(file);
      if (!alive.current) return;
      await api.saveBackgroundImage(normalized);
      await refreshBackground();
    } catch (error) {
      if (alive.current) setError(error instanceof Error ? error.message : String(error));
    } finally {
      working.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const remove = async () => {
    if (working.current) return;
    working.current = true;
    setBusy(true); setError("");
    try { await api.clearBackgroundImage(); await refreshBackground(); }
    catch (error) { if (alive.current) setError(error instanceof Error ? error.message : String(error)); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  };

  return (
    <div className="background-controls">
      <div>
        <h3 className="text-[14px] font-semibold">{tr("background.title")}</h3>
        <p className="material-note mt-1.5">{tr("background.description")}</p>
      </div>
      <div className="background-preview">
        {dataUrl ? <img src={dataUrl} alt={tr("background.title")} style={{ opacity: background.opacity, filter: `blur(${background.blur}px)`, objectFit: background.fit }} /> : (
          <div className="space-y-2 px-4 py-7 text-center text-ink-3">
            <ImagePlus className="mx-auto size-6" strokeWidth={1.4} />
            <p className="text-[12px]">{tr("background.empty")}</p>
            <p className="text-[10px]">{tr("background.formats")}</p>
          </div>
        )}
      </div>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden aria-label={tr("background.choose")}
        onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void choose(file); }} />
      <div className="background-actions">
        <Button variant="outline" size="sm" loading={busy} onClick={() => input.current?.click()} icon={<ImagePlus className="size-3.5" />}>
          {busy ? tr("background.processing") : dataUrl ? tr("background.replace") : tr("background.choose")}
        </Button>
        {(dataUrl || loadError) && <Button variant="ghost" size="sm" disabled={busy} onClick={remove} icon={<RotateCcw className="size-3" />}>{tr("background.remove")}</Button>}
      </div>
      {(error || loadError) && <div role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[12px] text-danger">
        {error || loadError}
        {loadError && <button type="button" className="ml-2 underline" onClick={() => { void refreshBackground(); }}>{tr("background.retry")}</button>}
      </div>}
      <PreferenceRange label={tr("background.strength")} value={Math.round(background.opacity * 100)} disabled={!dataUrl}
        onChange={(opacity) => change({ opacity: opacity / 100 }, true)} onCommit={commit} />
      <div>
        <PreferenceRange label={tr("background.blur")} value={background.blur} max={32} unit="px" disabled={!dataUrl}
          onChange={(blur) => change({ blur }, true)} onCommit={commit} />
        <p className="material-note mt-2">{tr("background.blurHint")}</p>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-[12px] text-ink-2">{tr("background.fit")}</span>
        <Select aria-label={tr("background.fit")} value={background.fit} disabled={!dataUrl} onChange={(e) => change({ fit: e.target.value as BackgroundPrefs["fit"] })}>
          <option value="cover">{tr("background.cover")}</option><option value="contain">{tr("background.contain")}</option>
        </Select>
      </div>
      <div className="flex items-start justify-between gap-5 border-t border-line pt-4">
        <div><div className="text-[12px]">{tr("background.useInMini")}</div><p className="material-note mt-1">{tr("background.useInMiniHint")}</p></div>
        <Toggle label={tr("background.useInMini")} checked={settings.mini.useBackground} onChange={(useBackground) => { void update({ mini: { useBackground } }); }} />
      </div>
    </div>
  );
}
