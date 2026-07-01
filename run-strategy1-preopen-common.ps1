param(
  [ValidateSet("Prepare", "Final", "Watch")]
  [string]$Mode = "Prepare"
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

. "${PSScriptRoot}\legacy-entrypoint-guard.ps1" -Label "run-strategy1-preopen-common.ps1"

Set-Location "${PSScriptRoot}"

$runtime = if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }
$env:FUMAN_RUNTIME_DIR = $runtime
$env:FUMAN_DATA_DIR = if ($env:FUMAN_DATA_DIR) { $env:FUMAN_DATA_DIR } else { Join-Path $runtime "data" }
$env:FUMAN_CACHE_DIR = if ($env:FUMAN_CACHE_DIR) { $env:FUMAN_CACHE_DIR } else { Join-Path $runtime "cache" }
$env:FUMAN_STATE_DIR = if ($env:FUMAN_STATE_DIR) { $env:FUMAN_STATE_DIR } else { Join-Path $runtime "state" }
$env:NODE_OPTIONS = "--use-system-ca"

$nodeExe = "C:\Program Files\nodejs\node.exe"
$logsDir = Join-Path $runtime "logs"
$receiptDir = Join-Path $env:FUMAN_DATA_DIR "scan-receipts"
New-Item -ItemType Directory -Force -Path $logsDir, $receiptDir, $env:FUMAN_CACHE_DIR, $env:FUMAN_STATE_DIR | Out-Null

$safeMode = $Mode.ToLowerInvariant()
$log = Join-Path $logsDir ("strategy1-preopen-{0}-{1}.log" -f $safeMode, (Get-Date -Format yyyyMMdd-HHmmss))
$startedAt = (Get-Date).ToString("o")
$receiptName = switch ($Mode) {
  "Prepare" { "open-buy-preopen-prepare.json" }
  "Final" { "open-buy-preopen.json" }
  "Watch" { "star-preopen-watch.json" }
}
$receiptPath = Join-Path $receiptDir $receiptName

function Write-PreopenLog {
  param([string]$Message)
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Add-Content -LiteralPath $log -Encoding utf8 -Value $line
  Write-Host $line
}

function Write-PreopenReceipt {
  param(
    [string]$Status,
    [int]$ExitCode,
    [string]$HealthStatus = "",
    [string]$HealthReason = "",
    [object]$RefreshResult = $null,
    [int]$Iterations = 0,
    [string[]]$Warnings = @()
  )

  $payload = [ordered]@{
    strategy = "strategy1"
    label = "strategy1 preopen $safeMode"
    mode = $safeMode
    tier = "critical"
    startedAt = $startedAt
    finishedAt = (Get-Date).ToString("o")
    status = $Status
    exitCode = $ExitCode
    complete = $ExitCode -eq 0
    healthStatus = $HealthStatus
    healthReason = $HealthReason
    refreshResult = $RefreshResult
    iterations = $Iterations
    warnings = @($Warnings)
    log = $log
  }
  $payload | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $receiptPath -Encoding utf8
}

