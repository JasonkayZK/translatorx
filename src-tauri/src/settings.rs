use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct LlmConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

impl Default for LlmConfig {
    fn default() -> Self {
        Self {
            base_url: "https://api.openai.com/v1".into(),
            api_key: String::new(),
            model: "gpt-4o-mini".into(),
        }
    }
}

impl LlmConfig {
    /// Ollama and other local servers do not need a key, so only url + model are required.
    pub fn is_ready(&self) -> bool {
        !self.base_url.trim().is_empty() && !self.model.trim().is_empty()
            && (!self.api_key.trim().is_empty() || is_local(&self.base_url))
    }
}

fn is_local(url: &str) -> bool {
    url.contains("localhost") || url.contains("127.0.0.1") || url.contains("0.0.0.0")
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct MaterialPrefs {
    pub opacity: f64,
    pub blur: bool,
}
impl Default for MaterialPrefs {
    fn default() -> Self { Self { opacity: 0.85, blur: true } }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct BackgroundPrefs {
    pub opacity: f64,
    pub blur: f64,
    pub fit: String,
}
impl Default for BackgroundPrefs {
    fn default() -> Self { Self { opacity: 0.45, blur: 8.0, fit: "cover".into() } }
}

/// Daily goals, counted per local day. 0 switches a goal off.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Goals {
    pub practice: u32,
    pub words: u32,
    pub reviews: u32,
    pub lookups: u32,
    pub translations: u32,
    pub reads: u32,
    pub minutes: u32,
    pub activities: u32,
}
impl Default for Goals {
    fn default() -> Self {
        Self { practice: 10, words: 0, reviews: 0, lookups: 0, translations: 0, reads: 0, minutes: 0, activities: 0 }
    }
}

pub const GOAL_KINDS: [&str; 8] = ["practice", "words", "reviews", "lookups", "translations", "reads", "minutes", "activities"];

/// How a spaced-review session is assembled; remembered between sessions.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct ReviewPrefs {
    /// "write" | "flip" | "listen"
    pub method: String,
    /// "all" | "word" | "sentence"
    pub kind: String,
    /// Cards per session; 0 reviews everything that is due.
    pub limit: u32,
    pub shuffle: bool,
}
impl Default for ReviewPrefs {
    fn default() -> Self { Self { method: "write".into(), kind: "all".into(), limit: 20, shuffle: false } }
}

/// Preferences of the quick-translate window, remembered across openings.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct MiniPrefs {
    /// "direct" | "practice"
    pub mode: String,
    /// "paper" | "glass" | "studio"
    pub style: String,
    /// "inherit" | "system" | "light" | "dark"
    pub theme: String,
    /// Background opacity of the glass, 0.3..=1.0.
    pub opacity: f64,
    /// Native blur behind the glass.
    pub blur: bool,
    /// Always on top, and stays open after inserting.
    pub pinned: bool,
    pub use_background: bool,
}

impl Default for MiniPrefs {
    fn default() -> Self {
        Self { mode: "direct".into(), style: "paper".into(), theme: "inherit".into(), opacity: 0.62, blur: true, pinned: false, use_background: false }
    }
}

/// An app in which the input-box bubble never shows.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct BlockedApp {
    /// Bundle identifier, e.g. "com.apple.Terminal".
    pub id: String,
    pub name: String,
}

