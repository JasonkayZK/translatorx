//! Shared UI language, native menus and macOS preferences.
use std::collections::HashMap;
use std::sync::OnceLock;
use serde::Serialize;
use tauri::{AppHandle, Manager};
use crate::{error::{AppError, AppResult}, settings::Settings};

pub fn resolve_locale<'a>(preference: &'a str, system: &str) -> &'a str {
    if matches!(preference, "zh-CN" | "en" | "ja") { return preference; }
    let base = system.trim().split(['-', '_', '.']).next().unwrap_or("").to_ascii_lowercase();
    match base.as_str() { "zh" => "zh-CN", "ja" => "ja", _ => "en" }
}

#[tauri::command]
pub fn system_locale() -> String {
    #[cfg(target_os = "macos")]
    {
        return objc2_foundation::NSLocale::preferredLanguages().firstObject()
            .map(|s| s.to_string()).unwrap_or_else(|| "en".into());
    }
    #[cfg(target_os = "windows")]
    {
        #[link(name = "kernel32")]
        extern "system" { fn GetUserDefaultLocaleName(name: *mut u16, count: i32) -> i32; }
        let mut name = [0u16; 85];
        let n = unsafe { GetUserDefaultLocaleName(name.as_mut_ptr(), name.len() as i32) };
        return if n > 1 { String::from_utf16_lossy(&name[..n as usize - 1]) } else { "en".into() };
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        ["LC_ALL", "LC_MESSAGES", "LANG"].iter().find_map(|key|
            std::env::var(key).ok().filter(|s| !s.is_empty())
        ).unwrap_or_else(|| "en".into())
    }
}

fn catalog(locale: &str) -> &'static HashMap<String, String> {
    static EN: OnceLock<HashMap<String, String>> = OnceLock::new();
    static ZH: OnceLock<HashMap<String, String>> = OnceLock::new();
    static JA: OnceLock<HashMap<String, String>> = OnceLock::new();
    let (slot, source) = match locale {
        "zh-CN" => (&ZH, include_str!("../../src/locales/zh-CN.json")),
        "ja" => (&JA, include_str!("../../src/locales/ja.json")),
        _ => (&EN, include_str!("../../src/locales/en.json")),
    };
    slot.get_or_init(|| serde_json::from_str(source).expect("validated translation catalog"))
}

pub fn text(s: &Settings, key: &str) -> String {
    let system = system_locale();
    let locale = resolve_locale(&s.ui_language, &system);
    catalog(locale).get(key).or_else(|| catalog("en").get(key)).cloned().unwrap_or_else(|| key.into())
}

pub fn error_text(s: &Settings, error: &AppError) -> String {
    match error {
        AppError::User { code, detail } => text(s, &format!("errors.{code}")).replace("{detail}", detail),
        _ => error.to_string(),
    }
}

pub fn refresh_menus(app: &AppHandle, s: &Settings) -> AppResult<()> {
    if let Some(tray) = app.tray_by_id("main") {
        use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
        let e = |e: tauri::Error| AppError::msg(e.to_string());
        let quick = MenuItem::with_id(app, "quick", text(s,"tray.quick"), true, None::<&str>).map_err(e)?;
        let show = MenuItem::with_id(app, "show", text(s,"tray.show"), true, None::<&str>).map_err(e)?;
        let quit = MenuItem::with_id(app, "quit", text(s,"tray.quit"), true, None::<&str>).map_err(e)?;
        let sep = PredefinedMenuItem::separator(app).map_err(e)?;
        let menu = Menu::with_items(app, &[&quick,&show,&sep,&quit]).map_err(e)?;
        tray.set_menu(Some(menu)).map_err(e)?;
    }
    if let Some(mini) = app.get_webview_window(crate::windows::MINI) {
        mini.set_title(&text(s,"windows.mini")).map_err(|e| AppError::msg(e.to_string()))?;
    }
    Ok(())
}

pub fn apply(app: &AppHandle, s: &Settings) -> AppResult<()> {
    #[cfg(target_os = "macos")]
    {
        let requested = s.show_dock_icon;
        let has_tray = app.tray_by_id("main").is_some();
        on_main(app, move |mtm| {
            use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy as Policy};
            let application = NSApplication::sharedApplication(mtm);
            let action = dock_action(application.activationPolicy() == Policy::Regular, requested, has_tray);
            // Tao's Dock API silently drops a hide within one second of a show. AppKit's
            // activation policy has no delayed work and also preserves accessory windows.
            if action != DockAction::Keep {
                let policy = if action == DockAction::Hide { Policy::Accessory } else { Policy::Regular };
                if !application.setActivationPolicy(policy) {
                    return Err(AppError::user("dockChange", ""));
                }
            }
            if action == DockAction::Recover { return Err(AppError::user("dockUnavailable", "")); }
            Ok(())
        })?;
    }
    refresh_menus(app,s)
}

