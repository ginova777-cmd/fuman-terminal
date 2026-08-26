param(
  [string]$Root = "C:\fuman-terminal",
  [string]$TaskName = "Fuman Mother Pool Telegram 0900-1230"
)
$ErrorActionPreference = "Stop"
$runner = Join-Path $Root "run-daytrade-intraday-burst-telegram.ps1"
if (-not (Test-Path -LiteralPath $runner)) { throw "runner not found: $runner" }
$pwsh = (Get-Command pwsh.exe -ErrorAction Stop).Source
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$userSid = $identity.User.Value
$userName = $identity.Name
$xmlEscape = { param([string]$Value) [Security.SecurityElement]::Escape($Value) }
$escapedUserSid = & $xmlEscape $userSid
$escapedUserName = & $xmlEscape $userName
$escapedPwsh = & $xmlEscape $pwsh
$escapedRunner = & $xmlEscape $runner
$escapedRoot = & $xmlEscape $Root
$startBoundary = (Get-Date).Date.AddHours(9).ToString("yyyy-MM-dd'T'HH:mm:ss")
$taskXml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.3" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Date>$(Get-Date -Format s)</Date>
    <Author>$escapedUserName</Author>
    <Description>Telegram-only Strategy2 Mother Pool burst notifier; consumes formal outbox only; never starts a strategy run.</Description>
  </RegistrationInfo>
  <Principals>
    <Principal id="Author">
      <UserId>$escapedUserSid</UserId>
      <LogonType>S4U</LogonType>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT1M</ExecutionTimeLimit>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <StartWhenAvailable>true</StartWhenAvailable>
    <UseUnifiedSchedulingEngine>true</UseUnifiedSchedulingEngine>
  </Settings>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>$startBoundary</StartBoundary>
      <Repetition>
        <Interval>PT1M</Interval>
        <Duration>PT3H31M</Duration>
        <StopAtDurationEnd>true</StopAtDurationEnd>
      </Repetition>
      <ScheduleByWeek>
        <WeeksInterval>1</WeeksInterval>
        <DaysOfWeek>
          <Monday />
          <Tuesday />
          <Wednesday />
          <Thursday />
          <Friday />
        </DaysOfWeek>
      </ScheduleByWeek>
    </CalendarTrigger>
  </Triggers>
  <Actions Context="Author">
    <Exec>
      <Command>$escapedPwsh</Command>
      <Arguments>-WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File &quot;$escapedRunner&quot;</Arguments>
      <WorkingDirectory>$escapedRoot</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@
Register-ScheduledTask -TaskName $TaskName -Xml $taskXml -Force | Out-Null
Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName, State