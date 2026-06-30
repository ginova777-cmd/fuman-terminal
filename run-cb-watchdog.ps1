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
$receiptDir = Join-Path $runtime "data\scan-receipts"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
New-Item -ItemType Directory -Force -Path $receiptDir | Out-Null
$log = Join-Path $logDir ("cb-watchdog-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
$alertReceipt = Join-Path $receiptDir "cb-watchdog-alert.json"

. "${PSScriptRoot}\schedule-guard.ps1"

function Write-WatchdogLog($message) {
  Write-Host $message
  Add-Content -LiteralPath $log -Value $message -Encoding utf8
}

function Invoke-CbFailureAlert {
  param(
    [string]$Reason,
    [int]$ExitCode = 1
  )
  $nodeExe = "C:\Program Files\nodejs\node.exe"
  if (-not (Test-Path -LiteralPath $nodeExe)) { $nodeExe = "node" }
  $env:FUMAN_ALERT_KIND = "cb-watchdog"
  $env:FUMAN_ALERT_SOURCE = "FumanCbWatchdog"
  $env:FUMAN_ALERT_SUBJECT = "Fuman Terminal CB watchdog failed"
  $env:FUMAN_ALERT_RECEIPT_FILE = $alertReceipt
  $tail = ""
  try { $tail = (Get-Content -LiteralPath $log -Tail 40 -ErrorAction SilentlyContinue) -join "`n" } catch {}
  $env:FUMAN_ALERT_TEXT = @"
Fuman Terminal CB watchdog failed

source: FumanCbWatchdog
exitCode: $ExitCode
reason: $Reason
log: $log
receipt: $alertReceipt
checkedAt: $((Get-Date).ToString("o"))

tail:
$tail
"@
  Push-Location $PSScriptRoot
  try {
    & $nodeExe "--use-system-ca" "scripts\send-workflow-alert.js" "--kind=cb-watchdog" "--receipt=$alertReceipt" *>&1 | ForEach-Object {
      Write-WatchdogLog "[alert] $([string]$_)"
    }
  } catch {
    Write-WatchdogLog "[alert] EXCEPTION $($_.Exception.Message)"
  } finally {
    Pop-Location
  }
  if ($LASTEXITCODE -ne 0) {
    Write-WatchdogLog "[alert] failed exit=$LASTEXITCODE receipt=$alertReceipt"
  } else {
    Write-WatchdogLog "[alert] sent receipt=$alertReceipt"
  }
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
  $url = "https://fuman-terminal.vercel.app/api/cb-detect-latest?canvas=1&compact=1&shell=1&limit=60&live=1&watchdog=1&ts=$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
  try { $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 45; $json = $response.Content | ConvertFrom-Json } catch { return @{ ok = $false; reason = "CB official API unreadable: $($_.Exception.Message)" } }
  if ($response.StatusCode -ne 200 -or $json.ok -ne $true) { return @{ ok = $false; reason = "CB official API not ok: status=$($response.StatusCode) ok=$($json.ok) error=$($json.error) detail=$($json.detail)" } }
  if ($json.complete -ne $true) { return @{ ok = $false; reason = "CB official API not complete: qualityStatus=$($json.qualityStatus) reason=$($json.reason)" } }
  if ($json.cacheSource -ne "supabase-api" -or $json.transport.gate -ne "run_id") { return @{ ok = $false; reason = "CB official API not complete-run source: cacheSource=$($json.cacheSource) gate=$($json.transport.gate)" } }
  $count = [int]($json.count); if ($count -lt 1) { return @{ ok = $false; reason = "CB official API count too low: $count" } }
  $slotTime = Get-ExpectedSlotTime $ExpectedTime
  if (-not (Test-UpdatedAfterSlot $json.updatedAt $ExpectedTime)) { return @{ ok = $false; reason = "CB official API not updated after threshold=$($slotTime.ToString("yyyy-MM-dd HH:mm:ss")); updatedAt=$($json.updatedAt); runId=$($json.runId)" } }
  return @{ ok = $true; reason = "ok runId=$($json.runId) count=$count cacheSource=$($json.cacheSource) updatedAt=$($json.updatedAt) threshold=$($slotTime.ToString("yyyy-MM-dd HH:mm:ss"))" }
}

Write-WatchdogLog "=== CB watchdog start expected=$ExpectedTime $(Get-Date) ==="
Invoke-FumanWeekdayGuard -Label "CB watchdog" -LogPath $log

$result = Test-CbFresh
if ($result.ok) {
  Write-WatchdogLog "Watchdog OK: $($result.reason)"
  exit 0
}

Write-WatchdogLog "Watchdog stale: $($result.reason); starting rerun"
$pwshExe = "C:\Program Files\PowerShell\7\pwsh.exe"
if (-not (Test-Path -LiteralPath $pwshExe)) { $pwshExe = "pwsh.exe" }
& $pwshExe -NoProfile -ExecutionPolicy Bypass -File "${PSScriptRoot}\run-cb-detect.ps1" >> $log 2>&1
$exit = $LASTEXITCODE
if ($exit -ne 0) {
  Write-WatchdogLog "Watchdog rerun failed exit=$exit"
  Invoke-CbFailureAlert -Reason "CB watchdog rerun failed after stale official API: $($result.reason)" -ExitCode $exit
  exit $exit
}
Write-WatchdogLog "Watchdog rerun completed"