#[cfg(any(target_os = "macos", test))]
#[derive(Debug, PartialEq)]
enum DockAction { Keep, Show, Hide, Recover }

#[cfg(any(target_os = "macos", test))]
fn dock_action(visible: bool, requested: bool, has_tray: bool) -> DockAction {
    if !requested && !has_tray { DockAction::Recover }
    else if visible == requested { DockAction::Keep }
    else if requested { DockAction::Show }
    else { DockAction::Hide }
}

/// AppKit mutations must finish before we persist and acknowledge the setting.
#[cfg(target_os = "macos")]
pub(crate) fn on_main<T: Send + 'static>(app: &AppHandle, work: impl FnOnce(objc2::MainThreadMarker) -> AppResult<T> + Send + 'static) -> AppResult<T> {
    if let Some(mtm) = objc2::MainThreadMarker::new() { return work(mtm); }
    let (send, receive) = std::sync::mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        let result = work(objc2::MainThreadMarker::new().expect("AppKit main thread"));
        let _ = send.send(result);
    }).map_err(|e| AppError::msg(e.to_string()))?;
    receive.recv().map_err(|e| AppError::msg(e.to_string()))?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessibilityDiagnostics {
    supported: bool,
    trusted: bool,
    executable: String,
    bundle_id: String,
    signature: String,
}

#[tauri::command]
pub async fn ax_diagnostics(app: AppHandle) -> AppResult<AccessibilityDiagnostics> {
    let bundle_id = app.config().identifier.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let executable = std::env::current_exe().map_err(|e| AppError::msg(e.to_string()))?;
        #[cfg(target_os = "macos")]
        let (trusted, signature) = {
            let output = std::process::Command::new("/usr/bin/codesign")
                .args(["-dv", "--verbose=2"]).arg(&executable).output();
            let signature = match output {
                Ok(o) if o.status.success() => {
                    let details = String::from_utf8_lossy(&o.stderr);
                    if details.contains("Signature=adhoc") { "adhoc" }
                    else if details.contains("Authority=") { "certificate" }
                    else { "unknown" }
                }
                Ok(_) => "unsigned",
                Err(_) => "unknown",
            };
            (crate::macos::ax::trusted(), signature.to_string())
        };
        #[cfg(target_os = "windows")]
        let (trusted, signature) = (true, "unsupported".to_string());
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let (trusted, signature) = (false, "unsupported".to_string());
        Ok(AccessibilityDiagnostics {
            supported: cfg!(any(target_os = "macos", target_os = "windows")),
            trusted,
            executable: executable.display().to_string(),
            bundle_id,
            signature,
        })
    }).await.map_err(|e| AppError::msg(e.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dock_changes_follow_the_latest_preference_without_delayed_work() {
        let mut visible = true;
        for requested in [false, true, false, true, false] {
            assert_ne!(dock_action(visible, requested, true), DockAction::Keep);
            visible = requested;
            assert_eq!(dock_action(visible, requested, true), DockAction::Keep);
        }
        assert!(!visible);
    }
    #[test]
    fn dock_cannot_be_hidden_without_a_tray() {
        assert_eq!(dock_action(true, false, false), DockAction::Recover);
        assert_eq!(dock_action(false, false, false), DockAction::Recover);
        assert_eq!(dock_action(false, true, false), DockAction::Show);
    }
    #[test]
    fn native_locale_matches_frontend_policy() {
        assert_eq!(resolve_locale("system","zh-Hant-TW"),"zh-CN");
        assert_eq!(resolve_locale("system","ja_JP.UTF-8"),"ja");
        assert_eq!(resolve_locale("system","de-DE"),"en");
        assert_eq!(resolve_locale("ja","en-US"),"ja");
    }
    #[test]
    fn all_native_labels_have_translations() {
        for locale in ["en","zh-CN","ja"] {
            for key in ["tray.quick","tray.show","tray.quit","windows.mini","bubble.disableApp","bubble.disable","bubble.settings"] {
                assert!(!catalog(locale).get(key).unwrap_or_else(|| panic!("Missing {locale}/{key}")).is_empty());
            }
        }
    }

    #[test]
    fn startup_dock_failure_has_localized_recovery_text() {
        for locale in ["en", "zh-CN", "ja"] {
            let mut settings = Settings::default();
            settings.ui_language = locale.into();
            let message = error_text(&settings, &AppError::user("dockUnavailable", ""));
            assert_eq!(message, catalog(locale)["errors.dockUnavailable"]);
            assert!(!message.contains("dockUnavailable"));
        }
    }
}
