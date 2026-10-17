param(
  [string]$ProjectRoot = $PSScriptRoot
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot 'scripts\cleanup-execution-root.ps1')
Assert-FumanCleanupExecutionRoot -ExecutionRoot $ProjectRoot
Set-Location -LiteralPath $ProjectRoot
node --use-system-ca scripts\verify-global-cost-janitor-scorecard.js
exit $LASTEXITCODE
