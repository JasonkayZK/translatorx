import { t as tr, setLocale } from "./lib/i18n";
import { create } from "zustand";
import { createSettingsWriter } from "./lib/settings-writer";
import { joinSegments } from "./lib/languages";
import { api, copyText, onEvent } from "./lib/api";
import type { CheckResult } from "./lib/check";
import { DEFAULT_SETTINGS, normalizeSettings } from "./lib/types";
import type { AiReview, PracticeMode, Settings, SettingsPatch } from "./lib/types";

export type Page = "write" | "read" | "notebook" | "review" | "stats" | "settings";

export interface PracticeSegment {
  source: string;
  target: string;
  breakAfter: boolean;
  answer: string;
  status: "pending" | "done" | "revealed";
  correct: number;
  total: number;
  score: number;
  hints: number;
  attempts: number;
  /** Every checked recall attempt, for the red-pen markup. */
  tries: CheckResult[];
  /** AI review: the result, "loading", or an error message. */
  ai?: AiReview | "loading" | string;
  saved: boolean;
}

export interface ReadPair {
  text: string;
  translation: string;
  /** Index of the pasted paragraph this sentence belongs to. */
  para: number;
}

export type ReadView = "paragraph" | "sentence";

export type Stage = "compose" | "loading" | "practice" | "finish";

interface Toast {
  id: number;
  text: string;
  tone: "info" | "error" | "success";
}

interface State {
  ready: boolean;
  page: Page;
  settings: Settings;
  toasts: Toast[];
  // writing session
  stage: Stage;
  draft: string;
  from: string;
  to: string;
  segments: PracticeSegment[];
  current: number;
  mode: PracticeMode;
  startedAt: number;
  practiceId: string;
  completedAt: number;
  practiceSave: "idle" | "saving" | "saved" | "error";
  practiceError: string;
  savePractice: () => Promise<void>;
  composeNonce: number;
  /** Languages changed in settings mid-session; apply them when the next draft starts. */
  pairStale: boolean;
  // reading page
  readInput: string;
  readPairs: ReadPair[];
  readView: ReadView;

  init: () => Promise<void>;
  go: (p: Page) => void;
  updateSettings: (patch: SettingsPatch, delayed?: boolean) => Promise<void>;
  toast: (text: string, tone?: Toast["tone"]) => void;
  dismiss: (id: number) => void;

  setDraft: (d: string) => void;
  setPair: (from: string, to: string) => void;
  setStage: (s: Stage) => void;
  startPractice: (segs: PracticeSegment[]) => void;
  patchSegment: (i: number, patch: Partial<PracticeSegment>) => void;
  setCurrent: (i: number) => void;
  setMode: (m: PracticeMode) => void;
  newDraft: () => void;
  setRead: (patch: { readInput?: string; readPairs?: ReadPair[]; readView?: ReadView }) => void;
}

let toastSeq = 1;

