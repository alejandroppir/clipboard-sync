//! What is new in each version: the `## Novedades` section of `.github/release-notes.md`, the body
//! of the GitHub release.
//!
//! The same file is built into the app (shown once after updating) and copied into `update.json`
//! (shown before updating, see `scripts/package-release.ps1`).

use crate::config;
use serde::Serialize;
use specta::Type;
use tauri::AppHandle;

const NOTES: &str = include_str!("../../.github/release-notes.md");
const SECTION: &str = "## Novedades";

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseNotes {
    pub version: String,
    pub notes: Vec<String>,
}

/// The `- ` items under `## Novedades`, up to the next `## ` heading.
pub fn parse(text: &str) -> Vec<String> {
    text.lines()
        .skip_while(|line| line.trim() != SECTION)
        .skip(1)
        .take_while(|line| !line.starts_with("## "))
        .filter_map(|line| line.trim().strip_prefix("- "))
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect()
}

/// This version's notes the first time it runs after an update; `None` afterwards and on a fresh install.
pub fn take_unseen(app: &AppHandle) -> Option<ReleaseNotes> {
    let version = app.package_info().version.to_string();
    if config::last_seen_version().as_deref() == Some(version.as_str()) {
        return None;
    }
    // Shown once: if saving fails they would show again next time, which is harmless.
    let _ = config::save_last_seen_version(&version);
    // No user yet means a fresh install, not an update.
    config::user_id()?;
    let notes = parse(NOTES);
    (!notes.is_empty()).then_some(ReleaseNotes { version, notes })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_only_the_items() {
        let text = "- Antes\n## Novedades\n\nIntro.\n- Primera\n  - Segunda  \n-\n- \n## Qué descargar\n- Después\n";
        assert_eq!(parse(text), ["Primera", "Segunda"]);
    }

    #[test]
    fn the_published_file_has_items() {
        assert!(!parse(NOTES).is_empty(), "release-notes.md needs `- ` lines under `## Novedades`");
    }
}
