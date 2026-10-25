mod background;
mod commands;
mod db;
mod error;
mod geometry;
mod learning;
mod native;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(any(target_os = "macos", target_os = "windows"))]
mod tracker;
#[cfg(target_os = "windows")]
mod win32;
mod quick;
mod rules;
mod settings;
mod srs;
mod translate;
mod windows;

use std::path::Path;
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};

use crate::commands::AppState;
use crate::error::{AppError, AppResult};

const DB_FILE: &str = "translatorx.db";

/// Shows, unminimizes and focuses the main window.
pub(crate) fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[cfg(desktop)]
pub(crate) fn apply_shortcut(app: &AppHandle, accel: &str) -> AppResult<()> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let gs = app.global_shortcut();
    gs.unregister_all().map_err(|e| AppError::msg(e.to_string()))?;
    if accel.trim().is_empty() {
        return Ok(());
    }
    gs.register(accel.trim())
        .map_err(|e| AppError::user("shortcutRegister", format!("{accel}: {e}")))
}

#[cfg(not(desktop))]
pub(crate) fn apply_shortcut(_app: &AppHandle, _accel: &str) -> AppResult<()> {
    Ok(())
}

/// Builds before 0.1.0 used Tauri's placeholder identifier `com.tauri.dev`, so their data lives
/// in a sibling directory. Copy it over once so renaming the identifier does not lose anything.
fn migrate_legacy_data(dir: &Path) {
    let Some(old) = dir.parent().map(|p| p.join("com.tauri.dev")) else { return };
    if old == dir || dir.join(DB_FILE).exists() || !old.join(DB_FILE).exists() {
        return;
    }
    for name in [DB_FILE, "translatorx.db-wal", "translatorx.db-shm"] {
        let from = old.join(name);
        if from.exists() {
            if let Err(e) = std::fs::copy(&from, dir.join(name)) {
                log::warn!("迁移旧数据 {} 失败: {e}", from.display());
            }
        }
    }
}

/// A tray icon keeps the app reachable after its window is closed (hidden).
#[cfg(desktop)]
fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let settings = app.state::<AppState>().db.settings().unwrap_or_default();
    let quick = MenuItem::with_id(app, "quick", native::text(&settings, "tray.quick"), true, None::<&str>)?;
    let show = MenuItem::with_id(app, "show", native::text(&settings, "tray.show"), true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", native::text(&settings, "tray.quit"), true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&quick, &show, &sep, &quit])?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("TranslatorX")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id.as_ref() {
            "quick" => quick::open_mini(app, None),
            "show" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, e| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            // Release builds keep warnings in the log directory so startup problems stay traceable.
            tauri_plugin_log::Builder::default()
                .level(if cfg!(debug_assertions) { log::LevelFilter::Info } else { log::LevelFilter::Warn })
                .build(),
        )
        .manage(quick::QuickState::default())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            // Native smoke tests can use disposable data without touching the user's library.
            #[cfg(debug_assertions)]
            let dir = std::env::var_os("TRANSLATORX_TEST_DATA_DIR").map(std::path::PathBuf::from).unwrap_or(dir);
            std::fs::create_dir_all(&dir)?;
            migrate_legacy_data(&dir);
            let db = db::Db::open(&dir.join(DB_FILE))?;
            let settings = db.settings().unwrap_or_default();
            app.manage(AppState { db, warnings: Mutex::new(Vec::new()) });

            #[cfg(any(target_os = "macos", target_os = "windows"))]
            tracker::Tracker::start(app.handle(), &settings);

            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::ShortcutState;
                app.handle().plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_handler(|app, _shortcut, event| {
                            if event.state() == ShortcutState::Pressed {
                                quick::toggle_mini(app);
                            }
                        })
                        .build(),
                )?;
                // A taken shortcut should not stop the app from starting; the UI shows it on launch.
                if let Err(e) = apply_shortcut(app.handle(), &settings.shortcut) {
                    log::warn!("{e}");
                    app.state::<AppState>().warn(native::error_text(&settings, &e));
                }
                if let Err(e) = windows::create(app.handle(), &settings) {
                    log::warn!("快速翻译窗口创建失败: {e}");
                    app.state::<AppState>().warn(native::text(&settings, "errors.quickWindow").replace("{detail}", &e.to_string()));
                }
                if let Err(e) = build_tray(app) {
                    log::warn!("托盘图标创建失败: {e}");
                }
                if let Err(e) = native::apply(app.handle(), &settings) {
                    log::warn!("Native settings: {e}");
                    app.state::<AppState>().warn(native::error_text(&settings, &e));
                }
                windows::apply_initial(app.handle(), &settings);
                app.on_menu_event(|app, e| quick::handle_menu(app, e.id().as_ref()));
            }
            Ok(())
        })
        .on_window_event(|window, event| match event {
            // Closing only hides the windows so the shortcut and tray can bring them back.
            tauri::WindowEvent::CloseRequested { api, .. } if cfg!(desktop) => match window.label() {
                "main" => {
                    api.prevent_close();
                    let _ = window.hide();
                }
                windows::MINI => {
                    api.prevent_close();
                    quick::hide_mini(window.app_handle());
                }
                _ => {}
            },
            tauri::WindowEvent::Moved(pos) if window.label() == windows::MINI => {
                quick::on_mini_moved(window.app_handle(), *pos, window.scale_factor().unwrap_or(1.0));
            }
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            tauri::WindowEvent::Focused(true) if window.label() == "main" => {
                let _ = window.app_handle().emit("ax-status", tracker::trusted());
                if let Some(state) = window.app_handle().try_state::<AppState>() {
                    if let Ok(settings) = state.db.settings() { let _ = native::refresh_menus(window.app_handle(), &settings); }
                }
                if let Some(t) = window.app_handle().try_state::<tracker::Tracker>() {
                    t.hide_bubble(window.app_handle());
                }
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            native::system_locale,
            native::ax_diagnostics,
            commands::get_settings,
            commands::save_settings,
            commands::patch_settings,
            commands::get_background_image,
            commands::save_background_image,
            commands::clear_background_image,
            commands::take_warnings,
            commands::pause_shortcut,
            commands::prepare_session,
            commands::translate_texts,
            commands::lookup_word,
            commands::ai_review,
            commands::explain_sentence,
            commands::ask_tutor,
            commands::speak,
            commands::test_connection,
            commands::add_word,
            commands::list_words,
            commands::update_word,
            commands::add_sentence,
            commands::list_sentences,
            commands::update_sentence_note,
            commands::delete_item,
            commands::due_items,
            commands::review_item,
            commands::add_session,
            commands::list_sessions,
            commands::delete_session,
            commands::get_stats,
            commands::list_activities,
            commands::activity_metrics,
            commands::delete_activity,
            commands::export_file,
            quick::mini_insert,
            quick::mini_fit,
            quick::mini_hide,
            quick::mini_dragged,
            quick::mini_target,
            quick::bubble_click,
            quick::bubble_menu,
            quick::ax_status,
            quick::ax_request,
            quick::open_in_main,
        ])
        .build(tauri::generate_context!())
        .expect("error while running TranslatorX")
        .run(|app, event| match event {
            // Clicking the Dock icon brings the hidden window back.
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => show_main(app),
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Exit => {
                if let Some(t) = app.try_state::<tracker::Tracker>() {
                    t.restore_enhanced();
                }
            }
            _ => {
                let _ = app;
            }
        });
}
