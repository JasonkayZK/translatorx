//! Small decisions about other apps' UI elements, kept free of platform calls for testing.

use crate::settings::BlockedApp;

/// Whether an accessibility element is somewhere the user types text (never a password field).
pub fn is_text_input(role: &str, subrole: Option<&str>, enabled: Option<bool>, value_is_editable_string: bool) -> bool {
    if subrole == Some("AXSecureTextField") || enabled == Some(false) {
        return false;
    }
    matches!(role, "AXTextField" | "AXTextArea" | "AXComboBox" | "AXSearchField") || value_is_editable_string
}

/// UI Automation control type ids of elements the user types into.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub const UIA_EDIT: i32 = 50004;
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub const UIA_DOCUMENT: i32 = 50030;
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub const UIA_COMBO_BOX: i32 = 50003;

/// Whether a Windows UI Automation element is somewhere the user types text (never a
/// password field). `read_only` is the ValuePattern's IsReadOnly when the element has one.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub fn is_windows_text_input(control_type: i32, is_password: bool, enabled: bool, read_only: Option<bool>) -> bool {
    if is_password || !enabled || read_only == Some(true) {
        return false;
    }
    matches!(control_type, UIA_EDIT | UIA_DOCUMENT | UIA_COMBO_BOX)
}

/// Chromium browsers only build their accessibility tree for web pages when asked to.
pub fn is_chromium(bundle_id: &str) -> bool {
    matches!(
        bundle_id,
        "com.google.Chrome"
            | "com.google.Chrome.canary"
            | "com.microsoft.edgemac"
            | "company.thebrowser.Browser"
            | "com.brave.Browser"
            | "com.vivaldi.Vivaldi"
            | "com.operasoftware.Opera"
            | "org.chromium.Chromium"
    )
}

pub fn is_blocked(bundle_id: &str, list: &[BlockedApp]) -> bool {
    !bundle_id.is_empty() && list.iter().any(|b| b.id.eq_ignore_ascii_case(bundle_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_inputs() {
        assert!(is_text_input("AXTextArea", None, None, false));
        assert!(is_text_input("AXTextField", Some("AXSearchField"), Some(true), false));
        assert!(!is_text_input("AXTextField", Some("AXSecureTextField"), None, true));
        assert!(!is_text_input("AXTextArea", None, Some(false), false));
        assert!(!is_text_input("AXButton", None, None, false));
        assert!(is_text_input("AXGroup", None, None, true));
    }

    #[test]
    fn chromium_browsers() {
        assert!(is_chromium("com.google.Chrome"));
        assert!(is_chromium("company.thebrowser.Browser"));
        assert!(!is_chromium("com.apple.Safari"));
    }

    #[test]
    fn windows_text_inputs() {
        assert!(is_windows_text_input(UIA_EDIT, false, true, None));
        assert!(is_windows_text_input(UIA_EDIT, false, true, Some(false)));
        assert!(is_windows_text_input(UIA_DOCUMENT, false, true, None));
        assert!(is_windows_text_input(UIA_COMBO_BOX, false, true, None));
        assert!(!is_windows_text_input(UIA_EDIT, true, true, None), "password fields");
        assert!(!is_windows_text_input(UIA_EDIT, false, false, None), "disabled inputs");
        assert!(!is_windows_text_input(UIA_EDIT, false, true, Some(true)), "read-only inputs");
        assert!(!is_windows_text_input(50000, false, true, None), "buttons");
    }

    #[test]
    fn blocklist_matches_windows_executable_names() {
        let list = vec![BlockedApp { id: "cmd.exe".into(), name: "命令提示符".into() }];
        assert!(is_blocked("CMD.EXE", &list));
        assert!(!is_blocked("explorer.exe", &list));
    }

    #[test]
    fn blocklist_ignores_case() {
        let list = vec![BlockedApp { id: "com.apple.Terminal".into(), name: "终端".into() }];
        assert!(is_blocked("com.apple.terminal", &list));
        assert!(!is_blocked("com.apple.Notes", &list));
        assert!(!is_blocked("", &list));
    }
}
