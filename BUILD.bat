@echo off
setlocal
title Video Downloader - Build server.exe

set "ROOT=%~dp0"
set "SERVER_DIR=%ROOT%server"

echo.
echo  Dang build server.exe (can Node.js + Internet lan dau)...
echo.

where node >nul 2>&1
if errorlevel 1 (
    if exist "%SERVER_DIR%\bin\node\node.exe" (
        set "PATH=%SERVER_DIR%\bin\node;%PATH%"
    ) else (
        echo  [ERROR] Khong tim thay Node.js. Cai Node.js roi chay lai.
        pause
        exit /b 1
    )
)

cd /d "%SERVER_DIR%"

:: Dung server cu neu dang chay, neu khong se khong ghi de duoc file exe
taskkill /f /im server.exe >nul 2>&1

call npx pkg . --targets node18-win-x64 --output server.exe
if errorlevel 1 (
    echo.
    echo  [ERROR] Build that bai.
    pause
    exit /b 1
)

echo.
echo  [OK] Da build: %SERVER_DIR%\server.exe
echo.
echo  Buoc tiep theo: chay setup.bat de cap nhat duong dan trong registry.
echo.
pause
endlocal
