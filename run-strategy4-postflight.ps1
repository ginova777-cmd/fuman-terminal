$ErrorActionPreference = "Continue"
$PSNativeCommandUseErrorActionPreference = $false

$runtime = if ($env:FUMAN_RUNTIME_DIR) { $env:FUMAN_RUNTIME_DIR } else { "C:\fuman-runtime" }
$dataDir = if ($env:FUMAN_DATA_DIR) { $env:FUMAN_DATA_DIR } else { Join-Path $runtime "data" }
$stateDir = if ($env:FUMAN_STATE_DIR) { $env:FUMAN_STATE_DIR } else { Join-Path $runtime "state" }
$baseUrl = if ($env:FUMAN_VERIFY_BASE_URL) { $env:FUMAN_VERIFY_BASE_URL.TrimEnd("/") } else { "https://fuman-terminal.vercel.app" }
$statusFile = Join-Path $stateDir "strategy4-postflight-status.json"
$logDir = Join-Path $runtime "logs"
$log = Join-Path $logDir ("strategy4-postflight-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
$maxVolumeCacheMiss = if ($env:STRATEGY4_MAX_VOLUME_CACHE_MISS) { [int]$env:STRATEGY4_MAX_VOLUME_CACHE_MISS } else { 100 }

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

function Get-BatchId($payload) {
  if ($payload -eq $null) { return "" }
  if ($payload.scanStamp) { return [string]$payload.scanStamp }
  if ($payload.updatedAt) { return [string]$payload.updatedAt }
  return ""
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

function Test-Strategy4SplitSet($label, $payloads) {
  $setIssues = New-Object System.Collections.Generic.List[string]
  $latestPayload = $payloads["strategy4-latest.json"]
  if ($latestPayload -eq $null) {
    $setIssues.Add("$label split check missing strategy4-latest.json") | Out-Null
    return $setIssues
  }

  $latestCount = Count-Rows $latestPayload
  $latestBatch = Get-BatchId $latestPayload
  foreach ($name in @("strategy4-summary.json", "strategy4-slim.json", "strategy4-zone-a.json", "strategy4-zone-b.json", "strategy4-zone-c.json", "strategy4-score-top.json")) {
    $payload = $payloads[$name]
    if ($payload -eq $null) {
      $setIssues.Add("$label missing $name") | Out-Null
      continue
    }
    $batch = Get-BatchId $payload
    if ($latestBatch -and $batch -and $batch -ne $latestBatch) {
      $setIssues.Add("$label $name batch $batch differs latest $latestBatch") | Out-Null
    }
  }

  foreach ($name in @("strategy4-summary.json", "strategy4-slim.json")) {
    $payload = $payloads[$name]
    $count = Count-Rows $payload
    if ($payload -and $count -ne $latestCount) {
      $setIssues.Add("$label $name count $count differs latest $latestCount") | Out-Null
    }
  }

  $zoneA = $payloads["strategy4-zone-a.json"]
  $zoneB = $payloads["strategy4-zone-b.json"]
  $zoneC = $payloads["strategy4-zone-c.json"]
  $zoneACount = Count-Rows $zoneA
  $zoneBCount = Count-Rows $zoneB
  $zoneCCount = Count-Rows $zoneC
  if ($zoneA -and $zoneA.zone -ne "A") { $setIssues.Add("$label strategy4-zone-a.json zone=$($zoneA.zone)") | Out-Null }
  if ($zoneB -and $zoneB.zone -ne "B") { $setIssues.Add("$label strategy4-zone-b.json zone=$($zoneB.zone)") | Out-Null }
  if ($zoneC -and $zoneC.zone -ne "C") { $setIssues.Add("$label strategy4-zone-c.json zone=$($zoneC.zone)") | Out-Null }
  if (($zoneACount + $zoneBCount + $zoneCCount) -ne $latestCount) {
    $setIssues.Add("$label zone total A/B/C=$zoneACount/$zoneBCount/$zoneCCount differs latest $latestCount") | Out-Null
  }

  $scoreTop = $payloads["strategy4-score-top.json"]
  $scoreTopCount = Count-Rows $scoreTop
  $expectedScoreTop = [Math]::Min(120, [int]$latestCount)
  if ($scoreTop -and $scoreTopCount -ne $expectedScoreTop) {
    $setIssues.Add("$label strategy4-score-top count $scoreTopCount differs expected $expectedScoreTop") | Out-Null
  }

  foreach ($zoneName in @("B", "C")) {
    $zoneCount = if ($zoneName -eq "B") { [int]$zoneBCount } else { [int]$zoneCCount }
    $expectedPages = [Math]::Max(1, [Math]::Ceiling($zoneCount / 25))
    $pageTotal = 0
    for ($page = 1; $page -le 48; $page++) {
      $file = "strategy4-zone-$($zoneName.ToLower())-page-$page.json"
      $payload = $payloads[$file]
      if ($payload -eq $null) {
        $setIssues.Add("$label missing $file") | Out-Null
        continue
      }
      $batch = Get-BatchId $payload
      if ($latestBatch -and $batch -and $batch -ne $latestBatch) {
        $setIssues.Add("$label $file batch $batch differs latest $latestBatch") | Out-Null
      }
      if ($payload.zone -ne $zoneName) { $setIssues.Add("$label $file zone=$($payload.zone)") | Out-Null }
      if ([int]$payload.page -ne $page) { $setIssues.Add("$label $file page=$($payload.page)") | Out-Null }
      if ([int]$payload.totalCount -ne $zoneCount) { $setIssues.Add("$label $file totalCount=$($payload.totalCount) differs zone $zoneCount") | Out-Null }
      if ([int]$payload.totalPages -ne [int]$expectedPages) { $setIssues.Add("$label $file totalPages=$($payload.totalPages) differs expected $expectedPages") | Out-Null }
      $count = Count-Rows $payload
      if ([int]$payload.count -ne [int]$count) { $setIssues.Add("$label $file count field $($payload.count) differs rows $count") | Out-Null }
      if ($page -le $expectedPages) {
        $pageTotal += [int]$count
      } elseif ([int]$count -ne 0) {
        $setIssues.Add("$label $file should be empty after page $expectedPages but count=$count") | Out-Null
      }
    }
    if ($pageTotal -ne $zoneCount) {
      $setIssues.Add("$label zone $zoneName page total $pageTotal differs zone count $zoneCount") | Out-Null
    }
  }

  return $setIssues
}

$issues = New-Object System.Collections.Generic.List[string]
$warnings = New-Object System.Collections.Generic.List[string]
$expectedVersion = Get-ExpectedFrontendVersion
$files = @(
  "strategy4-latest.json",
  "strategy4-summary.json",
  "strategy4-slim.json",
  "strategy4-zone-a.json",
  "strategy4-zone-b.json",
  "strategy4-zone-c.json",
  "strategy4-score-top.json"
)
for ($page = 1; $page -le 48; $page++) {
  $files += "strategy4-zone-b-page-$page.json"
  $files += "strategy4-zone-c-page-$page.json"
}

$local = @{}
$localPayloads = @{}
foreach ($file in $files) {
  $path = Join-Path $dataDir $file
  $payload = Read-Json $path
  $localPayloads[$file] = $payload
  $count = Count-Rows $payload
  $local[$file] = [ordered]@{
    count = $count
    total = $payload.total
    updatedAt = $payload.updatedAt
    complete = $payload.complete
    volumeFilteredCount = $payload.volumeFilteredCount
    volumeCacheHit = $payload.volumeFilter.cacheHit
    volumeCacheMiss = $payload.volumeFilter.cacheMiss
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
  $volumeCacheMiss = Number-OrZero $latest.volumeFilter.cacheMiss
  if ($volumeCacheMiss -gt $maxVolumeCacheMiss) {
    $warnings.Add("strategy4 volume prefilter cache miss high: $volumeCacheMiss > $maxVolumeCacheMiss") | Out-Null
  }
}

foreach ($issue in (Test-Strategy4SplitSet "local" $localPayloads)) {
  $issues.Add($issue) | Out-Null
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

$remotePayloads = @{}
foreach ($file in $files) {
  $remotePayloads[$file] = Fetch-Json "$baseUrl/data/$file"
}
foreach ($issue in (Test-Strategy4SplitSet "remote" $remotePayloads)) {
  $issues.Add($issue) | Out-Null
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
  $warnings.Add("google sheet not healthy: ok=$($sheetStatus.ok), pending=$($sheetStatus.pendingCount)") | Out-Null
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
