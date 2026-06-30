param(
  [Parameter(Mandatory = $true)][ValidateSet("institution", "warrant")][string]$Scope,
  [string]$ExpectedTime = ""
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
. "${PSScriptRoot}\legacy-entrypoint-guard.ps1" -Label "run-flow-watchdog.ps1"

$runtime = "C:\fuman-runtime"
$env:FUMAN_RUNTIME_DIR = $runtime
$env:FUMAN_DATA_DIR = Join-Path $runtime "data"
$env:FUMAN_CACHE_DIR = Join-Path $runtime "cache"
$env:FUMAN_STATE_DIR = Join-Path $runtime "state"
$logDir = Join-Path $runtime "logs"
$receiptDir = Join-Path $env:FUMAN_DATA_DIR "scan-receipts"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
New-Item -ItemType Directory -Force -Path $receiptDir | Out-Null
$log = Join-Path $logDir ("flow-watchdog-{0}-{1}.log" -f $Scope, (Get-Date -Format "yyyyMMdd-HHmmss"))
$alertReceipt = Join-Path $receiptDir ("{0}-watchdog-alert.json" -f $Scope)

. "${PSScriptRoot}\schedule-guard.ps1"
. "${PSScriptRoot}\flow-health.ps1"

function Write-WatchdogLog($message) {
  Write-Host $message
  Add-Content -LiteralPath $log -Value $message -Encoding utf8
}

function Invoke-WatchdogFailureAlert($Status, $Reason, $ExitCode = 1) {
  $nodeExe = "C:\Program Files\nodejs\node.exe"
  if (-not (Test-Path -LiteralPath $nodeExe)) { $nodeExe = "node" }
  $tailText = ""
  try { $tailText = (Get-Content -LiteralPath $log -ErrorAction SilentlyContinue | Select-Object -Last 40) -join "`n" } catch {}
  $env:FUMAN_ALERT_KIND = "$Scope-watchdog"
  $env:FUMAN_ALERT_SOURCE = "Fuman $Scope watchdog"
  $env:FUMAN_ALERT_SUBJECT = "Fuman $Scope watchdog failed"
  $env:FUMAN_ALERT_RECEIPT_FILE = $alertReceipt
  $env:FUMAN_ALERT_TEXT = @"
Fuman $Scope watchdog failed

status: $Status
exitCode: $ExitCode
expectedTime: $ExpectedTime
reason: $Reason
log: $log
receipt: $alertReceipt
checkedAt: $((Get-Date).ToString("o"))

tail:
$tailText
"@
  $alertOutput = New-Object System.Collections.Generic.List[string]
  try {
    Push-Location $PSScriptRoot
    & $nodeExe "--use-system-ca" "scripts\send-workflow-alert.js" "--kind=$Scope-watchdog" "--receipt=$alertReceipt" *>&1 | ForEach-Object {
      $text = [string]$_
      $alertOutput.Add($text) | Out-Null
      Add-Content -LiteralPath $log -Value "[alert] $text" -Encoding utf8
    }
    $alertExit = $LASTEXITCODE
  } catch {
    $alertExit = 1
    $alertOutput.Add($_.Exception.Message) | Out-Null
    Add-Content -LiteralPath $log -Value "[alert] EXCEPTION $($_.Exception.Message)" -Encoding utf8
  } finally {
    Pop-Location
  }
  return [ordered]@{
    ok = ($alertExit -eq 0)
    source = "send-workflow-alert.js"
    kind = "$Scope-watchdog"
    receipt = $alertReceipt
    exitCode = $alertExit
    tail = @($alertOutput.ToArray() | Select-Object -Last 20)
    checkedAt = (Get-Date).ToString("o")
  }
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
  $url = "https://fuman-terminal.vercel.app/api/institution-latest?canvas=1&compact=1&shell=1&limit=60&live=1&ts=$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
  try {
    $payload = (Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 45 -Headers @{ "Cache-Control" = "no-cache" }).Content | ConvertFrom-Json
    $count = if ($payload.count) { [int]$payload.count } else { 0 }
    if ($payload.ok -ne $true -or -not $payload.runId) { return @{ ok = $false; reason = "institution API not ready ok=$($payload.ok) runId=$($payload.runId)" } }
    if ($count -lt 100) { return @{ ok = $false; reason = "institution API count too low: $count" } }
    if (-not (Test-UpdatedAfterSlot $payload.updatedAt $ExpectedTime)) { return @{ ok = $false; reason = "institution API not updated after $ExpectedTime; updatedAt=$($payload.updatedAt)" } }
    return @{ ok = $true; reason = "api ok count=$count runId=$($payload.runId)" }
  } catch {
    Write-WatchdogLog "Institution API freshness check failed: $($_.Exception.Message); falling back to runtime cache"
  }
  $path = Join-Path $env:FUMAN_DATA_DIR "institution-latest.json"
  if (-not (Test-Path -LiteralPath $path)) { return @{ ok = $false; reason = "missing institution cache" } }
  $json = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
  $count = if ($json.count) { [int]$json.count } else { 0 }
  if ($count -lt 1000) { return @{ ok = $false; reason = "institution count too low: $count" } }
  if (-not (Test-UpdatedAfterSlot $json.updatedAt $ExpectedTime)) { return @{ ok = $false; reason = "institution not updated after $ExpectedTime; updatedAt=$($json.updatedAt)" } }
  return @{ ok = $true; reason = "ok count=$count usedDate=$($json.usedDate)" }
}

function Test-WarrantFresh {
  $url = "https://fuman-terminal.vercel.app/api/warrant-flow-latest?canvas=1&compact=1&shell=1&limit=60&live=1&ts=$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
  try {
    $payload = (Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 45 -Headers @{ "Cache-Control" = "no-cache" }).Content | ConvertFrom-Json
    $count = if ($payload.count) { [int]$payload.count } else { 0 }
    if ($payload.ok -ne $true -or -not $payload.runId) { return @{ ok = $false; reason = "warrant API not ready ok=$($payload.ok) runId=$($payload.runId)" } }
    if ($count -lt 20) { return @{ ok = $false; reason = "warrant API count too low: $count" } }
    if (-not (Test-UpdatedAfterSlot $payload.updatedAt $ExpectedTime)) { return @{ ok = $false; reason = "warrant API not updated after $ExpectedTime; updatedAt=$($payload.updatedAt)" } }
    return @{ ok = $true; reason = "api ok count=$count runId=$($payload.runId)" }
  } catch {
    Write-WatchdogLog "Warrant API freshness check failed: $($_.Exception.Message); falling back to runtime cache"
  }
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
$pwshExe = "C:\Program Files\PowerShell\7\pwsh.exe"
if (-not (Test-Path -LiteralPath $pwshExe)) { $pwshExe = "pwsh.exe" }
& $pwshExe -NoProfile -ExecutionPolicy Bypass -File $script >> $log 2>&1
$exit = $LASTEXITCODE
if ($exit -ne 0) {
  Write-WatchdogLog "Watchdog rerun failed exit=$exit"
  $alert = Invoke-WatchdogFailureAlert "watchdog_failed" $result.reason $exit
  Write-FumanFlowHealth -Scope $Scope -Status watchdog_failed -Message "Watchdog rerun failed" -Detail @{ exitCode = $exit; expectedTime = $ExpectedTime; reason = $result.reason; log = $log; alert = $alert }
  exit $exit
}
Write-WatchdogLog "Watchdog rerun completed"
Write-FumanFlowHealth -Scope $Scope -Status ok -Message "Watchdog rerun completed" -Detail @{ expectedTime = $ExpectedTime; reason = $result.reason; log = $log }
