//! Opening, placing and closing the quick-translate window, and the commands behind it and
//! the bubble.

use std::sync::{Mutex, MutexGuard};

use serde::Serialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, PhysicalPosition, State};

use crate::commands::AppState;
use crate::error::{AppError, AppResult};
use crate::geometry::{self, Edge, Rect};
use crate::settings::BlockedApp;
use crate::windows::{self, BUBBLE, MINI};

#[cfg(any(target_os = "macos", target_os = "windows"))]
use crate::tracker::Tracker;

/// The app the quick window inserts into.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TargetInfo {
    pub app: String,
    pub bundle_id: String,
}

/// `kind` is "pasted" or "copied"; `reason` says why it fell back to copying:
/// "permission" | "no-target" | "activate" | "unsupported".
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InsertOutcome {
    pub kind: &'static str,
    pub app: Option<String>,
    pub reason: Option<&'static str>,
}

#[derive(Clone, Serialize)]
struct Shown {
    target: Option<TargetInfo>,
}

#[derive(Clone, Serialize)]
struct Draft {
    text: String,
    from: String,
    to: String,
}

struct Placement {
    frame: Rect,
    /// The edge that stays put when the content grows.
    edge: Edge,
    /// Dragged by the user while pinned: keep that spot instead of following the input.
    user_moved: bool,
}

pub struct QuickState(Mutex<Placement>);

impl Default for QuickState {
    fn default() -> Self {
        Self(Mutex::new(Placement {
            frame: Rect::new(0.0, 0.0, geometry::MINI_W, geometry::MINI_MIN_H),
            edge: Edge::Top,
            user_moved: false,
        }))
    }
}

impl QuickState {
    fn lock(&self) -> MutexGuard<'_, Placement> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Where the window goes when it opens next to `anchor` (or by `cursor` without one), or
    /// `None` when the user dragged the pinned window somewhere and it stays there.
    fn plan_open(&self, anchor: Option<Rect>, keep_user_spot: bool, screens: &[Rect], cursor: (f64, f64)) -> Option<Rect> {
        let mut p = self.lock();
        if p.user_moved && keep_user_spot {
            return None;
        }
        let h = p.frame.h;
        let (frame, edge) = match anchor {
            Some(a) => geometry::place_at_anchor(a, h, geometry::screen_for(a.center(), screens)),
            None => (geometry::place_at_cursor(cursor, h, geometry::screen_for(cursor, screens)), Edge::Top),
        };
        p.edge = edge;
        p.user_moved = false;
        p.frame = frame;
        Some(frame)
    }

    /// The frame for a content height of `height`, or `None` when the window already has it.
    fn plan_fit(&self, height: f64, screens: &[Rect]) -> Option<Rect> {
        let mut p = self.lock();
        let f = geometry::refit(p.frame, p.edge, height, geometry::screen_for(p.frame.center(), screens));
        let moved = |a: f64, b: f64| (a - b).abs() >= 0.5;
        if moved(f.h, p.frame.h) || moved(f.y, p.frame.y) || moved(f.x, p.frame.x) {
            p.frame = f;
            Some(f)
        } else {
            None
        }
    }

    /// Remembers where the window ended up. Windows delivers the `Moved` event synchronously
    /// from inside `set_position`, on the thread that called it, so this must never wait for
    /// the lock: a held lock means a placement is being applied right now and already knows
    /// the position, and waiting for it would deadlock the event loop.
    fn record_move(&self, x: f64, y: f64) -> bool {
        let mut p = match self.0.try_lock() {
            Ok(p) => p,
            Err(std::sync::TryLockError::Poisoned(e)) => e.into_inner(),
            Err(std::sync::TryLockError::WouldBlock) => return false,
        };
        p.frame.x = x;
        p.frame.y = y;
        true
    }
}

fn pinned(app: &AppHandle) -> bool {
    app.state::<AppState>().db.settings().map(|s| s.mini.pinned).unwrap_or(false)
}

/// Native window calls can dispatch window events synchronously (Windows does, from inside
/// `set_position`), so the placement lock must already be released when they run: callers plan
/// the frame under the lock and apply it afterwards.
fn apply_frame(w: &tauri::WebviewWindow, f: Rect) {
    let _ = w.set_size(LogicalSize::new(f.w, f.h));
    let _ = w.set_position(LogicalPosition::new(f.x, f.y));
}

fn target_info(app: &AppHandle) -> Option<TargetInfo> {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    return app.try_state::<Tracker>().and_then(|t| t.target_info());
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = app;
        None
    }
}

