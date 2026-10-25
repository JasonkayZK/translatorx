import { t as tr, setLocale } from "../lib/i18n";
import { create } from "zustand";
import { createSettingsWriter } from "../lib/settings-writer";
import { activityContext } from "../lib/learning";
import type { ActivityContext, NewSession } from "../lib/types";
import { api, onEvent } from "../lib/api";
import type { CheckResult } from "../lib/check";
import { splitDraft } from "../lib/segment";
import { DEFAULT_SETTINGS, normalizeSettings } from "../lib/types";
import type { MiniPrefs, PracticeMode, Settings, TargetInfo } from "../lib/types";
import type { ModeResult } from "../pages/Write/modes";
import { MOD } from "../components/ui";
import { IS_MAC, IS_WINDOWS } from "../lib/accel";
import { finishSegment, nextPending, resultText, sessionPayload, toSegments } from "./logic";
import type { MiniSegment } from "./logic";

export type MiniStage = "input" | "translating" | "result" | "practice" | "done";

export interface Notice {
  tone: "info" | "error" | "success";
  text: string;
  /** Offer to open the Accessibility settings. */
  grant?: boolean;
}

interface MiniState {
  ready: boolean;
  settings: Settings;
  trusted: boolean;
  target: TargetInfo | null;
  stage: MiniStage;
  draft: string;
  from: string;
  to: string;
  /** Languages changed in settings mid-task; applied when the window is cleared. */
  pairStale: boolean;
  segments: MiniSegment[];
  current: number;
  practiceMode: PracticeMode;
  /** The translation to insert; editable. */
  result: string;
  /** The draft was edited after translating. */
  stale: boolean;
  error: string | null;
  notice: Notice | null;
  startedAt: number;
  practiceId: string;
  translationOperation: { key: string; activity: ActivityContext } | null;
  practiceRecord: { eventId: string; completedAt: number; payload: NewSession; status: "saving" | "saved" | "error"; error: string } | null;
  retryPractice: () => Promise<void>;
  /** How long the finished practice took. */
  elapsed: number;
  saved: boolean;
  inserting: boolean;
  popover: boolean;
  /** Bumped to put the caret back into the draft. */
  focusNonce: number;

  init: () => Promise<void>;
  applySettings: (s: Settings) => void;
  setTarget: (t: TargetInfo | null) => void;
  setTrusted: (t: boolean) => void;
  shown: (t: TargetInfo | null) => void;
  setDraft: (d: string) => void;
  swap: () => void;
  translate: () => Promise<void>;
  setMode: (m: MiniPrefs["mode"]) => void;
  setPracticeMode: (m: PracticeMode) => void;
  addTry: (r: CheckResult) => void;
  finish: (r: ModeResult) => void;
  next: () => void;
  restart: () => void;
  backToInput: () => void;
  setResult: (t: string) => void;
  insert: () => Promise<void>;
  saveSentence: () => Promise<void>;
  savePrefs: (patch: Partial<MiniPrefs>, immediate?: boolean) => void;
  setPopover: (open: boolean) => void;
  notify: (n: Notice | null) => void;
  reset: () => void;
}

let listening = false;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;

const PASTE = MOD === "⌘" ? "⌘V" : "Ctrl+V";

