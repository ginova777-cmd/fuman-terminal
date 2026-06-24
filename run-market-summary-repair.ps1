$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

Set-Location "${PSScriptRoot}"
$env:FUMAN_RUNTIME_DIR = "C:\fuman-runtime"
$env:FUMAN_DATA_DIR = "C:\fuman-runtime\data"
$env:FUMAN_CACHE_DIR = "C:\fuman-runtime\cache"
$env:FUMAN_STATE_DIR = "C:\fuman-runtime\state"
$env:NODE_OPTIONS = "--use-system-ca"

$runtimeDir = "C:\fuman-runtime"
$codeRepo = "${PSScriptRoot}"
$syncRepo = if ($env:FUMAN_PUBLISH_SYNC_REPO) { $env:FUMAN_PUBLISH_SYNC_REPO } else { "C:\fuman-terminal" }
$nodeExe = "C:\Program Files\nodejs\node.exe"
$gitExe = "C:\Program Files\Git\cmd\git.exe"
$logDir = Join-Path $runtimeDir "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("market-summary-repair-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))

function Write-RepairLog($message) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $message
  Write-Host $line
  Add-Content -LiteralPath $log -Value $line -Encoding utf8
}

function Invoke-NodeStep($label, $script, [switch]$Required) {
  Write-RepairLog "=== $label ==="
  $output = & $nodeExe $script 2>&1
  foreach ($line in $output) {
    if (-not [string]::IsNullOrWhiteSpace([string]$line)) { Write-RepairLog $line }
  }
  $exit = $LASTEXITCODE
  if ($exit -ne 0 -and $Required) { throw "$label failed with exit code $exit" }
  return $exit
}

function Invoke-Git($label, $arguments) {
  Write-RepairLog "=== $label ==="
  $output = & $gitExe -C $syncRepo @arguments 2>&1
  foreach ($line in $output) {
    if (-not [string]::IsNullOrWhiteSpace([string]$line)) { Write-RepairLog $line }
  }
  if ($LASTEXITCODE -ne 0) { throw "$label failed with exit code $LASTEXITCODE" }
}

function Assert-MarketSummaryFresh($path) {
  if (-not (Test-Path -LiteralPath $path)) { throw "missing market summary: $path" }
  $json = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
  $today = Get-Date -Format "yyyyMMdd"
  if ([string]$json.resolvedTradeDate -ne $today -or $json.isFallbackDate -eq $true -or [int]$json.stockCount -lt 1500) {
    throw "market summary stale or incomplete: resolvedTradeDate=$($json.resolvedTradeDate) today=$today isFallbackDate=$($json.isFallbackDate) stockCount=$($json.stockCount)"
  }
}

Write-RepairLog "market summary repair start"

$repairWindowStart = if ($env:MARKET_SUMMARY_REPAIR_START_MINUTES -match '^\d+$') { [int]$env:MARKET_SUMMARY_REPAIR_START_MINUTES } else { 14 * 60 }
$now = Get-Date
$minuteOfDay = ($now.Hour * 60) + $now.Minute
if ($env:MARKET_SUMMARY_REPAIR_ALLOW_EARLY -ne "1" -and $minuteOfDay -lt $repairWindowStart) {
  Write-RepairLog "market summary repair skipped before repair window: now=$($now.ToString('HH:mm')) startMinute=$repairWindowStart"
  exit 0
}

Invoke-NodeStep "Generate full stocks slim" "scripts\generate-stocks-slim.js" -Required | Out-Null

$attempts = if ($env:MARKET_SUMMARY_REPAIR_ATTEMPTS -match '^\d+$') { [int]$env:MARKET_SUMMARY_REPAIR_ATTEMPTS } else { 10 }
$delaySeconds = if ($env:MARKET_SUMMARY_REPAIR_RETRY_SECONDS -match '^\d+$') { [int]$env:MARKET_SUMMARY_REPAIR_RETRY_SECONDS } else { 300 }
$summaryOk = $false
for ($attempt = 1; $attempt -le $attempts; $attempt++) {
  $exit = Invoke-NodeStep "Generate market summary attempt $attempt/$attempts" "scripts\generate-market-summary.js"
  if ($exit -eq 0) {
    try {
      Assert-MarketSummaryFresh (Join-Path $runtimeDir "data\market-summary.json")
      $summaryOk = $true
      break
    } catch {
      Write-RepairLog $_.Exception.Message
    }
  }
  if ($attempt -lt $attempts) { Start-Sleep -Seconds $delaySeconds }
}
if (-not $summaryOk) { throw "market summary repair failed after $attempts attempts" }

Invoke-NodeStep "Generate slim cache / manifest" "scripts\generate-slim-cache.js" -Required | Out-Null
Assert-MarketSummaryFresh (Join-Path $runtimeDir "data\market-summary.json")

Invoke-Git "Fetch origin main" @("fetch", "origin", "main")
Invoke-Git "Reset sync repo" @("reset", "--hard", "origin/main")
Invoke-Git "Clean sync repo" @("clean", "-fd")

$files = @(
  "data\market-summary.json",
  "data\mobile-home-summary.json",
  "data\terminal-home-bundle.json",
  "data\data-status-index.json",
  "data\data-manifest.json",
  "data\stocks-slim.json",
  "data\stocks-index.json",
  "data\stocks-quotes-slim.json",
  "data\stocks-quotes-mobile-top.json"
)
foreach ($file in $files) {
  $source = Join-Path $runtimeDir $file
  $target = Join-Path $syncRepo $file
  if (-not (Test-Path -LiteralPath $source)) { throw "missing source file: $source" }
  New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
  Copy-Item -LiteralPath $source -Destination $target -Force
}

$gitFiles = $files | ForEach-Object { $_ -replace '\\', '/' }
Invoke-Git "Stage market summary files" (@("add", "-f", "--") + $gitFiles)
$changed = & $gitExe -C $syncRepo diff --cached --name-only -- $gitFiles
if ($changed) {
  $stamp = Get-Date -Format "yyyy-MM-dd HH:mm"
  Invoke-Git "Commit market summary files" @("commit", "-m", "Refresh market overview $stamp")
  Invoke-Git "Push market summary commit" @("push", "origin", "main")
} else {
  Write-RepairLog "No market summary changes to publish."
}

$baseUrl = if ($env:FUMAN_VERCEL_BASE_URL) { $env:FUMAN_VERCEL_BASE_URL.TrimEnd('/') } else { "https://fuman-terminal.vercel.app" }
$url = "$baseUrl/data/market-summary.json?v=repair-$(Get-Date -Format yyyyMMddHHmmss)"
Write-RepairLog "=== Verify online market summary ==="
$response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 30
$remote = $response.Content | ConvertFrom-Json
$todayKey = Get-Date -Format "yyyyMMdd"
if ([string]$remote.resolvedTradeDate -ne $todayKey -or $remote.isFallbackDate -eq $true) {
  throw "online market summary stale: resolvedTradeDate=$($remote.resolvedTradeDate) today=$todayKey isFallbackDate=$($remote.isFallbackDate)"
}
Write-RepairLog "online market summary ok: resolvedTradeDate=$($remote.resolvedTradeDate) stockCount=$($remote.stockCount) updatedAt=$($remote.updatedAt)"
Write-RepairLog "market summary repair end"
