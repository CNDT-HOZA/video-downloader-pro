@echo off
title Video Downloader - Auto Install
color 0A

echo.
echo  ==============================================
echo     VIDEO DOWNLOADER - AUTO INSTALL
echo     No Admin rights required
echo  ==============================================
echo.

set "ROOT=%~dp0"
set "SERVER=%ROOT%server"
set "BIN=%SERVER%\bin"
set "NODE_DIR=%BIN%\node"
set "NODE_EXE=%NODE_DIR%\node.exe"
set "NPM_CMD=%NODE_DIR%\npm.cmd"
set "NODE_VER=22.16.0"
set "NODE_ZIP=node-v%NODE_VER%-win-x64.zip"
set "NODE_URL=https://nodejs.org/dist/v%NODE_VER%/%NODE_ZIP%"

:: === 1. Check Node.js ===
echo [1/4] Checking Node.js...

:: Try portable Node.js first
if exist "%NODE_EXE%" (
    echo   [OK] Portable Node.js found
    goto :check_npm
)

:: Try system Node.js
where node >nul 2>&1
if %errorlevel% equ 0 (
    echo   [OK] System Node.js found
    set "NODE_EXE=node"
    set "NPM_CMD=npm.cmd"
    goto :check_npm
)

:: Download portable Node.js
echo   [-] Downloading portable Node.js v%NODE_VER%...
if not exist "%BIN%" mkdir "%BIN%"

powershell -Command "& { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $ProgressPreference = 'SilentlyContinue'; Invoke-WebRequest -Uri '%NODE_URL%' -OutFile '%BIN%\%NODE_ZIP%' }"
if %errorlevel% neq 0 (
    echo   [ERROR] Failed to download Node.js!
    pause
    exit /b 1
)

echo   [-] Extracting...
powershell -Command "Expand-Archive -Path '%BIN%\%NODE_ZIP%' -DestinationPath '%BIN%' -Force"

:: Rename directory
if exist "%NODE_DIR%" rmdir /s /q "%NODE_DIR%"
rename "%BIN%\node-v%NODE_VER%-win-x64" "node"

:: Clean up zip
del /q "%BIN%\%NODE_ZIP%" 2>nul

if exist "%NODE_EXE%" (
    echo   [OK] Portable Node.js installed
) else (
    echo   [ERROR] Failed to extract Node.js!
    pause
    exit /b 1
)

:check_npm
echo.

:: === 2. Install npm packages ===
echo [2/4] Installing packages...

cd /d "%SERVER%"
if not exist "node_modules" (
    echo   [-] Running npm install...
    call "%NPM_CMD%" install --production 2>nul
    if %errorlevel% equ 0 (
        echo   [OK] Packages installed
    ) else (
        echo   [ERROR] npm install failed!
        pause
        exit /b 1
    )
) else (
    echo   [OK] Packages already installed
)
echo.

:: === 3. Start server ===
echo [3/4] Starting server (will auto-download tools if missing)...
echo.

start "" "%NODE_EXE%" "%SERVER%\index.js"

:: Wait for server
echo   Waiting for server...
set /a count=0
:wait_loop
timeout /t 2 /nobreak >nul
set /a count+=1

powershell -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:3847/api/health' -UseBasicParsing -TimeoutSec 2; exit 0 } catch { exit 1 }" >nul 2>&1
if %errorlevel% equ 0 (
    echo   [OK] Server is ready at http://localhost:3847
    goto :done
)

if %count% lss 30 goto :wait_loop
echo   [WARNING] Server not responding yet, it might be downloading FFmpeg...

:done
echo.

:: === 4. Instructions ===
echo [4/4] Chrome Extension Installation
echo.
echo  ---------------------------------------------
echo   1. Open Chrome, go to: chrome://extensions/
echo   2. Enable "Developer mode" (top right)
echo   3. Click "Load unpacked"
echo   4. Select the "extension" folder
echo   5. Done! Open YouTube and download videos!
echo  ---------------------------------------------
echo.
echo  Server is running in background terminal.
echo.
pause
