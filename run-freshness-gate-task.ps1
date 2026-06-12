param()

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot
npm run freshness:gate
