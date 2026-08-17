@echo off
set "NODE_EXE="

if exist "%~dp0..\server\bin\node\node.exe" (
    set "NODE_EXE=%~dp0..\server\bin\node\node.exe"
) else if exist "C:\Program Files\nodejs\node.exe" (
    set "NODE_EXE=C:\Program Files\nodejs\node.exe"
) else if exist "C:\Program Files (x86)\nodejs\node.exe" (
    set "NODE_EXE=C:\Program Files (x86)\nodejs\node.exe"
) else (
    set "NODE_EXE=node"
)

"%NODE_EXE%" "%~dp0host.js" %* 2> "%~dp0host_error.log"
