@echo off
setlocal
title Video Downloader - Chan doan

:: KHONG dung "chcp 65001" trong file .bat: cmd.exe theo doi vi tri doc file
:: bang byte offset, doi bang ma giua chung se lam no doc lech va bao loi kieu
:: "'tle' is not recognized". File nay phai giu THUAN ASCII.

set "SERVER_EXE=%~dp0server\server.exe"

if not exist "%SERVER_EXE%" (
    echo.
    echo  [LOI] Khong tim thay:
    echo  %SERVER_EXE%
    echo.
    echo  File zip chua duoc giai nen day du.
    echo.
    pause
    exit /b 1
)

:: In ngay build truoc khi goi exe. Cach nay chay duoc voi MOI phien ban,
:: ke ca ban cu chua ho tro --doctor.
for %%F in ("%SERVER_EXE%") do (
    echo.
    echo  server.exe : %%~fF
    echo  Ngay build : %%~tF
    echo  Kich thuoc : %%~zF bytes
)

"%SERVER_EXE%" --doctor
if errorlevel 2 (
    echo.
    echo  ==========================================================
    echo   server.exe TREN MAY NAY LA BAN CU
    echo  ==========================================================
    echo.
    echo   No chua co chuc nang chan doan, va nhieu kha nang cung
    echo   chua co ban va giup server tu khoi dong.
    echo.
    echo   Cach xu ly:
    echo    1. Sang may goc, chay BUILD.bat de dung ban moi nhat
    echo    2. Copy de len file: server\server.exe
    echo    3. Tren may nay chay lai setup.bat
    echo    4. Chay lai CHAN-DOAN.bat de kiem tra
    echo.
    echo   Doi chieu "Ngay build" o tren voi file server.exe
    echo   tren may goc de biet chac da copy dung ban chua.
    echo.
)

echo.
echo  Chup man hinh ket qua tren de gui di neu can ho tro.
echo.
pause
endlocal
