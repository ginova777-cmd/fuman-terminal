param(
  [string]$StartTime = "08:00",
  [string]$UntilTime = "09:10",
  [int]$IntervalSeconds = 60,
  [switch]$Once,
  [switch]$FailOnCritical
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

$repoRoot = $PSScriptRoot
$runtimeRoot = if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }
$stateFile = Join-Path $runtimeRoot "state\strategy2-supabase-coverage.json"
$nodeScript = Join-Path $repoRoot "scripts\check-strategy2-supabase-coverage.js"
$nodeExe = "C:\Program Files\nodejs\node.exe"

function Convert-ToTodayTime([string]$timeText) {
  if ($timeText -notmatch "^(\d{1,2}):(\d{2})$") {
    throw "Invalid time format: $timeText. Use HH:mm."
  }
  $now = Get-Date
  return Get-Date -Year $now.Year -Month $now.Month -Day $now.Day -Hour ([int]$Matches[1]) -Minute ([int]$Matches[2]) -Second 0
}

function Format-Number($value, [int]$digits = 2) {
  $number = 0.0
  if (-not [double]::TryParse([string]$value, [ref]$number)) { return "--" }
  return $number.ToString("N$digits")
}

function Format-Percent($value) {
  $number = 0.0
  if (-not [double]::TryParse([string]$value, [ref]$number)) { return "--" }
  return ($number * 100).ToString("N1") + "%"
}

function Read-CoveragePayload {
  if (-not (Test-Path -LiteralPath $stateFile)) { return $null }
  try {
    return Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json -ErrorAction Stop
  } catch {
    return $null
  }
}

function Get-Rate($current, $previous, [double]$minutes) {
  if (-not $previous -or $minutes -le 0) { return "--/m" }
  $nowNumber = 0.0
  $prevNumber = 0.0
  if (-not [double]::TryParse([string]$current, [ref]$nowNumber)) { return "--/m" }
  if (-not [double]::TryParse([string]$previous, [ref]$prevNumber)) { return "--/m" }
  $rate = ($nowNumber - $prevNumber) / $minutes
  return ($rate.ToString("N1") + "/m")
}

function Invoke-CoverageCheck {
  Push-Location $repoRoot
  try {
    $args = @("--use-system-ca", $nodeScript)
    if ($FailOnCritical) { $args += "--fail-on-critical" }
    & $nodeExe @args | ForEach-Object { Write-Host $_ }
    return $LASTEXITCODE
  } finally {
    Pop-Location
  }
}

