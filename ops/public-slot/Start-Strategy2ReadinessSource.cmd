@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "PWSH=C:\Program Files\PowerShell\7\pwsh.exe"
if not exist "%PWSH%" set "PWSH=%LOCALAPPDATA%\Microsoft\WindowsApps\pwsh.exe"
if not exist "%PWSH%" set "PWSH=powershell.exe"

rem Strategy2 readiness source:
rem - 08:45 futopt: keep futopt_quotes_live fresh for stock futures.
rem - 08:55 preopen: write preopen snapshot history densely enough for 3 samples / 1 minute.
rem - 09:00-12:00: keep full quote universe and 1m aggregation warm for ready_ge_35.
node "%SCRIPT_DIR%..\..\scripts\check-strategy2-trading-day.js" --closed-exit-code=10
if %ERRORLEVEL% EQU 10 exit /b 0
if %ERRORLEVEL% NEQ 0 exit /b %ERRORLEVEL%
"%PWSH%" -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%Run-PublicSlotSharedSource.ps1" -LoopSeconds 10 -StopAt 12:05 -RestQuoteBatchSize 80 -RestQuoteEverySeconds 10 -Direct1mBatchSize 8 -Direct1mEverySeconds 20 -FutoptQuoteBatchSize 80 -FutoptQuoteEverySeconds 20 -FutoptTickersEverySeconds 300
endlocal
