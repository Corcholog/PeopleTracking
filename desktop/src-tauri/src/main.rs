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
      //contar tiempo

      let sidecar = app.shell().sidecar("fastapi_server")
        .expect("Sidecar no configurado en externalBin");

      let (mut rx, child) = sidecar.spawn()
        .expect("No se pudo iniciar fastapi_server sidecar");

      let state: State<AppState> = app.state();
      *state._backend.lock().unwrap() = Some(child);

      Ok(())
    })
    .on_window_event(move |app_handle, event| {
      if let WindowEvent::CloseRequested { .. } = event {
        println!("🧹 Cerrando ventana, liberando sidecar...");

        // 1) Obtengo el state
        let state_handle = app_handle.state::<AppState>();
        // 2) Dentro de su propio bloque, tomo el guard y hago .take()
        let maybe_child = {
          let mut guard = state_handle._backend.lock().unwrap();
          guard.take()
        }; // <- aquí el guard se suelta automáticamente

        // 3) Ya libre, puedo matar el proceso si había uno
        if let Some(mut child) = maybe_child {
          println!("🔍 Intentando matar el proceso sidecar...");
          match child.kill() {
            Ok(_) => println!("✅ Sidecar terminado correctamente."),
            Err(e) => eprintln!("❌ Error al matar el sidecar: {}", e),
          }
        } else {
          println!("⚠️ No se encontró sidecar activo.");
        }
      }
    })
    .run(tauri::generate_context!())
    .expect("Error al ejecutar Tauri");
}
