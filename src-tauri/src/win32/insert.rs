//! Inserting text into another app: put it on the clipboard, bring the app back, press
//! Ctrl+V, then give the user their previous clipboard back.

use std::thread::sleep;
use std::time::{Duration, Instant};

use tauri::AppHandle;
use tauri_plugin_clipboard_manager::ClipboardExt;
use windows::Win32::Foundation::HWND;
use windows::Win32::System::DataExchange::GetClipboardSequenceNumber;
use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, VIRTUAL_KEY, VK_CONTROL, VK_V,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetWindowThreadProcessId, IsIconic, SetForegroundWindow, ShowWindow, SW_RESTORE,
};

use super::uia::{self, Element};

const ACTIVATE_TIMEOUT: Duration = Duration::from_millis(1000);
/// How long apps get to read the clipboard before it is restored.
const RESTORE_AFTER: Duration = Duration::from_millis(500);

/// What the clipboard held before the insert: its text, or else its image.
enum Saved {
    Text(String),
    Image { rgba: Vec<u8>, width: u32, height: u32 },
    Nothing,
}

fn save(app: &AppHandle) -> Saved {
    let clipboard = app.clipboard();
    if let Ok(text) = clipboard.read_text() {
        return Saved::Text(text);
    }
    match clipboard.read_image() {
        Ok(image) => Saved::Image { rgba: image.rgba().to_vec(), width: image.width(), height: image.height() },
        Err(_) => Saved::Nothing,
    }
}

fn restore(app: &AppHandle, saved: Saved) {
    let clipboard = app.clipboard();
    let _ = clipboard.clear();
    match saved {
        Saved::Text(text) => {
            let _ = clipboard.write_text(text);
        }
        Saved::Image { rgba, width, height } => {
            let _ = clipboard.write_image(&tauri::image::Image::new_owned(rgba, width, height));
        }
        Saved::Nothing => {}
    }
}

fn key(vk: VIRTUAL_KEY, flags: KEYBD_EVENT_FLAGS) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: vk, wScan: 0, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
    }
}

fn press_ctrl_v() -> Result<(), ()> {
    let down = KEYBD_EVENT_FLAGS(0);
    let inputs = [key(VK_CONTROL, down), key(VK_V, down), key(VK_V, KEYEVENTF_KEYUP), key(VK_CONTROL, KEYEVENTF_KEYUP)];
    let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
    if sent == inputs.len() as u32 { Ok(()) } else { Err(()) }
}

/// Brings `hwnd` to the foreground. Windows only grants this to the process the user last
/// interacted with; the bubble click or the hotkey normally makes that us, and attaching to
/// the target's input queue covers the rest.
fn activate(hwnd: HWND) -> bool {
    if unsafe { IsIconic(hwnd) }.as_bool() {
        let _ = unsafe { ShowWindow(hwnd, SW_RESTORE) };
    }
    if unsafe { SetForegroundWindow(hwnd) }.as_bool() {
        return true;
    }
    let target = unsafe { GetWindowThreadProcessId(hwnd, None) };
    let current = unsafe { GetCurrentThreadId() };
    if target == 0 || target == current || !unsafe { AttachThreadInput(current, target, true) }.as_bool() {
        return false;
    }
    let ok = unsafe { SetForegroundWindow(hwnd) }.as_bool();
    let _ = unsafe { AttachThreadInput(current, target, false) };
    ok
}

/// Brings the target window back and pastes `text` into `element`. `before_paste` runs once
/// the app is in front (the caller hides the quick window there). On error the text is left
/// on the clipboard so the user can paste it by hand.
pub fn paste(app: &AppHandle, text: &str, pid: i32, hwnd: isize, element: &Element, before_paste: impl FnOnce()) -> Result<(), ()> {
    let hwnd = HWND(hwnd as *mut std::ffi::c_void);
    let saved = save(app);
    app.clipboard().write_text(text.to_string()).map_err(|_| ())?;
    let written = unsafe { GetClipboardSequenceNumber() };

    if !activate(hwnd) {
        return Err(());
    }
    let start = Instant::now();
    while unsafe { GetForegroundWindow() } != hwnd {
        if start.elapsed() > ACTIVATE_TIMEOUT {
            return Err(());
        }
        sleep(Duration::from_millis(20));
    }
    before_paste();

    // Put the caret back into the input if the app moved focus elsewhere meanwhile.
    if uia::focused_element(pid).as_ref() != Some(element) {
        element.focus();
    }
    sleep(Duration::from_millis(80));
    press_ctrl_v()?;

    let app = app.clone();
    std::thread::spawn(move || {
        sleep(RESTORE_AFTER);
        // Leave it alone if anything else has been copied since.
        if unsafe { GetClipboardSequenceNumber() } == written {
            restore(&app, saved);
        }
    });
    Ok(())
}
