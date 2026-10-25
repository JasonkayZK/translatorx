import { summarizeActivities } from "./learning";
import { readBackground, writeBackground, deleteBackground } from "./background-storage";
import { t } from "./i18n";
// In-browser stand-in for the Rust backend so the UI can be developed and previewed with
// `pnpm dev` outside Tauri. Data lives in localStorage; translations come from a small phrasebook.
import { mergeSettings, normalizeSettings, DEFAULT_SETTINGS } from "./types";
import type { SettingsPatch } from "./types";
import type { ActivityContext, LearningActivity, NewSentence, NewSession, NewWord, Sentence, Session, Settings, Stats, Word } from "./types";

const PHRASEBOOK: Record<string, string> = {
  "你好 Alex，": "Hi Alex,",
  "感谢你的回复。": "Thanks for your reply.",
  "我们周五下午三点见，我会把方案带过去。": "See you at three on Friday afternoon, and I'll bring the proposal.",
  "今天的会议改到明天上午了，你方便吗？": "Today's meeting has been moved to tomorrow morning. Does that work for you?",
  "这篇文章写得很清楚，帮我解决了一个困扰很久的问题。":
    "This article is really clear and helped me solve a problem that had bugged me for ages.",
  "The model was trained on a curated dataset that spans nearly a decade of research.":
    "该模型是在一个精心筛选、跨越近十年研究成果的数据集上训练出来的。",
  "It outperforms every public benchmark released this year.": "它超越了今年发布的所有公开基准测试。",
};

const DAY = 86_400_000;
const KEY = "translatorx.mock.v1";

interface Store {
  settings: Settings;
  words: Word[];
  sentences: Sentence[];
  sessions: Session[];
  seq: number;
  activities: LearningActivity[];
  receipts: Record<string, { kind: string; result: number }>;
}

function srs(now: number) {
  return { createdAt: now, dueAt: now, intervalDays: 0, ease: 2.5, reps: 0, lapses: 0 };
}

function seed(): Store {
  const now = Date.now();
  const s: Store = { settings: normalizeSettings(DEFAULT_SETTINGS), words: [], sentences: [], sessions: [], activities: [], receipts: {}, seq: 1 };
  const words: [string, string, string][] = [
    ["curated", "精心挑选的", "The model was trained on a curated dataset."],
    ["proposal", "方案；提议", "I'll bring the proposal."],
    ["outperform", "胜过；优于", "It outperforms every public benchmark."],
    ["bug (sb.)", "困扰（某人）", "a problem that had bugged me for ages"],
    ["reschedule", "改期", "Can we reschedule the call?"],
  ];
  words.forEach(([text, meaning, context], i) =>
    s.words.push({ id: s.seq++, text, meaning, lang: "en", note: "", context, contextTranslation: "", ...srs(now - i * 2.3 * DAY) }),
  );
  s.sentences.push({
    id: s.seq++, source: "感谢你的回复。", target: "Thanks for your reply.", sourceLang: "zh-CN", targetLang: "en",
    note: "", origin: "write", ...srs(now - DAY),
  });
  for (let d = 0; d < 40; d++) {
    if ((d * 7) % 5 === 3) continue;
    const segments = 1 + ((d * 13) % 6);
    s.sessions.push({
      id: s.seq++, createdAt: now - d * DAY - 3_600_000, sourceLang: "zh-CN", targetLang: "en", draft: "感谢你的回复。",
      result: "Thanks for your reply.", mode: "recall", segments, totalWords: segments * 6,
      correctWords: Math.round(segments * 6 * (0.7 + ((d * 17) % 30) / 100)), hints: d % 3, durationMs: 60_000, detail: "[]",
    });
  }
  s.sessions.forEach((session) => recordSession(s, session, `legacy-session:${session.id}`, "legacy"));
  return s;
}

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Store;
      s.settings = normalizeSettings(s.settings);
      s.receipts ??= {};
      if (!Array.isArray(s.activities)) {
        s.activities = [];
        s.sessions.forEach((session) => recordSession(s, session, `legacy-session:${session.id}`, "legacy"));
        save(s);
      }
      return s;
    }
  } catch {
    /* fall through to seed */
  }
  const s = seed();
  save(s);
  return s;
}