function Get-TaipeiNow {
  try {
    $tz = [TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
    return [TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $tz)
  } catch {
    return Get-Date
  }
}

function Get-TaipeiTradeDate {
  return (Get-TaipeiNow).ToString("yyyy-MM-dd")
}

function Read-SecretText {
  param([string[]]$Names)
  foreach ($name in $Names) {
    if ([string]::IsNullOrWhiteSpace($name)) { continue }
    $path = Join-Path $runtime ("secrets\{0}" -f $name)
    if (Test-Path -LiteralPath $path) {
      $text = (Get-Content -LiteralPath $path -Raw).Trim()
      if ($text) { return $text }
    }
  }
  return ""
}

function Get-SupabaseConfig {
  $url = [string]($env:SUPABASE_URL ?? $env:FUMAN_SUPABASE_URL ?? "")
  if ([string]::IsNullOrWhiteSpace($url)) {
    $url = Read-SecretText @("supabase-url.txt")
  }
  if ([string]::IsNullOrWhiteSpace($url)) {
    $url = "https://cpmpfhbzutkiecccekfr.supabase.co"
  }

  $key = [string]($env:SUPABASE_SERVICE_ROLE_KEY ?? $env:SUPABASE_SERVICE_KEY ?? $env:FUMAN_SUPABASE_SERVICE_ROLE_KEY ?? $env:FUMAN_SUPABASE_SERVICE_KEY ?? "")
  if ([string]::IsNullOrWhiteSpace($key)) {
    $key = Read-SecretText @("supabase-service-role-key.txt", "supabase-service-key.txt")
  }
  if ([string]::IsNullOrWhiteSpace($key)) {
    $key = [string]($env:SUPABASE_ANON_KEY ?? $env:FUMAN_SUPABASE_ANON_KEY ?? "")
  }
  if ([string]::IsNullOrWhiteSpace($key)) {
    $key = Read-SecretText @("supabase-anon-key.txt")
  }

  if ([string]::IsNullOrWhiteSpace($key)) {
    throw "missing Supabase key for strategy1 preopen refresh"
  }

  return [pscustomobject]@{
    Url = $url.TrimEnd("/")
    Key = $key
  }
}

function Get-HttpErrorSummary {
  param([Parameter(Mandatory = $true)][object]$ErrorRecord)

  $statusCode = ""
  try {
    if ($ErrorRecord.Exception.Response) {
      $statusCode = [string][int]$ErrorRecord.Exception.Response.StatusCode
    }
  } catch {}

  $detail = ""
  try {
    if ($ErrorRecord.ErrorDetails -and $ErrorRecord.ErrorDetails.Message) {
      $detail = [string]$ErrorRecord.ErrorDetails.Message
    }
  } catch {}
  try {
    if (-not $detail -and $ErrorRecord.Exception.Response -and $ErrorRecord.Exception.Response.Content) {
      $detail = [string]$ErrorRecord.Exception.Response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    }
  } catch {}

  $parts = @()
  if ($statusCode) { $parts += "status=$statusCode" }
  if ($detail) { $parts += "body=$detail" }
  if ($ErrorRecord.Exception.Message) { $parts += "message=$($ErrorRecord.Exception.Message)" }
  return ($parts -join " ")
}

function Test-ControlledPreopenRefreshFailure {
  param(
    [string]$ModeName,
    [string]$Message
  )
  if ($Message -match "57014|statement timeout") { return $true }
  if ($ModeName -ne "Final" -and $Message -match "refresh_strategy1_futopt_preopen_live_snapshot failed .*status=500|Response status code does not indicate success: 500|Internal Server Error") { return $true }
  return $ModeName -ne "Final" -and $Message -match "timed out|timeout"
}

function Invoke-Strategy1SnapshotRefresh {
  param([string]$TradeDate)

  $config = Get-SupabaseConfig
  $body = @{ p_trade_date = $TradeDate } | ConvertTo-Json -Compress
  $headers = @{
    "apikey" = $config.Key
    "Authorization" = "Bearer $($config.Key)"
    "Content-Type" = "application/json"
    "Prefer" = "return=representation"
  }
  $uri = "{0}/rest/v1/rpc/refresh_strategy1_futopt_preopen_live_snapshot" -f $config.Url
  Write-PreopenLog "refresh_strategy1_futopt_preopen_live_snapshot start trade_date=$TradeDate"
  try {
    $response = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -Body $body -TimeoutSec 90 -ErrorAction Stop
  } catch {
    $summary = Get-HttpErrorSummary -ErrorRecord $_
    throw "refresh_strategy1_futopt_preopen_live_snapshot failed $summary"
  }
  Write-PreopenLog ("refresh_strategy1_futopt_preopen_live_snapshot result {0}" -f (($response | ConvertTo-Json -Depth 8 -Compress)))
  return $response
}

function Invoke-StarPreopenScanOnce {
  param([string]$ModeName)

  if ($ModeName -eq "Final") {
    $env:STAR_FINAL_START_MINUTES = "535"
    $env:STAR_FINAL_END_MINUTES = "539"
    $env:STAR_SYNC_OPEN_BUY_SOURCE = "1"
  } elseif ($ModeName -eq "Watch") {
    $env:STAR_SYNC_OPEN_BUY_SOURCE = "0"
  }

  Write-PreopenLog "scan-star-preopen.js start mode=$ModeName"
  & $nodeExe "scripts\scan-star-preopen.js" >> $log 2>&1
  $exitCode = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } else { 0 }
  if ($exitCode -ne 0) {
    throw "scan-star-preopen.js failed mode=$ModeName exit=$exitCode"
  }
  Write-PreopenLog "scan-star-preopen.js ok mode=$ModeName"
}

