import { t as tr, useI18n } from "../lib/i18n";
import { useEffect, useMemo, useRef } from "react";
import { ArrowLeftRight, RotateCcw } from "lucide-react";
import { api, isTauri, onEvent } from "../lib/api";
import { lang } from "../lib/languages";
import { splitDraft } from "../lib/segment";
import { useTheme, miniTheme } from "../lib/theme";
import type { Settings, TargetInfo } from "../lib/types";
import { cx } from "../components/ui";
import { duration, summary } from "./logic";
import { Header } from "./Header";
import { WindowBackdrop } from "../components/WindowBackdrop";
import { materialStyle } from "../lib/appearance";
import { useBackgroundAsset } from "../lib/background";
import { MiniPractice } from "./MiniPractice";
import { AutoTextarea, NoticeBar, PrimaryButton, ResultCard, TargetLabel } from "./ResultCard";
import { primaryAction, useMini } from "./store";

function Compose() {
  const { draft, setDraft, from, to, swap, stage, error, translate, focusNonce, settings } = useMini();
  const area = useRef<HTMLTextAreaElement>(null);
  const parts = useMemo(() => splitDraft(draft, from, settings.segmentMode), [draft, from, settings.segmentMode]);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [focusNonce]);

  return (
    <>
      <div className="mini-source">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[10px] font-medium glass-muted">{tr("ui.draft")}</span>
          <button type="button" className="mini-language" onClick={swap} title={tr("Switch languages")} aria-label={tr("Switch languages")}>
            {lang(from).label}<ArrowLeftRight className="size-3 shrink-0" />{lang(to).label}
          </button>
        </div>
        <AutoTextarea
          ref={area}
          value={draft}
          onChange={setDraft}
          minHeight={64}
          disabled={stage === "translating"}
          aria-label={tr("ui.draft")}
          placeholder={tr("ui.miniPlaceholder", { language: lang(from).label })}
          className="mini-textarea"
        />
      </div>
      {error && (
        <div role="alert" className="glass-card flex items-center gap-2 px-3 py-2 text-[12px] text-danger">
          <span className="min-w-0 flex-1">{error}</span>
          <button className="glass-ghost" onClick={translate}>
            {tr("Retry")}</button>
        </div>
      )}
      {stage === "result" ? (
        <ResultCard />
      ) : (
        <div className="mini-footer">
          <div className="min-w-0 flex-1 space-y-1">
            <TargetLabel className="block" />
            <span className="block text-[10px] glass-muted">
              {parts.length ? tr("{p0} sentences · {p1} characters", { p0: parts.length, p1: draft.replace(/\s/g, "").length }) : tr("No text yet")}
            </span>
          </div>
          <PrimaryButton />
        </div>
      )}
    </>
  );
}

function Done() {
  const { segments, elapsed, restart } = useMini();
  const sum = summary(segments);
  const pct = Math.round(sum.score * 100);
  return (
    <>
      <div className="flex items-center gap-3">
        <span className="mini-score">{pct}</span>
        <div className="min-w-0 text-[12px] leading-relaxed glass-muted">
          <b className="font-semibold text-ink">{tr("mini.completed", { count: segments.length, accuracy: pct })}</b>
          <br />
          {tr("mini.summary", { hints: sum.hints, duration: duration(elapsed) })}
        </div>
        <button className="glass-ghost ml-auto" onClick={restart}>
          <RotateCcw className="size-3.5" />
          {tr("Practice again")}</button>
      </div>
      <ResultCard />
    </>
  );
}

export function MiniApp() {
  const { locale } = useI18n();
  useEffect(() => { document.title = tr("windows.mini"); }, [locale]);
  const ready = useMini((s) => s.ready);
  const stage = useMini((s) => s.stage);
  const settings = useMini((s) => s.settings);
  const head = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const backgroundError = useBackgroundAsset((s) => s.error);
  useTheme(miniTheme(settings), settings.mini.style, ready, "mini", settings.mini);
  useEffect(() => {
    if (settings.mini.useBackground && backgroundError) useMini.getState().notify({ tone: "error", text: backgroundError });
  }, [backgroundError, settings.mini.useBackground]);

  useEffect(() => {
    useMini.getState().init();
    const offs = [
      onEvent<Settings>("settings-changed", (s) => useMini.getState().applySettings(s)),
      onEvent<{ target: TargetInfo | null }>("mini-shown", (p) => useMini.getState().shown(p.target)),
      onEvent<TargetInfo | null>("mini-target", (t) => useMini.getState().setTarget(t)),
      onEvent<boolean>("ax-status", (t) => useMini.getState().setTrusted(t)),
    ];
    // Unpinned, the window gets out of the way as soon as the user clicks elsewhere.
    let offFocus: (() => void) | undefined;
    let alive = true;
    if (isTauri) {
      import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
        getCurrentWindow()
          .onFocusChanged(({ payload: focused }) => {
            const s = useMini.getState();
            if (!focused && !s.settings.mini.pinned && !s.inserting) api.miniHide().catch(() => {});
          })
          .then((f) => (alive ? (offFocus = f) : f())),
      );
    }
    return () => {
      alive = false;
      offs.forEach((p) => p.then((f) => f()));
      offFocus?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      const s = useMini.getState();
      if (e.key === "Escape") {
        e.preventDefault();
        if (s.popover) s.setPopover(false);
        else api.miniHide().catch(() => {});
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && s.stage !== "practice") {
        e.preventDefault();
        const p = primaryAction(s);
        if (!p.disabled) p.run();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The window takes the height of its content (the backend keeps the edge next to the input fixed).
  useEffect(() => {
    let last = 0;
    const fit = () => {
      const h = Math.ceil((head.current?.offsetHeight ?? 0) + (body.current?.offsetHeight ?? 0) + 2);
      if (Math.abs(h - last) >= 1) {
        last = h;
        api.miniFit(h).catch(() => {});
      }
    };
    const ro = new ResizeObserver(fit);
    if (head.current) ro.observe(head.current);
    if (body.current) ro.observe(body.current);
    return () => ro.disconnect();
  }, [ready]);

  if (!ready) return null;

  return (
    <div className="glass mini-window flex max-h-screen flex-col overflow-hidden" style={materialStyle(settings.mini)}>
      <WindowBackdrop background={settings.background} enabled={settings.mini.useBackground} />
      <div ref={head}>
        <Header />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div ref={body} className={cx("space-y-2.5 px-3 pt-2.5 pb-3", stage === "translating" && "cursor-progress")}>
          {stage === "practice" ? <MiniPractice /> : stage === "done" ? <Done /> : <Compose />}
          <NoticeBar />
        </div>
      </div>
    </div>
  );
}
