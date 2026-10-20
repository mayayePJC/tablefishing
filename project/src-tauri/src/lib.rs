use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{
    AppHandle, Emitter, Manager, State, WebviewWindow, WindowEvent,
};
use tauri_plugin_autostart::ManagerExt;
use windows_sys::Win32::Foundation::POINT;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;

mod coordinates;
mod music;
mod input_region;
use coordinates::logical_offset;

/// 跨命令 / 窗口事件共享的桌宠状态（用 Arc<Mutex<>> 包裹，便于在 on_window_event 闭包里克隆）
pub struct AppState(Arc<Mutex<StateInner>>);

struct StateInner {
    /// 身体区是否正被按住（进入拖窗判定态）
    body_dragging: bool,
    /// 渲染层为每次手势分配的编号，隔离迟到的 IPC 和原生事件。
    body_gesture_id: u64,
    /// 本次身体手势开始时记录的窗口基准位置（用于计算位移、以及手抖后的弹回）
    drag_base: Option<(i32, i32)>,
    /// 本次手势开始时的缩放比例；位移事件以该 CSS 单位计算，跨屏时阈值不跳变。
    drag_scale: f64,
    /// 最近一次真实窗口位置；松开时优先重新采样，失败才使用此值。
    last_body_position: Option<(i32, i32)>,
    /// 上次持久化坐标的时间，用于防抖
    last_save: Instant,
}

impl AppState {
    fn new() -> Self {
        AppState(Arc::new(Mutex::new(StateInner {
            body_dragging: false,
            body_gesture_id: 0,
            drag_base: None,
            drag_scale: 1.0,
            last_body_position: None,
            last_save: Instant::now(),
        })))
    }
}

impl StateInner {
    fn end_body(&mut self, gesture_id: u64) -> bool {
        if !self.body_dragging || self.body_gesture_id != gesture_id {
            return false;
        }
        self.body_dragging = false;
        true
    }