/// Apps where the bubble would only get in the way: launchers, search boxes and terminals.
fn default_blocklist() -> Vec<BlockedApp> {
    #[cfg(target_os = "macos")]
    let entries: &[(&str, &str)] = &[
        ("com.apple.Spotlight", "Spotlight"),
        ("com.raycast.macos", "Raycast"),
        ("com.runningwithcrayons.Alfred", "Alfred"),
        ("com.apple.Terminal", "终端"),
        ("com.googlecode.iterm2", "iTerm2"),
    ];
    // Windows ids are lower-case executable names, as reported by win32::apps::app_info.
    #[cfg(target_os = "windows")]
    let entries: &[(&str, &str)] = &[
        ("searchhost.exe", "Windows Search"),
        ("searchapp.exe", "Windows Search"),
        ("windowsterminal.exe", "Windows Terminal"),
        ("powershell.exe", "PowerShell"),
        ("pwsh.exe", "PowerShell"),
        ("cmd.exe", "命令提示符"),
        ("powertoys.powerlauncher.exe", "PowerToys Run"),
    ];
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let entries: &[(&str, &str)] = &[];
    entries.iter().map(|(id, name)| BlockedApp { id: (*id).into(), name: (*name).into() }).collect()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub native_lang: String,
    pub target_lang: String,
    /// "google" | "deepl" | "llm"
    pub provider: String,
    pub deepl_key: String,
    pub llm: LlmConfig,
    pub proxy: String,
    /// "sentence" | "clause"
    pub segment_mode: String,
    /// "recall" | "cloze" | "typing"
    pub default_mode: String,
    pub cloze_ratio: f64,
    pub ignore_case: bool,
    pub ignore_punctuation: bool,
    pub ignore_accents: bool,
    pub auto_speak: bool,
    /// "system" | "google"
    pub tts_engine: String,
    pub speech_rate: f64,
    /// "system" | "light" | "dark"
    pub theme: String,
    pub main_style: String,
    pub main_appearance: MaterialPrefs,
    pub background: BackgroundPrefs,
    pub ui_language: String,
    pub show_dock_icon: bool,
    pub shortcut: String,
    /// Sentence count of the single goal that existed before goal kinds; read once to seed `goals`.
    pub daily_goal: u32,
    /// Absent only while loading settings saved before goal kinds existed; `normalize` fills it.
    #[serde(default)]
    pub goals: Option<Goals>,
    /// Goal kinds shown in the sidebar "Today" card; the first is the headline number.
    pub today_card: Vec<String>,
    pub review: ReviewPrefs,
    /// Show the bubble in other apps' input boxes (macOS).
    pub bubble: bool,
    pub bubble_blocklist: Vec<BlockedApp>,
    pub mini: MiniPrefs,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            native_lang: "zh-CN".into(),
            target_lang: "en".into(),
            provider: "google".into(),
            deepl_key: String::new(),
            llm: LlmConfig::default(),
            proxy: String::new(),
            segment_mode: "sentence".into(),
            default_mode: "recall".into(),
            cloze_ratio: 0.4,
            ignore_case: true,
            ignore_punctuation: true,
            ignore_accents: false,
            auto_speak: false,
            tts_engine: "system".into(),
            speech_rate: 0.95,
            theme: "system".into(),
            main_style: "paper".into(),
            main_appearance: MaterialPrefs::default(),
            background: BackgroundPrefs::default(),
            ui_language: "system".into(),
            show_dock_icon: true,
            shortcut: "CommandOrControl+Shift+Y".into(),
            daily_goal: 10,
            goals: Some(Goals::default()),
            today_card: vec!["practice".into()],
            review: ReviewPrefs::default(),
            bubble: true,
            bubble_blocklist: default_blocklist(),
            mini: MiniPrefs::default(),
        }
    }
}

impl Settings {
    pub fn patched(&self, patch: serde_json::Value) -> crate::error::AppResult<Self> {
        use crate::error::{AppError, AppResult};
        use serde_json::Value;
        fn merge(current: &mut Value, patch: Value) -> AppResult<()> {
            let (Some(current), Value::Object(patch)) = (current.as_object_mut(), patch) else {
                return Err(AppError::user("settingsPatch", ""));
            };
            for (key, value) in patch {
                let Some(target) = current.get_mut(&key) else { return Err(AppError::user("settingsPatch", key)); };
                if target.is_object() { merge(target, value)?; }
                else { *target = value; }
            }
            Ok(())
        }
        let mut current = serde_json::to_value(self)?;
        merge(&mut current, patch)?;
        let mut next: Self = serde_json::from_value(current).map_err(|_| AppError::user("settingsPatch", ""))?;
        next.normalize();
        Ok(next)
    }