fn set_mini_visible(app: &AppHandle, visible: bool) {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    if let Some(t) = app.try_state::<Tracker>() {
        t.set_mini_visible(app, visible);
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let _ = (app, visible);
}

/// Shows the quick window next to `anchor` (an input box), or by the mouse without one.
pub fn open_mini(app: &AppHandle, anchor: Option<Rect>) {
    let Some(w) = app.get_webview_window(MINI) else { return };
    let keep_user_spot = pinned(app);
    let screens = windows::screens(app);
    let cursor = windows::cursor(app);
    if let Some(frame) = app.state::<QuickState>().plan_open(anchor, keep_user_spot, &screens, cursor) {
        apply_frame(&w, frame);
    }
    set_mini_visible(app, true);
    let _ = w.show();
    let _ = w.set_focus();
    let _ = app.emit_to(MINI, "mini-shown", Shown { target: target_info(app) });
}

pub fn hide_mini(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(MINI) {
        let _ = w.hide();
    }
    set_mini_visible(app, false);
}

/// The global shortcut: hide the window if it is in front, otherwise open it by the input
/// the user is typing in right now.
pub fn toggle_mini(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(MINI) {
        if w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false) {
            hide_mini(app);
            return;
        }
    }
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    let anchor = app.try_state::<Tracker>().and_then(|t| t.anchor_now());
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let anchor = None;
    open_mini(app, anchor);
}

pub fn on_mini_moved(app: &AppHandle, pos: PhysicalPosition<i32>, scale: f64) {
    app.state::<QuickState>().record_move(pos.x as f64 / scale, pos.y as f64 / scale);
}

// ---------------------------------------------------------------- commands

#[tauri::command]
pub fn mini_fit(app: AppHandle, state: State<'_, QuickState>, height: f64) {
    let Some(w) = app.get_webview_window(MINI) else { return };
    let screens = windows::screens(&app);
    if let Some(f) = state.plan_fit(height, &screens) {
        apply_frame(&w, f);
    }
}

#[tauri::command]
pub fn mini_hide(app: AppHandle) {
    hide_mini(&app);
}

/// The user grabbed the window by its title area; from now on it grows downwards from there.
#[tauri::command]
pub fn mini_dragged(state: State<'_, QuickState>) {
    let mut p = state.lock();
    p.user_moved = true;
    p.edge = Edge::Top;
}

#[tauri::command]
pub fn mini_target(app: AppHandle) -> Option<TargetInfo> {
    target_info(&app)
}

#[tauri::command]
pub async fn mini_insert(app: AppHandle, text: String, keep_open: bool) -> AppResult<InsertOutcome> {
    tauri::async_runtime::spawn_blocking(move || insert(&app, &text, keep_open))
        .await
        .map_err(|e| AppError::msg(e.to_string()))?
}

fn copy(app: &AppHandle, text: &str) -> AppResult<()> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard().write_text(text.to_string()).map_err(|e| AppError::msg(format!("复制失败: {e}")))
}

fn copied(app: Option<String>, reason: &'static str) -> InsertOutcome {
    InsertOutcome { kind: "copied", app, reason: Some(reason) }
}

fn insert(app: &AppHandle, text: &str, keep_open: bool) -> AppResult<InsertOutcome> {
    #[cfg(target_os = "macos")]
    {
        use crate::macos::{ax, insert};
        if !ax::trusted() {
            copy(app, text)?;
            return Ok(copied(None, "permission"));
        }
        let Some(t) = app.try_state::<Tracker>().and_then(|tr| tr.target()) else {
            copy(app, text)?;
            return Ok(copied(None, "no-target"));
        };
        // Hidden only once the target app is in front, so a failure still shows its notice.
        let hide = || {
            if !keep_open {
                hide_mini(app);
            }
        };
        return Ok(match insert::paste(app, text, t.pid, &t.element, hide) {
            Ok(()) => InsertOutcome { kind: "pasted", app: Some(t.app), reason: None },
            Err(()) => copied(Some(t.app), "activate"),
        });
    }
    #[cfg(target_os = "windows")]
    {
        use crate::win32::insert;
        let Some(t) = app.try_state::<Tracker>().and_then(|tr| tr.target()) else {
            copy(app, text)?;
            return Ok(copied(None, "no-target"));
        };
        // Hidden only once the target app is in front, so a failure still shows its notice.
        let hide = || {
            if !keep_open {
                hide_mini(app);
            }
        };
        return Ok(match insert::paste(app, text, t.pid, t.hwnd, &t.element, hide) {
            Ok(()) => InsertOutcome { kind: "pasted", app: Some(t.app), reason: None },
            Err(()) => copied(Some(t.app), "activate"),
        });
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = keep_open;
        copy(app, text)?;
        Ok(copied(None, "unsupported"))
    }
}

#[tauri::command]
pub fn bubble_click(app: AppHandle) {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    let anchor = app.try_state::<Tracker>().and_then(|t| t.target_frame());
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let anchor = None;
    open_mini(&app, anchor);
}

#[tauri::command]
pub fn bubble_menu(app: AppHandle) -> AppResult<()> {
    let Some(bubble) = app.get_webview_window(BUBBLE) else { return Ok(()) };
    let e = |e: tauri::Error| AppError::msg(e.to_string());
    let s = app.state::<AppState>().db.settings()?;
    let hide_label = match target_info(&app).map(|t| t.app).filter(|n| !n.is_empty()) {
        Some(name) => crate::native::text(&s, "bubble.disableApp").replace("{app}", &name),
        None => crate::native::text(&s, "bubble.disableApp").replace("{app}", "…"),
    };
    let hide = MenuItem::with_id(&app, "bubble-hide-app", hide_label, true, None::<&str>).map_err(e)?;
    let off = MenuItem::with_id(&app, "bubble-off", crate::native::text(&s,"bubble.disable"), true, None::<&str>).map_err(e)?;
    let sep = PredefinedMenuItem::separator(&app).map_err(e)?;
    let settings = MenuItem::with_id(&app, "bubble-settings", crate::native::text(&s,"bubble.settings"), true, None::<&str>).map_err(e)?;
    let menu = Menu::with_items(&app, &[&hide, &off, &sep, &settings]).map_err(e)?;
    bubble.popup_menu(&menu).map_err(e)
}

