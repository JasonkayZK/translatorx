//! Running applications: names for the UI, and the foreground window to hand focus back to.

use windows::core::PWSTR;
use windows::Win32::Foundation::{CloseHandle, HANDLE, STILL_ACTIVE};
use windows::Win32::System::Threading::{
    GetExitCodeProcess, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

/// The process that owns the foreground window, and that window as a pointer-sized integer
/// (so the shared tracker can store it without Win32 types).
pub fn foreground() -> Option<(i32, isize)> {
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.0.is_null() {
        return None;
    }
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid as *mut u32)) };
    (pid != 0).then_some((pid as i32, hwnd.0 as isize))
}

fn open(pid: i32) -> Option<HANDLE> {
    unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid as u32) }.ok()
}

/// Lower-case executable name (the blocklist id) and its file stem (shown to the user).
pub fn app_info(pid: i32) -> Option<(String, String)> {
    let handle = open(pid)?;
    let mut buffer = [0u16; 1024];
    let mut len = buffer.len() as u32;
    let queried = unsafe { QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, PWSTR(buffer.as_mut_ptr()), &mut len) };
    let _ = unsafe { CloseHandle(handle) };
    queried.ok()?;
    let path = String::from_utf16_lossy(&buffer[..len as usize]);
    let file = path.rsplit(['\\', '/']).next().unwrap_or(&path).to_string();
    let stem = file.rsplit_once('.').map_or_else(|| file.clone(), |(stem, _)| stem.to_string());
    Some((file.to_ascii_lowercase(), stem))
}

pub fn is_running(pid: i32) -> bool {
    let Some(handle) = open(pid) else { return false };
    let mut code = 0u32;
    let alive = unsafe { GetExitCodeProcess(handle, &mut code) }.is_ok() && code == STILL_ACTIVE.0 as u32;
    let _ = unsafe { CloseHandle(handle) };
    alive
}
