param(
  [string]$TaskName = "Fuman Strategy2 Readiness Source 0800",
  [string]$StartTime = "08:00",
  [string]$RuntimeDir = "C:\fuman-runtime",
  [switch]$RunNow
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Runner = Join-Path $ScriptDir "Run-PublicSlotSharedSource.ps1"
$Starter = Join-Path $ScriptDir "Start-Strategy2ReadinessSource.cmd"
$SecretDir = Join-Path $RuntimeDir "secrets"
$ServiceRoleFile = Join-Path $SecretDir "supabase-service-role-key.txt"

if (-not (Test-Path -LiteralPath $Runner)) {
  throw "Runner missing: $Runner"
}
if (-not (Test-Path -LiteralPath $Starter)) {
  throw "Starter missing: $Starter"
}
if (-not (Test-Path -LiteralPath $ServiceRoleFile)) {
  throw "Supabase service_role key missing: $ServiceRoleFile"
}

$taskRun = "`"$Starter`""

schtasks /Create /F /SC DAILY /ST $StartTime /TN $TaskName /TR $taskRun | Out-Host

Write-Host ""
Write-Host "完成：每天 $StartTime 啟動 Strategy2 readiness source。"
Write-Host "排程名稱：$TaskName"
Write-Host "目標：08:45 futopt stale_quote=0；08:55 preopen 3 snapshots=100%；09:35 1m ready_ge_35=100%。"
Write-Host "啟動檔：$Starter"

if ($RunNow) {
  Write-Host ""
  Write-Host "現在立即啟動一次..."
  schtasks /Run /TN $TaskName | Out-Host
}