/// Items of the bubble's context menu.
pub fn handle_menu(app: &AppHandle, id: &str) {
    let state = app.state::<AppState>();
    let Ok(old) = state.db.settings() else { return };
    let mut next = old.clone();
    match id {
        "bubble-hide-app" => {
            let Some(t) = target_info(app) else { return };
            if t.bundle_id.is_empty() || crate::rules::is_blocked(&t.bundle_id, &next.bubble_blocklist) {
                return;
            }
            let name = if t.app.is_empty() { t.bundle_id.clone() } else { t.app };
            next.bubble_blocklist.push(BlockedApp { id: t.bundle_id, name });
        }
        "bubble-off" => next.bubble = false,
        "bubble-settings" => {
            crate::show_main(app);
            let _ = app.emit_to("main", "open-settings", ());
            return;
        }
        _ => return,
    }
    if let Err(e) = crate::commands::store_settings(app, &state, next) {
        log::warn!("保存设置失败: {e}");
    }
}

#[tauri::command]
pub fn ax_status() -> bool {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    return crate::tracker::trusted();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    false
}

/// Shows the system prompt and opens Privacy & Security → Accessibility.
#[tauri::command]
pub fn ax_request(app: AppHandle) -> AppResult<()> {
    #[cfg(target_os = "macos")]
    {
        use tauri_plugin_opener::OpenerExt;
        crate::macos::ax::prompt();
        let url = "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";
        app.opener().open_url(url, None::<&str>)
            .map_err(|e| AppError::user("systemSettings", e.to_string()))?;
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
    Ok(())
}

/// Continues a draft in the main window, with the full practice flow.
#[tauri::command]
pub fn open_in_main(app: AppHandle, text: String, from: String, to: String) {
    hide_mini(&app);
    crate::show_main(&app);
    let _ = app.emit_to("main", "load-draft", Draft { text, from, to });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    const SCREEN: Rect = Rect { x: 0.0, y: 0.0, w: 1920.0, h: 1040.0 };

    #[test]
    fn fit_moves_the_window_inside_the_margins_and_ignores_sub_pixel_changes() {
        let state = QuickState::default();
        let first = state.plan_fit(200.0, &[SCREEN]).expect("the first fit places the window");
        assert_eq!((first.x, first.y, first.w, first.h), (8.0, 8.0, geometry::MINI_W, 200.0));
        assert!(state.plan_fit(200.0, &[SCREEN]).is_none(), "the same height must not touch the window");
        assert!(state.plan_fit(200.3, &[SCREEN]).is_none(), "sub-pixel changes must not touch the window");
        assert_eq!(state.plan_fit(260.0, &[SCREEN]).map(|f| f.h), Some(260.0));
        assert!(state.0.try_lock().is_ok(), "planning must release the lock before the native call");
    }

    #[test]
    fn open_keeps_a_pinned_window_where_the_user_dragged_it() {
        let state = QuickState::default();
        let anchor = Rect::new(600.0, 200.0, 500.0, 40.0);
        let placed = state.plan_open(Some(anchor), true, &[SCREEN], (0.0, 0.0)).expect("the first open places the window");
        assert_eq!(placed.right(), anchor.right());
        state.lock().user_moved = true;
        assert!(state.plan_open(Some(anchor), true, &[SCREEN], (0.0, 0.0)).is_none());
        assert!(state.plan_open(Some(anchor), false, &[SCREEN], (0.0, 0.0)).is_some(), "an unpinned window follows the input again");
        assert!(!state.lock().user_moved);
    }

    /// Windows delivers `Moved` synchronously from inside `set_position`: the handler has to
    /// return at once while a placement is being applied instead of waiting for the lock.
    #[test]
    fn recording_a_move_never_waits_for_a_held_lock() {
        let state = Arc::new(QuickState::default());
        let guard = state.lock();
        let worker = {
            let state = Arc::clone(&state);
            std::thread::spawn(move || state.record_move(10.0, 20.0))
        };
        let started = Instant::now();
        while !worker.is_finished() {
            assert!(started.elapsed() < Duration::from_secs(5), "record_move blocked on the held placement lock");
            std::thread::sleep(Duration::from_millis(5));
        }
        assert!(!worker.join().unwrap(), "a held lock means the move is skipped, not waited for");
        drop(guard);
        assert!(state.record_move(10.0, 20.0));
        let p = state.lock();
        assert_eq!((p.frame.x, p.frame.y), (10.0, 20.0));
    }
}
