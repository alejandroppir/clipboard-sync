//! The last texts synced, to copy one again with a click.
//!
//! Kept in memory only: nothing reaches the disk, so a copied password is gone when the app closes.

use serde::Serialize;
use specta::Type;
use std::collections::VecDeque;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri_specta::Event;

const MAX_ITEMS: usize = 20;
/// The window only shows a few lines, so it never receives the whole text (up to 1 MB each).
const PREVIEW_CHARS: usize = 300;

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: u32,
    pub preview: String,
    /// Machine it came from; `None` when it was copied here.
    pub from: Option<String>,
    /// Local time, `HH:MM`.
    pub time: String,
}

/// The whole list, newest first, sent to the window whenever it changes.
#[derive(Debug, Clone, Serialize, Type, Event)]
pub struct HistoryChanged(pub Vec<HistoryEntry>);

struct Item {
    entry: HistoryEntry,
    text: String,
}

#[derive(Default)]
pub struct History {
    items: Mutex<VecDeque<Item>>,
    next_id: Mutex<u32>,
}

impl History {
    pub fn entries(&self) -> Vec<HistoryEntry> {
        self.items.lock().unwrap().iter().map(|item| item.entry.clone()).collect()
    }

    pub fn text(&self, id: u32) -> Option<String> {
        self.items.lock().unwrap().iter().find(|item| item.entry.id == id).map(|item| item.text.clone())
    }

    /// Puts `text` first; the same text copied again moves up instead of repeating.
    fn push(&self, text: &str, from: Option<&str>) {
        let id = {
            let mut next_id = self.next_id.lock().unwrap();
            *next_id += 1;
            *next_id
        };
        let entry = HistoryEntry {
            id,
            preview: text.chars().take(PREVIEW_CHARS).collect(),
            from: from.map(str::to_string),
            time: jiff::Zoned::now().strftime("%H:%M").to_string(),
        };
        let mut items = self.items.lock().unwrap();
        items.retain(|item| item.text != text);
        items.push_front(Item { entry, text: text.to_string() });
        items.truncate(MAX_ITEMS);
    }
}

/// Records a synced text and sends the new list to the window, if it is open.
pub fn record(app: &AppHandle, text: &str, from: Option<&str>) {
    let history = app.state::<History>();
    history.push(text, from);
    let _ = HistoryChanged(history.entries()).emit(app);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_the_newest_without_repeats() {
        let history = History::default();
        for n in 0..25 {
            history.push(&format!("texto {n}"), None);
        }
        history.push("texto 10", Some("PC-2"));

        let entries = history.entries();
        assert_eq!(entries.len(), MAX_ITEMS);
        assert_eq!(entries[0].preview, "texto 10");
        assert_eq!(entries[0].from.as_deref(), Some("PC-2"));
        assert_eq!(entries.iter().filter(|entry| entry.preview == "texto 10").count(), 1);
        assert_eq!(history.text(entries[0].id).as_deref(), Some("texto 10"));
    }

    #[test]
    fn preview_is_cut_on_characters() {
        let history = History::default();
        history.push(&"ñ".repeat(PREVIEW_CHARS + 50), None);
        assert_eq!(history.entries()[0].preview.chars().count(), PREVIEW_CHARS);
    }
}
