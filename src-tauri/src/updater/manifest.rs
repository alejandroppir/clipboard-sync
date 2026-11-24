//! `update.json`, published with every release next to the files it describes.

use serde::Deserialize;

/// One way of distributing the app: the portable exe or the installer.
#[derive(Debug, Clone, Deserialize)]
pub struct Package {
    /// File name of the executable, e.g. `ClipboardSync.exe`.
    pub file: String,
    /// The same executable inside a zip with another extension, for networks that block `.exe` and `.zip` downloads.
    pub custom: String,
    /// Signature of the executable (base64, as `tauri signer sign` prints it). It also covers the file name and the version.
    pub signature: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Manifest {
    pub version: String,
    /// The `## Novedades` items of `.github/release-notes.md`.
    pub notes: Vec<String>,
    pub portable: Package,
    pub installer: Package,
}

impl Manifest {
    /// Whether this release is newer than `current`. An unreadable version never counts as newer.
    pub fn is_newer_than(&self, current: &str) -> bool {
        match (semver::Version::parse(&self.version), semver::Version::parse(current)) {
            (Ok(latest), Ok(current)) => latest > current,
            _ => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"{
        "version": "2.1.0",
        "notes": ["Nuevo"],
        "portable": { "file": "ClipboardSync.exe", "custom": "ClipboardSync.custom", "signature": "a" },
        "installer": { "file": "ClipboardSync-setup.exe", "custom": "ClipboardSync-setup.custom", "signature": "b" }
    }"#;

    #[test]
    fn parses_and_compares_versions() {
        let manifest: Manifest = serde_json::from_str(SAMPLE).unwrap();
        assert_eq!(manifest.installer.custom, "ClipboardSync-setup.custom");
        assert!(manifest.is_newer_than("2.0.9"));
        assert!(!manifest.is_newer_than("2.1.0"));
        assert!(!manifest.is_newer_than("10.0.0"));
        assert!(!manifest.is_newer_than("not a version"));
    }
}
