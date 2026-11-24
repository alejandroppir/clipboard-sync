//! Commands the window can call. `tauri-specta` turns them into typed functions in `src/rust/bindings.gen.ts`.

use crate::activity::{self, ActivityLog, LogEntry, LogType, log};
use crate::encryption::Key;
use crate::error_report::{self, ErrorInfo};
use crate::firebase::Firebase;
use crate::history::{History, HistoryChanged, HistoryEntry};
use crate::messages::{MessageCenter, Notification, NotificationChanged, NotificationEntry};
use crate::sync::{SyncService, SyncStatus};
use crate::updater::{UpdateStatus, Updater};
use crate::users::{AdminSession, UserInfo};
use crate::release_notes::ReleaseNotes;
use crate::{autostart, clipboard, config, messages, release_notes, sync, updater, users, window};
use firestore::FirestoreDb;
use serde::Serialize;
use serde_json::{Map, Value};
use specta::Type;
use strum::VariantNames;
use tauri::{AppHandle, State};
use tauri_specta::{collect_commands, collect_events};

/// Firestore document ids: at most 1500 bytes and no `/`.
const MAX_ID_BYTES: usize = 1500;

pub fn builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::<tauri::Wry>::new()
        .commands(collect_commands![
            get_snapshot,
            set_user_id,
            set_encryption_password,
            set_sync_enabled,
            restart_sync,
            restart_app,
            quit_app,
            close_window,
            copy_from_history,
            take_release_notes,
            set_autostart,
            download_update,
            install_update,
            dismiss_notification,
            admin_login,
            admin_list_users,
            admin_list_notifications,
            admin_save_notification,
            admin_delete_notification,
            admin_list_errors,
            admin_delete_errors,
        ])
        .events(collect_events![LogEntry, SyncStatus, NotificationChanged, UpdateStatus, HistoryChanged])
        .constant("LogType", enum_constant::<LogType>())
        .constant("SyncState", enum_constant::<SyncStatus>())
        .constant("UpdateState", enum_constant::<UpdateStatus>())
        .constant("GLOBAL_TARGET", messages::GLOBAL_ID)
        .constant("MAX_LOG_ENTRIES", activity::MAX_ENTRIES)
        // One type per struct, instead of one to send and another to receive.
        .disable_serde_phases()
}

/// `{ Info: "info", … }`: in TypeScript, `LogType.Info` instead of repeating the text.
/// tauri-specta exports Rust enums as text unions only.
fn enum_constant<T: VariantNames>() -> Map<String, Value> {
    let pascal_case = |name: &str| format!("{}{}", name[..1].to_uppercase(), &name[1..]);
    T::VARIANTS.iter().map(|name| (pascal_case(name), Value::from(*name))).collect()
}

/// Everything the window needs when it opens.
#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    version: String,
    user_id: Option<String>,
    encrypted: bool,
    status: SyncStatus,
    log: Vec<LogEntry>,
    history: Vec<HistoryEntry>,
    notification: Option<Notification>,
    update: UpdateStatus,
    autostart: bool,
}

#[tauri::command]
#[specta::specta]
fn get_snapshot(
    app: AppHandle,
    activity: State<'_, ActivityLog>,
    history: State<'_, History>,
    sync: State<'_, SyncService>,
    messages: State<'_, MessageCenter>,
    updater: State<'_, Updater>,
) -> Snapshot {
    Snapshot {
        version: app.package_info().version.to_string(),
        user_id: config::user_id(),
        encrypted: config::is_encrypted(),
        status: sync.status(),
        log: activity.entries(),
        history: history.entries(),
        notification: messages.current(),
        update: updater.status(),
        autostart: autostart::is_enabled(&app),
    }
}

/// Saves the user id and restarts the sync with it.
#[tauri::command]
#[specta::specta]
async fn set_user_id(app: AppHandle, user_id: String) -> Result<(), String> {
    let user_id = valid_id(&user_id)?;
    config::save_user_id(&user_id).map_err(|e| format!("No se pudo guardar la configuración: {e}"))?;
    log(&app, LogType::Info, format!("Usuario actualizado: {user_id}"));
    sync::restart(&app).await;
    Ok(())
}

/// Encrypts the clipboard content with `password` from now on, or stops doing it if it is `None`.
#[tauri::command]
#[specta::specta]
async fn set_encryption_password(app: AppHandle, password: Option<String>) -> Result<(), String> {
    let key = match password.as_deref().map(str::trim) {
        Some("") => return Err("La contraseña está vacía".into()),
        Some(password) => {
            let password = password.to_string();
            let derived = tauri::async_runtime::spawn_blocking(move || Key::from_password(&password)).await;
            Some(derived.map_err(|e| e.to_string()).flatten()?)
        }
        None => None,
    };
    config::save_key(key.as_ref()).map_err(|e| format!("No se pudo guardar la configuración: {e}"))?;
    if key.is_some() {
        log(&app, LogType::Warning, "Cifrado activado. Los demás equipos de este usuario necesitan la versión 2.0.0 o superior y la misma contraseña; si no, dejarán de sincronizarse con este.");
    } else {
        log(&app, LogType::Warning, "Cifrado desactivado. Quítalo también en los demás equipos: ignoran lo que llega sin cifrar.");
    }
    sync::restart(&app).await;
    Ok(())
}

#[tauri::command]
#[specta::specta]
async fn set_sync_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    sync::set_enabled(&app, enabled).await
}

