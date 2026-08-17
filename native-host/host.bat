@echo off
set "PORTABLE_NODE=%~dp0..\server\bin\node\node.exe"

if exist "%PORTABLE_NODE%" (
  "%PORTABLE_NODE%" "%~dp0host.js" %*
) else (
  node "%~dp0host.js" %*
)
