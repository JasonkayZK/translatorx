import { t as tr } from "../lib/i18n";
import { forwardRef, useEffect, useRef, useState } from "react";
import type { ButtonHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { ChevronDown, Loader2 } from "lucide-react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type Variant = "ink" | "seal" | "ghost" | "outline" | "soft";
interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button(
  { variant = "outline", size = "md", loading, icon, className, children, disabled, ...rest }, ref,
) {
  const sizes = { sm: "h-8 px-3 text-[12px]", md: "h-9 px-3.5 text-[13px]", lg: "h-11 px-5 text-[13px]" };
  return (
    <button type="button" ref={ref} disabled={disabled || loading} aria-busy={loading || undefined}
      className={cx("btn", `btn-${variant}`, sizes[size], className)} {...rest}>
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export function IconButton({ className, label, children, active, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} aria-pressed={active}
      className={cx("inline-flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors disabled:opacity-40", active ? "bg-seal-soft text-seal" : "text-ink-3 hover:bg-ink/5 hover:text-ink", className)} {...rest}>
      {children}
    </button>
  );
}

/** Destructive actions require a second click within 3s. */
export function ConfirmIconButton({ label, onConfirm, children, className }: { label: string; onConfirm: () => void; children: ReactNode; className?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(timer);
  }, [armed]);
  return (
    <button type="button" aria-label={armed ? tr("Confirm {p0}", { p0: label }) : label} title={armed ? tr("Click again to confirm") : label}
      onClick={(e) => { e.stopPropagation(); if (!armed) return setArmed(true); setArmed(false); onConfirm(); }} onBlur={() => setArmed(false)}
      className={cx("inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-lg transition-colors focus-visible:opacity-100", armed ? "bg-danger-soft px-2 text-danger !opacity-100" : "text-ink-3 hover:bg-danger-soft hover:text-danger", className)}>
      {children}
      {armed && <span className="text-[11.5px] font-medium whitespace-nowrap">{tr("Confirm deletion")}</span>}
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) { return <kbd className="kbd">{children}</kbd>; }
export const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

export function Segmented<T extends string>({ value, onChange, options, size = "md", label }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; hint?: string }[]; size?: "sm" | "md"; label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} className="segmented" role="tablist" aria-label={label}>
      {options.map((option, index) => (
        <button type="button" key={option.value} role="tab" title={option.hint} aria-selected={value === option.value} tabIndex={value === option.value ? 0 : -1}
          onClick={() => onChange(option.value)}
          onKeyDown={(e) => {
            let next = index;
            if (e.key === "ArrowRight") next = (index + 1) % options.length;
            else if (e.key === "ArrowLeft") next = (index - 1 + options.length) % options.length;
            else if (e.key === "Home") next = 0;
            else if (e.key === "End") next = options.length - 1;
            else return;
            e.preventDefault();
            onChange(options[next].value);
            ref.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
          }}
          className={cx("segment", size === "sm" ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-[12px]")}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
      className={cx("relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors", checked ? "bg-seal" : "bg-line-2")}>
      <span className={cx("absolute top-[3px] size-4 rounded-full bg-white shadow-sm transition-transform", checked ? "left-[3px] translate-x-4" : "left-[3px]")} />
    </button>
  );
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="relative inline-flex min-w-0 max-w-full items-center">
      <select className={cx("field h-9 cursor-pointer appearance-none pr-8", className)} {...rest}>{children}</select>
      <ChevronDown className="pointer-events-none absolute right-2.5 size-3.5 text-ink-3" aria-hidden />
    </span>
  );
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-2xl border border-line bg-paper-2/50 text-ink-3">{icon}</div>
      <div className="text-[15px] font-medium text-ink">{title}</div>
      {children && <div className="mt-2 max-w-sm text-[12px] leading-relaxed text-ink-3">{children}</div>}
    </div>
  );
}

export function PageHeader({ eyebrow, title, children }: { eyebrow: string; title: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-header">
      <div className="min-w-0">
        <h1 className="page-title">{title}</h1>
        <p className="page-description">{eyebrow}</p>
      </div>
      {children && <div className="flex max-w-full flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}
