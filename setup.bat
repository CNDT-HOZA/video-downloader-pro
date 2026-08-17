@echo off
setlocal
title Video Downloader Pro - Setup
color 0A

:: KHONG them "chcp 65001" vao day: cmd.exe se doc lech file .bat va bao loi
:: kieu "'tle' is not recognized". Moi thong bao deu dung thuan ASCII de khong
:: phu thuoc bang ma console.

echo.
echo  ==============================================
echo     VIDEO DOWNLOADER PRO - 1 CLICK SETUP
echo     (Khong can Node.js, khong can Python)
echo  ==============================================
echo.

set "ROOT=%~dp0"
set "SERVER_DIR=%ROOT%server"
set "SERVER_EXE=%SERVER_DIR%\server.exe"

if not exist "%SERVER_EXE%" (
    echo  [ERROR] Khong tim thay server.exe!
    echo  Vui long giai nen TOAN BO thu muc Zip truoc khi chay setup.bat.
    echo.
    pause
    exit /b 1
)

echo  [1/3] Kiem tra cong cu di kem...
set "MISSING="
if not exist "%SERVER_DIR%\bin\yt-dlp.exe"  set "MISSING=%MISSING% yt-dlp"
if not exist "%SERVER_DIR%\bin\ffmpeg.exe"  set "MISSING=%MISSING% ffmpeg"
if not exist "%SERVER_DIR%\bin\ffprobe.exe" set "MISSING=%MISSING% ffprobe"

if defined MISSING (
    echo        [!] Thieu:%MISSING%
    echo            Server se tu dong tai ve trong lan chay dau tien ^(can Internet^).
) else (
    echo        [OK] Da co day du yt-dlp, ffmpeg, ffprobe trong server\bin
)
echo.

echo  [2/3] Dang dang ky Native Messaging cho trinh duyet...
"%SERVER_EXE%" --setup
if errorlevel 1 (
    echo.
    echo  [ERROR] Dang ky that bai. Server se KHONG tu khoi dong duoc.
    echo          Thu chuyen thu muc nay ra ngoai Program Files roi chay lai.
    echo.
    pause
    exit /b 1
)
echo.

echo  [3/3] Cai extension vao trinh duyet:
echo.
echo   ---------------------------------------------
echo    1. Mo Chrome ^(hoac Edge / Brave / Coc Coc^)
echo    2. Vao dia chi: chrome://extensions
echo    3. Bat "Developer mode" o goc tren ben phai
echo    4. Nhan "Load unpacked"
echo    5. Chon thu muc:
echo       %ROOT%extension
echo   ---------------------------------------------
echo.
echo  Xong! Server se tu khoi dong khi ban mo trinh duyet.
echo.
echo  Ghi chu: tu ban nay, moi lan server chay no deu tu kiem tra va dang ky
echo  lai neu can. Nen neu sau nay ban di chuyen thu muc, chi can chay
echo  START_SERVER.bat mot lan la lien ket duoc noi lai.
echo.
echo  Neu server van khong tu chay, chay file CHAN-DOAN.bat
echo  de biet chinh xac dang vuong o dau.
echo.
pause
endlocal
exit /b 0
