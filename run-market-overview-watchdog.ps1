$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

Set-Location "C:\fuman-terminal"

$runtimeDir = "C:\fuman-runtime"
$logDir = Join-Path $runtimeDir "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("market-overview-watchdog-{0}.log" -f (Get-Date -Format yyyyMMdd))

function Write-WatchdogLog {
  param([string]$Message)
  "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message | Out-File -FilePath $log -Encoding utf8 -Append
}

. "C:\fuman-terminal\schedule-guard.ps1"
Invoke-FumanWeekdayGuard -Label "Market overview watchdog" -LogPath $log

function Get-TaipeiMinuteOfDay {
  $taipeiNow = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId((Get-Date), "Taipei Standard Time")
  return ($taipeiNow.Hour * 60) + $taipeiNow.Minute
}

$minute = Get-TaipeiMinuteOfDay
$marketStart = 9 * 60
$marketEnd = 13 * 60 + 30
$heartbeatGraceSeconds = 45

if ($minute -lt $marketStart -or $minute -gt $marketEnd) {
  Write-WatchdogLog "outside market window; no action"
  exit 0
}

$latestPatrolLog = Get-ChildItem -LiteralPath $logDir -Filter "market-overview-$(Get-Date -Format yyyyMMdd)-*.log" -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if ($latestPatrolLog) {
  $ageSeconds = ((Get-Date) - $latestPatrolLog.LastWriteTime).TotalSeconds
  if ($ageSeconds -le $heartbeatGraceSeconds) {
    Write-WatchdogLog ("market overview patrol heartbeat alive; log={0}; age={1:N0}s" -f $latestPatrolLog.Name, $ageSeconds)
    exit 0
  }
}

$existingPatrol = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -match "scripts\\patrol-market-overview\.js|scripts/patrol-market-overview\.js" }

$existingLauncher = Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -match "powershell(\.exe)?$" -and
    $_.CommandLine -match "run-market-overview\.ps1" -and
    $_.CommandLine -notmatch "run-market-overview-watchdog\.ps1"
  }

if ($existingPatrol -or $existingLauncher) {
  $ids = @(
    $existingPatrol | Select-Object -ExpandProperty ProcessId
    $existingLauncher | Select-Object -ExpandProperty ProcessId
  ) -join ","
  Write-WatchdogLog "market overview patrol alive; pid=$ids"
  exit 0
}

Write-WatchdogLog "market overview patrol missing; restarting"
$runner = "C:\fuman-terminal\run-hidden.vbs"
$script = "C:\fuman-terminal\run-market-overview.ps1"
Start-Process -FilePath "wscript.exe" -ArgumentList @("//B", "//Nologo", $runner, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $script) -WorkingDirectory "C:\fuman-terminal" -WindowStyle Hidden
Write-WatchdogLog "restart requested"
