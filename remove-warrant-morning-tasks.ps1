$ErrorActionPreference = "Stop"

# 精準刪除權證早上排程，不使用 wildcard。
# 會刪：
# - Fuman 權證走向 Cache 0530
# - Fuman 權證走向 Watchdog 0550
# - Fuman Warrant Battle Verify 0805
#
# 使用方式：
#   PowerShell 以系統管理員開啟後執行：
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\fuman-terminal\remove-warrant-morning-tasks.ps1"

$tasks = @(
  "Fuman 權證走向 Cache 0530",
  "Fuman 權證走向 Watchdog 0550",
  "Fuman Warrant Battle Verify 0805"
)

foreach ($taskName in $tasks) {
  $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if (-not $existing) {
    Write-Host "SKIP missing: $taskName"
    continue
  }

  Write-Host "DELETE: $taskName"
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

Write-Host "Done. Remaining warrant tasks:"
Get-ScheduledTask |
  Where-Object { $_.TaskName -match "權證|Warrant" } |
  Select-Object TaskName, State |
  Format-Table -AutoSize
