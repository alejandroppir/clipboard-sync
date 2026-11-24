//! User settings, stored in `%LOCALAPPDATA%\clipboard-sync\config.json`.
//!
//! It is the same file the Electron version used, so users keep their user id after migrating.

use crate::encryption::Key;
use serde::{Deserialize, Serialize};
use std::io;
use std::path::PathBuf;

const CONFIG_DIR: &str = "clipboard-sync";
const CONFIG_FILE: &str = "config.json";

// The Electron file only has `userId`.
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Config {
    user_id: String,
    sync_disabled: bool,
    /// Made from the encryption password, which is not saved.
    #[serde(skip_serializing_if = "Option::is_none")]
    encryption_key: Option<String>,
    /// Version whose release notes were already shown.
    #[serde(skip_serializing_if = "Option::is_none")]
    last_seen_version: Option<String>,
}

/// What a sync session needs.
pub struct SyncSettings {
    pub user_id: Option<String>,
    pub enabled: bool,
    pub key: Option<Key>,
}

fn config_path() -> io::Result<PathBuf> {
    let base = std::env::var_os("LOCALAPPDATA").ok_or_else(|| io::Error::other("LOCALAPPDATA is not set"))?;
    Ok(PathBuf::from(base).join(CONFIG_DIR).join(CONFIG_FILE))
}

/// The saved settings; defaults only when there is no file yet.
fn read() -> io::Result<Config> {
    match std::fs::read_to_string(config_path()?) {
        Ok(raw) => Ok(serde_json::from_str(&raw)?),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Config::default()),
        Err(error) => Err(error),
    }
}

/// Changes the saved settings, creating the folder if needed.
fn update(change: impl FnOnce(&mut Config)) -> io::Result<()> {
    let mut config = match read() {
        // Not readable as settings: there is nothing in it to keep.
        Err(error) if matches!(error.kind(), io::ErrorKind::InvalidData | io::ErrorKind::UnexpectedEof) => Config::default(),
        other => other?,
    };
    change(&mut config);
    let path = config_path()?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    // Replaced in one step: a cut while writing must not lose the settings.
    let new = path.with_extension("json.new");
    std::fs::write(&new, serde_json::to_string_pretty(&config)?)?;
    std::fs::rename(new, path)
}

/// Fails if the settings cannot be read, so a session never sends without encryption by mistake.
pub fn sync_settings() -> io::Result<SyncSettings> {
    let config = read()?;
    let key = config.encryption_key.map(|key| Key::from_base64(&key).ok_or_else(|| io::Error::other("clave de cifrado no válida"))).transpose()?;
    Ok(SyncSettings { user_id: Some(config.user_id).filter(|id| !id.trim().is_empty()), enabled: !config.sync_disabled, key })
}

/// The saved user id; `None` when there is none yet.
pub fn user_id() -> Option<String> {
    read().ok().map(|config| config.user_id).filter(|id| !id.trim().is_empty())
}

pub fn save_user_id(user_id: &str) -> io::Result<()> {
    update(|config| config.user_id = user_id.to_string())
}

pub fn save_sync_enabled(enabled: bool) -> io::Result<()> {
    update(|config| config.sync_disabled = !enabled)
}

pub fn is_encrypted() -> bool {
    read().is_ok_and(|config| config.encryption_key.is_some())
}

pub fn save_key(key: Option<&Key>) -> io::Result<()> {
    update(|config| config.encryption_key = key.map(Key::to_base64))
}

pub fn last_seen_version() -> Option<String> {
    read().ok()?.last_seen_version
}

pub fn save_last_seen_version(version: &str) -> io::Result<()> {
    update(|config| config.last_seen_version = Some(version.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_electron_file() {
        let config: Config = serde_json::from_str(r#"{ "userId": "someone@example.com" }"#).unwrap();
        assert_eq!(config.user_id, "someone@example.com");
        assert!(!config.sync_disabled);
        assert!(config.encryption_key.is_none());
    }
}
