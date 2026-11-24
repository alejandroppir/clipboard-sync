//! Clipboard synchronisation for the configured user: turn it on and off, and pause. The work is in `session`.

mod session;

use crate::activity::{LogType, log};
use crate::{config, tray};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use strum::VariantNames;
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Manager};
use tauri_specta::Event;
use tokio::sync::oneshot;

/// A timer may not advance while the machine sleeps, so a pause is measured against the clock this often.
const PAUSE_CHECK: Duration = Duration::from_secs(10);

const TIME_ZONE: &str = "Europe/Madrid";

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, Type, Event, VariantNames)]
#[serde(tag = "state", rename_all = "camelCase")]
#[strum(serialize_all = "camelCase")]
pub enum SyncStatus {
    /// Turned off by the user, until they turn it on again.
    #[default]
    Disabled,
    Connecting,
    Running,
    /// Stopped for a while; it starts again by itself at `until` (local time, `HH:MM`).
    Paused { until: String },
    Error { detail: String },
}

#[derive(Default)]
enum Work {
    #[default]
    None,
    Session { cancel: oneshot::Sender<()>, task: JoinHandle<()> },
    /// Dropping the sender cancels the timer that ends the pause.
    Pause { _cancel: oneshot::Sender<()> },
}

#[derive(Default)]
pub struct SyncService {
    /// Held during a whole operation, so two of them never mix.
    work: tokio::sync::Mutex<Work>,
    status: Mutex<SyncStatus>,
}

impl SyncService {
    pub fn status(&self) -> SyncStatus {
        self.status.lock().unwrap().clone()
    }
}

/// Name of this computer, as the other machines see it.
pub fn machine_id() -> String {
    std::env::var("COMPUTERNAME").unwrap_or_else(|_| "unknown".into())
}

/// Now in the zone every machine writes, whatever its own.
pub fn madrid_now() -> jiff::Zoned {
    let now = jiff::Zoned::now();
    now.in_tz(TIME_ZONE).unwrap_or(now)
}

fn set_status(app: &AppHandle, status: SyncStatus) {
    *app.state::<SyncService>().status.lock().unwrap() = status.clone();
    tray::show_status(app, &status);
    let _ = status.emit(app);
}

/// Starts syncing with the saved settings, from scratch if it was already running. It also ends a pause.
/// Does not start if the sync is turned off.
pub async fn restart(app: &AppHandle) {
    let service = app.state::<SyncService>();
    let mut work = service.work.lock().await;
    end(&mut work).await;
    begin(app, &mut work);
}

/// Turns the sync on or off, also for the next times the app starts.
pub async fn set_enabled(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let service = app.state::<SyncService>();
    let mut work = service.work.lock().await;
    if let Err(error) = config::save_sync_enabled(enabled) {
        // The tray ticks its item by itself on a click.
        tray::show_status(app, &service.status());
        let message = format!("No se pudo guardar la configuración: {error}");
        log(app, LogType::Error, message.clone());
        return Err(message);
    }
    end(&mut work).await;
    log(app, LogType::Info, if enabled { "Sincronización activada." } else { "Sincronización desactivada." });
    begin(app, &mut work);
    Ok(())
}

/// Turns the sync off if it is on, and the reverse.
pub async fn toggle(app: &AppHandle) {
    let enabled = app.state::<SyncService>().status() == SyncStatus::Disabled;
    // The reason of a failure is already in the activity log.
    let _ = set_enabled(app, enabled).await;
}

/// Stops syncing in both directions for `duration`, then starts again by itself.
pub async fn pause(app: &AppHandle, duration: Duration) {
    let service = app.state::<SyncService>();
    let mut work = service.work.lock().await;
    if service.status() == SyncStatus::Disabled {
        return;
    }
    end(&mut work).await;
    let deadline = Instant::now() + duration;
    let until = jiff::Zoned::now().checked_add(duration).map(|end| end.strftime("%H:%M").to_string()).unwrap_or_default();

    let (cancel, cancelled) = oneshot::channel();
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::select! {
            () = sleep_until(deadline) => resume(&handle).await,
            _ = cancelled => {}
        }
    });
    *work = Work::Pause { _cancel: cancel };
    set_status(app, SyncStatus::Paused { until: until.clone() });
    log(app, LogType::Info, format!("Sincronización en pausa hasta las {until}. Lo que copies mientras tanto no se compartirá. Para reanudar antes, usa «Reiniciar sincronización»."));
}

async fn sleep_until(deadline: Instant) {
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return;
        }
        tokio::time::sleep(left.min(PAUSE_CHECK)).await;
    }
}

/// Ends a pause, unless something else ended it first.
async fn resume(app: &AppHandle) {
    let service = app.state::<SyncService>();
    let mut work = service.work.lock().await;
    if matches!(*work, Work::Pause { .. }) {
        begin(app, &mut work);
    }
}

/// Opens a session with the saved settings, if the sync is on. Any previous work must have ended.
fn begin(app: &AppHandle, work: &mut Work) {
    *work = Work::None;
    let settings = match config::sync_settings() {
        Ok(settings) => settings,
        Err(error) => {
            log(app, LogType::Error, format!("No se pudo leer la configuración: {error}"));
            set_status(app, SyncStatus::Error { detail: "No se pudo leer la configuración".into() });
            return;
        }
    };
    if !settings.enabled {
        set_status(app, SyncStatus::Disabled);
        return;
    }
    let Some(user_id) = settings.user_id else {
        set_status(app, SyncStatus::Error { detail: "No hay usuario configurado".into() });
        log(app, LogType::Warning, "No hay usuario configurado. Indica tu identificador para empezar.");
        return;
    };
    log(app, LogType::Success, format!("Usuario configurado: {user_id}"));
    set_status(app, SyncStatus::Connecting);
    let (cancel, cancelled) = oneshot::channel();
    let task = tauri::async_runtime::spawn(session::run(app.clone(), user_id, settings.key, cancelled));
    *work = Work::Session { cancel, task };
}

/// Ends the pause, or the session, waiting until its listener is closed.
async fn end(work: &mut Work) {
    if let Work::Session { cancel, task } = std::mem::take(work) {
        let _ = cancel.send(());
        let _ = task.await;
    }
}
