param(
  [string]$ProjectRoot = $PSScriptRoot
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $ProjectRoot
node --use-system-ca scripts\monitor-vercel-cost-health.js