    /// 原生轮询补发松开；DOM 先结束或已补发过的手势不再重复产生结束。
    /// 保留 drag_base，让未越阈的手抖仍能执行单次 snap_back。
    fn take_body_release(&mut self, gesture_id: u64, position: Option<(i32, i32)>) -> Option<BodyPosition> {
        if !self.end_body(gesture_id) {
            return None;
        }
        if position.is_some() {
            self.last_body_position = position;
        }
        self.drag_base.map(|base| {
            let last = self.last_body_position.unwrap_or(base);
            BodyPosition::relative(last, base, self.drag_scale, self.body_gesture_id)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn active_body() -> StateInner {
        StateInner {
            body_dragging: true,
            body_gesture_id: 42,
            drag_base: Some((100, 200)),
            drag_scale: 1.0,
            last_body_position: Some((103, 204)),
            last_save: Instant::now(),
        }
    }

    #[test]
    fn inactive_body_does_not_emit_release() {
        let state = AppState::new();
        let mut inner = state.0.lock().unwrap();
        assert!(inner.take_body_release(42, Some((120, 230))).is_none());
    }

    #[test]
    fn release_uses_final_position_instead_of_delayed_move_cache() {
        let mut inner = active_body();
        let d = inner.take_body_release(42, Some((120, 230))).unwrap();
        assert_eq!((d.x, d.y), (20.0, 30.0));
        assert_eq!(inner.last_body_position, Some((120, 230)));
    }

    #[test]
    fn failed_position_query_uses_last_known_move() {
        let mut inner = active_body();
        let d = inner.take_body_release(42, None).unwrap();
        assert_eq!((d.x, d.y), (3.0, 4.0));
    }

    #[test]
    fn release_is_emitted_once_and_keeps_snap_back_base() {
        let mut inner = active_body();
        assert!(inner.take_body_release(42, Some((104, 200))).is_some());
        assert!(!inner.body_dragging);
        assert_eq!(inner.drag_base, Some((100, 200)));
        assert!(inner.take_body_release(42, Some((130, 240))).is_none());
    }

    #[test]
    fn dom_release_winning_race_suppresses_native_release() {
        let mut inner = active_body();
        // body_drag_end 的同步状态变更先于下一次原生轮询。
        assert!(inner.end_body(42));
        assert!(inner.take_body_release(42, Some((104, 200))).is_none());
        assert_eq!(inner.drag_base, Some((100, 200)));
    }

    #[test]
    fn body_release_converts_delta_without_changing_physical_snap_back_base() {
        let mut inner = active_body();
        inner.drag_scale = 1.25;
        let d = inner.take_body_release(42, Some((115, 210))).unwrap();
        assert_eq!((d.x, d.y), (12.0, 8.0));
        assert_eq!(inner.drag_base, Some((100, 200)));
        assert_eq!(inner.last_body_position, Some((115, 210)));
    }

    #[test]
    fn late_dom_end_cannot_end_a_new_native_drag() {
        let mut inner = active_body();
        inner.body_gesture_id = 43;
        assert!(!inner.end_body(42));
        assert!(inner.body_dragging);
        let released = inner.take_body_release(43, Some((110, 200))).unwrap();
        assert_eq!(released.gesture_id, 43);
        assert!(!inner.body_dragging);
    }

    #[test]
    fn late_native_sample_does_not_update_or_release_new_drag() {
        let mut inner = active_body();
        inner.body_gesture_id = 43;
        assert!(inner.take_body_release(42, Some((900, 900))).is_none());
        assert!(inner.body_dragging);
        assert_eq!(inner.last_body_position, Some((103, 204)));
    }

    #[test]
    fn native_release_payload_preserves_id_with_camel_case_key() {
        let mut inner = active_body();
        let released = inner.take_body_release(42, Some((110, 205))).unwrap();
        let payload = serde_json::to_value(released).unwrap();
        assert_eq!(payload["gestureId"], 42);
        assert!(payload.get("gesture_id").is_none());
        assert_eq!(payload["x"], 10.0);
        assert_eq!(payload["y"], 5.0);
    }
}

/// 转发给渲染进程的 CSS 逻辑位移 / 指针坐标；保留缩放后的亚像素精度。
#[derive(Clone, Copy, PartialEq, Serialize)]
struct Pos {
    x: f64,
    y: f64,
}

impl Pos {
    fn relative(position: (i32, i32), origin: (i32, i32), scale_factor: f64) -> Self {
        let (x, y) = logical_offset(position, origin, scale_factor);
        Self { x, y }
    }
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
struct BodyPosition {
    x: f64,
    y: f64,
    gesture_id: u64,
}

impl BodyPosition {
    fn relative(position: (i32, i32), origin: (i32, i32), scale_factor: f64, gesture_id: u64) -> Self {
        let p = Pos::relative(position, origin, scale_factor);
        Self { x: p.x, y: p.y, gesture_id }
    }
}

// ---------------- 命令：与渲染层 petBridge 严格对齐 ----------------

/// 身体拖窗开始：记录窗口基准位置，进入拖窗判定态。
/// 同一命令先记录基准，再启动 OS 原生移动，避免两个 IPC 的执行次序竞态。
#[tauri::command]
fn body_drag_begin(state: State<AppState>, win: WebviewWindow, gesture_id: u64) {
    let pos = win
        .outer_position()
        .map(|p| (p.x, p.y))
        .unwrap_or((0, 0));
    let scale = win.scale_factor().unwrap_or(1.0);
    {
        let mut inner = state.0.lock().unwrap();
        inner.body_dragging = true;
        inner.body_gesture_id = gesture_id;
        inner.drag_base = Some(pos);
        inner.drag_scale = scale;
        inner.last_body_position = Some(pos);
    }
    // 拖窗必须先恢复整窗区域，避免拖出旧形状后系统命中被裁掉；前端也会先提交一次。
    if input_region::set_input_regions(win.clone(), None).is_err() {
        release_body_gesture(&state, &win, gesture_id);
        return;
    }
    let still_active = {
        let inner = state.0.lock().unwrap();
        inner.body_dragging && inner.body_gesture_id == gesture_id
    };
    if !still_active {
        return;
    }
    // 快速松手可能早于 IPC 到达；启动失败也补发终止，避免渲染层等待永远不到的松开。
    // 状态锁已释放，原生拖窗产生的 Moved 事件仍可访问它。
    if unsafe { GetAsyncKeyState(VK_LBUTTON as i32) >= 0 } || win.start_dragging().is_err() {
        release_body_gesture(&state, &win, gesture_id);
    }
}

fn release_body_gesture(state: &State<AppState>, win: &WebviewWindow, gesture_id: u64) {
    let position = win.outer_position().ok().map(|p| (p.x, p.y));
    let released = state.0.lock().unwrap().take_body_release(gesture_id, position);
    if let Some(payload) = released {
        let _ = win.emit("body-released", payload);
    }
}

/// DOM 先收到松开时退出判定态；原生轮询此后不会重复补发松开。
/// 保留 drag_base 供 snap_back 弹回。
#[tauri::command]
fn body_drag_end(state: State<AppState>, gesture_id: u64) {
    state.0.lock().unwrap().end_body(gesture_id);
}

/// 点击成立但窗口被手抖蹭动过：把窗口弹回 begin 时记录的基准位置（单次 reposition，非拖拽流，无重影）。
#[tauri::command]
fn snap_back(state: State<AppState>, win: WebviewWindow) {
    let base = state.0.lock().unwrap().drag_base.take();
    if let Some((x, y)) = base {
        let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
    }
}

/// 点击穿透：ignore=true 时窗口对鼠标"透明"（点击穿透到下方工作窗口）。
/// 注意 Tauri 没有 Electron 的 forward 模式——窗口透明后页面收不到 mousemove，
/// 因此指针位置改由独立的轮询线程持续上报（见 start_pointer_poller）。
#[tauri::command]
fn set_click_through(win: WebviewWindow, ignore: bool) {
    let _ = win.set_ignore_cursor_events(ignore);
}

/// 设置开机自启（写入 Windows 注册表 Run 项）
#[tauri::command]
fn set_autostart(app: AppHandle, on: bool) {
    let mgr = app.autolaunch();
    let _ = if on { mgr.enable() } else { mgr.disable() };
}

/// 退出桌宠（真正退出）
#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

/// 前端初始化完成：显示窗口（消除白屏），并推送一次指针位置。
#[tauri::command]
fn mark_ready(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
        emit_pointer(&app, &win);
    }
}

// ---------------- 窗口坐标记忆 ----------------

fn pos_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|d| d.join("window-pos.json"))
}

fn load_pos(app: &AppHandle) -> Option<(i32, i32)> {
    let p = pos_path(app)?;
    let s = std::fs::read_to_string(p).ok()?;
    let v: serde_json::Value = serde_json::from_str(&s).ok()?;
    let x = v["x"].as_i64()? as i32;
    let y = v["y"].as_i64()? as i32;
    Some((x, y))
}

fn save_pos(app: &AppHandle, x: i32, y: i32) {
    if let Some(p) = pos_path(app) {
        if let Some(dir) = p.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(p, format!("{{\"x\":{x},\"y\":{y}}}"));
    }
}

// ---------------- 指针位置轮询（Tauri 点击穿透的关键） ----------------

/// 独立线程：每 ~16ms 读取系统光标位置，换算成相对"主窗口"的坐标，变化时才上报
/// `pointer-move` 事件。渲染层据此做"是否在热点上"的判定，再回令 set_click_through。
/// 这样即使窗口处于忽略鼠标状态，也能持续获得指针位置，避免"透明后点不回宠物"。
/// 原生拖窗可能接管 DOM pointerup，因此身体手势期间也轮询左键并补一次松开。
fn start_pointer_poller(app: AppHandle) {
    let state = app.state::<AppState>().0.clone();
    std::thread::spawn(move || {
        let mut last: Option<Pos> = None;
        loop {
            std::thread::sleep(Duration::from_millis(16));
            let win = match app.get_webview_window("main") {
                Some(w) => w,
                None => continue,
            };
            // 查询窗口坐标会跨主线程，期间可能开始下一次手势；采样只能结束原来的编号。
            let gesture_id = {
                let inner = state.lock().unwrap();
                if inner.body_dragging { Some(inner.body_gesture_id) } else { None }
            };
            // 只看高位（当前是否按住），不用 GetAsyncKeyState 的低位历史点击标记。
            let left_held = unsafe { GetAsyncKeyState(VK_LBUTTON as i32) < 0 };
            // 在检测到松开之后读取位置，带上最后一次实际窗口位移，避免 move IPC 滞后。
            let position = win.outer_position().ok().map(|p| (p.x, p.y));
            let released = {
                let mut inner = state.lock().unwrap();
                if inner.body_dragging && gesture_id == Some(inner.body_gesture_id) {
                    if position.is_some() {
                        inner.last_body_position = position;
                    }
                    // 位置查询期间若恰好开始新按下，不用查询前的旧松开状态结束它。
                    if !left_held && unsafe { GetAsyncKeyState(VK_LBUTTON as i32) >= 0 } {
                        inner.take_body_release(gesture_id.unwrap(), position)
                    } else {
                        None
                    }
                } else {
                    None
                }
            };
            if let Some(d) = released {
                let _ = win.emit("body-released", d);
            }
            let pointer = match pointer_position(&win) {
                Some(p) => p,
                None => continue,
            };
            if last != Some(pointer) {
                last = Some(pointer);
                let _ = app.emit("pointer-move", pointer);
            }
        }
    });
}

/// DOM clientX/Y 以客户区为原点、以 CSS 像素为单位；系统光标则是物理屏幕像素。
fn pointer_position(win: &WebviewWindow) -> Option<Pos> {
    let origin = win.inner_position().ok()?;
    let scale = win.scale_factor().ok()?;
    let mut pt = POINT { x: 0, y: 0 };
    unsafe {
        if GetCursorPos(&mut pt) == 0 {
            return None;
        }
    }
    Some(Pos::relative((pt.x, pt.y), (origin.x, origin.y), scale))
}

fn emit_pointer(app: &AppHandle, win: &WebviewWindow) {
    if let Some(pointer) = pointer_position(win) {
        let _ = app.emit("pointer-init", pointer);
    }
}

// ---------------- 系统托盘 ----------------

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::TrayIconBuilder;

