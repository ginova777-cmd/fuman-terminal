param([string]$TaskName = "Fuman Daytrade 5m Candidate Verification")
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$runner = Join-Path $root "run-daytrade-intraday-5m-current-candidates.ps1"
if (-not (Test-Path -LiteralPath $runner)) { throw "runner missing: $runner" }
$pwsh = (Get-Command pwsh.exe -ErrorAction Stop).Source
$start = (Get-Date).Date.AddHours(9).ToString("yyyy-MM-dd'T'HH:mm:ss")
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$escapedPwsh = [System.Security.SecurityElement]::Escape($pwsh)
$escapedArgs = [System.Security.SecurityElement]::Escape("-NoProfile -ExecutionPolicy Bypass -File `"$runner`"")
$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Canonical 5-minute candidate writer, anon verifier and Supabase verification receipt.</Description></RegistrationInfo>
  <Triggers><CalendarTrigger><StartBoundary>$start</StartBoundary><Enabled>true</Enabled><ScheduleByWeek><DaysOfWeek><Monday/><Tuesday/><Wednesday/><Thursday/><Friday/></DaysOfWeek><WeeksInterval>1</WeeksInterval></ScheduleByWeek><Repetition><Interval>PT5M</Interval><Duration>PT4H30M</Duration><StopAtDurationEnd>false</StopAtDurationEnd></Repetition></CalendarTrigger></Triggers>
  <Principals><Principal id="Author"><UserId>$sid</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><StartWhenAvailable>true</StartWhenAvailable><ExecutionTimeLimit>PT4M</ExecutionTimeLimit><Enabled>true</Enabled></Settings>
  <Actions Context="Author"><Exec><Command>$escapedPwsh</Command><Arguments>$escapedArgs</Arguments></Exec></Actions>
</Task>
"@
Register-ScheduledTask -TaskName $TaskName -Xml $xml -Force | Out-Null
Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName,State
