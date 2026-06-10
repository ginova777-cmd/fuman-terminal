$ErrorActionPreference = "Continue"
$PSNativeCommandUseErrorActionPreference = $false

$runtime = if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }
$dataDir = if ($env:FUMAN_DATA_DIR) { $env:FUMAN_DATA_DIR } else { Join-Path $runtime "data" }
$stateDir = if ($env:FUMAN_STATE_DIR) { $env:FUMAN_STATE_DIR } else { Join-Path $runtime "state" }
$baseUrl = if ($env:FUMAN_VERIFY_BASE_URL) { $env:FUMAN_VERIFY_BASE_URL.TrimEnd("/") } else { "https://fuman-terminal.vercel.app" }
$statusFile = Join-Path $stateDir "strategy4-postflight-status.json"
$logDir = Join-Path $runtime "logs"
$log = Join-Path $logDir ("strategy4-postflight-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))

New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-Log($message) {
  Write-Host $message
  Add-Content -LiteralPath $log -Value $message -Encoding utf8
}

function Read-Json($path) {
  try {
    return Get-Content -LiteralPath $path -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
  } catch {
    return $null
  }
}

function Count-Rows($payload) {
  if ($payload -eq $null) { return $null }
  if ($payload.matches) { return @($payload.matches).Count }
  if ($payload.rows) { return @($payload.rows).Count }
  if ($payload.count -ne $null) { return [int]$payload.count }
  return $null
}

function Number-OrZero($value) {
  if ($null -eq $value) { return 0 }
  try { return [int]$value } catch { return 0 }
}

function Fetch-Json($url) {
  try {
    return (Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 20 -ErrorAction Stop).Content | ConvertFrom-Json
  } catch {
    Write-Log "REMOTE_JSON_WARN $url :: $($_.Exception.Message)"
    return $null
  }
}

function Fetch-Text($url) {
  try {
    return (Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 20 -ErrorAction Stop).Content
  } catch {
    Write-Log "REMOTE_TEXT_WARN $url :: $($_.Exception.Message)"
    return ""
  }
}

function Get-ExpectedFrontendVersion {
  if ($env:FUMAN_EXPECTED_VERSION) { return $env:FUMAN_EXPECTED_VERSION }
  $localCore = Join-Path $PSScriptRoot "terminal-core.js"
  try {
    $text = Get-Content -LiteralPath $localCore -Raw -ErrorAction Stop
    $match = [regex]::Match($text, 'const version = "([^"]+)"')
    if ($match.Success) { return $match.Groups[1].Value }
  } catch {}
  return ""
}

$issues = New-Object System.Collections.Generic.List[string]
$warnings = New-Object System.Collections.Generic.List[string]
$expectedVersion = Get-ExpectedFrontendVersion
$files = @(
  "strategy4-latest.json",
  "strategy4-slim.json",
  "strategy4-zone-a.json",
  "strategy4-zone-b.json",
  "strategy4-zone-c.json"
)

$local = @{}
foreach ($file in $files) {
  $path = Join-Path $dataDir $file
  $payload = Read-Json $path
  $count = Count-Rows $payload
  $local[$file] = [ordered]@{
    count = $count
    total = $payload.total
    updatedAt = $payload.updatedAt
    complete = $payload.complete
    volumeFilteredCount = $payload.volumeFilteredCount
  }
  if ($payload -eq $null) { $issues.Add("missing or invalid local $file") | Out-Null }
}

$latest = Read-Json (Join-Path $dataDir "strategy4-latest.json")
if ($latest -eq $null) {
  $issues.Add("strategy4-latest local payload missing") | Out-Null
} else {
  if ($latest.complete -ne $true) { $issues.Add("strategy4-latest incomplete") | Out-Null }
  if ((Count-Rows $latest) -lt 10) { $issues.Add("strategy4-latest too few matches") | Out-Null }
  if ((Number-OrZero $latest.volumeFilteredCount) -le 0) { $warnings.Add("strategy4 volume prefilter metadata missing or zero") | Out-Null }
}

$remoteLatest = Fetch-Json "$baseUrl/data/strategy4-latest.json"
$remoteSlim = Fetch-Json "$baseUrl/data/strategy4-slim.json"
if ($remoteLatest) {
  $remoteCount = Count-Rows $remoteLatest
  if ($latest -and $remoteCount -ne (Count-Rows $latest)) {
    $warnings.Add("remote latest count $remoteCount differs local $(Count-Rows $latest)") | Out-Null
  }
}
if ($remoteSlim) {
  $remoteSlimCount = Count-Rows $remoteSlim
  if ($latest -and $remoteSlimCount -ne (Count-Rows $latest)) {
    $warnings.Add("remote slim count $remoteSlimCount differs local $(Count-Rows $latest)") | Out-Null
  }
}

$terminalCore = Fetch-Text "$baseUrl/terminal-core.js"
$terminalApp = Fetch-Text "$baseUrl/terminal-app.js"
if ($expectedVersion -and $terminalCore -and -not $terminalCore.Contains($expectedVersion)) {
  $warnings.Add("terminal-core version is not $expectedVersion") | Out-Null
}
if ($terminalApp -and -not $terminalApp.Contains("!isMobileViewport()&&force&&endpoints.strategy4Cache?endpoints.strategy4Cache")) {
  $warnings.Add("terminal-app desktop strategy4 full-cache guard missing") | Out-Null
}

$sheetStatusPath = Join-Path $stateDir "google-sheet-upload-status.json"
$sheetStatus = Read-Json $sheetStatusPath
if ($sheetStatus -eq $null) {
  $warnings.Add("google sheet status missing") | Out-Null
} elseif ($sheetStatus.ok -ne $true -or (Number-OrZero $sheetStatus.pendingCount) -gt 0) {
  $issues.Add("google sheet not healthy: ok=$($sheetStatus.ok), pending=$($sheetStatus.pendingCount)") | Out-Null
}

$status = [ordered]@{
  ok = $issues.Count -eq 0
  updatedAt = (Get-Date).ToUniversalTime().ToString("o")
  source = "strategy4-postflight"
  baseUrl = $baseUrl
  expectedVersion = $expectedVersion
  local = $local
  remote = [ordered]@{
    latestCount = Count-Rows $remoteLatest
    slimCount = Count-Rows $remoteSlim
    latestUpdatedAt = $remoteLatest.updatedAt
    slimUpdatedAt = $remoteSlim.updatedAt
  }
  googleSheet = $sheetStatus
  warnings = @($warnings)
  issues = @($issues)
  log = $log
}

$status | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $statusFile -Encoding utf8
Write-Log "Strategy4 postflight ok=$($status.ok) issues=$($issues.Count) warnings=$($warnings.Count)"
if ($issues.Count -gt 0) {
  foreach ($issue in $issues) { Write-Log "ISSUE $issue" }
  exit 1
}
foreach ($warning in $warnings) { Write-Log "WARN $warning" }
exit 0
