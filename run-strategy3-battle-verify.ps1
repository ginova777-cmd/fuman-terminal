$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
Set-Location -LiteralPath "C:\fuman-terminal"

$env:FUMAN_RUNTIME_DIR = if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }
$logDir = Join-Path $env:FUMAN_RUNTIME_DIR "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("strategy3-battle-verify-{0}.log" -f (Get-Date -Format yyyyMMdd-HHmmss))
$alertReceipt = Join-Path $env:FUMAN_RUNTIME_DIR "data\scan-receipts\strategy3-battle-verify-alert.json"
$nodeExe = if (Test-Path -LiteralPath "C:\Program Files\nodejs\node.exe") { "C:\Program Files\nodejs\node.exe" } else { "node" }
$pwshExe = if (Test-Path -LiteralPath "C:\Program Files\PowerShell\7\pwsh.exe") { "C:\Program Files\PowerShell\7\pwsh.exe" } else { "pwsh" }

. "$PSScriptRoot\schedule-guard.ps1"
Invoke-FumanWeekdayGuard -Label "Strategy3 battle verify" -LogPath $log

function Invoke-Strategy3BattleStateVerify($Label) {
  Add-Content -LiteralPath $log -Encoding utf8 -Value "[$(Get-Date -Format o)] Strategy3 battle verify $Label start"
  $output = (& $nodeExe "scripts\verify-strategy3-battle-state.js" 2>&1) -join "`n"
  $exitCode = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } else { 0 }
  if ($output) {
    Write-Host $output
    Add-Content -LiteralPath $log -Encoding utf8 -Value $output
  }
  Add-Content -LiteralPath $log -Encoding utf8 -Value "[$(Get-Date -Format o)] Strategy3 battle verify $Label exit=$exitCode"
  return [pscustomobject]@{ ExitCode = $exitCode; Output = $output }
}

function Invoke-Strategy3FailureAlert($Reason, $TailText) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $alertReceipt) | Out-Null
  $env:FUMAN_ALERT_KIND = "strategy3-battle-verify"
  $env:FUMAN_ALERT_SOURCE = "FumanStrategy3BattleVerify1305"
  $env:FUMAN_ALERT_SUBJECT = "Fuman Strategy3 battle verify failed"
  $env:FUMAN_ALERT_RECEIPT_FILE = $alertReceipt
  $env:FUMAN_ALERT_TEXT = @"
Fuman Strategy3 battle verify failed

source: FumanStrategy3BattleVerify1305
reason: $Reason
log: $log
checkedAt: $((Get-Date).ToString("o"))

tail:
$TailText
"@
  try {
    $alertOutput = (& $nodeExe "--use-system-ca" "scripts\send-workflow-alert.js" "--kind=strategy3-battle-verify" "--receipt=$alertReceipt" 2>&1) -join "`n"
    $alertExitCode = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } else { 0 }
    if ($alertOutput) {
      Add-Content -LiteralPath $log -Encoding utf8 -Value "[alert] $alertOutput"
    }
    Add-Content -LiteralPath $log -Encoding utf8 -Value "[$(Get-Date -Format o)] Strategy3 Gmail alert exit=$alertExitCode receipt=$alertReceipt"
    return [pscustomobject]@{ Ok = ($alertExitCode -eq 0); ExitCode = $alertExitCode; Receipt = $alertReceipt; Output = $alertOutput }
  } catch {
    Add-Content -LiteralPath $log -Encoding utf8 -Value "[$(Get-Date -Format o)] Strategy3 Gmail alert exception: $($_.Exception.Message)"
    return [pscustomobject]@{ Ok = $false; ExitCode = 1; Receipt = $alertReceipt; Output = $_.Exception.Message }
  }
}

try {
  $verify = Invoke-Strategy3BattleStateVerify "initial"
  if ($verify.ExitCode -ne 0) {
    $controlledSourceNotReady = $verify.Output -match "sourceCoverage_not_ready|liveSourceChain|session1m|source not ready|source drift failed"
    if ($controlledSourceNotReady) {
      Add-Content -LiteralPath $log -Encoding utf8 -Value "[$(Get-Date -Format o)] Strategy3 battle verify source not ready; preserve latest complete run and do not publish."
      exit 0
    }
    $repairable = $verify.Output -match "live_source_chain_tv_drift_api_|api_count_0|api_runId_.*does_not_match|publishedSelfTest_not_ok|result_exact_count_.*does_not_match"
    if (-not $repairable) {
      throw "Strategy3 battle verify failed with exit code $($verify.ExitCode); log=$log"
    }

    Add-Content -LiteralPath $log -Encoding utf8 -Value "[$(Get-Date -Format o)] Strategy3 battle verify detected repairable drift; running complete scan once"
    $scanOutput = (& $pwshExe -NoProfile -ExecutionPolicy Bypass -File "$PSScriptRoot\run-strategy3-complete-scan.ps1" 2>&1) -join "`n"
    $scanExitCode = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } else { 0 }
    if ($scanOutput) {
      Write-Host $scanOutput
      Add-Content -LiteralPath $log -Encoding utf8 -Value $scanOutput
    }
    if ($scanExitCode -ne 0) {
      throw "Strategy3 battle self-repair complete scan failed with exit code $scanExitCode; log=$log"
    }

    $verify = Invoke-Strategy3BattleStateVerify "post-repair"
    if ($verify.ExitCode -ne 0) {
      throw "Strategy3 battle verify failed after self-repair with exit code $($verify.ExitCode); log=$log"
    }
  }
} catch {
  $reason = $_.Exception.Message
  Add-Content -LiteralPath $log -Encoding utf8 -Value "[$(Get-Date -Format o)] Strategy3 battle verify failed: $reason"
  $tail = (Get-Content -LiteralPath $log -Tail 80 -ErrorAction SilentlyContinue) -join "`n"
  [void](Invoke-Strategy3FailureAlert $reason $tail)
  throw
}
