//! Run on a logged-in macOS desktop: cargo run --example native_smoke --offline
//! Exercises production native settings without loading the user's database or requesting AX access.
#![allow(dead_code)]
#[path = "../src/error.rs"] mod error;
#[path = "../src/settings.rs"] mod settings;
#[path = "../src/geometry.rs"] mod geometry;
#[path = "../src/rules.rs"] mod rules;
#[path = "../src/native.rs"] mod native;
#[path = "../src/windows.rs"] mod windows;
#[cfg(target_os = "macos")]
#[path = "../src/macos/ax.rs"] pub mod ax_impl;
#[cfg(target_os = "macos")]
mod macos { pub use crate::ax_impl as ax; }

#[cfg(target_os = "macos")]
fn main() {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy as Policy, NSAppearanceCustomization, NSWindow};
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = "com.translatorx.native-smoke".into();
    context.config_mut().app.windows.clear();
    let app = tauri::Builder::default().setup(|app| {
        for label in ["main", "mini", "bubble"] {
            WebviewWindowBuilder::new(app, label, WebviewUrl::External("about:blank".parse()?))
                .title("TranslatorX native smoke test").transparent(true).visible(false).build()?;
        }
        Ok(())
    }).build(context).expect("build smoke app");
    app.run(|app, event| {
        if !matches!(event, tauri::RunEvent::Ready) { return; }
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let mtm = MainThreadMarker::new().unwrap();
            let ns = NSApplication::sharedApplication(mtm);
            let mut settings = settings::Settings::default();
            settings.show_dock_icon = false;
            assert!(native::apply(app, &settings).is_err(), "hiding without a tray must fail");
            assert_eq!(ns.activationPolicy(), Policy::Regular);
            tauri::tray::TrayIconBuilder::with_id("main").icon(app.default_window_icon().unwrap().clone()).build(app).unwrap();
            for visible in [false, true, false, true, false] {
                settings.show_dock_icon = visible;
                native::apply(app, &settings).unwrap();
                assert_eq!(ns.activationPolicy(), if visible { Policy::Regular } else { Policy::Accessory });
            }
            let main = app.get_webview_window("main").unwrap();
            main.show().unwrap(); main.set_focus().unwrap();
            assert_eq!(ns.activationPolicy(), Policy::Accessory, "opening from tray must not restore Dock");
            for (main_theme, mini_theme) in [("dark", "light"), ("light", "dark"), ("dark", "system")] {
                settings.theme = main_theme.into(); settings.mini.theme = mini_theme.into(); settings.main_style = "glass".into();
                windows::apply_initial(app, &settings);
                for (label, expected) in [("main", main_theme), ("mini", mini_theme), ("bubble", mini_theme)] {
                    let w = app.get_webview_window(label).unwrap();
                    let raw = w.ns_window().unwrap();
                    let appearance = unsafe { &*(raw as *const NSWindow) }.appearance();
                    let name = appearance.map(|a| a.name().to_string());
                    assert_eq!(name.as_deref(), match expected { "dark" => Some("NSAppearanceNameDarkAqua"), "light" => Some("NSAppearanceNameAqua"), _ => None });
                }
                assert!(ns.appearance().is_none(), "window settings must leave application following system");
            }
            settings.show_dock_icon = true;
            native::apply(app, &settings).unwrap();
            main.hide().unwrap(); main.show().unwrap(); main.set_focus().unwrap();
            assert_eq!(ns.activationPolicy(), Policy::Regular);
            println!("PASS: no-tray recovery; rapid Dock toggles; tray window focus; independent native light/dark/system appearance; Dock restore.");
        }));
        app.exit(if result.is_ok() { 0 } else { 1 });
    });
}
#[cfg(not(target_os = "macos"))]
fn main() { eprintln!("This smoke test requires macOS."); }
