@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "PWSH=C:\Program Files\PowerShell\7\pwsh.exe"
if not exist "%PWSH%" set "PWSH=%LOCALAPPDATA%\Microsoft\WindowsApps\pwsh.exe"
if not exist "%PWSH%" set "PWSH=powershell.exe"
"%PWSH%" -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%Run-PublicSlotSharedSource.ps1"
endlocal
