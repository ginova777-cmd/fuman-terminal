param(
  [string]$ProjectUrl = "https://cpmpfhbzutkiecccekfr.supabase.co",
  [string]$RuntimeDir = "C:\fuman-runtime",
  [string]$Root = "C:\fuman-terminal",
  [string]$SourceName = "fugle_shared_source",
  [int]$Samples = 1,
  [int]$IntervalSeconds = 60,
  [double]$MinFreshQuoteCoverage120 = 0.90,
  [double]$MinToday1mCoverage = 0.95,
  [double]$MinReadyGe35Coverage = 0.95,
  [int]$MaxIntraday1mStaleSeconds = 120,
  [int]$MaxWatchdogRestartStaleSeconds = 180,
  [int]$MaxQuoteAgeSeconds = 120,
  [int]$MaxSelfHealThresholdSeconds = 75,
  [int]$MaxSelfHealCooldownSeconds = 60,
  [switch]$RequireRegular,
  [switch]$NoFail,
  [string]$OutputPath = ""
)

# Handoff purpose:
# - Read-only audit for another PS1/operator computer.
# - Do not deploy, do not restart writer, do not write Supabase/cache/runtime.
# - Detect whether the shared source water path exposes the expected fields and evidence.
# - During 09:00-13:35 Asia/Taipei, this script can hard-fail on low quote/1m/MA readiness.

$ErrorActionPreference = "Stop"

$RequiredPayloadFields = @(
  "source_contract_version",
  "writer_version",
  "quote_status",
  "permission_status",
  "preopen_status",
  "intraday_1m_status",
  "daily_volume_status",
  "active_symbols",
  "quotes",
  "fresh_quotes_120s",
  "fresh_quote_coverage_120s",
  "quote_age_seconds",
  "today_1m_symbols",
  "intraday_1m_rows_today",
  "intraday_1m_stale_seconds",
  "latest_candle_time",
  "ready_ge_20_symbols",
  "ready_ge_35_symbols",
  "ready_ge_80_symbols",
  "ready_ge_200_symbols",
  "ready_ma20_continuous_symbols",
  "ready_ma35_continuous_symbols",
  "ready_macd_continuous_symbols",
  "scanner_can_run_quote_only",
  "scanner_can_run_ma20",
  "scanner_can_run_ma35",
  "scanner_can_run_full_intraday",
  "scanner_block_reason",
  "quote_derived_1m_full_universe",
  "quote_derived_1m_opening_backfill_rows",
  "intraday_1m_self_heal_enabled",
  "intraday_1m_self_heal_triggered",
  "intraday_1m_self_heal_reason",
  "intraday_1m_self_heal_checked_at",
  "intraday_1m_self_heal_threshold_seconds",
  "intraday_1m_self_heal_cooldown_seconds",
  "intraday_1m_self_heal_rows"
)

function Read-TextSecret {
  param([string[]]$Paths)
  foreach ($path in $Paths) {
    try {
      if (Test-Path -LiteralPath $path) {
        $value = (Get-Content -LiteralPath $path -Raw -ErrorAction Stop).Trim()
        if (-not [string]::IsNullOrWhiteSpace($value)) { return $value }
      }
    } catch {}
  }
  return ""
}

function Get-SupabaseKey {
  foreach ($name in @("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY")) {
    $value = [Environment]::GetEnvironmentVariable($name)
    if (-not [string]::IsNullOrWhiteSpace($value)) { return $value }
  }
  return Read-TextSecret -Paths @(
    (Join-Path $RuntimeDir "secrets\supabase-service-role-key.txt"),
    (Join-Path $RuntimeDir "secrets\supabase-anon-key.txt"),
    (Join-Path $Root "secrets\supabase-service-role-key.txt"),
    (Join-Path $Root "secrets\supabase-anon-key.txt")
  )
}

function Convert-ToNumber {
  param([object]$Value, [double]$Default = 0)
  if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) { return $Default }
  $text = ([string]$Value).Replace(",", "").Replace("%", "").Trim()
  $number = 0.0
  if ([double]::TryParse($text, [ref]$number)) { return $number }
  return $Default
}

