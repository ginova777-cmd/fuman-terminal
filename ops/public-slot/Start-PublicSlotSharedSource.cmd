@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "PWSH=C:\Program Files\PowerShell\7\pwsh.exe"
if not exist "%PWSH%" set "PWSH=%LOCALAPPDATA%\Microsoft\WindowsApps\pwsh.exe"
if not exist "%PWSH%" set "PWSH=powershell.exe"
"%PWSH%" -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%Run-PublicSlotSharedSource.ps1" -LoopSeconds 10 -StopAt 14:05 -MinAvgVolume5Lots 0 -RestQuoteBatchSize 40 -RestQuoteEverySeconds 10 -RestQuoteDelayMilliseconds 600 -FugleCollectorLoopMilliseconds 1000 -FugleCollectorBatchSize 120 -FugleCollectorConcurrency 2 -FugleCollectorRequestDelayMilliseconds 80 -FugleCollectorQuoteTtlMilliseconds 120000 -Direct1mBatchSize 8 -Direct1mEverySeconds 20 -Direct1mPrewarmSymbolCount 2000 -Direct1mPrewarmBatchSize 80 -Direct1mPrewarmBars 200 -QuoteDerived1mCandidateCount 0 -QuoteDerived1mMaxQuoteAgeSeconds 120 -QuoteDerivedOpeningBackfillMinutes 6 -Intraday1mFreshTargetSeconds 60 -Intraday1mFreshHardSeconds 120 -FutoptQuoteBatchSize 120 -FutoptQuoteEverySeconds 20 -FutoptQuoteDelayMilliseconds 100 -FutoptTickersEverySeconds 300 -PublicSlotUpsertTimeoutSec 45 -PublicSlotUpsertBatchSize 300 -WritePreopenRowsMode preopen -Strategy2ReadyRefreshEnabled:$true -Strategy2ReadyPageSize 500
endlocal
