@echo off
title Video Downloader - Native Host Setup
color 0A

echo.
echo  ==============================================
echo     AUTO START SERVER SETUP
echo  ==============================================
echo.

set "ROOT=%~dp0"
set "JSON_PATH=%ROOT%com.video_downloader.server.json"

:: Cập nhật đường dẫn host.exe trong file JSON
powershell -Command "$json = Get-Content '%JSON_PATH%' | ConvertFrom-Json; $json.path = '%ROOT%host.exe'; $json | ConvertTo-Json -Depth 10 | Set-Content '%JSON_PATH%' -Encoding UTF8"

:: Ghi vào Registry
REG ADD "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.video_downloader.server" /ve /t REG_SZ /d "%JSON_PATH%" /f >nul

if %errorlevel% equ 0 (
    echo  [OK] Registry added successfully!
    echo       Server will now auto-start when Extension is opened.
) else (
    echo  [ERROR] Failed to add Registry key.
)
echo.
pause