export const useMini = create<MiniState>((set, get) => ({
  ready: false,
  settings: DEFAULT_SETTINGS,
  trusted: false,
  target: null,
  stage: "input",
  draft: "",
  from: DEFAULT_SETTINGS.nativeLang,
  to: DEFAULT_SETTINGS.targetLang,
  pairStale: false,
  segments: [],
  current: 0,
  practiceMode: DEFAULT_SETTINGS.defaultMode,
  result: "",
  stale: false,
  error: null,
  notice: null,
  startedAt: 0,
  practiceId: "",
  translationOperation: null,
  practiceRecord: null,
  elapsed: 0,
  saved: false,
  inserting: false,
  popover: false,
  focusNonce: 0,

  init: async () => {
    try {
      const [saved, systemLanguage] = await Promise.all([api.getSettings(), api.systemLocale().catch(() => navigator.language)]);
      const s = normalizeSettings(saved);
      setLocale(s.uiLanguage, systemLanguage);
      set({ settings: s, from: s.nativeLang, to: s.targetLang, practiceMode: s.defaultMode });
      miniSettingsWriter.receive(s);
    } catch (e) {
      set({ notice: { tone: "error", text: tr("Could not load settings: {p0}", { p0: (e as Error).message }) } });
    }
    const [trusted, target] = await Promise.all([api.axStatus().catch(() => false), api.miniTarget().catch(() => null)]);
    set({ trusted, target, ready: true });
    if (!listening) {
      listening = true;
      void onEvent("learning-save-failed", () => get().notify({ tone: "error", text: tr("learning.recordFailed") }));
    }
  },

  applySettings: (incoming) => miniSettingsWriter.receive(incoming),

  setTarget: (target) => set({ target }),
  setTrusted: (trusted) => set({ trusted }),
  shown: (target) => {
    set((s) => ({ target, focusNonce: s.focusNonce + 1, popover: false }));
    api.axStatus().then((trusted) => set({ trusted })).catch(() => {});
  },

  setDraft: (draft) => set((s) => ({ draft, stale: s.stage === "result" ? true : s.stale, error: null })),
  swap: () => set((s) => ({ from: s.to, to: s.from, stale: s.stage === "result" ? true : s.stale })),

  translate: async () => {
    if (get().practiceRecord && get().practiceRecord?.status !== "saved") { get().notify({ tone: "error", text: tr("learning.saveBeforeNext") }); return; }
    const { draft, from, to, settings } = get();
    if (!draft.trim() || get().stage === "translating") return;
    if (from === to) {
      set({ error: tr("Native and target languages must be different") });
      return;
    }
    const key = JSON.stringify([draft, from, to, settings.segmentMode]);
    const operation = get().translationOperation?.key === key ? get().translationOperation! : { key, activity: activityContext("translate", "mini") };
    set({ stage: "translating", error: null, notice: null, translationOperation: operation });
    try {
      const parts = splitDraft(draft, from, settings.segmentMode).map((p) => p.source);
      const segs = toSegments(await api.prepareSession(draft, parts, from, to, operation.activity), draft);
      if (!segs.length) throw new Error(tr("No translation was returned"));
      const practice = get().settings.mini.mode === "practice";
      set({
        segments: segs,
        result: resultText(segs, to),
        stale: false,
        saved: false,
        current: 0,
        startedAt: Date.now(),
        practiceId: crypto.randomUUID(),
        translationOperation: null,
        stage: practice ? "practice" : "result",
      });
    } catch (e) {
      set({ stage: "input", error: tr("Translation failed: {p0}", { p0: (e as Error).message }) });
    }
  },

  setMode: (mode) => {
    if (mode === "practice" && get().practiceRecord && get().practiceRecord?.status !== "saved") { get().notify({ tone: "error", text: tr("learning.saveBeforeNext") }); return; }
    get().savePrefs({ mode }, true);
    const { stage, segments } = get();
    if (mode === "practice" && stage === "result" && segments.length) {
      set({ stage: "practice", segments: segments.map(freshSegment), current: 0, startedAt: Date.now(), practiceId: crypto.randomUUID() });
    } else if (mode === "direct" && (stage === "practice" || stage === "done")) {
      set({ stage: "result" });
    }
  },

  setPracticeMode: (practiceMode) => set({ practiceMode }),

  addTry: (r) => set((s) => ({ segments: s.segments.map((x, i) => (i === s.current ? { ...x, tries: [...x.tries, r] } : x)) })),

  finish: (r) => set((s) => ({ segments: s.segments.map((x, i) => (i === s.current ? finishSegment(x, r) : x)) })),

  next: () => {
    const s = get();
    if (s.stage !== "practice" || !s.segments.length) return;
    const idx = nextPending(s.segments, s.current);
    if (idx >= 0) {
      set({ current: idx });
      return;
    }
    const completedAt = Date.now();
    const elapsed = completedAt - s.startedAt;
    set({ stage: "done", elapsed, result: resultText(s.segments, s.to) });
    set({ practiceRecord: { eventId: s.practiceId, completedAt, payload: sessionPayload({ draft: s.draft, from: s.from, to: s.to, mode: s.practiceMode, segs: s.segments, durationMs: elapsed }), status: "error", error: "" } });
    void get().retryPractice();
  },

  retryPractice: async () => {
    const record = get().practiceRecord;
    if (!record || record.status === "saving" || record.status === "saved") return;
    set({ practiceRecord: { ...record, status: "saving", error: "" } });
    try {
      await api.addSession(record.payload, record.eventId, "mini", record.completedAt);
      if (get().practiceRecord?.eventId === record.eventId) set({ practiceRecord: { ...record, status: "saved", error: "" } });
    } catch (e) {
      if (get().practiceRecord?.eventId === record.eventId) set({ practiceRecord: { ...record, status: "error", error: (e as Error).message } });
    }
  },

  restart: () => {
    if (get().practiceRecord && get().practiceRecord?.status !== "saved") { get().notify({ tone: "error", text: tr("learning.saveBeforeNext") }); return; }
    set((s) => ({ stage: "practice", segments: s.segments.map(freshSegment), current: 0, startedAt: Date.now(), practiceId: crypto.randomUUID() }));
  },

  backToInput: () => set((s) => ({ stage: "input", segments: [], result: "", stale: false, focusNonce: s.focusNonce + 1 })),

  setResult: (result) => set({ result }),

  insert: async () => {
    const s = get();
    const text = s.result.trim();
    if (!text || s.inserting) return;
    set({ inserting: true, notice: null });
    const pinned = s.settings.mini.pinned;
    try {
      const out = await api.miniInsert(text, pinned);
      if (out.kind === "pasted") {
        get().reset();
        if (pinned) get().notify({ tone: "success", text: tr("Inserted into {p0}", { p0: out.app || tr("the original app") }) });
        return;
      }
      const reason: Record<string, Notice> = {
        permission: { tone: "info", text: tr("Copied. Switch back and press {p0} to paste. Enable Accessibility to insert automatically.", { p0: PASTE }), grant: true },
        "no-target": { tone: "info", text: s.target ? tr("Could not find the target app. Copied to clipboard.") : tr("Copied to clipboard") },
        activate: { tone: "info", text: tr("Could not switch to {p0}. Copied; please paste manually.", { p0: out.app || tr("the original app") }) },
        unsupported: { tone: "info", text: tr("Copied. Press {p0} to paste.", { p0: PASTE }) },
      };
      get().notify(reason[out.reason ?? ""] ?? { tone: "info", text: tr("Copied to clipboard") });
    } catch (e) {
      get().notify({ tone: "error", text: (e as Error).message });
    } finally {
      set({ inserting: false });
    }
  },

  saveSentence: async () => {
    const { draft, result, from, to } = get();
    if (!draft.trim() || !result.trim()) return;
    try {
      await api.addSentence({ source: draft.trim(), target: result.trim(), sourceLang: from, targetLang: to, origin: "quick" });
      set({ saved: true });
      get().notify({ tone: "success", text: tr("Saved to sentences") });
    } catch (e) {
      get().notify({ tone: "error", text: (e as Error).message });
    }
  },

  savePrefs: (patch, immediate = false) => {
    if (Object.keys(patch).length) void miniSettingsWriter.update({ mini: patch }, !immediate);
    else void miniSettingsWriter.flush();
  },

  setPopover: (popover) => set({ popover }),

  notify: (notice) => {
    clearTimeout(noticeTimer);
    set({ notice });
    if (notice?.tone === "success") noticeTimer = setTimeout(() => set({ notice: null }), 2200);
  },

  reset: () =>
    set((s) => ({
      stage: "input",
      draft: "",
      segments: [],
      current: 0,
      result: "",
      stale: false,
      error: null,
      saved: false,
      focusNonce: s.focusNonce + 1,
      ...(s.pairStale ? { from: s.settings.nativeLang, to: s.settings.targetLang, pairStale: false } : {}),
    })),
}));

