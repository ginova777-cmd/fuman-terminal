param(
  [string]$Root = "C:\fuman-release-owner\fuman-terminal",
  [string]$TaskName = "Fuman Daytrade Preopen Snapshot 0845-0859"
)
$ErrorActionPreference = "Stop"
$pwsh = "C:\Program Files\PowerShell\7\pwsh.exe"
$node = "C:\Program Files\nodejs\node.exe"
$script = Join-Path $Root "scripts\sync-daytrade-preopen-websocket-supabase.js"
if (!(Test-Path -LiteralPath $node)) { throw "node_missing:$node" }
if (!(Test-Path -LiteralPath $script)) { throw "preopen_sync_missing:$script" }
$escapedNode = [Security.SecurityElement]::Escape($node)
$escapedScript = [Security.SecurityElement]::Escape($script)
$escapedRoot = [Security.SecurityElement]::Escape($Root)
$start = "$(Get-Date -Format yyyy-MM-dd)T08:45:00"
$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers><CalendarTrigger><Repetition><Interval>PT1M</Interval><Duration>PT15M</Duration><StopAtDurationEnd>true</StopAtDurationEnd></Repetition><StartBoundary>$start</StartBoundary><Enabled>true</Enabled><ScheduleByWeek><DaysOfWeek><Monday/><Tuesday/><Wednesday/><Thursday/><Friday/></DaysOfWeek><WeeksInterval>1</WeeksInterval></ScheduleByWeek></CalendarTrigger></Triggers>
  <Principals><Principal id="Author"><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><ExecutionTimeLimit>PT1M</ExecutionTimeLimit><Enabled>true</Enabled></Settings>
  <Actions Context="Author"><Exec><Command>$escapedNode</Command><Arguments>"$escapedScript"</Arguments><WorkingDirectory>$escapedRoot</WorkingDirectory></Exec></Actions>
</Task>
"@
Register-ScheduledTask -TaskName $TaskName -Xml $xml -Force | Out-Null
$task = Get-ScheduledTask -TaskName $TaskName
[pscustomobject]@{ ok=$true; task_name=$TaskName; state=[string]$task.State; root=$Root; interval="PT1M"; window="08:45-08:59 Asia/Taipei" } | ConvertTo-Json -Compress
