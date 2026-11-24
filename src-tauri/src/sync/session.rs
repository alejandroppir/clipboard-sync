//! A sync session: keeps the local clipboard and the user's Firestore document equal until it is cancelled.
//!
//! - Windows announces each local copy, and the text is uploaded.
//! - A Firestore listener announces each remote copy, and the text is written to the clipboard.
//!
//! Both directions are handled by one loop, one step at a time, so they never race with each other.
//! What fails is tried again: the clipboard can be locked (by another app, or with the Windows session)
//! and the connection can die (the machine slept, the network changed). What the session knows survives
//! a reconnection, so nothing is uploaded or written twice.

use super::{SyncStatus, machine_id, madrid_now, set_status};
use crate::activity::{LogType, log};
use crate::clipboard::{self, Reading};
use crate::encryption::Key;
use crate::firebase::{Firebase, collection_id, collections, document_id};
use crate::usage::Usage;
use crate::{error_report, history, messages};
use firestore::errors::FirestoreError;
use firestore::{
    FirestoreDb, FirestoreListenEvent, FirestoreListener, FirestoreListenerParams, FirestoreListenerTarget, FirestoreMemListenStateStorage,
    FirestoreResult,
};
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};
use tokio::sync::{oneshot, watch};
use tokio::time::MissedTickBehavior;

/// Quiet time after a change before reading: some apps (Excel) change the clipboard several times per copy.
const SETTLE_DELAY: Duration = Duration::from_millis(300);
/// Longest wait for that quiet time, for an app that never stops.
const SETTLE_LIMIT: Duration = Duration::from_secs(2);
/// How often pending work is tried again and a sleep of the machine is looked for.
const TICK: Duration = Duration::from_secs(2);
/// A tick this late means the machine slept: the connection is dead even if nothing says so yet.
const SLEEP_GAP: Duration = Duration::from_secs(60);
const RECONNECT_DELAY: Duration = Duration::from_secs(5);
/// How long the first connection waits for the stored text (it never comes if the document does not exist).
const FIRST_SNAPSHOT_WAIT: Duration = Duration::from_secs(5);
/// Silence after which the listener opens a new stream; the value its documentation recommends.
const LISTENER_IDLE_TIMEOUT: Duration = Duration::from_secs(120);
const LISTENER_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);
/// A Firestore document holds at most 1 MiB; this leaves room for the other fields. Encrypting takes a third more.
const MAX_CONTENT_BYTES: usize = 1_000_000;
/// A locked Windows session is normal; a clipboard that cannot be written for longer than this is an error.
const WRITE_FAILURE_LIMIT: Duration = Duration::from_secs(60 * 60);

const CLIPBOARD_TARGET: FirestoreListenerTarget = FirestoreListenerTarget::new(1);
const NOTIFICATIONS_TARGET: FirestoreListenerTarget = FirestoreListenerTarget::new(2);

type Listener = FirestoreListener<FirestoreDb, FirestoreMemListenStateStorage>;
/// Keeps only the newest document; it closes if the listener gives up.
type Incoming = watch::Receiver<Option<ClipboardDoc>>;

/// Document stored in `clipboard-v2/{userId}`. `encrypted` and `usage` are not in the Electron version, which ignores a
/// document without `content`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClipboardDoc {
    /// The text, when it is not encrypted.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    encrypted: Option<String>,
    machine_id: String,
    /// Madrid time, `yyyy/MM/dd-HH:mm:ss`.
    timestamp: String,
    app_version: String,
    #[serde(default)]
    usage: Usage,
}

/// Why the text of a document cannot be used.
#[derive(Debug, PartialEq)]
enum Unreadable {
    /// It is encrypted and there is no password here.
    NoPassword,
    WrongPassword,
    /// It is not encrypted and here it must be: accepting it would let anyone put a text in the clipboard.
    NotEncrypted,
}

impl ClipboardDoc {
    fn text(&self, key: Option<&Key>, user_id: &str) -> Result<String, Unreadable> {
        match (key, &self.encrypted, &self.content) {
            (Some(key), Some(encrypted), _) => key.decrypt(encrypted, user_id).ok_or(Unreadable::WrongPassword),
            (Some(_), None, _) => Err(Unreadable::NotEncrypted),
            (None, Some(_), _) => Err(Unreadable::NoPassword),
            (None, None, content) => Ok(content.clone().unwrap_or_default()),
        }
    }
}

