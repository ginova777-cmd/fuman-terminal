$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
. "${PSScriptRoot}\legacy-entrypoint-guard.ps1" -Label "run-strategy5-watchdog.ps1"
Set-Location "${PSScriptRoot}"

$runtimeDir = "C:\fuman-runtime"
$logDir = Join-Path $runtimeDir "logs"
$stateDir = Join-Path $runtimeDir "state"
New-Item -ItemType Directory -Force -Path $logDir, $stateDir | Out-Null

$log = Join-Path $logDir ("strategy5-watchdog-{0}.log" -f (Get-Date -Format yyyyMMdd-HHmmss))
$statusFile = Join-Path $stateDir "strategy5-watchdog-status.json"
$runner = "${PSScriptRoot}\run-strategy5.ps1"
$alertScript = "${PSScriptRoot}\scripts\send-workflow-alert.js"
$alertReceiptFile = Join-Path $runtimeDir "data\scan-receipts\strategy5-watchdog-alert.json"
$apiBaseUrl = if ($env:FUMAN_VERCEL_BASE_URL) { $env:FUMAN_VERCEL_BASE_URL.TrimEnd("/") } else { "https://fuman-terminal.vercel.app" }
$apiUrl = "$apiBaseUrl/api/strategy5-latest"

function Write-WatchdogLog {
  param([string]$Message)
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Write-Host $line
  Add-Content -LiteralPath $log -Value $line -Encoding utf8
}

function Write-WatchdogStatus {
  param([string]$Status, [string]$Message, [int]$ExitCode = 0)
  @{
    status = $Status
    message = $Message
    exitCode = $ExitCode
    updatedAt = (Get-Date).ToString("o")
    log = $log
  } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $statusFile -Encoding utf8
}

function Invoke-Strategy5WatchdogFailureAlert {
  param([string]$Reason, [int]$ExitCode = 1)
  if ($env:STRATEGY5_WATCHDOG_DISABLE_ALERT -eq "1") { return }
  if (-not (Test-Path -LiteralPath $alertScript)) {
    Write-WatchdogLog "strategy5 alert script missing: $alertScript"
    return
  }
  $previousSubject = $env:FUMAN_ALERT_SUBJECT
  $previousText = $env:FUMAN_ALERT_TEXT
  $previousKind = $env:FUMAN_ALERT_KIND
  $previousSource = $env:FUMAN_ALERT_SOURCE
  $previousReceipt = $env:FUMAN_ALERT_RECEIPT_FILE
  try {
    $env:FUMAN_ALERT_SUBJECT = "Fuman Strategy5 watchdog failed"
    $env:FUMAN_ALERT_TEXT = "Strategy5 watchdog failed`nreason=$Reason`nexitCode=$ExitCode`napi=$apiUrl`nlog=$log`nExpected behavior: preserve latest complete run and expose chip/source health reason."
    $env:FUMAN_ALERT_KIND = "strategy5-watchdog"
    $env:FUMAN_ALERT_SOURCE = "FumanStrategy5Watchdog2130"
    $env:FUMAN_ALERT_RECEIPT_FILE = $alertReceiptFile
    & node "--use-system-ca" $alertScript | ForEach-Object { Write-WatchdogLog $_ }
  } catch {
    Write-WatchdogLog "strategy5 Gmail alert failed: $($_.Exception.Message)"
  } finally {
    if ($null -eq $previousSubject) { Remove-Item Env:FUMAN_ALERT_SUBJECT -ErrorAction SilentlyContinue } else { $env:FUMAN_ALERT_SUBJECT = $previousSubject }
    if ($null -eq $previousText) { Remove-Item Env:FUMAN_ALERT_TEXT -ErrorAction SilentlyContinue } else { $env:FUMAN_ALERT_TEXT = $previousText }
    if ($null -eq $previousKind) { Remove-Item Env:FUMAN_ALERT_KIND -ErrorAction SilentlyContinue } else { $env:FUMAN_ALERT_KIND = $previousKind }
    if ($null -eq $previousSource) { Remove-Item Env:FUMAN_ALERT_SOURCE -ErrorAction SilentlyContinue } else { $env:FUMAN_ALERT_SOURCE = $previousSource }
    if ($null -eq $previousReceipt) { Remove-Item Env:FUMAN_ALERT_RECEIPT_FILE -ErrorAction SilentlyContinue } else { $env:FUMAN_ALERT_RECEIPT_FILE = $previousReceipt }
  }
}

