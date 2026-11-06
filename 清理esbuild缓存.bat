@echo off
chcp 65001 >nul
title 清理 esbuild / vite 缓存

echo ============================================
echo   清理 esbuild 临时文件 + 残留进程
echo ============================================
echo.

echo [1/3] 杀掉残留的 esbuild 进程...
taskkill /f /im esbuild.exe 2>nul
if %errorlevel%==0 (
    echo   ✓ 已杀掉 esbuild 进程
) else (
    echo   - 没有找到 esbuild 进程，跳过
)
echo.

echo [2/3] 清理系统 Temp 目录下的 esbuild 临时文件...
set TEMP_DIR=%TEMP%
del /q /s "%TEMP_DIR%\esbuild-*" 2>nul
for /d %%i in ("%TEMP_DIR%\esbuild-*") do rd /s /q "%%i" 2>nul
echo   ✓ 已清理
echo.

echo [3/3] 清理项目内 vite 缓存...
set PROJ_DIR=%~dp0
if exist "%PROJ_DIR%node_modules\.vite" (
    rd /s /q "%PROJ_DIR%node_modules\.vite"
    echo   ✓ 已清理 node_modules\.vite
) else (
    echo   - 没有 vite 缓存目录，跳过
)
echo.

echo ============================================
echo   清理完成！现在可以重新打开 HBuilderX 编译了
echo ============================================
pause
