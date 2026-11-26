// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// Guarda os dados do WebView2 (login salvo, cache) numa pasta "dados" ao lado do
/// executável, em vez do AppData. Assim, quem instala o app em outro disco não
/// enche o C: com cache. Se a pasta não puder ser criada, fica o padrão do sistema.
fn use_data_folder_next_to_exe() {
  if std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").is_some() {
    return;
  }
  let Some(dir) = std::env::current_exe().ok().and_then(|exe| exe.parent().map(|p| p.join("dados")))
  else {
    return;
  };
  if std::fs::create_dir_all(&dir).is_ok() {
    // Seguro aqui: ainda não existe nenhuma outra thread.
    unsafe { std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", &dir) };
  }
}

fn main() {
  use_data_folder_next_to_exe();
  app_lib::run();
}
