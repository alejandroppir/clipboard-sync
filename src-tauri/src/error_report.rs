//! Sends errors to the `errors` collection, where the admin reviews them.
//!
//! They wait in memory until they can be sent: the most interesting ones happen without a connection.

use crate::config;
use crate::firebase::{Firebase, collections};
use firestore::{FirestoreDb, FirestoreResult};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::VecDeque;
use std::hash::{BuildHasher, Hasher};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

const RANDOM_SUFFIX_LEN: usize = 6;
const BASE36: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
/// More errors than this while offline are more of the same: the oldest are dropped.
const MAX_WAITING: usize = 50;
const MAX_TRACE_CHARS: usize = 5_000;
/// Errors the admin sees at once. Each one is a read.
const LIST_LIMIT: u32 = 50;

/// The Electron version only writes the first three fields.
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct ErrorDoc {
    #[serde(rename(deserialize = "_firestore_id"), skip_serializing)]
    id: String,
    user_id: String,
    /// `yyyy/MM/dd`
    date: String,
    trace: String,
    app_version: String,
    machine_id: String,
}

/// An error as the admin sees it.
#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ErrorInfo {
    pub id: String,
    /// `yyyy/MM/dd HH:mm`
    pub time: String,
    pub user_id: String,
    pub app_version: String,
    pub machine_id: String,
    pub trace: String,
}

#[derive(Default)]
pub struct ErrorQueue(Mutex<VecDeque<ErrorDoc>>);

/// Sends `trace` in the background, now or when there is a connection again.
pub fn report(app: &AppHandle, trace: impl Into<String>) {
    let now = jiff::Zoned::now();
    let doc = ErrorDoc {
        // Same id format as the Electron version: sortable by time, with a random suffix.
        id: format!("{}+{}", now.strftime("%Y%m%d%H%M%S"), random_suffix()),
        user_id: config::user_id().unwrap_or_else(|| "unknown".into()),
        date: now.strftime("%Y/%m/%d").to_string(),
        trace: trace.into().chars().take(MAX_TRACE_CHARS).collect(),
        app_version: app.package_info().version.to_string(),
        machine_id: crate::sync::machine_id(),
    };
    {
        let queue = app.state::<ErrorQueue>();
        let mut waiting = queue.0.lock().unwrap();
        if waiting.len() == MAX_WAITING {
            waiting.pop_front();
        }
        waiting.push_back(doc);
    }
    send_waiting(app);
}

/// Sends what is waiting. Called again on every new connection.
pub fn send_waiting(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let Ok(db) = app.state::<Firebase>().db().await else { return };
        let queue = app.state::<ErrorQueue>();
        loop {
            let Some(doc) = queue.0.lock().unwrap().pop_front() else { return };
            let sent = db.fluent().update().in_col(collections::ERRORS).document_id(&doc.id).object(&doc).execute::<()>().await;
            if sent.is_err() {
                // Not reported as another error: it would never end.
                queue.0.lock().unwrap().push_front(doc);
                return;
            }
        }
    });
}

/// Admin: the latest errors, newest first.
pub async fn list(db: &FirestoreDb) -> FirestoreResult<Vec<ErrorInfo>> {
    // Those of the same date come by id, which has the time.
    let docs: Vec<ErrorDoc> = db
        .fluent()
        .select()
        .from(collections::ERRORS)
        .order(|o| o.fields([o.field("date").desc()]))
        .limit(LIST_LIMIT)
        .obj()
        .query()
        .await?;
    Ok(docs
        .into_iter()
        .map(|doc| ErrorInfo {
            time: time_of(&doc.id).unwrap_or(doc.date),
            id: doc.id,
            user_id: doc.user_id,
            app_version: doc.app_version,
            machine_id: doc.machine_id,
            trace: doc.trace,
        })
        .collect())
}

pub async fn delete(db: &FirestoreDb, ids: &[String]) -> FirestoreResult<()> {
    let deletions = ids.iter().map(|id| db.fluent().delete().from(collections::ERRORS).document_id(id).execute());
    futures_util::future::try_join_all(deletions).await.map(drop)
}

/// `yyyy/MM/dd HH:mm` from an id like `20261124093015+abc123`.
fn time_of(id: &str) -> Option<String> {
    let digits = id.get(..12).filter(|digits| digits.bytes().all(|byte| byte.is_ascii_digit()))?;
    Some(format!("{}/{}/{} {}:{}", &digits[..4], &digits[4..6], &digits[6..8], &digits[8..10], &digits[10..]))
}

/// Short random text; the standard library's random hasher seed avoids pulling in a random crate.
fn random_suffix() -> String {
    let mut value = std::collections::hash_map::RandomState::new().build_hasher().finish();
    (0..RANDOM_SUFFIX_LEN)
        .map(|_| {
            let digit = BASE36[(value % 36) as usize] as char;
            value /= 36;
            digit
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_time_from_the_id() {
        assert_eq!(time_of("20260810145247+alrpup").as_deref(), Some("2026/08/10 14:52"));
        assert_eq!(time_of("other"), None);
    }
}
