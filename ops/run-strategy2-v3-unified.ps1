param(
  [string]$FumanRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$RuntimeDir = "C:\fuman-runtime"
)
$ErrorActionPreference = "Continue"
$node = (Get-Command node -ErrorAction Stop).Source
$stateDir = Join-Path $RuntimeDir "state"
$logDir = Join-Path $RuntimeDir "logs"
New-Item -ItemType Directory -Force -Path $stateDir,$logDir | Out-Null
$mutex = New-Object System.Threading.Mutex($false, "Global\FumanStrategy2V3Unified0845")
if (-not $mutex.WaitOne(0)) { exit 0 }
try {
  Set-Location -LiteralPath $FumanRoot
  $waterScript = Join-Path $FumanRoot "scripts\run-strategy2-v3-water-scan.js"
  $scanScript = Join-Path $FumanRoot "scripts\run-strategy2-v3-live-scan.js"
  $scanStart = (Get-Date).Date.AddHours(9)
  $finalizeAt = (Get-Date).Date.AddHours(12).AddMinutes(30)
  if ((Get-Date) -gt $finalizeAt) { exit 2 }

  # 08:45 is a single water preflight. Strategy2 must not scan before 09:00.
  & $node $waterScript
  while ((Get-Date) -lt $scanStart) {
    Start-Sleep -Seconds 15
  }

  # One canonical run accumulates events from 09:00 and finalizes once at 12:30.
  while ((Get-Date) -lt $finalizeAt) {
    & $node $waterScript
    & $node $scanScript --source-event
    $remainingSeconds = [Math]::Floor(($finalizeAt - (Get-Date)).TotalSeconds)
    if ($remainingSeconds -gt 0) { Start-Sleep -Seconds ([Math]::Min(60, $remainingSeconds)) }
  }
  & $node $waterScript
  & $node $scanScript --source-event --finalize
  exit $LASTEXITCODE
}
finally {
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
