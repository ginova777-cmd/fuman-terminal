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
  $deadline = (Get-Date).Date.AddHours(12).AddMinutes(30)
  if ((Get-Date) -gt $deadline) { exit 2 }
  while ((Get-Date) -lt $deadline) {
    & $node $waterScript
    & $node $scanScript --source-event
    Start-Sleep -Seconds 60
  }
  & $node $waterScript
  & $node $scanScript --source-event --finalize
  exit $LASTEXITCODE
}
finally {
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
