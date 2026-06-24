$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
Set-Location "${PSScriptRoot}"
$env:FUMAN_RUNTIME_DIR = if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }
$env:FUMAN_DATA_DIR = if ($env:FUMAN_DATA_DIR) { $env:FUMAN_DATA_DIR } else { Join-Path $env:FUMAN_RUNTIME_DIR "data" }
$env:FUMAN_CACHE_DIR = if ($env:FUMAN_CACHE_DIR) { $env:FUMAN_CACHE_DIR } else { Join-Path $env:FUMAN_RUNTIME_DIR "cache" }
$env:FUMAN_STATE_DIR = if ($env:FUMAN_STATE_DIR) { $env:FUMAN_STATE_DIR } else { Join-Path $env:FUMAN_RUNTIME_DIR "state" }
$env:NODE_OPTIONS = "--use-system-ca"

$nodeExe = "C:\Program Files\nodejs\node.exe"
$logDir = Join-Path $env:FUMAN_RUNTIME_DIR "logs"
New-Item -ItemType Directory -Force -Path $logDir, $env:FUMAN_DATA_DIR, $env:FUMAN_CACHE_DIR, $env:FUMAN_STATE_DIR | Out-Null
$log = Join-Path $logDir ("strategy3-complete-scan-{0}.log" -f (Get-Date -Format yyyyMMdd-HHmmss))

function Write-Strategy3CompleteLog($Message) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Write-Host $line
  Add-Content -LiteralPath $log -Value $line -Encoding utf8
}

. "${PSScriptRoot}\schedule-guard.ps1"
Invoke-FumanWeekdayGuard -Label "Strategy3 complete scan" -LogPath $log

function Get-TaipeiTodayYmd {
  $taipeiNow = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId((Get-Date), "Taipei Standard Time")
  return $taipeiNow.ToString("yyyyMMdd")
}

function Convert-DateTextToYmd($Value) {
  $text = [string]$Value
  if ($text -match "^\d{8}$") { return $text }
  if ($text -match "^\d{4}-\d{2}-\d{2}") { return $text.Substring(0, 10).Replace("-", "") }
  return ""
}

function Assert-Strategy3CompleteApi {
  $apiCheck = @"
const handler = require("./api/strategy3-latest");
const { captureHandler } = require("./scripts/strategy-api-capture");
captureHandler(handler).then((result) => {
  const payload = result.body || {};
  const count = payload.count ?? (Array.isArray(payload.matches) ? payload.matches.length : 0);
  console.log(JSON.stringify({
    statusCode: result.statusCode,
    body: {
      usedDate: payload.usedDate || "",
      count,
      cacheSource: payload.cacheSource || "",
      runId: payload.runId || "",
      transport: { gate: payload.transport && payload.transport.gate || "" },
    },
  }));
}).catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
"@
  $resultText = (& $nodeExe -e $apiCheck) -join "`n"
  if ($LASTEXITCODE -ne 0) { throw "Strategy3 latest API check failed with exit code $LASTEXITCODE" }
  $result = $resultText | ConvertFrom-Json -ErrorAction Stop
  if ([int]$result.statusCode -ne 200) { throw "Strategy3 latest API returned status=$($result.statusCode)" }
  $payload = $result.body
  $today = Get-TaipeiTodayYmd
  $usedDate = Convert-DateTextToYmd $payload.usedDate
  $count = if ($null -ne $payload.count) { [int]$payload.count } else { @($payload.matches).Count }
  if ($usedDate -ne $today) { throw "Strategy3 latest API stale; usedDate=$usedDate today=$today" }
  if ($count -le 0) { throw "Strategy3 latest API empty; count=$count" }
  if ([string]$payload.cacheSource -ne "supabase-api") { throw "Strategy3 latest API did not use complete-run API; cacheSource=$($payload.cacheSource)" }
  if ([string]::IsNullOrWhiteSpace([string]$payload.runId)) { throw "Strategy3 latest API missing runId" }
  if ([string]$payload.transport.gate -ne "run_id") { throw "Strategy3 latest API did not use run_id gate; gate=$($payload.transport.gate)" }
  Write-Strategy3CompleteLog "Strategy3 complete API verified: usedDate=$usedDate count=$count runId=$($payload.runId) cacheSource=$($payload.cacheSource) gate=$($payload.transport.gate)"
}

Write-Strategy3CompleteLog "Strategy3 complete scan start"
& $nodeExe "scripts\scan-strategy3-cache.js" >> $log 2>&1
$exitCode = $LASTEXITCODE
if ($null -eq $exitCode) { $exitCode = 0 }
if ($exitCode -ne 0) { throw "Strategy3 complete scanner failed with exit code $exitCode; log=$log" }

$apiVerified = $false
$lastApiError = ""
for ($attempt = 1; $attempt -le 6; $attempt++) {
  try {
    Assert-Strategy3CompleteApi
    $apiVerified = $true
    break
  } catch {
    $lastApiError = $_.Exception.Message
    Write-Strategy3CompleteLog "Strategy3 complete API verify attempt $attempt/6 failed: $lastApiError"
    if ($attempt -lt 6) { Start-Sleep -Seconds 5 }
  }
}
if (-not $apiVerified) { throw "Strategy3 complete API verification failed after retries: $lastApiError" }
Write-Strategy3CompleteLog "Strategy3 complete scan end; Supabase complete run + no-store API is the terminal fast path"

