import { AlertCircle, Check, Info } from "lucide-react";
import { useApp } from "../store";
import { cx } from "./ui";

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismiss);
  return (
    <div aria-live="polite" className="pointer-events-none fixed right-5 bottom-5 z-50 flex flex-col items-end gap-2">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={cx(
            "pointer-events-auto flex max-w-sm animate-rise items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-left text-[13px] shadow-paper backdrop-blur",
            t.tone === "error" ? "border-danger/30 bg-card text-ink" : "border-line bg-card/95 text-ink",
          )}
        >
          {t.tone === "error" ? <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" /> : t.tone === "success" ? <Check className="mt-0.5 size-4 shrink-0 text-moss" /> : <Info className="mt-0.5 size-4 shrink-0 text-ink-3" />}
          <span className="leading-snug">{t.text}</span>
        </button>
      ))}
    </div>
  );
}