export const useApp = create<State>((set, get) => ({
  ready: false,
  page: "write",
  settings: DEFAULT_SETTINGS,
  toasts: [],
  stage: "compose",
  draft: "",
  from: DEFAULT_SETTINGS.nativeLang,
  to: DEFAULT_SETTINGS.targetLang,
  segments: [],
  current: 0,
  mode: DEFAULT_SETTINGS.defaultMode,
  startedAt: 0,
  practiceId: "",
  completedAt: 0,
  practiceSave: "idle",
  practiceError: "",
  composeNonce: 0,
  pairStale: false,
  readInput: "",
  readPairs: [],
  readView: "paragraph",

  init: async () => {
    try {
      const [saved, systemLanguage] = await Promise.all([api.getSettings(), api.systemLocale().catch(() => navigator.language)]);
      const s = normalizeSettings(saved);
      setLocale(s.uiLanguage, systemLanguage);
      set({ settings: s, from: s.nativeLang, to: s.targetLang, mode: s.defaultMode, ready: true });
      appSettingsWriter.receive(s);
    } catch (e) {
      set({ ready: true });
      get().toast(tr("Could not load settings: {p0}", { p0: (e as Error).message }), "error");
    }
    api.takeWarnings().then((ws) => ws.forEach((w) => get().toast(w, "error"))).catch(() => {});
    listenBackend();
  },
  go: (page) => set({ page }),
  updateSettings: (patch, delayed = false) => appSettingsWriter.update(patch, delayed),
  toast: (text, tone = "info") => {
    const id = toastSeq++;
    set((s) => ({ toasts: [...s.toasts, { id, text, tone }] }));
    setTimeout(() => get().dismiss(id), tone === "error" ? 5200 : 2600);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  // Reading/Notebook prepare a new drill through these setters before startPractice.
  // Preserve the entire completed payload until its save succeeds.
  setDraft: (draft) => { if (!(get().stage === "finish" && get().practiceSave !== "saved")) set({ draft }); },
  setPair: (from, to) => { if (!(get().stage === "finish" && get().practiceSave !== "saved")) set({ from, to }); },
  setStage: (stage) =>
    set((s) => ({ stage, ...(stage === "finish" && !s.completedAt ? { completedAt: Date.now() } : {}), ...(stage === "compose" && s.pairStale ? { from: s.settings.nativeLang, to: s.settings.targetLang, pairStale: false } : {}) })),
  startPractice: (segments) => {
    if (get().stage === "finish" && get().practiceSave !== "saved") { get().toast(tr("learning.saveBeforeNext"), "error"); return; }
    set({ segments, current: 0, stage: "practice", startedAt: Date.now(), practiceId: crypto.randomUUID(), completedAt: 0, practiceSave: "idle", practiceError: "" });
  },
  savePractice: async () => {
    const s = get();
    if (!s.practiceId || !s.segments.length || s.segments.some((x) => x.status === "pending") || s.practiceSave === "saving" || s.practiceSave === "saved") return;
    const id = s.practiceId;
    set({ practiceSave: "saving", practiceError: "" });
    try {
      await api.addSession({
        sourceLang: s.from, targetLang: s.to, draft: s.draft,
        result: joinSegments(s.segments.map((x) => ({ text: x.target, breakAfter: x.breakAfter })), s.to),
        mode: s.mode, segments: s.segments.length,
        totalWords: s.segments.reduce((n, x) => n + x.total, 0),
        correctWords: s.segments.reduce((n, x) => n + x.correct, 0),
        hints: s.segments.reduce((n, x) => n + x.hints, 0),
        durationMs: (s.completedAt || Date.now()) - s.startedAt,
        detail: JSON.stringify(s.segments.map(({ source, target, breakAfter, answer, score, status }) => ({ source, target, breakAfter, answer, score, status }))),
      }, id, "main", s.completedAt || Date.now());
      if (get().practiceId === id) set({ practiceSave: "saved" });
    } catch (e) {
      if (get().practiceId === id) set({ practiceSave: "error", practiceError: (e as Error).message });
      get().toast(tr("Could not save practice: {p0}", { p0: (e as Error).message }), "error");
    }
  },
  patchSegment: (i, patch) => set((s) => ({ segments: s.segments.map((x, k) => (k === i ? { ...x, ...patch } : x)) })),
  setCurrent: (current) => set({ current }),
  setMode: (mode) => set({ mode }),
  newDraft: () => {
    if (get().stage === "finish" && get().practiceSave !== "saved") { get().toast(tr("learning.saveBeforeNext"), "error"); return; }
    set((s) => ({
      stage: "compose",
      draft: "",
      segments: [],
      current: 0,
      page: "write",
      composeNonce: s.composeNonce + 1,
      ...(s.pairStale ? { from: s.settings.nativeLang, to: s.settings.targetLang, pairStale: false } : {}),
    }));
  },
  setRead: (patch) => set(patch),
}));

const appSettingsWriter = createSettingsWriter({
  read: () => useApp.getState().settings,
  apply: (next) => {
    const state = useApp.getState();
    const langs = next.nativeLang !== state.settings.nativeLang || next.targetLang !== state.settings.targetLang;
    setLocale(next.uiLanguage);
    useApp.setState({ settings: next, ...(langs ? pairFor(next, state.stage) : {}) });
  },
  save: (patch) => api.patchSettings(patch),
  error: (error) => useApp.getState().toast(error.message, "error"),
});

/** New languages apply right away while composing; a running practice keeps its pair until it ends. */
function pairFor(s: Settings, stage: Stage): Partial<State> {
  return stage === "compose" ? { from: s.nativeLang, to: s.targetLang, pairStale: false } : { pairStale: true };
}

let listening = false;

/** Keeps this window in step with the others: settings saved anywhere, and drafts sent from the quick window. */
function listenBackend() {
  if (listening) return;
  listening = true;
  onEvent<Settings>("settings-changed", (incoming) => appSettingsWriter.receive(incoming));
  onEvent<{ text: string; from: string; to: string }>("load-draft", (d) => {
    const s = useApp.getState();
    if ((s.stage === "practice" && s.segments.some((x) => x.status !== "pending")) || (s.stage === "finish" && s.practiceSave !== "saved")) {
      // Never throw away a practice in progress; hand the draft over through the clipboard instead.
      s.go("write");
      copyText(d.text).catch(() => {});
      s.toast(tr("A practice is still in progress in the main window. The quick window draft was copied to the clipboard."), "info");
      return;
    }
    s.newDraft();
    useApp.setState({ draft: d.text, from: d.from, to: d.to });
  });
  onEvent("learning-save-failed", () => useApp.getState().toast(tr("learning.recordFailed"), "error"));
  onEvent("open-settings", () => useApp.getState().go("settings"));
}
