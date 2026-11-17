# 注册「手机端打包好就自动上线」的计划任务（2026-11-17）
#
# 为什么要计划任务而不是常驻脚本：常驻脚本会随会话/窗口消失（11-17 就是这么漏发的）。
# 计划任务开机就在，每分钟看一次 dist/release/apk，有新包且版本号过了守卫就发。
$ErrorActionPreference = 'Stop'

$node = (Get-Command node).Source
$script = 'D:\project\hnd_factory_UI\scripts\auto-publish-app.mjs'
$work = 'D:\project\hnd_factory_UI'

# 关键：不要直接启动 node.exe —— 它是控制台程序，计划任务每分钟起一次，桌面上就会闪黑框。
# 走 wscript + 隐藏模式启动（scripts/run-hidden-app-publish.vbs），全程无窗口。
$wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
$vbs = 'D:\project\hnd_factory_UI\scripts\run-hidden-app-publish.vbs'

$action = New-ScheduledTaskAction -Execute $wscript -Argument ('//B //Nologo "' + $vbs + '"') -WorkingDirectory $work
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes 1)
$settings = New-ScheduledTaskSettingsSet -Hidden -StartWhenAvailable `
  -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

Register-ScheduledTask -TaskName 'HND-app-auto-publish' -Action $action -Trigger $trigger `
  -Settings $settings -Description '手机 App：APK 落地后自动上传并发布（版本号守卫）' -Force | Out-Null

$t = Get-ScheduledTask -TaskName 'HND-app-auto-publish'
"{0} -> {1}" -f $t.TaskName, $t.State
$t.Actions[0].Execute + ' ' + $t.Actions[0].Arguments
($t.Triggers[0].Repetition.Interval)
