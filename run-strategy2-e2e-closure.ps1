param(
  [string]$OutDir = "C:\fuman-runtime\data\scan-receipts"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$strategyOut = Join-Path $OutDir "strategy2-e2e-closure-$stamp"
New-Item -ItemType Directory -Force -Path $strategyOut | Out-Null

Write-Host "[strategy2-e2e-closure] root=$root"
Write-Host "[strategy2-e2e-closure] out=$strategyOut"
npm run verify:strategy2-e2e-closure -- --out="$strategyOut"
