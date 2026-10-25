export type Provider = "google" | "deepl" | "llm";
export type PracticeMode = "recall" | "cloze" | "typing";
export type Theme = "system" | "light" | "dark";
export type UiLanguage = "system" | "zh-CN" | "en" | "ja";
export type MainStyle = "paper" | "glass" | "studio";
export type MiniTheme = "inherit" | Theme;

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export type MiniMode = "direct" | "practice";

export interface MaterialPrefs {
  opacity: number;
  blur: boolean;
}

export interface BackgroundPrefs {
  opacity: number;
  blur: number;
  fit: "cover" | "contain";
}

/** Daily goal kinds. Every value is a count per local day; 0 switches the goal off. */
export type GoalKind = "practice" | "words" | "reviews" | "lookups" | "translations" | "reads" | "minutes" | "activities";
export const GOAL_KINDS: GoalKind[] = ["practice", "words", "reviews", "lookups", "translations", "reads", "minutes", "activities"];
export type Goals = Record<GoalKind, number>;

export type ReviewMethod = "write" | "flip" | "listen";
export type ReviewScope = "all" | "word" | "sentence";
/** How a spaced-review session is assembled; remembered between sessions. */
export interface ReviewPrefs {
  method: ReviewMethod;
  kind: ReviewScope;
  /** Cards per session; 0 reviews everything that is due. */
  limit: number;
  shuffle: boolean;
}

export type SettingsPatch = Omit<Partial<Settings>, "llm" | "mini" | "mainAppearance" | "background" | "goals" | "review"> & {
  llm?: Partial<LlmConfig>;
  mini?: Partial<MiniPrefs>;
  mainAppearance?: Partial<MaterialPrefs>;
  background?: Partial<BackgroundPrefs>;
  goals?: Partial<Goals>;
  review?: Partial<ReviewPrefs>;
};

/** Preferences of the quick-translate window. */
export interface MiniPrefs {
  style: MainStyle;
  theme: MiniTheme;
  mode: MiniMode;
  /** Background opacity of the glass, 0.3–1. */
  opacity: number;
  blur: boolean;
  pinned: boolean;
  useBackground: boolean;
}

/** An app in which the input-box bubble never shows. */
export interface BlockedApp {
  id: string;
  name: string;
}

/** The app the quick window will insert into. */
export interface TargetInfo {
  app: string;
  bundleId: string;
}

export interface InsertOutcome {
  kind: "pasted" | "copied";
  app?: string | null;
  reason?: string | null;
}

export interface Settings {
  nativeLang: string;
  targetLang: string;
  provider: Provider;
  deeplKey: string;
  llm: LlmConfig;
  proxy: string;
  segmentMode: "sentence" | "clause";
  defaultMode: PracticeMode;
  clozeRatio: number;
  ignoreCase: boolean;
  ignorePunctuation: boolean;
  ignoreAccents: boolean;
  autoSpeak: boolean;
  ttsEngine: "system" | "google";
  speechRate: number;
  theme: Theme;
  uiLanguage: UiLanguage;
  mainStyle: MainStyle;
  mainAppearance: MaterialPrefs;
  background: BackgroundPrefs;
  showDockIcon: boolean;
  shortcut: string;
  goals: Goals;
  /** Goal kinds shown in the sidebar "Today" card; the first one is the headline number. */
  todayCard: GoalKind[];
  review: ReviewPrefs;
  bubble: boolean;
  bubbleBlocklist: BlockedApp[];
  mini: MiniPrefs;
}

