$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
Set-Location -LiteralPath "C:\fuman-terminal"

$env:FUMAN_RUNTIME_DIR = if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }
$logDir = Join-Path $env:FUMAN_RUNTIME_DIR "logs"
$receiptDir = Join-Path $env:FUMAN_RUNTIME_DIR "data\scan-receipts"
New-Item -ItemType Directory -Force -Path $logDir, $receiptDir | Out-Null
$log = Join-Path $logDir ("cb-battle-verify-{0}.log" -f (Get-Date -Format yyyyMMdd-HHmmss))
$alertReceipt = Join-Path $receiptDir "cb-battle-verify-alert.json"

function Write-BattleLog($message) {
  Write-Host $message
  Add-Content -LiteralPath $log -Value $message -Encoding utf8
}

function Invoke-CbFailureAlert {
  param(
    [string]$Reason,
    [int]$ExitCode = 1
  )
  $nodeExe = "C:\Program Files\nodejs\node.exe"
  if (-not (Test-Path -LiteralPath $nodeExe)) { $nodeExe = "node" }
  $env:FUMAN_ALERT_KIND = "cb-battle-verify"
  $env:FUMAN_ALERT_SOURCE = "FumanCbBattleVerify"
  $env:FUMAN_ALERT_SUBJECT = "Fuman Terminal CB battle verify failed"
  $env:FUMAN_ALERT_RECEIPT_FILE = $alertReceipt
  $tail = ""
  try { $tail = (Get-Content -LiteralPath $log -Tail 40 -ErrorAction SilentlyContinue) -join "`n" } catch {}
  $env:FUMAN_ALERT_TEXT = @"
Fuman Terminal CB battle verify failed

source: FumanCbBattleVerify
exitCode: $ExitCode
reason: $Reason
log: $log
receipt: $alertReceipt
checkedAt: $((Get-Date).ToString("o"))

tail:
$tail
"@
  Push-Location $PSScriptRoot
  try {
    & $nodeExe "--use-system-ca" "scripts\send-workflow-alert.js" "--kind=cb-battle-verify" "--receipt=$alertReceipt" *>&1 | ForEach-Object {
      Write-BattleLog "[alert] $([string]$_)"
    }
  } catch {
    Write-BattleLog "[alert] EXCEPTION $($_.Exception.Message)"
  } finally {
    Pop-Location
  }
  if ($LASTEXITCODE -ne 0) {
    Write-BattleLog "[alert] failed exit=$LASTEXITCODE receipt=$alertReceipt"
  } else {
    Write-BattleLog "[alert] sent receipt=$alertReceipt"
  }
}

. "$PSScriptRoot\schedule-guard.ps1"
Invoke-FumanWeekdayGuard -Label "CB detect battle verify" -LogPath $log

node scripts\verify-cb-battle-state.js 2>&1 | Tee-Object -FilePath $log -Append
if ($LASTEXITCODE -ne 0) {
  $exitCode = [int]$LASTEXITCODE
  Invoke-CbFailureAlert -Reason "CB detect battle verify failed; log=$log" -ExitCode $exitCode
  throw "CB detect battle verify failed with exit code $LASTEXITCODE; log=$log"
}
