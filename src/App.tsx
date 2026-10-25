import { useI18n } from "./lib/i18n";
import { useEffect } from "react";
import { Sidebar } from "./components/Sidebar";
import { Toasts } from "./components/Toasts";
import { WindowBackdrop } from "./components/WindowBackdrop";
import { materialStyle } from "./lib/appearance";
import { useBackgroundAsset } from "./lib/background";
import { useTheme } from "./lib/theme";
import { useApp } from "./store";
import type { Page } from "./store";
import { WritePage } from "./pages/Write";
import { ReadPage } from "./pages/Read";
import { NotebookPage } from "./pages/Notebook";
import { ReviewPage } from "./pages/Review";
import { StatsPage } from "./pages/Stats";
import { SettingsPage } from "./pages/Settings";

const ORDER: Page[] = ["write", "read", "notebook", "review", "stats", "settings"];

export default function App() {
  useI18n();
  const ready = useApp((s) => s.ready);
  const page = useApp((s) => s.page);
  const init = useApp((s) => s.init);
  const go = useApp((s) => s.go);
  const settings = useApp((s) => s.settings);
  const backgroundError = useBackgroundAsset((s) => s.error);
  useTheme(settings.theme, settings.mainStyle, ready, "main", settings.mainAppearance);
  useEffect(() => { if (backgroundError) useApp.getState().toast(backgroundError, "error"); }, [backgroundError]);

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= ORDER.length) {
        e.preventDefault();
        go(ORDER[n - 1]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  if (!ready) return <div className="h-full bg-paper" />;

  return (
    <div className="app-shell flex h-full" style={materialStyle(settings.mainAppearance)}>
      <WindowBackdrop background={settings.background} />
      <Sidebar />
      <main className="app-content relative flex min-w-0 flex-1 flex-col">
        <div data-tauri-drag-region className="absolute inset-x-0 top-0 z-10 h-8" />
        <div key={page} className="min-h-0 flex-1 animate-rise overflow-y-auto">
          {page === "write" && <WritePage />}
          {page === "read" && <ReadPage />}
          {page === "notebook" && <NotebookPage />}
          {page === "review" && <ReviewPage />}
          {page === "stats" && <StatsPage />}
          {page === "settings" && <SettingsPage />}
        </div>
      </main>
      <Toasts />
    </div>
  );
}
