//! A dedicated Windows message queue keeps shortcuts active without webview focus.
use std::sync::mpsc;
use std::thread::{self, JoinHandle};
use std::time::Duration;
use windows_sys::Win32::System::Threading::GetCurrentThreadId;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    RegisterHotKey, UnregisterHotKey, MOD_NOREPEAT,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetMessageW, PeekMessageW, PostThreadMessageW, MSG, PM_NOREMOVE, WM_HOTKEY, WM_QUIT,
};

const HOTKEY_ID: i32 = 0x4643;

pub struct GlobalHotkey {
    thread_id: u32,
    worker: Option<JoinHandle<()>>,
}

impl GlobalHotkey {
    pub fn register(
        modifiers: u32,
        key: u32,
        on_press: impl Fn() + Send + 'static,
    ) -> Result<Self, String> {
        let (ready_tx, ready_rx) = mpsc::sync_channel(0);
        let worker = thread::Builder::new()
            .name("stealth-hotkey".into())
            .spawn(move || unsafe {
                let mut msg: MSG = std::mem::zeroed();
                // PostThreadMessage needs an existing queue, including during shutdown.
                PeekMessageW(&mut msg, 0, 0, 0, PM_NOREMOVE);
                if RegisterHotKey(0, HOTKEY_ID, modifiers | MOD_NOREPEAT, key) == 0 {
                    let _ = ready_tx.send(Err(std::io::Error::last_os_error().to_string()));
                    return;
                }
                // A timed-out caller drops the receiver; release rather than orphaning a key.
                if ready_tx.send(Ok(GetCurrentThreadId())).is_err() {
                    UnregisterHotKey(0, HOTKEY_ID);
                    return;
                }
                while GetMessageW(&mut msg, 0, 0, 0) > 0 {
                    if msg.message == WM_HOTKEY && msg.wParam == HOTKEY_ID as usize {
                        on_press();
                    }
                }
                UnregisterHotKey(0, HOTKEY_ID);
            })
            .map_err(|error| error.to_string())?;
        match ready_rx.recv_timeout(Duration::from_secs(2)) {
            Ok(Ok(thread_id)) => Ok(Self { thread_id, worker: Some(worker) }),
            Ok(Err(error)) => {
                let _ = worker.join();
                Err(error)
            }
            Err(error) => Err(format!("Shortcut registration did not finish: {error}")),
        }
    }

    pub fn is_registered(&self) -> bool {
        self.worker.as_ref().is_some_and(|worker| !worker.is_finished())
    }

    pub fn shutdown(&mut self) {
        if let Some(worker) = self.worker.take() {
            unsafe { PostThreadMessageW(self.thread_id, WM_QUIT, 0, 0); }
            let _ = worker.join();
        }
    }
}

impl Drop for GlobalHotkey {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{MOD_ALT, MOD_CONTROL, MOD_SHIFT};

    #[test]
    fn registers_off_focus_dispatches_only_its_event_and_releases_on_shutdown() {
        // Reserve an uncommon test chord; never synthesize desktop keyboard input.
        let modifiers = MOD_CONTROL | MOD_SHIFT | MOD_ALT;
        let key = 0x87; // F24
        let (tx, rx) = mpsc::channel();
        let mut hotkey = GlobalHotkey::register(modifiers, key, move || { let _ = tx.send(()); })
            .expect("test shortcut must be available");
        assert!(hotkey.is_registered());
        assert!(GlobalHotkey::register(modifiers, key, || {}).is_err(), "occupied chord reports failure");
        unsafe {
            assert_ne!(PostThreadMessageW(hotkey.thread_id, WM_HOTKEY, (HOTKEY_ID + 1) as usize, 0), 0);
            assert_ne!(PostThreadMessageW(hotkey.thread_id, WM_HOTKEY, HOTKEY_ID as usize, 0), 0);
        }
        rx.recv_timeout(Duration::from_secs(1)).expect("matching event invokes callback without webview focus");
        assert!(rx.recv_timeout(Duration::from_millis(30)).is_err(), "unrelated event ignored");
        hotkey.shutdown();
        assert!(!hotkey.is_registered());
        let restored = GlobalHotkey::register(modifiers, key, || {}).expect("shutdown releases chord");
        drop(restored);
        let after_drop = GlobalHotkey::register(modifiers, key, || {}).expect("drop also releases chord");
        drop(after_drop);
    }
}