function Convert-ToBool {
  param([object]$Value)
  if ($Value -is [bool]) { return [bool]$Value }
  return ([string]$Value) -match "^(1|true|yes|ok|ready)$"
}

function Get-ObjectValue {
  param([object]$Object, [string[]]$Names, [object]$Default = $null)
  if ($null -eq $Object) { return $Default }
  foreach ($name in $Names) {
    $property = $Object.PSObject.Properties[$name]
    if ($null -ne $property -and $null -ne $property.Value -and -not [string]::IsNullOrWhiteSpace([string]$property.Value)) {
      return $property.Value
    }
  }
  return $Default
}

function Test-ObjectField {
  param([object]$Object, [string]$Name)
  if ($null -eq $Object) { return $false }
  return ($null -ne $Object.PSObject.Properties[$Name])
}

function Get-AgeSeconds {
  param([string]$IsoTime)
  try {
    if ([string]::IsNullOrWhiteSpace($IsoTime)) { return 999999 }
    $dt = [datetimeoffset]::Parse($IsoTime).ToUniversalTime().UtcDateTime
    return [int]([math]::Max(0, ((Get-Date).ToUniversalTime() - $dt).TotalSeconds))
  } catch {
    return 999999
  }
}

function Get-TaipeiClock {
  try {
    $tz = [TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
    $now = [TimeZoneInfo]::ConvertTime((Get-Date), $tz)
  } catch {
    $now = Get-Date
  }
  return [pscustomobject]@{
    text = $now.ToString("yyyy-MM-dd HH:mm:ss")
    minuteOfDay = ($now.Hour * 60 + $now.Minute)
    regularSession = (($now.Hour * 60 + $now.Minute) -ge 540 -and ($now.Hour * 60 + $now.Minute) -le 815)
    afterCoverageGate = (($now.Hour * 60 + $now.Minute) -ge 545 -and ($now.Hour * 60 + $now.Minute) -le 815)
  }
}

function Invoke-SupabaseGet {
  param([string]$PathAndQuery, [switch]$Optional)
  $key = Get-SupabaseKey
  if ([string]::IsNullOrWhiteSpace($key)) {
    if ($Optional) { return [pscustomobject]@{ ok = $false; skipped = $true; error = "missing Supabase key" } }
    throw "missing Supabase key. Put supabase-anon-key.txt under $RuntimeDir\secrets or set SUPABASE_ANON_KEY."
  }
  $headers = @{
    apikey = $key
    Authorization = "Bearer $key"
  }
  $uri = "$($ProjectUrl.TrimEnd('/'))/rest/v1/$PathAndQuery"
  try {
    return Invoke-RestMethod -Uri $uri -Method Get -Headers $headers -TimeoutSec 20 -ErrorAction Stop
  } catch {
    if ($Optional) {
      return [pscustomobject]@{ ok = $false; skipped = $false; error = $_.Exception.Message; uri = $uri }
    }
    throw
  }
}

function Convert-SourceStatusSample {
  param([object]$Row, [int]$Index)
  $issues = New-Object System.Collections.Generic.List[object]
  $warnings = New-Object System.Collections.Generic.List[object]
  $clock = Get-TaipeiClock

  if ($null -eq $Row) {
    $issues.Add([ordered]@{ code = "source_status_missing"; detail = @{} })
    return [ordered]@{
      index = $Index
      ok = $false
      clockTaipei = $clock.text
      regularSession = $clock.regularSession
      issues = $issues
      warnings = $warnings
    }
  }

  $payload = $Row.payload
  $missingFields = @($RequiredPayloadFields | Where-Object { -not (Test-ObjectField -Object $payload -Name $_) })
  foreach ($field in $missingFields) {
    $warnings.Add([ordered]@{ code = "payload_field_missing"; field = $field })
  }

  $activeSymbols = [int](Convert-ToNumber (Get-ObjectValue $payload @("active_symbols", "seeded_symbols", "symbols")) 0)
  $freshQuoteCoverage = [double](Convert-ToNumber (Get-ObjectValue $payload @("fresh_quote_coverage_120s", "eligible_quote_coverage")) 0)
  $quoteAgeSeconds = [int](Convert-ToNumber (Get-ObjectValue $payload @("quote_age_seconds")) 999999)
  $today1mSymbols = [int](Convert-ToNumber (Get-ObjectValue $payload @("today_1m_symbols", "intraday_1m_symbols_today")) 0)
  $readyGe35 = [int](Convert-ToNumber (Get-ObjectValue $payload @("ready_ge_35_symbols", "ready_ge_35", "ready_ma35_continuous_symbols", "ready_ma35_continuous")) 0)
  $intradayStale = [int](Convert-ToNumber (Get-ObjectValue $payload @("intraday_1m_stale_seconds")) 999999)
  $today1mCoverage = if ($activeSymbols -gt 0) { [math]::Round($today1mSymbols / [double]$activeSymbols, 4) } else { 0 }
  $readyGe35Coverage = if ($activeSymbols -gt 0) { [math]::Round($readyGe35 / [double]$activeSymbols, 4) } else { 0 }
  $selfHealEnabled = Convert-ToBool (Get-ObjectValue $payload @("intraday_1m_self_heal_enabled") $false)
  $selfHealThreshold = [int](Convert-ToNumber (Get-ObjectValue $payload @("intraday_1m_self_heal_threshold_seconds")) 999999)
  $selfHealCooldown = [int](Convert-ToNumber (Get-ObjectValue $payload @("intraday_1m_self_heal_cooldown_seconds")) 999999)
  $quoteFullUniverse = Convert-ToBool (Get-ObjectValue $payload @("quote_derived_1m_full_universe") $false)
  $scannerCanRunMa35 = Convert-ToBool (Get-ObjectValue $payload @("scanner_can_run_ma35") $false)
  $sourceAge = Get-AgeSeconds ([string]$Row.updated_at)

  if (-not $selfHealEnabled) {
    $issues.Add([ordered]@{ code = "self_heal_not_enabled"; detail = @{ value = $selfHealEnabled } })
  }
  if ($selfHealThreshold -gt $MaxSelfHealThresholdSeconds) {
    $issues.Add([ordered]@{ code = "self_heal_threshold_too_loose"; detail = @{ threshold = $selfHealThreshold; max = $MaxSelfHealThresholdSeconds } })
  }
  if ($selfHealCooldown -gt $MaxSelfHealCooldownSeconds) {
    $issues.Add([ordered]@{ code = "self_heal_cooldown_too_loose"; detail = @{ cooldown = $selfHealCooldown; max = $MaxSelfHealCooldownSeconds } })
  }

  if ($clock.regularSession) {
    if ($sourceAge -gt 300) { $issues.Add([ordered]@{ code = "source_status_age_over_300s"; detail = @{ ageSeconds = $sourceAge } }) }
    if ($quoteAgeSeconds -gt $MaxQuoteAgeSeconds) { $issues.Add([ordered]@{ code = "quote_age_over_limit"; detail = @{ ageSeconds = $quoteAgeSeconds; max = $MaxQuoteAgeSeconds } }) }
    if ($freshQuoteCoverage -lt $MinFreshQuoteCoverage120) { $issues.Add([ordered]@{ code = "fresh_quote_coverage_low"; detail = @{ coverage = $freshQuoteCoverage; min = $MinFreshQuoteCoverage120 } }) }
    if ($intradayStale -gt $MaxIntraday1mStaleSeconds) { $issues.Add([ordered]@{ code = "intraday_1m_stale_over_limit"; detail = @{ staleSeconds = $intradayStale; max = $MaxIntraday1mStaleSeconds } }) }
    if ($clock.afterCoverageGate -and $today1mCoverage -lt $MinToday1mCoverage) { $issues.Add([ordered]@{ code = "today_1m_coverage_low"; detail = @{ coverage = $today1mCoverage; min = $MinToday1mCoverage; today1mSymbols = $today1mSymbols; activeSymbols = $activeSymbols } }) }
    if ($clock.afterCoverageGate -and $readyGe35Coverage -lt $MinReadyGe35Coverage) { $issues.Add([ordered]@{ code = "ready_ge35_coverage_low"; detail = @{ coverage = $readyGe35Coverage; min = $MinReadyGe35Coverage; readyGe35 = $readyGe35; activeSymbols = $activeSymbols } }) }
    if (-not $quoteFullUniverse) { $issues.Add([ordered]@{ code = "quote_derived_not_full_universe"; detail = @{ quoteDerivedFullUniverse = $quoteFullUniverse } }) }
    if (-not $scannerCanRunMa35) { $issues.Add([ordered]@{ code = "scanner_can_run_ma35_false"; detail = @{ scannerBlockReason = Get-ObjectValue $payload @("scanner_block_reason") "" } }) }
  } else {
    if ($intradayStale -gt $MaxWatchdogRestartStaleSeconds) {
      $warnings.Add([ordered]@{ code = "off_session_intraday_stale_not_blocking"; detail = @{ staleSeconds = $intradayStale; hardRestart = $MaxWatchdogRestartStaleSeconds } })
    }
  }

  return [ordered]@{
    index = $Index
    ok = ($issues.Count -eq 0)
    clockTaipei = $clock.text
    regularSession = $clock.regularSession
    source = "source_status"
    sourceName = $Row.source_name
    sourceStatus = $Row.status
    sourceUpdatedAt = $Row.updated_at
    sourceAgeSeconds = $sourceAge
    message = $Row.message
    activeSymbols = $activeSymbols
    quotes = [int](Convert-ToNumber (Get-ObjectValue $payload @("quotes", "quote_count")) 0)
    freshQuotes120s = [int](Convert-ToNumber (Get-ObjectValue $payload @("fresh_quotes_120s")) 0)
    freshQuoteCoverage120s = $freshQuoteCoverage
    quoteAgeSeconds = $quoteAgeSeconds
    quoteStatus = Get-ObjectValue $payload @("quote_status") ""
    permissionStatus = Get-ObjectValue $payload @("permission_status") ""
    intraday1mStatus = Get-ObjectValue $payload @("intraday_1m_status") ""
    dailyVolumeStatus = Get-ObjectValue $payload @("daily_volume_status") ""
    today1mSymbols = $today1mSymbols
    today1mCoverage = $today1mCoverage
    intraday1mRowsToday = [int](Convert-ToNumber (Get-ObjectValue $payload @("intraday_1m_rows_today", "today_1m_rows")) 0)
    intraday1mStaleSeconds = $intradayStale
    latestCandleTime = Get-ObjectValue $payload @("latest_candle_time", "intraday_1m_latest_candle_time") ""
    warmupCandleCount = [int](Convert-ToNumber (Get-ObjectValue $payload @("warmup_candle_count")) 0)
    continuousCandleCount = [int](Convert-ToNumber (Get-ObjectValue $payload @("continuous_candle_count")) 0)
    readyGe20 = [int](Convert-ToNumber (Get-ObjectValue $payload @("ready_ge_20_symbols", "ready_ge_20")) 0)
    readyGe35 = $readyGe35
    readyGe35Coverage = $readyGe35Coverage
    readyGe80 = [int](Convert-ToNumber (Get-ObjectValue $payload @("ready_ge_80_symbols", "ready_ge_80")) 0)
    readyGe200 = [int](Convert-ToNumber (Get-ObjectValue $payload @("ready_ge_200_symbols", "ready_ge_200")) 0)
    scannerCanRunMa35 = $scannerCanRunMa35
    scannerBlockReason = Get-ObjectValue $payload @("scanner_block_reason") ""
    quoteDerivedFullUniverse = $quoteFullUniverse
    quoteDerivedRows = [int](Convert-ToNumber (Get-ObjectValue $payload @("quote_derived_1m_rows")) 0)
    openingBackfillRows = [int](Convert-ToNumber (Get-ObjectValue $payload @("quote_derived_1m_opening_backfill_rows")) 0)
    selfHealEnabled = $selfHealEnabled
    selfHealTriggered = Convert-ToBool (Get-ObjectValue $payload @("intraday_1m_self_heal_triggered") $false)
    selfHealReason = Get-ObjectValue $payload @("intraday_1m_self_heal_reason") ""
    selfHealCheckedAt = Get-ObjectValue $payload @("intraday_1m_self_heal_checked_at") ""
    selfHealThresholdSeconds = $selfHealThreshold
    selfHealCooldownSeconds = $selfHealCooldown
    selfHealRows = [int](Convert-ToNumber (Get-ObjectValue $payload @("intraday_1m_self_heal_rows")) 0)
    statsSource = Get-ObjectValue $payload @("intraday_1m_stats_source") ""
    missingPayloadFields = $missingFields
    issues = $issues
    warnings = $warnings
  }
}

function Get-SourceStatusSample {
  param([int]$Index)
  $encoded = [uri]::EscapeDataString($SourceName)
  $rows = @(Invoke-SupabaseGet -PathAndQuery "source_status?source_name=eq.$encoded&select=source_name,status,updated_at,message,payload&limit=1")
  $row = if ($rows.Count -gt 0) { $rows[0] } else { $null }
  return Convert-SourceStatusSample -Row $row -Index $Index
}

function Get-OptionalSupabaseProbe {
  param([string]$Name, [string]$PathAndQuery)
  $result = Invoke-SupabaseGet -PathAndQuery $PathAndQuery -Optional
  if ($result.PSObject.Properties["ok"] -and $result.ok -eq $false) {
    return [ordered]@{ name = $Name; ok = $false; error = $result.error; skipped = $result.skipped }
  }
  $rows = @($result)
  return [ordered]@{ name = $Name; ok = ($rows.Count -gt 0); rowCount = $rows.Count; sample = if ($rows.Count -gt 0) { $rows[0] } else { $null } }
}

function Test-LocalMarkers {
  $runner = Join-Path $Root "ops\public-slot\Run-PublicSlotSharedSource.ps1"
  $watchdog = Join-Path $Root "ops\public-slot\Watchdog-PublicSlotSharedSource.ps1"
  $checks = New-Object System.Collections.Generic.List[object]
  foreach ($item in @(
    @{ file = $runner; markers = @("Intraday1mSelfHealEnabled", "Invoke-Intraday1mSelfHeal", "intraday_1m_self_heal_triggered", "self_heal_current_batch") },
    @{ file = $watchdog; markers = @("Invoke-PublicSlotWatchdogAlert", "public-slot-shared-source-watchdog-alert.json", "MinIntraday1mCoverage", "ready_ge35 coverage 低於") }
  )) {
    if (-not (Test-Path -LiteralPath $item.file)) {
      $checks.Add([ordered]@{ file = $item.file; ok = $false; missingFile = $true; missingMarkers = @($item.markers) })
      continue
    }
    $text = Get-Content -LiteralPath $item.file -Raw -ErrorAction Stop
    $missing = @($item.markers | Where-Object { -not $text.Contains($_) })
    $checks.Add([ordered]@{ file = $item.file; ok = ($missing.Count -eq 0); missingFile = $false; missingMarkers = $missing })
  }
  return @($checks)
}

function Get-TaskEvidence {
  $names = @(
    "Fuman Public Slot Shared Source 0800",
    "Fuman Public Slot Shared Source Watchdog"
  )
  $items = New-Object System.Collections.Generic.List[object]
  foreach ($name in $names) {
    try {
      $task = Get-ScheduledTask -TaskName $name -ErrorAction Stop
      $info = Get-ScheduledTaskInfo -TaskName $name -ErrorAction SilentlyContinue
      $items.Add([ordered]@{
        taskName = $name
        ok = $true
        state = [string]$task.State
        lastRunTime = if ($info) { $info.LastRunTime } else { $null }
        nextRunTime = if ($info) { $info.NextRunTime } else { $null }
        lastTaskResult = if ($info) { $info.LastTaskResult } else { $null }
      })
    } catch {
      $items.Add([ordered]@{ taskName = $name; ok = $false; error = $_.Exception.Message })
    }
  }
  return @($items)
}

function Get-AlertReceiptEvidence {
  $receipt = Join-Path $RuntimeDir "data\scan-receipts\public-slot-shared-source-watchdog-alert.json"
  if (-not (Test-Path -LiteralPath $receipt)) {
    return [ordered]@{ exists = $false; path = $receipt; note = "No alert receipt yet. This is OK if watchdog has not fired." }
  }
  try {
    $payload = Get-Content -LiteralPath $receipt -Raw -ErrorAction Stop | ConvertFrom-Json
    return [ordered]@{ exists = $true; path = $receipt; ok = Convert-ToBool $payload.ok; kind = $payload.kind; finishedAt = $payload.finishedAt; dryRun = $payload.dryRun; error = $payload.error }
  } catch {
    return [ordered]@{ exists = $true; path = $receipt; ok = $false; error = $_.Exception.Message }
  }
}

function Get-Aggregate {
  param([object[]]$Samples)
  if ($Samples.Count -le 0) { return @{} }
  return [ordered]@{
    samples = $Samples.Count
    regularSamples = @($Samples | Where-Object { $_.regularSession }).Count
    minFreshQuoteCoverage120s = [math]::Round((@($Samples | ForEach-Object { [double]$_.freshQuoteCoverage120s }) | Measure-Object -Minimum).Minimum, 4)
    minToday1mCoverage = [math]::Round((@($Samples | ForEach-Object { [double]$_.today1mCoverage }) | Measure-Object -Minimum).Minimum, 4)
    minReadyGe35Coverage = [math]::Round((@($Samples | ForEach-Object { [double]$_.readyGe35Coverage }) | Measure-Object -Minimum).Minimum, 4)
    maxIntraday1mStaleSeconds = [int]((@($Samples | ForEach-Object { [int]$_.intraday1mStaleSeconds }) | Measure-Object -Maximum).Maximum)
    maxQuoteAgeSeconds = [int]((@($Samples | ForEach-Object { [int]$_.quoteAgeSeconds }) | Measure-Object -Maximum).Maximum)
    selfHealTriggeredSamples = @($Samples | Where-Object { $_.selfHealTriggered }).Count
    latestSelfHealReason = (@($Samples | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_.selfHealReason) }) | Select-Object -Last 1).selfHealReason
  }
}

