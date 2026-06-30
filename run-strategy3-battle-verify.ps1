$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
Set-Location -LiteralPath "C:\fuman-terminal"

$env:FUMAN_RUNTIME_DIR = if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }
$logDir = Join-Path $env:FUMAN_RUNTIME_DIR "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("strategy3-battle-verify-{0}.log" -f (Get-Date -Format yyyyMMdd-HHmmss))
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

$verify = Invoke-Strategy3BattleStateVerify "initial"
if ($verify.ExitCode -ne 0) {
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
