use tauri_plugin_autostart::MacosLauncher;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        /*
         * 开机自启：往注册表 HKCU\...\Run 写一条，不需要管理员权限。
         * 第二个参数是 macOS 的启动方式（本项目只发 Windows，留着不影响）。
         * 真正"开/关"由前端调用 enable()/disable() 决定，见 src/desktop/autostart.js。
         */
        /*
         * 自动更新（2026-11-11）：启动后由前端调用 check() 询问
         * https://hbbhnd.cloud/desktop/latest.json，有新版就下载并重启。
         * 公钥写在 tauri.conf.json 的 plugins.updater.pubkey，私钥不进仓。
         */
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
