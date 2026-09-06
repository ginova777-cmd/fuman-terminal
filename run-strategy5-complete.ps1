param([ValidateSet("Complete", "Status")][string]$Mode = "Complete")
$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
Set-Location -LiteralPath $PSScriptRoot
$runtime = if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }
$env:FUMAN_RUNTIME_DIR = $runtime
$nodeExe = "C:\Program Files\nodejs\node.exe"
if (-not (Test-Path -LiteralPath $nodeExe)) { $nodeExe = "node.exe" }
$pwshExe = (Get-Process -Id $PID).Path
if ($Mode -eq "Status") { & $nodeExe "scripts\verify-strategy5-complete.js"; exit $LASTEXITCODE }
. "$PSScriptRoot\schedule-guard.ps1"
$log = Join-Path $runtime ("logs\strategy5-complete-{0}.log" -f (Get-Date -Format yyyyMMdd-HHmmss))
Invoke-FumanWeekdayGuard -Label "Strategy5 complete" -LogPath $log -AllowAfterFormalSourceWindow
& $pwshExe -NoProfile -File ".\run-chip-source-sync.ps1"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$targetDate = @(
  $env:FUMAN_SCANNER_TARGET_DATE,
  $env:FUMAN_SCANNER_TARGET_TRADE_DATE,
  $env:FUMAN_TERMINAL_TARGET_TRADE_DATE,
  $env:FUMAN_EXPECTED_DATE
) | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } | Select-Object -First 1
$targetDate = ([string]$targetDate -replace "[^0-9]", "")
if ($targetDate.Length -ne 8) { $targetDate = (Get-Date).ToString("yyyyMMdd") }
& $nodeExe "--use-system-ca" "scripts\verify-finmind-daily-ohlcv-sync.js" "--target-date=$targetDate" "--min-count=1500"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $nodeExe "scripts\verify-strategy5-composite-producers.js"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $pwshExe -NoProfile -File ".\run-strategy5.ps1"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $nodeExe "scripts\verify-strategy5-complete.js" "--write-receipt"
exit $LASTEXITCODE
