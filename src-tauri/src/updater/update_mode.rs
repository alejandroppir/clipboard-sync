//! Update mode: the new exe, started with `--update-mode --pid <pid> --source <new exe> --target <old exe>`,
//! copies itself over the old exe and starts it.
//!
//! The Electron version (v1.0.7) starts the first Tauri release exactly this way, so these
//! arguments must keep working.

use std::path::PathBuf;
use std::time::{Duration, Instant};
use tauri::{Context, WebviewUrl, WebviewWindowBuilder};

const FLAG: &str = "--update-mode";
const WINDOW_LABEL: &str = "update";
const COPY_RETRY_DELAY: Duration = Duration::from_millis(500);
/// The old exe stays locked until its process exits; give it this long.
const COPY_TIMEOUT: Duration = Duration::from_secs(60);

pub fn is_requested(args: &[String]) -> bool {
    args.iter().any(|arg| arg == FLAG)
}

#[derive(Debug, PartialEq)]
pub struct UpdateRequest {
    source: PathBuf,
    target: PathBuf,
}

impl UpdateRequest {
    /// Reads `--source` and `--target`. `--pid` is accepted but not needed: the copy is retried
    /// until the old process has released its exe.
    pub fn parse(args: &[String]) -> Option<Self> {
        let value = |name: &str| args.iter().position(|arg| arg == name).and_then(|i| args.get(i + 1)).map(PathBuf::from);
        Some(Self { source: value("--source")?, target: value("--target")? })
    }
}

/// Shows a small "updating" window while the copy runs, then starts the target and exits.
pub fn run(context: Context, request: UpdateRequest) {
    tauri::Builder::default()
        .setup(move |app| {
            WebviewWindowBuilder::new(app, WINDOW_LABEL, WebviewUrl::App("update.html".into()))
                .title("Actualizando")
                .inner_size(320.0, 180.0)
                .resizable(false)
                .decorations(false)
                .always_on_top(true)
                .center()
                .background_color(crate::window::BACKGROUND)
                .build()?;
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                replace(&request);
                // Started even when the copy failed: then it is the old version, which is still better than nothing.
                let _ = std::process::Command::new(&request.target).spawn();
                handle.exit(0);
            });
            Ok(())
        })
        .run(context)
        .expect("error while running the update window");
}

fn replace(request: &UpdateRequest) {
    let started = Instant::now();
    while started.elapsed() < COPY_TIMEOUT {
        if std::fs::copy(&request.source, &request.target).is_ok() {
            return;
        }
        std::thread::sleep(COPY_RETRY_DELAY);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|arg| arg.to_string()).collect()
    }

    #[test]
    fn reads_the_arguments_of_the_electron_version() {
        let legacy = args(&["setup.exe", "--update-mode", "--pid", "42", "--source", r"C:\tmp\new.exe", "--target", r"C:\apps\ClipboardSync.exe"]);
        assert!(is_requested(&legacy));
        assert_eq!(
            UpdateRequest::parse(&legacy),
            Some(UpdateRequest { source: r"C:\tmp\new.exe".into(), target: r"C:\apps\ClipboardSync.exe".into() })
        );
        assert_eq!(UpdateRequest::parse(&args(&["x.exe", "--update-mode", "--source"])), None);
        assert!(!is_requested(&args(&["ClipboardSync.exe"])));
    }
}
