//! Firestore connection shared by the whole app.

mod credentials;

use firestore::{FirestoreDb, FirestoreDbOptions, FirestoreResult};
use std::time::Duration;
use tokio::sync::Mutex;

const PROJECT_ID: &str = "test-clipboard-83860";
// Not a secret: a Firebase web API key only identifies the project, like in any web app.
// Access is decided by the Firestore security rules.
const API_KEY: &str = "AIzaSyA3ZU5UZIVs-wyNIvTNwV3sOZCMIAbaoK0";

/// Without it, a request on a connection that died while the machine slept would hang for minutes.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

/// Firestore collections, the same ones the Electron version uses.
pub mod collections {
    /// One document per user id with the last copied text.
    pub const CLIPBOARD: &str = "clipboard-v2";
    /// `global` plus one document per user id.
    pub const NOTIFICATIONS: &str = "notifications";
    /// One empty document per admin password, named after its SHA-256.
    pub const ADMIN: &str = "admin_config";
    pub const ERRORS: &str = "errors";
}

#[derive(Default)]
pub struct Firebase(Mutex<Option<FirestoreDb>>);

impl Firebase {
    /// The shared connection, opened on first use. A failed attempt is retried on the next call.
    pub async fn db(&self) -> FirestoreResult<FirestoreDb> {
        let mut shared = self.0.lock().await;
        if let Some(db) = &*shared {
            return Ok(db.clone());
        }
        let options = FirestoreDbOptions::new(PROJECT_ID.to_string()).with_request_timeout(REQUEST_TIMEOUT);
        let db = FirestoreDb::with_options_auth(options, credentials::api_key(API_KEY)).await?;
        *shared = Some(db.clone());
        Ok(db)
    }

    /// Drops the connection, so the next call to `db` opens a new one.
    pub async fn reset(&self) {
        *self.0.lock().await = None;
    }
}

/// Id of a document from its full name (`projects/.../documents/<collection>/<id>`).
pub fn document_id(name: &str) -> &str {
    name.rsplit('/').next().unwrap_or(name)
}

/// Collection of a document from its full name.
pub fn collection_id(name: &str) -> &str {
    name.rsplit('/').nth(1).unwrap_or_default()
}

/// Milliseconds since the Unix epoch, the format the Electron version stores in `timestamp` fields.
pub fn now_millis() -> i64 {
    jiff::Timestamp::now().as_millisecond()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_document_names() {
        let name = "projects/p/databases/(default)/documents/clipboard-v2/someone@example.com";
        assert_eq!(document_id(name), "someone@example.com");
        assert_eq!(collection_id(name), "clipboard-v2");
    }
}
