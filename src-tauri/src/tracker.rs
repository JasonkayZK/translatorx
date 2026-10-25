//! Background thread that watches which text input has focus in other apps. It keeps the
//! "target" the quick window inserts into, and shows the bubble in that input's corner.
//!
//! The state machine is shared. macOS (accessibility API) and Windows (UI Automation) each
//! provide `Element` and `apps` with the same surface; the few platform-only calls sit
//! behind `cfg`.

use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, LogicalPosition, Manager};

use crate::geometry::{self, Rect};
#[cfg(target_os = "macos")]
use crate::macos::{apps, ax::Element};
use crate::quick::TargetInfo;
use crate::rules;
use crate::settings::{BlockedApp, Settings};
#[cfg(target_os = "windows")]
use crate::win32::{apps, uia::{self, Element}};
use crate::windows::BUBBLE;

const POLL: Duration = Duration::from_millis(250);
const UNTRUSTED_POLL: Duration = Duration::from_secs(2);
/// An input must keep focus this long before the bubble appears (tabbing through fields
/// should not make it flicker).
const SETTLE: Duration = Duration::from_millis(300);

/// Whether the OS lets us watch other apps' inputs. macOS needs the Accessibility permission.
#[cfg(target_os = "macos")]
pub fn trusted() -> bool {
    crate::macos::ax::trusted()
}

/// Whether the OS lets us watch other apps' inputs. UI Automation needs no permission.
#[cfg(target_os = "windows")]
pub fn trusted() -> bool {
    true
}

/// The last text input the user focused in another app.
#[derive(Clone)]
pub struct Target {
    pub pid: i32,
    pub bundle_id: String,
    pub app: String,
    pub element: Element,
    pub frame: Option<Rect>,
    /// The top-level window to bring back before pasting.
    #[cfg(target_os = "windows")]
    pub hwnd: isize,
}

impl Target {
    fn info(&self) -> TargetInfo {
        TargetInfo { app: self.app.clone(), bundle_id: self.bundle_id.clone() }
    }
}

struct Candidate {
    element: Element,
    since: Instant,
    editable: bool,
}

struct Inner {
    enabled: bool,
    blocklist: Vec<BlockedApp>,
    trusted: bool,
    target: Option<Target>,
    candidate: Option<Candidate>,
    /// Where the bubble is while it is shown.
    shown: Option<(f64, f64)>,
    mini_visible: bool,
    /// Apps whose accessibility tree we switched on, and whether that needed
    /// AXEnhancedUserInterface (which we undo on exit).
    #[cfg(target_os = "macos")]
    switched_on: HashMap<i32, bool>,
    names: HashMap<i32, (String, String)>,
    /// Last diagnostic line, so the log only records changes.
    last_note: String,
}

pub struct Tracker {
    inner: Mutex<Inner>,
    /// The system-wide accessibility element, with a timeout so a hung app cannot stall us.
    #[cfg(target_os = "macos")]
    system: Option<Element>,
}

/// What a tick decided to do once the lock is released: window calls are never made while
/// holding it, since they may wait for the main thread.
enum Action {
    Show(f64, f64),
    Hide,
    Target(Option<TargetInfo>),
    Trusted(bool),
}

impl Tracker {
    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn start(app: &AppHandle, s: &Settings) {
        #[cfg(target_os = "macos")]
        let system = {
            let system = Element::system_wide();
            if let Some(sys) = &system {
                sys.set_timeout(0.25);
            }
            system
        };
        app.manage(Tracker {
            inner: Mutex::new(Inner {
                enabled: s.bubble,
                blocklist: s.bubble_blocklist.clone(),
                trusted: trusted(),
                target: None,
                candidate: None,
                shown: None,
                mini_visible: false,
                #[cfg(target_os = "macos")]
                switched_on: HashMap::new(),
                names: HashMap::new(),
                last_note: String::new(),
            }),
            #[cfg(target_os = "macos")]
            system,
        });
        log::info!("[悬浮图标] 跟踪已启动：可访问其他应用={}，本进程 pid={}", trusted(), own_pid());
        let handle = app.clone();
        let spawned = std::thread::Builder::new().name("ax-tracker".into()).spawn(move || loop {
            let wait = handle.state::<Tracker>().tick(&handle);
            std::thread::sleep(wait);
        });
        if let Err(e) = spawned {
            log::warn!("输入框跟踪线程启动失败: {e}");
        }
    }

    pub fn update_settings(&self, s: &Settings) {
        let mut g = self.lock();
        g.enabled = s.bubble;
        g.blocklist = s.bubble_blocklist.clone();
    }

    /// The quick window hides the bubble while it is open.
    pub fn set_mini_visible(&self, app: &AppHandle, visible: bool) {
        let hide = {
            let mut g = self.lock();
            g.mini_visible = visible;
            visible && g.shown.take().is_some()
        };
        if hide {
            run(app, vec![Action::Hide]);
        }
    }

