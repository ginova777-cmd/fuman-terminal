$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
. "${PSScriptRoot}\legacy-entrypoint-guard.ps1" -Label "run-strategy3-watchdog.ps1"

Set-Location "${PSScriptRoot}"

$runtimeDir = "C:\fuman-runtime"
$dataDir = Join-Path $runtimeDir "data"
$logDir = Join-Path $runtimeDir "logs"
$stateDir = Join-Path $runtimeDir "state"
New-Item -ItemType Directory -Force -Path $logDir, $stateDir | Out-Null

$log = Join-Path $logDir ("strategy3-watchdog-{0}.log" -f (Get-Date -Format yyyyMMdd-HHmmss))
$statusFile = Join-Path $stateDir "strategy3-watchdog-status.json"
$strategy3File = Join-Path $dataDir "strategy3-latest.json"
$runner = "${PSScriptRoot}\run-strategy3.ps1"

function Write-WatchdogLog {
  param([string]$Message)
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Write-Host $line
  Add-Content -LiteralPath $log -Value $line -Encoding utf8
}

function Write-WatchdogStatus {
  param(
    [string]$Status,
    [string]$Message,
    [int]$ExitCode = 0
  )
  @{
    status = $Status
    message = $Message
    exitCode = $ExitCode
    updatedAt = (Get-Date).ToString("o")
    log = $log
  } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $statusFile -Encoding utf8
}

. "${PSScriptRoot}\schedule-guard.ps1"
Invoke-FumanWeekdayGuard -Label "Strategy3 watchdog" -LogPath $log

function Get-TaipeiTodayYmd {
  $taipeiNow = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId((Get-Date), "Taipei Standard Time")
  return $taipeiNow.ToString("yyyyMMdd")
}

function Convert-DateTextToYmd {
  param($Value)
  $text = [string]$Value
  if ($text -match "^\d{8}$") { return $text }
  if ($text -match "^\d{4}-\d{2}-\d{2}") { return $text.Substring(0, 10).Replace("-", "") }
  return ""
}

function Get-Strategy3Payload {
  if (-not (Test-Path -LiteralPath $strategy3File)) { return $null }
  try {
    return Get-Content -LiteralPath $strategy3File -Raw | ConvertFrom-Json -ErrorAction Stop
  } catch {
    Write-WatchdogLog "strategy3 latest JSON parse failed: $($_.Exception.Message)"
    return $null
  }
}

function Test-Strategy3Healthy {
  param($Payload)
  if (-not $Payload) { return @{ Healthy = $false; Reason = "missing or invalid strategy3 latest JSON" } }
  $today = Get-TaipeiTodayYmd
  $usedDate = Convert-DateTextToYmd $Payload.usedDate
  $count = if ($null -ne $Payload.count) { [int]$Payload.count } else { @($Payload.matches).Count }
  $qualityStatus = [string]$Payload.qualityStatus
  $sourceStatus = [string]$Payload.sourceHealth.status

  if ($usedDate -ne $today) {
    return @{ Healthy = $false; Reason = "stale usedDate=$usedDate today=$today" }
  }
  if ($count -le 0) {
    return @{ Healthy = $false; Reason = "empty strategy3 result count=$count" }
  }
  if ($qualityStatus -eq "failed" -or $sourceStatus -eq "failed") {
    return @{ Healthy = $false; Reason = "source health failed qualityStatus=$qualityStatus sourceStatus=$sourceStatus" }
  }
  return @{ Healthy = $true; Reason = "usedDate=$usedDate count=$count qualityStatus=$qualityStatus sourceStatus=$sourceStatus" }
}

function Test-Strategy3Running {
  $runningNode = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match "scripts\\scan-strategy3-cache\.js|scripts/scan-strategy3-cache\.js" })
  $runningLauncher = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.Name -match "powershell(\.exe)?$|pwsh(\.exe)?$" -and
      $_.CommandLine -match "run-strategy3\.ps1" -and
      $_.CommandLine -notmatch "run-strategy3-watchdog\.ps1"
    })
  return @($runningNode + $runningLauncher)
}

Write-WatchdogLog "strategy3 watchdog start"
$health = Test-Strategy3Healthy (Get-Strategy3Payload)
if ($health.Healthy) {
  Write-WatchdogLog "strategy3 healthy; no action. $($health.Reason)"
  Write-WatchdogStatus "success" "healthy: $($health.Reason)"
  exit 0
}

Write-WatchdogLog "strategy3 unhealthy: $($health.Reason)"
$running = @(Test-Strategy3Running)
if ($running.Count -gt 0) {
  $pids = ($running | Select-Object -ExpandProperty ProcessId) -join ","
  Write-WatchdogLog "strategy3 already running; no restart. pid=$pids"
  Write-WatchdogStatus "running" "strategy3 already running; pid=$pids"
  exit 0
}

Write-WatchdogLog "starting strategy3 runner: $runner"
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $runner *>&1 | ForEach-Object {
  Add-Content -LiteralPath $log -Value ([string]$_) -Encoding utf8
}
$exitCode = $LASTEXITCODE
if ($null -eq $exitCode) { $exitCode = 0 }
if ($exitCode -ne 0) {
  Write-WatchdogLog "strategy3 runner failed with exit code $exitCode"
  Write-WatchdogStatus "failed" "runner failed" $exitCode
  exit $exitCode
}

$postHealth = Test-Strategy3Healthy (Get-Strategy3Payload)
if (-not $postHealth.Healthy) {
  Write-WatchdogLog "strategy3 still unhealthy after rerun: $($postHealth.Reason)"
  Write-WatchdogStatus "failed" "still unhealthy after rerun: $($postHealth.Reason)" 1
  exit 1
}

Write-WatchdogLog "strategy3 recovered: $($postHealth.Reason)"
Write-WatchdogStatus "success" "recovered: $($postHealth.Reason)"
exit 0