    let toggle = MenuItem::with_id(app, "toggle", "显示 / 隐藏", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle, &quit])?;

    let icon = app.default_window_icon().cloned().expect("缺少默认图标");
    TrayIconBuilder::new()
        .icon(icon)
        .tooltip(format!("Fishing Cat · 钓鱼桌宠 · v{}", app.package_info().version))
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle" => {
                if let Some(w) = app.get_webview_window("main") {
                    if w.is_visible().unwrap_or(false) {
                        let _ = w.hide();
                    } else {
                        let _ = w.show();
                        let _ = w.set_focus();
                        let _ = w.unminimize();
                    }
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

// ---------------- 应用入口 ----------------

pub fn run() {
    // 在 Builder 链上注册窗口事件（Tauri v2 的 on_window_event 是 Builder 方法，
    // 闭包里通过 window.app_handle() 拿 AppHandle 做坐标持久化与事件转发）。
    let app_state = AppState::new();
    let st_arc = app_state.0.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
                let _ = w.unminimize();
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .manage(app_state)
        .on_window_event(move |window, event| match event {
            WindowEvent::Moved(pos) => {
                let mut inner = st_arc.lock().unwrap();
                if inner.body_dragging {
                    inner.last_body_position = Some((pos.x, pos.y));
                    if let Some(base) = inner.drag_base {
                        let d = BodyPosition::relative((pos.x, pos.y), base, inner.drag_scale, inner.body_gesture_id);
                        let _ = window.emit("body-moved", d);
                    }
                }
                let now = Instant::now();
                if now.duration_since(inner.last_save) > Duration::from_millis(400) {
                    inner.last_save = now;
                    let apph = window.app_handle();
                    save_pos(apph, pos.x, pos.y);
                }
            }
            WindowEvent::CloseRequested { api, .. } => {
                // 截图 / 误触 / 系统事件触发的关闭一律改为"隐藏"，桌宠常驻；
                // 真正退出只走托盘「退出」或工具菜单「退出」(app.exit)。
                api.prevent_close();
                let _ = window.hide();
            }
            _ => {}
        })
        .setup(|app| {
            let apph = app.handle().clone();
            // 启动时恢复上次记忆的窗口位置
            if let Some((x, y)) = load_pos(&apph) {
                if let Some(w) = apph.get_webview_window("main") {
                    let _ = w.set_position(tauri::PhysicalPosition::new(x, y));
                }
            }
            build_tray(app.handle())?;
            start_pointer_poller(apph);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            body_drag_begin,
            body_drag_end,
            snap_back,
            set_click_through,
            set_autostart,
            quit,
            mark_ready,
            music::list_local_music,
            music::music_folder_info,
            music::import_local_music,
            music::read_local_music,
            music::remove_local_music,
            input_region::set_input_regions,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_, _| {});
}
