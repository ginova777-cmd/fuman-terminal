$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path "C:\fuman-runtime\logs" | Out-Null
$log = "C:\fuman-runtime\logs\retired-trade-manager-settlement-report-$(Get-Date -Format yyyyMMdd-HHmmss).log"
"Trade manager settlement report retired: current production flow uses terminal website / Supabase snapshots. This task is intentionally disabled." | Out-File $log -Encoding utf8
Write-Host "Trade manager settlement report retired; no action taken."
exit 0
