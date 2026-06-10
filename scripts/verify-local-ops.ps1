$ErrorActionPreference = "Stop"

$officialRoot = "C:\fuman-terminal-sync"
$publishRoot = "C:\fuman-terminal-publish-sync"
$badPatterns = @(
  "C:\fuman-terminal-sync-sync",
  "C:\Users\qutie\Documents\Codex\"
)

$tasks = Get-ScheduledTask | Where-Object {
  $_.TaskName -like "Fuman*" -or $_.TaskPath -like "*Fuman*"
}

$issues = New-Object System.Collections.Generic.List[string]
$warnings = New-Object System.Collections.Generic.List[string]

foreach ($task in $tasks) {
  $name = "$($task.TaskPath)$($task.TaskName)"
  if ($task.State -eq "Disabled") {
    continue
  }

  $actionText = ($task.Actions | ForEach-Object {
    "$($_.Execute) $($_.Arguments) StartIn=$($_.WorkingDirectory)"
  }) -join " "

  foreach ($pattern in $badPatterns) {
    if ($actionText -like "*$pattern*") {
      $issues.Add("$name uses suspicious path: $pattern")
    }
  }

  if ($actionText -like "*\Documents\Codex\*") {
    $warnings.Add("$name still uses an old Codex wrapper; run scripts\repair-fuman-scheduled-tasks.ps1 as Administrator to clean it.")
  }

  if ($actionText -like "*C:\fuman-terminal\*" -and $actionText -notlike "*run-cache-sync.ps1*") {
    $warnings.Add("$name still runs from C:\fuman-terminal; prefer repairing it to $officialRoot.")
  }

  if ($actionText -like "*run-cache-sync.ps1*") {
    $scriptPath = $null
    if ($actionText -match "-File\s+`"?([^`"\s]+run-cache-sync\.ps1)`"?") {
      $scriptPath = $Matches[1]
    }

    if (-not $scriptPath -or -not (Test-Path -LiteralPath $scriptPath)) {
      $issues.Add("$name runs cache sync but script path could not be verified: $actionText")
    } else {
      $taskCacheSyncText = Get-Content -LiteralPath $scriptPath -Raw
      if ($taskCacheSyncText -notmatch [regex]::Escape($publishRoot)) {
        $issues.Add("$name cache sync does not default to publish repo: $scriptPath")
      }
    }
  }
}

$cacheSync = Join-Path $officialRoot "run-cache-sync.ps1"
$cacheSyncText = Get-Content -LiteralPath $cacheSync -Raw
if ($cacheSyncText -notmatch [regex]::Escape($publishRoot)) {
  $issues.Add("run-cache-sync.ps1 does not default to publish sync repo: $publishRoot")
}

if ($cacheSyncText -match "\$syncRepo\s*=\s*""C:\\fuman-terminal-sync""") {
  $issues.Add("run-cache-sync.ps1 still hardcodes syncRepo to official source")
}

if ($issues.Count -gt 0) {
  Write-Host "[local-ops] failed" -ForegroundColor Red
  foreach ($issue in $issues) {
    Write-Host " - $issue" -ForegroundColor Red
  }
  exit 1
}

foreach ($warning in $warnings) {
  Write-Host "[local-ops] warning $warning" -ForegroundColor Yellow
}

Write-Host "[local-ops] ok tasks=$($tasks.Count) official=$officialRoot publish=$publishRoot"
