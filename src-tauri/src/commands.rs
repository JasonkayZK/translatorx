use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::db::{Db, NewSentence, NewSession, NewWord, Sentence, Session, Stats, Word};
use crate::error::{AppError, AppResult};
use crate::settings::Settings;
use crate::learning::{ActivityContext, ActivityMetric, LearningActivity};
use crate::translate::{self, AiReview, Breakdown, ChatMessage, Lookup, Segment};

pub struct AppState {
    pub db: Db,
    /// Problems found during startup, shown by the UI once it has loaded.
    pub warnings: Mutex<Vec<String>>,
}

impl AppState {
    pub fn warn(&self, msg: String) {
        self.warnings.lock().unwrap_or_else(|e| e.into_inner()).push(msg);
    }
}

fn now() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

// ---------------------------------------------------------------- settings

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> AppResult<Settings> {
    state.db.settings()
}

#[tauri::command]
pub async fn save_settings(app: AppHandle, settings: Settings) -> AppResult<Settings> {
    change_settings(app, SettingsChange::Replace(settings)).await
}

#[tauri::command]
pub async fn patch_settings(app: AppHandle, patch: serde_json::Value) -> AppResult<Settings> {
    change_settings(app, SettingsChange::Patch(patch)).await
}

enum SettingsChange { Replace(Settings), Patch(serde_json::Value) }

// Read, merge and apply on the event-loop thread, also used by native menu callbacks.
// Never hold a DB/settings mutex while waiting for an AppKit operation on that thread.
async fn change_settings(app: AppHandle, change: SettingsChange) -> AppResult<Settings> {
    let (send, receive) = std::sync::mpsc::sync_channel(1);
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let state = handle.state::<AppState>();
        let result = (|| {
            let next = match change {
                SettingsChange::Replace(settings) => settings,
                SettingsChange::Patch(patch) => state.db.settings()?.patched(patch)?,
            };
            store_settings(&handle, &state, next)
        })();
        let _ = send.send(result);
    }).map_err(|e| AppError::msg(e.to_string()))?;
    tauri::async_runtime::spawn_blocking(move || receive.recv().map_err(|e| AppError::msg(e.to_string()))?)
        .await.map_err(|e| AppError::msg(e.to_string()))?
}

/// Saves settings and applies what they change outside the database (the shortcut, the quick
/// windows, the bubble), then tells every window so they stay in sync.
pub fn store_settings(app: &AppHandle, state: &AppState, mut settings: Settings) -> AppResult<Settings> {
    settings.normalize();
    let old = state.db.settings()?;
    if old.shortcut != settings.shortcut {
        if let Err(e) = crate::apply_shortcut(app, &settings.shortcut) {
            // Registering replaces every shortcut, so put the previous one back.
            if let Err(e2) = crate::apply_shortcut(app, &old.shortcut) {
                log::warn!("恢复快捷键失败: {e2}");
            }
            return Err(e);
        }
    }
    let native_changed = old.show_dock_icon != settings.show_dock_icon || old.ui_language != settings.ui_language;
    let material_changed = old.main_appearance.blur != settings.main_appearance.blur || old.mini.blur != settings.mini.blur;
    let apply_native = if native_changed { crate::native::apply(app, &settings) } else { Ok(()) };
    let applied = apply_native.and_then(|_| if material_changed { crate::windows::apply_materials(app, &settings) } else { Ok(()) });
    if let Err(e) = applied.and_then(|_| state.db.save_settings(&settings)) {
        if material_changed { let _ = crate::windows::apply_materials(app, &old); }
        if native_changed { let _ = crate::native::apply(app, &old); }
        if old.shortcut != settings.shortcut { let _ = crate::apply_shortcut(app, &old.shortcut); }
        return Err(e);
    }
    crate::windows::apply(app, &old, &settings);
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    if let Some(t) = app.try_state::<crate::tracker::Tracker>() {
        t.update_settings(&settings);
    }
    let _ = app.emit("settings-changed", &settings);
    Ok(settings)
}

#[tauri::command]
pub fn get_background_image(state: State<'_, AppState>) -> AppResult<Option<String>> {
    state.db.background_image()
}

#[tauri::command]
pub fn save_background_image(app: AppHandle, state: State<'_, AppState>, data_url: String) -> AppResult<()> {
    state.db.save_background_image(&data_url)?;
    let _ = app.emit("background-image-changed", ());
    Ok(())
}

#[tauri::command]
pub fn clear_background_image(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    state.db.clear_background_image()?;
    let _ = app.emit("background-image-changed", ());
    Ok(())
}