. "${PSScriptRoot}\schedule-guard.ps1"
Invoke-FumanWeekdayGuard -Label "Strategy5 watchdog" -LogPath $log -AllowAfterFormalSourceWindow

function Get-TaipeiNow {
  [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId((Get-Date), "Taipei Standard Time")
}

function Get-TaipeiSlot2100 {
  $now = Get-TaipeiNow
  [datetime]::new($now.Year, $now.Month, $now.Day, 21, 0, 0)
}

function Get-TaipeiTimeFromValue {
  param($Value)
  if (-not $Value) { return $null }
  try {
    $tz = [TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
    $dto = [DateTimeOffset]::Parse([string]$Value, [Globalization.CultureInfo]::InvariantCulture)
    return [TimeZoneInfo]::ConvertTime($dto, $tz).DateTime
  } catch {
    return $null
  }
}

function Get-Strategy5Payload {
  $timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $url = "$apiUrl`?canvas=1&compact=1&shell=1&limit=70&live=1&ts=$timestamp"
  try {
    $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 45 -Headers @{ "Cache-Control" = "no-cache" }
    $cacheControl = [string]$response.Headers["Cache-Control"]
    if ($cacheControl -notmatch "no-store") {
      Write-WatchdogLog "strategy5 API missing no-store cache header: Cache-Control=$cacheControl"
    }
    return ([string]$response.Content | ConvertFrom-Json -ErrorAction Stop)
  } catch {
    Write-WatchdogLog "strategy5 latest API failed: $($_.Exception.Message)"
    return $null
  }
}

function Test-Strategy5Healthy {
  param($Payload)

  if (-not $Payload) { return @{ Healthy = $false; Reason = "missing or invalid strategy5 latest API payload" } }

  $runId = [string]$Payload.runId
  $complete = [bool]$Payload.complete
  $count = if ($null -ne $Payload.count) { [int]$Payload.count } else { @($Payload.matches).Count }
  $updatedAt = Get-TaipeiTimeFromValue $Payload.updatedAt
  $slot2100 = Get-TaipeiSlot2100

  if (-not $runId) { return @{ Healthy = $false; Reason = "missing API runId" } }
  if (-not $complete) { return @{ Healthy = $false; Reason = "API run is not complete runId=$runId" } }
  if ($count -le 0) { return @{ Healthy = $false; Reason = "empty strategy5 API result count=$count runId=$runId" } }
  if (-not $updatedAt) { return @{ Healthy = $false; Reason = "invalid updatedAt=$($Payload.updatedAt) runId=$runId" } }
  if ($updatedAt -lt $slot2100) {
    return @{ Healthy = $false; Reason = "not updated after 21:00; updatedAt=$updatedAt runId=$runId count=$count" }
  }

  return @{ Healthy = $true; Reason = "runId=$runId count=$count updatedAt=$updatedAt" }
}

function Test-Strategy5Running {
  $runningNode = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match "scripts\\scan-strategy5-cache\.js|scripts/scan-strategy5-cache\.js" })
  $runningLauncher = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.Name -match "powershell(\.exe)?$|pwsh(\.exe)?$" -and
      $_.CommandLine -match "run-strategy5\.ps1" -and
      $_.CommandLine -notmatch "run-strategy5-watchdog\.ps1"
    })
  return @($runningNode + $runningLauncher)
}

Write-WatchdogLog "strategy5 watchdog start"
$health = Test-Strategy5Healthy (Get-Strategy5Payload)

if ($health.Healthy) {
  Write-WatchdogLog "strategy5 healthy; no action. $($health.Reason)"
  Write-WatchdogStatus "success" "healthy: $($health.Reason)"
  exit 0
}

Write-WatchdogLog "strategy5 unhealthy: $($health.Reason)"
Write-WatchdogLog "read-only watchdog will not start a second formal run"
Invoke-Strategy5WatchdogFailureAlert -Reason $health.Reason -ExitCode 1
Write-WatchdogStatus "failed" "read-only watchdog detected missing or stale 21:00 formal run; rerunAllowed=false" 1
exit 1
