//! The quick-translate window and the input-box bubble, and how settings shape them.

use tauri::utils::config::WindowEffectsConfig;
use tauri::window::{Effect, EffectState, EffectsBuilder};
use tauri::{AppHandle, Manager, Theme, WebviewUrl, WebviewWindowBuilder};

use crate::geometry::{self, Rect};
use crate::settings::Settings;

pub const MINI: &str = "mini";
pub const BUBBLE: &str = "bubble";

fn selected_theme(value: &str) -> Option<Theme> {
    match value { "light" => Some(Theme::Light), "dark" => Some(Theme::Dark), _ => None }
}
fn theme(s: &Settings) -> Option<Theme> {
    selected_theme(if s.mini.theme == "inherit" { &s.theme } else { &s.mini.theme })
}

// Tao's macOS builder and set_theme both change NSApplication.appearance.
// Keep the application on system appearance and set each NSWindow instead.
fn builder_theme(theme: Option<Theme>) -> Option<Theme> {
    if cfg!(target_os = "macos") { None } else { theme }
}

fn apply_theme(window: &tauri::WebviewWindow, theme: Option<Theme>) {
    #[cfg(target_os = "macos")]
    {
        let window = window.clone();
        let app = window.app_handle().clone();
        let result = crate::native::on_main(&app, move |_| {
            use objc2_app_kit::{NSAppearance, NSAppearanceCustomization, NSWindow};
            use objc2_foundation::NSString;
            let ptr = window.ns_window().map_err(|e| crate::error::AppError::msg(e.to_string()))?;
            let appearance = theme.and_then(|theme| NSAppearance::appearanceNamed(&NSString::from_str(
                if theme == Theme::Dark { "NSAppearanceNameDarkAqua" } else { "NSAppearanceNameAqua" }
            )));
            // SAFETY: this live window is retained above, and we are on AppKit's main thread.
            unsafe { &*(ptr as *const NSWindow) }.setAppearance(appearance.as_deref());
            Ok(())
        });
        if let Err(error) = result { log::warn!("Window appearance: {error}"); }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = window.set_theme(theme);
}

/// Native frosted glass behind the page. Kept active so a pinned window stays blurred when
/// another app has focus.
fn glass() -> WindowEffectsConfig {
    EffectsBuilder::new().effect(Effect::Popover).state(EffectState::Active).radius(16.0).build()
}

/// Creates both windows hidden, so opening them later is instant.
pub fn create(app: &AppHandle, s: &Settings) -> tauri::Result<()> {
    let mut mini = WebviewWindowBuilder::new(app, MINI, WebviewUrl::App("mini.html".into()))
        .title(crate::native::text(s, "windows.mini"))
        .inner_size(geometry::MINI_W, geometry::MINI_MIN_H)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(true)
        .skip_taskbar(true)
        .always_on_top(s.mini.pinned)
        .visible_on_all_workspaces(s.mini.pinned)
        .visible(false)
        .theme(builder_theme(theme(s)));
    if s.mini.blur {
        mini = mini.effects(glass());
    }
    mini.build()?;

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        let bubble = WebviewWindowBuilder::new(app, BUBBLE, WebviewUrl::App("bubble.html".into()))
            .title("TranslatorX")
            .inner_size(geometry::BUBBLE, geometry::BUBBLE)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .always_on_top(true)
            .visible_on_all_workspaces(true)
            .skip_taskbar(true)
            // On Windows `focusable(false)` becomes WS_EX_NOACTIVATE: clicks never steal focus
            // from the input the bubble belongs to.
            .focusable(false)
            .focused(false)
            .accept_first_mouse(true)
            .visible(false)
            .theme(builder_theme(theme(s)))
            .build()?;
        #[cfg(target_os = "macos")]
        float_above_everything(&bubble);
        #[cfg(target_os = "windows")]
        let _ = bubble;
    }
    Ok(())
}

