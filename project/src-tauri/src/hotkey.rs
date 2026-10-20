use std::sync::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{MOD_CONTROL, MOD_SHIFT};
use crate::global_hotkey::GlobalHotkey;

#[derive(Serialize)]
pub struct StealthShortcutInfo {
    registered: bool,
    shortcut: &'static str,
    error: Option<String>,
}

pub struct StealthHotkey {
    runtime: Mutex<Option<GlobalHotkey>>,
    error: Option<String>,
}

impl StealthHotkey {
    pub fn register(app: AppHandle) -> Self {
        match GlobalHotkey::register(MOD_CONTROL | MOD_SHIFT, b'H' as u32, move || {
            let _ = app.emit("stealth-toggle", ());
        }) {
            Ok(runtime) => Self { runtime: Mutex::new(Some(runtime)), error: None },
            Err(error) => Self { runtime: Mutex::new(None), error: Some(error) },
        }
    }

    pub fn shutdown(&self) {
        // Dropping the worker unregisters the chord on its owning message thread.
        self.runtime.lock().unwrap().take();
    }
}

#[tauri::command]
pub fn stealth_shortcut_info(state: State<StealthHotkey>) -> StealthShortcutInfo {
    let registered = state.runtime.lock().unwrap().as_ref().is_some_and(GlobalHotkey::is_registered);
    StealthShortcutInfo {
        registered,
        shortcut: "Ctrl+Shift+H",
        error: if registered { None } else { Some(state.error.clone().unwrap_or_else(|| "Shortcut unavailable".into())) },
    }
}
