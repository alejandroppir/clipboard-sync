//! The "start with Windows" entry, in the current user's registry.

use auto_launch::{AutoLaunch, AutoLaunchBuilder, WindowsEnableMode};
use tauri::AppHandle;

/// Added by the entry: the app then starts in the tray without opening the window.
pub const ARG: &str = "--autostart";

pub fn is_enabled(app: &AppHandle) -> bool {
    entry(app).and_then(|entry| entry.is_enabled().map_err(|e| e.to_string())).unwrap_or(false)
}

pub fn set(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let entry = entry(app)?;
    if enabled { entry.enable() } else { entry.disable() }.map_err(|e| e.to_string())
}

fn entry(app: &AppHandle) -> Result<AutoLaunch, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    AutoLaunchBuilder::new()
        .set_app_name(&app.package_info().name)
        // Quoted: with a space in the path, Windows would first try to run what comes before it.
        .set_app_path(&format!("\"{}\"", exe.display()))
        .set_args(&[ARG])
        .set_windows_enable_mode(WindowsEnableMode::CurrentUser)
        .build()
        .map_err(|e| e.to_string())
}
