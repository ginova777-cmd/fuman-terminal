param(
  [string]$Root = "C:\fuman-terminal",
  [string]$RuntimeDir = "C:\fuman-runtime",
  [string]$ProductionUrl = "https://fuman-terminal.vercel.app",
  [string]$DailyTaskName = "Fuman Scorecard Daily Automation 1400",
  [string]$WatchdogTaskName = "Fuman Scorecard Daily Watchdog 1410",
  [string]$DailyTime = "14:00",
  [string]$WatchdogTime = "14:10",
  [switch]$InteractiveFallback
)

$ErrorActionPreference = "Stop"

function Resolve-PowerShell() {
  $pwsh = Get-Command pwsh.exe -ErrorAction SilentlyContinue
  if ($pwsh) {
    return $pwsh.Source
  }
  return (Get-Command powershell.exe -ErrorAction Stop).Source
}

function New-FumanPrincipal() {
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  if ($InteractiveFallback) {
    return New-ScheduledTaskPrincipal -UserId $identity -LogonType InteractiveToken -RunLevel Highest
  }
  return New-ScheduledTaskPrincipal -UserId $identity -LogonType S4U -RunLevel Highest
}

function New-FumanSettings($Hours) {
  $settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Hours $Hours)
  $settings.DisallowStartIfOnBatteries = $false
  $settings.StopIfGoingOnBatteries = $false
  return $settings
}

function Register-FumanTask($Name, $Script, $At, $ArgumentTail, $Description, $Hours) {
  if (-not (Test-Path -LiteralPath $Script)) {
    throw "task script missing: $Script"
  }
  $ps = Resolve-PowerShell
  $arguments = @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    ('"{0}"' -f $Script)
  ) + $ArgumentTail
  $action = New-ScheduledTaskAction -Execute $ps -Argument ($arguments -join " ") -WorkingDirectory $Root
  $trigger = New-ScheduledTaskTrigger -Daily -At ([datetime]::ParseExact($At, "HH:mm", $null))
  $settings = New-FumanSettings $Hours
  $principal = New-FumanPrincipal
  Register-ScheduledTask `
    -TaskName $Name `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description $Description `
    -Force | Out-Null
}

$wrapper = Join-Path $Root "run-scorecard-daily-automation-wrapper.ps1"
$watchdog = Join-Path $Root "run-scorecard-daily-watchdog.ps1"

Register-FumanTask `
  -Name $DailyTaskName `
  -Script $wrapper `
  -At $DailyTime `
  -ArgumentTail @("-ProjectRoot", ('"{0}"' -f $Root), "-RuntimeRoot", ('"{0}"' -f $RuntimeDir)) `
  -Description "Runs the Fuman /88 scorecard daily automation through a receipt/log wrapper." `
  -Hours 2

Register-FumanTask `
  -Name $WatchdogTaskName `
  -Script $watchdog `
  -At $WatchdogTime `
  -ArgumentTail @("-ProjectRoot", ('"{0}"' -f $Root), "-RuntimeRoot", ('"{0}"' -f $RuntimeDir), "-ProductionUrl", ('"{0}"' -f $ProductionUrl)) `
  -Description "Repairs /88 scorecard if scorecard_latest is stale after the 14:00 automation window." `
  -Hours 2

Get-ScheduledTask -TaskName $DailyTaskName, $WatchdogTaskName | Select-Object TaskName, State