const miniSettingsWriter = createSettingsWriter({
  read: () => useMini.getState().settings,
  apply: (next) => {
    const state = useMini.getState();
    setLocale(next.uiLanguage);
    const langs = next.nativeLang !== state.settings.nativeLang || next.targetLang !== state.settings.targetLang;
    const pair = !langs ? {} : state.stage === "input" ? { from: next.nativeLang, to: next.targetLang } : { pairStale: true };
    const mode = next.defaultMode !== state.settings.defaultMode && state.stage !== "practice" ? { practiceMode: next.defaultMode } : {};
    useMini.setState({ settings: next, ...pair, ...mode });
  },
  save: (patch) => api.patchSettings(patch),
  error: (error) => useMini.getState().notify({ tone: "error", text: error.message }),
});

function freshSegment(s: MiniSegment): MiniSegment {
  return { ...s, status: "pending", answer: "", correct: 0, total: 0, hints: 0, score: 0, tries: [] };
}

export type MiniStore = ReturnType<typeof useMini.getState>;

/** Auto-insert works on macOS and Windows; everywhere else the translation is copied. */
export const CAN_INSERT = IS_MAC || IS_WINDOWS;

/** What ⌘↵ and the main button do at each stage (practice has its own keys). */
export function primaryAction(s: MiniStore): { label: string; run: () => void; disabled: boolean; busy: boolean } {
  const insertLabel = CAN_INSERT && s.trusted && s.target ? tr("Insert") : tr("Copy");
  const insert = { label: insertLabel, run: s.insert, disabled: !s.result.trim(), busy: s.inserting };
  switch (s.stage) {
    case "input":
      return { label: s.settings.mini.mode === "practice" ? tr("Start practice") : tr("Translate"), run: s.translate, disabled: !s.draft.trim(), busy: false };
    case "translating":
      return { label: tr("Translating…"), run: () => {}, disabled: true, busy: true };
    case "result":
      return s.stale ? { label: tr("Translate again"), run: s.translate, disabled: !s.draft.trim(), busy: false } : insert;
    case "done":
      return insert;
    default:
      return { label: "", run: () => {}, disabled: true, busy: false };
  }
}
