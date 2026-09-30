param([string]$TaskName = "Fuman Daytrade 5m Candidate Verification")
$ErrorActionPreference = 'Stop'
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Disable-ScheduledTask -TaskName $TaskName | Out-Null
}
Write-Output 'DISABLED: OWNER_RETIRED_5M; installer cannot recreate this task'
