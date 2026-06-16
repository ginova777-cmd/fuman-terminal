@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "PWSH=C:\Program Files\PowerShell\7\pwsh.exe"
if not exist "%PWSH%" set "PWSH=%LOCALAPPDATA%\Microsoft\WindowsApps\pwsh.exe"
if not exist "%PWSH%" set "PWSH=powershell.exe"
"%PWSH%" -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%Run-PublicSlotSharedSource.ps1" -RestQuoteBatchSize 20 -RestQuoteEverySeconds 10 -Direct1mBatchSize 3 -Direct1mEverySeconds 60 -FutoptQuoteBatchSize 10 -FutoptQuoteEverySeconds 60
endlocal
