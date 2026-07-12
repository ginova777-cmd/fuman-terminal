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

function Read-PropertyString($Object, $Name) {
  if ($null -eq $Object) { return "" }
  $prop = $Object.PSObject.Properties[$Name]
  if ($null -eq $prop -or $null -eq $prop.Value) { return "" }
  return [string]$prop.Value
}

function Read-PropertyBool($Object, $Name) {
  if ($null -eq $Object) { return $false }
  $prop = $Object.PSObject.Properties[$Name]
  if ($null -eq $prop -or $null -eq $prop.Value) { return $false }
  return ($prop.Value -eq $true)
}

$now = Get-TaipeiNow
$stamp = $now.ToString("yyyyMMdd-HHmmss")
$logDir = Join-Path $RuntimeRoot "logs"
$receiptDir = Join-Path $RuntimeRoot "data\scan-receipts"
$outDir = Join-Path $RuntimeRoot "outputs\strategy4-postscan-closure"
$dataChainOutDir = Join-Path $RuntimeRoot "outputs\strategy4-88-data-chain"
New-Item -ItemType Directory -Force -Path $logDir, $receiptDir, $outDir, $dataChainOutDir | Out-Null

$script:LogFile = Join-Path $logDir ("strategy4-postscan-closure-{0}.log" -f $stamp)
$receiptFile = Join-Path $receiptDir "strategy4-postscan-closure-latest.json"
$datedReceiptFile = Join-Path $receiptDir ("strategy4-postscan-closure-{0}.json" -f $stamp)
$scannerReceiptFile = Join-Path $receiptDir "strategy4.json"
$reportFile = Join-Path $outDir "strategy4-postscan-closure.json"
$dataChainReportFile = Join-Path $dataChainOutDir "strategy4-88-data-chain.json"
$startedAt = (Get-Date).ToString("o")
$status = "running"
$errorText = ""
$scannerReceipt = $null
$scannerRunId = ""
$verifierExitCode = $null
$dataChainExitCode = $null
$verifierReport = $null
$dataChainReport = $null

try {
  Write-ClosureLog "START Strategy4 postscan closure"
  Write-ClosureLog "projectRoot=$ProjectRoot productionUrl=$ProductionUrl"

  $deadline = (Get-Date).AddSeconds([Math]::Max(1, $WaitSeconds))
  while ((Get-Date) -le $deadline) {
    $scannerReceipt = Read-JsonFile $scannerReceiptFile
    $scannerRunId = (Read-PropertyString $scannerReceipt "runId")
    $scannerStatus = (Read-PropertyString $scannerReceipt "status")
    $scannerFinishedAt = (Read-PropertyString $scannerReceipt "finishedAt")
    if ($scannerRunId -and $scannerStatus -eq "complete" -and $scannerFinishedAt) {
      Write-ClosureLog "scanner receipt ready runId=$scannerRunId finishedAt=$scannerFinishedAt"
      break
    }
    Write-ClosureLog "waiting scanner receipt status=$scannerStatus runId=$scannerRunId"
    Start-Sleep -Seconds ([Math]::Max(1, $PollSeconds))
  }

  if (-not $scannerRunId) { throw "missing Strategy4 scanner runId in $scannerReceiptFile" }
  if ((Read-PropertyString $scannerReceipt "status") -ne "complete") { throw "Strategy4 scanner receipt not complete: status=$((Read-PropertyString $scannerReceipt "status"))" }

  Push-Location $ProjectRoot
  try {
    $env:FUMAN_RUNTIME_DIR = $RuntimeRoot
    $env:FUMAN_AUDIT_BASE_URL = $ProductionUrl
    Write-ClosureLog "running npm run verify:strategy4-postscan-closure"
    & npm.cmd run verify:strategy4-postscan-closure -- --out=$outDir *>&1 | Tee-Object -FilePath $script:LogFile -Append
    $verifierExitCode = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
    $env:EXPECTED_STRATEGY4_RUN_ID = $scannerRunId
    Write-ClosureLog "running npm run verify:strategy4-88-data-chain"
    & npm.cmd run verify:strategy4-88-data-chain -- --out=$dataChainOutDir *>&1 | Tee-Object -FilePath $script:LogFile -Append
    $dataChainExitCode = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
  } finally {
    Pop-Location
  }

  $verifierReport = Read-JsonFile $reportFile
  $dataChainReport = Read-JsonFile $dataChainReportFile
  $verifierRunId = (Read-PropertyString $verifierReport "runId")
  $dataChainRunId = (Read-PropertyString $dataChainReport "runId")
  if ($verifierExitCode -ne 0) { Write-ClosureLog "legacy postscan closure verifier advisory exit=$verifierExitCode" }
  if ($dataChainExitCode -ne 0) { throw "strategy4 88 data-chain verifier exit=$dataChainExitCode" }
  if (-not $dataChainReport -or $dataChainReport.ok -ne $true) { throw "strategy4 88 data-chain report not ok: $dataChainReportFile" }
  if ($dataChainRunId -ne $scannerRunId) { throw "runId mismatch scanner=$scannerRunId dataChain=$dataChainRunId" }

  $status = "complete"
  Write-ClosureLog "SUCCESS Strategy4 postscan closure runId=$scannerRunId checks=$($verifierReport.checks.Count) dataChainChecks=$($dataChainReport.checks.Count)"
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
    dataChainExitCode = $dataChainExitCode
    verifierReportPath = $reportFile
    verifierRunId = (Read-PropertyString $verifierReport "runId")
    verifierOk = ((Read-PropertyBool $verifierReport "ok"))
    dataChainReportPath = $dataChainReportFile
    dataChainRunId = (Read-PropertyString $dataChainReport "runId")
    dataChainOk = ((Read-PropertyBool $dataChainReport "ok"))
    checks = $verifierReport.checks
    dataChainChecks = $dataChainReport.checks
    error = $errorText
  }
  Write-JsonFile $receiptFile $receipt
  Write-JsonFile $datedReceiptFile $receipt
}

if ($status -ne "complete") { exit 1 }
exit 0
