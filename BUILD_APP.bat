@echo off
chcp 65001 >nul
title Build Pro Video Downloader
cd /d "%~dp0"

set "EXE_NAME=Pro_VideoDownloader"

echo.
echo ============================================================
echo   [1/4] Kiem tra app co dang chay khong
echo ============================================================
tasklist /FI "IMAGENAME eq %EXE_NAME%.exe" 2>nul | find /I "%EXE_NAME%.exe" >nul
if not errorlevel 1 (
    echo.
    echo   LOI: %EXE_NAME%.exe dang chay.
    echo   Windows khoa file nen PyInstaller khong ghi de duoc.
    echo   Hay dong tat ca cua so app roi chay lai script nay.
    echo.
    pause
    exit /b 1
)
echo   OK - khong co tien trinh nao dang chay.

echo.
echo ============================================================
echo   [2/4] Cai dependencies
echo ============================================================
pip install -r requirements.txt --quiet
if errorlevel 1 (
    echo.
    echo   LOI: pip that bai. Dung build.
    pause
    exit /b 1
)

where pyinstaller >nul 2>nul
if errorlevel 1 (
    echo   Chua co PyInstaller - dang cai...
    pip install pyinstaller --quiet
)

echo.
echo ============================================================
echo   [3/4] Chay test
echo ============================================================
python -m unittest test_app
if errorlevel 1 (
    echo.
    echo   TEST THAT BAI - dung build.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo   [4/4] Dong goi thanh .EXE
echo ============================================================
if exist dist rd /s /q dist
if exist build rd /s /q build
if exist dist (
    echo   LOI: khong xoa duoc thu muc dist - co file dang bi khoa.
    pause
    exit /b 1
)

pyinstaller %EXE_NAME%.spec
if errorlevel 1 (
    echo.
    echo   BUILD THAT BAI - xem loi PyInstaller o tren.
    pause
    exit /b 1
)

if not exist "dist\%EXE_NAME%.exe" (
    echo.
    echo   BUILD THAT BAI - khong tao ra duoc file exe.
    pause
    exit /b 1
)

echo.
echo ============================================================
for %%F in ("dist\%EXE_NAME%.exe") do echo   XONG: dist\%EXE_NAME%.exe  (%%~zF bytes^)
echo ============================================================
echo.
pause
