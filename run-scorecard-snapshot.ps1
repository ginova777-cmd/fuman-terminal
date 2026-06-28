param(
  [string]$ProjectRoot = "C:\fuman-terminal",
  [string]$ScorecardRoot = "",
  [string]$Python = "",
  [switch]$AllowDuckDbFallback,
  [switch]$AllowPreviousTradeDate,
  [switch]$NoLiveVerify
)

$ErrorActionPreference = "Stop"

function Write-Step($Message) {
  Write-Host ("[scorecard-snapshot-retired] {0}" -f $Message)
}

if ($AllowDuckDbFallback -or $env:FUMAN_SCORECARD_ALLOW_DUCKDB_FALLBACK -eq "1") {
  throw "run-scorecard-snapshot.ps1 is retired; DuckDB fallback is disabled. Use run-scorecard-daily-automation.ps1 with Supabase source tables."
}

if ($ScorecardRoot -or $Python) {
  Write-Step "ignoring legacy ScorecardRoot/Python parameters; official source is Supabase trade_records / strategy_daily_summary"
}

$runner = Join-Path $ProjectRoot "run-scorecard-daily-automation.ps1"
if (-not (Test-Path -LiteralPath $runner)) {
  throw "official scorecard daily runner missing: $runner"
}

Write-Step "redirecting to official daily automation runner"
$runnerArgs = @(
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  $runner,
  "-ProjectRoot",
  $ProjectRoot
)
if ($AllowPreviousTradeDate) {
  $runnerArgs += "-AllowPreviousTradeDate"
}
if ($NoLiveVerify) {
  $runnerArgs += "-NoLiveVerify"
}

& powershell.exe @runnerArgs
if ($LASTEXITCODE -ne 0) {
  throw "official scorecard daily automation failed with exit code $LASTEXITCODE"
}
