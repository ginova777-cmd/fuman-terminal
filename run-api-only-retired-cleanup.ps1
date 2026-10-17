param([switch]$DryRun)
$ErrorActionPreference='Stop'
$started=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
if ($DryRun) { throw 'Single-start cleanup requires an explicit isolated test harness; no production preview mutation is allowed.' }
$root=$PSScriptRoot
. (Join-Path $root 'scripts\cleanup-execution-root.ps1')
Assert-FumanCleanupExecutionRoot -ExecutionRoot $root
. (Join-Path $root 'scripts\cleanup-writer-lock.ps1')
$writerLease=Enter-FumanCleanupWriterLock -StateDirectory 'C:\fuman-runtime\state'
$previous=$env:FUMAN_STRATEGY_RUNNER_PID
$previousStart=$env:FUMAN_CLEANUP_STARTED_AT
try {
  $env:FUMAN_STRATEGY_RUNNER_PID=[string]$PID
  $env:FUMAN_CLEANUP_STARTED_AT=[string]$started
  Push-Location -LiteralPath $root
  try {
    # Keep the formal runner as the direct parent required by natural-origin verification.
    # Each work stage is supervised separately against the original 17-minute deadline.
    & node --use-system-ca (Join-Path $root 'scripts\run-cleanup-maintenance.js') --scheduled --apply
    $result=$LASTEXITCODE
  } finally { Pop-Location }
} finally { $env:FUMAN_STRATEGY_RUNNER_PID=$previous; $env:FUMAN_CLEANUP_STARTED_AT=$previousStart; $writerLease.Dispose() }
exit $result