/// Keeps the bubble above floating windows and full-screen apps, on every Space.
#[cfg(target_os = "macos")]
fn float_above_everything(w: &tauri::WebviewWindow) {
    let Ok(ptr) = w.ns_window() else { return };
    let ptr = ptr as usize;
    let _ = w.run_on_main_thread(move || {
        use objc2_app_kit::{NSStatusWindowLevel, NSWindow, NSWindowCollectionBehavior};
        // SAFETY: the pointer is the live NSWindow of the bubble and we are on the main thread.
        let window = unsafe { &*(ptr as *const NSWindow) };
        window.setCollectionBehavior(
            NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::FullScreenAuxiliary
                | NSWindowCollectionBehavior::Stationary
                | NSWindowCollectionBehavior::IgnoresCycle,
        );
        window.setLevel(NSStatusWindowLevel);
    });
}

#[cfg(any(target_os = "macos", test))]
fn main_effects(s: &Settings) -> Option<WindowEffectsConfig> {
    s.main_appearance.blur.then(|| EffectsBuilder::new().effect(Effect::Sidebar).state(EffectState::Active).build())
}

/// Explicit frost switches are independent of the selected color/material style.
pub fn apply_materials(app: &AppHandle, s: &Settings) -> crate::error::AppResult<()> {
    #[cfg(target_os = "macos")]
    for (label, effects) in [("main", main_effects(s)), (MINI, s.mini.blur.then(glass))] {
        if let Some(window) = app.get_webview_window(label) {
            window.set_effects(effects).map_err(|e| crate::error::AppError::user("materialApply", e.to_string()))?;
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, s);
    Ok(())
}

/// Apply at startup as well as after settings changes; the main window exists before setup.
pub fn apply_initial(app: &AppHandle, s: &Settings) {
    if let Some(w) = app.get_webview_window("main") {
        apply_theme(&w, selected_theme(&s.theme));
    }
    for label in [MINI, BUBBLE] {
        if let Some(w) = app.get_webview_window(label) { apply_theme(&w, theme(s)); }
    }
    if let Err(error) = apply_materials(app, s) { log::warn!("Window material: {error}"); }
}

/// Applies settings to the corresponding window instead of forcing one theme on every window.
pub fn apply(app: &AppHandle, old: &Settings, new: &Settings) {
    if old.theme != new.theme || old.main_style != new.main_style || old.mini.theme != new.mini.theme {
        apply_initial(app, new);
    }
    let Some(mini) = app.get_webview_window(MINI) else { return };
    if old.mini.pinned != new.mini.pinned {
        let _ = mini.set_always_on_top(new.mini.pinned);
        let _ = mini.set_visible_on_all_workspaces(new.mini.pinned);
    }
}

/// Work areas of all screens, in logical top-left coordinates.
pub fn screens(app: &AppHandle) -> Vec<Rect> {
    app.available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| {
            let s = m.scale_factor();
            let a = m.work_area();
            Rect::new(a.position.x as f64 / s, a.position.y as f64 / s, a.size.width as f64 / s, a.size.height as f64 / s)
        })
        .collect()
}

/// Mouse position in logical top-left coordinates (Tauri scales it by the primary monitor).
pub fn cursor(app: &AppHandle) -> (f64, f64) {
    let scale = app.primary_monitor().ok().flatten().map(|m| m.scale_factor()).unwrap_or(1.0);
    app.cursor_position().map(|p| (p.x / scale, p.y / scale)).unwrap_or((400.0, 300.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_frost_preference_is_independent_of_material_style() {
        let mut s = Settings::default();
        for style in ["paper", "glass", "studio"] {
            s.main_style = style.into();
            s.main_appearance.blur = true;
            assert!(main_effects(&s).is_some());
            s.main_appearance.blur = false;
            assert!(main_effects(&s).is_none());
        }
    }

    #[test]
    fn floating_theme_is_independent_and_inherit_follows_main() {
        let mut s = Settings::default();
        for main in ["system", "light", "dark"] {
            s.theme = main.into();
            for floating in ["system", "light", "dark", "inherit"] {
                s.mini.theme = floating.into();
                assert_eq!(selected_theme(&s.theme), selected_theme(main));
                assert_eq!(theme(&s), selected_theme(if floating == "inherit" { main } else { floating }));
            }
        }
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn macos_builder_never_overrides_application_appearance() {
        assert_eq!(builder_theme(Some(Theme::Dark)), None);
        assert_eq!(builder_theme(Some(Theme::Light)), None);
        assert_eq!(builder_theme(None), None);
    }
}