/// A text received, already readable.
struct RemoteText {
    text: String,
    machine_id: String,
}

/// Last text handled on each side. It tells a new text from our own echo.
#[derive(Default)]
struct Known {
    local: String,
    remote: String,
}

impl Known {
    /// Whether `text`, read from the clipboard, must be uploaded.
    fn take_local(&mut self, text: &str) -> bool {
        let text = canonical(text);
        if text.trim().is_empty() || text == self.local {
            return false;
        }
        self.local = text;
        true
    }

    /// Whether `text`, received from Firestore, must be written to the clipboard.
    fn take_remote(&mut self, text: &str) -> bool {
        let text = canonical(text);
        if text == self.remote {
            return false;
        }
        self.remote = text;
        self.remote != self.local
    }

    /// The upload did not arrive: the text counts as new again.
    fn forget_local(&mut self) {
        self.local.clear();
    }

    /// `text` is now in the clipboard, so it is not uploaded back.
    fn written(&mut self, text: &str) {
        self.local = canonical(text);
    }
}

/// Remote desktops change the line endings of what they copy; that must not look like a new text.
fn canonical(text: &str) -> String {
    text.replace("\r\n", "\n")
}

/// The connection is no longer good: another one must be opened after this time.
struct Reconnect(Duration);

struct Session {
    app: AppHandle,
    user_id: String,
    key: Option<Key>,
    usage: Usage,
    known: Known,
    /// Clipboard changes since the session started: what was copied while stopped or paused is never sent.
    changes: watch::Receiver<()>,
    /// There is a local change still to be read or uploaded.
    local_pending: bool,
    /// Remote text still to be written to the clipboard.
    remote_pending: Option<RemoteText>,
    /// Last document that could not be read, so it is announced once: the listener sends it again when it reconnects.
    unreadable: String,
    first_connection: bool,
    // Only the first failure of a streak is logged, so an outage does not flood the log.
    upload_failing: bool,
    write_failing: Option<Instant>,
    write_reported: bool,
    connect_failing: bool,
}

/// Syncs until `cancelled` fires, reconnecting as many times as needed.
pub(super) async fn run(app: AppHandle, user_id: String, key: Option<Key>, mut cancelled: oneshot::Receiver<()>) {
    // The ones of the previous user, if it changed.
    messages::clear(&app);
    let mut session = Session {
        changes: clipboard::changes(),
        app: app.clone(),
        user_id,
        key,
        usage: Usage::default(),
        known: Known::default(),
        local_pending: false,
        remote_pending: None,
        unreadable: String::new(),
        first_connection: true,
        upload_failing: false,
        write_failing: None,
        write_reported: false,
        connect_failing: false,
    };
    loop {
        let (db, mut listener, mut incoming) = tokio::select! {
            connection = session.connect() => connection,
            _ = &mut cancelled => return,
        };
        let ended = tokio::select! {
            reconnect = session.exchange(&db, &mut incoming) => Some(reconnect),
            _ = &mut cancelled => None,
        };
        let _ = listener.shutdown_with_timeout(LISTENER_SHUTDOWN_TIMEOUT).await;
        let Some(Reconnect(delay)) = ended else { return };

        set_status(&app, SyncStatus::Connecting);
        app.state::<Firebase>().reset().await;
        tokio::select! {
            () = tokio::time::sleep(delay) => {}
            _ = &mut cancelled => return,
        }
    }
}

impl Session {
    /// Opens the connection and its listener, trying until it works (for example, when starting offline).
    async fn connect(&mut self) -> (FirestoreDb, Listener, Incoming) {
        loop {
            match self.open().await {
                Ok(connection) => {
                    self.connect_failing = false;
                    set_status(&self.app, SyncStatus::Running);
                    let encryption = if self.key.is_some() { " Contenido cifrado." } else { "" };
                    log(&self.app, LogType::Success, format!("Sincronizando para el usuario \"{}\".{encryption}", self.user_id));
                    error_report::send_waiting(&self.app);
                    return connection;
                }
                Err(error) => {
                    if !self.connect_failing {
                        log(&self.app, LogType::Error, format!("Sin conexión con Firebase, se reintentará: {error}"));
                        self.connect_failing = true;
                    }
                    tokio::time::sleep(RECONNECT_DELAY).await;
                }
            }
        }
    }

