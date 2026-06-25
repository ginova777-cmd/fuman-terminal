$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path "C:\fuman-runtime\logs" | Out-Null
$log = "C:\fuman-runtime\logs\retired-scorecard-final-flow-$(Get-Date -Format yyyyMMdd-HHmmss).log"
"Scorecard final flow retired: current production flow uses terminal website / Supabase snapshots. This task is intentionally disabled." | Out-File $log -Encoding utf8
Write-Host "Scorecard final flow retired; no action taken."
exit 0
