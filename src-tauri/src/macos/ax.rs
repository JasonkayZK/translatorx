//! Minimal bindings to the accessibility API (`AXUIElement`), enough to find the focused text
//! input of the frontmost app, where it is on screen, and to switch accessibility on in apps
//! that only build their tree on request.

use std::ffi::c_void;

use core_foundation::base::{CFType, CFTypeRef, TCFType};
use core_foundation::boolean::CFBoolean;
use core_foundation::dictionary::CFDictionary;
use core_foundation::string::{CFString, CFStringRef};

use crate::geometry::Rect;
use crate::rules;

type AXError = i32;
const AX_SUCCESS: AXError = 0;
const AX_VALUE_CGPOINT: u32 = 1;
const AX_VALUE_CGSIZE: u32 = 2;

/// Same layout as `CGPoint` and `CGSize`.
#[repr(C)]
#[derive(Default)]
struct Pair {
    a: f64,
    b: f64,
}

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> u8;
    fn AXIsProcessTrustedWithOptions(options: CFTypeRef) -> u8;
    static kAXTrustedCheckOptionPrompt: CFStringRef;
    fn AXUIElementCreateSystemWide() -> CFTypeRef;
    fn AXUIElementCreateApplication(pid: i32) -> CFTypeRef;
    fn AXUIElementCopyAttributeValue(element: CFTypeRef, attribute: CFStringRef, value: *mut CFTypeRef) -> AXError;
    fn AXUIElementSetAttributeValue(element: CFTypeRef, attribute: CFStringRef, value: CFTypeRef) -> AXError;
    fn AXUIElementIsAttributeSettable(element: CFTypeRef, attribute: CFStringRef, settable: *mut u8) -> AXError;
    fn AXUIElementGetPid(element: CFTypeRef, pid: *mut i32) -> AXError;
    fn AXUIElementSetMessagingTimeout(element: CFTypeRef, timeout: f32) -> AXError;
    fn AXValueGetValue(value: CFTypeRef, the_type: u32, out: *mut c_void) -> u8;
}

/// Whether the user has granted TranslatorX the Accessibility permission.
pub fn trusted() -> bool {
    unsafe { AXIsProcessTrusted() != 0 }
}

/// Asks macOS to show its prompt that leads to Privacy & Security → Accessibility.
pub fn prompt() -> bool {
    let key = unsafe { CFString::wrap_under_get_rule(kAXTrustedCheckOptionPrompt) };
    let options = CFDictionary::from_CFType_pairs(&[(key.as_CFType(), CFBoolean::true_value().as_CFType())]);
    unsafe { AXIsProcessTrustedWithOptions(options.as_CFTypeRef()) != 0 }
}

/// A UI element of some app (or the system-wide element). Equality compares the underlying
/// element, so the same text field polled twice is equal.
#[derive(Clone, PartialEq)]
pub struct Element(CFType);

// AXUIElement is an immutable CoreFoundation handle and the accessibility API can be called
// from any thread, so the wrapper may cross threads.
unsafe impl Send for Element {}
unsafe impl Sync for Element {}

impl Element {
    fn wrap(ptr: CFTypeRef) -> Option<Self> {
        (!ptr.is_null()).then(|| Element(unsafe { CFType::wrap_under_create_rule(ptr) }))
    }

    pub fn system_wide() -> Option<Self> {
        Self::wrap(unsafe { AXUIElementCreateSystemWide() })
    }

    pub fn application(pid: i32) -> Option<Self> {
        Self::wrap(unsafe { AXUIElementCreateApplication(pid) })
    }

    fn raw(&self) -> CFTypeRef {
        self.0.as_CFTypeRef()
    }

    pub fn attr(&self, name: &str) -> Option<CFType> {
        let key = CFString::new(name);
        let mut out: CFTypeRef = std::ptr::null();
        let err = unsafe { AXUIElementCopyAttributeValue(self.raw(), key.as_concrete_TypeRef(), &mut out) };
        (err == AX_SUCCESS && !out.is_null()).then(|| unsafe { CFType::wrap_under_create_rule(out) })
    }