    async fn open(&self) -> FirestoreResult<(FirestoreDb, Listener, Incoming)> {
        let db = self.app.state::<Firebase>().db().await?;
        let (listener, incoming) = self.listen(&db).await?;
        Ok((db, listener, incoming))
    }

    /// One listener for the user's clipboard document and the two notification documents that concern them.
    async fn listen(&self, db: &FirestoreDb) -> FirestoreResult<(Listener, Incoming)> {
        let params = FirestoreListenerParams::new().with_idle_timeout(LISTENER_IDLE_TIMEOUT);
        let mut listener = db.create_listener_with_params(FirestoreMemListenStateStorage::new(), params).await?;
        db.fluent()
            .select()
            .by_id_in(collections::CLIPBOARD)
            .batch_listen([self.user_id.as_str()])
            .add_target(CLIPBOARD_TARGET, &mut listener)?;
        db.fluent()
            .select()
            .by_id_in(collections::NOTIFICATIONS)
            .batch_listen([messages::GLOBAL_ID, self.user_id.as_str()])
            .add_target(NOTIFICATIONS_TARGET, &mut listener)?;

        let (sender, incoming) = watch::channel(None);
        let app = self.app.clone();
        listener
            .start(move |event| {
                on_event(&app, &sender, event);
                std::future::ready(Ok(()))
            })
            .await?;
        Ok((listener, incoming))
    }

    /// Handles changes on both sides until the connection stops being good.
    async fn exchange(&mut self, db: &FirestoreDb, incoming: &mut Incoming) -> Reconnect {
        // The stored document has the usage counts, which the next upload continues.
        let _ = tokio::time::timeout(FIRST_SNAPSHOT_WAIT, incoming.changed()).await;
        if self.first_connection {
            // When starting, the stored text wins over the one that was in the clipboard.
            self.take_incoming(incoming);
            self.write_remote().await;
            self.first_connection = false;
        } else {
            // After reconnecting, only the counts are taken now; the text, below, after any copy made here meanwhile.
            if let Some(doc) = &*incoming.borrow() {
                self.usage = std::mem::take(&mut self.usage).newest(doc.usage.clone());
            }
            incoming.mark_changed();
        }
        let mut tick = tokio::time::interval(TICK);
        tick.set_missed_tick_behavior(MissedTickBehavior::Delay);
        let mut last_tick = Instant::now();
        loop {
            tokio::select! {
                // In this order: if both sides changed, the copy made here is the newer one.
                biased;
                _ = self.changes.changed() => {
                    self.settle().await;
                    self.local_pending = true;
                }
                received = incoming.changed() => {
                    if received.is_err() {
                        error_report::report(&self.app, "the Firestore listener ended");
                        return Reconnect(RECONNECT_DELAY);
                    }
                    self.take_incoming(incoming);
                }
                _ = tick.tick() => {
                    if last_tick.elapsed() > SLEEP_GAP {
                        log(&self.app, LogType::Info, "El equipo ha estado suspendido: se vuelve a conectar.");
                        return Reconnect(Duration::ZERO);
                    }
                    last_tick = Instant::now();
                }
            }
            if let Err(reconnect) = self.upload_local(db).await {
                return reconnect;
            }
            self.write_remote().await;
        }
    }

    /// Waits until the clipboard stops changing for a moment.
    async fn settle(&mut self) {
        let limit = Instant::now() + SETTLE_LIMIT;
        while Instant::now() < limit && tokio::time::timeout(SETTLE_DELAY, self.changes.changed()).await.is_ok() {}
    }

    fn take_incoming(&mut self, incoming: &mut Incoming) {
        let Some(doc) = incoming.borrow_and_update().clone() else { return };
        self.usage = std::mem::take(&mut self.usage).newest(doc.usage.clone());
        let text = match doc.text(self.key.as_ref(), &self.user_id) {
            Ok(text) => text,
            Err(reason) => return self.announce_unreadable(&doc, reason),
        };
        if self.known.take_remote(&text) {
            self.remote_pending = Some(RemoteText { text, machine_id: doc.machine_id });
        } else if canonical(&text) == self.known.local {
            // Both sides are equal: an older text that could not be written no longer matters.
            self.remote_pending = None;
        }
    }

