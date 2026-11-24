//! Launches the downloaded version. The caller exits right after.

use std::path::Path;
use std::process::Command;

/// The installer writes its uninstaller next to the exe; the portable copy has none.
const UNINSTALLER: &str = "uninstall.exe";

pub fn is_installed() -> bool {
    std::env::current_exe().ok().and_then(|exe| exe.parent().map(|dir| dir.join(UNINSTALLER).exists())).unwrap_or(false)
}

/// Runs the NSIS installer silently. `/UPDATE` keeps shortcuts and data; `/R` starts the app again when done.
pub fn run_installer(installer: &Path) -> std::io::Result<()> {
    Command::new(installer).args(["/S", "/UPDATE", "/R"]).spawn().map(drop)
}

/// Starts the new portable exe in update mode, so it replaces this exe once this process exits.
///
/// The arguments are the ones the Electron version (v1.0.7) sends, so both update the same way.
pub fn run_update_helper(new_exe: &Path) -> std::io::Result<()> {
    let target = std::env::current_exe()?;
    Command::new(new_exe)
        .arg("--update-mode")
        .args(["--pid", &std::process::id().to_string()])
        .arg("--source")
        .arg(new_exe)
        .arg("--target")
        .arg(target)
        .spawn()
        .map(drop)
}
