//! Atalhos globais (push-to-talk, mutar e ensurdecer) que funcionam com outro
//! programa em foco, como um jogo.
//!
//! Usa os ganchos de baixo nível do Windows (WH_KEYBOARD_LL e WH_MOUSE_LL). Eles só
//! observam: a tecla continua chegando normalmente no jogo. Nenhuma tecla é guardada
//! ou registrada; o código só compara o código da tecla com os atalhos escolhidos.
//! O gancho só fica ligado enquanto existe algum atalho configurado.

use serde::Serialize;
use std::sync::OnceLock;
use tauri::AppHandle;

#[derive(Clone, Copy, Default, PartialEq, Eq)]
struct Bindings {
  ptt: Option<u32>,
  mute: Option<u32>,
  deafen: Option<u32>,
}

impl Bindings {
  fn any(&self) -> bool {
    self.ptt.is_some() || self.mute.is_some() || self.deafen.is_some()
  }
}

#[derive(Clone, Serialize)]
struct CapturedKey {
  code: Option<u32>,
  name: Option<String>,
}

static APP: OnceLock<AppHandle> = OnceLock::new();

/// Guarda o AppHandle e liga a thread que transforma teclas em eventos para a interface.
pub fn init(app: AppHandle) {
  let _ = APP.set(app);
  imp::start_worker();
}

#[tauri::command]
pub fn set_hotkeys(ptt: Option<u32>, mute: Option<u32>, deafen: Option<u32>) {
  imp::set_bindings(Bindings { ptt, mute, deafen });
}

/// A próxima tecla ou botão do mouse apertado vira o atalho (Esc cancela).
#[tauri::command]
pub fn start_key_capture() {
  imp::start_capture();
}

#[tauri::command]
pub fn cancel_key_capture() {
  imp::cancel_capture();
}

