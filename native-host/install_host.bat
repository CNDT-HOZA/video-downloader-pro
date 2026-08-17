@echo off
setlocal
cd /d "%~dp0"

:: Tìm đường dẫn compiler csc.exe của .NET Framework
set "CSC="
for /d %%D in ("%windir%\Microsoft.NET\Framework\v4.*") do (
    if exist "%%D\csc.exe" set "CSC=%%D\csc.exe"
)

if not defined CSC (
    echo [ERROR] Khong tim thay trinh bien dich C# (.NET Framework 4.x)
    exit /b 1
)

echo Dang bien dich host.exe...
"%CSC%" /nologo /out:host.exe wrapper.cs
if %errorlevel% neq 0 (
    echo [ERROR] Bien dich that bai!
    exit /b 1
)

echo [OK] Bien dich thanh cong host.exe
exit /b 0
