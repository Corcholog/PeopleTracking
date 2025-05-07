#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::{Builder, Manager, State, WindowEvent};
use tauri_plugin_shellx::{ShellExt, process::{CommandEvent, CommandChild}};

struct AppState {
  _backend: Mutex<Option<CommandChild>>,
}

fn main() {
  Builder::default()
    .plugin(tauri_plugin_shellx::init(true))
    .manage(AppState {
      _backend: Mutex::new(None),
    })
    .setup(|app| {
      let sidecar = app.shell().sidecar("fastapi_server")
        .expect("Sidecar no configurado en externalBin");

      let (mut rx, child) = sidecar.spawn()
        .expect("No se pudo iniciar fastapi_server sidecar");

      let state: State<AppState> = app.state();
      *state._backend.lock().unwrap() = Some(child);

      tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
          if let CommandEvent::Stdout(line) = event {
            println!("FastAPI: {}", String::from_utf8_lossy(&line));
          }
        }
      });

      Ok(())
    })
    .on_window_event(|_, event| {
      if let WindowEvent::CloseRequested { .. } = event {
        // Cerrar sidecar si se desea
      }
    })
    .run(tauri::generate_context!())
    .expect("Error al ejecutar Tauri");
}
