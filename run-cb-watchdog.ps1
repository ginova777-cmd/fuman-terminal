param(
  [string]$ExpectedTime = "21:25"
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

$runtime = "C:\fuman-runtime"
$env:FUMAN_RUNTIME_DIR = $runtime
$env:FUMAN_DATA_DIR = Join-Path $runtime "data"
$env:FUMAN_CACHE_DIR = Join-Path $runtime "cache"
$env:FUMAN_STATE_DIR = Join-Path $runtime "state"
$env:NODE_OPTIONS = "--use-system-ca"
$logDir = Join-Path $runtime "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("cb-watchdog-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))

. "${PSScriptRoot}\schedule-guard.ps1"

function Write-WatchdogLog($message) {
  Write-Host $message
  Add-Content -LiteralPath $log -Value $message -Encoding utf8
}

function Get-TaipeiTimeFromValue($value) {
  if (-not $value) { return $null }
  try {
    $tz = [TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
    $dto = [DateTimeOffset]::Parse([string]$value, [Globalization.CultureInfo]::InvariantCulture)
    return [TimeZoneInfo]::ConvertTime($dto, $tz).DateTime
  } catch {
    try { return [datetime]$value } catch { return $null }
  }
}

function Get-ExpectedSlotTime($slot) {
  $now = Get-FumanTaipeiNow
  $parts = $slot.Split(":")
  $slotTime = [datetime]::new($now.Year, $now.Month, $now.Day, [int]$parts[0], [int]$parts[1], 0)
  if ($now -lt $slotTime) { $slotTime = $slotTime.AddDays(-1) }
  return $slotTime
}

function Test-UpdatedAfterSlot($updatedAt, $slot) {
  if (-not $slot) { return $true }
  $dt = Get-TaipeiTimeFromValue $updatedAt
  if (-not $dt) { return $false }
  $slotTime = Get-ExpectedSlotTime $slot
  return $dt -ge $slotTime
}

function Test-CbFresh {
  $path = Join-Path $env:FUMAN_DATA_DIR "cb-detect-latest.json"
  if (-not (Test-Path -LiteralPath $path)) { return @{ ok = $false; reason = "missing CB cache" } }
  $json = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
  $count = if ($json.rows) { @($json.rows).Count } else { 0 }
  if ($count -lt 1) { return @{ ok = $false; reason = "CB count too low: $count" } }
  $slotTime = Get-ExpectedSlotTime $ExpectedTime
  if (-not (Test-UpdatedAfterSlot $json.updatedAt $ExpectedTime)) {
    return @{ ok = $false; reason = "CB not updated after threshold=$($slotTime.ToString("yyyy-MM-dd HH:mm:ss")); updatedAt=$($json.updatedAt)" }
  }
  return @{ ok = $true; reason = "ok count=$count updatedAt=$($json.updatedAt) threshold=$($slotTime.ToString("yyyy-MM-dd HH:mm:ss"))" }
}

Write-WatchdogLog "=== CB watchdog start expected=$ExpectedTime $(Get-Date) ==="
Invoke-FumanWeekdayGuard -Label "CB watchdog" -LogPath $log

$result = Test-CbFresh
if ($result.ok) {
  Write-WatchdogLog "Watchdog OK: $($result.reason)"
  exit 0
}

Write-WatchdogLog "Watchdog stale: $($result.reason); starting rerun"
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${PSScriptRoot}\run-cb-detect.ps1" >> $log 2>&1
$exit = $LASTEXITCODE
if ($exit -ne 0) {
  Write-WatchdogLog "Watchdog rerun failed exit=$exit"
  exit $exit
}
Write-WatchdogLog "Watchdog rerun completed"
