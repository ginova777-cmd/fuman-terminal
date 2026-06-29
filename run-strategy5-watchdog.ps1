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

. "${PSScriptRoot}\schedule-guard.ps1"
Invoke-FumanWeekdayGuard -Label "Strategy5 watchdog" -LogPath $log

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
$running = @(Test-Strategy5Running)

if ($running.Count -gt 0) {
  $pids = ($running | Select-Object -ExpandProperty ProcessId) -join ","
  Write-WatchdogLog "strategy5 already running; no restart. pid=$pids"
  Write-WatchdogStatus "running" "strategy5 already running; pid=$pids"
  exit 0
}

Write-WatchdogLog "starting strategy5 runner: $runner"
$pwshExe = "C:\Program Files\PowerShell\7\pwsh.exe"
if (-not (Test-Path -LiteralPath $pwshExe)) { $pwshExe = "pwsh.exe" }
& $pwshExe -NoProfile -ExecutionPolicy Bypass -File $runner *>&1 | ForEach-Object {
  Add-Content -LiteralPath $log -Value ([string]$_) -Encoding utf8
}

$exitCode = $LASTEXITCODE
if ($null -eq $exitCode) { $exitCode = 0 }

if ($exitCode -ne 0) {
  Write-WatchdogLog "strategy5 runner failed with exit code $exitCode"
  Write-WatchdogStatus "failed" "runner failed" $exitCode
  exit $exitCode
}

$postHealth = Test-Strategy5Healthy (Get-Strategy5Payload)
if (-not $postHealth.Healthy) {
  Write-WatchdogLog "strategy5 still unhealthy after rerun: $($postHealth.Reason)"
  Write-WatchdogStatus "failed" "still unhealthy after rerun: $($postHealth.Reason)" 1
  exit 1
}

Write-WatchdogLog "strategy5 recovered: $($postHealth.Reason)"
Write-WatchdogStatus "success" "recovered: $($postHealth.Reason)"
exit 0