export const DEFAULT_SETTINGS: Settings = {
  nativeLang: "zh-CN",
  targetLang: "en",
  provider: "google",
  deeplKey: "",
  llm: { baseUrl: "https://api.openai.com/v1", apiKey: "", model: "gpt-4o-mini" },
  proxy: "",
  segmentMode: "sentence",
  defaultMode: "recall",
  clozeRatio: 0.4,
  ignoreCase: true,
  ignorePunctuation: true,
  ignoreAccents: false,
  autoSpeak: false,
  ttsEngine: "system",
  speechRate: 0.95,
  theme: "system",
  uiLanguage: "system",
  mainStyle: "paper",
  mainAppearance: { opacity: .85, blur: true },
  background: { opacity: .45, blur: 8, fit: "cover" },
  showDockIcon: true,
  shortcut: "CommandOrControl+Shift+Y",
  goals: { practice: 10, words: 0, reviews: 0, lookups: 0, translations: 0, reads: 0, minutes: 0, activities: 0 },
  todayCard: ["practice"],
  review: { method: "write", kind: "all", limit: 20, shuffle: false },
  bubble: true,
  bubbleBlocklist: [
    { id: "com.apple.Spotlight", name: "Spotlight" },
    { id: "com.raycast.macos", name: "Raycast" },
    { id: "com.runningwithcrayons.Alfred", name: "Alfred" },
    { id: "com.apple.Terminal", name: "Terminal" },
    { id: "com.googlecode.iterm2", name: "iTerm2" },
  ],
  mini: { style: "paper", theme: "inherit", mode: "direct", opacity: 0.62, blur: true, pinned: false, useBackground: false },
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function bounded(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/** Fill new fields without discarding existing nested window or provider preferences. */
export function normalizeSettings(value: unknown): Settings {
  const data = object(value) as Partial<Settings>;
  const next: Settings = {
    ...DEFAULT_SETTINGS,
    ...data,
    llm: { ...DEFAULT_SETTINGS.llm, ...object(data.llm) },
    mini: { ...DEFAULT_SETTINGS.mini, ...object(data.mini) },
    mainAppearance: { ...DEFAULT_SETTINGS.mainAppearance, ...object(data.mainAppearance) },
    background: { ...DEFAULT_SETTINGS.background, ...object(data.background) },
    goals: { ...DEFAULT_SETTINGS.goals, ...object(data.goals) },
    todayCard: Array.isArray(data.todayCard) ? [...data.todayCard] : [...DEFAULT_SETTINGS.todayCard],
    review: { ...DEFAULT_SETTINGS.review, ...object(data.review) },
    bubbleBlocklist: Array.isArray(data.bubbleBlocklist) ? data.bubbleBlocklist : [...DEFAULT_SETTINGS.bubbleBlocklist],
  };
  // Settings saved before goal kinds existed carried a single "dailyGoal" sentence count.
  const legacyGoal = (object(value) as { dailyGoal?: unknown }).dailyGoal;
  if (!object(value).goals && typeof legacyGoal === "number" && Number.isFinite(legacyGoal)) next.goals.practice = legacyGoal;
  for (const kind of GOAL_KINDS) next.goals[kind] = Math.round(bounded(next.goals[kind], 0, 9999, DEFAULT_SETTINGS.goals[kind]));
  next.todayCard = next.todayCard.filter((kind, i, all): kind is GoalKind => (GOAL_KINDS as string[]).includes(kind) && all.indexOf(kind) === i);
  if (!next.todayCard.length) next.todayCard = [...DEFAULT_SETTINGS.todayCard];
  if (!["write", "flip", "listen"].includes(next.review.method)) next.review.method = "write";
  if (!["all", "word", "sentence"].includes(next.review.kind)) next.review.kind = "all";
  next.review.limit = Math.round(bounded(next.review.limit, 0, 200, 20));
  if (typeof next.review.shuffle !== "boolean") next.review.shuffle = false;
  if (!["system", "zh-CN", "en", "ja"].includes(next.uiLanguage)) next.uiLanguage = "system";
  if (!["paper", "glass", "studio"].includes(next.mainStyle)) next.mainStyle = "paper";
  if (!["paper", "glass", "studio"].includes(next.mini.style)) next.mini.style = "paper";
  if (!["inherit", "system", "light", "dark"].includes(next.mini.theme)) next.mini.theme = "inherit";
  if (!["system", "light", "dark"].includes(next.theme)) next.theme = "system";
  if (typeof next.showDockIcon !== "boolean") next.showDockIcon = true;
  next.mainAppearance.opacity = bounded(next.mainAppearance.opacity, .3, 1, .85);
  next.mini.opacity = bounded(next.mini.opacity, .3, 1, .62);
  next.background.opacity = bounded(next.background.opacity, 0, 1, .45);
  next.background.blur = bounded(next.background.blur, 0, 32, 8);
  if (typeof next.mainAppearance.blur !== "boolean") next.mainAppearance.blur = true;
  if (typeof next.mini.blur !== "boolean") next.mini.blur = true;
  if (typeof next.mini.useBackground !== "boolean") next.mini.useBackground = false;
  if (!["cover", "contain"].includes(next.background.fit)) next.background.fit = "cover";
  return next;
}

/** Partial nested updates must never reset another window's unrelated preferences. */
export function mergeSettings(current: Settings, patch: SettingsPatch): Settings {
  return normalizeSettings({ ...current, ...patch,
    llm: { ...current.llm, ...patch.llm }, mini: { ...current.mini, ...patch.mini },
    mainAppearance: { ...current.mainAppearance, ...patch.mainAppearance },
    background: { ...current.background, ...patch.background },
    goals: { ...current.goals, ...patch.goals },
    review: { ...current.review, ...patch.review },
  });
}

export function llmReady(s: Settings): boolean {
  const local = /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(s.llm.baseUrl);
  return !!s.llm.baseUrl.trim() && !!s.llm.model.trim() && (!!s.llm.apiKey.trim() || local);
}

export interface Segment {
  source: string;
  target: string;
}

interface SrsFields {
  id: number;
  createdAt: number;
  dueAt: number;
  intervalDays: number;
  ease: number;
  reps: number;
  lapses: number;
}

export interface Word extends SrsFields {
  text: string;
  meaning: string;
  lang: string;
  note: string;
  context: string;
  contextTranslation: string;
}

export interface NewWord {
  text: string;
  meaning?: string;
  lang: string;
  note?: string;
  context?: string;
  contextTranslation?: string;
}

export interface Sentence extends SrsFields {
  source: string;
  target: string;
  sourceLang: string;
  targetLang: string;
  note: string;
  origin: string;
}

export interface NewSentence {
  source: string;
  target: string;
  sourceLang: string;
  targetLang: string;
  note?: string;
  origin?: string;
}

export interface Session {
  id: number;
  createdAt: number;
  sourceLang: string;
  targetLang: string;
  draft: string;
  result: string;
  mode: string;
  segments: number;
  totalWords: number;
  correctWords: number;
  hints: number;
  durationMs: number;
  detail: string;
}

export type NewSession = Omit<Session, "id" | "createdAt">;

export interface Stats {
  wordsTotal: number;
  sentencesTotal: number;
  wordsWeek: number;
  sentencesWeek: number;
  sessionsTotal: number;
  sessionsWeek: number;
  practicedWords: number;
  accuracy: number;
  streakDays: number;
  todaySegments: number;
  dueWords: number;
  dueSentences: number;
  weeks: { start: string; words: number; sentences: number; sessions: number }[];
  days: { date: string; count: number }[];
}

export interface Lookup {
  text: string;
  meaning: string;
  phonetic: string;
  dict: { pos: string; terms: string[] }[];
}

export interface AiReview {
  verdict: "correct" | "acceptable" | "incorrect";
  score: number;
  feedback: string;
  corrected: string;
  notes: { wrong: string; right: string; why: string }[];
}

export interface Breakdown {
  translation: string;
  vocabulary: { term: string; pos: string; meaning: string }[];
  grammar: { title: string; detail: string }[];
  tip: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export type ActivityKind = "translate" | "read" | "lookup" | "practice" | "review";
export interface ActivityContext {
  eventId: string;
  kind: "translate" | "read" | "lookup";
  origin: "main" | "mini";
}
export interface ActivityMetric {
  createdAt: number;
  kind: ActivityKind;
  sourceLang: string;
  targetLang: string;
  segments: number;
  totalWords: number;
  correctWords: number;
  durationMs: number;
}
export interface LearningActivity extends ActivityMetric {
  id: number;
  eventId: string;
  origin: string;
  source: string;
  target: string;
  grade: number | null;
  sessionId: number | null;
  detail: string;
}
