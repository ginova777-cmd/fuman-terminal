$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
Set-Location -LiteralPath "C:\fuman-terminal"

$env:FUMAN_RUNTIME_DIR = if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }
$logDir = Join-Path $env:FUMAN_RUNTIME_DIR "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("strategy5-battle-verify-{0}.log" -f (Get-Date -Format yyyyMMdd-HHmmss))
$alertScript = Join-Path $PSScriptRoot "scripts\send-workflow-alert.js"
$alertReceiptFile = Join-Path $env:FUMAN_RUNTIME_DIR "data\scan-receipts\strategy5-battle-verify-alert.json"

function Invoke-Strategy5BattleVerifyAlert {
  param([string]$Reason, [int]$ExitCode = 1)
  if ($env:STRATEGY5_BATTLE_VERIFY_DISABLE_ALERT -eq "1") { return }
  if (-not (Test-Path -LiteralPath $alertScript)) {
    Add-Content -LiteralPath $log -Encoding utf8 -Value "strategy5 alert script missing: $alertScript"
    return
  }
  $previousSubject = $env:FUMAN_ALERT_SUBJECT
  $previousText = $env:FUMAN_ALERT_TEXT
  $previousKind = $env:FUMAN_ALERT_KIND
  $previousSource = $env:FUMAN_ALERT_SOURCE
  $previousReceipt = $env:FUMAN_ALERT_RECEIPT_FILE
  try {
    $env:FUMAN_ALERT_SUBJECT = "Fuman Strategy5 battle verify failed"
    $env:FUMAN_ALERT_TEXT = "Strategy5 battle verify failed`nreason=$Reason`nexitCode=$ExitCode`nlog=$log`nExpected behavior: preserve latest complete run and expose chip/source health reason."
    $env:FUMAN_ALERT_KIND = "strategy5-battle-verify"
    $env:FUMAN_ALERT_SOURCE = "FumanStrategy5BattleVerify"
    $env:FUMAN_ALERT_RECEIPT_FILE = $alertReceiptFile
    node "--use-system-ca" $alertScript 2>&1 | Tee-Object -FilePath $log -Append
  } catch {
    Add-Content -LiteralPath $log -Encoding utf8 -Value "strategy5 Gmail alert failed: $($_.Exception.Message)"
  } finally {
    if ($null -eq $previousSubject) { Remove-Item Env:FUMAN_ALERT_SUBJECT -ErrorAction SilentlyContinue } else { $env:FUMAN_ALERT_SUBJECT = $previousSubject }
    if ($null -eq $previousText) { Remove-Item Env:FUMAN_ALERT_TEXT -ErrorAction SilentlyContinue } else { $env:FUMAN_ALERT_TEXT = $previousText }
    if ($null -eq $previousKind) { Remove-Item Env:FUMAN_ALERT_KIND -ErrorAction SilentlyContinue } else { $env:FUMAN_ALERT_KIND = $previousKind }
    if ($null -eq $previousSource) { Remove-Item Env:FUMAN_ALERT_SOURCE -ErrorAction SilentlyContinue } else { $env:FUMAN_ALERT_SOURCE = $previousSource }
    if ($null -eq $previousReceipt) { Remove-Item Env:FUMAN_ALERT_RECEIPT_FILE -ErrorAction SilentlyContinue } else { $env:FUMAN_ALERT_RECEIPT_FILE = $previousReceipt }
  }
}

. "$PSScriptRoot\schedule-guard.ps1"
Invoke-FumanWeekdayGuard -Label "Strategy5 institution battle verify" -LogPath $log

node scripts\verify-strategy5-battle-state.js 2>&1 | Tee-Object -FilePath $log -Append
if ($LASTEXITCODE -ne 0) {
  Invoke-Strategy5BattleVerifyAlert -Reason "verify-strategy5-battle-state failed" -ExitCode $LASTEXITCODE
  throw "Strategy5 institution battle verify failed with exit code $LASTEXITCODE; log=$log"
}
