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

function Invoke-Strategy2V2([string[]]$NodeArgs, [switch]$SoftFail) {
  & $node "--use-system-ca" "scripts\run-strategy2-live-v2.js" @NodeArgs *>&1 | Tee-Object -FilePath $log -Append
  if ($LASTEXITCODE -ne 0) {
    $message = "Strategy2 V2 1m formal scanner failed exit=$LASTEXITCODE"
    if ($SoftFail) {
      $message | Tee-Object -FilePath $log -Append
      return $false
    }
    throw $message
  }
  return $true
}

function Invoke-Strategy2RealtimeObserver([string[]]$NodeArgs) {
  & $node "--use-system-ca" "scripts\run-strategy2-realtime-observer.js" @NodeArgs *>&1 | Tee-Object -FilePath $log -Append
  if ($LASTEXITCODE -ne 0) { throw "Strategy2 realtime observer failed exit=$LASTEXITCODE" }
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
  Invoke-Strategy2RealtimeObserver @("--diagnostic")
  Invoke-Strategy2V2 @("--diagnostic-replay")
  & $node "--use-system-ca" "scripts\verify-strategy2-live-v2-closure.js" "--diagnostic" *>&1 | Tee-Object -FilePath $log -Append
  exit $LASTEXITCODE
}

$preopenStart = 8 * 60 + 45
$formalStart = 9 * 60
$end = 13 * 60 + 30
$currentMinute = Get-TaipeiMinuteOfDay
if ($currentMinute -gt $end) {
  "Strategy2 V2: formal window closed; do not replay or overwrite today after 13:30." | Tee-Object -FilePath $log -Append
  exit 0
}

if ($Once) {
  if ($currentMinute -ge $formalStart) {
    Invoke-Strategy2V2 @("--once")
  } else {
    Invoke-Strategy2RealtimeObserver @()
  }
  exit $LASTEXITCODE
}

while ((Get-TaipeiMinuteOfDay) -lt $preopenStart) { Start-Sleep -Seconds 5 }

$observerOut = Join-Path $logDir ("strategy2-realtime-observer-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".out.log")
$observerErr = Join-Path $logDir ("strategy2-realtime-observer-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".err.log")
$observer = Start-Process -FilePath $node -ArgumentList @("--use-system-ca", "scripts\run-strategy2-realtime-observer.js", "--loop") -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $observerOut -RedirectStandardError $observerErr
"Strategy2 V2: realtime quote observer started pid=$($observer.Id), cadence=3s, window=08:45-13:30." | Tee-Object -FilePath $log -Append

try {
  $lastFormalMinute = -1
  while ((Get-TaipeiMinuteOfDay) -lt $end) {
    $minute = Get-TaipeiMinuteOfDay
    if ($minute -ge $formalStart -and $minute -ne $lastFormalMinute) {
      Invoke-Strategy2V2 @("--once") -SoftFail | Out-Null
      $lastFormalMinute = $minute
    }
    Start-Sleep -Seconds 3
  }
  Invoke-Strategy2V2 @("--once", "--finalize")
  & $node "--use-system-ca" "scripts\verify-strategy2-live-v2-closure.js" *>&1 | Tee-Object -FilePath $log -Append
  exit $LASTEXITCODE
}
finally {
  if ($observer -and -not $observer.HasExited) {
    Stop-Process -Id $observer.Id -Force
    "Strategy2 V2: realtime quote observer stopped pid=$($observer.Id)." | Tee-Object -FilePath $log -Append
  }
}