#[cfg(windows)]
mod imp {
  use super::{Bindings, CapturedKey, APP};
  use std::collections::HashSet;
  use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
  use std::sync::mpsc::{channel, Sender};
  use std::sync::{Mutex, OnceLock};
  use std::thread;
  use tauri::Emitter;
  use windows::core::PCWSTR;
  use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM};
  use windows::Win32::System::LibraryLoader::GetModuleHandleW;
  use windows::Win32::System::Threading::GetCurrentThreadId;
  use windows::Win32::UI::Input::KeyboardAndMouse::GetKeyNameTextW;
  use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetMessageW, PostThreadMessageW, SetWindowsHookExW,
    TranslateMessage, UnhookWindowsHookEx, HC_ACTION, KBDLLHOOKSTRUCT, LLKHF_EXTENDED, MSG,
    MSLLHOOKSTRUCT, WH_KEYBOARD_LL, WH_MOUSE_LL, WM_KEYDOWN, WM_KEYUP, WM_MBUTTONDOWN,
    WM_MBUTTONUP, WM_QUIT, WM_SYSKEYDOWN, WM_SYSKEYUP, WM_XBUTTONDOWN, WM_XBUTTONUP,
  };

  const VK_MBUTTON: u32 = 0x04;
  const VK_XBUTTON1: u32 = 0x05;
  const VK_XBUTTON2: u32 = 0x06;
  const VK_ESCAPE: u32 = 0x1B;

  struct RawInput {
    code: u32,
    down: bool,
    /// Valor montado a partir do scan code, usado só para descobrir o nome da tecla.
    name_param: i32,
  }

  static BINDINGS: Mutex<Bindings> = Mutex::new(Bindings {
    ptt: None,
    mute: None,
    deafen: None,
  });
  static CAPTURING: AtomicBool = AtomicBool::new(false);
  static HOOK_THREAD_ID: AtomicU32 = AtomicU32::new(0);
  static HOOK_STARTING: AtomicBool = AtomicBool::new(false);
  static SENDER: OnceLock<Sender<RawInput>> = OnceLock::new();

  fn send(input: RawInput) {
    if let Some(tx) = SENDER.get() {
      let _ = tx.send(input);
    }
  }

  // Os ganchos precisam responder rápido, senão o Windows os desliga. Por isso eles só
  // repassam o código para a thread de trabalho e seguem a corrente.
  unsafe extern "system" fn keyboard_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code == HC_ACTION as i32 {
      let info = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
      let msg = wparam.0 as u32;
      let down = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;
      let up = msg == WM_KEYUP || msg == WM_SYSKEYUP;
      if down || up {
        let extended = (info.flags.0 & LLKHF_EXTENDED.0) != 0;
        let name_param = ((info.scanCode as i32) << 16) | if extended { 1 << 24 } else { 0 };
        send(RawInput { code: info.vkCode, down, name_param });
      }
    }
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
  }

  unsafe extern "system" fn mouse_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code == HC_ACTION as i32 {
      let info = unsafe { &*(lparam.0 as *const MSLLHOOKSTRUCT) };
      let msg = wparam.0 as u32;
      let button = match msg {
        WM_XBUTTONDOWN | WM_XBUTTONUP => match (info.mouseData >> 16) & 0xFFFF {
          1 => Some(VK_XBUTTON1),
          2 => Some(VK_XBUTTON2),
          _ => None,
        },
        WM_MBUTTONDOWN | WM_MBUTTONUP => Some(VK_MBUTTON),
        _ => None,
      };
      if let Some(vk) = button {
        let down = msg == WM_XBUTTONDOWN || msg == WM_MBUTTONDOWN;
        send(RawInput { code: vk, down, name_param: 0 });
      }
    }
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
  }

  fn key_name(code: u32, name_param: i32) -> String {
    match code {
      VK_MBUTTON => return "Botão do meio do mouse".to_string(),
      VK_XBUTTON1 => return "Mouse 4".to_string(),
      VK_XBUTTON2 => return "Mouse 5".to_string(),
      _ => {}
    }
    let mut buf = [0u16; 64];
    let len = unsafe { GetKeyNameTextW(name_param, &mut buf) };
    if len > 0 {
      String::from_utf16_lossy(&buf[..len as usize])
    } else {
      format!("Tecla {code}")
    }
  }

  fn hook_needed() -> bool {
    CAPTURING.load(Ordering::SeqCst) || BINDINGS.lock().map(|b| b.any()).unwrap_or(false)
  }

  fn ensure_hook_running() {
    if HOOK_THREAD_ID.load(Ordering::SeqCst) != 0 || HOOK_STARTING.swap(true, Ordering::SeqCst) {
      return;
    }
    thread::spawn(|| {
      let thread_id = unsafe { GetCurrentThreadId() };
      let module = unsafe { GetModuleHandleW(PCWSTR::null()) }
        .ok()
        .map(|m| HINSTANCE(m.0));
      let keyboard = unsafe { SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), module, 0) };
      let mouse = unsafe { SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_proc), module, 0) };
      HOOK_THREAD_ID.store(thread_id, Ordering::SeqCst);
      HOOK_STARTING.store(false, Ordering::SeqCst);

      let mut msg = MSG::default();
      // O Windows entrega os eventos do gancho através desta fila de mensagens.
      while unsafe { GetMessageW(&mut msg, None, 0, 0) }.as_bool() {
        unsafe {
          let _ = TranslateMessage(&msg);
          DispatchMessageW(&msg);
        }
      }

      if let Ok(hook) = keyboard {
        let _ = unsafe { UnhookWindowsHookEx(hook) };
      }
      if let Ok(hook) = mouse {
        let _ = unsafe { UnhookWindowsHookEx(hook) };
      }
      HOOK_THREAD_ID.store(0, Ordering::SeqCst);
      // Se alguém pediu atalho enquanto desligávamos, liga de novo.
      if hook_needed() {
        ensure_hook_running();
      }
    });
  }

  fn stop_hook_if_idle() {
    if hook_needed() {
      return;
    }
    let id = HOOK_THREAD_ID.load(Ordering::SeqCst);
    if id != 0 {
      let _ = unsafe { PostThreadMessageW(id, WM_QUIT, WPARAM(0), LPARAM(0)) };
    }
  }

  pub fn start_worker() {
    let (tx, rx) = channel::<RawInput>();
    if SENDER.set(tx).is_err() {
      return;
    }
    thread::spawn(move || {
      let mut pressed: HashSet<u32> = HashSet::new();
      while let Ok(input) = rx.recv() {
        let was_down = pressed.contains(&input.code);
        if input.down {
          if was_down {
            continue; // repetição automática de tecla segurada
          }
          pressed.insert(input.code);
        } else {
          pressed.remove(&input.code);
        }

        let Some(app) = APP.get() else { continue };

        if input.down && CAPTURING.swap(false, Ordering::SeqCst) {
          let captured = if input.code == VK_ESCAPE {
            CapturedKey { code: None, name: None }
          } else {
            CapturedKey {
              code: Some(input.code),
              name: Some(key_name(input.code, input.name_param)),
            }
          };
          let _ = app.emit("hotkey-captured", captured);
          stop_hook_if_idle();
          continue;
        }

        let bindings = BINDINGS.lock().map(|b| *b).unwrap_or_default();
        if bindings.ptt == Some(input.code) {
          let _ = app.emit("ptt", input.down);
        }
        if input.down && bindings.mute == Some(input.code) {
          let _ = app.emit("hotkey", "toggle-mute");
        }
        if input.down && bindings.deafen == Some(input.code) {
          let _ = app.emit("hotkey", "toggle-deafen");
        }
      }
    });
  }

  pub fn set_bindings(bindings: Bindings) {
    if let Ok(mut current) = BINDINGS.lock() {
      *current = bindings;
    }
    if bindings.any() {
      ensure_hook_running();
    } else {
      stop_hook_if_idle();
    }
  }

  pub fn start_capture() {
    CAPTURING.store(true, Ordering::SeqCst);
    ensure_hook_running();
  }

  pub fn cancel_capture() {
    CAPTURING.store(false, Ordering::SeqCst);
    stop_hook_if_idle();
  }
}

#[cfg(not(windows))]
mod imp {
  use super::Bindings;
  pub fn start_worker() {}
  pub fn set_bindings(_bindings: Bindings) {}
  pub fn start_capture() {}
  pub fn cancel_capture() {}
}
