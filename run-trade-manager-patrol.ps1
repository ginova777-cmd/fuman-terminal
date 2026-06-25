$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path "C:\fuman-runtime\logs" | Out-Null
$log = "C:\fuman-runtime\logs\retired-trade-manager-patrol-$(Get-Date -Format yyyyMMdd-HHmmss).log"
"Trade manager patrol retired: current production flow uses terminal website / Supabase snapshots. This task is intentionally disabled." | Out-File $log -Encoding utf8
Write-Host "Trade manager patrol retired; no action taken."
exit 0
