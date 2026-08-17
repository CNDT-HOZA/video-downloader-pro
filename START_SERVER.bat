@echo off
title Video Downloader Server

set "ROOT=%~dp0"
set "SERVER=%ROOT%server"
set "NODE_EXE=%SERVER%\bin\node\node.exe"

:: Try portable Node.js first
if exist "%NODE_EXE%" (
    echo Starting with portable Node.js...
    "%NODE_EXE%" "%SERVER%\index.js"
    pause
    exit /b
)

:: Fallback to system Node.js
where node >nul 2>&1
if %errorlevel% equ 0 (
    echo Starting with system Node.js...
    cd /d "%SERVER%"
    node index.js
    pause
    exit /b
)

:: No Node.js found
echo.
echo [ERROR] Node.js not found!
echo Please run INSTALL.bat first.
echo.
pause
