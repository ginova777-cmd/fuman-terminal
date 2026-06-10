$ErrorActionPreference = "Stop"

$oldPath = "C:\fuman-terminal"
$archivePath = "C:\fuman-terminal-OLD-DO-NOT-EDIT"

$activeRefs = Get-ScheduledTask | Where-Object {
  $_.State -ne "Disabled" -and (
    ($_.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments) $($_.WorkingDirectory)" }) -join " "
  ) -like "*$oldPath*"
}

if ($activeRefs.Count -gt 0) {
  Write-Host "[archive-old-source] refused: active scheduled tasks still reference $oldPath" -ForegroundColor Red
  foreach ($task in $activeRefs) {
    Write-Host " - $($task.TaskPath)$($task.TaskName)" -ForegroundColor Red
  }
  Write-Host "Run PowerShell as Administrator, then:" -ForegroundColor Yellow
  Write-Host "  cd C:\fuman-terminal-sync"
  Write-Host "  powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\repair-fuman-scheduled-tasks.ps1"
  exit 1
}

if (-not (Test-Path -LiteralPath $oldPath)) {
  Write-Host "[archive-old-source] ok old source already absent: $oldPath"
  exit 0
}

if (Test-Path -LiteralPath $archivePath) {
  $suffix = Get-Date -Format "yyyyMMdd-HHmmss"
  $archivePath = "C:\fuman-terminal-OLD-DO-NOT-EDIT-$suffix"
}

Rename-Item -LiteralPath $oldPath -NewName (Split-Path -Leaf $archivePath)
Write-Host "[archive-old-source] ok $oldPath -> $archivePath"
