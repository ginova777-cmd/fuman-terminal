$ErrorActionPreference = "Stop"

$officialRoot = "C:\fuman-terminal-sync"
$pwsh = "C:\Program Files\PowerShell\7\pwsh.exe"
$updated = New-Object System.Collections.Generic.List[string]
$skipped = New-Object System.Collections.Generic.List[string]

function New-FumanPowerShellAction {
  param(
    [Parameter(Mandatory = $true)][string]$ScriptPath,
    [string]$Tail = ""
  )

  $args = @(
    "-WindowStyle",
    "Hidden",
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    "`"$ScriptPath`""
  )

  if ($Tail.Trim()) {
    $args += $Tail.Trim()
  }

  New-ScheduledTaskAction -Execute $pwsh -Argument ($args -join " ") -WorkingDirectory $officialRoot
}

$tasks = Get-ScheduledTask | Where-Object { $_.TaskName -like "Fuman*" }

foreach ($task in $tasks) {
  $actionText = ($task.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments)" }) -join " "

  if ($actionText -match "-File\s+`"?([^`"\s]+\.ps1)`"?\s*(.*)$") {
    $oldScript = $Matches[1]
    $tail = $Matches[2]
    $newScript = $oldScript -replace "^C:\\fuman-terminal-sync-sync", $officialRoot
    $newScript = $newScript -replace "^C:\\fuman-terminal(?!-sync)", $officialRoot

    if ($newScript -ne $oldScript) {
      if (Test-Path -LiteralPath $newScript) {
        $newAction = New-FumanPowerShellAction -ScriptPath $newScript -Tail $tail
        Set-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath -Action $newAction | Out-Null
        $updated.Add("$($task.TaskPath)$($task.TaskName) -> $newScript $tail")
      } else {
        $skipped.Add("$($task.TaskPath)$($task.TaskName) missing $newScript")
      }
    }
  } elseif ($actionText -like "*Documents\Codex*PublicSlotSharedSource.cmd*") {
    Disable-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath | Out-Null
    $updated.Add("$($task.TaskPath)$($task.TaskName) disabled old Codex public slot task")
  }
}

$freshTaskName = "Fuman Data Freshness Verify 1555"
$freshTrigger = New-ScheduledTaskTrigger -Daily -At 15:55
$freshAction = New-FumanPowerShellAction -ScriptPath (Join-Path $officialRoot "run-verify-data-freshness.ps1")

if (Get-ScheduledTask -TaskName $freshTaskName -ErrorAction SilentlyContinue) {
  Set-ScheduledTask -TaskName $freshTaskName -Action $freshAction -Trigger $freshTrigger | Out-Null
  $updated.Add("\$freshTaskName updated")
} else {
  Register-ScheduledTask -TaskName $freshTaskName -Action $freshAction -Trigger $freshTrigger -Description "Verify Fuman terminal data freshness after market close" -User $env:USERNAME | Out-Null
  $updated.Add("\$freshTaskName created")
}

Write-Host "[repair-tasks] updated=$($updated.Count)"
foreach ($item in $updated) {
  Write-Host " - $item"
}

if ($skipped.Count -gt 0) {
  Write-Host "[repair-tasks] skipped=$($skipped.Count)" -ForegroundColor Yellow
  foreach ($item in $skipped) {
    Write-Host " - $item" -ForegroundColor Yellow
  }
}
