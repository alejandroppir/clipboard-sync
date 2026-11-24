//! System clipboard access (text only) and change notifications.

use clipboard_master::{CallbackResult, ClipboardHandler, Master};
use std::sync::OnceLock;
use std::time::Duration;
use tokio::sync::watch;

/// A browser or a remote desktop can hold the clipboard for a moment right after a copy.
const READ_ATTEMPTS: u32 = 4;
const READ_RETRY_DELAY: Duration = Duration::from_millis(150);
/// Used only if Windows refuses the change listener: then the clipboard is checked this often instead.
const FALLBACK_POLL: Duration = Duration::from_secs(1);

static CHANGES: OnceLock<watch::Sender<()>> = OnceLock::new();

pub enum Reading {
    Text(String),
    /// It holds something else: an image, files…
    NoText,
    /// Another app has it locked. Worth reading again later.
    Busy,
}

/// Current clipboard text, trying a few times while it is not available.
pub async fn read_text() -> Reading {
    let mut attempt = 1;
    loop {
        let error = match blocking(|| arboard::Clipboard::new()?.get_text()).await {
            Ok(text) => return Reading::Text(text),
            Err(error) => error,
        };
        if attempt == READ_ATTEMPTS {
            return match error {
                arboard::Error::ContentNotAvailable | arboard::Error::ConversionFailure => Reading::NoText,
                _ => Reading::Busy,
            };
        }
        attempt += 1;
        tokio::time::sleep(READ_RETRY_DELAY).await;
    }
}

/// Fails while the clipboard is locked by another app.
pub async fn write_text(text: String) -> Result<(), arboard::Error> {
    blocking(move || arboard::Clipboard::new()?.set_text(text)).await
}

/// Runs a clipboard operation off the async threads: it waits for the app that owns the content, which may be hung.
async fn blocking<T: Send + 'static>(operation: impl FnOnce() -> Result<T, arboard::Error> + Send + 'static) -> Result<T, arboard::Error> {
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .unwrap_or_else(|error| Err(arboard::Error::Unknown { description: error.to_string() }))
}

/// Fires on every clipboard change made after this call, by any app (this one included).
/// The first call starts the Windows listener, which lives as long as the app.
pub fn changes() -> watch::Receiver<()> {
    CHANGES
        .get_or_init(|| {
            let (sender, _) = watch::channel(());
            let notifier = Notifier(sender.clone());
            std::thread::spawn(move || listen(notifier));
            sender
        })
        .subscribe()
}

struct Notifier(watch::Sender<()>);

impl ClipboardHandler for Notifier {
    fn on_clipboard_change(&mut self) -> CallbackResult {
        self.0.send_replace(());
        CallbackResult::Next
    }

    fn on_clipboard_error(&mut self, _error: std::io::Error) -> CallbackResult {
        CallbackResult::Next
    }
}

/// Blocks this thread on Windows' clipboard messages (`AddClipboardFormatListener`). It only returns on error.
fn listen(notifier: Notifier) {
    let sender = notifier.0.clone();
    if let Ok(mut master) = Master::new(notifier) {
        let _ = master.run();
    }
    // Without the listener nothing would ever be uploaded: fall back to checking once a second.
    loop {
        std::thread::sleep(FALLBACK_POLL);
        sender.send_replace(());
    }
}