$samplesList = New-Object System.Collections.Generic.List[object]
for ($i = 1; $i -le [math]::Max(1, $Samples); $i++) {
  $samplesList.Add((Get-SourceStatusSample -Index $i))
  if ($i -lt $Samples -and $IntervalSeconds -gt 0) {
    Start-Sleep -Seconds $IntervalSeconds
  }
}

$samplesArray = @($samplesList.ToArray())
$allIssues = @($samplesArray | ForEach-Object { $_.issues } | ForEach-Object { $_ })
$allWarnings = @($samplesArray | ForEach-Object { $_.warnings } | ForEach-Object { $_ })
$aggregate = Get-Aggregate -Samples $samplesArray
if ($RequireRegular -and [int]$aggregate.regularSamples -le 0) {
  $allIssues += [ordered]@{ code = "no_regular_session_samples"; detail = "Run during 09:00-13:35 Asia/Taipei or remove -RequireRegular." }
}

$optionalProbes = @(
  Get-OptionalSupabaseProbe -Name "fugle_source_coverage_latest" -PathAndQuery "fugle_source_coverage?source_name=eq.$([uri]::EscapeDataString($SourceName))&select=source_name,checked_at,status,quote_status,permission_status,intraday_1m_status,daily_volume_status,active_symbols,fresh_quotes_120s,today_1m_symbols,today_1m_rows,warmup_candle_count,continuous_candle_count,ready_ge_20_symbols,ready_ge_35_symbols,ready_ma20_continuous_symbols,ready_ma35_continuous_symbols,scanner_can_run_ma20,scanner_block_reason,latest_candle_time_taipei&order=checked_at.desc&limit=1",
  Get-OptionalSupabaseProbe -Name "v_fugle_intraday_1m_status_schema_sample" -PathAndQuery "v_fugle_intraday_1m_status?select=symbol,market,latest_candle_time,latest_candle_time_taipei,today_candle_count,warmup_candle_count,continuous_candle_count,ready_ma20_continuous,ready_ma35_continuous,ready_macd_continuous,ready_ge_20,ready_ge_35,ready_ge_80,ready_ge_200,updated_at&limit=1",
  Get-OptionalSupabaseProbe -Name "fugle_intraday_1m_latest_payload_sample" -PathAndQuery "fugle_intraday_1m?select=symbol,trade_date,candle_time,open,high,low,close,volume,updated_at,payload&order=candle_time.desc&limit=1"
)

