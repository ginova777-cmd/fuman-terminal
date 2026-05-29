$ErrorActionPreference = "Stop"
Set-Location "C:\fuman-terminal"
$env:FUMAN_RUNTIME_DIR = "C:\fuman-runtime"
$env:FUMAN_DATA_DIR = "C:\fuman-runtime\data"
$env:FUMAN_CACHE_DIR = "C:\fuman-runtime\cache"
$env:FUMAN_STATE_DIR = "C:\fuman-runtime\state"
$env:GOOGLE_SHEET_ID = "1UCpEBXmOWNA57eLXH62WffnPrflly6OwmDm242JYhp8"
$env:NODE_OPTIONS = "--use-system-ca"
$env:ALLOW_LEGACY_RADAR_QUOTES = "0"
$nodeExe = "C:\Program Files\nodejs\node.exe"
$reportDir = "C:\Users\ginov\OneDrive\Desktop\回測報告"

[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$dateArg = [string](@($args | Where-Object { [string]$_ -match '^\d{8}$|^\d{4}-\d{2}-\d{2}$' } | Select-Object -First 1)[0])
$backtestArg = $null
$stamp = $null
if ($dateArg -match '^\d{8}$') {
  $backtestArg = "{0}-{1}-{2}" -f $dateArg.Substring(0, 4), $dateArg.Substring(4, 2), $dateArg.Substring(6, 2)
  $stamp = $dateArg
} elseif ($dateArg) {
  $backtestArg = $dateArg
  $stamp = $dateArg -replace '-', ''
} else {
  $latestTrade = Get-ChildItem -LiteralPath $reportDir -Filter "backtest-trades-*.csv" -ErrorAction SilentlyContinue |
    Sort-Object Name |
    Select-Object -Last 1
  if ($latestTrade -and $latestTrade.Name -match '(\d{8})') {
    $stamp = $Matches[1]
    $backtestArg = "{0}-{1}-{2}" -f $stamp.Substring(0, 4), $stamp.Substring(4, 2), $stamp.Substring(6, 2)
  }
}

$forceBacktest = @($args | Where-Object { [string]$_ -in @("--rebuild-backtest", "-RebuildBacktest") }).Count -gt 0
$missingBacktest = $true
if ($stamp) {
  $requiredFiles = @(
    Join-Path $reportDir "backtest-trades-$stamp.csv"
    Join-Path $reportDir "backtest-radar-$stamp.csv"
    Join-Path $reportDir "backtest-strategy2-manager-radar-$stamp.json"
  )
  $missingBacktest = @($requiredFiles | Where-Object { -not (Test-Path -LiteralPath $_) }).Count -gt 0
}

if ($forceBacktest -or $missingBacktest) {
  if (-not $forceBacktest) {
    Write-Host "Backtest files missing; rebuilding before upload."
  }
  elseif ($forceBacktest) {
    Write-Host "Rebuilding backtest because --rebuild-backtest was requested."
  }
  if ($backtestArg) {
    & $nodeExe "scripts\backtest-strategy2-manager-radar.js" $backtestArg
  } else {
    & $nodeExe "scripts\backtest-strategy2-manager-radar.js"
  }
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
  Write-Host "Using existing backtest files for $stamp; not rebuilding radar."
}

& $nodeExe "scripts\upload-backtest-to-google-sheet.js" @args
exit $LASTEXITCODE
