$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path "C:\fuman-runtime\logs" | Out-Null
$log = "C:\fuman-runtime\logs\retired-scorecard-initial-flow-$(Get-Date -Format yyyyMMdd-HHmmss).log"
"Scorecard initial flow retired: current production flow uses terminal website / Supabase snapshots. This task is intentionally disabled." | Out-File $log -Encoding utf8
Write-Host "Scorecard initial flow retired; no action taken."
exit 0
