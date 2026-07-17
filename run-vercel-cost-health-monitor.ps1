param(
  [string]$ProjectRoot = $PSScriptRoot,
  [string]$ProductionMirrorRoot = $ProjectRoot
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $ProjectRoot
$env:FUMAN_PRODUCTION_MIRROR_ROOT = $ProductionMirrorRoot
node --use-system-ca scripts\monitor-vercel-cost-health.js