type Listener = (payload: unknown) => void;
const listeners = new Map<string, Set<Listener>>();
function emit(name: string, payload?: unknown) { listeners.get(name)?.forEach((fn) => fn(payload)); }
function changed(oldValue: string | null, newValue: string | null) {
  if (oldValue === newValue) return;
  let oldSettings: unknown;
  let nextSettings: unknown;
  try { oldSettings = JSON.parse(oldValue ?? "{}").settings; nextSettings = JSON.parse(newValue ?? "{}").settings; } catch { /* cleared preview data */ }
  if (JSON.stringify(oldSettings) !== JSON.stringify(nextSettings)) emit("settings-changed", normalizeSettings(nextSettings));
  emit("learning-changed");
}
if (typeof window !== "undefined") window.addEventListener("storage", (event) => {
  if (event.key === KEY || event.key === null) changed(event.oldValue, event.newValue);
});
let imageChannel: BroadcastChannel | undefined;
function backgroundChannel() {
  if (!imageChannel && typeof window !== "undefined" && typeof window.BroadcastChannel === "function") {
    imageChannel = new BroadcastChannel("translatorx-background");
    imageChannel.onmessage = (event) => { if (event.data === "changed") emit("background-image-changed"); };
  }
  return imageChannel;
}

export function mockOnEvent<T>(name: string, cb: (payload: T) => void): () => void {
  if (name === "background-image-changed") backgroundChannel();
  const set = listeners.get(name) ?? new Set<Listener>();
  set.add(cb as Listener);
  listeners.set(name, set);
  return () => { set.delete(cb as Listener); };
}
function save(s: Store) {
  const previous = localStorage.getItem(KEY);
  const next = JSON.stringify(s);
  localStorage.setItem(KEY, next);
  // Match Tauri's asynchronous event delivery after the write commits.
  queueMicrotask(() => changed(previous, next));
}
function receipt(s: Store, eventId: string, kind: string): number | undefined {
  const previous = s.receipts[eventId];
  if (previous && previous.kind !== kind) throw new Error("Activity identifier already used");
  return previous?.result;
}
function recordSession(s: Store, session: Session, eventId: string, origin: string) {
  if (receipt(s, eventId, "practice") !== undefined) return;
  s.activities.push({ ...session, id: s.seq++, eventId, kind: "practice", origin,
    source: session.draft, target: session.result, grade: null, sessionId: session.id });
  s.receipts[eventId] = { kind: "practice", result: session.id };
}
function recordTranslation(context: ActivityContext | undefined, sourceLang: string, targetLang: string, source: string, target: string, segments: number) {
  if (!context) return;
  try {
    const s = load();
    if (receipt(s, context.eventId, context.kind) !== undefined) return;
    const id = s.seq++;
    s.activities.push({ id, eventId: context.eventId, kind: context.kind, origin: context.origin,
      createdAt: Date.now(), sourceLang, targetLang, source, target, segments, totalWords: 0,
      correctWords: 0, durationMs: 0, grade: null, sessionId: null, detail: "{}" });
    s.receipts[context.eventId] = { kind: context.kind, result: id };
    save(s);
  } catch { emit("learning-save-failed"); }
}

function translate(text: string, to: string): string {
  return PHRASEBOOK[text.trim()] ?? `[${to} · ${t("preview.label")}] ${text}`;
}

