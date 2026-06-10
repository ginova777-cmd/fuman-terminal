param(
  [Parameter(Mandatory = $true)][ValidateSet("institution", "warrant")][string]$Scope,
  [string]$ExpectedTime = ""
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

$runtime = "C:\fuman-runtime"
$env:FUMAN_RUNTIME_DIR = $runtime
$env:FUMAN_DATA_DIR = Join-Path $runtime "data"
$env:FUMAN_CACHE_DIR = Join-Path $runtime "cache"
$env:FUMAN_STATE_DIR = Join-Path $runtime "state"
$logDir = Join-Path $runtime "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("flow-watchdog-{0}-{1}.log" -f $Scope, (Get-Date -Format "yyyyMMdd-HHmmss"))

. "${PSScriptRoot}\schedule-guard.ps1"
. "${PSScriptRoot}\flow-health.ps1"

function Write-WatchdogLog($message) {
  Write-Host $message
  Add-Content -LiteralPath $log -Value $message -Encoding utf8
}

function Get-TaipeiDateKey {
  (Get-FumanTaipeiNow).ToString("yyyy-MM-dd")
}

function Get-YmdDateKey($value) {
  $text = [string]$value
  if ($text -match '^(\d{4})(\d{2})(\d{2})$') { return "$($matches[1])-$($matches[2])-$($matches[3])" }
  if ($text -match '^(\d{4})[-/](\d{2})[-/](\d{2})') { return "$($matches[1])-$($matches[2])-$($matches[3])" }
  return ""
}

function Get-RocDateKey($value) {
  $text = [string]$value
  if ($text -match '^(\d{3})(\d{2})(\d{2})$') {
    $year = 1911 + [int]$matches[1]
    return "$year-$($matches[2])-$($matches[3])"
  }
  return Get-YmdDateKey $value
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
  $parts = $slot.Split(':')
  $slotTime = [datetime]::new($now.Year, $now.Month, $now.Day, [int]$parts[0], [int]$parts[1], 0)
  if ($now -lt $slotTime) { $slotTime = $slotTime.AddDays(-1) }
  return $slotTime
}

function Test-UpdatedAfterSlot($updatedAt, $slot) {
  if (-not $slot) { return $true }
  $dt = Get-TaipeiTimeFromValue $updatedAt
  if (-not $dt) { return $false }
  return $dt -ge (Get-ExpectedSlotTime $slot)
}

function Test-InstitutionFresh {
  $path = Join-Path $env:FUMAN_DATA_DIR "institution-latest.json"
  if (-not (Test-Path -LiteralPath $path)) { return @{ ok = $false; reason = "missing institution cache" } }
  $json = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
  $count = if ($json.count) { [int]$json.count } else { 0 }
  if ($count -lt 1000) { return @{ ok = $false; reason = "institution count too low: $count" } }
  if (-not (Test-UpdatedAfterSlot $json.updatedAt $ExpectedTime)) { return @{ ok = $false; reason = "institution not updated after $ExpectedTime; updatedAt=$($json.updatedAt)" } }
  return @{ ok = $true; reason = "ok count=$count usedDate=$($json.usedDate)" }
}

function Test-WarrantFresh {
  $path = Join-Path $env:FUMAN_DATA_DIR "warrant-flow-latest.json"
  if (-not (Test-Path -LiteralPath $path)) { return @{ ok = $false; reason = "missing warrant cache" } }
  $json = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
  $count = if ($json.count) { [int]$json.count } else { 0 }
  if ($count -lt 20) { return @{ ok = $false; reason = "warrant count too low: $count" } }
  if (-not (Test-UpdatedAfterSlot $json.updatedAt $ExpectedTime)) { return @{ ok = $false; reason = "warrant not updated after $ExpectedTime; updatedAt=$($json.updatedAt)" } }
  return @{ ok = $true; reason = "ok count=$count updatedAt=$($json.updatedAt)" }
}

Write-WatchdogLog "=== Flow watchdog start scope=$Scope expected=$ExpectedTime $(Get-Date) ==="
Invoke-FumanWeekdayGuard -Label "Flow watchdog $Scope" -LogPath $log

$result = if ($Scope -eq "institution") { Test-InstitutionFresh } else { Test-WarrantFresh }
if ($result.ok) {
  Write-WatchdogLog "Watchdog OK: $($result.reason)"
  Write-FumanFlowHealth -Scope $Scope -Status ok -Message "Watchdog verified cache" -Detail @{ expectedTime = $ExpectedTime; reason = $result.reason; log = $log }
  exit 0
}

Write-WatchdogLog "Watchdog stale: $($result.reason); starting rerun"
Write-FumanFlowHealth -Scope $Scope -Status watchdog_rerun -Message "Watchdog rerun started" -Detail @{ expectedTime = $ExpectedTime; reason = $result.reason; log = $log }
$script = if ($Scope -eq "institution") { "${PSScriptRoot}\run-institution.ps1" } else { "${PSScriptRoot}\run-warrant-flow.ps1" }
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script >> $log 2>&1
$exit = $LASTEXITCODE
if ($exit -ne 0) {
  Write-WatchdogLog "Watchdog rerun failed exit=$exit"
  Write-FumanFlowHealth -Scope $Scope -Status watchdog_failed -Message "Watchdog rerun failed" -Detail @{ exitCode = $exit; expectedTime = $ExpectedTime; reason = $result.reason; log = $log }
  exit $exit
}
Write-WatchdogLog "Watchdog rerun completed"
Write-FumanFlowHealth -Scope $Scope -Status ok -Message "Watchdog rerun completed" -Detail @{ expectedTime = $ExpectedTime; reason = $result.reason; log = $log }
