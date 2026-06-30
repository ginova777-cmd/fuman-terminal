$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
Set-Location -LiteralPath "C:\fuman-terminal"

$env:FUMAN_RUNTIME_DIR = if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }
$logDir = Join-Path $env:FUMAN_RUNTIME_DIR "logs"
$receiptDir = Join-Path $env:FUMAN_RUNTIME_DIR "data\scan-receipts"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
New-Item -ItemType Directory -Force -Path $receiptDir | Out-Null
$log = Join-Path $logDir ("institution-battle-verify-{0}.log" -f (Get-Date -Format yyyyMMdd-HHmmss))
$alertReceipt = Join-Path $receiptDir "institution-battle-verify-alert.json"

function Invoke-InstitutionBattleFailureAlert($ExitCode) {
  $nodeExe = "C:\Program Files\nodejs\node.exe"
  if (-not (Test-Path -LiteralPath $nodeExe)) { $nodeExe = "node" }
  $tailText = ""
  try { $tailText = (Get-Content -LiteralPath $log -ErrorAction SilentlyContinue | Select-Object -Last 40) -join "`n" } catch {}
  $env:FUMAN_ALERT_KIND = "institution-battle-verify"
  $env:FUMAN_ALERT_SOURCE = "Fuman Institution Battle Verify 2110"
  $env:FUMAN_ALERT_SUBJECT = "Fuman institution battle verify failed"
  $env:FUMAN_ALERT_RECEIPT_FILE = $alertReceipt
  $env:FUMAN_ALERT_TEXT = @"
Fuman institution battle verify failed

exitCode: $ExitCode
log: $log
receipt: $alertReceipt
checkedAt: $((Get-Date).ToString("o"))

tail:
$tailText
"@
  $alertOutput = New-Object System.Collections.Generic.List[string]
  try {
    & $nodeExe "--use-system-ca" "scripts\send-workflow-alert.js" "--kind=institution-battle-verify" "--receipt=$alertReceipt" *>&1 | ForEach-Object {
      $text = [string]$_
      $alertOutput.Add($text) | Out-Null
      Add-Content -LiteralPath $log -Value "[alert] $text" -Encoding utf8
    }
    $alertExit = $LASTEXITCODE
  } catch {
    $alertExit = 1
    $alertOutput.Add($_.Exception.Message) | Out-Null
    Add-Content -LiteralPath $log -Value "[alert] EXCEPTION $($_.Exception.Message)" -Encoding utf8
  }
  [ordered]@{
    ok = ($alertExit -eq 0)
    source = "send-workflow-alert.js"
    kind = "institution-battle-verify"
    receipt = $alertReceipt
    exitCode = $alertExit
    tail = @($alertOutput.ToArray() | Select-Object -Last 20)
    checkedAt = (Get-Date).ToString("o")
  } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $alertReceipt -Encoding utf8
}

. "$PSScriptRoot\schedule-guard.ps1"
Invoke-FumanWeekdayGuard -Label "Institution chip-flow battle verify" -LogPath $log

node scripts\verify-institution-battle-state.js 2>&1 | Tee-Object -FilePath $log -Append
if ($LASTEXITCODE -ne 0) {
  Invoke-InstitutionBattleFailureAlert $LASTEXITCODE
  throw "Institution chip-flow battle verify failed with exit code $LASTEXITCODE; log=$log"
}
