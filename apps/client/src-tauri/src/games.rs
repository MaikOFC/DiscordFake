//! Detecta o jogo aberto para mostrar "Jogando X" no perfil.
//!
//! A cada 15 segundos lê só os nomes dos executáveis em execução e compara com uma
//! lista de jogos conhecidos, mais os que a pessoa adicionar nas configurações.
//! Nada sai do computador além do nome do jogo encontrado.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const SCAN_INTERVAL: Duration = Duration::from_secs(15);

/// Executável (em minúsculas) e nome que aparece para os outros.
const KNOWN_GAMES: &[(&str, &str)] = &[
  ("valorant-win64-shipping.exe", "VALORANT"),
  ("cs2.exe", "Counter-Strike 2"),
  ("league of legends.exe", "League of Legends"),
  ("fortniteclient-win64-shipping.exe", "Fortnite"),
  ("r5apex.exe", "Apex Legends"),
  ("r5apex_dx12.exe", "Apex Legends"),
  ("gta5.exe", "Grand Theft Auto V"),
  ("gta5_enhanced.exe", "Grand Theft Auto V"),
  ("robloxplayerbeta.exe", "Roblox"),
  ("minecraft.windows.exe", "Minecraft"),
  ("rocketleague.exe", "Rocket League"),
  ("dota2.exe", "Dota 2"),
  ("overwatch.exe", "Overwatch 2"),
  ("eldenring.exe", "ELDEN RING"),
  ("rainbowsix.exe", "Rainbow Six Siege"),
  ("rainbowsix_vulkan.exe", "Rainbow Six Siege"),
  ("fc25.exe", "EA SPORTS FC 25"),
  ("fc26.exe", "EA SPORTS FC 26"),
  ("tslgame.exe", "PUBG: BATTLEGROUNDS"),
  ("deadbydaylight-win64-shipping.exe", "Dead by Daylight"),
  ("rustclient.exe", "Rust"),
  ("terraria.exe", "Terraria"),
  ("stardew valley.exe", "Stardew Valley"),
  ("hollow_knight.exe", "Hollow Knight"),
  ("among us.exe", "Among Us"),
  ("phasmophobia.exe", "Phasmophobia"),
  ("lethal company.exe", "Lethal Company"),
  ("repo.exe", "R.E.P.O."),
  ("cyberpunk2077.exe", "Cyberpunk 2077"),
  ("witcher3.exe", "The Witcher 3"),
  ("bg3.exe", "Baldur's Gate 3"),
  ("bg3_dx11.exe", "Baldur's Gate 3"),
  ("helldivers2.exe", "HELLDIVERS 2"),
  ("marvel-win64-shipping.exe", "Marvel Rivals"),
  ("cod.exe", "Call of Duty"),
  ("re4.exe", "Resident Evil 4"),
  ("osu!.exe", "osu!"),
  ("brawlhalla.exe", "Brawlhalla"),
  ("geometrydash.exe", "Geometry Dash"),
  ("palworld-win64-shipping.exe", "Palworld"),
  ("hades.exe", "Hades"),
  ("hades2.exe", "Hades II"),
  ("fallguys_client_game.exe", "Fall Guys"),
  ("eurotrucks2.exe", "Euro Truck Simulator 2"),
  ("rdr2.exe", "Red Dead Redemption 2"),
  ("forzahorizon5.exe", "Forza Horizon 5"),
  ("sekiro.exe", "Sekiro"),
  ("darksoulsiii.exe", "Dark Souls III"),
  ("monsterhunterwilds.exe", "Monster Hunter Wilds"),
  ("monsterhunterworld.exe", "Monster Hunter: World"),
  ("warframe.x64.exe", "Warframe"),
  ("destiny2.exe", "Destiny 2"),
];

static ENABLED: AtomicBool = AtomicBool::new(true);
static CUSTOM_GAMES: Mutex<Vec<(String, String)>> = Mutex::new(Vec::new());
static CURRENT: Mutex<Option<String>> = Mutex::new(None);

#[derive(serde::Deserialize)]
pub struct CustomGame {
  exe: String,
  name: String,
}

#[tauri::command]
pub fn get_current_game() -> Option<String> {
  CURRENT.lock().ok().and_then(|c| c.clone())
}

#[tauri::command]
pub fn set_custom_games(games: Vec<CustomGame>) {
  let cleaned = games
    .into_iter()
    .map(|g| (g.exe.trim().to_lowercase(), g.name.trim().chars().take(64).collect::<String>()))
    .filter(|(exe, name)| !exe.is_empty() && !name.is_empty())
    .take(50)
    .collect();
  if let Ok(mut list) = CUSTOM_GAMES.lock() {
    *list = cleaned;
  }
}

#[tauri::command]
pub fn set_game_detection(enabled: bool) {
  ENABLED.store(enabled, Ordering::Relaxed);
}

fn find_game(running: &[String]) -> Option<String> {
  let custom = CUSTOM_GAMES.lock().map(|c| c.clone()).unwrap_or_default();
  let mut table: HashMap<&str, &str> = KNOWN_GAMES.iter().copied().collect();
  for (exe, name) in &custom {
    table.insert(exe.as_str(), name.as_str());
  }
  running
    .iter()
    .find_map(|exe| table.get(exe.as_str()).map(|name| name.to_string()))
}

pub fn start(app: AppHandle) {
  thread::spawn(move || loop {
    let found = if ENABLED.load(Ordering::Relaxed) {
      find_game(&imp::running_executables())
    } else {
      None
    };
    let changed = match CURRENT.lock() {
      Ok(mut current) if *current != found => {
        *current = found.clone();
        true
      }
      _ => false,
    };
    if changed {
      let _ = app.emit("game-activity", found);
    }
    thread::sleep(SCAN_INTERVAL);
  });
}

#[cfg(windows)]
mod imp {
  use windows::Win32::Foundation::CloseHandle;
  use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
  };

  /// Nomes dos executáveis abertos, em minúsculas.
  pub fn running_executables() -> Vec<String> {
    let mut names = Vec::new();
    let Ok(snapshot) = (unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }) else {
      return names;
    };
    let mut entry = PROCESSENTRY32W {
      dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
      ..Default::default()
    };
    if unsafe { Process32FirstW(snapshot, &mut entry) }.is_ok() {
      loop {
        let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
        names.push(String::from_utf16_lossy(&entry.szExeFile[..len]).to_lowercase());
        if unsafe { Process32NextW(snapshot, &mut entry) }.is_err() {
          break;
        }
      }
    }
    let _ = unsafe { CloseHandle(snapshot) };
    names
  }
}

#[cfg(not(windows))]
mod imp {
  pub fn running_executables() -> Vec<String> {
    Vec::new()
  }
}
