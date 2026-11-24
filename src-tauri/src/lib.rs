//! ClipSync: keeps the clipboard in sync between machines through Firestore.
//!
//! Everything runs in Rust (clipboard, Firestore, tray, updates). The web view only draws the
//! window, and it is destroyed when the window closes.
//!
//! Shared state uses `Mutex::lock().unwrap()`: a lock is only poisoned by a panic, and release
//! builds abort on panic (`panic = "abort"`).

mod activity;
mod autostart;
mod clipboard;
mod commands;
mod config;
mod encryption;
mod error_report;
mod firebase;
mod history;
mod messages;
mod release_notes;
mod sync;
mod tray;
mod updater;
mod usage;
mod users;
mod window;

use tauri::RunEvent;

pub fn run() {
    let args: Vec<String> = std::env::args().collect();
    // Embedded once: the web assets are part of the context, and each call would embed them again.
    let context = tauri::generate_context!();
    if updater::update_mode::is_requested(&args) {
        if let Some(request) = updater::update_mode::UpdateRequest::parse(&args) {
            updater::update_mode::run(context, request);
        }
        return;
    }
    run_app(context, args.iter().any(|arg| arg == autostart::ARG));
}

fn run_app(context: tauri::Context, started_with_windows: bool) {
    let specta = commands::builder();
    #[cfg(debug_assertions)]
    specta
        .export(specta_typescript::Typescript::default(), concat!(env!("CARGO_MANIFEST_DIR"), "/../src/rust/bindings.gen.ts"))
        .expect("could not export the TypeScript bindings");

    tauri::Builder::default()
        // Must be the first plugin: a second launch only shows the window of the running one.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| window::show(app, true)))
        .manage(activity::ActivityLog::default())
        .manage(error_report::ErrorQueue::default())
        .manage(history::History::default())
        .manage(firebase::Firebase::default())
        .manage(sync::SyncService::default())
        .manage(messages::MessageCenter::default())
        .manage(updater::Updater::default())
        .manage(users::AdminSession::default())
        .invoke_handler(specta.invoke_handler())
        .setup(move |app| {
            specta.mount_events(app);
            tray::create(app.handle())?;
            if !started_with_windows {
                window::show(app.handle(), true);
            }
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move { sync::restart(&handle).await });
            updater::spawn_checks(app.handle().clone());
            Ok(())
        })
        .build(context)
        .expect("error while building the app")
        .run(|_app, event| {
            // Closing the last window must not quit: the app keeps syncing from the tray.
            // An explicit exit (`app.exit`) carries an exit code and is let through.
            if let RunEvent::ExitRequested { code: None, api, .. } = event {
                api.prevent_exit();
            }
        });
}
