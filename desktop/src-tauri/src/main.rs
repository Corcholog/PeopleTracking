#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::{Builder, Manager, State, WindowEvent};
use tauri_plugin_shellx::{ShellExt, process::{CommandEvent, CommandChild}};
use std::process::Command;
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

      // 1) Spawn normal
      std::env::set_var("PATH", format!("{};{}", r"C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.6\bin", std::env::var("PATH").unwrap()));

      let (mut rx, child) = sidecar.spawn()
        .expect("No se pudo iniciar fastapi_server sidecar");

      // 2) Guardar el child para cerrarlo luego
      let state: State<AppState> = app.state();
      *state._backend.lock().unwrap() = Some(child);

      // 3) Redirigir stdout/stderr
      tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
          match event {
            CommandEvent::Stdout(line) => {
              let text = String::from_utf8_lossy(&line);
              println!("[FastAPI stdout] {}", text);  // Salida normal :contentReference[oaicite:3]{index=3}
            }
            CommandEvent::Stderr(line) => {
              let text = String::from_utf8_lossy(&line);
              eprintln!("[FastAPI stderr] {}", text); // Errores :contentReference[oaicite:4]{index=4}
            }
            _ => {}
          }
        }
      });

      Ok(())
    })
    .on_window_event(move |app_handle, event| {
      if let WindowEvent::CloseRequested { .. } = event {
        // Cerrar sidecar
        let state = app_handle.state::<AppState>();
        if let Some(child) = state._backend.lock().unwrap().take() {
        let pid = child.pid();
        // Usar taskkill para terminar el proceso y sus hijos
        let _ = Command::new("taskkill")
          .args(&["/PID", &pid.to_string(), "/F", "/T"])
          .spawn();
        };
      }
    })
    .run(tauri::generate_context!())
    .expect("Error al ejecutar Tauri");
}
