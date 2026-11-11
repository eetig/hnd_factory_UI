use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};
use tauri_plugin_autostart::MacosLauncher;

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

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
