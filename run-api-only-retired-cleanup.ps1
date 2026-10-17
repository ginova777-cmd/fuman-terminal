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
    $receiptDirectory='C:\fuman-runtime\status\cleanup-process-supervision'
    [IO.Directory]::CreateDirectory($receiptDirectory) | Out-Null
    $arguments=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -Compress -InputObject @('--use-system-ca',(Join-Path $root 'scripts\run-cleanup-maintenance.js'),'--scheduled','--apply'))))
    & pwsh -NoProfile -File (Join-Path $root 'scripts\Invoke-CleanupProcess.ps1') -Executable (Get-Command node -ErrorAction Stop).Source -ArgumentsBase64 $arguments -WorkingDirectory $root -TimeoutMilliseconds 1080000 -DeadlineEpochMilliseconds ($started+1080000) -ResultFile (Join-Path $receiptDirectory "$started-$PID.json")
    $result=$LASTEXITCODE
  } finally { Pop-Location }
} finally { $env:FUMAN_STRATEGY_RUNNER_PID=$previous; $env:FUMAN_CLEANUP_STARTED_AT=$previousStart; $writerLease.Dispose() }
exit $result
