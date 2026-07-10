param(
  [string]$OutDir = "C:\fuman-runtime\data\scan-receipts"
)

$ErrorActionPreference = "Stop"

# FUMAN_MARKET_CLOSED_RUNNER_GUARD_V1
. "${PSScriptRoot}\schedule-guard.ps1"
Invoke-FumanWeekdayGuard -Label "Strategy2 E2E closure readback"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$strategyOut = Join-Path $OutDir "strategy2-e2e-closure-$stamp"
New-Item -ItemType Directory -Force -Path $strategyOut | Out-Null

Write-Host "[strategy2-e2e-closure] root=$root"
Write-Host "[strategy2-e2e-closure] out=$strategyOut"
npm run verify:strategy2-e2e-closure -- --out="$strategyOut"
