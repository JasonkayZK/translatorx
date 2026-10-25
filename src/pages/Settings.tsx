import { Appearance } from "../components/Appearance";
import { AccessibilitySettings } from "../components/AccessibilitySettings";
import { t as tr, formatNumber } from "../lib/i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Check, Plug, X } from "lucide-react";
import { api, isTauri } from "../lib/api";
import { IS_WINDOWS, prettyAccel } from "../lib/accel";
import { LANGUAGES } from "../lib/languages";
import { GOAL_KINDS } from "../lib/types";
import type { GoalKind, Goals, Provider, Settings, UiLanguage } from "../lib/types";
import { Button, cx, MOD, PageHeader, Segmented, Select, Toggle } from "../components/ui";
import { goalHint, goalLabel, SUGGESTED_TARGETS } from "../components/learning/GoalBoard";
import { useApp } from "../store";

const PRESETS = [
  { name: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { get name() { return tr("Qwen"); }, baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
  { name: "Kimi", baseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" },
  { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini" },
  { get name() { return tr("Ollama (local)"); }, baseUrl: "http://localhost:11434/v1", model: "qwen2.5:7b" },
];

const PROVIDERS: { value: Provider; label: string; desc: string }[] = [
  { value: "google", get label() { return tr("Google Translate"); }, get desc() { return tr("Free, with no setup. Some networks may require a proxy."); } },
  { value: "deepl", label: "DeepL", get desc() { return tr("Natural translations. Requires an API key (500,000 characters/month on the free tier)."); } },
  { value: "llm", get label() { return tr("Language model"); }, get desc() { return tr("Context-aware translation, smart segmentation, and word lookup. Uses the model configured below."); } },
];

function Section({ id, title, desc, children }: { id?: string; title: string; desc?: string; children: ReactNode }) {
  return (
    <section id={id} className="settings-section card">
      <div className="settings-section-heading">
        <h2 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
        {desc && <p className="mt-1.5 max-w-2xl text-[12px] leading-relaxed text-ink-3">{desc}</p>}
      </div>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <div className="text-[13.5px] text-ink">{label}</div>
        {hint && <div className="mt-0.5 text-[12px] text-ink-3">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] text-ink-2">{label}</span>
      {children}
    </label>
  );
}

const IS_MAC = MOD === "⌘";
const BUBBLE_SUPPORTED = IS_MAC || IS_WINDOWS;

/** Turns a keydown into a Tauri accelerator string such as "CommandOrControl+Shift+Y". */
function accelerator(e: KeyboardEvent): string | null {
  const key = e.key;
  if (["Meta", "Control", "Shift", "Alt"].includes(key)) return null;
  const parts: string[] = [];
  // ⌘ on macOS and Ctrl elsewhere map to CommandOrControl; the Mac's own Control key stays distinct.
  if (IS_MAC ? e.metaKey : e.ctrlKey) parts.push("CommandOrControl");
  if (IS_MAC && e.ctrlKey) parts.push("Control");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (!parts.length) return null;
  const code = e.code;
  const main = code.startsWith("Key") ? code.slice(3) : code.startsWith("Digit") ? code.slice(5) : key === " " ? "Space" : key.length === 1 ? key.toUpperCase() : key;
  parts.push(main);
  return parts.join("+");
}

/**
 * Records a global shortcut. Keys are read from the window (WebKit does not focus a clicked
 * button, so the button itself never sees them), and the current shortcut is suspended meanwhile
 * so pressing it is recorded instead of summoning the window.
 */
function ShortcutRecorder({ value, onChange }: { value: string; onChange: (accel: string) => void }) {
  const [recording, setRecording] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!recording) return;
    api.pauseShortcut(true).catch(() => {});
    const stop = () => setRecording(false);
    const onKey = (e: KeyboardEvent) => {
      // Capture phase on window: runs before, and hides the key from, the app's own shortcuts.
      e.preventDefault();
      e.stopPropagation();
      if (e.isComposing) return;
      if (e.key === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey) return stop();
      if ((e.key === "Backspace" || e.key === "Delete") && !e.metaKey && !e.ctrlKey && !e.altKey) {
        onChange("");
        return stop();
      }
      const a = accelerator(e);
      if (a) {
        onChange(a);
        stop();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) stop();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("blur", stop);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("blur", stop);
      // Re-registers whatever is saved now (the new shortcut once it has been stored).
      api.pauseShortcut(false).catch(() => {});
    };
  }, [recording, onChange]);

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        ref={ref}
        onClick={() => setRecording((r) => !r)}
        className={cx("h-9 min-w-40 rounded-lg border px-3 font-mono text-[12.5px] transition-colors", recording ? "border-seal bg-seal-soft text-seal" : "border-line bg-paper text-ink hover:border-line-2")}
      >
        {recording ? tr("Press a key combination…") : value ? prettyAccel(value) : tr("Not set")}
      </button>
      {recording && <span className="text-[11px] text-ink-3">{tr("settings.shortcutHint", { keys: `${MOD}${IS_MAC ? " / ⌃" : ""} / ${IS_MAC ? "⌥" : "Alt"}` })}</span>}
    </div>
  );
}