function Show-CoverageStatus($payload, $previousPayload) {
  if (-not $payload) {
    Write-Host "覆蓋率狀態尚未準備 / coverage payload not ready: $stateFile" -ForegroundColor Yellow
    return
  }

  $coverage = $payload.coverage
  $previousCoverage = if ($previousPayload) { $previousPayload.coverage } else { $null }
  $checkedAt = if ($payload.checkedAtTaipei) { $payload.checkedAtTaipei } else { (Get-Date).ToString("yyyy-MM-dd HH:mm:ss") }
  $previousAt = if ($previousPayload -and $previousPayload.checkedAt) { [datetime]$previousPayload.checkedAt } else { $null }
  $currentAt = if ($payload.checkedAt) { [datetime]$payload.checkedAt } else { Get-Date }
  $minutes = if ($previousAt) { [math]::Max(0.001, ($currentAt - $previousAt).TotalMinutes) } else { 0 }
  $criticalCount = @($payload.issues | Where-Object { $_.severity -eq "critical" }).Count
  $warningCount = @($payload.issues | Where-Object { $_.severity -eq "warning" }).Count

  Write-Host ""
  Write-Host "策略2 Supabase / 富果資料覆蓋率 / Strategy2 Supabase-Fugle Coverage @ $checkedAt" -ForegroundColor Cyan
  Write-Host ("狀態 / Status: {0}  嚴重 / critical={1}  警告 / warning={2}" -f ($(if ($payload.ok) { "正常 OK" } else { "異常 NOT OK" }), $criticalCount, $warningCount)) -ForegroundColor $(if ($payload.ok) { "Green" } else { "Red" })
  Write-Host ("即時報價 / quotes       筆數 count={0} 有效 active={1} 覆蓋率 coverage={2} 延遲 age={3}s  更新率 progress={4}" -f `
    $coverage.quoteCount, `
    $coverage.activeCommonStockQuotes, `
    (Format-Percent $coverage.quoteCoverageRatio), `
    $coverage.quoteAgeSeconds, `
    (Get-Rate $coverage.quoteCount $previousCoverage.quoteCount $minutes))
  Write-Host ("1分K / 1m candles        已準備 ready={0} 今日筆數 todayRows={1} 最新 latest={2}  更新率 progress={3}" -f `
    $coverage.intraday1mReadyRows, `
    $coverage.intraday1mRowsToday, `
    ($(if ($coverage.latestCandleTime) { $coverage.latestCandleTime } else { "--" })), `
    (Get-Rate $coverage.intraday1mReadyRows $previousCoverage.intraday1mReadyRows $minutes))
  Write-Host ("5日均量 / daily volume   筆數 rows={0} 覆蓋率 coverage={1}  更新率 progress={2}" -f `
    $coverage.dailyVolumeRows, `
    (Format-Percent $coverage.dailyVolumeCoverage), `
    (Get-Rate $coverage.dailyVolumeRows $previousCoverage.dailyVolumeRows $minutes))
  Write-Host ("盤前試撮 / preopen       筆數 rows={0} FinalBlindBuy={1}  更新率 progress={2}" -f `
    $coverage.preopenRows, `
    $coverage.finalBlindBuyRows, `
    (Get-Rate $coverage.preopenRows $previousCoverage.preopenRows $minutes))
  Write-Host ("股票期貨 / futopt        對應 mapping={0} 報價 quotes={1}  更新率 progress={2}" -f `
    $coverage.futoptMappingRows, `
    $coverage.futoptQuoteRows, `
    (Get-Rate $coverage.futoptQuoteRows $previousCoverage.futoptQuoteRows $minutes))

  if ($payload.issues -and @($payload.issues).Count) {
    Write-Host "問題 / issues:" -ForegroundColor Yellow
    foreach ($issue in @($payload.issues | Select-Object -First 8)) {
      $color = if ($issue.severity -eq "critical") { "Red" } else { "Yellow" }
      Write-Host ("- [{0}] {1}: {2}" -f $issue.severity, $issue.id, $issue.message) -ForegroundColor $color
    }
  }

  Write-Host ("狀態檔 / state: {0}" -f $stateFile) -ForegroundColor DarkGray
  if ($payload.logFile) { Write-Host ("紀錄檔 / log:   {0}" -f $payload.logFile) -ForegroundColor DarkGray }
}

$startAt = Convert-ToTodayTime $StartTime
$untilAt = Convert-ToTodayTime $UntilTime
if ($untilAt -le $startAt) { $untilAt = $untilAt.AddDays(1) }

if (-not (Test-Path -LiteralPath $nodeScript)) {
  throw "找不到覆蓋率檢查程式 / Missing coverage checker: $nodeScript"
}
if (-not (Test-Path -LiteralPath $nodeExe)) {
  throw "找不到 node.exe / Missing node.exe: $nodeExe"
}

Set-Location -LiteralPath $repoRoot

if (-not $Once -and (Get-Date) -lt $startAt) {
  Write-Host ("等待到 {0} 開始策略2 Supabase / 富果覆蓋率監控 / Waiting to start Strategy2 coverage watch..." -f $startAt.ToString("yyyy-MM-dd HH:mm:ss")) -ForegroundColor Cyan
  while ((Get-Date) -lt $startAt) {
    $remaining = [math]::Max(1, [int](($startAt - (Get-Date)).TotalSeconds))
    Start-Sleep -Seconds ([math]::Min(60, $remaining))
  }
}

$previousPayload = $null
do {
  $exitCode = Invoke-CoverageCheck
  $payload = Read-CoveragePayload
  Show-CoverageStatus $payload $previousPayload
  $previousPayload = $payload

  if ($Once) { break }
  if ((Get-Date) -ge $untilAt) { break }
  Start-Sleep -Seconds ([math]::Max(5, $IntervalSeconds))
} while ($true)

if ($FailOnCritical -and $payload -and -not $payload.ok) {
  exit 1
}
exit 0
