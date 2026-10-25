import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ExternalLink, RefreshCw } from "lucide-react";
import { api, onEvent } from "../lib/api";
import { accessibilityDiagnostics } from "../lib/accessibility";
import type { AccessibilityDiagnostics } from "../lib/accessibility";
import { t as tr } from "../lib/i18n";
import { Button } from "./ui";

export function AccessibilitySettings() {
  const [trusted, setTrusted] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState(false);
  const [details, setDetails] = useState<AccessibilityDiagnostics | null>(null);
  const alive = useRef(false);
  const sequence = useRef(0);
  const check = useCallback(async () => {
    const id = ++sequence.current;
    setBusy(true);
    setFailed(false);
    try {
      const current = await api.axStatus();
      if (alive.current && id === sequence.current) setTrusted(current);
    } catch {
      if (alive.current && id === sequence.current) { setTrusted(null); setFailed(true); }
    } finally {
      if (alive.current && id === sequence.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void check();
    const off = onEvent<boolean>("ax-status", (status) => {
      if (alive.current) { ++sequence.current; setTrusted(status); setFailed(false); setBusy(false); }
    });
    const focus = () => { if (document.visibilityState !== "hidden") void check(); };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      alive.current = false;
      ++sequence.current;
      off.then((stop) => stop());
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [check]);

  const inspect = async () => {
    try {
      const info = await accessibilityDiagnostics();
      if (alive.current) setDetails(info);
    } catch { if (alive.current) setFailed(true); }
  };

  return (
    <div className="rounded-xl border border-line bg-paper/45 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[13px] font-medium">{tr("Accessibility permission")}</h3>
        <span role="status" className={`inline-flex items-center gap-1 text-[12px] ${trusted ? "text-moss" : "text-ink-3"}`}>
          {trusted && <Check className="size-3.5" />}
          {failed ? tr("accessibility.checkFailed") : busy ? tr("Checking…") : trusted ? tr("Granted") : tr("Not granted")}
        </span>
      </div>
      {trusted === false && <p className="mt-2 text-[12px] leading-relaxed text-ink-2">{tr("accessibility.reinstall")}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" loading={busy} icon={<RefreshCw className="size-3.5" />} onClick={check}>{tr("accessibility.recheck")}</Button>
        <Button size="sm" variant="outline" icon={<ExternalLink className="size-3.5" />} onClick={() => api.axRequest().catch(() => setFailed(true))}>{tr("accessibility.settings")}</Button>
      </div>
      <details className="mt-3 text-[11px] text-ink-3" onToggle={(e) => { if (e.currentTarget.open && !details) void inspect(); }}>
        <summary className="cursor-pointer">{tr("accessibility.diagnostics")}</summary>
        {details && (
          <div className="mt-2 space-y-2">
            <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[auto_1fr]">
              <dt>{tr("accessibility.path")}</dt><dd className="selectable break-all font-mono">{details.executable}</dd>
              <dt>{tr("accessibility.bundle")}</dt><dd className="selectable break-all font-mono">{details.bundleId}</dd>
              <dt>{tr("accessibility.signature")}</dt><dd>{tr(`accessibility.${details.signature === "unsupported" ? "unknown" : details.signature}`)}</dd>
            </dl>
            {(details.signature === "adhoc" || details.signature === "unsigned") && <p className="leading-relaxed text-amber">{tr("accessibility.temporaryHint")}</p>}
          </div>
        )}
      </details>
    </div>
  );
}
