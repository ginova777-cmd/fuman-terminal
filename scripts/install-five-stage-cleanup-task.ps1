param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$UserId = "$env:USERDOMAIN\$env:USERNAME"
)

$ErrorActionPreference = 'Stop'
$pwsh = 'C:\Program Files\PowerShell\7\pwsh.exe'
if (-not (Test-Path -LiteralPath $pwsh)) { $pwsh = 'pwsh.exe' }
$principal = New-ScheduledTaskPrincipal -UserId $UserId -LogonType S4U -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -MultipleInstances IgnoreNew

$specs = @(
  @{ Name='Fuman API-Only Retired Artifact Cleanup 1535'; At='17:10'; Runner='run-api-only-retired-cleanup.ps1'; Extra=''; Purpose='stage 1/5 retired local artifacts' },
  @{ Name='Fuman Supabase Vercel History Cleanup 1545'; At='17:40'; Runner='run-history-retention-cleanup.ps1'; Extra=' -Apply'; Purpose='stage 2/5 bounded Supabase/Vercel history retention' },
  @{ Name='Fuman Global Cost Janitor Scorecard 1555'; At='18:10'; Runner='run-global-cost-janitor-scorecard.ps1'; Extra=''; Purpose='stage 3/5 read-only receipt and cost verification' },
  @{ Name='Fuman Daytrade Intraday Retention 1605'; At='18:40'; Runner='run-daytrade-intraday-retention.ps1'; Extra=' -Apply -MaxBatches 60'; Purpose='stage 4/5 bounded formal one-minute retention' },
  @{ Name='Fuman Daily Retention Maintenance 1625'; At='19:10'; Runner='run-daily-retention-maintenance.ps1'; Extra=' -Apply'; Purpose='stage 5/5 runtime/cache/observability cleanup and final verifier' }
)

$rows = foreach ($spec in $specs) {
  $runner = Join-Path $ProjectRoot $spec.Runner
  if (-not (Test-Path -LiteralPath $runner)) { throw "Missing cleanup runner: $runner" }
  $action = New-ScheduledTaskAction -Execute $pwsh -Argument "-WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File `"$runner`"$($spec.Extra)" -WorkingDirectory $ProjectRoot
  $trigger = New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At $spec.At
  Register-ScheduledTask -TaskName $spec.Name -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "Five-stage cleanup $($spec.Purpose); actual trigger $($spec.At) Asia/Taipei." -Force | Out-Null
  $task = Get-ScheduledTask -TaskName $spec.Name
  $info = Get-ScheduledTaskInfo -TaskName $spec.Name
  [pscustomobject]@{ taskName=$spec.Name; actualTime=$spec.At; state=[string]$task.State; nextRun=$info.NextRunTime.ToString('o'); logonType=[string]$task.Principal.LogonType; runLevel=[string]$task.Principal.RunLevel; multipleInstances=[string]$task.Settings.MultipleInstances; executionTimeLimit=[string]$task.Settings.ExecutionTimeLimit }
}

$receipt = [ordered]@{
  ok = $true
  checkedAt = (Get-Date).ToString('o')
  contract = 'five-stage-cleanup-after-strategy4-v1'
  strategy4Closure = '17:00'
  strategy5Start = '21:00'
  noAutomaticRetry = $true
  tasks = $rows
}
$statusDir = 'C:\fuman-runtime\status'
New-Item -ItemType Directory -Force -Path $statusDir | Out-Null
$receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $statusDir 'five-stage-cleanup-schedule.json') -Encoding utf8
$receipt | ConvertTo-Json -Depth 8