/// Suspends the global shortcut while the settings page records a new one, so pressing the
/// current combination is captured by the page instead of summoning the window.
#[tauri::command]
pub fn pause_shortcut(app: AppHandle, state: State<'_, AppState>, paused: bool) -> AppResult<()> {
    let accel = if paused { String::new() } else { state.db.settings()?.shortcut };
    crate::apply_shortcut(&app, &accel)
}

#[tauri::command]
pub fn take_warnings(state: State<'_, AppState>) -> Vec<String> {
    std::mem::take(&mut *state.warnings.lock().unwrap_or_else(|e| e.into_inner()))
}

// ---------------------------------------------------------------- translation

/// Turns a native-language draft into practice segments. With an LLM provider the model
/// splits and translates in one pass; otherwise the frontend's segments are translated as-is.
fn record_success(app: &AppHandle, state: &AppState, activity: Option<&ActivityContext>,
    from: &str, to: &str, source: &str, target: &str, segments: usize) {
    let Some(activity) = activity else { return };
    if target.trim().is_empty() { return; }
    match state.db.record_activity(activity, from, to, source, target, segments as i64, now()) {
        Ok(_) => { let _ = app.emit("learning-changed", ()); }
        Err(e) => {
            log::warn!("Unable to save learning activity: {e}");
            let _ = app.emit("learning-save-failed", ());
        }
    }
}

#[tauri::command]
pub async fn prepare_session(
    app: AppHandle, state: State<'_, AppState>, text: String, segments: Vec<String>,
    from: String, to: String, activity: Option<ActivityContext>,
) -> AppResult<Vec<Segment>> {
    if let Some(a) = &activity { a.validate(&["translate"])?; }
    let s = state.db.settings()?;
    let result = if s.provider == "llm" {
        let c = translate::client(&s, 120)?;
        translate::llm_segments(&c, &s, &text, &from, &to).await?
    } else {
        let targets = translate::translate_many(&s, segments.clone(), from.clone(), to.clone()).await?;
        segments.into_iter().zip(targets).filter(|(_, t)| !t.trim().is_empty())
            .map(|(source, target)| Segment { source, target }).collect()
    };
    let target = result.iter().map(|s| s.target.as_str()).collect::<Vec<_>>().join("\n");
    record_success(&app, &state, activity.as_ref(), &from, &to, &text, &target, result.len());
    Ok(result)
}

#[tauri::command]
pub async fn translate_texts(
    app: AppHandle, state: State<'_, AppState>, texts: Vec<String>, from: String,
    to: String, activity: Option<ActivityContext>,
) -> AppResult<Vec<String>> {
    if let Some(a) = &activity { a.validate(&["read", "translate"])?; }
    let s = state.db.settings()?;
    let result = translate::translate_many(&s, texts.clone(), from.clone(), to.clone()).await?;
    record_success(&app, &state, activity.as_ref(), &from, &to, &texts.join("\n"), &result.join("\n"), result.len());
    Ok(result)
}

/// Only explicit user lookup requests provide an activity context.
#[tauri::command]
pub async fn lookup_word(
    app: AppHandle, state: State<'_, AppState>, text: String, context: String,
    lang: String, native: String, activity: Option<ActivityContext>,
) -> AppResult<Lookup> {
    if let Some(a) = &activity { a.validate(&["lookup"])?; }
    let s = state.db.settings()?;
    let result = translate::lookup(&s, &text, &context, &lang, &native).await?;
    record_success(&app, &state, activity.as_ref(), &lang, &native, &text, &result.meaning, 1);
    Ok(result)
}

/// `from`/`to` are the pair of the practice session, which may differ from the settings.
#[tauri::command]
pub async fn ai_review(
    state: State<'_, AppState>,
    source: String,
    reference: String,
    answer: String,
    from: String,
    to: String,
) -> AppResult<AiReview> {
    let s = state.db.settings()?;
    let c = translate::client(&s, 90)?;
    translate::llm_review(&c, &s, &source, &reference, &answer, &from, &to).await
}

#[tauri::command]
pub async fn explain_sentence(
    state: State<'_, AppState>,
    sentence: String,
    lang: String,
    native: String,
) -> AppResult<Breakdown> {
    let s = state.db.settings()?;
    let c = translate::client(&s, 90)?;
    translate::llm_explain(&c, &s, &sentence, &lang, &native).await
}

#[tauri::command]
pub async fn ask_tutor(
    state: State<'_, AppState>,
    sentence: String,
    history: Vec<ChatMessage>,
    lang: String,
    native: String,
) -> AppResult<String> {
    let s = state.db.settings()?;
    let c = translate::client(&s, 90)?;
    translate::llm_ask(&c, &s, &sentence, history, &lang, &native).await
}

