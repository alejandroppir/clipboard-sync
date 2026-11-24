//! Tray icon. The app lives here: closing the window does not quit it.

use crate::sync::SyncStatus;
use crate::{sync, window};
use std::time::Duration;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

const OPEN: &str = "open";
const TOGGLE_SYNC: &str = "toggle-sync";
const RESTART_SYNC: &str = "restart-sync";
const PAUSE_SHORT: &str = "pause-short";
const PAUSE_LONG: &str = "pause-long";
const RESTART_APP: &str = "restart-app";
const QUIT: &str = "quit";

const SHORT_PAUSE: Duration = Duration::from_secs(15 * 60);
const LONG_PAUSE: Duration = Duration::from_secs(60 * 60);

/// The items that follow the sync status.
struct SyncItems {
    toggle: CheckMenuItem<Wry>,
    /// Only make sense while the sync is on.
    others: [MenuItem<Wry>; 3],
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let item = |id: &str, text: &str| MenuItem::with_id(app, id, text, true, None::<&str>);
    let items = SyncItems {
        toggle: CheckMenuItem::with_id(app, TOGGLE_SYNC, "Sincronización activada", true, false, None::<&str>)?,
        // The first one also ends a pause.
        others: [item(RESTART_SYNC, "Reiniciar sincronización")?, item(PAUSE_SHORT, "Pausar 15 minutos")?, item(PAUSE_LONG, "Pausar 1 hora")?],
    };
    let [restart, pause_short, pause_long] = &items.others;
    let menu = Menu::with_items(
        app,
        &[
            &item(OPEN, "Abrir")?,
            &PredefinedMenuItem::separator(app)?,
            &items.toggle,
            restart,
            pause_short,
            pause_long,
            &PredefinedMenuItem::separator(app)?,
            &item(RESTART_APP, "Reiniciar aplicación")?,
            &item(QUIT, "Salir")?,
        ],
    )?;

    let mut tray = TrayIconBuilder::with_id("tray")
        .tooltip(app.package_info().name.clone())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| on_menu(app, event.id.as_ref()))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                window::show(tray.app_handle(), true);
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    app.manage(items);
    Ok(())
}

/// Ticks or unticks "Sincronización activada" and greys out what does nothing while it is off.
pub fn show_status(app: &AppHandle, status: &SyncStatus) {
    let Some(items) = app.try_state::<SyncItems>() else { return };
    let enabled = *status != SyncStatus::Disabled;
    let _ = items.toggle.set_checked(enabled);
    for item in &items.others {
        let _ = item.set_enabled(enabled);
    }
}

fn on_menu(app: &AppHandle, id: &str) {
    let handle = app.clone();
    match id {
        OPEN => window::show(app, true),
        TOGGLE_SYNC => drop(tauri::async_runtime::spawn(async move { sync::toggle(&handle).await })),
        RESTART_SYNC => drop(tauri::async_runtime::spawn(async move { sync::restart(&handle).await })),
        PAUSE_SHORT => drop(tauri::async_runtime::spawn(async move { sync::pause(&handle, SHORT_PAUSE).await })),
        PAUSE_LONG => drop(tauri::async_runtime::spawn(async move { sync::pause(&handle, LONG_PAUSE).await })),
        RESTART_APP => app.restart(),
        QUIT => app.exit(0),
        _ => {}
    }
}
