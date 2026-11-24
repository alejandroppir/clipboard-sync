//! Activity log shown in the window.
//!
//! The lines are kept in memory because the window is destroyed when closed: when it opens
//! again it shows what happened in the meantime.

use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::VecDeque;
use std::sync::Mutex;
use strum::VariantNames;
use tauri::{AppHandle, Manager};
use tauri_specta::Event;

/// The window keeps the same number of lines.
pub const MAX_ENTRIES: usize = 500;

/// What a line is about; the window picks its icon and colour from it.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, VariantNames)]
#[serde(rename_all = "camelCase")]
#[strum(serialize_all = "camelCase")]
pub enum LogType {
    Info,
    Success,
    Warning,
    Error,
    Upload,
    Download,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    /// Local time, `HH:MM:SS`.
    pub time: String,
    // `type` is a Rust keyword: `r#` allows it as a name. In TypeScript it is plain `type`.
    pub r#type: LogType,
    pub message: String,
}

#[derive(Default)]
pub struct ActivityLog(Mutex<VecDeque<LogEntry>>);

impl ActivityLog {
    pub fn entries(&self) -> Vec<LogEntry> {
        self.0.lock().unwrap().iter().cloned().collect()
    }
}

/// Adds a line to the log and sends it to the window, if it is open.
pub fn log(app: &AppHandle, log_type: LogType, message: impl Into<String>) {
    let entry = LogEntry {
        time: jiff::Zoned::now().strftime("%H:%M:%S").to_string(),
        r#type: log_type,
        message: message.into(),
    };
    {
        let state = app.state::<ActivityLog>();
        let mut entries = state.0.lock().unwrap();
        if entries.len() == MAX_ENTRIES {
            entries.pop_front();
        }
        entries.push_back(entry.clone());
    }
    // Fails only when no window is listening, which is expected while the app sits in the tray.
    let _ = entry.emit(app);
}