#[tauri::command]
pub async fn speak(state: State<'_, AppState>, text: String, lang: String) -> AppResult<String> {
    let s = state.db.settings()?;
    translate::tts(&s, &text, &lang).await
}

/// Checks the provider and LLM configuration passed in (not yet saved) from the settings page.
#[tauri::command]
pub async fn test_connection(settings: Settings, target: String) -> AppResult<String> {
    match target.as_str() {
        "llm" => {
            let c = translate::client(&settings, 60)?;
            translate::llm_translate(&c, &settings, "你好，很高兴认识你。", "zh-CN", "en").await
        }
        _ => {
            let out = translate::translate_many(&settings, vec!["你好，很高兴认识你。".into()], "zh-CN".into(), "en".into())
                .await?;
            out.into_iter().next().ok_or_else(|| AppError::user("emptyResponse", ""))
        }
    }
}

// ---------------------------------------------------------------- notebook

#[tauri::command]
pub fn add_word(state: State<'_, AppState>, word: NewWord) -> AppResult<Word> {
    state.db.add_word(&word, now())
}

#[tauri::command]
pub fn list_words(state: State<'_, AppState>, query: Option<String>) -> AppResult<Vec<Word>> {
    state.db.list_words(query.as_deref().unwrap_or(""))
}

#[tauri::command]
pub fn update_word(state: State<'_, AppState>, id: i64, meaning: String, note: String) -> AppResult<()> {
    state.db.update_word(id, &meaning, &note)
}

#[tauri::command]
pub fn add_sentence(state: State<'_, AppState>, sentence: NewSentence) -> AppResult<Sentence> {
    state.db.add_sentence(&sentence, now())
}

#[tauri::command]
pub fn list_sentences(state: State<'_, AppState>, query: Option<String>) -> AppResult<Vec<Sentence>> {
    state.db.list_sentences(query.as_deref().unwrap_or(""))
}

#[tauri::command]
pub fn update_sentence_note(state: State<'_, AppState>, id: i64, note: String) -> AppResult<()> {
    state.db.update_sentence_note(id, &note)
}

#[tauri::command]
pub fn delete_item(state: State<'_, AppState>, kind: String, id: i64) -> AppResult<()> {
    state.db.delete_item(&kind, id)
}

#[derive(Serialize)]
pub struct DueItems {
    words: Vec<Word>,
    sentences: Vec<Sentence>,
}

#[tauri::command]
pub fn due_items(state: State<'_, AppState>, limit: Option<i64>) -> AppResult<DueItems> {
    let n = now();
    let limit = limit.unwrap_or(50);
    Ok(DueItems { words: state.db.due_words(n, limit)?, sentences: state.db.due_sentences(n, limit)? })
}

#[tauri::command]
pub fn review_item(app: AppHandle, state: State<'_, AppState>, kind: String, id: i64, grade: u8, event_id: Option<String>) -> AppResult<i64> {
    if grade > 3 {
        return Err(AppError::user("invalidGrade", ""));
    }
    let due = state.db.review_with_event(&kind, id, grade, now(), event_id.as_deref())?;
    let _ = app.emit("learning-changed", ());
    Ok(due)
}

// ---------------------------------------------------------------- sessions & stats

#[tauri::command]
pub fn add_session(app: AppHandle, state: State<'_, AppState>, session: NewSession,
    event_id: Option<String>, origin: Option<String>, completed_at: Option<i64>) -> AppResult<i64> {
    let id = state.db.add_session_with_event(&session, completed_at.unwrap_or_else(now), event_id.as_deref(), origin.as_deref().unwrap_or("main"))?;
    let _ = app.emit("learning-changed", ());
    Ok(id)
}

#[tauri::command]
pub fn list_sessions(state: State<'_, AppState>, limit: Option<i64>) -> AppResult<Vec<Session>> {
    state.db.list_sessions(limit.unwrap_or(30))
}

#[tauri::command]
pub fn delete_session(app: AppHandle, state: State<'_, AppState>, id: i64) -> AppResult<()> {
    state.db.delete_session(id)?;
    let _ = app.emit("learning-changed", ());
    Ok(())
}

#[tauri::command]
pub fn list_activities(state: State<'_, AppState>, limit: Option<i64>, offset: Option<i64>,
    kind: Option<String>, since: Option<i64>) -> AppResult<Vec<LearningActivity>> {
    state.db.list_activities(limit.unwrap_or(30), offset.unwrap_or(0), kind.as_deref(), since)
}

