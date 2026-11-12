use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri_plugin_autostart::MacosLauncher;
use window_vibrancy::{apply_acrylic, apply_mica};

/// 给主窗口上原生材质（2026-11-11）。
///
/// 为什么放在 Rust 侧：Windows 的亚克力是 DWM 合成的真实材质，WebView 里用
/// `backdrop-filter: blur()` 模拟会让每一帧滚动都重新采样背景，抄表页那种长列表
/// 一滑就掉帧。系统材质只付一次合成成本。
///
/// 顺序：先亚克力（Win10 1803+ 都支持，带色调），失败再云母（Win11 22H2+）。
/// 两者都不支持时什么都不做 —— 前端有兜底底色，不会变白。
fn paint_window_material(window: &tauri::WebviewWindow) -> &'static str {
    #[cfg(target_os = "windows")]
    {
        // 参数是 RGBA 色调：微微偏冷的中性灰，让底层壁纸/桌面透上来但不脏。
        if apply_acrylic(window, Some((24, 24, 28, 150))).is_ok() {
            return "acrylic";
        }
        if apply_mica(window, Some(true)).is_ok() {
            return "mica";
        }
        "none"
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = window;
        "none"
    }
}

/// 材质状态（2026-11-12）。
///
/// 为什么要把结果告诉前端：亚克力在个别机器/显卡上会申请失败，窗口就变成"透穿"——
/// 桌面图标清清楚楚地透上来，文字压在杂色上，比不透明还难看。前端拿到 "none"
/// 就把纸面转成实色，宁可少一点通透，也不能让字看不清。
struct MaterialState(Mutex<String>);

#[tauri::command]
fn window_material(state: tauri::State<MaterialState>) -> String {
    state.0.lock().map(|v| v.clone()).unwrap_or_else(|_| "none".into())
}

/// 把主窗口叫回前台（托盘左键、托盘菜单「打开主界面」都走这里）。
fn focus_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        /*
         * 桌面版的请求通道（2026-11-11）。
         *
         * 网页版走浏览器 XHR；桌面版的页面在 tauri.localhost 下，请求 hbhnd.cloud 属于跨域，
         * 线上后端的 CORS 预检会 403。改由 Rust 发请求就没有同源策略这回事。
         * 前端见 src/api/desktopHttp.js，域名白名单见 capabilities/default.json。
         */
        .plugin(tauri_plugin_http::init())
        /*
         * 开机自启：往注册表 HKCU\...\Run 写一条，不需要管理员权限。
         * 第二个参数是 macOS 的启动方式（本项目只发 Windows，留着不影响）。
         * 真正"开/关"由前端调用 enable()/disable() 决定，见 src/desktop/autostart.js。
         */
        /*
         * 自动更新（2026-11-11）：启动后由前端调用 check() 询问
         * https://hbhnd.cloud/desktop/latest.json，有新版就下载并重启。
         * 公钥写在 tauri.conf.json 的 plugins.updater.pubkey，私钥不进仓。
         */
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        /*
         * 关闭按钮的含义（用户要求）：点 ✕ 不退出，先问「退出程序 / 最小化到托盘」。
         * 这里只负责拦下关闭并通知前端，选择由 src/desktop/closeBehavior.js 决定。
         */
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.emit("app://close-requested", ());
            }
        })
        .setup(|app| {
            /*
             * 托盘：程序收起来之后，任务栏右下角留一个图标。
             * 左键 = 回到主界面；右键菜单 = 打开主界面 / 退出。
             */
            let open_item = MenuItem::with_id(app, "open", "打开主界面", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &quit_item])?;

            let mut builder = TrayIconBuilder::with_id("main-tray")
                .tooltip("HND 生产助手")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => focus_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        focus_main(tray.app_handle());
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                builder = builder.icon(icon.clone());
            }
            builder.build(app)?;

            // 无边框窗口 + 原生亚克力：前端画标题栏与页面，窗口背景是系统材质。
            let material = match app.get_webview_window("main") {
                Some(window) => paint_window_material(&window).to_string(),
                None => "none".to_string(),
            };
            app.manage(MaterialState(Mutex::new(material)));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![window_material])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
