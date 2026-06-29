@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "PWSH=C:\Program Files\PowerShell\7\pwsh.exe"
if not exist "%PWSH%" set "PWSH=%LOCALAPPDATA%\Microsoft\WindowsApps\pwsh.exe"
if not exist "%PWSH%" set "PWSH=powershell.exe"

rem Strategy2 readiness source:
rem - 08:45 futopt: keep futopt_quotes_live fresh for stock futures.
rem - 08:55 preopen: write preopen snapshot history densely enough for 3 samples / 1 minute.
rem - 08:45-13:35: keep full quote universe and 1m aggregation warm for ready_ge_35.
node "%SCRIPT_DIR%..\..\scripts\check-strategy2-trading-day.js" --closed-exit-code=10
if %ERRORLEVEL% EQU 10 exit /b 0
if %ERRORLEVEL% NEQ 0 exit /b %ERRORLEVEL%
"%PWSH%" -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%Run-PublicSlotSharedSource.ps1" -LoopSeconds 10 -StopAt 14:05 -MinAvgVolume5Lots 0 -RestQuoteBatchSize 240 -RestQuoteEverySeconds 10 -RestQuoteDelayMilliseconds 40 -FugleCollectorLoopMilliseconds 1000 -FugleCollectorBatchSize 320 -FugleCollectorConcurrency 4 -FugleCollectorRequestDelayMilliseconds 20 -FugleCollectorQuoteTtlMilliseconds 120000 -Direct1mBatchSize 8 -Direct1mEverySeconds 20 -Direct1mPrewarmSymbolCount 2000 -Direct1mPrewarmBatchSize 80 -Direct1mPrewarmBars 200 -QuoteDerived1mCandidateCount 0 -QuoteDerived1mMaxQuoteAgeSeconds 120 -QuoteDerivedOpeningBackfillMinutes 6 -Intraday1mFreshTargetSeconds 60 -Intraday1mFreshHardSeconds 120 -FutoptQuoteBatchSize 120 -FutoptQuoteEverySeconds 20 -FutoptQuoteDelayMilliseconds 100 -FutoptTickersEverySeconds 300 -PublicSlotUpsertTimeoutSec 45 -PublicSlotUpsertBatchSize 300 -WritePreopenRowsMode preopen -Strategy2ReadyPageSize 500
endlocal
