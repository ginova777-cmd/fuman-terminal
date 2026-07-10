$ErrorActionPreference = "Stop"

# FUMAN_MARKET_CLOSED_RUNNER_GUARD_V1
. "${PSScriptRoot}\schedule-guard.ps1"
Invoke-FumanWeekdayGuard -Label "Chip source sync"
$PSNativeCommandUseErrorActionPreference = $false

$runtime = if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }
$env:FUMAN_RUNTIME_DIR = $runtime
$env:FUMAN_DATA_DIR = Join-Path $runtime "data"
$env:FUMAN_CACHE_DIR = Join-Path $runtime "cache"
$env:FUMAN_STATE_DIR = Join-Path $runtime "state"
$env:NODE_OPTIONS = "--use-system-ca"

$logDir = Join-Path $runtime "logs"
$receiptDir = Join-Path $env:FUMAN_DATA_DIR "scan-receipts"
New-Item -ItemType Directory -Force -Path $logDir, $receiptDir | Out-Null
$log = Join-Path $logDir ("chip-source-sync-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
$startedAt = (Get-Date).ToString("o")

function Write-Log($message) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $message
  Write-Host $line
  Add-Content -LiteralPath $log -Value $line -Encoding utf8
}

function Invoke-NpmScript($Label, $ScriptName) {
  Write-Log "START $Label"
  Push-Location $PSScriptRoot
  try {
    npm run $ScriptName *>&1 | ForEach-Object {
      $text = [string]$_
      Write-Host $text
      Add-Content -LiteralPath $log -Value $text -Encoding utf8
    }
    $exitCode = $LASTEXITCODE
  } finally {
    Pop-Location
  }
  Write-Log "END $Label exit=$exitCode"
  return $exitCode
}

function Write-Receipt($Status, $ExitCode, $Warnings = @()) {
  $receipt = [ordered]@{
    strategy = "chip-source-sync"
    label = "FinMind plus official chip source sync"
    tier = "critical"
    startedAt = $startedAt
    finishedAt = (Get-Date).ToString("o")
    status = $Status
    exitCode = $ExitCode
    complete = ($Status -eq "complete")
    fallback = $false
    source = "finmind-first-official-gap-fill"
    payloadPath = "supabase:finmind_institutional_flows,finmind_margin_short,v_chip_flows_latest"
    warnings = @($Warnings)
    log = $log
  }
  $receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $receiptDir "chip-source-sync.json") -Encoding utf8
}

Write-Log "Chip source sync started"
$finmindExit = Invoke-NpmScript "FinMind chip sync" "sync:finmind:chip"
if ($finmindExit -ne 0) {
  Write-Log "FinMind chip sync failed; continuing to official source gap fill"
}
$officialExit = Invoke-NpmScript "TWSE/TPEx official chip gap fill" "sync:official:chip"
$healthExit = Invoke-NpmScript "chip source health verification" "verify:chip-source"

$warnings = @()
if ($finmindExit -ne 0) { $warnings += "FinMind chip sync exit=$finmindExit; official source was attempted" }
if ($officialExit -ne 0) { $warnings += "official chip sync exit=$officialExit" }
if ($healthExit -ne 0) { $warnings += "chip source health verification exit=$healthExit" }

if ($officialExit -eq 0 -and $healthExit -eq 0) {
  Write-Receipt "complete" 0 $warnings
  Write-Log "SUCCESS chip source sync completed"
  exit 0
}

$exitCode = if ($healthExit -ne 0) { $healthExit } elseif ($officialExit -ne 0) { $officialExit } else { 1 }
Write-Receipt "failed" $exitCode $warnings
Write-Log "FAILED chip source sync exit=$exitCode"
exit $exitCode