function Test-WatchWindowActive {
  $now = Get-TaipeiNow
  $minute = $now.Hour * 60 + $now.Minute
  return $minute -ge 525 -and $minute -le 539
}

Write-PreopenLog "strategy1 preopen runner start mode=$Mode"
. "${PSScriptRoot}\schedule-guard.ps1"
Invoke-FumanWeekdayGuard -Label "Strategy1 preopen $Mode" -LogPath $log

$refreshResult = $null
$healthStatus = ""
$healthReason = ""
$iterations = 0
$warnings = @()

try {
  if ($Mode -eq "Watch" -and -not (Test-WatchWindowActive)) {
    $message = "outside STAR preopen watch window; skip"
    Write-PreopenLog $message
    Write-PreopenReceipt "complete" 0 "skipped" $message $null 0 @($message)
    exit 0
  }

  do {
    $iterations += 1
    Invoke-StarPreopenScanOnce -ModeName $Mode
    $controlledRefreshFailure = $false
    try {
      $refreshResult = Invoke-Strategy1SnapshotRefresh -TradeDate (Get-TaipeiTradeDate)
    } catch {
      $refreshMessage = $_.Exception.Message
      if (-not (Test-ControlledPreopenRefreshFailure -ModeName $Mode -Message $refreshMessage)) {
        throw
      }
      $controlledRefreshFailure = $true
      $warnings += "controlled preopen refresh failure: $refreshMessage"
      $refreshResult = [pscustomobject]@{
        ok = $false
        controlled = $true
        mode = $safeMode
        reason = "strategy1_preopen_refresh_statement_timeout"
        preserveLatest = $true
        error = $refreshMessage
      }
      Write-PreopenLog "controlled preopen refresh failure mode=$Mode; preserve latest complete run; error=$refreshMessage"
    }

    if ($Mode -ne "Watch") { break }
    if ($controlledRefreshFailure) { break }
    if (-not (Test-WatchWindowActive)) { break }
    Start-Sleep -Seconds 30
  } while ($true)

  . "${PSScriptRoot}\scanner-resource-health.ps1"
  $gate = Invoke-ScannerResourceHealthGate -Strategy "strategy1" -LogPath $log
  $healthStatus = $gate.Status
  $healthReason = $gate.Reason

  $snapshotScript = "${PSScriptRoot}\refresh-desktop-route-snapshot.ps1"
  if (Test-Path -LiteralPath $snapshotScript) {
    & $snapshotScript -Source "strategy1-preopen-$safeMode" -LogPath $log -AllowFailure
  }

  if ($gate.Status -eq "failed") {
    throw "strategy1 preopen health failed: $($gate.Reason)"
  }

  if ($gate.Status -ne "ready") {
    $warnings += "controlled health=$($gate.Status): $($gate.Reason)"
    if ($Mode -eq "Final") {
      throw "strategy1 preopen final health not ready: $($gate.Reason)"
    }
  }

  Write-PreopenReceipt "complete" 0 $healthStatus $healthReason $refreshResult $iterations $warnings
  Write-PreopenLog "strategy1 preopen runner complete mode=$Mode health=$healthStatus iterations=$iterations"
  exit 0
} catch {
  $message = $_.Exception.Message
  Write-PreopenLog "strategy1 preopen runner failed mode=$Mode error=$message"
  Write-PreopenReceipt "failed" 1 $healthStatus $message $refreshResult $iterations @($warnings + $message)
  exit 1
}
