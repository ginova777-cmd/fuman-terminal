param([ValidateSet('strategy4','strategy5','institution')][string]$Strategy, [int]$RunnerProcessId, [int]$VerifierProcessId)
$ErrorActionPreference = 'Stop'
try {
  $runner = Get-CimInstance Win32_Process -Filter "ProcessId=$RunnerProcessId"
  $verifier = Get-CimInstance Win32_Process -Filter "ProcessId=$VerifierProcessId"
  if (-not $runner -or -not $verifier -or $verifier.ParentProcessId -ne $RunnerProcessId) { throw 'runner_parent_mismatch' }
  $taskName = if ($Strategy -eq 'institution') { 'Fuman 買賣超 Cache 2100' } elseif ($Strategy -eq 'strategy4') { 'Fuman Strategy4 Cache 1600' } else { 'Fuman Strategy5 Cache 2100' }
  $task = Get-ScheduledTask -TaskName $taskName
  $runnerOwnerSid = $null; $taskPrincipalSid = $null
  if ($Strategy -eq 'institution') {
    $owner = Invoke-CimMethod -InputObject $runner -MethodName GetOwnerSid
    if ($owner.ReturnValue -ne 0) { throw 'runner_owner_unreadable' }
    $runnerOwnerSid = $owner.Sid
    $identity = [string]$task.Principal.UserId
    $taskPrincipalSid = if ($identity -match '^S-1-') { $identity } else { ([System.Security.Principal.NTAccount]::new($identity)).Translate([System.Security.Principal.SecurityIdentifier]).Value }
  }
  $started = [datetime]$runner.CreationDate
  $events = @(Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-TaskScheduler/Operational';StartTime=$started.AddSeconds(-10);EndTime=$started.AddSeconds(20);Id=107,110,129,200} -MaxEvents 200 -ErrorAction Stop | ForEach-Object {
    [xml]$xml = $_.ToXml()
    $fields = @{}
    foreach ($item in $xml.Event.EventData.Data) { $fields[[string]$item.Name] = [string]$item.'#text' }
    if ($fields.TaskName -eq ($task.TaskPath + $task.TaskName)) {
      [ordered]@{id=$_.Id;recordId=$_.RecordId;time=$_.TimeCreated.ToUniversalTime().ToString('o');activityId=[string]$xml.Event.System.Correlation.ActivityID;fields=$fields;xml=$_.ToXml()}
    }
  })
  [ordered]@{ok=$true;executablePath=$runner.ExecutablePath;runnerOwnerSid=$runnerOwnerSid;taskPrincipalSid=$taskPrincipalSid;runnerPid=$RunnerProcessId;parentPid=[int]$verifier.ParentProcessId;runnerStartedAt=$started.ToUniversalTime().ToString('o');commandLine=$runner.CommandLine;taskName=($task.TaskPath+$task.TaskName);actions=@($task.Actions | Select-Object Execute,Arguments,WorkingDirectory);events=$events} | ConvertTo-Json -Depth 12 -Compress
} catch {
  [ordered]@{ok=$false;reason=$_.Exception.Message} | ConvertTo-Json -Compress
}
