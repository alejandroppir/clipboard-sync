//! Messages from the admin: one for everybody (`notifications/global`) and one per user
//! (`notifications/{userId}`).
//!
//! The global message shows while `active` is true, until it is dismissed in this run. A user message
//! shows until the user dismisses it, which sets `read` to true. The user's goes first.

use crate::firebase::{collections, document_id, now_millis};
use firestore::FirestoreDb;
use firestore::gcloud_sdk::google::firestore::v1::Document;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri_specta::Event;

pub const GLOBAL_ID: &str = "global";

/// Firestore document. Every field is optional because the admin may have written only some of them.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NotificationDoc {
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    active: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    read: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    timestamp: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Notification {
    pub message: String,
    pub global: bool,
}

/// The notification currently shown, sent to the window whenever it changes.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct NotificationChanged(pub Option<Notification>);

/// Admin view of a notification document.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NotificationEntry {
    pub id: String,
    pub message: String,
    pub read: bool,
    pub active: bool,
}

/// A message received, kept after dismissing it: the listener sends it again when it reconnects.
struct Message {
    text: String,
    timestamp: Option<i64>,
    dismissed: bool,
}

#[derive(Default)]
struct Inbox {
    user: Option<Message>,
    global: Option<Message>,
}

impl Inbox {
    fn slot(&mut self, doc_id: &str) -> &mut Option<Message> {
        if doc_id == GLOBAL_ID { &mut self.global } else { &mut self.user }
    }

    fn receive(&mut self, doc_id: &str, text: Option<String>, timestamp: Option<i64>) {
        let slot = self.slot(doc_id);
        *slot = text.map(|text| {
            let dismissed = slot.as_ref().is_some_and(|old| old.dismissed && old.text == text && old.timestamp == timestamp);
            Message { text, timestamp, dismissed }
        });
    }

    fn current(&self) -> Option<Notification> {
        let shown = |slot: &Option<Message>, global| {
            slot.as_ref().filter(|message| !message.dismissed).map(|message| Notification { message: message.text.clone(), global })
        };
        shown(&self.user, false).or_else(|| shown(&self.global, true))
    }
}

#[derive(Default)]
pub struct MessageCenter(Mutex<Inbox>);

impl MessageCenter {
    pub fn current(&self) -> Option<Notification> {
        self.0.lock().unwrap().current()
    }
}

/// Changes the inbox and tells the window what to show now.
fn update(app: &AppHandle, change: impl FnOnce(&mut Inbox)) {
    let current = {
        let center = app.state::<MessageCenter>();
        let mut inbox = center.0.lock().unwrap();
        change(&mut inbox);
        inbox.current()
    };
    let _ = NotificationChanged(current).emit(app);
}

/// Forgets every message, because the user changed.
pub fn clear(app: &AppHandle) {
    update(app, |inbox| *inbox = Inbox::default());
}

/// One of the user's notification documents was deleted.
pub fn remove(app: &AppHandle, doc_id: &str) {
    update(app, |inbox| *inbox.slot(doc_id) = None);
}

/// Reacts to a change in one of the user's notification documents.
pub fn apply(app: &AppHandle, doc_id: &str, doc: &Document) {
    let Ok(data) = FirestoreDb::deserialize_doc_to::<NotificationDoc>(doc) else { return };
    let visible = if doc_id == GLOBAL_ID { data.active == Some(true) } else { data.read != Some(true) };
    let text = data.message.filter(|message| visible && !message.trim().is_empty());
    update(app, |inbox| inbox.receive(doc_id, text, data.timestamp));
}

/// Hides the current notification; a user message is also marked as read in Firestore.
pub async fn dismiss(app: &AppHandle, db: &FirestoreDb, user_id: &str) -> firestore::FirestoreResult<()> {
    let Some(shown) = app.state::<MessageCenter>().current() else { return Ok(()) };
    update(app, |inbox| {
        let slot = if shown.global { &mut inbox.global } else { &mut inbox.user };
        if let Some(message) = slot {
            message.dismissed = true;
        }
    });
    if !shown.global {
        let doc = NotificationDoc { read: Some(true), ..Default::default() };
        write_fields(db, user_id, &doc, &["read"]).await?;
    }
    Ok(())
}

/// Admin: all notification documents.
pub async fn list(db: &FirestoreDb) -> firestore::FirestoreResult<Vec<NotificationEntry>> {
    let docs = db.fluent().select().from(collections::NOTIFICATIONS).query().await?;
    Ok(docs
        .iter()
        .filter_map(|doc| {
            let data = FirestoreDb::deserialize_doc_to::<NotificationDoc>(doc).ok()?;
            Some(NotificationEntry {
                id: document_id(&doc.name).to_string(),
                message: data.message.unwrap_or_default(),
                read: data.read == Some(true),
                active: data.active == Some(true),
            })
        })
        .collect())
}

/// Admin: creates or replaces the message for `target` (`global` or a user id) and shows it again.
pub async fn save(db: &FirestoreDb, target: &str, message: &str) -> firestore::FirestoreResult<()> {
    let global = target == GLOBAL_ID;
    let doc = NotificationDoc {
        message: Some(message.to_string()),
        active: global.then_some(true),
        read: (!global).then_some(false),
        timestamp: Some(now_millis()),
    };
    let state_field = if global { "active" } else { "read" };
    write_fields(db, target, &doc, &["message", state_field, "timestamp"]).await
}

pub async fn delete(db: &FirestoreDb, id: &str) -> firestore::FirestoreResult<()> {
    db.fluent().delete().from(collections::NOTIFICATIONS).document_id(id).execute().await
}

/// Writes only `fields`, keeping the rest of the document, like `setDoc(..., { merge: true })`.
async fn write_fields(db: &FirestoreDb, id: &str, doc: &NotificationDoc, fields: &[&str]) -> firestore::FirestoreResult<()> {
    db.fluent()
        .update()
        .fields(fields.iter().copied())
        .in_col(collections::NOTIFICATIONS)
        .document_id(id)
        .object(doc)
        .execute::<()>()
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shown(inbox: &Inbox) -> Option<String> {
        inbox.current().map(|notification| notification.message)
    }

    #[test]
    fn a_dismissed_message_does_not_come_back_until_it_is_sent_again() {
        let mut inbox = Inbox::default();
        inbox.receive(GLOBAL_ID, Some("aviso".into()), Some(1));
        inbox.global.as_mut().unwrap().dismissed = true;
        inbox.receive(GLOBAL_ID, Some("aviso".into()), Some(1));
        assert_eq!(shown(&inbox), None, "the listener reconnected");
        inbox.receive(GLOBAL_ID, Some("aviso".into()), Some(2));
        assert_eq!(shown(&inbox).as_deref(), Some("aviso"), "the admin saved it again");
    }

    #[test]
    fn the_user_message_goes_first_and_then_the_global_one() {
        let mut inbox = Inbox::default();
        inbox.receive("someone@example.com", Some("para ti".into()), None);
        inbox.receive(GLOBAL_ID, Some("para todos".into()), None);
        assert_eq!(shown(&inbox).as_deref(), Some("para ti"));
        inbox.receive("someone@example.com", None, None);
        assert_eq!(shown(&inbox).as_deref(), Some("para todos"));
    }
}