function day(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function stats(s: Store): Stats {
  const now = Date.now();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekStart = today.getTime() - ((today.getDay() + 6) % 7) * DAY;
  const weekIdx = (ms: number) => {
    const i = Math.floor((weekStart + 7 * DAY - ms) / (7 * DAY));
    return i >= 0 && i < 8 ? 7 - i : -1;
  };
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const d = new Date(weekStart - (7 - i) * 7 * DAY);
    return { start: `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`, words: 0, sentences: 0, sessions: 0 };
  });
  s.words.forEach((w) => weekIdx(w.createdAt) >= 0 && weeks[weekIdx(w.createdAt)].words++);
  s.sentences.forEach((w) => weekIdx(w.createdAt) >= 0 && weeks[weekIdx(w.createdAt)].sentences++);
  s.sessions.forEach((w) => weekIdx(w.createdAt) >= 0 && weeks[weekIdx(w.createdAt)].sessions++);
  const daily = new Map<string, number>();
  s.activities.forEach((x) => daily.set(day(x.createdAt), (daily.get(day(x.createdAt)) ?? 0) + 1));
  const days = Array.from({ length: 112 }, (_, i) => {
    const d = day(today.getTime() - (111 - i) * DAY);
    return { date: d, count: daily.get(d) ?? 0 };
  });
  const streak = summarizeActivities(s.activities, now).streak;
  const practiced = s.sessions.reduce((a, x) => a + x.totalWords, 0);
  const correct = s.sessions.reduce((a, x) => a + x.correctWords, 0);
  return {
    wordsTotal: s.words.length,
    sentencesTotal: s.sentences.length,
    wordsWeek: s.words.filter((x) => x.createdAt >= weekStart).length,
    sentencesWeek: s.sentences.filter((x) => x.createdAt >= weekStart).length,
    sessionsTotal: s.sessions.length,
    sessionsWeek: s.sessions.filter((x) => x.createdAt >= weekStart).length,
    practicedWords: practiced,
    accuracy: practiced ? correct / practiced : 0,
    streakDays: streak,
    todaySegments: s.sessions.filter((x) => day(x.createdAt) === day(now)).reduce((a, x) => a + x.segments, 0),
    dueWords: s.words.filter((x) => x.dueAt <= now).length,
    dueSentences: s.sentences.filter((x) => x.dueAt <= now).length,
    weeks,
    days,
  };
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function mockInvoke<T>(cmd: string, a: Record<string, unknown>): Promise<T> {
  // Image-only operations must not seed or rewrite the learning store.
  if (cmd === "get_background_image") return await readBackground() as T;
  if (cmd === "save_background_image" || cmd === "clear_background_image") {
    if (cmd === "save_background_image") await writeBackground(String(a.dataUrl ?? ""));
    else await deleteBackground();
    emit("background-image-changed");
    backgroundChannel()?.postMessage("changed");
    return undefined as T;
  }
  const s = load();
  const now = Date.now();
  const q = String(a.query ?? "").toLowerCase();
  const out = (v: unknown) => v as T;
  switch (cmd) {
    case "get_settings":
      return out(normalizeSettings(s.settings));
    case "patch_settings": {
      const write = () => {
        const latest = load();
        latest.settings = mergeSettings(latest.settings, a.patch as SettingsPatch);
        save(latest);
        return out(latest.settings);
      };
      // Web Locks make two browser preview windows behave like the native event loop.
      return typeof navigator !== "undefined" && navigator.locks ? navigator.locks.request("translatorx-settings", write) : write();
    }
    case "save_settings":
      s.settings = normalizeSettings(a.settings);
      save(s);
      return out(s.settings);
    case "take_warnings":
      return out([]);
    case "pause_shortcut":
      return out(undefined);
    case "test_connection":
      await delay(400);
      return out(t("preview.connection"));
    case "prepare_session": {
      await delay(700);
      const segments = (a.segments as string[]).map((src) => ({ source: src, target: translate(src, String(a.to)) }));
      recordTranslation(a.activity as ActivityContext | undefined, String(a.from), String(a.to), String(a.text), segments.map((x) => x.target).join(" "), segments.length);
      return out(segments);
    }
    case "translate_texts": {
      await delay(500);
      const texts = a.texts as string[];
      const translated = texts.map((text) => translate(text, String(a.to)));
      recordTranslation(a.activity as ActivityContext | undefined, String(a.from), String(a.to), texts.join("\n"), translated.join("\n"), texts.length);
      return out(translated);
    }
    case "lookup_word": {
      const result = { text: a.text, meaning: t("preview.meaning", { word: String(a.text) }), phonetic: "", dict: [] };
      recordTranslation(a.activity as ActivityContext | undefined, String(a.lang), String(a.native), String(a.text), result.meaning, 1);
      return out(result);
    }
    case "ai_review":
      await delay(600);
      return out({ verdict: "acceptable", score: 82, feedback: t("preview.review"), corrected: a.reference, notes: [] });
    case "explain_sentence":
      await delay(600);
      return out({
        translation: translate(String(a.sentence), "zh-CN"),
        vocabulary: [
          { term: "curated", pos: "adj.", meaning: "精心挑选并整理的" },
          { term: "dataset", pos: "n.", meaning: "数据集" },
          { term: "span", pos: "v.", meaning: "跨越（一段时间）" },
        ],
        grammar: [{ title: "定语从句", detail: "that spans… 修饰 dataset" }, { title: "被动语态", detail: "was trained 强调模型而非训练者" }],
        tip: "curated 暗含“有人凭专业判断挑选过”，比 selected 更能体现质量。",
      });
    case "ask_tutor":
      await delay(600);
      return out(t("preview.tutor"));
    case "speak":
      throw new Error(t("preview.speech"));
    case "add_word": {
      const w = a.word as NewWord;
      const hit = s.words.find((x) => x.text === w.text && x.lang === w.lang);
      if (hit) {
        Object.assign(hit, { meaning: w.meaning || hit.meaning, context: w.context || hit.context, note: w.note || hit.note });
        save(s);
        return out(hit);
      }
      const word: Word = { id: s.seq++, text: w.text, meaning: w.meaning ?? "", lang: w.lang, note: w.note ?? "", context: w.context ?? "", contextTranslation: w.contextTranslation ?? "", ...srs(now) };
      s.words.unshift(word);
      save(s);
      return out(word);
    }
    case "list_words":
      return out(s.words.filter((w) => !q || `${w.text} ${w.meaning} ${w.context} ${w.note}`.toLowerCase().includes(q)));
    case "update_word": {
      const w = s.words.find((x) => x.id === a.id);
      if (w) Object.assign(w, { meaning: a.meaning, note: a.note });
      save(s);
      return out(undefined);
    }
    case "add_sentence": {
      const n = a.sentence as NewSentence;
      const hit = s.sentences.find((x) => x.target === n.target && x.targetLang === n.targetLang);
      if (hit) return out(hit);
      const sen: Sentence = { id: s.seq++, source: n.source, target: n.target, sourceLang: n.sourceLang, targetLang: n.targetLang, note: n.note ?? "", origin: n.origin ?? "write", ...srs(now) };
      s.sentences.unshift(sen);
      save(s);
      return out(sen);
    }
    case "list_sentences":
      return out(s.sentences.filter((x) => !q || `${x.source} ${x.target} ${x.note}`.toLowerCase().includes(q)));
    case "update_sentence_note": {
      const x = s.sentences.find((y) => y.id === a.id);
      if (x) x.note = String(a.note);
      save(s);
      return out(undefined);
    }
    case "delete_item":
      if (a.kind === "word") s.words = s.words.filter((x) => x.id !== a.id);
      else s.sentences = s.sentences.filter((x) => x.id !== a.id);
      save(s);
      return out(undefined);
    case "due_items":
      return out({ words: s.words.filter((x) => x.dueAt <= now), sentences: s.sentences.filter((x) => x.dueAt <= now) });
    case "review_item": {
      const eventId = String(a.eventId ?? crypto.randomUUID());
      const previous = receipt(s, eventId, "review");
      if (previous !== undefined) return out(previous);
      const list: (Word | Sentence)[] = a.kind === "word" ? s.words : s.sentences;
      const item = list.find((x) => x.id === a.id);
      const grade = Number(a.grade);
      if (!item) throw new Error(t("errors.notFound"));
      if (!Number.isInteger(grade) || grade < 0 || grade > 3) throw new Error("Invalid review grade");
      if (grade === 0) {
        item.reps = 0; item.lapses++; item.ease = Math.max(1.3, item.ease - 0.2); item.intervalDays = 0;
        item.dueAt = now + 600_000;
      } else {
        if (grade === 1) { item.ease = Math.max(1.3, item.ease - 0.15); item.intervalDays = Math.max(1, item.intervalDays * 1.2); }
        else if (grade === 2) item.intervalDays = item.reps === 0 ? 1 : item.reps === 1 ? 3 : Math.max(item.intervalDays + 1, item.intervalDays * item.ease);
        else { item.ease += 0.15; item.intervalDays = item.reps === 0 ? 3 : item.reps === 1 ? 6 : Math.max(item.intervalDays + 2, item.intervalDays * item.ease * 1.3); }
        item.reps++;
        item.intervalDays = Math.min(3650, item.intervalDays);
        item.dueAt = now + Math.round(item.intervalDays * DAY);
      }
      const word = "text" in item;
      s.activities.push({ id: s.seq++, eventId, createdAt: now, kind: "review", origin: "main",
        sourceLang: word ? item.lang : item.sourceLang, targetLang: word ? "" : item.targetLang,
        source: word ? item.text : item.source, target: word ? item.meaning : item.target,
        segments: 1, totalWords: 0, correctWords: 0, durationMs: 0, grade, sessionId: null,
        detail: JSON.stringify({ itemKind: a.kind, itemId: a.id, dueAt: item.dueAt }) });
      s.receipts[eventId] = { kind: "review", result: item.dueAt };
      save(s);
      return out(item.dueAt);
    }
    case "add_session": {
      const eventId = String(a.eventId ?? crypto.randomUUID());
      const previous = receipt(s, eventId, "practice");
      if (previous !== undefined) return out(previous);
      const n = a.session as NewSession;
      const session = { ...n, id: s.seq++, createdAt: typeof a.completedAt === "number" ? a.completedAt : now };
      s.sessions.unshift(session);
      recordSession(s, session, eventId, String(a.origin ?? "main"));
      save(s);
      return out(session.id);
    }
    case "list_sessions":
      return out(s.sessions.slice(0, Number(a.limit ?? 30)));
    case "delete_session":
      s.sessions = s.sessions.filter((x) => x.id !== a.id);
      s.activities = s.activities.filter((x) => x.sessionId !== a.id);
      save(s);
      return out(undefined);
    case "list_activities": {
      const rows = s.activities.filter((x) => (!a.kind || a.kind === x.kind) && (a.since === undefined || x.createdAt >= Number(a.since))).sort((x, y) => y.createdAt - x.createdAt || y.id - x.id);
      const offset = Math.max(0, Number(a.offset ?? 0));
      return out(rows.slice(offset, offset + Math.max(1, Math.min(200, Number(a.limit ?? 30)))));
    }
    case "activity_metrics":
      return out(s.activities.filter((x) => a.since === undefined || x.createdAt >= Number(a.since)).map(({ createdAt, kind, sourceLang, targetLang, segments, totalWords, correctWords, durationMs }) => ({ createdAt, kind, sourceLang, targetLang, segments, totalWords, correctWords, durationMs })));
    case "delete_activity": {
      const activity = s.activities.find((x) => x.id === a.id);
      if (activity?.sessionId) s.sessions = s.sessions.filter((x) => x.id !== activity.sessionId);
      s.activities = s.activities.filter((x) => x.id !== a.id);
      save(s);
      return out(undefined);
    }
    case "get_stats":
      return out(stats(s));
    case "mini_insert":
      await navigator.clipboard?.writeText(String(a.text)).catch(() => {});
      return out({ kind: "copied", app: null, reason: "unsupported" });
    case "mini_target":
      return out(null);
    case "ax_status":
      return out(false);
    case "mini_fit":
    case "mini_hide":
    case "mini_dragged":
    case "bubble_click":
    case "bubble_menu":
    case "ax_request":
    case "open_in_main":
      if (cmd === "open_in_main") emit("load-draft", { text: a.text, from: a.from, to: a.to });
      return out(undefined);
    default:
      throw new Error(`mock: unknown command ${cmd}`);
  }
}
