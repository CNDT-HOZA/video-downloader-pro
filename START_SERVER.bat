@echo off
setlocal
title Video Downloader Server

set "ROOT=%~dp0"
set "SERVER_DIR=%ROOT%server"
set "SERVER_EXE=%SERVER_DIR%\server.exe"

:: Uu tien ban dong goi (khong can Node.js)
if exist "%SERVER_EXE%" (
    echo Starting server.exe...
    "%SERVER_EXE%" --server
    pause
    exit /b
)

:: Fallback: chay tu source bang Node.js portable
set "NODE_EXE=%SERVER_DIR%\bin\node\node.exe"
if exist "%NODE_EXE%" (
    echo Starting with portable Node.js...
    cd /d "%SERVER_DIR%"
    "%NODE_EXE%" index.js
    pause
    exit /b
)

:: Fallback: Node.js he thong
where node >nul 2>&1
if %errorlevel% equ 0 (
    echo Starting with system Node.js...
    cd /d "%SERVER_DIR%"
    node index.js
    pause
    exit /b
)

echo.
echo  [ERROR] Khong tim thay server.exe lan Node.js!
echo  Hay chay setup.bat truoc.
echo.
pause
endlocal