export function SettingsPage() {
  const { settings, updateSettings, toast } = useApp();
  const [llm, setLlm] = useState(settings.llm);
  const [deeplKey, setDeeplKey] = useState(settings.deeplKey);
  const [proxy, setProxy] = useState(settings.proxy);
  const [testing, setTesting] = useState<string | null>(null);

  const set = (patch: Partial<Settings>) => updateSettings(patch);
  const setGoal = (kind: GoalKind, value: number) => { const goals: Partial<Goals> = {}; goals[kind] = value; void updateSettings({ goals }); };
  const setShortcut = useCallback((shortcut: string) => updateSettings({ shortcut }), [updateSettings]);
  const dirty = JSON.stringify(llm) !== JSON.stringify(settings.llm) || deeplKey !== settings.deeplKey || proxy !== settings.proxy;
  const saveKeys = async () => {
    await updateSettings({ llm, deeplKey, proxy });
    toast(tr("Saved"), "success");
  };

  const test = async (target: "provider" | "llm") => {
    setTesting(target);
    try {
      const out = await api.testConnection({ ...settings, llm, deeplKey, proxy }, target);
      toast(tr("Connected: {p0}", { p0: out }), "success");
    } catch (e) {
      toast(tr("Connection failed: {p0}", { p0: (e as Error).message }), "error");
    } finally {
      setTesting(null);
    }
  };

  return (
    <div className="page-shell settings-page">
      <PageHeader eyebrow={tr("ui.settingsHint")} title={tr("Settings")} />
      <nav className="settings-nav" aria-label={tr("ui.settingsNav")}>
        {[
          ["appearance", tr("appearance.title")], ["general", tr("ui.general")],
          ["services", tr("ui.services")], ["practice", tr("Practice")],
          ["goals", tr("goals.title")], ["speech", tr("Read aloud")], ["desktop", tr("ui.desktop")],
        ].map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
      </nav>
      {!isTauri && (
        <div className="mb-6 rounded-xl border border-amber/30 bg-amber-soft/50 px-4 py-3 text-[12.5px] text-ink-2">
          {tr("settings.preview", { command: "pnpm tauri dev" })}</div>
      )}

      <Section id="appearance" title={tr("appearance.title")} desc={tr("ui.appearanceHint")}>
        <Appearance />
      </Section>

      <Section id="general" title={tr("settings.uiLanguage")} desc={tr("settings.uiLanguageHint")} >
        <Select aria-label={tr("settings.uiLanguage")} value={settings.uiLanguage} onChange={(e) => set({ uiLanguage: e.target.value as UiLanguage })}>
          <option value="system">{tr("Follow system")}</option>
          <option value="zh-CN">简体中文</option>
          <option value="en">English</option>
          <option value="ja">日本語</option>
        </Select>
      </Section>

      <Section title={tr("Languages")} desc={tr("Draft in your native language, then write in your target language. You can also switch on the writing page.")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tr("My native language")}>
            <Select value={settings.nativeLang} onChange={(e) => set({ nativeLang: e.target.value })}>
              {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label} · {l.name}</option>)}
            </Select>
          </Field>
          <Field label={tr("Learning language")}>
            <Select value={settings.targetLang} onChange={(e) => set({ targetLang: e.target.value })}>
              {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label} · {l.name}</option>)}
            </Select>
          </Field>
        </div>
      </Section>

      <Section id="services" title={tr("Translation service")} desc={tr("Requests are sent when you translate or look up words. Keys are stored locally in the database.")}>
        <div className="grid gap-2 sm:grid-cols-3">
          {PROVIDERS.map((p) => (
            <button
              key={p.value}
              onClick={() => set({ provider: p.value })}
              className={cx("relative rounded-xl border p-3.5 text-left transition-colors", settings.provider === p.value ? "border-ink bg-card shadow-paper" : "border-line hover:border-line-2")}
            >
              {settings.provider === p.value && <Check className="absolute top-3 right-3 size-4 text-seal" />}
              <div className="text-[13.5px] font-medium text-ink">{p.label}</div>
              <div className="mt-1 text-[11.5px] leading-relaxed text-ink-3">{p.desc}</div>
            </button>
          ))}
        </div>
        {settings.provider === "deepl" && (
          <Field label={tr("settings.deepLKey")}>
            <input type="password" value={deeplKey} onChange={(e) => setDeeplKey(e.target.value)} placeholder="xxxxxxxx-xxxx-…:fx" className="field font-mono text-[12.5px]" />
          </Field>
        )}
        <Field label={tr("Network proxy (optional)")}>
          <input value={proxy} onChange={(e) => setProxy(e.target.value)} placeholder={tr("http://127.0.0.1:7890 or socks5://127.0.0.1:7890")} className="field font-mono text-[12.5px]" />
        </Field>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" loading={testing === "provider"} onClick={() => test("provider")} icon={<Plug className="size-3.5" />}>{tr("Test translation")}</Button>
          {dirty && <Button variant="ink" size="sm" onClick={saveKeys}>{tr("Save")}</Button>}
        </div>
      </Section>

      <Section title={tr("Language model")} desc={tr("Used for AI corrections, sentence breakdowns, the AI tutor, and translation when Language model is selected. Supports any OpenAI-compatible API.")}>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.name}
              onClick={() => setLlm({ ...llm, baseUrl: p.baseUrl, model: p.model })}
              className={cx("h-7 rounded-full border px-3 text-[12px] transition-colors", llm.baseUrl === p.baseUrl ? "border-ink bg-ink text-paper" : "border-line text-ink-2 hover:border-line-2")}
            >
              {p.name}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-[1.4fr_1fr] gap-4">
          <Field label={tr("settings.baseUrl")}><input value={llm.baseUrl} onChange={(e) => setLlm({ ...llm, baseUrl: e.target.value })} className="field font-mono text-[12.5px]" /></Field>
          <Field label={tr("Model")}><input value={llm.model} onChange={(e) => setLlm({ ...llm, model: e.target.value })} className="field font-mono text-[12.5px]" /></Field>
        </div>
        <Field label={tr("settings.apiKey")}>
          <input type="password" value={llm.apiKey} onChange={(e) => setLlm({ ...llm, apiKey: e.target.value })} placeholder={tr("sk-… (can be empty for local Ollama)")} className="field font-mono text-[12.5px]" />
        </Field>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" loading={testing === "llm"} onClick={() => test("llm")} icon={<Plug className="size-3.5" />}>{tr("Test model")}</Button>
          {dirty && <Button variant="ink" size="sm" onClick={saveKeys}>{tr("Save")}</Button>}
        </div>
      </Section>

      <Section id="practice" title={tr("Practice")} desc={tr("Flexible checking helps you focus on words and sentence structure.")}>
        <Row label={tr("Default practice mode")}>
          <Segmented size="sm" value={settings.defaultMode} onChange={(v) => set({ defaultMode: v })} options={[{ value: "recall", label: tr("Recall") }, { value: "cloze", label: tr("Cloze") }, { value: "typing", label: tr("Typing") }]} />
        </Row>
        <Row label={tr("Blank ratio")} hint={tr("Hide about {p0}% of words; 100% is word-by-word dictation", { p0: Math.round(settings.clozeRatio * 100) })}>
          <input aria-label={tr("Blank ratio")} type="range" min={0.2} max={1} step={0.1} value={settings.clozeRatio} onChange={(e) => set({ clozeRatio: Number(e.target.value) })} className="w-44 accent-[var(--seal)]" />
        </Row>
        <Row label={tr("Ignore case")}><Toggle label={tr("Ignore case")} checked={settings.ignoreCase} onChange={(v) => set({ ignoreCase: v })} /></Row>
        <Row label={tr("Ignore punctuation")}><Toggle label={tr("Ignore punctuation")} checked={settings.ignorePunctuation} onChange={(v) => set({ ignorePunctuation: v })} /></Row>
        <Row label={tr("Ignore accents")} hint={tr("For example, café and cafe are treated as equal")}><Toggle label={tr("Ignore accents")} checked={settings.ignoreAccents} onChange={(v) => set({ ignoreAccents: v })} /></Row>
      </Section>

      <Section id="goals" title={tr("goals.title")} desc={tr("goals.description")}>
        <div>
          {GOAL_KINDS.map((kind) => {
            const target = settings.goals[kind];
            const on = target > 0;
            return (
              <div key={kind} className="goal-setting">
                <div className="min-w-0">
                  <div className="text-[13.5px] text-ink">{goalLabel(kind)}</div>
                  <div className="mt-0.5 text-[12px] text-ink-3">{goalHint(kind)}</div>
                </div>
                {on ? (
                  <input aria-label={goalLabel(kind)} type="number" min={1} max={9999} value={target} onChange={(e) => setGoal(kind, Math.max(1, Math.round(Number(e.target.value) || 1)))} className="field h-9 w-24 text-center font-mono" />
                ) : (
                  <span className="text-[12px] text-ink-3">{tr("goals.off")}</span>
                )}
                <Toggle label={goalLabel(kind)} checked={on} onChange={(v) => setGoal(kind, v ? SUGGESTED_TARGETS[kind] : 0)} />
              </div>
            );
          })}
        </div>
        <div>
          <div className="text-[13.5px] text-ink">{tr("goals.todayCard")}</div>
          <div className="mt-0.5 text-[12px] text-ink-3">{tr("goals.todayCardHint")}</div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {GOAL_KINDS.map((kind) => {
              const shown = settings.todayCard.includes(kind);
              return (
                <button key={kind} type="button" className="goal-chip" aria-pressed={shown} disabled={shown && settings.todayCard.length === 1}
                  onClick={() => set({ todayCard: shown ? settings.todayCard.filter((k) => k !== kind) : [...settings.todayCard, kind] })}>
                  {shown && <Check className="size-3" />}{goalLabel(kind)}
                </button>
              );
            })}
          </div>
        </div>
      </Section>

      <Section id="speech" title={tr("Read aloud")}>
        <Row label={tr("Read aloud automatically after a correct answer")}><Toggle label={tr("Read aloud automatically after a correct answer")} checked={settings.autoSpeak} onChange={(v) => set({ autoSpeak: v })} /></Row>
        <Row label={tr("Speech engine")} hint={tr("System voices work offline; online speech is used when a language has no installed voice")}>
          <Segmented size="sm" value={settings.ttsEngine} onChange={(v) => set({ ttsEngine: v })} options={[{ value: "system", label: tr("System") }, { value: "google", label: tr("Online") }]} />
        </Row>
        <Row label={tr("Speech rate")} hint={`${formatNumber(settings.speechRate, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`}>
          <input aria-label={tr("Speech rate")} type="range" min={0.6} max={1.3} step={0.05} value={settings.speechRate} onChange={(e) => set({ speechRate: Number(e.target.value) })} className="w-44 accent-[var(--seal)]" />
        </Row>
      </Section>

      <Section id="desktop" title={tr("Quick window and floating icon")} desc={tr("Write in your native language in any app, then translate (or practice first) and insert it.")}>
        <Row label={tr("Quick translation window")} hint={tr("Press in any app to open the quick window; press again while it is focused to close")}>
          <ShortcutRecorder value={settings.shortcut} onChange={setShortcut} />
        </Row>
        <Row label={tr("Input field floating icon")} hint={BUBBLE_SUPPORTED ? tr("Show the translate icon beside input fields in other apps; click to open the quick window") : tr("macOS and Windows only")}>
          <span className={cx(!BUBBLE_SUPPORTED && "pointer-events-none opacity-40")}>
            <Toggle checked={BUBBLE_SUPPORTED && settings.bubble} onChange={(v) => set({ bubble: v })} label={tr("Input field floating icon")} />
          </span>
        </Row>
        {IS_MAC && <AccessibilitySettings />}
        {BUBBLE_SUPPORTED && settings.bubbleBlocklist.length > 0 && (
          <div>
            <div className="text-[13.5px] text-ink">{tr("Apps with the icon hidden")}</div>
            <div className="mt-0.5 text-[12px] text-ink-3">{tr("Right-click the icon and choose “Hide in this app” to add an app")}</div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {settings.bubbleBlocklist.map((b) => (
                <span key={b.id} title={b.id} className="inline-flex h-7 items-center gap-1 rounded-full border border-line bg-card/60 pr-1 pl-3 text-[12px] text-ink-2">
                  {b.name || b.id}
                  <button
                    aria-label={tr("Remove {p0}", { p0: b.name || b.id })}
                    onClick={() => set({ bubbleBlocklist: settings.bubbleBlocklist.filter((x) => x.id !== b.id) })}
                    className="flex size-5 items-center justify-center rounded-full text-ink-3 hover:bg-ink/5 hover:text-ink"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}
      </Section>

      <div className="mb-6 rounded-xl bg-paper-2/70 px-4 py-3 text-[12px] leading-[1.9] text-ink-3">
        <b className="font-medium text-ink-2">{tr("App shortcuts")}</b><br />{tr("settings.shortcuts", { mod: MOD })}
      </div>

      <div className="border-t border-line pt-6 text-[12px] text-ink-3">
        {tr("settings.motto")}
      </div>
    </div>
  );
}
