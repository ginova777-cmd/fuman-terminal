param(
  [string]$ProjectRoot = $PSScriptRoot
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $ProjectRoot
node --use-system-ca scripts\verify-global-cost-janitor-scorecard.js