    pub fn string(&self, name: &str) -> Option<String> {
        self.attr(name)?.downcast::<CFString>().map(|s| s.to_string())
    }

    pub fn bool(&self, name: &str) -> Option<bool> {
        self.attr(name)?.downcast::<CFBoolean>().map(bool::from)
    }

    pub fn element(&self, name: &str) -> Option<Element> {
        self.attr(name).map(Element)
    }

    fn pair(&self, name: &str, kind: u32) -> Option<(f64, f64)> {
        let value = self.attr(name)?;
        let mut p = Pair::default();
        let ok = unsafe { AXValueGetValue(value.as_CFTypeRef(), kind, &mut p as *mut Pair as *mut c_void) };
        (ok != 0).then_some((p.a, p.b))
    }

    /// Frame in global top-left coordinates (points).
    pub fn frame(&self) -> Option<Rect> {
        let (x, y) = self.pair("AXPosition", AX_VALUE_CGPOINT)?;
        let (w, h) = self.pair("AXSize", AX_VALUE_CGSIZE)?;
        (w > 0.0 && h > 0.0).then(|| Rect::new(x, y, w, h))
    }

    pub fn settable(&self, name: &str) -> bool {
        let key = CFString::new(name);
        let mut out = 0u8;
        let err = unsafe { AXUIElementIsAttributeSettable(self.raw(), key.as_concrete_TypeRef(), &mut out) };
        err == AX_SUCCESS && out != 0
    }

    pub fn set_bool(&self, name: &str, value: bool) -> bool {
        let key = CFString::new(name);
        let v = CFBoolean::from(value);
        unsafe { AXUIElementSetAttributeValue(self.raw(), key.as_concrete_TypeRef(), v.as_CFTypeRef()) == AX_SUCCESS }
    }

    pub fn pid(&self) -> Option<i32> {
        let mut pid = 0;
        let err = unsafe { AXUIElementGetPid(self.raw(), &mut pid) };
        (err == AX_SUCCESS && pid > 0).then_some(pid)
    }

    /// On the system-wide element this bounds every accessibility call, so a hung app
    /// cannot stall us for long.
    pub fn set_timeout(&self, seconds: f32) {
        unsafe {
            AXUIElementSetMessagingTimeout(self.raw(), seconds);
        }
    }

    /// Whether this element is a text input the user types into (never a password field).
    pub fn is_text_input(&self) -> bool {
        let role = self.string("AXRole").unwrap_or_default();
        let subrole = self.string("AXSubrole");
        let known = matches!(role.as_str(), "AXTextField" | "AXTextArea" | "AXComboBox" | "AXSearchField");
        // Reading AXValue copies the whole text, so only look at it for unfamiliar roles.
        let editable_value = !known && self.settable("AXValue") && self.attr("AXValue").is_some_and(|v| v.instance_of::<CFString>());
        rules::is_text_input(&role, subrole.as_deref(), self.bool("AXEnabled"), editable_value)
    }

    /// The part of this element that is visible inside its window.
    pub fn visible_frame(&self) -> Option<Rect> {
        let frame = self.frame()?;
        match self.element("AXWindow").and_then(|w| w.frame()) {
            Some(window) => frame.intersect(&window),
            None => Some(frame),
        }
    }

    /// One-line summary for the diagnostic log.
    pub fn describe(&self) -> String {
        format!(
            "role={} subrole={} enabled={:?} frame={:?} window={:?}",
            self.string("AXRole").unwrap_or_default(),
            self.string("AXSubrole").unwrap_or_default(),
            self.bool("AXEnabled"),
            self.frame(),
            self.element("AXWindow").and_then(|w| w.frame()),
        )
    }
}
