//! Inserting text into another app: put it on the pasteboard, bring the app back, press ⌘V,
//! then give the user their previous clipboard back.

use std::thread::sleep;
use std::time::{Duration, Instant};

use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation, CGKeyCode};
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2_app_kit::{NSPasteboard, NSPasteboardItem, NSPasteboardTypeString, NSPasteboardWriting};
use objc2_foundation::{NSArray, NSData, NSString};
use tauri::AppHandle;

use super::apps;
use super::ax::Element;

/// `kVK_ANSI_V`.
const KEY_V: CGKeyCode = 9;
const ACTIVATE_TIMEOUT: Duration = Duration::from_millis(1000);
/// How long apps get to read the pasteboard before it is restored.
const RESTORE_AFTER: Duration = Duration::from_millis(500);

/// Every item on the pasteboard as (type, data) pairs.
type Saved = Vec<Vec<(String, Vec<u8>)>>;

fn save(pb: &NSPasteboard) -> Saved {
    let Some(items) = pb.pasteboardItems() else { return Vec::new() };
    items
        .iter()
        .map(|item| item.types().iter().filter_map(|t| item.dataForType(&t).map(|d| (t.to_string(), d.to_vec()))).collect())
        .collect()
}

fn restore(pb: &NSPasteboard, saved: &Saved) {
    pb.clearContents();
    if saved.is_empty() {
        return;
    }
    let items: Vec<Retained<ProtocolObject<dyn NSPasteboardWriting>>> = saved
        .iter()
        .map(|types| {
            let item = NSPasteboardItem::new();
            for (t, d) in types {
                item.setData_forType(&NSData::with_bytes(d), &NSString::from_str(t));
            }
            ProtocolObject::from_retained(item)
        })
        .collect();
    pb.writeObjects(&NSArray::from_retained_slice(&items));
}

fn write_text(pb: &NSPasteboard, text: &str) -> isize {
    pb.clearContents();
    pb.setString_forType(&NSString::from_str(text), unsafe { NSPasteboardTypeString });
    pb.changeCount()
}

fn press_cmd_v() -> Result<(), ()> {
    for down in [true, false] {
        let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState)?;
        let event = CGEvent::new_keyboard_event(source, KEY_V, down)?;
        event.set_flags(CGEventFlags::CGEventFlagCommand);
        event.post(CGEventTapLocation::HID);
    }
    Ok(())
}

/// Brings `pid` back and pastes `text` into its focused input. `before_paste` runs once the
/// app is in front (the caller hides the quick window there). On error the text is left on
/// the pasteboard so the user can paste it by hand.
pub fn paste(app: &AppHandle, text: &str, pid: i32, element: &Element, before_paste: impl FnOnce()) -> Result<(), ()> {
    let pb = NSPasteboard::generalPasteboard();
    let saved = save(&pb);
    let count = write_text(&pb, text);

    let system = Element::system_wide().ok_or(())?;
    apps::activate(app, pid);
    let start = Instant::now();
    let mut nudged = false;
    while apps::frontmost_pid(&system) != Some(pid) {
        if start.elapsed() > ACTIVATE_TIMEOUT {
            return Err(());
        }
        // Some apps ignore NSRunningApplication activation; the accessibility API still works.
        if !nudged && start.elapsed() > Duration::from_millis(400) {
            if let Some(a) = Element::application(pid) {
                a.set_bool("AXFrontmost", true);
            }
            nudged = true;
        }
        sleep(Duration::from_millis(20));
    }
    before_paste();

    // Put the caret back into the input if the app moved focus elsewhere meanwhile.
    let focused = Element::application(pid).and_then(|a| a.element("AXFocusedUIElement"));
    if focused.as_ref() != Some(element) {
        element.set_bool("AXFocused", true);
    }
    sleep(Duration::from_millis(80));
    press_cmd_v()?;

    std::thread::spawn(move || {
        sleep(RESTORE_AFTER);
        let pb = NSPasteboard::generalPasteboard();
        // Leave it alone if anything else has been copied since.
        if pb.changeCount() == count {
            restore(&pb, &saved);
        }
    });
    Ok(())
}