    /// The main window took focus: the bubble belongs to other apps' inputs.
    pub fn hide_bubble(&self, app: &AppHandle) {
        let hide = {
            let mut g = self.lock();
            g.candidate = None;
            g.shown.take().is_some()
        };
        if hide {
            run(app, vec![Action::Hide]);
        }
    }

    pub fn target(&self) -> Option<Target> {
        let mut g = self.lock();
        if g.target.as_ref().is_some_and(|t| !apps::is_running(t.pid)) {
            g.target = None;
        }
        g.target.clone()
    }

    pub fn target_info(&self) -> Option<TargetInfo> {
        self.target().map(|t| t.info())
    }

    /// Where the target input is, for opening the quick window from the bubble.
    pub fn target_frame(&self) -> Option<Rect> {
        self.lock().target.as_ref().and_then(|t| t.frame)
    }

    /// Queries the focused input right now (used by the shortcut, which may fire before the
    /// next tick). Returns its frame when the frontmost app is another app with a text input.
    #[cfg(target_os = "macos")]
    pub fn anchor_now(&self) -> Option<Rect> {
        let system = self.system.as_ref()?;
        if !trusted() {
            return None;
        }
        let pid = apps::frontmost_pid(system)?;
        if pid == own_pid() {
            return None;
        }
        let focused = Element::application(pid)?.element("AXFocusedUIElement")?;
        if !focused.is_text_input() {
            return None;
        }
        let frame = focused.visible_frame();
        let (bundle_id, app) = self.name_of(pid);
        self.lock().target = Some(Target { pid, bundle_id, app, element: focused, frame });
        frame
    }

    /// Queries the focused input right now (used by the shortcut, which may fire before the
    /// next tick). Returns its frame when the foreground app is another app with a text input.
    #[cfg(target_os = "windows")]
    pub fn anchor_now(&self) -> Option<Rect> {
        let (pid, hwnd) = apps::foreground()?;
        if pid == own_pid() {
            return None;
        }
        let focused = uia::focused_element(pid)?;
        if !focused.is_text_input() {
            return None;
        }
        let frame = focused.visible_frame();
        let (bundle_id, app) = self.name_of(pid);
        self.lock().target = Some(Target { pid, bundle_id, app, element: focused, frame, hwnd });
        frame
    }

    /// Undoes AXEnhancedUserInterface, which can slow browsers down, when we quit.
    #[cfg(target_os = "macos")]
    pub fn restore_enhanced(&self) {
        let pids: Vec<i32> = self.lock().switched_on.iter().filter(|(_, e)| **e).map(|(p, _)| *p).collect();
        for pid in pids {
            if let Some(el) = Element::application(pid) {
                el.set_bool("AXEnhancedUserInterface", false);
            }
        }
    }

    fn name_of(&self, pid: i32) -> (String, String) {
        if let Some(n) = self.lock().names.get(&pid) {
            return n.clone();
        }
        let n = apps::app_info(pid).unwrap_or_default();
        self.lock().names.insert(pid, n.clone());
        n
    }

    fn tick(&self, app: &AppHandle) -> Duration {
        let trusted = trusted();
        let mut actions = Vec::new();
        {
            let mut g = self.lock();
            if trusted != g.trusted {
                g.trusted = trusted;
                actions.push(Action::Trusted(trusted));
                log::info!("[悬浮图标] 可访问其他应用变为 {trusted}");
            }
            if !trusted && g.shown.take().is_some() {
                actions.push(Action::Hide);
            }
            if !trusted {
                note(&mut g, "未授权辅助功能：系统设置 → 隐私与安全性 → 辅助功能".into());
            }
        }
        if trusted {
            self.poll(&mut actions);
        }
        run(app, actions);
        if trusted { POLL } else { UNTRUSTED_POLL }
    }

