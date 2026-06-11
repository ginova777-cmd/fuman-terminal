param(
  [string]$TaskName = "Fuman Public Slot Shared Source 0800",
  [string]$StartTime = "08:00",
  [string]$ProjectUrl = "https://cpmpfhbzutkiecccekfr.supabase.co",
  [string]$RuntimeDir = "C:\fuman-runtime",
  [string]$FumanRoot = "C:\fuman-terminal",
  [switch]$RunNow
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Runner = Join-Path $ScriptDir "Run-PublicSlotSharedSource.ps1"
$Starter = Join-Path $ScriptDir "Start-PublicSlotSharedSource.cmd"
$SecretDir = Join-Path $RuntimeDir "secrets"
$ServiceRoleFile = Join-Path $SecretDir "supabase-service-role-key.txt"

function ConvertTo-PlainText {
  param([securestring]$Secure)
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  }
}

if (-not (Test-Path -LiteralPath $Runner)) {
  throw "Runner missing: $Runner"
}
if (-not (Test-Path -LiteralPath $Starter)) {
  throw "Starter missing: $Starter"
}

New-Item -ItemType Directory -Force -Path $SecretDir | Out-Null

if (-not (Test-Path -LiteralPath $ServiceRoleFile)) {
  Write-Host ""
  Write-Host "第一次安裝需要保存 Supabase service_role key，這個只會存在本機："
  Write-Host $ServiceRoleFile
  Write-Host "不要貼到聊天視窗。請在 PowerShell 裡貼上 service_role，然後按 Enter。"
  $secure = Read-Host "service_role key" -AsSecureString
  $plain = ConvertTo-PlainText $secure
  if ([string]::IsNullOrWhiteSpace($plain)) { throw "service_role key is empty." }
  Set-Content -LiteralPath $ServiceRoleFile -Value $plain.Trim() -Encoding ascii
  Write-Host "已保存 service_role key 到本機 secrets。"
}

$taskRun = "`"$Starter`""

schtasks /Create /F /SC DAILY /ST $StartTime /TN $TaskName /TR $taskRun | Out-Host

Write-Host ""
Write-Host "完成：每天 $StartTime 會自動啟動 Supabase Fugle 公共槽 shared source。"
Write-Host "排程名稱：$TaskName"
Write-Host "啟動檔：$Starter"

if ($RunNow) {
  Write-Host ""
  Write-Host "現在立即啟動一次..."
  schtasks /Run /TN $TaskName | Out-Host
}
