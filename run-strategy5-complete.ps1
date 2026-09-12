param([ValidateSet("Complete", "Status", "Recovery")][string]$Mode = "Complete", [string]$ReplayTradeDate = "", [string]$ExpectedRunId = "")
$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
Set-Location -LiteralPath $PSScriptRoot
$runtime = if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }
$env:FUMAN_RUNTIME_DIR = $runtime
$nodeExe = "C:\Program Files\nodejs\node.exe"
if (-not (Test-Path -LiteralPath $nodeExe)) { $nodeExe = "node.exe" }
$pwshExe = (Get-Process -Id $PID).Path
$env:FUMAN_REPLAY_TRADE_DATE = $ReplayTradeDate
$env:FUMAN_STRATEGY5_REPLAY_VALIDATED = '0'
if ($ReplayTradeDate) {
  & $nodeExe --use-system-ca scripts/verify-institution-replay-date.js $ReplayTradeDate
  if ($LASTEXITCODE -ne 0) { throw 'strategy5_replay_date_invalid' }
  $env:FUMAN_STRATEGY5_REPLAY_VALIDATED = '1'
  $env:FUMAN_SCANNER_TARGET_TRADE_DATE = $ReplayTradeDate
  $env:FUMAN_TERMINAL_TARGET_TRADE_DATE = $ReplayTradeDate
  $env:FUMAN_SCORECARD_TRADE_DATE = $ReplayTradeDate
}
if ($Mode -eq "Status") { & $nodeExe "scripts\verify-strategy5-complete.js"; exit $LASTEXITCODE }
. "$PSScriptRoot\schedule-guard.ps1"
$log = Join-Path $runtime ("logs\strategy5-complete-{0}.log" -f (Get-Date -Format yyyyMMdd-HHmmss))
Invoke-FumanWeekdayGuard -Label "Strategy5 complete" -LogPath $log -AllowAfterFormalSourceWindow
& $nodeExe scripts/verify-release-root-authority.js --require-production-root
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if ($Mode -eq 'Recovery') {
  $scan = Get-Content (Join-Path $runtime 'data/scan-receipts/strategy5.json') -Raw | ConvertFrom-Json
  if (-not $ExpectedRunId -or $scan.runId -ne $ExpectedRunId -or -not $scan.complete -or $scan.status -ne 'complete' -or $scan.fallback) { throw 'strategy5_recovery_requires_exact_complete_run' }
} else {
& $pwshExe -NoProfile -File ".\run-chip-source-sync.ps1"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $nodeExe "scripts\verify-strategy5-composite-producers.js"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $pwshExe -NoProfile -File ".\run-strategy5.ps1"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
& $nodeExe --use-system-ca scripts/publish-scorecard-scan-audit.js
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $nodeExe --use-system-ca scripts/verify-strategy5-live-readback.js --render
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $nodeExe "scripts\verify-strategy5-complete.js" "--write-receipt"
exit $LASTEXITCODE
