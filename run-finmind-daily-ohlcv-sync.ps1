param(
  [string]$StartDate = "",
  [string]$EndDate = "",
  [int]$MinCoverage = 1500
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
Set-Location -LiteralPath $PSScriptRoot
$runtime = if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }
$env:FUMAN_RUNTIME_DIR = $runtime
$nodeExe = "C:\Program Files\nodejs\node.exe"
if (-not (Test-Path -LiteralPath $nodeExe)) { $nodeExe = "node.exe" }
$receiptDir = Join-Path $runtime "data\scan-receipts"
$logDir = Join-Path $runtime "logs"
New-Item -ItemType Directory -Force -Path $receiptDir, $logDir | Out-Null
$receiptPath = Join-Path $receiptDir "finmind-daily-ohlcv-sync.json"
$logPath = Join-Path $logDir ("finmind-daily-ohlcv-sync-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
$startedAt = (Get-Date).ToString("o")

function Normalize-FinMindDate([string]$Value) {
  $digits = ([string]$Value -replace "[^0-9]", "")
  if ($digits.Length -ne 8) { return "" }
  return "{0}-{1}-{2}" -f $digits.Substring(0, 4), $digits.Substring(4, 2), $digits.Substring(6, 2)
}

function Write-FinMindReceipt([string]$Status, [int]$ExitCode, [bool]$Complete, [string]$Reason, $SyncPayload = $null, $HealthPayload = $null) {
  $warnings = @()
  if (-not [string]::IsNullOrWhiteSpace($Reason)) { $warnings += $Reason }
  $receipt = [ordered]@{
    contract = "finmind-daily-ohlcv-sync-receipt-v1"
    strategy = "finmind-daily-ohlcv"
    label = "FinMind daily OHLCV source sync"
    startedAt = $startedAt
    finishedAt = (Get-Date).ToString("o")
    status = $Status
    exitCode = $ExitCode
    complete = $Complete
    qualityStatus = if ($Complete) { "complete" } else { "incomplete" }
    fallback = $false
    source = "finmind:TaiwanStockPrice"
    sourceDate = $targetDate
    startDate = $effectiveStartDate
    endDate = $targetDate
    rowCount = [int]($HealthPayload.rowCount ?? 0)
    minCoverage = $MinCoverage
    written = [int]($SyncPayload.written ?? 0)
    warnings = @($warnings)
    blockingReason = $Reason
    log = $logPath
  }
  $receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $receiptPath -Encoding utf8
}

$requestedTarget = @(
  $EndDate,
  $env:FUMAN_SCANNER_TARGET_DATE,
  $env:FUMAN_SCANNER_TARGET_TRADE_DATE,
  $env:FUMAN_TERMINAL_TARGET_TRADE_DATE,
  $env:FUMAN_EXPECTED_DATE
) | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } | Select-Object -First 1
$targetDate = Normalize-FinMindDate ([string]$requestedTarget)
if (-not $targetDate) { $targetDate = (Get-Date).ToString("yyyy-MM-dd") }

$effectiveStartDate = Normalize-FinMindDate $StartDate
if (-not $effectiveStartDate -and (Test-Path -LiteralPath $receiptPath)) {
  try {
    $previous = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
    $previousDate = Normalize-FinMindDate ([string]$previous.sourceDate)
    if ($previous.complete -eq $true -and $previousDate) {
      $effectiveStartDate = ([datetime]::ParseExact($previousDate, "yyyy-MM-dd", $null)).AddDays(-3).ToString("yyyy-MM-dd")
    }
  } catch {
    Add-Content -LiteralPath $logPath -Encoding utf8 -Value "previous receipt ignored: $($_.Exception.Message)"
  }
}
if (-not $effectiveStartDate) { $effectiveStartDate = (Get-Date).AddDays(-35).ToString("yyyy-MM-dd") }

. "$PSScriptRoot\schedule-guard.ps1"
Invoke-FumanWeekdayGuard -Label "FinMind daily OHLCV sync" -LogPath $logPath -AllowAfterFormalSourceWindow

Add-Content -LiteralPath $logPath -Encoding utf8 -Value "FinMind daily OHLCV sync start=$effectiveStartDate end=$targetDate"
$syncOutput = @(& $nodeExe "--use-system-ca" "scripts\sync-finmind-daily-ohlcv.js" "--start=$effectiveStartDate" "--end=$targetDate" 2>&1)
$syncExit = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } else { 0 }
$syncOutput | ForEach-Object { Add-Content -LiteralPath $logPath -Encoding utf8 -Value ([string]$_) }
$syncPayload = $null
foreach ($line in @($syncOutput | Select-Object -Last 10)) {
  try { $syncPayload = ([string]$line) | ConvertFrom-Json } catch { }
}
if ($syncExit -ne 0 -or $syncPayload.ok -ne $true) {
  $reason = "FinMind daily sync failed exit=$syncExit"
  Write-FinMindReceipt "failed" $(if ($syncExit -ne 0) { $syncExit } else { 1 }) $false $reason $syncPayload $null
  throw $reason
}

$healthOutput = @(& $nodeExe "--use-system-ca" "scripts\verify-finmind-daily-ohlcv-sync.js" "--target-date=$targetDate" "--min-count=$MinCoverage" 2>&1)
$healthExit = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } else { 0 }
$healthOutput | ForEach-Object { Add-Content -LiteralPath $logPath -Encoding utf8 -Value ([string]$_) }
$healthPayload = $null
try { $healthPayload = (($healthOutput | Out-String).Trim() | ConvertFrom-Json) } catch { }
if ($healthExit -ne 0 -or $healthPayload.ok -ne $true) {
  $reason = "FinMind daily source health failed exit=$healthExit target=$targetDate"
  Write-FinMindReceipt "failed" $(if ($healthExit -ne 0) { $healthExit } else { 1 }) $false $reason $syncPayload $healthPayload
  throw $reason
}

Write-FinMindReceipt "complete" 0 $true "" $syncPayload $healthPayload
Write-Host "FinMind daily OHLCV complete target=$targetDate rows=$($healthPayload.rowCount) written=$($syncPayload.written)"
