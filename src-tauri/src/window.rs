//! Main window. It is destroyed when closed, so nothing of the web view stays in memory while
//! the app sits in the tray; the sync runs in Rust and does not need it.

use crate::activity::{LogType, log};
use tauri::window::Color;
use tauri::{AppHandle, Manager, UserAttentionType, WebviewUrl, WebviewWindowBuilder};

const MAIN: &str = "main";
/// Same as `--bg` in `theme.scss`, so a window never flashes white while it loads.
pub const BACKGROUND: Color = Color(20, 20, 20, 255);

/// Shows the main window, creating it if needed. Without `focus` it only flashes in the taskbar.
pub fn show(app: &AppHandle, focus: bool) {
    let window = match app.get_webview_window(MAIN) {
        Some(window) => window,
        None => match build(app, focus) {
            Ok(window) => window,
            Err(error) => {
                log(app, LogType::Error, format!("No se pudo abrir la ventana: {error}"));
                return;
            }
        },
    };
    let _ = window.unminimize();
    let _ = window.show();
    if focus {
        let _ = window.set_focus();
    } else {
        let _ = window.request_user_attention(Some(UserAttentionType::Informational));
    }
}

fn build(app: &AppHandle, focus: bool) -> tauri::Result<tauri::WebviewWindow> {
    WebviewWindowBuilder::new(app, MAIN, WebviewUrl::App("index.html".into()))
        .title(app.package_info().name.clone())
        .inner_size(720.0, 540.0)
        .min_inner_size(560.0, 460.0)
        .center()
        .focused(focus)
        .background_color(BACKGROUND)
        .build()
}

pub fn close(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN) {
        let _ = window.close();
    }
}
