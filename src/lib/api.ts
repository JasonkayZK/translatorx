import { t, hasTranslation } from "./i18n";
import type {
  ActivityContext, ActivityKind, ActivityMetric, LearningActivity, AiReview, Breakdown, ChatMessage, InsertOutcome, Lookup, NewSentence, NewSession, NewWord, Segment, Sentence, Session, Settings, Stats,
  TargetInfo, Word, SettingsPatch,
} from "./types";
import { mockInvoke, mockOnEvent } from "./mock";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) return mockInvoke<T>(cmd, args ?? {});
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && "message" in e) {
      const error = e as { code: string; message: string };
      const code = hasTranslation("errors." + error.code) ? error.code : "message";
      throw new Error(t(`errors.${code}`, { detail: error.message }));
    }
    throw new Error(typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e));
  }
}

export const api = {
  systemLocale: () => isTauri ? call<string>("system_locale") : Promise.resolve(navigator.language),
  getSettings: () => call<Settings>("get_settings"),
  saveSettings: (settings: Settings) => call<Settings>("save_settings", { settings }),
  patchSettings: (patch: SettingsPatch) => call<Settings>("patch_settings", { patch }),
  getBackgroundImage: () => call<string | null>("get_background_image"),
  saveBackgroundImage: (dataUrl: string) => call<void>("save_background_image", { dataUrl }),
  clearBackgroundImage: () => call<void>("clear_background_image"),
  testConnection: (settings: Settings, target: "provider" | "llm") => call<string>("test_connection", { settings, target }),
  takeWarnings: () => call<string[]>("take_warnings"),
  pauseShortcut: (paused: boolean) => call<void>("pause_shortcut", { paused }),

  prepareSession: (text: string, segments: string[], from: string, to: string, activity?: ActivityContext) =>
    call<Segment[]>("prepare_session", { text, segments, from, to, activity }),
  translateTexts: (texts: string[], from: string, to: string, activity?: ActivityContext) => call<string[]>("translate_texts", { texts, from, to, activity }),
  /** `lang` is the word's language, `native` the language to explain it in. */
  lookupWord: (text: string, context: string, lang: string, native: string, activity?: ActivityContext) => call<Lookup>("lookup_word", { text, context, lang, native, activity }),
  aiReview: (source: string, reference: string, answer: string, from: string, to: string) =>
    call<AiReview>("ai_review", { source, reference, answer, from, to }),
  explainSentence: (sentence: string, lang: string, native: string) => call<Breakdown>("explain_sentence", { sentence, lang, native }),
  askTutor: (sentence: string, history: ChatMessage[], lang: string, native: string) =>
    call<string>("ask_tutor", { sentence, history, lang, native }),
  speak: (text: string, lang: string) => call<string>("speak", { text, lang }),

  addWord: (word: NewWord) => call<Word>("add_word", { word }),
  listWords: (query = "") => call<Word[]>("list_words", { query }),
  updateWord: (id: number, meaning: string, note: string) => call<void>("update_word", { id, meaning, note }),
  addSentence: (sentence: NewSentence) => call<Sentence>("add_sentence", { sentence }),
  listSentences: (query = "") => call<Sentence[]>("list_sentences", { query }),
  updateSentenceNote: (id: number, note: string) => call<void>("update_sentence_note", { id, note }),
  deleteItem: (kind: "word" | "sentence", id: number) => call<void>("delete_item", { kind, id }),
  dueItems: (limit = 50) => call<{ words: Word[]; sentences: Sentence[] }>("due_items", { limit }),
  reviewItem: (kind: "word" | "sentence", id: number, grade: number, eventId?: string) => call<number>("review_item", { kind, id, grade, eventId }),

  addSession: (session: NewSession, eventId?: string, origin: "main" | "mini" = "main", completedAt?: number) => call<number>("add_session", { session, eventId, origin, completedAt }),
  listSessions: (limit = 30) => call<Session[]>("list_sessions", { limit }),
  deleteSession: (id: number) => call<void>("delete_session", { id }),
  getStats: () => call<Stats>("get_stats", { offsetMinutes: -new Date().getTimezoneOffset() }),

  listActivities: (options: { limit?: number; offset?: number; kind?: ActivityKind; since?: number } = {}) => call<LearningActivity[]>("list_activities", options),
  activityMetrics: (since?: number) => call<ActivityMetric[]>("activity_metrics", { since }),
  deleteActivity: (id: number) => call<void>("delete_activity", { id }),

  // quick-translate window and input-box bubble
  miniInsert: (text: string, keepOpen: boolean) => call<InsertOutcome>("mini_insert", { text, keepOpen }),
  miniFit: (height: number) => call<void>("mini_fit", { height }),
  miniHide: () => call<void>("mini_hide"),
  miniDragged: () => call<void>("mini_dragged"),
  miniTarget: () => call<TargetInfo | null>("mini_target"),
  bubbleClick: () => call<void>("bubble_click"),
  bubbleMenu: () => call<void>("bubble_menu"),
  axStatus: () => call<boolean>("ax_status"),
  axRequest: () => call<void>("ax_request"),
  openInMain: (text: string, from: string, to: string) => call<void>("open_in_main", { text, from, to }),
};

/** Listens to a backend event; mirrored through storage events in the browser preview. Resolves to the unlisten function. */
export async function onEvent<T>(name: string, cb: (payload: T) => void): Promise<() => void> {
  if (!isTauri) return mockOnEvent(name, cb);
  const { listen } = await import("@tauri-apps/api/event");
  return listen<T>(name, (e) => cb(e.payload));
}

export async function copyText(text: string): Promise<void> {
  if (isTauri) {
    const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
    await writeText(text);
  } else {
    await navigator.clipboard.writeText(text);
  }
}

/** Saves a text file and returns where it went; `null` when the user cancelled the save dialog. */
export async function exportFile(name: string, content: string): Promise<string | null> {
  if (isTauri) return call<string | null>("export_file", { name, content });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return name;
}

export async function openUrl(url: string): Promise<void> {
  if (isTauri) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else {
    window.open(url, "_blank");
  }
}
