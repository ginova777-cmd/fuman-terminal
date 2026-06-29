@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "PWSH=C:\Program Files\PowerShell\7\pwsh.exe"
if not exist "%PWSH%" set "PWSH=%LOCALAPPDATA%\Microsoft\WindowsApps\pwsh.exe"
if not exist "%PWSH%" set "PWSH=powershell.exe"
"%PWSH%" -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%Run-PublicSlotSharedSource.ps1" -LoopSeconds 10 -StopAt 12:05 -MinAvgVolume5Lots 0 -RestQuoteBatchSize 80 -RestQuoteEverySeconds 10 -Direct1mBatchSize 8 -Direct1mEverySeconds 20 -FutoptQuoteBatchSize 120 -FutoptQuoteEverySeconds 20 -FutoptQuoteDelayMilliseconds 100 -FutoptTickersEverySeconds 300 -PublicSlotUpsertTimeoutSec 45 -PublicSlotUpsertBatchSize 300 -WritePreopenRowsMode preopen -Strategy2ReadyPageSize 250
endlocal
