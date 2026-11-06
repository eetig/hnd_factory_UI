@echo off
title HND 生产助手 - 手机预览（H5 开发服务器）

rem ============================================================
rem  双击这个文件即启动 H5 开发服务器，然后用手机浏览器打开窗口里
rem  显示的 Network 地址（手机要和电脑连同一个 WiFi）。
rem
rem  为什么要它：HBuilderX 里那个
rem     remove D:\_tmp\esbuild-xxxx: Access is denied
rem  是 HBuilderX 自带 Vite 的清理 bug，不改代码也绕不过去；
rem  走命令行这条链是干净的，所以用它在手机上先看界面。
rem
rem  关掉这个黑窗口 = 停止服务。
rem ============================================================

cd /d "%~dp0"

set ESBUILD_BINARY_PATH=%~dp0node_modules\@esbuild\win32-x64\esbuild.exe
if not exist "D:\_tmp" mkdir "D:\_tmp"
set TEMP=D:\_tmp
set TMP=D:\_tmp

echo ============================================================
echo   正在启动 H5 开发服务器...
echo   启动后，用手机浏览器打开下面显示的 Network 地址
echo   （手机要和这台电脑连同一个 WiFi）
echo ============================================================
echo.

call npm run dev:h5

echo.
echo 服务已退出。按任意键关闭窗口。
pause >nul