#[tauri::command]
#[specta::specta]
async fn restart_sync(app: AppHandle) {
    sync::restart(&app).await;
}

#[tauri::command]
#[specta::specta]
fn restart_app(app: AppHandle) {
    app.restart();
}

#[tauri::command]
#[specta::specta]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// Closes the window; the app keeps running in the tray.
#[tauri::command]
#[specta::specta]
fn close_window(app: AppHandle) {
    window::close(&app);
}

/// Copies a text from the history. Being a new copy, it is then uploaded like any other.
#[tauri::command]
#[specta::specta]
async fn copy_from_history(history: State<'_, History>, id: u32) -> Result<(), String> {
    let text = history.text(id).ok_or("Ese texto ya no está en el historial")?;
    clipboard::write_text(text).await.map_err(|e| format!("No se pudo copiar: {e}"))
}

/// This version's release notes, only the first time the window asks after an update.
#[tauri::command]
#[specta::specta]
fn take_release_notes(app: AppHandle) -> Option<ReleaseNotes> {
    release_notes::take_unseen(&app)
}

#[tauri::command]
#[specta::specta]
fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    if let Err(error) = autostart::set(&app, enabled) {
        let message = format!("No se pudo cambiar el arranque con Windows: {error}");
        log(&app, LogType::Error, message.clone());
        return Err(message);
    }
    log(&app, LogType::Info, if enabled { "Arrancará con Windows." } else { "Ya no arrancará con Windows." });
    Ok(())
}

#[tauri::command]
#[specta::specta]
fn download_update(app: AppHandle) -> Result<(), String> {
    updater::start_download(&app)
}

#[tauri::command]
#[specta::specta]
fn install_update(app: AppHandle) -> Result<(), String> {
    updater::install(&app)
}

#[tauri::command]
#[specta::specta]
async fn dismiss_notification(app: AppHandle, firebase: State<'_, Firebase>) -> Result<(), String> {
    let user_id = config::user_id().unwrap_or_default();
    let db = firebase.db().await.map_err(|e| e.to_string())?;
    messages::dismiss(&app, &db, &user_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
async fn admin_login(firebase: State<'_, Firebase>, session: State<'_, AdminSession>, password: String) -> Result<bool, String> {
    let db = firebase.db().await.map_err(|e| e.to_string())?;
    users::login(&db, &session, &password).await.map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
async fn admin_list_users(firebase: State<'_, Firebase>, session: State<'_, AdminSession>) -> Result<Vec<UserInfo>, String> {
    let db = admin_db(&firebase, &session).await?;
    users::list(&db).await.map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
async fn admin_list_notifications(firebase: State<'_, Firebase>, session: State<'_, AdminSession>) -> Result<Vec<NotificationEntry>, String> {
    let db = admin_db(&firebase, &session).await?;
    messages::list(&db).await.map_err(|e| e.to_string())
}

/// Creates or replaces a message. `target` is `global` or a user id.
#[tauri::command]
#[specta::specta]
async fn admin_save_notification(
    firebase: State<'_, Firebase>,
    session: State<'_, AdminSession>,
    target: String,
    message: String,
) -> Result<(), String> {
    let target = valid_id(&target)?;
    let message = message.trim();
    if message.is_empty() {
        return Err("El mensaje está vacío".into());
    }
    let db = admin_db(&firebase, &session).await?;
    messages::save(&db, &target, message).await.map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
async fn admin_delete_notification(firebase: State<'_, Firebase>, session: State<'_, AdminSession>, id: String) -> Result<(), String> {
    let id = valid_id(&id)?;
    let db = admin_db(&firebase, &session).await?;
    messages::delete(&db, &id).await.map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
async fn admin_list_errors(firebase: State<'_, Firebase>, session: State<'_, AdminSession>) -> Result<Vec<ErrorInfo>, String> {
    let db = admin_db(&firebase, &session).await?;
    error_report::list(&db).await.map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
async fn admin_delete_errors(firebase: State<'_, Firebase>, session: State<'_, AdminSession>, ids: Vec<String>) -> Result<(), String> {
    let ids = ids.iter().map(|id| valid_id(id)).collect::<Result<Vec<_>, _>>()?;
    let db = admin_db(&firebase, &session).await?;
    error_report::delete(&db, &ids).await.map_err(|e| e.to_string())
}

async fn admin_db(firebase: &Firebase, session: &AdminSession) -> Result<FirestoreDb, String> {
    if !session.is_unlocked() {
        return Err("Hace falta la contraseña de administrador".into());
    }
    firebase.db().await.map_err(|e| e.to_string())
}

/// Trims `value` and checks it can be a Firestore document id.
fn valid_id(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err("El identificador está vacío".into());
    }
    if value.len() > MAX_ID_BYTES || value.contains('/') || value == "." || value == ".." || (value.starts_with("__") && value.ends_with("__")) {
        return Err("El identificador no es válido: no puede contener «/» ni superar 1500 caracteres".into());
    }
    Ok(value.to_string())
}

#[cfg(test)]
mod tests {
    use super::valid_id;

    #[test]
    fn validates_document_ids() {
        assert_eq!(valid_id("  someone@example.com ").unwrap(), "someone@example.com");
        assert!(valid_id("   ").is_err());
        assert!(valid_id("a/b").is_err());
        assert!(valid_id("..").is_err());
        assert!(valid_id("__reserved__").is_err());
    }
}