#[tauri::command]
pub fn activity_metrics(state: State<'_, AppState>, since: Option<i64>) -> AppResult<Vec<ActivityMetric>> {
    state.db.activity_metrics(since)
}

#[tauri::command]
pub fn delete_activity(app: AppHandle, state: State<'_, AppState>, id: i64) -> AppResult<()> {
    state.db.delete_activity(id)?;
    let _ = app.emit("learning-changed", ());
    Ok(())
}

// ---------------------------------------------------------------- export

/// Writes an export where the user chooses to put it (a native save panel on macOS; the
/// Downloads folder elsewhere, never overwriting) and reveals it. `None` means the user cancelled.
#[tauri::command]
pub async fn export_file(app: AppHandle, name: String, content: String) -> AppResult<Option<String>> {
    let suggested = sanitize_file_name(&name);
    // The save panel blocks until dismissed; keep that off the async runtime's worker threads.
    tauri::async_runtime::spawn_blocking(move || {
        let fallback = app
            .path()
            .download_dir()
            .or_else(|_| app.path().home_dir())
            .map_err(|e| AppError::msg(format!("Downloads folder unavailable: {e}")))?;
        let Some(path) = choose_export_path(&app, &fallback, &suggested)? else { return Ok(None) };
        std::fs::write(&path, content).map_err(|e| AppError::msg(format!("Could not write {}: {e}", path.display())))?;
        if let Err(e) = tauri_plugin_opener::reveal_item_in_dir(&path) {
            log::warn!("无法在文件管理器中显示导出文件: {e}");
        }
        Ok(Some(path.display().to_string()))
    })
    .await
    .map_err(|e| AppError::msg(e.to_string()))?
}

/// Lets the user pick the folder and name with the system save panel, starting in `fallback`.
#[cfg(target_os = "macos")]
fn choose_export_path(app: &AppHandle, fallback: &std::path::Path, name: &str) -> AppResult<Option<std::path::PathBuf>> {
    let (directory, name) = (fallback.to_string_lossy().into_owned(), name.to_string());
    crate::native::on_main(app, move |mtm| {
        use objc2_app_kit::{NSModalResponseOK, NSSavePanel};
        use objc2_foundation::{NSString, NSURL};
        let panel = NSSavePanel::savePanel(mtm);
        panel.setNameFieldStringValue(&NSString::from_str(&name));
        panel.setCanCreateDirectories(true);
        panel.setExtensionHidden(false);
        panel.setDirectoryURL(Some(&NSURL::fileURLWithPath(&NSString::from_str(&directory))));
        if panel.runModal() != NSModalResponseOK {
            return Ok(None);
        }
        Ok(panel.URL().and_then(|url| url.path()).map(|path| std::path::PathBuf::from(path.to_string())))
    })
}

#[cfg(not(target_os = "macos"))]
fn choose_export_path(_app: &AppHandle, fallback: &std::path::Path, name: &str) -> AppResult<Option<std::path::PathBuf>> {
    Ok(Some(unique_path(fallback, name)))
}

fn sanitize_file_name(name: &str) -> String {
    let clean: String = name
        .trim()
        .chars()
        .map(|c| if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control() { '_' } else { c })
        .collect();
    if clean.trim_matches('.').is_empty() { "export.csv".into() } else { clean }
}

/// `name.csv`, then `name (2).csv`, `name (3).csv`… until the file does not exist.
#[cfg_attr(target_os = "macos", allow(dead_code))]
fn unique_path(dir: &std::path::Path, name: &str) -> std::path::PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s, format!(".{e}")),
        _ => (name, String::new()),
    };
    (2..)
        .map(|i| dir.join(format!("{stem} ({i}){ext}")))
        .find(|p| !p.exists())
        .expect("unbounded range always yields")
}

#[tauri::command]
pub fn get_stats(state: State<'_, AppState>, offset_minutes: i32) -> AppResult<Stats> {
    state.db.stats(now(), offset_minutes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_names_are_sanitized() {
        assert_eq!(sanitize_file_name("生词/2026:09.csv"), "生词_2026_09.csv");
        assert_eq!(sanitize_file_name(" .. "), "export.csv");
    }

    #[test]
    fn unique_path_never_overwrites() {
        let dir = std::env::temp_dir().join(format!("translatorx-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(unique_path(&dir, "a.csv"), dir.join("a.csv"));
        std::fs::write(dir.join("a.csv"), "").unwrap();
        std::fs::write(dir.join("a (2).csv"), "").unwrap();
        assert_eq!(unique_path(&dir, "a.csv"), dir.join("a (3).csv"));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