$localMarkers = Test-LocalMarkers
$tasks = Get-TaskEvidence
$receipt = Get-AlertReceiptEvidence

foreach ($marker in @($localMarkers)) {
  if (-not $marker.ok) { $allWarnings += [ordered]@{ code = "local_marker_missing"; detail = $marker } }
}
foreach ($task in @($tasks)) {
  if (-not $task.ok) { $allWarnings += [ordered]@{ code = "scheduled_task_missing_or_unreadable"; detail = $task } }
}
if ($receipt.exists -and -not $receipt.ok) {
  $allWarnings += [ordered]@{ code = "watchdog_alert_receipt_not_ok"; detail = $receipt }
}

$ok = ($allIssues.Count -eq 0)
$result = [ordered]@{
  ok = $ok
  unattendedScope = "shared_source_intraday_1m_handoff_audit"
  mode = "read-only"
  projectUrl = $ProjectUrl
  sourceName = $SourceName
  branchExpected = "agent/shared-source-self-heal-20260701"
  latestExpectedCommitAtHandoff = "f733efef5c5ceeb147a33f72301c4529fc79ef19"
  handoffNotes = @(
    "Do not deploy, do not push main, do not restart writer from this audit script.",
    "08:00 warmup is expected from Direct1mPrewarmStart=08:00 and Direct1mPrewarmBars=200.",
    "09:00 regular session requires quote-derived full-universe 1m, self-heal payload fields, and watchdog coverage hard gate.",
    "Alert proof is local receipt public-slot-shared-source-watchdog-alert.json after watchdog fires."
  )
  thresholds = [ordered]@{
    minFreshQuoteCoverage120 = $MinFreshQuoteCoverage120
    minToday1mCoverage = $MinToday1mCoverage
    minReadyGe35Coverage = $MinReadyGe35Coverage
    maxIntraday1mStaleSeconds = $MaxIntraday1mStaleSeconds
    maxWatchdogRestartStaleSeconds = $MaxWatchdogRestartStaleSeconds
    maxQuoteAgeSeconds = $MaxQuoteAgeSeconds
    maxSelfHealThresholdSeconds = $MaxSelfHealThresholdSeconds
    maxSelfHealCooldownSeconds = $MaxSelfHealCooldownSeconds
  }
  aggregate = $aggregate
  issues = @($allIssues)
  warnings = @($allWarnings)
  samples = $samplesArray
  supabaseFieldProbes = $optionalProbes
  localMarkerEvidence = $localMarkers
  scheduledTaskEvidence = $tasks
  alertReceiptEvidence = $receipt
  commandsForOtherComputer = @(
    "pwsh -NoProfile -ExecutionPolicy Bypass -File .\ops\public-slot\Invoke-SharedSourceSelfHealHandoffAudit.ps1 -Samples 1",
    "pwsh -NoProfile -ExecutionPolicy Bypass -File .\ops\public-slot\Invoke-SharedSourceSelfHealHandoffAudit.ps1 -Samples 10 -IntervalSeconds 60 -RequireRegular",
    "node --use-system-ca scripts\patrol-shared-source-self-heal-window.js --samples=10 --interval-ms=60000 --require-regular"
  )
  checkedAt = (Get-Date).ToUniversalTime().ToString("o")
}

$json = $result | ConvertTo-Json -Depth 60
if (-not [string]::IsNullOrWhiteSpace($OutputPath)) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutputPath) | Out-Null
  Set-Content -LiteralPath $OutputPath -Value $json -Encoding UTF8
}
$json

if (-not $ok -and -not $NoFail) {
  exit 1
}
