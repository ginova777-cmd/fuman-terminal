param([switch]$DryRun)
$ErrorActionPreference='Stop'
if ($DryRun) { throw 'Single-start cleanup requires an explicit isolated test harness; no production preview mutation is allowed.' }
$root=$PSScriptRoot
. (Join-Path $root 'scripts\cleanup-execution-root.ps1')
Assert-FumanCleanupExecutionRoot -ExecutionRoot $root
. (Join-Path $root 'scripts\cleanup-writer-lock.ps1')
$writerLease=Enter-FumanCleanupWriterLock -StateDirectory 'C:\fuman-runtime\state'
$previous=$env:FUMAN_STRATEGY_RUNNER_PID
try {
  $env:FUMAN_STRATEGY_RUNNER_PID=[string]$PID
  Push-Location -LiteralPath $root
  try {
    & node --use-system-ca (Join-Path $root 'scripts\run-cleanup-maintenance.js') --scheduled --apply
    $result=$LASTEXITCODE
  } finally { Pop-Location }
} finally { $env:FUMAN_STRATEGY_RUNNER_PID=$previous; $writerLease.Dispose() }
exit $result