    fn announce_unreadable(&mut self, doc: &ClipboardDoc, reason: Unreadable) {
        let document = format!("{} {}", doc.machine_id, doc.timestamp);
        // What this machine uploaded before changing the password.
        if document == self.unreadable || doc.machine_id == machine_id() {
            return;
        }
        self.unreadable = document;
        let cause = match reason {
            Unreadable::NoPassword => "está cifrado. Pon aquí la misma contraseña de cifrado",
            Unreadable::WrongPassword => "está cifrado con otra contraseña. Pon la misma en los dos equipos",
            Unreadable::NotEncrypted => "llega sin cifrar. Ese equipo necesita la versión 2.0.0 o superior y la misma contraseña de cifrado",
        };
        log(&self.app, LogType::Warning, format!("Se ignora un texto de {}: {cause}.", doc.machine_id));
    }

    /// Uploads the pending local change. It stays pending while the clipboard is locked or the upload fails.
    async fn upload_local(&mut self, db: &FirestoreDb) -> Result<(), Reconnect> {
        if !self.local_pending {
            return Ok(());
        }
        let text = match clipboard::read_text().await {
            Reading::Text(text) => text,
            Reading::NoText => {
                self.local_pending = false;
                return Ok(());
            }
            Reading::Busy => return Ok(()),
        };
        self.local_pending = false;
        if !self.known.take_local(&text) {
            return Ok(());
        }
        // The copy just made here is newer than a remote one that could not be written yet.
        self.remote_pending = None;
        let (content, encrypted) = match &self.key {
            Some(key) => match key.encrypt(&text, &self.user_id) {
                Some(encrypted) => (None, Some(encrypted)),
                None => {
                    log(&self.app, LogType::Error, "No se pudo cifrar el texto copiado: no se sube.");
                    return Ok(());
                }
            },
            None => (Some(text.clone()), None),
        };
        let size = content.as_ref().or(encrypted.as_ref()).map_or(0, String::len);
        if size > MAX_CONTENT_BYTES {
            let encryption = if self.key.is_some() { " ya cifrado" } else { "" };
            log(&self.app, LogType::Warning, format!("El texto copiado ocupa {} KB{encryption} y supera el límite de 1 MB: no se sube.", size / 1024));
            return Ok(());
        }

        let usage = self.usage.plus(text.chars().count(), madrid_now().date());
        let doc = ClipboardDoc {
            content,
            encrypted,
            machine_id: machine_id(),
            timestamp: madrid_now().strftime("%Y/%m/%d-%H:%M:%S").to_string(),
            app_version: self.app.package_info().version.to_string(),
            usage: usage.clone(),
        };
        let Err(error) = db.fluent().update().in_col(collections::CLIPBOARD).document_id(&self.user_id).object(&doc).execute::<()>().await else {
            self.upload_failing = false;
            self.usage = usage;
            log(&self.app, LogType::Upload, "Portapapeles subido.");
            history::record(&self.app, &text, None);
            return Ok(());
        };
        if !self.upload_failing {
            self.upload_failing = true;
            log(&self.app, LogType::Error, format!("Error al subir, se reintentará: {error}"));
            error_report::report(&self.app, format!("upload: {error:?}"));
        }
        // Firestore rejects this very text: sending it again would fail forever.
        if matches!(&error, FirestoreError::DatabaseError(error) if error.public.code.contains("InvalidArgument")) {
            return Ok(());
        }
        self.known.forget_local();
        self.local_pending = true;
        Err(Reconnect(RECONNECT_DELAY))
    }

    /// Writes the pending remote text. It stays pending while the clipboard is locked.
    async fn write_remote(&mut self) {
        let Some(remote) = self.remote_pending.take() else { return };
        // After a restart the stored text is often the one already copied here.
        if matches!(clipboard::read_text().await, Reading::Text(current) if canonical(&current) == canonical(&remote.text)) {
            self.known.written(&remote.text);
            return;
        }
        match clipboard::write_text(remote.text.clone()).await {
            Ok(()) => {
                self.write_failing = None;
                self.write_reported = false;
                self.known.written(&remote.text);
                log(&self.app, LogType::Download, format!("Portapapeles descargado (de {}).", remote.machine_id));
                history::record(&self.app, &remote.text, Some(&remote.machine_id));
            }
            Err(error) => {
                if self.write_failing.is_none() {
                    log(&self.app, LogType::Warning, "El portapapeles está ocupado por otra aplicación o la sesión está bloqueada. Se reintentará.");
                }
                let since = *self.write_failing.get_or_insert_with(Instant::now);
                if !self.write_reported && since.elapsed() > WRITE_FAILURE_LIMIT {
                    self.write_reported = true;
                    error_report::report(&self.app, format!("clipboard write: {error:?}"));
                }
                self.remote_pending = Some(remote);
            }
        }
    }
}

