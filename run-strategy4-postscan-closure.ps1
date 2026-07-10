param(
  [string]$ProjectRoot = "C:\fuman-terminal",
  [string]$RuntimeRoot = "C:\fuman-runtime",
  [string]$ProductionUrl = "https://fuman-terminal.vercel.app",
  [int]$WaitSeconds = 600,
  [int]$PollSeconds = 15
)

$ErrorActionPreference = "Stop"


# FUMAN_MARKET_CLOSED_RUNNER_GUARD_V1
. "${PSScriptRoot}\schedule-guard.ps1"
Invoke-FumanWeekdayGuard -Label "Strategy4 postscan closure"
function Get-TaipeiNow() {
  $tz = [System.TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
  return [System.TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $tz)
}

function Write-JsonFile($Path, $Payload) {
  $dir = Split-Path -Parent $Path
  if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $Payload | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $Path -Encoding utf8
}

function Write-ClosureLog($Message) {
  $line = "[{0}] {1}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm:ss"), $Message
  Write-Host $line
  Add-Content -LiteralPath $script:LogFile -Value $line -Encoding utf8
}

function Read-JsonFile($Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  try { return (Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json) } catch { return $null }
}

$now = Get-TaipeiNow
$stamp = $now.ToString("yyyyMMdd-HHmmss")
$logDir = Join-Path $RuntimeRoot "logs"
$receiptDir = Join-Path $RuntimeRoot "data\scan-receipts"
$outDir = Join-Path $RuntimeRoot "outputs\strategy4-postscan-closure"
New-Item -ItemType Directory -Force -Path $logDir, $receiptDir, $outDir | Out-Null

$script:LogFile = Join-Path $logDir ("strategy4-postscan-closure-{0}.log" -f $stamp)
$receiptFile = Join-Path $receiptDir "strategy4-postscan-closure-latest.json"
$datedReceiptFile = Join-Path $receiptDir ("strategy4-postscan-closure-{0}.json" -f $stamp)
$scannerReceiptFile = Join-Path $receiptDir "strategy4.json"
$reportFile = Join-Path $outDir "strategy4-postscan-closure.json"
$startedAt = (Get-Date).ToString("o")
$status = "running"
$errorText = ""
$scannerReceipt = $null
$scannerRunId = ""
$verifierExitCode = $null
$verifierReport = $null

try {
  Write-ClosureLog "START Strategy4 postscan closure"
  Write-ClosureLog "projectRoot=$ProjectRoot productionUrl=$ProductionUrl"

  $deadline = (Get-Date).AddSeconds([Math]::Max(1, $WaitSeconds))
  while ((Get-Date) -le $deadline) {
    $scannerReceipt = Read-JsonFile $scannerReceiptFile
    $scannerRunId = [string]($scannerReceipt.runId ?? "")
    $scannerStatus = [string]($scannerReceipt.status ?? "")
    $scannerFinishedAt = [string]($scannerReceipt.finishedAt ?? "")
    if ($scannerRunId -and $scannerStatus -eq "complete" -and $scannerFinishedAt) {
      Write-ClosureLog "scanner receipt ready runId=$scannerRunId finishedAt=$scannerFinishedAt"
      break
    }
    Write-ClosureLog "waiting scanner receipt status=$scannerStatus runId=$scannerRunId"
    Start-Sleep -Seconds ([Math]::Max(1, $PollSeconds))
  }

  if (-not $scannerRunId) { throw "missing Strategy4 scanner runId in $scannerReceiptFile" }
  if ([string]($scannerReceipt.status ?? "") -ne "complete") { throw "Strategy4 scanner receipt not complete: status=$($scannerReceipt.status)" }

  Push-Location $ProjectRoot
  try {
    $env:FUMAN_RUNTIME_DIR = $RuntimeRoot
    $env:FUMAN_AUDIT_BASE_URL = $ProductionUrl
    Write-ClosureLog "running npm run verify:strategy4-postscan-closure"
    & npm.cmd run verify:strategy4-postscan-closure -- --out=$outDir *>&1 | Tee-Object -FilePath $script:LogFile -Append
    $verifierExitCode = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
  } finally {
    Pop-Location
  }

  $verifierReport = Read-JsonFile $reportFile
  $verifierRunId = [string]($verifierReport.runId ?? "")
  if ($verifierExitCode -ne 0) { throw "postscan closure verifier exit=$verifierExitCode" }
  if (-not $verifierReport -or $verifierReport.ok -ne $true) { throw "postscan closure report not ok: $reportFile" }
  if ($verifierRunId -ne $scannerRunId) { throw "runId mismatch scanner=$scannerRunId verifier=$verifierRunId" }

  $status = "complete"
  Write-ClosureLog "SUCCESS Strategy4 postscan closure runId=$scannerRunId checks=$($verifierReport.checks.Count)"
} catch {
  $status = "failed"
  $errorText = $_.Exception.Message
  Write-ClosureLog "FAILED Strategy4 postscan closure: $errorText"
} finally {
  $receipt = [ordered]@{
    ok = ($status -eq "complete")
    status = $status
    source = "strategy4-postscan-closure"
    startedAt = $startedAt
    finishedAt = (Get-Date).ToString("o")
    projectRoot = $ProjectRoot
    runtimeRoot = $RuntimeRoot
    productionUrl = $ProductionUrl
    log = $script:LogFile
    scannerReceiptPath = $scannerReceiptFile
    scannerRunId = $scannerRunId
    scannerReceipt = $scannerReceipt
    verifierExitCode = $verifierExitCode
    verifierReportPath = $reportFile
    verifierRunId = [string]($verifierReport.runId ?? "")
    verifierOk = ($verifierReport.ok -eq $true)
    checks = $verifierReport.checks
    error = $errorText
  }
  Write-JsonFile $receiptFile $receipt
  Write-JsonFile $datedReceiptFile $receipt
}

if ($status -ne "complete") { exit 1 }
exit 0
