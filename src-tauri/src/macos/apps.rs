//! Running applications: names for the UI, and handing focus back to the app we insert into.

use objc2::runtime::NSObjectProtocol;
use objc2::sel;
use objc2_app_kit::{NSApplication, NSApplicationActivationOptions, NSRunningApplication};
use objc2_foundation::MainThreadMarker;
use tauri::AppHandle;

use super::ax::Element;

/// Bundle identifier and localized name of a running app.
pub fn app_info(pid: i32) -> Option<(String, String)> {
    let app = NSRunningApplication::runningApplicationWithProcessIdentifier(pid)?;
    let id = app.bundleIdentifier().map(|s| s.to_string()).unwrap_or_default();
    let name = app.localizedName().map(|s| s.to_string()).unwrap_or_default();
    Some((id, name))
}

pub fn is_running(pid: i32) -> bool {
    NSRunningApplication::runningApplicationWithProcessIdentifier(pid).is_some_and(|a| !a.isTerminated())
}

/// Asks `pid` to come forward. On macOS 14+ activation is cooperative, so we first yield it.
pub fn activate(app: &AppHandle, pid: i32) {
    let _ = app.run_on_main_thread(move || {
        let Some(target) = NSRunningApplication::runningApplicationWithProcessIdentifier(pid) else { return };
        if let Some(mtm) = MainThreadMarker::new() {
            let ns_app = NSApplication::sharedApplication(mtm);
            if ns_app.respondsToSelector(sel!(yieldActivationToApplication:)) {
                ns_app.yieldActivationToApplication(&target);
            }
        }
        target.activateWithOptions(NSApplicationActivationOptions::empty());
    });
}

/// The app that currently has keyboard focus, as the accessibility API sees it.
pub fn frontmost_pid(system: &Element) -> Option<i32> {
    system.element("AXFocusedApplication")?.pid()
}