fn on_event(app: &AppHandle, clipboard: &watch::Sender<Option<ClipboardDoc>>, event: FirestoreListenEvent) {
    match event {
        FirestoreListenEvent::DocumentChange(change) => {
            let Some(doc) = change.document else { return };
            match collection_id(&doc.name) {
                collections::CLIPBOARD => {
                    if let Ok(content) = FirestoreDb::deserialize_doc_to::<ClipboardDoc>(&doc) {
                        clipboard.send_replace(Some(content));
                    }
                }
                collections::NOTIFICATIONS => messages::apply(app, document_id(&doc.name), &doc),
                _ => {}
            }
        }
        FirestoreListenEvent::DocumentDelete(deleted) if collection_id(&deleted.document) == collections::NOTIFICATIONS => {
            messages::remove(app, document_id(&deleted.document));
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uploads_only_new_text() {
        let mut known = Known::default();
        assert!(known.take_local("hola"));
        assert!(!known.take_local("hola"), "same text twice");
        assert!(!known.take_local("   "), "blank text");
        assert!(!known.take_remote("hola"), "our own upload coming back");
    }

    #[test]
    fn does_not_upload_what_it_downloaded() {
        let mut known = Known::default();
        assert!(known.take_remote("uno\ndos"));
        known.written("uno\ndos");
        assert!(!known.take_local("uno\r\ndos"), "a remote desktop changed the line endings");
    }

    #[test]
    fn a_text_copied_again_is_new() {
        let mut known = Known::default();
        assert!(known.take_local("https://example.com"));
        assert!(known.take_remote("otro"));
        known.written("otro");
        assert!(known.take_local("https://example.com"));
    }

    #[test]
    fn a_failed_upload_is_tried_again() {
        let mut known = Known::default();
        known.take_remote("viejo");
        known.written("viejo");
        assert!(known.take_local("nuevo"));
        known.forget_local();
        assert!(!known.take_remote("viejo"), "Firestore sends it again after reconnecting");
        assert!(known.take_local("nuevo"));
    }

    fn doc(content: Option<&str>, encrypted: Option<String>) -> ClipboardDoc {
        ClipboardDoc {
            content: content.map(str::to_string),
            encrypted,
            machine_id: "PC".into(),
            timestamp: String::new(),
            app_version: String::new(),
            usage: Usage::default(),
        }
    }

    #[test]
    fn reads_only_what_matches_the_password() {
        let key = Key::from_password("clave").unwrap();
        let encrypted = || key.encrypt("secreto", "u");
        assert_eq!(doc(Some("hola"), None).text(None, "u"), Ok("hola".into()));
        assert_eq!(doc(None, encrypted()).text(Some(&key), "u"), Ok("secreto".into()));
        assert_eq!(doc(None, encrypted()).text(None, "u"), Err(Unreadable::NoPassword));
        assert_eq!(doc(Some("hola"), None).text(Some(&key), "u"), Err(Unreadable::NotEncrypted));
        let other = Key::from_password("otra").unwrap();
        assert_eq!(doc(None, encrypted()).text(Some(&other), "u"), Err(Unreadable::WrongPassword));
    }

    #[test]
    fn an_encrypted_document_has_no_readable_content() {
        let json = serde_json::to_value(doc(None, Some("abc".into()))).unwrap();
        assert!(json.get("content").is_none(), "the Electron version must ignore it");
        // The one Electron writes is still read.
        let legacy = r#"{"content":"hola","machineId":"PC","timestamp":"t","appVersion":"1.0.7"}"#;
        assert_eq!(serde_json::from_str::<ClipboardDoc>(legacy).unwrap().text(None, "u"), Ok("hola".into()));
    }
}
