//! Minimal UI Automation bindings: the focused text input of another app, where it is on
//! screen, and how to put focus back into it. UIA is COM; every thread that calls in here
//! joins the multithreaded apartment, so element handles may be shared between the tracker
//! thread and the paste thread.

use std::cell::OnceCell;

use windows::core::{Interface, IUnknown, BOOL, BSTR};
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED};
use windows::Win32::UI::Accessibility::{
    CUIAutomation8, IUIAutomation2, IUIAutomationElement, IUIAutomationValuePattern, UIA_ValuePatternId,
};
use windows::Win32::UI::HiDpi::{GetDpiForSystem, GetDpiForWindow};
use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;

use crate::geometry::Rect;
use crate::rules;

/// Bounds on cross-process calls, so a hung app cannot stall the tracker for long.
const CONNECTION_TIMEOUT_MS: u32 = 500;
const TRANSACTION_TIMEOUT_MS: u32 = 1000;

thread_local! {
    static AUTOMATION: OnceCell<IUIAutomation2> = const { OnceCell::new() };
}

/// This thread's UIA client, created on first use.
fn automation() -> Option<IUIAutomation2> {
    AUTOMATION.with(|cell| {
        if let Some(existing) = cell.get() {
            return Some(existing.clone());
        }
        // S_FALSE (already initialized) and RPC_E_CHANGED_MODE (an STA thread) both leave COM usable.
        let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        let created: IUIAutomation2 =
            unsafe { CoCreateInstance(&CUIAutomation8, None::<&IUnknown>, CLSCTX_INPROC_SERVER) }.ok()?;
        unsafe {
            let _ = created.SetConnectionTimeout(CONNECTION_TIMEOUT_MS);
            let _ = created.SetTransactionTimeout(TRANSACTION_TIMEOUT_MS);
        }
        let _ = cell.set(created.clone());
        Some(created)
    })
}

/// The element with keyboard focus, when it belongs to `pid`.
pub fn focused_element(pid: i32) -> Option<Element> {
    let automation = automation()?;
    let element = unsafe { automation.GetFocusedElement() }.ok()?;
    let owner = unsafe { element.CurrentProcessId() }.ok()?;
    (owner == pid).then_some(Element(element))
}

/// A UI element of some app. Equality compares the underlying element, so the same text
/// field polled twice is equal.
#[derive(Clone)]
pub struct Element(IUIAutomationElement);

// Every thread that touches elements joins the multithreaded apartment (see `automation`),
// where interface pointers may be shared freely.
unsafe impl Send for Element {}
unsafe impl Sync for Element {}

impl PartialEq for Element {
    fn eq(&self, other: &Self) -> bool {
        automation()
            .and_then(|a| unsafe { a.CompareElements(&self.0, &other.0) }.ok())
            .is_some_and(|same| same.as_bool())
    }
}

impl Element {
    fn flag(&self, read: impl FnOnce(&IUIAutomationElement) -> windows::core::Result<BOOL>) -> Option<bool> {
        read(&self.0).ok().map(|b| b.as_bool())
    }

    fn text(&self, read: impl FnOnce(&IUIAutomationElement) -> windows::core::Result<BSTR>) -> String {
        read(&self.0).map(|s| s.to_string()).unwrap_or_default()
    }

    fn control_type(&self) -> i32 {
        unsafe { self.0.CurrentControlType() }.map(|t| t.0).unwrap_or(0)
    }

    /// The ValuePattern's IsReadOnly, when the element offers that pattern.
    fn read_only(&self) -> Option<bool> {
        let pattern = unsafe { self.0.GetCurrentPattern(UIA_ValuePatternId) }.ok()?;
        let value: IUIAutomationValuePattern = pattern.cast().ok()?;
        unsafe { value.CurrentIsReadOnly() }.ok().map(|b| b.as_bool())
    }

    /// Whether this element is a text input the user types into (never a password field).
    pub fn is_text_input(&self) -> bool {
        let password = self.flag(|e| unsafe { e.CurrentIsPassword() }).unwrap_or(false);
        let enabled = self.flag(|e| unsafe { e.CurrentIsEnabled() }).unwrap_or(false);
        rules::is_windows_text_input(self.control_type(), password, enabled, self.read_only())
    }

    /// The top-level window that hosts this element.
    fn hwnd(&self) -> Option<HWND> {
        unsafe { self.0.CurrentNativeWindowHandle() }.ok().filter(|h| !h.0.is_null())
    }

    /// Physical pixels per logical point where this element is drawn.
    fn scale(&self) -> f64 {
        let dpi = match self.hwnd() {
            Some(h) => unsafe { GetDpiForWindow(h) },
            None => unsafe { GetDpiForSystem() },
        };
        if dpi == 0 { 1.0 } else { f64::from(dpi) / 96.0 }
    }

    fn window_rect(&self) -> Option<Rect> {
        let mut r = RECT::default();
        unsafe { GetWindowRect(self.hwnd()?, &mut r) }.ok()?;
        rect(r)
    }

    /// The part of this element that is visible inside its window, in logical points with
    /// the origin at the top-left of the primary display.
    pub fn visible_frame(&self) -> Option<Rect> {
        if self.flag(|e| unsafe { e.CurrentIsOffscreen() }).unwrap_or(false) {
            return None;
        }
        let frame = rect(unsafe { self.0.CurrentBoundingRectangle() }.ok()?)?;
        let visible = match self.window_rect() {
            Some(window) => frame.intersect(&window)?,
            None => frame,
        };
        let s = self.scale();
        Some(Rect::new(visible.x / s, visible.y / s, visible.w / s, visible.h / s))
    }

    /// Moves keyboard focus back into this element.
    pub fn focus(&self) {
        let _ = unsafe { self.0.SetFocus() };
    }

    /// One-line summary for the diagnostic log.
    pub fn describe(&self) -> String {
        format!(
            "controlType={} class={} automationId={} name={:?} frame={:?}",
            self.control_type(),
            self.text(|e| unsafe { e.CurrentClassName() }),
            self.text(|e| unsafe { e.CurrentAutomationId() }),
            self.text(|e| unsafe { e.CurrentName() }),
            self.visible_frame(),
        )
    }
}

/// A physical-pixel RECT as a Rect, or None when it is empty.
fn rect(r: RECT) -> Option<Rect> {
    let (w, h) = (r.right - r.left, r.bottom - r.top);
    (w > 0 && h > 0).then(|| Rect::new(f64::from(r.left), f64::from(r.top), f64::from(w), f64::from(h)))
}
