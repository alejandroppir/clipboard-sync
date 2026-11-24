//! Updates from GitHub Releases.
//!
//! 1. On start and every 4 hours, reads `update.json` from the latest release.
//! 2. If it is newer, the window offers it. The user starts the download.
//! 3. The download tries the `.exe` and falls back to the `.custom` file. The signature is always checked.
//! 4. The user chooses when to restart: the portable exe is replaced in update mode; the installed
//!    app runs the installer silently.
//!
//! See `docs/actualizaciones.md`.

mod download;
mod install;
mod manifest;
pub mod update_mode;

use crate::activity::{LogType, log};
use crate::{error_report, window};
use manifest::Manifest;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use strum::VariantNames;
use tauri::{AppHandle, Manager};
use tauri_specta::Event;

/// Repository whose releases are checked. The Electron versions check the same one.
const RELEASES_URL: &str = "https://github.com/alejandroppir/clipboard-sync/releases";
const MANIFEST_FILE: &str = "update.json";
/// Optional folder URL with `update.json` and the files, to test updates without a GitHub release.
const TEST_SOURCE_ENV: &str = "CLIPBOARD_SYNC_UPDATE_SOURCE";
const CHECK_INTERVAL: Duration = Duration::from_secs(4 * 60 * 60);
/// Longest wait to connect, or without receiving anything. The whole download has no limit: it may be slow.
const NETWORK_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, Type, Event, VariantNames)]
#[serde(tag = "state", rename_all = "camelCase")]
#[strum(serialize_all = "camelCase")]
pub enum UpdateStatus {
    #[default]
    Idle,
    Available { version: String, notes: Vec<String> },
    Downloading { version: String, percent: u8 },
    Ready { version: String },
    Failed { version: String, message: String },
}

#[derive(Default)]
pub struct Updater {
    status: Mutex<UpdateStatus>,
    manifest: Mutex<Option<Manifest>>,
    downloaded: Mutex<Option<PathBuf>>,
}

impl Updater {
    pub fn status(&self) -> UpdateStatus {
        self.status.lock().unwrap().clone()
    }
}

fn set_status(app: &AppHandle, status: UpdateStatus) {
    *app.state::<Updater>().status.lock().unwrap() = status.clone();
    let _ = status.emit(app);
}

/// Where `update.json` and the release files are.
struct Source {
    base: Option<String>,
}

impl Source {
    fn from_env() -> Self {
        Self { base: std::env::var(TEST_SOURCE_ENV).ok().map(|base| base.trim_end_matches('/').to_string()) }
    }

    fn manifest_url(&self) -> String {
        match &self.base {
            Some(base) => format!("{base}/{MANIFEST_FILE}"),
            None => format!("{RELEASES_URL}/latest/download/{MANIFEST_FILE}"),
        }
    }

    fn asset_url(&self, version: &str, file: &str) -> String {
        match &self.base {
            Some(base) => format!("{base}/{file}"),
            None => format!("{RELEASES_URL}/download/v{version}/{file}"),
        }
    }
}

fn client() -> reqwest::Result<reqwest::Client> {
    reqwest::Client::builder()
        .connect_timeout(NETWORK_TIMEOUT)
        .read_timeout(NETWORK_TIMEOUT)
        .user_agent("clipboard-sync-updater")
        .build()
}

/// Checks now and every few hours. Development builds only check when a test source is set.
pub fn spawn_checks(app: AppHandle) {
    let source = Source::from_env();
    if cfg!(debug_assertions) && source.base.is_none() {
        return;
    }
    tauri::async_runtime::spawn(async move {
        loop {
            check(&app, &source).await;
            tokio::time::sleep(CHECK_INTERVAL).await;
        }
    });
}

async fn check(app: &AppHandle, source: &Source) {
    if matches!(app.state::<Updater>().status(), UpdateStatus::Downloading { .. } | UpdateStatus::Ready { .. }) {
        return;
    }
    log(app, LogType::Info, "Comprobando actualizaciones…");
    let manifest = match fetch_manifest(source).await {
        Ok(Some(manifest)) => manifest,
        // The latest release has no update.json: normal until the first 2.x release is published.
        Ok(None) => {
            log(app, LogType::Info, "No hay información de actualizaciones publicada.");
            return;
        }
        Err(error) => {
            log(app, LogType::Warning, format!("No se pudieron comprobar las actualizaciones: {error}"));
            return;
        }
    };
    if !manifest.is_newer_than(&app.package_info().version.to_string()) {
        log(app, LogType::Success, "La aplicación está actualizada.");
        return;
    }
    log(app, LogType::Info, format!("Nueva versión disponible: v{}.", manifest.version));
    let status = UpdateStatus::Available { version: manifest.version.clone(), notes: manifest.notes.clone() };
    *app.state::<Updater>().manifest.lock().unwrap() = Some(manifest);
    set_status(app, status);
    window::show(app, false);
}

/// `None` when the latest release has no manifest (HTTP 404).
async fn fetch_manifest(source: &Source) -> Result<Option<Manifest>, String> {
    let response = client().map_err(|e| e.to_string())?.get(source.manifest_url()).send().await.map_err(|e| e.to_string())?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    response.error_for_status().map_err(|e| e.to_string())?.json().await.map(Some).map_err(|e| e.to_string())
}

/// Downloads the offered version in the background.
pub fn start_download(app: &AppHandle) -> Result<(), String> {
    let manifest = app.state::<Updater>().manifest.lock().unwrap().clone().ok_or("No hay ninguna actualización disponible")?;
    if matches!(app.state::<Updater>().status(), UpdateStatus::Downloading { .. }) {
        return Ok(());
    }
    let version = manifest.version.clone();
    set_status(app, UpdateStatus::Downloading { version: version.clone(), percent: 0 });

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let installed = install::is_installed();
        let package = if installed { &manifest.installer } else { &manifest.portable };
        let source = Source::from_env();
        let dir = std::env::temp_dir().join(format!("ClipboardSync-update-{version}"));
        log(&app, LogType::Info, format!("Descargando v{version} ({})…", if installed { "instalador" } else { "portable" }));

        let result = match client() {
            Ok(client) => {
                download::fetch(
                    &client,
                    |file| source.asset_url(&version, file),
                    package,
                    &version,
                    &dir,
                    |percent| set_status(&app, UpdateStatus::Downloading { version: version.clone(), percent }),
                    |reason| log(&app, LogType::Info, format!("Descarga directa no disponible ({reason}). Probando con {}.", package.custom)),
                )
                .await
            }
            Err(error) => Err(error.to_string()),
        };
        match result {
            Ok(path) => {
                *app.state::<Updater>().downloaded.lock().unwrap() = Some(path);
                log(&app, LogType::Success, format!("Versión v{version} descargada y verificada."));
                set_status(&app, UpdateStatus::Ready { version });
            }
            Err(message) => {
                log(&app, LogType::Error, format!("Error al descargar la actualización: {message}"));
                error_report::report(&app, format!("update download v{version}: {message}"));
                set_status(&app, UpdateStatus::Failed { version, message });
            }
        }
    });
    Ok(())
}

/// Starts the downloaded version and closes this one.
pub fn install(app: &AppHandle) -> Result<(), String> {
    let path = app.state::<Updater>().downloaded.lock().unwrap().clone().ok_or("No hay ninguna actualización descargada")?;
    let launched = if install::is_installed() { install::run_installer(&path) } else { install::run_update_helper(&path) };
    launched.map_err(|e| format!("No se pudo iniciar la actualización: {e}"))?;
    app.exit(0);
    Ok(())
}
