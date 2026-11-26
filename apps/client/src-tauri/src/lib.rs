mod games;
mod hotkeys;

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{
  menu::{Menu, MenuItem, PredefinedMenuItem},
  tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
  AppHandle, Emitter, Manager, WindowEvent,
};

/// Estado do app que o Rust precisa consultar fora da interface.
struct AppState {
  /// Se fechar a janela só esconde (fica no ícone perto do relógio) em vez de sair.
  close_to_tray: AtomicBool,
  /// Marcado quando a pessoa escolhe "Sair" de verdade.
  quitting: AtomicBool,
}

#[tauri::command]
fn set_close_to_tray(state: tauri::State<'_, AppState>, enabled: bool) {
  state.close_to_tray.store(enabled, Ordering::Relaxed);
}

#[tauri::command]
fn quit_app(app: AppHandle) {
  app.state::<AppState>().quitting.store(true, Ordering::Relaxed);
  app.exit(0);
}

fn show_main_window(app: &AppHandle) {
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
  }
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
  let open = MenuItem::with_id(app, "open", "Abrir NexusVoice", true, None::<&str>)?;
  let mute = MenuItem::with_id(app, "toggle-mute", "Mutar ou desmutar", true, None::<&str>)?;
  let deafen = MenuItem::with_id(app, "toggle-deafen", "Ensurdecer ou voltar a ouvir", true, None::<&str>)?;
  let separator = PredefinedMenuItem::separator(app)?;
  let quit = MenuItem::with_id(app, "quit", "Sair do NexusVoice", true, None::<&str>)?;
  let menu = Menu::with_items(app, &[&open, &mute, &deafen, &separator, &quit])?;

  let mut builder = TrayIconBuilder::with_id("main")
    .tooltip("NexusVoice")
    .menu(&menu)
    .show_menu_on_left_click(false)
    .on_menu_event(|app, event| match event.id.as_ref() {
      "open" => show_main_window(app),
      "toggle-mute" | "toggle-deafen" => {
        let _ = app.emit("tray-action", event.id.as_ref().to_string());
      }
      "quit" => {
        app.state::<AppState>().quitting.store(true, Ordering::Relaxed);
        app.exit(0);
      }
      _ => {}
    })
    .on_tray_icon_event(|tray, event| {
      if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
      } = event
      {
        show_main_window(tray.app_handle());
      }
    });

  if let Some(icon) = app.default_window_icon() {
    builder = builder.icon(icon.clone());
  }
  builder.build(app)?;
  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // Precisa vir primeiro: abrir o app de novo só traz a janela que já está aberta.
    .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
      show_main_window(app);
    }))
    .plugin(tauri_plugin_autostart::init(
      tauri_plugin_autostart::MacosLauncher::LaunchAgent,
      Some(vec!["--minimized"]),
    ))
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_opener::init())
    .manage(AppState {
      close_to_tray: AtomicBool::new(true),
      quitting: AtomicBool::new(false),
    })
    .invoke_handler(tauri::generate_handler![
      set_close_to_tray,
      quit_app,
      hotkeys::set_hotkeys,
      hotkeys::start_key_capture,
      hotkeys::cancel_key_capture,
      games::get_current_game,
      games::set_custom_games,
      games::set_game_detection,
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      build_tray(app)?;

      // Quando o Windows abre o app sozinho (iniciar com o Windows), ele começa escondido.
      if std::env::args().any(|arg| arg == "--minimized") {
        if let Some(window) = app.get_webview_window("main") {
          let _ = window.hide();
        }
      }

      hotkeys::init(app.handle().clone());
      games::start(app.handle().clone());
      Ok(())
    })
    .on_window_event(|window, event| {
      if let WindowEvent::CloseRequested { api, .. } = event {
        let state = window.state::<AppState>();
        if state.close_to_tray.load(Ordering::Relaxed) && !state.quitting.load(Ordering::Relaxed) {
          api.prevent_close();
          let _ = window.hide();
        }
      }
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
