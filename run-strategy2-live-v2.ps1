[CmdletBinding()]
param(
  [switch]$DiagnosticReplay,
  [switch]$Once
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$env:FUMAN_RUNTIME_DIR = if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }
$env:NODE_OPTIONS = "--use-system-ca"
$node = "C:\Program Files\nodejs\node.exe"
$logDir = Join-Path $env:FUMAN_RUNTIME_DIR "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("strategy2-live-v2-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".log")

function Get-TaipeiMinuteOfDay {
  $now = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId((Get-Date), "Taipei Standard Time")
  return $now.Hour * 60 + $now.Minute
}

function Invoke-Strategy2V2([string[]]$NodeArgs) {
  & $node "--use-system-ca" "scripts\run-strategy2-live-v2.js" @NodeArgs *>&1 | Tee-Object -FilePath $log -Append
  if ($LASTEXITCODE -ne 0) { throw "Strategy2 V2 scanner failed exit=$LASTEXITCODE" }
}

if (-not $DiagnosticReplay) {
  & $node "--use-system-ca" "scripts\check-market-calendar-action.js" "--label=strategy2-live-v2" *>&1 | Tee-Object -FilePath $log -Append
  if ($LASTEXITCODE -eq 10) {
    "Strategy2 V2: market closed; no source read, scan, publish, or scorecard write." | Tee-Object -FilePath $log -Append
    exit 0
  }
  if ($LASTEXITCODE -ne 0) { throw "Strategy2 V2 market calendar guard failed exit=$LASTEXITCODE" }
}
if ($DiagnosticReplay) {
  Invoke-Strategy2V2 @("--diagnostic-replay")
  & $node "--use-system-ca" "scripts\verify-strategy2-live-v2-closure.js" "--diagnostic" *>&1 | Tee-Object -FilePath $log -Append
  exit $LASTEXITCODE
}

$start = 9 * 60
$end = 12 * 60
$currentMinute = Get-TaipeiMinuteOfDay
if ($currentMinute -gt $end) {
  "Strategy2 V2: formal window closed; do not replay or overwrite today after 12:00." | Tee-Object -FilePath $log -Append
  exit 0
}
while ((Get-TaipeiMinuteOfDay) -lt $start) { Start-Sleep -Seconds 15 }
while ((Get-TaipeiMinuteOfDay) -lt $end) {
  Invoke-Strategy2V2 @("--once")
  if ($Once) { exit 0 }
  Start-Sleep -Seconds 60
}
Invoke-Strategy2V2 @("--once", "--finalize")
& $node "--use-system-ca" "scripts\verify-strategy2-live-v2-closure.js" *>&1 | Tee-Object -FilePath $log -Append
exit $LASTEXITCODE