    pub fn normalize(&mut self) {
        fn choice(value: &mut String, allowed: &[&str], fallback: &str) {
            if !allowed.contains(&value.as_str()) { *value = fallback.into(); }
        }
        choice(&mut self.theme, &["system", "light", "dark"], "system");
        choice(&mut self.main_style, &["paper", "glass", "studio"], "paper");
        choice(&mut self.ui_language, &["system", "zh-CN", "en", "ja"], "system");
        choice(&mut self.mini.style, &["paper", "glass", "studio"], "paper");
        choice(&mut self.mini.theme, &["inherit", "system", "light", "dark"], "inherit");
        fn bounded(value: f64, min: f64, max: f64, fallback: f64) -> f64 {
            if value.is_finite() { value.clamp(min, max) } else { fallback }
        }
        self.mini.opacity = bounded(self.mini.opacity, 0.3, 1.0, 0.62);
        self.main_appearance.opacity = bounded(self.main_appearance.opacity, 0.3, 1.0, 0.85);
        self.background.opacity = bounded(self.background.opacity, 0.0, 1.0, 0.45);
        self.background.blur = bounded(self.background.blur, 0.0, 32.0, 8.0);
        choice(&mut self.background.fit, &["cover", "contain"], "cover");
        self.daily_goal = self.daily_goal.max(1);
        let goals = self.goals.get_or_insert_with(|| Goals { practice: self.daily_goal, ..Goals::default() });
        for value in [&mut goals.practice, &mut goals.words, &mut goals.reviews, &mut goals.lookups,
            &mut goals.translations, &mut goals.reads, &mut goals.minutes, &mut goals.activities] {
            *value = (*value).min(9999);
        }
        let mut seen = Vec::new();
        self.today_card.retain(|kind| GOAL_KINDS.contains(&kind.as_str()) && !seen.contains(kind) && { seen.push(kind.clone()); true });
        if self.today_card.is_empty() { self.today_card.push("practice".into()); }
        choice(&mut self.review.method, &["write", "flip", "listen"], "write");
        choice(&mut self.review.kind, &["all", "word", "sentence"], "all");
        self.review.limit = self.review.limit.min(200);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn patches_preserve_unrelated_settings_and_reject_unknown_fields() {
        let first = Settings::default().patched(serde_json::json!({"mini":{"pinned":true}})).unwrap();
        let second = first.patched(serde_json::json!({"mini":{"opacity":0.4},"mainAppearance":{"blur":false}})).unwrap();
        assert!(second.mini.pinned);
        assert_eq!(second.mini.opacity, 0.4);
        assert!(!second.main_appearance.blur);
        assert_eq!(second.llm, first.llm);
        assert!(second.patched(serde_json::json!({"backgroundImage":"large payload"})).is_err());
        assert!(second.patched(serde_json::json!({"mini":{"unknown":1}})).is_err());
        assert!(second.patched(serde_json::json!({"mini":null})).is_err());
    }

    #[test]
    fn material_defaults_and_bounds_preserve_old_mini_settings() {
        let mut s: Settings = serde_json::from_str(r#"{"mini":{"opacity":0.4,"blur":false},"background":{"blur":99,"fit":"bad"},"mainAppearance":{"opacity":-1}}"#).unwrap();
        s.normalize();
        let value = serde_json::to_value(s).unwrap();
        assert_eq!(value["mainAppearance"]["opacity"], 0.3);
        assert_eq!(value["mainAppearance"]["blur"], true);
        assert_eq!(value["background"]["blur"], 32.0);
        assert_eq!(value["background"]["fit"], "cover");
        assert_eq!(value["mini"]["opacity"], 0.4);
        assert_eq!(value["mini"]["blur"], false);
        assert_eq!(value["mini"]["useBackground"], false);
    }

    #[test]
    fn partial_json_fills_defaults() {
        let s: Settings = serde_json::from_str(r#"{"targetLang":"ja","llm":{"model":"x"}}"#).unwrap();
        assert_eq!(s.target_lang, "ja");
        assert_eq!(s.native_lang, "zh-CN");
        assert_eq!(s.llm.model, "x");
        assert_eq!(s.llm.base_url, "https://api.openai.com/v1");
    }

    #[test]
    fn old_settings_gain_quick_defaults() {
        let s: Settings = serde_json::from_str(r#"{"targetLang":"ja"}"#).unwrap();
        assert!(s.bubble);
        assert_eq!(s.mini.opacity, 0.62);
        let expected = if cfg!(target_os = "macos") { 5 } else if cfg!(target_os = "windows") { 7 } else { 0 };
        assert_eq!(s.bubble_blocklist.len(), expected);
        assert!(s.bubble_blocklist.iter().all(|b| !cfg!(target_os = "windows") || b.id == b.id.to_ascii_lowercase()), "Windows ids are lower-case exe names");
        assert_eq!(s.ui_language, "system");
        assert_eq!(s.main_style, "paper");
        assert!(s.show_dock_icon);
        assert_eq!(s.mini.style, "paper");
        assert_eq!(s.mini.theme, "inherit");
        let p: Settings = serde_json::from_str(r#"{"mini":{"pinned":true}}"#).unwrap();
        assert!(p.mini.pinned);
        assert_eq!(p.mini.mode, "direct");
        assert!(p.mini.blur);
    }

    #[test]
    fn legacy_daily_goal_seeds_goal_kinds_once() {
        let mut old: Settings = serde_json::from_str(r#"{"dailyGoal":25}"#).unwrap();
        assert!(old.goals.is_none());
        old.normalize();
        assert_eq!(old.goals.as_ref().unwrap().practice, 25);
        assert_eq!(old.today_card, vec!["practice".to_string()]);
        let mut explicit: Settings = serde_json::from_str(r#"{"dailyGoal":25,"goals":{"practice":3,"words":40000},"todayCard":["words","bogus","words"],"review":{"method":"x","limit":999}}"#).unwrap();
        explicit.normalize();
        let goals = explicit.goals.as_ref().unwrap();
        assert_eq!((goals.practice, goals.words, goals.reviews), (3, 9999, 0));
        assert_eq!(explicit.today_card, vec!["words".to_string()]);
        assert_eq!((explicit.review.method.as_str(), explicit.review.limit), ("write", 200));
        let value = serde_json::to_value(&explicit).unwrap();
        assert!(value["goals"].is_object());
        let patched = explicit.patched(serde_json::json!({"goals":{"reviews":5},"review":{"method":"flip"}})).unwrap();
        assert_eq!(patched.goals.as_ref().unwrap(), &Goals { practice: 3, words: 9999, reviews: 5, ..Goals::default() });
        assert_eq!(patched.review.method, "flip");
    }

    #[test]
    fn llm_ready_rules() {
        let mut c = LlmConfig::default();
        assert!(!c.is_ready());
        c.api_key = "sk".into();
        assert!(c.is_ready());
        let local = LlmConfig { base_url: "http://localhost:11434/v1".into(), api_key: "".into(), model: "qwen".into() };
        assert!(local.is_ready());
    }
}