    fn poll(&self, actions: &mut Vec<Action>) {
        let hide = |g: &mut Inner, actions: &mut Vec<Action>| {
            g.candidate = None;
            if g.shown.take().is_some() {
                actions.push(Action::Hide);
            }
        };

        // The app in front and, on Windows, its top-level window.
        #[cfg(target_os = "macos")]
        let front = self.system.as_ref().and_then(apps::frontmost_pid).map(|pid| (pid, 0isize));
        #[cfg(target_os = "windows")]
        let front = apps::foreground();
        let Some((pid, window)) = front else {
            let mut g = self.lock();
            note(&mut g, "取不到前台应用".into());
            hide(&mut g, actions);
            return;
        };
        #[cfg(target_os = "macos")]
        let _ = window;
        // One of our own windows is in front (e.g. the bubble's context menu is open): keep
        // the target and leave the bubble alone; opening the quick or main window hides it.
        if pid == own_pid() {
            return;
        }
        let (bundle_id, name) = self.name_of(pid);
        #[cfg(target_os = "macos")]
        let focused = {
            let Some(app_el) = Element::application(pid) else { return };
            self.switch_on(pid, &bundle_id, &name, &app_el);
            app_el.element("AXFocusedUIElement")
        };
        #[cfg(target_os = "windows")]
        let focused = uia::focused_element(pid);

        let previous = self.lock().candidate.as_ref().map(|c| (c.element.clone(), c.since, c.editable));
        let (element, since, editable) = match (focused, previous) {
            (Some(f), Some((p, since, editable))) if f == p => (f, since, editable),
            (Some(f), _) => {
                let editable = f.is_text_input();
                log::info!("[悬浮图标] {name}（{bundle_id}）焦点元素变化：可编辑={editable} {}", f.describe());
                (f, Instant::now(), editable)
            }
            (None, _) => {
                let mut g = self.lock();
                note(&mut g, format!("{name}（{bundle_id}）：取不到焦点元素"));
                hide(&mut g, actions);
                return;
            }
        };
        let frame = if editable { element.visible_frame() } else { None };

        let mut g = self.lock();
        g.candidate = Some(Candidate { element: element.clone(), since, editable });
        if !editable {
            note(&mut g, format!("{name}：焦点不在输入框里"));
            if g.shown.take().is_some() {
                actions.push(Action::Hide);
            }
            return;
        }
        let changed = g.target.as_ref().map(|t| t.pid) != Some(pid);
        g.target = Some(Target {
            pid,
            bundle_id: bundle_id.clone(),
            app: name.clone(),
            element,
            frame,
            #[cfg(target_os = "windows")]
            hwnd: window,
        });
        if changed {
            actions.push(Action::Target(g.target.as_ref().map(Target::info)));
        }

        let settled = since.elapsed() >= SETTLE;
        let blocked = rules::is_blocked(&bundle_id, &g.blocklist);
        let why_not = if !g.enabled {
            Some("悬浮图标已在设置中关闭")
        } else if g.mini_visible {
            Some("小窗打开中")
        } else if blocked {
            Some("该应用在「不显示图标的应用」名单里")
        } else if frame.is_none() {
            Some("输入框没有可用的位置（frame 为空或不在窗口内）")
        } else {
            None
        };
        if let Some(why) = why_not {
            note(&mut g, format!("{name}：不显示，{why}"));
        }
        match (why_not.is_none() && settled, frame) {
            (true, Some(visible)) => {
                let pos = geometry::bubble_origin(visible);
                if g.shown != Some(pos) {
                    note(&mut g, format!("{name}：显示在 ({:.0}, {:.0})，输入框可见区域 {visible:?}", pos.0, pos.1));
                    g.shown = Some(pos);
                    actions.push(Action::Show(pos.0, pos.1));
                }
            }
            _ => {
                if g.shown.take().is_some() {
                    actions.push(Action::Hide);
                }
            }
        }
    }

    /// Electron and Chromium only expose web content to assistive apps that ask for it.
    #[cfg(target_os = "macos")]
    fn switch_on(&self, pid: i32, bundle_id: &str, name: &str, app_el: &Element) {
        if self.lock().switched_on.contains_key(&pid) {
            return;
        }
        let manual = app_el.set_bool("AXManualAccessibility", true);
        let enhanced = rules::is_chromium(bundle_id) && app_el.set_bool("AXEnhancedUserInterface", true);
        log::info!("[悬浮图标] 为 {name}（{bundle_id}）打开辅助功能树：AXManualAccessibility={manual} AXEnhancedUserInterface={enhanced}");
        self.lock().switched_on.insert(pid, enhanced);
    }
}

/// Logs a diagnostic line when it differs from the previous one.
fn note(g: &mut Inner, line: String) {
    if g.last_note != line {
        log::info!("[悬浮图标] {line}");
        g.last_note = line;
    }
}

fn own_pid() -> i32 {
    std::process::id() as i32
}

fn run(app: &AppHandle, actions: Vec<Action>) {
    for action in actions {
        match action {
            Action::Show(x, y) => {
                if let Some(b) = app.get_webview_window(BUBBLE) {
                    let _ = b.set_position(LogicalPosition::new(x, y));
                    let _ = b.show();
                }
            }
            Action::Hide => {
                if let Some(b) = app.get_webview_window(BUBBLE) {
                    let _ = b.hide();
                }
            }
            Action::Target(info) => {
                let _ = app.emit_to(crate::windows::MINI, "mini-target", info);
            }
            Action::Trusted(t) => {
                let _ = app.emit("ax-status", t);
            }
        }
    }
}
