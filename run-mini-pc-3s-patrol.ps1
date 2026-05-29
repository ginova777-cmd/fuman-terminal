$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

$root = "C:\fuman-terminal"
$logDir = "C:\fuman-runtime\logs"
$launcherLog = Join-Path $logDir "mini-pc-3s-patrol.log"
$pwsh = "C:\Users\ginov\AppData\Local\Microsoft\WindowsApps\pwsh.exe"
if (-not (Test-Path $pwsh)) {
  $pwsh = "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-PatrolLog {
  param([string]$Message)
  "[$(Get-Date)] $Message" | Add-Content -LiteralPath $launcherLog
}

function Get-RunningPid {
  param([string]$Marker)
  if (-not (Test-Path $Marker)) { return 0 }
  $oldPid = Get-Content -LiteralPath $Marker -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $oldPid) { return 0 }
  $process = Get-Process -Id ([int]$oldPid) -ErrorAction SilentlyContinue
  if ($process) { return [int]$oldPid }
  return 0
}

function Start-FumanPatrol {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Script
  )

  $marker = Join-Path $logDir "$Name.pid"
  $runningPid = Get-RunningPid $marker
  if ($runningPid) {
    Write-PatrolLog "${Name} already running: PID $runningPid"
    return
  }

  $args = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", (Join-Path $root $Script)
  )
  $process = Start-Process -FilePath $pwsh -ArgumentList $args -WorkingDirectory $root -WindowStyle Hidden -PassThru
  $process.Id | Out-File -LiteralPath $marker -Encoding ascii
  Write-PatrolLog "started ${Name}: PID $($process.Id)"
}

Set-Location $root

$env:FUMAN_RUNTIME_DIR = "C:\fuman-runtime"
$env:FUMAN_DATA_DIR = "C:\fuman-runtime\data"
$env:FUMAN_CACHE_DIR = "C:\fuman-runtime\cache"
$env:FUMAN_STATE_DIR = "C:\fuman-runtime\state"
$env:INTRADAY_PATROL_INTERVAL_MS = "3000"
$env:REALTIME_RADAR_PATROL_INTERVAL_MS = "3000"
$env:NODE_OPTIONS = "--use-system-ca"

Write-PatrolLog "Mini PC 3s patrol launcher start"
. "C:\fuman-terminal\schedule-guard.ps1"
Invoke-FumanWeekdayGuard -Label "Mini PC 3s patrol launcher" -LogPath $launcherLog

Start-FumanPatrol -Name "strategy2-intraday-3s" -Script "run-strategy2-intraday.ps1"
Start-FumanPatrol -Name "realtime-radar-3s" -Script "run-realtime-radar.ps1"
Write-PatrolLog "Mini PC 3s patrol launcher end"
