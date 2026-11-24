//! Admin access and the list of users with the version each one runs.

use crate::firebase::collections;
use crate::sync::madrid_now;
use crate::usage::{Usage, UsageSummary};
use firestore::FirestoreDb;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use specta::Type;
use std::sync::atomic::{AtomicBool, Ordering};

/// Whether the admin password was entered in this run. It only unlocks the admin screens of this app;
/// it is not a security boundary, because Firestore has no authentication yet.
#[derive(Default)]
pub struct AdminSession(AtomicBool);

impl AdminSession {
    pub fn is_unlocked(&self) -> bool {
        self.0.load(Ordering::Relaxed)
    }
}

/// The fields of a `clipboard-v2` document the admin list reads.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UserDoc {
    #[serde(rename = "_firestore_id")]
    id: String,
    app_version: Option<String>,
    timestamp: Option<String>,
    machine_id: Option<String>,
    #[serde(default)]
    usage: Usage,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct UserInfo {
    pub user_id: String,
    pub app_version: Option<String>,
    /// Last upload, Madrid time.
    pub last_seen: Option<String>,
    pub machine_id: Option<String>,
    /// Characters copied.
    pub usage: UsageSummary,
}

/// Checks the password: valid when `admin_config/{sha256(password)}` exists (see `scripts/admin-password-hash.mjs`).
pub async fn login(db: &FirestoreDb, session: &AdminSession, password: &str) -> firestore::FirestoreResult<bool> {
    let hash = hex(&Sha256::digest(password.as_bytes()));
    let valid = db.fluent().select().by_id_in(collections::ADMIN).one(hash).await?.is_some();
    session.0.store(valid, Ordering::Relaxed);
    Ok(valid)
}

/// Users that have uploaded at least once. Only the listed fields are read, never the clipboard content.
pub async fn list(db: &FirestoreDb) -> firestore::FirestoreResult<Vec<UserInfo>> {
    let docs: Vec<UserDoc> = db
        .fluent()
        .select()
        .fields(["appVersion", "timestamp", "machineId", "usage"])
        .from(collections::CLIPBOARD)
        .obj()
        .query()
        .await?;
    let today = madrid_now().date();
    let mut users: Vec<UserInfo> = docs
        .into_iter()
        .map(|doc| UserInfo {
            user_id: doc.id,
            app_version: doc.app_version,
            last_seen: doc.timestamp,
            machine_id: doc.machine_id,
            usage: doc.usage.summary(today),
        })
        .collect();
    // `yyyy/MM/dd-HH:mm:ss` sorts as text: most recent first.
    users.sort_by(|a, b| b.last_seen.cmp(&a.last_seen));
    Ok(users)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashes_like_node_crypto() {
        // Node: crypto.createHash('sha256').update('abc').digest('hex')
        assert_eq!(hex(&Sha256::digest(b"abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }
}
