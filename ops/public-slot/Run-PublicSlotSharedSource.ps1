param(
  [string]$ProjectUrl = "https://cpmpfhbzutkiecccekfr.supabase.co",
  [string]$FumanRoot = "C:\fuman-terminal",
  [string]$RuntimeDir = "C:\fuman-runtime",
  [string]$SourceName = "fugle_shared_source",
  [int]$LoopSeconds = 10,
  [int]$StaleSeconds = 120,
  [int]$SeedSymbolCount = 2000,
  [int]$QuoteKeepMinutes = 480,
  [int]$DailyVolumeRetainTradeDays = 20,
  [int]$Direct1mBatchSize = 2,
  [int]$Direct1mEverySeconds = 60,
  [int]$Direct1mIntradayTimeoutSeconds = 6,
  [int]$Direct1mHistoricalTimeoutSeconds = 8,
  [int]$Direct1mBatchTimeBudgetSeconds = 8,
  [bool]$Direct1mPrewarmEnabled = $true,
  [string]$Direct1mPrewarmStart = "07:00",
  [int]$Direct1mPrewarmSymbolCount = 300,
  [int]$Direct1mPrewarmBatchSize = 4,
  [int]$Direct1mPrewarmBars = 200,
  [int]$Direct1mPrewarmTimeBudgetSeconds = 8,
  [int]$QuoteDerived1mCandidateCount = 0,
  [int]$QuoteDerived1mMaxQuoteAgeSeconds = 120,
  [int]$QuoteDerivedOpeningBackfillMinutes = 6,
  [int]$Intraday1mFreshTargetSeconds = 60,
  [int]$Intraday1mFreshHardSeconds = 120,
  [bool]$Intraday1mSelfHealEnabled = $true,
  [int]$Intraday1mSelfHealStaleSeconds = 75,
  [int]$Intraday1mSelfHealCooldownSeconds = 30,
  [int]$RestQuoteBatchSize = 10,
  [int]$RestQuoteEverySeconds = 20,
  [int]$RestQuoteDelayMilliseconds = 2000,
  [int]$RestQuoteTimeoutSeconds = 4,
  [int]$RestQuoteBatchTimeBudgetSeconds = 10,
  [int]$RestQuoteRateLimitCooldownSeconds = 60,
  [int]$RestQuoteBypassMinFreshQuotes = 1500,
  [double]$RestQuoteBypassCoverageRatio = 0.9,
  [int]$RestQuoteBypassMaxAgeSeconds = 90,
  [string]$OpeningBoostStart = "08:45",
  [string]$OpeningBoostEnd = "13:30",
  [int]$RestQuoteOpeningBoostBatchSize = 10,
  [int]$RestQuoteOpeningBoostDelayMilliseconds = 2000,
  [int]$FugleCollectorOpeningBoostBatchSize = 20,
  [int]$FugleCollectorOpeningBoostConcurrency = 1,
  [int]$FugleCollectorOpeningBoostDelayMilliseconds = 4000,
  [bool]$FugleCollectorFinMindRecoveryEnabled = $true,
  [int]$FugleCollectorFinMindRecoveryTimeoutMilliseconds = 30000,
  [int]$FugleCollectorLoopMilliseconds = 1000,
  [int]$FugleCollectorBatchSize = 20,
  [int]$FugleCollectorConcurrency = 1,
  [int]$FugleCollectorRequestDelayMilliseconds = 4000,
  [int]$FugleCollectorAdaptiveInitialRpm = 20,
  [int]$FugleCollectorAdaptiveMinRpm = 10,
  [int]$FugleCollectorAdaptiveMaxRpm = 40,
  [int]$FugleCollector429CooldownMilliseconds = 180000,
  [int]$FugleCollector429WindowMilliseconds = 900000,
  [int]$FugleCollector429Budget = 1,
  [int]$FugleCollector429MaxCooldownMilliseconds = 900000,
  [int]$FugleCollectorPriorityOnlyAfter429Milliseconds = 600000,
  [int]$FugleCollectorQuoteTtlMilliseconds = 120000,
  [int]$MinAvgVolume5Lots = 0,
  [int]$MinCumulativeBidAskLots = 3000,
  [int]$FutoptQuoteBatchSize = 20,
  [int]$FutoptQuoteEverySeconds = 60,
  [int]$FutoptQuoteDelayMilliseconds = 500,
  [int]$FutoptQuoteTimeoutSeconds = 5,
  [int]$FutoptQuoteTimeBudgetSeconds = 10,
  [bool]$FutoptQuoteFullDetect = $true,
  [int]$FutoptTickersEverySeconds = 300,
  [int]$PublicSlotUpsertTimeoutSec = 45,
  [int]$PublicSlotUpsertBatchSize = 300,
  [bool]$WritePreopenRows = $true,
  [ValidateSet("always", "preopen", "never")]
  [string]$WritePreopenRowsMode = "preopen",
  [bool]$Strategy2ReadyRefreshEnabled = $false,
  [int]$Strategy2ReadyPageSize = 100,
  [int]$Strategy2ReadyMaxPages = 120,
  [int]$Strategy2ReadyRefreshEverySeconds = 60,
  [string]$BlacklistCsvUrl = "",
  [string]$BlacklistFile = "C:\fuman-runtime\config\fugle-api-blacklist-symbols.txt",
  [string]$StopAt = "14:05",
  [string]$WriterOwnerComputer = "",
  [switch]$ReadOnlyMonitor,
  [switch]$Once,
  [switch]$NoStartCollector
)

# progressive quote fill: keep Fugle as primary source, fill missing symbols in small rolling batches to avoid 429.
$ErrorActionPreference = "Continue"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SourceHelper = Join-Path $ScriptDir "SupabasePublicSlotSource.ps1"
$LogDir = Join-Path $ScriptDir "runtime"
$RuntimeConfigFile = Join-Path $RuntimeDir "config\public-slot-shared-source.json"
$StateFile = Join-Path $LogDir "public-slot-minute-state.json"
$Direct1mStateFile = Join-Path $LogDir "public-slot-direct-1m-state.json"
$Direct1mPrewarmStateFile = Join-Path $LogDir "public-slot-direct-1m-prewarm-state.json"
$Intraday1mSelfHealStateFile = Join-Path $LogDir "public-slot-intraday-1m-self-heal-state.json"
$RestQuoteStateFile = Join-Path $LogDir "public-slot-rest-quote-state.json"
$PrioritySymbolsFile = Join-Path $RuntimeDir "cache\intraday\fugle-ws-priority-symbols.json"
$FutoptQuoteStateFile = Join-Path $LogDir "public-slot-futopt-quote-state.json"
$FutoptTickersCacheFile = Join-Path $LogDir "public-slot-futopt-tickers-cache.json"
$BlacklistCacheFile = Join-Path $LogDir "fugle-api-blacklist-symbols-cache.txt"
$LogFile = Join-Path $LogDir ("public-slot-shared-source-{0}.log" -f (Get-Date -Format "yyyyMMdd"))
$SourceContractVersion = "fugle-source-contract-20260629-01"
$WriterVersion = "public-slot-shared-source-20260629-01"
$script:VolumeQualifiedSymbols = $null
$script:VolumeQualifiedSymbolsAt = [datetime]::MinValue
$script:ActiveCommonStockSymbols = $null
$script:ActiveCommonStockSymbolsAt = [datetime]::MinValue
$script:ApiUniverseStats = @{
  raw_candidates = 0
  blacklist_filtered = 0
  avg_volume5_eligible = 0
  avg_volume5_filtered = 0
  quote_liquidity_eligible = 0
  quote_liquidity_filtered = 0
  daytrade_hot_symbols = 0
  priority_strong_symbols = 0
  priority_symbols = 0
  strategy_priority_symbols = 0
  terminal_priority_symbols = 0
  three_day_open_high_fade_symbols = 0
  opening_priority_symbols = 0
  dynamic_amplitude_bull_symbols = 0
  dynamic_volume_surge_symbols = 0
  dynamic_mother_pool_symbols = 0
  eligible_quote_rows = 0
  eligible_quote_coverage = 0
  mother_pool_source = ""
  mother_pool_symbols = 0
  mother_pool_filtered = 0
  quotes_ok = $false
  intraday_1m_ok = $false
  daily_volume_ok = $false
}
$script:FreshQuoteReadthroughRows = 0
$script:FreshQuoteReadthroughMergedRows = 0
$script:FreshQuoteReadthroughReason = ""
$script:StrategyPrioritySymbols = $null
$script:StrategyPrioritySymbolsAt = [datetime]::MinValue
$script:TerminalPrioritySymbols = $null
$script:TerminalPrioritySymbolsAt = [datetime]::MinValue
$script:ThreeDayOpenHighFadeSymbols = $null
$script:ThreeDayOpenHighFadeSymbolsAt = [datetime]::MinValue
$script:DailyBullAlignedSymbols = $null
$script:DailyBullAlignedSymbolsAt = [datetime]::MinValue
$script:AvgVolume5Map = $null
$script:AvgVolume5MapAt = [datetime]::MinValue

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Write-Log {
  param([string]$Message)
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Write-Host $line
  Add-Content -LiteralPath $LogFile -Value $line -Encoding utf8
}

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

function Read-JsonFile {
  param([string]$Path, [object]$Default = $null)
  try {
    if (Test-Path -LiteralPath $Path) {
      return Get-Content -LiteralPath $Path -Raw -ErrorAction Stop | ConvertFrom-Json -Depth 80
    }
  } catch {}
  return $Default
}

function Write-JsonFile {
  param([string]$Path, [object]$Value)
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
  $Value | ConvertTo-Json -Depth 80 | Set-Content -LiteralPath $Path -Encoding utf8
}

function Get-ObjectPropertyValue {
  param([object]$Object, [string[]]$Names)
  if ($null -eq $Object) { return $null }
  foreach ($name in $Names) {
    if ($Object -is [System.Collections.IDictionary] -and $Object.Contains($name)) {
      $value = $Object[$name]
      if ($null -ne $value -and -not [string]::IsNullOrWhiteSpace([string]$value)) { return $value }
    }
    $property = $Object.PSObject.Properties[$name]
    if ($null -ne $property -and $null -ne $property.Value -and -not [string]::IsNullOrWhiteSpace([string]$property.Value)) {
      return $property.Value
    }
  }
  return $null
}

function Get-ObjectPathValue {
  param([object]$Object, [string]$Path)
  if ($null -eq $Object -or [string]::IsNullOrWhiteSpace($Path)) { return $null }
  $current = $Object
  foreach ($part in @($Path -split "\.")) {
    if ($null -eq $current) { return $null }
    if ($current -is [System.Collections.IDictionary]) {
      if (-not $current.Contains($part)) { return $null }
      $current = $current[$part]
      continue
    }
    $property = $current.PSObject.Properties[$part]
    if ($null -eq $property) { return $null }
    $current = $property.Value
  }
  return $current
}

function Set-RuntimeOverride {
  param(
    [object]$Config,
    [string]$VariableName,
    [string[]]$ConfigNames,
    [string]$EnvName,
    [ValidateSet("int", "bool", "string", "double")][string]$Type = "int"
  )
  $value = Get-ObjectPropertyValue -Object $Config -Names $ConfigNames
  $envValue = if (-not [string]::IsNullOrWhiteSpace($EnvName)) { [Environment]::GetEnvironmentVariable($EnvName) } else { $null }
  if (-not [string]::IsNullOrWhiteSpace($envValue)) {
    $value = $envValue
  }
  if ($null -eq $value -or [string]::IsNullOrWhiteSpace([string]$value)) { return }
  switch ($Type) {
    "bool" {
      $text = ([string]$value).Trim()
      $boolValue = $text -match "^(1|true|yes|on)$"
      if ($text -match "^(0|false|no|off)$") { $boolValue = $false }
      Set-Variable -Name $VariableName -Value $boolValue -Scope Script
      break
    }
    "string" {
      Set-Variable -Name $VariableName -Value ([string]$value) -Scope Script
      break
    }
    "double" {
      Set-Variable -Name $VariableName -Value ([double]$value) -Scope Script
      break
    }
    default {
      Set-Variable -Name $VariableName -Value ([int]$value) -Scope Script
      break
    }
  }
}

function Apply-PublicSlotRuntimeConfig {
  $config = Read-JsonFile -Path $RuntimeConfigFile -Default $null
  Set-RuntimeOverride -Config $config -VariableName "LoopSeconds" -ConfigNames @("loopSeconds", "LoopSeconds") -EnvName "FUMAN_PUBLIC_SLOT_LOOP_SECONDS"
  Set-RuntimeOverride -Config $config -VariableName "StopAt" -ConfigNames @("stopAt", "StopAt") -EnvName "FUMAN_PUBLIC_SLOT_STOP_AT" -Type "string"
  Set-RuntimeOverride -Config $config -VariableName "RestQuoteBatchSize" -ConfigNames @("restQuoteBatchSize", "RestQuoteBatchSize") -EnvName "FUMAN_PUBLIC_SLOT_REST_QUOTE_BATCH_SIZE"
  Set-RuntimeOverride -Config $config -VariableName "RestQuoteEverySeconds" -ConfigNames @("restQuoteEverySeconds", "RestQuoteEverySeconds") -EnvName "FUMAN_PUBLIC_SLOT_REST_QUOTE_EVERY_SECONDS"
  Set-RuntimeOverride -Config $config -VariableName "RestQuoteDelayMilliseconds" -ConfigNames @("restQuoteDelayMilliseconds", "RestQuoteDelayMilliseconds") -EnvName "FUMAN_PUBLIC_SLOT_REST_QUOTE_DELAY_MS"
  Set-RuntimeOverride -Config $config -VariableName "RestQuoteTimeoutSeconds" -ConfigNames @("restQuoteTimeoutSeconds", "RestQuoteTimeoutSeconds") -EnvName "FUMAN_PUBLIC_SLOT_REST_QUOTE_TIMEOUT_SECONDS"
  Set-RuntimeOverride -Config $config -VariableName "RestQuoteBatchTimeBudgetSeconds" -ConfigNames @("restQuoteBatchTimeBudgetSeconds", "RestQuoteBatchTimeBudgetSeconds") -EnvName "FUMAN_PUBLIC_SLOT_REST_QUOTE_BATCH_TIME_BUDGET_SECONDS"
  Set-RuntimeOverride -Config $config -VariableName "RestQuoteRateLimitCooldownSeconds" -ConfigNames @("restQuoteRateLimitCooldownSeconds", "RestQuoteRateLimitCooldownSeconds") -EnvName "FUMAN_PUBLIC_SLOT_REST_QUOTE_RATE_LIMIT_COOLDOWN_SECONDS"
  Set-RuntimeOverride -Config $config -VariableName "RestQuoteBypassMinFreshQuotes" -ConfigNames @("restQuoteBypassMinFreshQuotes", "RestQuoteBypassMinFreshQuotes") -EnvName "FUMAN_PUBLIC_SLOT_REST_QUOTE_BYPASS_MIN_FRESH_QUOTES"
  Set-RuntimeOverride -Config $config -VariableName "RestQuoteBypassCoverageRatio" -ConfigNames @("restQuoteBypassCoverageRatio", "RestQuoteBypassCoverageRatio") -EnvName "FUMAN_PUBLIC_SLOT_REST_QUOTE_BYPASS_COVERAGE_RATIO" -Type "double"
  Set-RuntimeOverride -Config $config -VariableName "RestQuoteBypassMaxAgeSeconds" -ConfigNames @("restQuoteBypassMaxAgeSeconds", "RestQuoteBypassMaxAgeSeconds") -EnvName "FUMAN_PUBLIC_SLOT_REST_QUOTE_BYPASS_MAX_AGE_SECONDS"
  Set-RuntimeOverride -Config $config -VariableName "OpeningBoostStart" -ConfigNames @("openingBoostStart", "OpeningBoostStart") -EnvName "FUMAN_PUBLIC_SLOT_OPENING_BOOST_START" -Type "string"
  Set-RuntimeOverride -Config $config -VariableName "OpeningBoostEnd" -ConfigNames @("openingBoostEnd", "OpeningBoostEnd") -EnvName "FUMAN_PUBLIC_SLOT_OPENING_BOOST_END" -Type "string"
  Set-RuntimeOverride -Config $config -VariableName "RestQuoteOpeningBoostBatchSize" -ConfigNames @("restQuoteOpeningBoostBatchSize", "RestQuoteOpeningBoostBatchSize") -EnvName "FUMAN_PUBLIC_SLOT_REST_QUOTE_OPENING_BOOST_BATCH_SIZE"
  Set-RuntimeOverride -Config $config -VariableName "RestQuoteOpeningBoostDelayMilliseconds" -ConfigNames @("restQuoteOpeningBoostDelayMilliseconds", "RestQuoteOpeningBoostDelayMilliseconds") -EnvName "FUMAN_PUBLIC_SLOT_REST_QUOTE_OPENING_BOOST_DELAY_MS"
  Set-RuntimeOverride -Config $config -VariableName "FugleCollectorOpeningBoostBatchSize" -ConfigNames @("fugleCollectorOpeningBoostBatchSize", "FugleCollectorOpeningBoostBatchSize") -EnvName "FUMAN_PUBLIC_SLOT_FUGLE_COLLECTOR_OPENING_BOOST_BATCH_SIZE"
  Set-RuntimeOverride -Config $config -VariableName "FugleCollectorOpeningBoostConcurrency" -ConfigNames @("fugleCollectorOpeningBoostConcurrency", "FugleCollectorOpeningBoostConcurrency") -EnvName "FUMAN_PUBLIC_SLOT_FUGLE_COLLECTOR_OPENING_BOOST_CONCURRENCY"
  Set-RuntimeOverride -Config $config -VariableName "FugleCollectorOpeningBoostDelayMilliseconds" -ConfigNames @("fugleCollectorOpeningBoostDelayMilliseconds", "FugleCollectorOpeningBoostDelayMilliseconds") -EnvName "FUMAN_PUBLIC_SLOT_FUGLE_COLLECTOR_OPENING_BOOST_DELAY_MS"
  Set-RuntimeOverride -Config $config -VariableName "FugleCollectorFinMindRecoveryEnabled" -ConfigNames @("fugleCollectorFinMindRecoveryEnabled", "FugleCollectorFinMindRecoveryEnabled") -EnvName "FUMAN_PUBLIC_SLOT_FUGLE_COLLECTOR_FINMIND_RECOVERY_ENABLED" -Type "bool"
  Set-RuntimeOverride -Config $config -VariableName "FugleCollectorFinMindRecoveryTimeoutMilliseconds" -ConfigNames @("fugleCollectorFinMindRecoveryTimeoutMilliseconds", "FugleCollectorFinMindRecoveryTimeoutMilliseconds") -EnvName "FUMAN_PUBLIC_SLOT_FUGLE_COLLECTOR_FINMIND_RECOVERY_TIMEOUT_MS"
  Set-RuntimeOverride -Config $config -VariableName "FugleCollectorLoopMilliseconds" -ConfigNames @("fugleCollectorLoopMilliseconds", "FugleCollectorLoopMilliseconds") -EnvName "FUMAN_PUBLIC_SLOT_FUGLE_COLLECTOR_LOOP_MS"
  Set-RuntimeOverride -Config $config -VariableName "FugleCollectorBatchSize" -ConfigNames @("fugleCollectorBatchSize", "FugleCollectorBatchSize") -EnvName "FUMAN_PUBLIC_SLOT_FUGLE_COLLECTOR_BATCH_SIZE"
  Set-RuntimeOverride -Config $config -VariableName "FugleCollectorConcurrency" -ConfigNames @("fugleCollectorConcurrency", "FugleCollectorConcurrency") -EnvName "FUMAN_PUBLIC_SLOT_FUGLE_COLLECTOR_CONCURRENCY"
  Set-RuntimeOverride -Config $config -VariableName "FugleCollectorRequestDelayMilliseconds" -ConfigNames @("fugleCollectorRequestDelayMilliseconds", "FugleCollectorRequestDelayMilliseconds") -EnvName "FUMAN_PUBLIC_SLOT_FUGLE_COLLECTOR_REQUEST_DELAY_MS"
  Set-RuntimeOverride -Config $config -VariableName "FugleCollectorAdaptiveInitialRpm" -ConfigNames @("fugleCollectorAdaptiveInitialRpm", "FugleCollectorAdaptiveInitialRpm") -EnvName "FUMAN_PUBLIC_SLOT_FUGLE_COLLECTOR_ADAPTIVE_INITIAL_RPM"
  Set-RuntimeOverride -Config $config -VariableName "FugleCollectorAdaptiveMinRpm" -ConfigNames @("fugleCollectorAdaptiveMinRpm", "FugleCollectorAdaptiveMinRpm") -EnvName "FUMAN_PUBLIC_SLOT_FUGLE_COLLECTOR_ADAPTIVE_MIN_RPM"
  Set-RuntimeOverride -Config $config -VariableName "FugleCollectorAdaptiveMaxRpm" -ConfigNames @("fugleCollectorAdaptiveMaxRpm", "FugleCollectorAdaptiveMaxRpm") -EnvName "FUMAN_PUBLIC_SLOT_FUGLE_COLLECTOR_ADAPTIVE_MAX_RPM"
  Set-RuntimeOverride -Config $config -VariableName "FugleCollector429CooldownMilliseconds" -ConfigNames @("fugleCollector429CooldownMilliseconds", "FugleCollector429CooldownMilliseconds") -EnvName "FUMAN_PUBLIC_SLOT_FUGLE_COLLECTOR_429_COOLDOWN_MS"
  Set-RuntimeOverride -Config $config -VariableName "FugleCollector429WindowMilliseconds" -ConfigNames @("fugleCollector429WindowMilliseconds", "FugleCollector429WindowMilliseconds") -EnvName "FUMAN_PUBLIC_SLOT_FUGLE_COLLECTOR_429_WINDOW_MS"
  Set-RuntimeOverride -Config $config -VariableName "FugleCollector429Budget" -ConfigNames @("fugleCollector429Budget", "FugleCollector429Budget") -EnvName "FUMAN_PUBLIC_SLOT_FUGLE_COLLECTOR_429_BUDGET"
  Set-RuntimeOverride -Config $config -VariableName "FugleCollector429MaxCooldownMilliseconds" -ConfigNames @("fugleCollector429MaxCooldownMilliseconds", "FugleCollector429MaxCooldownMilliseconds") -EnvName "FUMAN_PUBLIC_SLOT_FUGLE_COLLECTOR_429_MAX_COOLDOWN_MS"
  Set-RuntimeOverride -Config $config -VariableName "FugleCollectorPriorityOnlyAfter429Milliseconds" -ConfigNames @("fugleCollectorPriorityOnlyAfter429Milliseconds", "FugleCollectorPriorityOnlyAfter429Milliseconds") -EnvName "FUMAN_PUBLIC_SLOT_FUGLE_COLLECTOR_PRIORITY_ONLY_AFTER_429_MS"
  Set-RuntimeOverride -Config $config -VariableName "FugleCollectorQuoteTtlMilliseconds" -ConfigNames @("fugleCollectorQuoteTtlMilliseconds", "FugleCollectorQuoteTtlMilliseconds") -EnvName "FUMAN_PUBLIC_SLOT_FUGLE_COLLECTOR_QUOTE_TTL_MS"
  Set-RuntimeOverride -Config $config -VariableName "Direct1mBatchSize" -ConfigNames @("direct1mBatchSize", "Direct1mBatchSize") -EnvName "FUMAN_PUBLIC_SLOT_DIRECT_1M_BATCH_SIZE"
  Set-RuntimeOverride -Config $config -VariableName "Direct1mEverySeconds" -ConfigNames @("direct1mEverySeconds", "Direct1mEverySeconds") -EnvName "FUMAN_PUBLIC_SLOT_DIRECT_1M_EVERY_SECONDS"
  Set-RuntimeOverride -Config $config -VariableName "Direct1mIntradayTimeoutSeconds" -ConfigNames @("direct1mIntradayTimeoutSeconds", "Direct1mIntradayTimeoutSeconds") -EnvName "FUMAN_PUBLIC_SLOT_DIRECT_1M_INTRADAY_TIMEOUT_SECONDS"
  Set-RuntimeOverride -Config $config -VariableName "Direct1mHistoricalTimeoutSeconds" -ConfigNames @("direct1mHistoricalTimeoutSeconds", "Direct1mHistoricalTimeoutSeconds") -EnvName "FUMAN_PUBLIC_SLOT_DIRECT_1M_HISTORICAL_TIMEOUT_SECONDS"
  Set-RuntimeOverride -Config $config -VariableName "Direct1mBatchTimeBudgetSeconds" -ConfigNames @("direct1mBatchTimeBudgetSeconds", "Direct1mBatchTimeBudgetSeconds") -EnvName "FUMAN_PUBLIC_SLOT_DIRECT_1M_BATCH_TIME_BUDGET_SECONDS"
  Set-RuntimeOverride -Config $config -VariableName "Direct1mPrewarmEnabled" -ConfigNames @("direct1mPrewarmEnabled", "Direct1mPrewarmEnabled") -EnvName "FUMAN_PUBLIC_SLOT_DIRECT_1M_PREWARM_ENABLED" -Type "bool"
  Set-RuntimeOverride -Config $config -VariableName "Direct1mPrewarmStart" -ConfigNames @("direct1mPrewarmStart", "Direct1mPrewarmStart") -EnvName "FUMAN_PUBLIC_SLOT_DIRECT_1M_PREWARM_START" -Type "string"
  Set-RuntimeOverride -Config $config -VariableName "Direct1mPrewarmSymbolCount" -ConfigNames @("direct1mPrewarmSymbolCount", "Direct1mPrewarmSymbolCount") -EnvName "FUMAN_PUBLIC_SLOT_DIRECT_1M_PREWARM_SYMBOL_COUNT"
  Set-RuntimeOverride -Config $config -VariableName "Direct1mPrewarmBatchSize" -ConfigNames @("direct1mPrewarmBatchSize", "Direct1mPrewarmBatchSize") -EnvName "FUMAN_PUBLIC_SLOT_DIRECT_1M_PREWARM_BATCH_SIZE"
  Set-RuntimeOverride -Config $config -VariableName "Direct1mPrewarmBars" -ConfigNames @("direct1mPrewarmBars", "Direct1mPrewarmBars") -EnvName "FUMAN_PUBLIC_SLOT_DIRECT_1M_PREWARM_BARS"
  Set-RuntimeOverride -Config $config -VariableName "Direct1mPrewarmTimeBudgetSeconds" -ConfigNames @("direct1mPrewarmTimeBudgetSeconds", "Direct1mPrewarmTimeBudgetSeconds") -EnvName "FUMAN_PUBLIC_SLOT_DIRECT_1M_PREWARM_TIME_BUDGET_SECONDS"
  Set-RuntimeOverride -Config $config -VariableName "QuoteDerived1mCandidateCount" -ConfigNames @("quoteDerived1mCandidateCount", "QuoteDerived1mCandidateCount") -EnvName "FUMAN_PUBLIC_SLOT_QUOTE_DERIVED_1M_CANDIDATE_COUNT"
  Set-RuntimeOverride -Config $config -VariableName "QuoteDerived1mMaxQuoteAgeSeconds" -ConfigNames @("quoteDerived1mMaxQuoteAgeSeconds", "QuoteDerived1mMaxQuoteAgeSeconds") -EnvName "FUMAN_PUBLIC_SLOT_QUOTE_DERIVED_1M_MAX_QUOTE_AGE_SECONDS"
  Set-RuntimeOverride -Config $config -VariableName "QuoteDerivedOpeningBackfillMinutes" -ConfigNames @("quoteDerivedOpeningBackfillMinutes", "QuoteDerivedOpeningBackfillMinutes") -EnvName "FUMAN_PUBLIC_SLOT_QUOTE_DERIVED_OPENING_BACKFILL_MINUTES"
  Set-RuntimeOverride -Config $config -VariableName "Intraday1mFreshTargetSeconds" -ConfigNames @("intraday1mFreshTargetSeconds", "Intraday1mFreshTargetSeconds") -EnvName "FUMAN_PUBLIC_SLOT_INTRADAY_1M_FRESH_TARGET_SECONDS"
  Set-RuntimeOverride -Config $config -VariableName "Intraday1mFreshHardSeconds" -ConfigNames @("intraday1mFreshHardSeconds", "Intraday1mFreshHardSeconds") -EnvName "FUMAN_PUBLIC_SLOT_INTRADAY_1M_FRESH_HARD_SECONDS"
  Set-RuntimeOverride -Config $config -VariableName "Intraday1mSelfHealEnabled" -ConfigNames @("intraday1mSelfHealEnabled", "Intraday1mSelfHealEnabled") -EnvName "FUMAN_PUBLIC_SLOT_INTRADAY_1M_SELF_HEAL_ENABLED" -Type "bool"
  Set-RuntimeOverride -Config $config -VariableName "Intraday1mSelfHealStaleSeconds" -ConfigNames @("intraday1mSelfHealStaleSeconds", "Intraday1mSelfHealStaleSeconds") -EnvName "FUMAN_PUBLIC_SLOT_INTRADAY_1M_SELF_HEAL_STALE_SECONDS"
  Set-RuntimeOverride -Config $config -VariableName "Intraday1mSelfHealCooldownSeconds" -ConfigNames @("intraday1mSelfHealCooldownSeconds", "Intraday1mSelfHealCooldownSeconds") -EnvName "FUMAN_PUBLIC_SLOT_INTRADAY_1M_SELF_HEAL_COOLDOWN_SECONDS"
  Set-RuntimeOverride -Config $config -VariableName "MinAvgVolume5Lots" -ConfigNames @("minAvgVolume5Lots", "MinAvgVolume5Lots") -EnvName "FUMAN_PUBLIC_SLOT_MIN_AVG_VOLUME5_LOTS"
  Set-RuntimeOverride -Config $config -VariableName "MinCumulativeBidAskLots" -ConfigNames @("minCumulativeBidAskLots", "MinCumulativeBidAskLots") -EnvName "FUMAN_PUBLIC_SLOT_MIN_CUMULATIVE_BID_ASK_LOTS"
  Set-RuntimeOverride -Config $config -VariableName "FutoptQuoteBatchSize" -ConfigNames @("futoptQuoteBatchSize", "FutoptQuoteBatchSize") -EnvName "FUMAN_PUBLIC_SLOT_FUTOPT_QUOTE_BATCH_SIZE"
  Set-RuntimeOverride -Config $config -VariableName "FutoptQuoteEverySeconds" -ConfigNames @("futoptQuoteEverySeconds", "FutoptQuoteEverySeconds") -EnvName "FUMAN_PUBLIC_SLOT_FUTOPT_QUOTE_EVERY_SECONDS"
  Set-RuntimeOverride -Config $config -VariableName "FutoptQuoteDelayMilliseconds" -ConfigNames @("futoptQuoteDelayMilliseconds", "FutoptQuoteDelayMilliseconds") -EnvName "FUMAN_PUBLIC_SLOT_FUTOPT_QUOTE_DELAY_MS"
  Set-RuntimeOverride -Config $config -VariableName "FutoptQuoteTimeoutSeconds" -ConfigNames @("futoptQuoteTimeoutSeconds", "FutoptQuoteTimeoutSeconds") -EnvName "FUMAN_PUBLIC_SLOT_FUTOPT_QUOTE_TIMEOUT_SECONDS"
  Set-RuntimeOverride -Config $config -VariableName "FutoptQuoteTimeBudgetSeconds" -ConfigNames @("futoptQuoteTimeBudgetSeconds", "FutoptQuoteTimeBudgetSeconds") -EnvName "FUMAN_PUBLIC_SLOT_FUTOPT_QUOTE_TIME_BUDGET_SECONDS"
  Set-RuntimeOverride -Config $config -VariableName "FutoptQuoteFullDetect" -ConfigNames @("futoptQuoteFullDetect", "FutoptQuoteFullDetect") -EnvName "FUMAN_PUBLIC_SLOT_FUTOPT_QUOTE_FULL_DETECT" -Type "bool"
  Set-RuntimeOverride -Config $config -VariableName "FutoptTickersEverySeconds" -ConfigNames @("futoptTickersEverySeconds", "FutoptTickersEverySeconds") -EnvName "FUMAN_PUBLIC_SLOT_FUTOPT_TICKERS_EVERY_SECONDS"
  Set-RuntimeOverride -Config $config -VariableName "PublicSlotUpsertTimeoutSec" -ConfigNames @("publicSlotUpsertTimeoutSec", "upsertTimeoutSec", "PublicSlotUpsertTimeoutSec") -EnvName "FUMAN_PUBLIC_SLOT_UPSERT_TIMEOUT_SEC"
  Set-RuntimeOverride -Config $config -VariableName "PublicSlotUpsertBatchSize" -ConfigNames @("publicSlotUpsertBatchSize", "upsertBatchSize", "PublicSlotUpsertBatchSize") -EnvName "FUMAN_PUBLIC_SLOT_UPSERT_BATCH_SIZE"
  Set-RuntimeOverride -Config $config -VariableName "WritePreopenRows" -ConfigNames @("writePreopenRows", "WritePreopenRows") -EnvName "FUMAN_PUBLIC_SLOT_WRITE_PREOPEN_ROWS" -Type "bool"
  Set-RuntimeOverride -Config $config -VariableName "WritePreopenRowsMode" -ConfigNames @("writePreopenRowsMode", "WritePreopenRowsMode") -EnvName "FUMAN_PUBLIC_SLOT_WRITE_PREOPEN_ROWS_MODE" -Type "string"
  Set-RuntimeOverride -Config $config -VariableName "Strategy2ReadyRefreshEnabled" -ConfigNames @("strategy2ReadyRefreshEnabled", "Strategy2ReadyRefreshEnabled") -EnvName "FUMAN_PUBLIC_SLOT_STRATEGY2_READY_REFRESH_ENABLED" -Type "bool"
  Set-RuntimeOverride -Config $config -VariableName "Strategy2ReadyPageSize" -ConfigNames @("strategy2ReadyPageSize", "Strategy2ReadyPageSize") -EnvName "FUMAN_PUBLIC_SLOT_STRATEGY2_READY_PAGE_SIZE"
  Set-RuntimeOverride -Config $config -VariableName "Strategy2ReadyMaxPages" -ConfigNames @("strategy2ReadyMaxPages", "Strategy2ReadyMaxPages") -EnvName "FUMAN_PUBLIC_SLOT_STRATEGY2_READY_MAX_PAGES"
  Set-RuntimeOverride -Config $config -VariableName "Strategy2ReadyRefreshEverySeconds" -ConfigNames @("strategy2ReadyRefreshEverySeconds", "Strategy2ReadyRefreshEverySeconds") -EnvName "FUMAN_PUBLIC_SLOT_STRATEGY2_READY_REFRESH_EVERY_SECONDS"
  Set-RuntimeOverride -Config $config -VariableName "WriterOwnerComputer" -ConfigNames @("writerOwnerComputer", "WriterOwnerComputer") -EnvName "FUMAN_PUBLIC_SLOT_WRITER_OWNER_COMPUTER" -Type "string"
  Set-RuntimeOverride -Config $config -VariableName "ReadOnlyMonitor" -ConfigNames @("readOnlyMonitor", "ReadOnlyMonitor") -EnvName "FUMAN_PUBLIC_SLOT_READ_ONLY_MONITOR" -Type "bool"
  $env:FUMAN_PUBLIC_SLOT_UPSERT_TIMEOUT_SEC = [string]$PublicSlotUpsertTimeoutSec
  $env:FUMAN_PUBLIC_SLOT_UPSERT_BATCH_SIZE = [string]$PublicSlotUpsertBatchSize
}

function Test-WriterOwnerComputerAllowed {
  param([string]$AllowedComputers)
  if ([string]::IsNullOrWhiteSpace($AllowedComputers)) { return $true }
  $current = ([string]$env:COMPUTERNAME).Trim().ToUpperInvariant()
  if ([string]::IsNullOrWhiteSpace($current)) { return $false }
  $allowed = @($AllowedComputers -split "[,; ]+" | ForEach-Object { ([string]$_).Trim().ToUpperInvariant() } | Where-Object { $_ })
  return ($allowed -contains $current)
}

function Assert-PublicSlotWriterOwner {
  if ([bool]$ReadOnlyMonitor) {
    Write-Log "Read-only monitor mode requested on computer=$env:COMPUTERNAME; writer PS1 exits before any Supabase/cache/runtime writes."
    exit 0
  }
  if (-not (Test-WriterOwnerComputerAllowed -AllowedComputers $WriterOwnerComputer)) {
    Write-Log "BLOCKED public slot writer owner mismatch current=$env:COMPUTERNAME allowed=$WriterOwnerComputer. This computer must run read-only verifiers only."
    exit 43
  }
}

function Test-ShouldWritePreopenRows {
  param([string]$Session)
  if (-not $WritePreopenRows) { return $false }
  switch ($WritePreopenRowsMode) {
    "never" { return $false }
    "preopen" { return $Session -eq "preopen" }
    default { return $true }
  }
}

function Get-Strategy2ReadyRefreshBody {
  param([int]$ReadyPage)
  $effectivePageSize = Get-Strategy2ReadyEffectivePageSize
  if ($effectivePageSize -gt 0) {
    return @{ p_page_size = $effectivePageSize; p_reset = ($ReadyPage -eq 0) }
  }
  return @{}
}

function Get-Strategy2ReadyEffectivePageSize {
  if ($Strategy2ReadyPageSize -le 0) { return 0 }
  return [math]::Max(25, [math]::Min(500, [int]$Strategy2ReadyPageSize))
}

function Get-Strategy2ReadyRefreshMaxPages {
  $pageSize = [math]::Max(1, [int](Get-Strategy2ReadyEffectivePageSize))
  $expectedPages = [int][math]::Ceiling([double]$SeedSymbolCount / [double]$pageSize)
  return [math]::Max(12, [math]::Min([math]::Max(120, [int]$Strategy2ReadyMaxPages), $expectedPages + 8))
}

function Convert-Market {
  param([string]$Market)
  switch -Regex ($Market) {
    "TPEX|OTC" { "OTC"; break }
    "TWSE|TSE" { "TSE"; break }
    default { $Market }
  }
}

function Get-Number {
  param([object]$Value)
  $text = [string]$Value
  if ([string]::IsNullOrWhiteSpace($text)) { return 0 }
  $number = 0.0
  if ([double]::TryParse(($text -replace ",", "" -replace "%", "").Trim(), [ref]$number)) { return $number }
  return 0
}

function Get-NullableNumber {
  param([object[]]$Values)
  foreach ($value in @($Values)) {
    if ($null -eq $value -or [string]::IsNullOrWhiteSpace([string]$value)) { continue }
    $number = Get-Number $value
    if ($number -ne 0) { return $number }
  }
  return $null
}

function Get-StopTimeToday {
  param([string]$HHmm)
  try {
    $parts = $HHmm.Split(":")
    return (Get-Date).Date.AddHours([int]$parts[0]).AddMinutes([int]$parts[1])
  } catch {
    return (Get-Date).Date.AddHours(14).AddMinutes(5)
  }
}

function Convert-ToIsoUtc {
  param([object]$Value, [switch]$AssumeUtc)
  if ([string]::IsNullOrWhiteSpace([string]$Value)) { return $null }
  try {
    if ($Value -is [datetime]) {
      $dt = [datetime]$Value
      if ($AssumeUtc -or $dt.Kind -eq [DateTimeKind]::Unspecified) {
        $dt = [datetime]::SpecifyKind($dt, [DateTimeKind]::Utc)
      }
      return $dt.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fff'Z'")
    }
    $text = [string]$Value
    if ($text -match '(Z|[+-]\d{2}:?\d{2})$') {
      return ([datetimeoffset]::Parse($text)).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fff'Z'")
    }
    $parsed = [datetime]::Parse($text)
    if ($AssumeUtc) { $parsed = [datetime]::SpecifyKind($parsed, [DateTimeKind]::Utc) }
    return $parsed.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fff'Z'")
  } catch {
    return $null
  }
}

function Get-QuoteTimestamp {
  param([object]$Quote, [object]$Payload)
  foreach ($candidate in @(
    @{ Value = $Quote.quoteSeenAt; AssumeUtc = $true },
    @{ Value = $Quote.updatedAt; AssumeUtc = $true },
    @{ Value = $Payload.updatedAt; AssumeUtc = $true }
  )) {
    $iso = Convert-ToIsoUtc -Value $candidate.Value -AssumeUtc:([bool]$candidate.AssumeUtc)
    if (-not [string]::IsNullOrWhiteSpace($iso)) { return $iso }
  }
  return (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fff'Z'")
}

function Get-LatestIsoUtc {
  param([object[]]$Rows, [string]$PropertyName)
  $latest = $null
  foreach ($row in @($Rows)) {
    try {
      $value = $row.$PropertyName
      if ([string]::IsNullOrWhiteSpace([string]$value)) { continue }
      $time = [datetimeoffset]::Parse([string]$value).ToUniversalTime()
      if ($null -eq $latest -or $time -gt $latest) { $latest = $time }
    } catch {}
  }
  if ($null -eq $latest) { return $null }
  return $latest.ToString("o")
}

function Get-IsoAgeSeconds {
  param([string]$IsoTime, [int]$FallbackSeconds = 999999)
  try {
    if ([string]::IsNullOrWhiteSpace($IsoTime)) { return $FallbackSeconds }
    return [int]([math]::Max(0, ((Get-Date).ToUniversalTime() - ([datetimeoffset]::Parse($IsoTime).ToUniversalTime()).UtcDateTime).TotalSeconds))
  } catch {
    return $FallbackSeconds
  }
}

function Convert-IsoUtcToTaipei {
  param([string]$IsoTime)
  try {
    if ([string]::IsNullOrWhiteSpace($IsoTime)) { return $null }
    return ([datetimeoffset]::Parse($IsoTime)).ToOffset([timespan]::FromHours(8)).ToString("yyyy-MM-ddTHH:mm:ss.fffzzz")
  } catch {
    return $null
  }
}

function Get-PublicSlotSession {
  $now = Get-Date
  $tod = $now.TimeOfDay
  if ($tod -lt [TimeSpan]::Parse("08:00")) { return "closed" }
  if ($tod -lt [TimeSpan]::Parse("09:00")) { return "preopen" }
  if ($tod -le [TimeSpan]::Parse("13:35")) { return "regular" }
  return "afterhours"
}

function Test-OpeningBoostWindow {
  try {
    $tod = (Get-Date).TimeOfDay
    return ($tod -ge [TimeSpan]::Parse($OpeningBoostStart) -and $tod -le [TimeSpan]::Parse($OpeningBoostEnd))
  } catch {
    return $false
  }
}

function Get-EffectiveRestQuoteBatchSize {
  if (Test-OpeningBoostWindow) {
    return [int][math]::Max($RestQuoteBatchSize, $RestQuoteOpeningBoostBatchSize)
  }
  return [int]$RestQuoteBatchSize
}

function Get-EffectiveRestQuoteDelayMilliseconds {
  if (Test-OpeningBoostWindow) {
    return [int][math]::Max($RestQuoteDelayMilliseconds, $RestQuoteOpeningBoostDelayMilliseconds)
  }
  return [int]$RestQuoteDelayMilliseconds
}

function Get-DateTimeOffsetOrNull {
  param([object]$Value)
  try {
    if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) { return $null }
    return [datetimeoffset]::Parse([string]$Value)
  } catch {
    return $null
  }
}

function Get-SourcePartStatus {
  param([bool]$Ok, [bool]$Required = $true)
  if ($Ok) { return "ready" }
  if (-not $Required) { return "not_required" }
  return "not_ready"
}

function Test-Intraday1mMa35Required {
  $tod = (Get-Date).TimeOfDay
  return ($tod -ge [TimeSpan]::Parse("09:01") -and $tod -le [TimeSpan]::Parse("13:35"))
}

function Test-Intraday1mMa20Required {
  $tod = (Get-Date).TimeOfDay
  return ($tod -ge [TimeSpan]::Parse("09:01") -and $tod -le [TimeSpan]::Parse("13:35"))
}

function Get-ScannerBlockReason {
  param(
    [bool]$PermissionOk,
    [bool]$QuotesOk,
    [bool]$DailyVolumeOk,
    [bool]$Intraday1mFreshOk,
    [bool]$Ma20Required,
    [bool]$Ma35Required,
    [int]$ReadyMa20ContinuousSymbols = 0,
    [int]$ReadyMa35ContinuousSymbols = 0,
    [int]$QuoteAgeSeconds = 999999,
    [string]$Session = "closed"
  )

  if (-not $PermissionOk) { return "permission_not_ready" }
  if (-not $QuotesOk) {
    if ($QuoteAgeSeconds -gt 120) { return "quote_stale" }
    return "quote_not_ready"
  }
  if (-not $DailyVolumeOk) { return "daily_volume_not_ready" }
  if ($Session -eq "regular") {
    if (-not $Intraday1mFreshOk) { return "intraday_1m_stale" }
    if ($Ma20Required -and $ReadyMa20ContinuousSymbols -le 0) { return "intraday_1m_not_ready_ma20_continuous" }
    if ($Ma35Required -and $ReadyMa35ContinuousSymbols -le 0) { return "intraday_1m_not_ready_ma35_continuous" }
  }
  return ""
}

function Invoke-PublicSlotRestGet {
  param(
    [string]$PathAndQuery,
    [switch]$LogError,
    [switch]$ThrowOnError
  )
  try {
    $headers = @{
      apikey = $serviceRoleKey
      Authorization = "Bearer $serviceRoleKey"
    }
    $uri = "$($ProjectUrl.TrimEnd('/'))/rest/v1/$PathAndQuery"
    return Invoke-RestMethod -Uri $uri -Method Get -Headers $headers -TimeoutSec 20 -ErrorAction Stop
  } catch {
    if ($LogError) {
      Write-Log "WARN REST GET failed path=$PathAndQuery error=$($_.Exception.Message)"
    }
    if ($ThrowOnError) { throw }
    return @()
  }
}

function Convert-PublicSlotRestRows {
  param([object]$Rows)
  if ($null -eq $Rows) { return @() }

  $items = @($Rows)
  if ($items.Count -eq 1 -and $null -ne $items[0]) {
    $valueProperty = $items[0].PSObject.Properties["value"]
    if ($null -ne $valueProperty -and $valueProperty.Value -is [System.Array]) {
      return @($valueProperty.Value)
    }
  }

  return @($items)
}

function Get-PayloadFieldValue {
  param([object]$Payload, [string]$Key, [object]$Default = $null)
  if ($null -eq $Payload) { return $Default }
  if ($Payload -is [System.Collections.IDictionary] -and $Payload.Contains($Key)) {
    return $Payload[$Key]
  }
  $prop = $Payload.PSObject.Properties[$Key]
  if ($null -ne $prop -and $null -ne $prop.Value) { return $prop.Value }
  return $Default
}

function Get-Strategy2LatestRunEvidence {
  param([object]$FallbackPayload = $null)

  $fallbackRunId = [string](Get-PayloadFieldValue -Payload $FallbackPayload -Key "latest_run_id" -Default (Get-PayloadFieldValue -Payload $FallbackPayload -Key "latestRunId" -Default ""))
  $fallbackScanDate = [string](Get-PayloadFieldValue -Payload $FallbackPayload -Key "strategy2_latest_scan_date" -Default "")
  $fallbackFinishedAt = [string](Get-PayloadFieldValue -Payload $FallbackPayload -Key "strategy2_latest_finished_at" -Default "")
  $fallbackStatus = [string](Get-PayloadFieldValue -Payload $FallbackPayload -Key "strategy2_readiness_status" -Default "")
  $fallbackReason = [string](Get-PayloadFieldValue -Payload $FallbackPayload -Key "strategy2_readiness_reason" -Default "")
  $fallbackCheckedAt = [string](Get-PayloadFieldValue -Payload $FallbackPayload -Key "strategy2_readiness_checked_at" -Default "")

  try {
    $rows = Convert-PublicSlotRestRows -Rows (Invoke-PublicSlotRestGet -PathAndQuery "v_strategy2_readiness_status?select=latest_run_id,latest_scan_date,latest_finished_at,status,reason,checked_at&limit=1")
    if ($rows.Count -gt 0) {
      $row = @($rows)[0]
      $runId = [string]$row.latest_run_id
      return @{
        latest_run_id = $runId
        latestRunId = $runId
        strategy2_latest_run_id = $runId
        strategy2_latest_run_id_source = if ([string]::IsNullOrWhiteSpace($runId)) { "v_strategy2_readiness_status_empty" } else { "v_strategy2_readiness_status" }
        strategy2_latest_scan_date = [string]$row.latest_scan_date
        strategy2_latest_finished_at = [string]$row.latest_finished_at
        strategy2_readiness_status = [string]$row.status
        strategy2_readiness_reason = [string]$row.reason
        strategy2_readiness_checked_at = [string]$row.checked_at
      }
    }
  } catch {
    Write-Log "WARN strategy2 latest run evidence read failed: $($_.Exception.Message)"
  }

  return @{
    latest_run_id = $fallbackRunId
    latestRunId = $fallbackRunId
    strategy2_latest_run_id = $fallbackRunId
    strategy2_latest_run_id_source = if ([string]::IsNullOrWhiteSpace($fallbackRunId)) { "missing" } else { "previous_source_status_payload" }
    strategy2_latest_scan_date = $fallbackScanDate
    strategy2_latest_finished_at = $fallbackFinishedAt
    strategy2_readiness_status = $fallbackStatus
    strategy2_readiness_reason = $fallbackReason
    strategy2_readiness_checked_at = $fallbackCheckedAt
  }
}

function Get-PublicSlotPermissionProbe {
  param([int]$CacheSeconds = 60)

  $now = Get-Date
  if ($null -ne $script:PublicSlotPermissionProbe -and $null -ne $script:PublicSlotPermissionProbeCheckedAt) {
    if (($now - $script:PublicSlotPermissionProbeCheckedAt).TotalSeconds -lt $CacheSeconds) {
      return $script:PublicSlotPermissionProbe
    }
  }

  $resources = @(
    "source_status?select=source_name&limit=1",
    "fugle_source_coverage?select=source_name&limit=1",
    "v_fugle_quotes_commonstock_active?select=symbol&limit=1",
    "v_fugle_intraday_1m_status?select=symbol&limit=1",
    "fugle_intraday_1m?select=symbol&limit=1",
    "fugle_daily_volume?select=symbol&limit=1",
    "fugle_daily_volume_avg?select=symbol&limit=1",
    "stock_tickers?select=symbol&limit=1",
    "market_calendar?select=trade_date&limit=1"
  )
  $failed = New-Object System.Collections.Generic.List[string]
  $headers = @{
    apikey = $serviceRoleKey
    Authorization = "Bearer $serviceRoleKey"
  }

  foreach ($resource in $resources) {
    try {
      $uri = "$($ProjectUrl.TrimEnd('/'))/rest/v1/$resource"
      Invoke-RestMethod -Uri $uri -Method Get -Headers $headers -TimeoutSec 10 -ErrorAction Stop | Out-Null
    } catch {
      $failed.Add($resource.Split("?")[0])
    }
  }

  $probe = @{
    ok = ($failed.Count -eq 0)
    status = if ($failed.Count -eq 0) { "ready" } else { "not_ready" }
    failed_resources = @($failed)
    checked_at = (Get-Date).ToUniversalTime().ToString("o")
  }
  $script:PublicSlotPermissionProbe = $probe
  $script:PublicSlotPermissionProbeCheckedAt = $now
  return $probe
}

function Invoke-PublicSlotRestGetAll {
  param([string]$PathAndQuery)
  $all = @()
  for ($offset = 0; $offset -lt 300000; $offset += 1000) {
    $separator = if ($PathAndQuery.Contains("?")) { "&" } else { "?" }
    $rows = @(Invoke-PublicSlotRestGet -PathAndQuery "$PathAndQuery${separator}offset=$offset&limit=1000")
    if ($rows.Count -eq 1 -and $rows[0] -is [array]) { $rows = @($rows[0]) }
    foreach ($row in $rows) { $all += $row }
    if ($rows.Count -lt 1000) { break }
  }
  return @($all)
}

function New-Intraday1mStatsSnapshot {
  return @{
    intraday_1m_symbols_today = 0
    intraday_1m_latest_candle_time = $null
    intraday_1m_rows_today = 0
    intraday_1m_stale_seconds = 999999
    intraday_1m_stats_source = "pending"
    today_candle_count = 0
    warmup_candle_count = 0
    continuous_candle_count = 0
    ready_ge_20 = 0
    ready_ge_35 = 0
    ready_ge_80 = 0
    ready_ge_200 = 0
    ready_ma20_continuous = 0
    ready_ma35_continuous = 0
    ready_macd_continuous = 0
  }
}

function Get-Intraday1mCoverageStats {
  param(
    [object[]]$FallbackRows = @(),
    [string[]]$Symbols = @()
  )

  $stats = New-Intraday1mStatsSnapshot
  $stats.intraday_1m_stats_source = "fallback_current_batch"

  $statusSelect = "symbol,latest_candle_time,today_candle_count,warmup_candle_count,continuous_candle_count,candle_count,ready_ma20_continuous,ready_ma35_continuous,ready_macd_continuous,ready_ge_20,ready_ge_35,ready_ge_80,ready_ge_200,has_today_data"
  $viewRows = @()
  $candidateSymbols = @($Symbols | Where-Object { [string]$_ -match '^\d{4}$' } | Select-Object -Unique)

  if ($candidateSymbols.Count -gt 0) {
    try {
      $coverageRows = Convert-PublicSlotRestRows -Rows (Invoke-PublicSlotRpc -FunctionName "get_fugle_intraday_1m_coverage_stats" -Body @{ p_symbols = @($candidateSymbols) })
      if ($coverageRows.Count -gt 0) {
        $coverage = $coverageRows[0]
        $stats.intraday_1m_symbols_today = [int](Get-Number $coverage.intraday_1m_symbols_today)
        $stats.intraday_1m_latest_candle_time = $coverage.latest_candle_time
        if ([string]::IsNullOrWhiteSpace([string]$stats.intraday_1m_latest_candle_time)) {
          $stats.intraday_1m_latest_candle_time = $coverage.intraday_1m_latest_candle_time
        }
        $stats.intraday_1m_rows_today = [int](Get-Number $coverage.intraday_1m_rows_today)
        $stats.intraday_1m_stale_seconds = [int](Get-Number $coverage.intraday_1m_stale_seconds)
        $stats.today_candle_count = [int](Get-Number $coverage.today_candle_count)
        if ($stats.today_candle_count -le 0) { $stats.today_candle_count = $stats.intraday_1m_rows_today }
        $stats.warmup_candle_count = [int](Get-Number $coverage.warmup_candle_count)
        $stats.continuous_candle_count = [int](Get-Number $coverage.continuous_candle_count)
        $stats.ready_ma20_continuous = [int](Get-Number $coverage.ready_ma20_continuous)
        $stats.ready_ma35_continuous = [int](Get-Number $coverage.ready_ma35_continuous)
        $stats.ready_macd_continuous = [int](Get-Number $coverage.ready_macd_continuous)
        $stats.ready_ge_20 = [int](Get-Number $coverage.ready_ge_20)
        $stats.ready_ge_35 = [int](Get-Number $coverage.ready_ge_35)
        $stats.ready_ge_80 = [int](Get-Number $coverage.ready_ge_80)
        $stats.ready_ge_200 = [int](Get-Number $coverage.ready_ge_200)
        if ($stats.ready_ge_20 -le 0) { $stats.ready_ge_20 = $stats.ready_ma20_continuous }
        if ($stats.ready_ge_35 -le 0) { $stats.ready_ge_35 = $stats.ready_ma35_continuous }
        if ($stats.ready_ma35_continuous -lt $stats.ready_ge_35) { $stats.ready_ma35_continuous = $stats.ready_ge_35 }
        if ($stats.ready_ma20_continuous -lt $stats.ready_ma35_continuous) { $stats.ready_ma20_continuous = $stats.ready_ma35_continuous }
        if ($stats.ready_ge_20 -lt $stats.ready_ma20_continuous) { $stats.ready_ge_20 = $stats.ready_ma20_continuous }
        if ($stats.ready_macd_continuous -lt $stats.ready_ge_80) { $stats.ready_macd_continuous = $stats.ready_ge_80 }
        if ($stats.intraday_1m_stale_seconds -le 0) {
          $stats.intraday_1m_stale_seconds = Get-IsoAgeSeconds -IsoTime $stats.intraday_1m_latest_candle_time
        }
        $stats.intraday_1m_stats_source = "get_fugle_intraday_1m_coverage_stats"
        if ($stats.intraday_1m_rows_today -gt 0 -and $stats.intraday_1m_stale_seconds -lt 999999) {
          return $stats
        }
      }
    } catch {
      Write-Log "WARN intraday 1m coverage RPC failed symbols=$($candidateSymbols.Count): $($_.Exception.Message)"
    }
  }

  try {
    if ($candidateSymbols.Count -gt 0 -and $candidateSymbols.Count -le 100) {
      $batchSize = 25
      $collected = New-Object System.Collections.Generic.List[object]
      for ($offset = 0; $offset -lt $candidateSymbols.Count; $offset += $batchSize) {
        $take = [math]::Min($batchSize, $candidateSymbols.Count - $offset)
        $batch = @($candidateSymbols[$offset..($offset + $take - 1)])
        $symbolList = ($batch -join ",")
        $rows = Convert-PublicSlotRestRows -Rows (Invoke-PublicSlotRestGet -PathAndQuery "v_fugle_intraday_1m_status?select=$statusSelect&symbol=in.($symbolList)&limit=$batchSize" -LogError)
        foreach ($row in $rows) { $collected.Add($row) }
      }
      $viewRows = @($collected.ToArray())
    } else {
      $viewRows = Convert-PublicSlotRestRows -Rows (Invoke-PublicSlotRestGet -PathAndQuery "v_fugle_intraday_1m_status?select=$statusSelect&limit=5000" -LogError)
    }
    if ($viewRows.Count -gt 0) {
      $latest = Get-LatestIsoUtc -Rows $viewRows -PropertyName "latest_candle_time"
      $rowsToday = 0
      $warmupRows = 0
      $continuousRows = 0
      $readyMa20 = 0
      $readyMa35 = 0
      $readyMacd = 0
      $ready80 = 0
      $ready200 = 0
      $symbolsWithToday = 0
      foreach ($row in $viewRows) {
        $rowCandleCount = 0
        if ($null -ne $row.today_candle_count) {
          $rowCandleCount = [int]$row.today_candle_count
        } elseif ($null -ne $row.rows_today) {
          $rowCandleCount = [int]$row.rows_today
        } elseif ($null -ne $row.candle_count) {
          $rowCandleCount = [int]$row.candle_count
        }
        $rowWarmupCount = [int](Get-Number $row.warmup_candle_count)
        $rowContinuousCount = [int](Get-Number $row.continuous_candle_count)
        if ($rowContinuousCount -le 0) { $rowContinuousCount = $rowWarmupCount + $rowCandleCount }
        if ($rowContinuousCount -le 0) { $rowContinuousCount = [int](Get-Number $row.candle_count) }
        $hasToday = ($row.has_today_data -eq $true -or $rowCandleCount -gt 0)
        if ($hasToday) {
          $symbolsWithToday += 1
          $rowsToday += $rowCandleCount
        }
        $warmupRows += $rowWarmupCount
        $continuousRows += $rowContinuousCount
        if ($row.ready_ma20_continuous -eq $true -or $row.ready_ge_20 -eq $true -or $rowContinuousCount -ge 20) { $readyMa20++ }
        if ($row.ready_ma35_continuous -eq $true -or $row.ready_ge_35 -eq $true -or $rowContinuousCount -ge 35) { $readyMa35++ }
        if ($row.ready_macd_continuous -eq $true -or $rowContinuousCount -ge 80) { $readyMacd++ }
        if ($row.ready_ge_80 -eq $true) { $ready80++ }
        if ($row.ready_ge_200 -eq $true) { $ready200++ }
      }
      if ($ready80 -lt $ready200) { $ready80 = $ready200 }
      if ($readyMa35 -lt $ready80) { $readyMa35 = $ready80 }
      if ($readyMa20 -lt $readyMa35) { $readyMa20 = $readyMa35 }
      if ($readyMacd -lt $ready80) { $readyMacd = $ready80 }
      $stats.intraday_1m_symbols_today = $symbolsWithToday
      $stats.intraday_1m_latest_candle_time = $latest
      $stats.intraday_1m_rows_today = $rowsToday
      $stats.today_candle_count = $rowsToday
      $stats.warmup_candle_count = $warmupRows
      $stats.continuous_candle_count = $continuousRows
      $stats.ready_ma20_continuous = $readyMa20
      $stats.ready_ma35_continuous = $readyMa35
      $stats.ready_macd_continuous = $readyMacd
      $stats.ready_ge_20 = $readyMa20
      $stats.ready_ge_35 = $readyMa35
      $stats.ready_ge_80 = $ready80
      $stats.ready_ge_200 = $ready200
      $stats.intraday_1m_stale_seconds = Get-IsoAgeSeconds -IsoTime $latest
      $stats.intraday_1m_stats_source = if ($candidateSymbols.Count -gt 0) { "v_fugle_intraday_1m_status_symbol_batches" } else { "v_fugle_intraday_1m_status" }
      return $stats
    }
  } catch {
    Write-Log "WARN intraday 1m coverage status query failed symbols=$($candidateSymbols.Count): $($_.Exception.Message)"
  }

  $today = (Get-Date).ToString("yyyy-MM-dd")
  $fallbackRows = @($FallbackRows)
  $todayRows = @($fallbackRows | Where-Object { [string]$_.trade_date -eq $today })
  $warmupRows = @($fallbackRows | Where-Object { [string]$_.trade_date -ne $today })
  $latestFallback = Get-LatestIsoUtc -Rows $fallbackRows -PropertyName "candle_time"
  $todaySymbols = @($todayRows | ForEach-Object { [string]$_.symbol } | Where-Object { $_ } | Select-Object -Unique)
  $symbols = @($fallbackRows | ForEach-Object { [string]$_.symbol } | Where-Object { $_ } | Select-Object -Unique)
  $todaySymbolSet = New-Object System.Collections.Generic.HashSet[string]
  foreach ($symbol in $todaySymbols) { [void]$todaySymbolSet.Add([string]$symbol) }
  $stats.intraday_1m_symbols_today = $todaySymbols.Count
  $stats.intraday_1m_latest_candle_time = $latestFallback
  $stats.intraday_1m_rows_today = $todayRows.Count
  $stats.today_candle_count = $todayRows.Count
  $stats.warmup_candle_count = $warmupRows.Count
  $stats.continuous_candle_count = $fallbackRows.Count
  $fallbackGroups = @($fallbackRows | Group-Object symbol)
  $readyGroups = @($fallbackGroups)
  $stats.ready_ma20_continuous = @($readyGroups | Where-Object { $_.Count -ge 20 }).Count
  $stats.ready_ma35_continuous = @($readyGroups | Where-Object { $_.Count -ge 35 }).Count
  $stats.ready_macd_continuous = @($readyGroups | Where-Object { $_.Count -ge 80 }).Count
  $stats.ready_ge_20 = $stats.ready_ma20_continuous
  $stats.ready_ge_35 = $stats.ready_ma35_continuous
  $stats.ready_ge_80 = @($readyGroups | Where-Object { $_.Count -ge 80 }).Count
  $stats.ready_ge_200 = @($readyGroups | Where-Object { $_.Count -ge 200 }).Count
  $stats.intraday_1m_stale_seconds = Get-IsoAgeSeconds -IsoTime $latestFallback
  return $stats
}

function Merge-IntradayStatsWithFallbackRows {
  param(
    [hashtable]$Stats,
    [object[]]$FallbackRows = @(),
    [string]$SourceSuffix = "fallback_current_batch_newer"
  )

  if ($null -eq $Stats) { $Stats = @{} }
  $fallbackRows = @($FallbackRows)
  if ($fallbackRows.Count -le 0) { return $Stats }

  $latestFallback = Get-LatestIsoUtc -Rows $fallbackRows -PropertyName "candle_time"
  if ([string]::IsNullOrWhiteSpace($latestFallback)) { return $Stats }
  $fallbackAge = Get-IsoAgeSeconds -IsoTime $latestFallback
  $currentAge = [int](Get-Number $Stats.intraday_1m_stale_seconds)
  if ($currentAge -le 0) {
    $currentAge = Get-IsoAgeSeconds -IsoTime ([string]$Stats.intraday_1m_latest_candle_time)
  }
  if ($fallbackAge -ge $currentAge) { return $Stats }

  $today = (Get-Date).ToString("yyyy-MM-dd")
  $todayRows = @($fallbackRows | Where-Object { [string]$_.trade_date -eq $today })
  if ($todayRows.Count -le 0) { return $Stats }

  $todaySymbols = @($todayRows | ForEach-Object { [string]$_.symbol } | Where-Object { $_ } | Select-Object -Unique)
  $fallbackGroups = @($fallbackRows | Group-Object symbol)
  $readyMa20 = @($fallbackGroups | Where-Object { $_.Count -ge 20 }).Count
  $readyMa35 = @($fallbackGroups | Where-Object { $_.Count -ge 35 }).Count
  $ready80 = @($fallbackGroups | Where-Object { $_.Count -ge 80 }).Count
  $ready200 = @($fallbackGroups | Where-Object { $_.Count -ge 200 }).Count

  $Stats.intraday_1m_latest_candle_time = $latestFallback
  $Stats.intraday_1m_stale_seconds = $fallbackAge
  $Stats.intraday_1m_symbols_today = [math]::Max([int](Get-Number $Stats.intraday_1m_symbols_today), $todaySymbols.Count)
  $Stats.intraday_1m_rows_today = [math]::Max([int](Get-Number $Stats.intraday_1m_rows_today), $todayRows.Count)
  $Stats.today_candle_count = [math]::Max([int](Get-Number $Stats.today_candle_count), $todayRows.Count)
  $Stats.warmup_candle_count = [math]::Max([int](Get-Number $Stats.warmup_candle_count), @($fallbackRows | Where-Object { [string]$_.trade_date -ne $today }).Count)
  $Stats.continuous_candle_count = [math]::Max([int](Get-Number $Stats.continuous_candle_count), $fallbackRows.Count)
  $Stats.ready_ma20_continuous = [math]::Max([int](Get-Number $Stats.ready_ma20_continuous), $readyMa20)
  $Stats.ready_ma35_continuous = [math]::Max([int](Get-Number $Stats.ready_ma35_continuous), $readyMa35)
  $Stats.ready_macd_continuous = [math]::Max([int](Get-Number $Stats.ready_macd_continuous), $ready80)
  $Stats.ready_ge_20 = [math]::Max([int](Get-Number $Stats.ready_ge_20), $readyMa20)
  $Stats.ready_ge_35 = [math]::Max([int](Get-Number $Stats.ready_ge_35), $readyMa35)
  $Stats.ready_ge_80 = [math]::Max([int](Get-Number $Stats.ready_ge_80), $ready80)
  $Stats.ready_ge_200 = [math]::Max([int](Get-Number $Stats.ready_ge_200), $ready200)
  $Stats.intraday_1m_stats_source = "$($Stats.intraday_1m_stats_source)+$SourceSuffix"
  return $Stats
}

function Copy-IntradayStatsFromSourcePayload {
  param([hashtable]$Stats, [object]$Payload)
  if ($null -eq $Payload) { return $Stats }

  $previousRows = [int](Get-Number $Payload.intraday_1m_rows_today)
  $previousStale = [int](Get-Number $Payload.intraday_1m_stale_seconds)
  $previousReady20 = [int](Get-Number $Payload.ready_ma20_continuous_symbols)
  if ($previousReady20 -le 0) { $previousReady20 = [int](Get-Number $Payload.ready_ma20_continuous) }
  $previousReady35 = [int](Get-Number $Payload.ready_ma35_continuous_symbols)
  if ($previousReady35 -le 0) { $previousReady35 = [int](Get-Number $Payload.ready_ma35_continuous) }
  if ($previousRows -le 0 -and $previousReady20 -le 0 -and $previousReady35 -le 0) { return $Stats }

  $Stats.intraday_1m_symbols_today = [int](Get-Number $Payload.intraday_1m_symbols_today)
  $Stats.intraday_1m_latest_candle_time = $Payload.latest_candle_time
  if ([string]::IsNullOrWhiteSpace([string]$Stats.intraday_1m_latest_candle_time)) {
    $Stats.intraday_1m_latest_candle_time = $Payload.intraday_1m_latest_candle_time
  }
  $Stats.intraday_1m_rows_today = $previousRows
  $Stats.today_candle_count = [int](Get-Number $Payload.today_candle_count)
  if ($Stats.today_candle_count -le 0) { $Stats.today_candle_count = $previousRows }
  $Stats.warmup_candle_count = [int](Get-Number $Payload.warmup_candle_count)
  $Stats.continuous_candle_count = [int](Get-Number $Payload.continuous_candle_count)
  if ($Stats.continuous_candle_count -le 0) { $Stats.continuous_candle_count = $Stats.warmup_candle_count + $Stats.today_candle_count }
  $Stats.ready_ma20_continuous = $previousReady20
  $Stats.ready_ma35_continuous = $previousReady35
  $Stats.ready_macd_continuous = [int](Get-Number $Payload.ready_macd_continuous_symbols)
  if ($Stats.ready_macd_continuous -le 0) { $Stats.ready_macd_continuous = [int](Get-Number $Payload.ready_macd_continuous) }
  $Stats.ready_ge_20 = [int](Get-Number $Payload.ready_ge_20)
  if ($Stats.ready_ge_20 -le 0) { $Stats.ready_ge_20 = [int](Get-Number $Payload.ready_ge_20_symbols) }
  if ($Stats.ready_ge_20 -le 0) { $Stats.ready_ge_20 = $Stats.ready_ma20_continuous }
  $Stats.ready_ge_35 = [int](Get-Number $Payload.ready_ge_35)
  if ($Stats.ready_ge_35 -le 0) { $Stats.ready_ge_35 = [int](Get-Number $Payload.ready_ge_35_symbols) }
  if ($Stats.ready_ge_35 -le 0) { $Stats.ready_ge_35 = $Stats.ready_ma35_continuous }
  $Stats.ready_ge_80 = [int](Get-Number $Payload.ready_ge_80)
  if ($Stats.ready_ge_80 -le 0) { $Stats.ready_ge_80 = [int](Get-Number $Payload.ready_ge_80_symbols) }
  $Stats.ready_ge_200 = [int](Get-Number $Payload.ready_ge_200)
  if ($Stats.ready_ge_200 -le 0) { $Stats.ready_ge_200 = [int](Get-Number $Payload.ready_ge_200_symbols) }
  if ($Stats.ready_ge_80 -lt $Stats.ready_ge_200) { $Stats.ready_ge_80 = $Stats.ready_ge_200 }
  if ($Stats.ready_ge_35 -lt $Stats.ready_ge_80) { $Stats.ready_ge_35 = $Stats.ready_ge_80 }
  if ($Stats.ready_ma35_continuous -lt $Stats.ready_ge_35) { $Stats.ready_ma35_continuous = $Stats.ready_ge_35 }
  if ($Stats.ready_ma20_continuous -lt $Stats.ready_ma35_continuous) { $Stats.ready_ma20_continuous = $Stats.ready_ma35_continuous }
  if ($Stats.ready_ge_20 -lt $Stats.ready_ma20_continuous) { $Stats.ready_ge_20 = $Stats.ready_ma20_continuous }
  if ($Stats.ready_macd_continuous -lt $Stats.ready_ge_80) { $Stats.ready_macd_continuous = $Stats.ready_ge_80 }
  if ($previousRows -gt 0 -and $previousStale -lt 999999) {
    $Stats.intraday_1m_stale_seconds = $previousStale
  }
  $Stats.intraday_1m_stats_source = "preserved_source_status"
  return $Stats
}

function Convert-VolumeToLots {
  param([object]$Value)
  $number = Get-Number $Value
  if ($number -gt 100000) { return [math]::Round($number / 1000, 3) }
  return $number
}

function Get-QuoteDerivedPrice {
  param([object]$Quote)

  $candidates = @(
    @{ source = "price"; value = Get-Number $Quote.price },
    @{ source = "open_price"; value = Get-Number $Quote.open_price },
    @{ source = "high_price"; value = Get-Number $Quote.high_price },
    @{ source = "low_price"; value = Get-Number $Quote.low_price },
    @{ source = "previous_close"; value = Get-Number $Quote.previous_close },
    @{ source = "reference_price"; value = Get-Number $Quote.reference_price },
    @{ source = "trial_price"; value = Get-Number $Quote.trial_price }
  )
  foreach ($candidate in $candidates) {
    if ([double]$candidate.value -gt 0) {
      return [pscustomobject]@{ price = [double]$candidate.value; source = [string]$candidate.source; synthetic = ([string]$candidate.source -ne "price") }
    }
  }

  $bid = Get-Number $Quote.best_bid_price
  if ($bid -le 0) { $bid = Get-Number $Quote.bid1_price }
  $ask = Get-Number $Quote.best_ask_price
  if ($ask -le 0) { $ask = Get-Number $Quote.ask1_price }
  if ($bid -gt 0 -and $ask -gt 0) {
    return [pscustomobject]@{ price = [math]::Round(($bid + $ask) / 2, 4); source = "bid_ask_mid"; synthetic = $true }
  }
  if ($bid -gt 0) { return [pscustomobject]@{ price = [double]$bid; source = "best_bid_price"; synthetic = $true } }
  if ($ask -gt 0) { return [pscustomobject]@{ price = [double]$ask; source = "best_ask_price"; synthetic = $true } }

  return [pscustomobject]@{ price = 0.0; source = "none"; synthetic = $true }
}

function Invoke-PublicSlotRpc {
  param([string]$FunctionName, [hashtable]$Body = @{})
  try {
    $headers = @{
      "apikey" = $serviceRoleKey
      "Authorization" = "Bearer $serviceRoleKey"
      "Content-Type" = "application/json"
    }
    $json = $Body | ConvertTo-Json -Depth 10 -Compress
    return Invoke-RestMethod -Uri "$ProjectUrl/rest/v1/rpc/$FunctionName" -Method Post -Headers $headers -Body $json -TimeoutSec 30 -ErrorAction Stop
  } catch {
    Write-Log "WARN rpc $FunctionName failed: $($_.Exception.Message)"
    return $null
  }
}

function Get-FugleApiKey {
  return Read-TextSecret @(
    (Join-Path $RuntimeDir "secrets\fugle-api-key.txt"),
    (Join-Path $FumanRoot "secrets\fugle-api-key.txt")
  )
}

function Read-SymbolBlacklist {
  $symbols = New-Object System.Collections.Generic.HashSet[string]
  foreach ($symbol in @(
    "1101", "1102", "1103", "1104", "1108", "1109", "1110",
    "2208", "2634", "2645", "3167", "4541", "4572", "5284", "8033", "8222"
  )) {
    [void]$symbols.Add($symbol)
  }
  foreach ($path in @($BlacklistFile, $BlacklistCacheFile)) {
    try {
      if (Test-Path -LiteralPath $path) {
        $text = Get-Content -LiteralPath $path -Raw -ErrorAction Stop
        foreach ($match in [regex]::Matches($text, '(?<!\d)\d{4}(?!\d)')) {
          [void]$symbols.Add([string]$match.Value)
        }
      }
    } catch {}
  }

  try {
    if (-not [string]::IsNullOrWhiteSpace($BlacklistCsvUrl)) {
      $response = Invoke-WebRequest -Uri $BlacklistCsvUrl -UseBasicParsing -TimeoutSec 15 -ErrorAction Stop
      $content = [string]$response.Content
      foreach ($match in [regex]::Matches($content, '(?<!\d)\d{4}(?!\d)')) {
        [void]$symbols.Add([string]$match.Value)
      }
      if ($symbols.Count -gt 0) {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $BlacklistCacheFile) | Out-Null
        ($symbols.ToArray() | Sort-Object) | Set-Content -LiteralPath $BlacklistCacheFile -Encoding utf8
      }
    }
  } catch {
    Write-Log "WARN blacklist remote unavailable; using local/cache blacklist: $($_.Exception.Message)"
  }

  return $symbols
}

function Remove-BlacklistedSymbols {
  param([object[]]$Symbols, [System.Collections.Generic.HashSet[string]]$Blacklist)
  if ($null -eq $Blacklist -or $Blacklist.Count -eq 0) {
    return @($Symbols | Where-Object {
      $symbol = [string]$_
      $symbol -match '^\d{4}$' -and -not $symbol.StartsWith("00")
    })
  }
  return @($Symbols | Where-Object {
    $symbol = [string]$_
    $symbol -match '^\d{4}$' -and -not $symbol.StartsWith("00") -and -not $Blacklist.Contains($symbol)
  })
}

function Test-EligibleMotherPoolRow {
  param([object]$Row)
  $symbol = [string]$Row.symbol
  if ($symbol -notmatch '^\d{4}$' -or $symbol.StartsWith("00")) { return $false }
  $name = [string]$Row.name
  if (Test-BuiltInBlacklistedStock -Symbol $symbol -Name $name) { return $false }
  foreach ($flag in @("is_active", "is_etf", "is_warrant", "is_cb", "is_blacklisted", "is_daytrade_unsuitable")) {
    if ($null -eq $Row.PSObject.Properties[$flag]) { continue }
    $value = $Row.PSObject.Properties[$flag].Value
    if ($flag -eq "is_active" -and $value -eq $false) { return $false }
    if ($flag -ne "is_active" -and $value -eq $true) { return $false }
  }
  $text = @(
    [string]$Row.name,
    [string]$Row.industry,
    [string]$Row.market,
    [string]$Row.stock_type,
    [string]$Row.type,
    [string]$Row.payload.category,
    [string]$Row.payload.type
  ) -join " "
  if ($text -match 'ETF|ETN|權證|可轉債|水泥|軍工|國防|航太') { return $false }
  return $true
}

function Get-ActiveCommonStockSymbols {
  if ($null -ne $script:ActiveCommonStockSymbols -and ((Get-Date) - $script:ActiveCommonStockSymbolsAt).TotalMinutes -lt 5) {
    return @($script:ActiveCommonStockSymbols)
  }

  $symbols = @()
  try {
    $rows = @(Invoke-PublicSlotRestGetAll -PathAndQuery "stock_universe?select=symbol,name,market,industry,is_active,is_etf,is_warrant,is_cb,is_blacklisted,is_daytrade_unsuitable,payload&order=symbol.asc")
    $symbols = @($rows | Where-Object { Test-EligibleMotherPoolRow -Row $_ } | ForEach-Object { [string]$_.symbol } | Select-Object -Unique | Select-Object -First $SeedSymbolCount)
    if ($symbols.Count -gt 0) {
      $script:ActiveCommonStockSymbols = $symbols
      $script:ActiveCommonStockSymbolsAt = Get-Date
      $script:ApiUniverseStats.mother_pool_source = "stock_universe"
      $script:ApiUniverseStats.mother_pool_symbols = $symbols.Count
      $script:ApiUniverseStats.mother_pool_filtered = [math]::Max(0, $rows.Count - $symbols.Count)
      return @($symbols)
    }
  } catch {
    Write-Log "WARN stock_universe mother pool unavailable; falling back to stocks-slim/ws symbols: $($_.Exception.Message)"
  }

  return @()
}

function Get-StocksSlimSymbols {
  $stocksFile = Join-Path $RuntimeDir "data\stocks-slim.json"
  $symbols = @()
  try {
    if (Test-Path -LiteralPath $stocksFile) {
      $rawStocks = Get-Content -LiteralPath $stocksFile -Raw -ErrorAction Stop
      $matches = [regex]::Matches($rawStocks, '"code"\s*:\s*"(\d{4})"[\s\S]{0,400}?"name"\s*:\s*"([^"]*)"')
      foreach ($match in $matches) {
        $symbol = [string]$match.Groups[1].Value
        $name = [string]$match.Groups[2].Value
        if (-not (Test-BuiltInBlacklistedStock -Symbol $symbol -Name $name)) { $symbols += $symbol }
      }
    }
  } catch {
    Write-Log "WARN unable to parse stocks-slim mother pool: $($_.Exception.Message)"
  }
  $symbols = @($symbols | Select-Object -Unique | Select-Object -First $SeedSymbolCount)
  if ($symbols.Count -gt 0) {
    $script:ApiUniverseStats.mother_pool_source = "stocks-slim"
    $script:ApiUniverseStats.mother_pool_symbols = $symbols.Count
  }
  return $symbols
}

function Get-AvgVolume5QualifiedSymbolSet {
  if ($MinAvgVolume5Lots -le 0) { return $null }
  if ($null -ne $script:VolumeQualifiedSymbols -and ((Get-Date) - $script:VolumeQualifiedSymbolsAt).TotalMinutes -lt 10) {
    return $script:VolumeQualifiedSymbols
  }

  $qualified = New-Object System.Collections.Generic.HashSet[string]
  try {
    $rows = @(Invoke-PublicSlotRestGetAll -PathAndQuery "fugle_daily_volume?select=symbol,trade_date,volume&order=symbol.asc,trade_date.desc")
    $bySymbol = @{}
    foreach ($row in $rows) {
      $symbol = [string]$row.symbol
      if ($symbol -notmatch '^\d{4}$') { continue }
      if (-not $bySymbol.ContainsKey($symbol)) {
        $bySymbol[$symbol] = New-Object System.Collections.ArrayList
      }
      if ($bySymbol[$symbol].Count -ge 5) { continue }
      $volume = Get-Number $row.volume
      if ($volume -gt 0) { [void]$bySymbol[$symbol].Add([double]$volume) }
    }

    foreach ($symbol in $bySymbol.Keys) {
      $volumes = @($bySymbol[$symbol])
      if ($volumes.Count -lt 5) { continue }
      $sum = 0.0
      foreach ($volume in $volumes) { $sum += [double]$volume }
      $avg5 = $sum / [double]$volumes.Count
      if ($avg5 -ge $MinAvgVolume5Lots) { [void]$qualified.Add($symbol) }
    }
    $script:VolumeQualifiedSymbols = $qualified
    $script:VolumeQualifiedSymbolsAt = Get-Date
    Write-Log "avg_volume5_filter eligible=$($qualified.Count) min_avg_volume5_lots=$MinAvgVolume5Lots"
    return $qualified
  } catch {
    $line = $_.InvocationInfo.ScriptLineNumber
    Write-Log "WARN avg_volume5 filter unavailable; keeping static universe only: line=$line $($_.Exception.Message)"
    return $null
  }
}

function Filter-SymbolsByAvgVolume5 {
  param([string[]]$Symbols)
  $unique = @($Symbols | Where-Object { [string]$_ -match '^\d{4}$' } | Select-Object -Unique)
  $script:ApiUniverseStats.raw_candidates = $unique.Count
  $qualified = Get-AvgVolume5QualifiedSymbolSet
  if ($null -eq $qualified) {
    $script:ApiUniverseStats.avg_volume5_eligible = $unique.Count
    $script:ApiUniverseStats.avg_volume5_filtered = 0
    return $unique
  }
  $filtered = @($unique | Where-Object { $qualified.Contains([string]$_) })
  $script:ApiUniverseStats.avg_volume5_eligible = $filtered.Count
  $script:ApiUniverseStats.avg_volume5_filtered = [math]::Max(0, $unique.Count - $filtered.Count)
  return $filtered
}

function Get-QuoteLiquidityQualifiedSymbols {
  param([object[]]$QuoteRows)
  $qualified = New-Object System.Collections.Generic.HashSet[string]
  foreach ($row in @($QuoteRows)) {
    $symbol = [string]$row.symbol
    if ($symbol -notmatch '^\d{4}$') { continue }
    $cumulative = Get-Number $row.cumulative_bid_ask_volume
    if ($cumulative -ge $MinCumulativeBidAskLots) { [void]$qualified.Add($symbol) }
  }
  return $qualified
}

function Filter-SymbolsByQuoteLiquidity {
  param([string[]]$Symbols, [object[]]$QuoteRows)
  $unique = @($Symbols | Where-Object { [string]$_ -match '^\d{4}$' } | Select-Object -Unique)
  $session = Get-PublicSlotSession
  if ($session -eq "preopen") {
    $script:ApiUniverseStats.quote_liquidity_eligible = $unique.Count
    $script:ApiUniverseStats.quote_liquidity_filtered = 0
    return $unique
  }
  if ($MinCumulativeBidAskLots -le 0) {
    $script:ApiUniverseStats.quote_liquidity_eligible = $unique.Count
    $script:ApiUniverseStats.quote_liquidity_filtered = 0
    return $unique
  }
  $qualified = Get-QuoteLiquidityQualifiedSymbols -QuoteRows $QuoteRows
  if ($qualified.Count -eq 0) {
    $script:ApiUniverseStats.quote_liquidity_eligible = 0
    $script:ApiUniverseStats.quote_liquidity_filtered = $unique.Count
    return @()
  }
  $filtered = @($unique | Where-Object { $qualified.Contains([string]$_) })
  $script:ApiUniverseStats.quote_liquidity_eligible = $filtered.Count
  $script:ApiUniverseStats.quote_liquidity_filtered = [math]::Max(0, $unique.Count - $filtered.Count)
  return $filtered
}

function Add-PrioritySymbol {
  param(
    [System.Collections.Generic.List[string]]$List,
    [System.Collections.Generic.HashSet[string]]$Seen,
    [object]$Value,
    [System.Collections.Generic.HashSet[string]]$UniverseSet = $null
  )
  $digits = [string]$Value -replace "\D", ""
  if ($digits.Length -lt 4) { return }
  $symbol = $digits.Substring(0, 4)
  if ($symbol -notmatch '^\d{4}$' -or $symbol.StartsWith("00")) { return }
  if ($null -ne $UniverseSet -and -not $UniverseSet.Contains($symbol)) { return }
  if ($Seen.Add($symbol)) { $List.Add($symbol) }
}

function Get-UniqueSymbols {
  param([object[]]$Values, [System.Collections.Generic.HashSet[string]]$UniverseSet = $null)
  $seen = New-Object System.Collections.Generic.HashSet[string]
  $list = New-Object System.Collections.Generic.List[string]
  foreach ($value in @($Values)) {
    Add-PrioritySymbol -List $list -Seen $seen -Value $value -UniverseSet $UniverseSet
  }
  return $list.ToArray()
}

function Get-StrategyResultSymbols {
  param([string]$Table, [string]$Strategy, [System.Collections.Generic.HashSet[string]]$UniverseSet)
  $symbols = New-Object System.Collections.Generic.List[string]
  $seen = New-Object System.Collections.Generic.HashSet[string]
  foreach ($query in @(
    "$Table`?select=code,symbol,strategy&strategy=eq.$Strategy",
    "$Table`?select=code,symbol"
  )) {
    try {
      $rows = @(Invoke-PublicSlotRestGetAll -PathAndQuery $query)
      foreach ($row in $rows) {
        Add-PrioritySymbol -List $symbols -Seen $seen -Value $row.code -UniverseSet $UniverseSet
        Add-PrioritySymbol -List $symbols -Seen $seen -Value $row.symbol -UniverseSet $UniverseSet
        if ($symbols.Count -ge 2000) { break }
      }
      if ($symbols.Count -gt 0) { break }
    } catch {
      Write-Log "WARN strategy priority read failed table=$Table strategy=$Strategy`: $($_.Exception.Message)"
    }
  }
  return $symbols.ToArray()
}

function Add-TerminalRowSymbols {
  param(
    [System.Collections.Generic.List[string]]$List,
    [System.Collections.Generic.HashSet[string]]$Seen,
    [object]$Row,
    [string[]]$Fields,
    [System.Collections.Generic.HashSet[string]]$UniverseSet
  )
  if ($null -eq $Row) { return }
  foreach ($field in @($Fields)) {
    $value = Get-ObjectPathValue -Object $Row -Path $field
    Add-PrioritySymbol -List $List -Seen $Seen -Value $value -UniverseSet $UniverseSet
  }
}

function Get-TerminalTableSymbols {
  param(
    [string]$PathAndQuery,
    [string[]]$Fields,
    [System.Collections.Generic.HashSet[string]]$UniverseSet,
    [string]$Label = ""
  )
  $symbols = New-Object System.Collections.Generic.List[string]
  $seen = New-Object System.Collections.Generic.HashSet[string]
  try {
    $rows = @(Invoke-PublicSlotRestGetAll -PathAndQuery $PathAndQuery)
    foreach ($row in $rows) {
      Add-TerminalRowSymbols -List $symbols -Seen $seen -Row $row -Fields $Fields -UniverseSet $UniverseSet
      if ($symbols.Count -ge 2000) { break }
    }
  } catch {
    Write-Log "WARN terminal priority read failed label=$Label path=$PathAndQuery`: $($_.Exception.Message)"
  }
  return $symbols.ToArray()
}

function Get-TerminalPrioritySymbols {
  param([string[]]$UniverseSymbols)
  $now = Get-Date
  if ($null -ne $script:TerminalPrioritySymbols -and (($now - $script:TerminalPrioritySymbolsAt).TotalMinutes -lt 2)) {
    return $script:TerminalPrioritySymbols
  }

  $universeSet = New-Object System.Collections.Generic.HashSet[string]
  foreach ($symbol in @($UniverseSymbols)) {
    if ([string]$symbol -match '^\d{4}$') { [void]$universeSet.Add([string]$symbol) }
  }

  $payload = [ordered]@{
    strategy1 = @(Get-TerminalTableSymbols -PathAndQuery "strategy1_open_buy_results?select=code,symbol,payload" -Fields @("code", "symbol", "payload.code", "payload.symbol") -UniverseSet $universeSet -Label "strategy1")
    strategy2 = @(Get-TerminalTableSymbols -PathAndQuery "strategy2_scan_results?select=code,symbol,payload" -Fields @("code", "symbol", "payload.code", "payload.symbol") -UniverseSet $universeSet -Label "strategy2")
    strategy3 = @(Get-TerminalTableSymbols -PathAndQuery "strategy3_scan_results?select=code,symbol,payload" -Fields @("code", "symbol", "payload.code", "payload.symbol") -UniverseSet $universeSet -Label "strategy3")
    strategy4 = @(Get-TerminalTableSymbols -PathAndQuery "strategy4_scan_results?select=code,symbol,payload" -Fields @("code", "symbol", "payload.code", "payload.symbol") -UniverseSet $universeSet -Label "strategy4")
    strategy5 = @(Get-TerminalTableSymbols -PathAndQuery "strategy5_scan_results?select=code,symbol,payload" -Fields @("code", "symbol", "payload.code", "payload.symbol") -UniverseSet $universeSet -Label "strategy5")
    institution = @(Get-TerminalTableSymbols -PathAndQuery "institution_scan_results?select=code,symbol,payload" -Fields @("code", "symbol", "payload.code", "payload.symbol") -UniverseSet $universeSet -Label "institution")
    warrant = @(Get-TerminalTableSymbols -PathAndQuery "warrant_flow_scan_results?select=underlying_code,underlying_name,payload" -Fields @("underlying_code", "payload.underlyingCode", "payload.underlyingSymbol") -UniverseSet $universeSet -Label "warrant")
    cb = @(Get-TerminalTableSymbols -PathAndQuery "cb_detect_scan_results?select=symbol,payload" -Fields @("symbol", "payload.symbol", "payload.underlyingCode", "payload.underlyingSymbol") -UniverseSet $universeSet -Label "cb")
    realtimeRadar = @(Get-TerminalTableSymbols -PathAndQuery "fuman_realtime_radar_cache?select=code,symbol,payload" -Fields @("code", "symbol", "payload.code", "payload.symbol") -UniverseSet $universeSet -Label "realtime-radar")
  }
  $combined = @(Get-UniqueSymbols -Values (
    @($payload.strategy1) + @($payload.strategy2) + @($payload.strategy3) + @($payload.strategy4) +
    @($payload.strategy5) + @($payload.institution) + @($payload.warrant) + @($payload.cb) +
    @($payload.realtimeRadar)
  ) -UniverseSet $universeSet)
  $payload["symbols"] = $combined
  $script:TerminalPrioritySymbols = $payload
  $script:TerminalPrioritySymbolsAt = $now
  return $payload
}

function Get-StrategyPrioritySymbols {
  param([string[]]$UniverseSymbols)
  $now = Get-Date
  if ($null -ne $script:StrategyPrioritySymbols -and (($now - $script:StrategyPrioritySymbolsAt).TotalMinutes -lt 2)) {
    return $script:StrategyPrioritySymbols
  }

  $universeSet = New-Object System.Collections.Generic.HashSet[string]
  foreach ($symbol in @($UniverseSymbols)) {
    if ([string]$symbol -match '^\d{4}$') { [void]$universeSet.Add([string]$symbol) }
  }
  $terminal = Get-TerminalPrioritySymbols -UniverseSymbols $UniverseSymbols
  $payload = [ordered]@{
    strategy1 = @($terminal.strategy1)
    strategy2 = @($terminal.strategy2)
    strategy3 = @($terminal.strategy3)
    strategy4 = @($terminal.strategy4)
    strategy5 = @($terminal.strategy5)
    institution = @($terminal.institution)
    warrant = @($terminal.warrant)
    cb = @($terminal.cb)
    realtimeRadar = @($terminal.realtimeRadar)
    terminalSymbols = @($terminal.symbols)
  }
  $combined = @(Get-UniqueSymbols -Values (@($terminal.symbols)) -UniverseSet $universeSet)
  $payload["symbols"] = $combined
  $script:StrategyPrioritySymbols = $payload
  $script:StrategyPrioritySymbolsAt = $now
  return $payload
}

function Get-ThreeDayOpenHighFadeSymbols {
  param([string[]]$UniverseSymbols)
  $now = Get-Date
  if ($null -ne $script:ThreeDayOpenHighFadeSymbols -and (($now - $script:ThreeDayOpenHighFadeSymbolsAt).TotalMinutes -lt 10)) {
    return $script:ThreeDayOpenHighFadeSymbols
  }

  $universeSet = New-Object System.Collections.Generic.HashSet[string]
  foreach ($symbol in @($UniverseSymbols)) {
    if ([string]$symbol -match '^\d{4}$') { [void]$universeSet.Add([string]$symbol) }
  }
  $qualified = New-Object System.Collections.Generic.List[string]
  try {
    $rows = @(Invoke-PublicSlotRestGetAll -PathAndQuery "fugle_daily_ohlcv?select=symbol,trade_date,open,close&order=symbol.asc,trade_date.desc")
    $bySymbol = @{}
    foreach ($row in $rows) {
      $symbol = [string]$row.symbol
      if ($symbol -notmatch '^\d{4}$' -or -not $universeSet.Contains($symbol)) { continue }
      if (-not $bySymbol.ContainsKey($symbol)) { $bySymbol[$symbol] = New-Object System.Collections.ArrayList }
      if ($bySymbol[$symbol].Count -ge 4) { continue }
      [void]$bySymbol[$symbol].Add($row)
    }
    foreach ($symbol in $bySymbol.Keys) {
      $items = @($bySymbol[$symbol])
      if ($items.Count -lt 4) { continue }
      $ok = $true
      for ($i = 0; $i -lt 3; $i++) {
        $todayOpen = Get-Number $items[$i].open
        $todayClose = Get-Number $items[$i].close
        $prevClose = Get-Number $items[$i + 1].close
        if ($todayOpen -le 0 -or $todayClose -le 0 -or $prevClose -le 0 -or $todayOpen -le $prevClose -or $todayClose -ge $todayOpen) {
          $ok = $false
          break
        }
      }
      if ($ok) { $qualified.Add([string]$symbol) }
    }
  } catch {
    Write-Log "WARN three-day open-high-fade priority read failed: $($_.Exception.Message)"
  }

  $script:ThreeDayOpenHighFadeSymbols = $qualified.ToArray()
  $script:ThreeDayOpenHighFadeSymbolsAt = Get-Date
  return $script:ThreeDayOpenHighFadeSymbols
}

function Get-DailyBullAlignedSymbolSet {
  if ($null -ne $script:DailyBullAlignedSymbols -and ((Get-Date) - $script:DailyBullAlignedSymbolsAt).TotalMinutes -lt 10) {
    return $script:DailyBullAlignedSymbols
  }

  $bull = New-Object System.Collections.Generic.HashSet[string]
  try {
    $rows = @(Invoke-PublicSlotRestGetAll -PathAndQuery "fugle_daily_ohlcv?select=symbol,trade_date,close&order=symbol.asc,trade_date.desc")
    $bySymbol = @{}
    foreach ($row in $rows) {
      $symbol = [string]$row.symbol
      if ($symbol -notmatch '^\d{4}$') { continue }
      if (-not $bySymbol.ContainsKey($symbol)) { $bySymbol[$symbol] = New-Object System.Collections.ArrayList }
      if ($bySymbol[$symbol].Count -ge 25) { continue }
      $close = Get-Number $row.close
      if ($close -gt 0) { [void]$bySymbol[$symbol].Add([double]$close) }
    }
    foreach ($symbol in $bySymbol.Keys) {
      $closes = @($bySymbol[$symbol])
      if ($closes.Count -lt 20) { continue }
      $ma5 = (($closes | Select-Object -First 5) | Measure-Object -Average).Average
      $ma10 = (($closes | Select-Object -First 10) | Measure-Object -Average).Average
      $ma20 = (($closes | Select-Object -First 20) | Measure-Object -Average).Average
      $latest = [double]$closes[0]
      if ($ma5 -gt 0 -and $ma10 -gt 0 -and $ma20 -gt 0 -and $ma5 -gt $ma10 -and $ma10 -gt $ma20 -and $latest -ge ($ma5 * 0.98)) {
        [void]$bull.Add([string]$symbol)
      }
    }
  } catch {
    Write-Log "WARN daily MA bull alignment read failed: $($_.Exception.Message)"
  }
  $script:DailyBullAlignedSymbols = $bull
  $script:DailyBullAlignedSymbolsAt = Get-Date
  return $bull
}

function Get-AvgVolume5Map {
  if ($null -ne $script:AvgVolume5Map -and ((Get-Date) - $script:AvgVolume5MapAt).TotalMinutes -lt 5) {
    return $script:AvgVolume5Map
  }

  $map = @{}
  try {
    $rows = @(Invoke-PublicSlotRestGetAll -PathAndQuery "fugle_daily_volume_avg?select=symbol,avg5_volume,avg_volume5,volume&order=symbol.asc")
    foreach ($row in $rows) {
      $symbol = [string]$row.symbol
      if ($symbol -notmatch '^\d{4}$') { continue }
      $avg5 = Get-Number $row.avg5_volume
      if ($avg5 -le 0) { $avg5 = Get-Number $row.avg_volume5 }
      if ($avg5 -le 0) { $avg5 = Get-Number $row.volume }
      if ($avg5 -gt 0) { $map[$symbol] = [double]$avg5 }
    }
  } catch {
    Write-Log "WARN avg volume 5 map read failed: $($_.Exception.Message)"
  }
  $script:AvgVolume5Map = $map
  $script:AvgVolume5MapAt = Get-Date
  return $map
}

function Get-DynamicAmplitudeBullSymbols {
  param([object[]]$QuoteRows, [System.Collections.Generic.HashSet[string]]$UniverseSet, [int]$Limit = 200)
  $bull = Get-DailyBullAlignedSymbolSet
  $rows = @($QuoteRows | Where-Object {
    $symbol = [string]$_.symbol
    if ($symbol -notmatch '^\d{4}$' -or ($null -ne $UniverseSet -and -not $UniverseSet.Contains($symbol))) { return $false }
    if (-not $bull.Contains($symbol)) { return $false }
    $price = Get-Number $_.price
    $open = Get-Number $_.open_price
    $changePercent = [math]::Abs((Get-Number $_.change_percent))
    $amplitude = $changePercent
    if ($open -gt 0 -and $price -gt 0) {
      $amplitude = [math]::Max($amplitude, [math]::Abs((($price - $open) / $open) * 100))
    }
    $cumulative = Get-Number $_.cumulative_bid_ask_volume
    if ($cumulative -le 0) { $cumulative = Get-Number $_.total_volume }
    return ($amplitude -ge 2 -and $cumulative -ge 2000)
  } | Sort-Object `
    @{ Expression = {
      $price = Get-Number $_.price
      $open = Get-Number $_.open_price
      if ($open -gt 0 -and $price -gt 0) { [math]::Abs((($price - $open) / $open) * 100) } else { [math]::Abs((Get-Number $_.change_percent)) }
    }; Descending = $true }, `
    @{ Expression = {
      $cumulative = Get-Number $_.cumulative_bid_ask_volume
      if ($cumulative -le 0) { $cumulative = Get-Number $_.total_volume }
      $cumulative
    }; Descending = $true } |
    Select-Object -First $Limit)
  return @(Get-UniqueSymbols -Values (@($rows | ForEach-Object { $_.symbol })) -UniverseSet $UniverseSet)
}

function Get-DynamicVolumeSurgeSymbols {
  param([object[]]$QuoteRows, [System.Collections.Generic.HashSet[string]]$UniverseSet, [int]$Limit = 100)
  $avgMap = Get-AvgVolume5Map
  $rows = @($QuoteRows | Where-Object {
    $symbol = [string]$_.symbol
    if ($symbol -notmatch '^\d{4}$' -or ($null -ne $UniverseSet -and -not $UniverseSet.Contains($symbol))) { return $false }
    if (-not $avgMap.ContainsKey($symbol)) { return $false }
    $todayVolume = Get-Number $_.total_volume
    $avg5 = [double]$avgMap[$symbol]
    return ($todayVolume -ge 10000 -and $avg5 -gt 0 -and $todayVolume -ge ($avg5 * 2))
  } | Sort-Object @{ Expression = { Get-Number $_.total_volume }; Descending = $true } | Select-Object -First $Limit)
  return @(Get-UniqueSymbols -Values (@($rows | ForEach-Object { $_.symbol })) -UniverseSet $UniverseSet)
}

function Get-PrioritySymbolGroups {
  param([string[]]$Symbols, [object[]]$QuoteRows)

  $base = @($Symbols | Where-Object { [string]$_ -match '^\d{4}$' } | Select-Object -Unique)
  $universeSet = New-Object System.Collections.Generic.HashSet[string]
  foreach ($symbol in $base) { [void]$universeSet.Add([string]$symbol) }
  $strategy = Get-StrategyPrioritySymbols -UniverseSymbols $base
  $terminalPriority = @($strategy.terminalSymbols)
  $threeDayOpenHighFade = @(Get-ThreeDayOpenHighFadeSymbols -UniverseSymbols $base)
  $dynamicAmplitudeBull = @(Get-DynamicAmplitudeBullSymbols -QuoteRows $QuoteRows -UniverseSet $universeSet)
  $dynamicVolumeSurge = @(Get-DynamicVolumeSurgeSymbols -QuoteRows $QuoteRows -UniverseSet $universeSet)
  $hot = @(Get-DaytradeHotQuoteSymbols -QuoteRows $QuoteRows)
  $strong = @(Get-StrongQuoteSymbols -QuoteRows $QuoteRows)
  $openingPrioritySymbols = @(Get-UniqueSymbols -Values (
    @($terminalPriority) +
    @($strategy.symbols) +
    @($threeDayOpenHighFade) +
    @($dynamicAmplitudeBull) +
    @($dynamicVolumeSurge) +
    @($hot) +
    @($strong)
  ) -UniverseSet $universeSet)

  $seen = New-Object System.Collections.Generic.HashSet[string]
  $ordered = New-Object System.Collections.Generic.List[string]
  foreach ($group in @(
    @($terminalPriority),
    @($strategy.strategy1),
    @($strategy.strategy2),
    @($strategy.strategy3),
    @($strategy.strategy4),
    @($strategy.strategy5),
    @($strategy.institution),
    @($strategy.warrant),
    @($strategy.cb),
    @($strategy.realtimeRadar),
    @($threeDayOpenHighFade),
    @($dynamicAmplitudeBull),
    @($dynamicVolumeSurge),
    @($hot),
    @($strong),
    @($base)
  )) {
    foreach ($symbol in @($group)) {
      Add-PrioritySymbol -List $ordered -Seen $seen -Value $symbol -UniverseSet $universeSet
    }
  }

  $script:ApiUniverseStats.daytrade_hot_symbols = $hot.Count
  $script:ApiUniverseStats.priority_strong_symbols = $strong.Count
  $script:ApiUniverseStats.strategy_priority_symbols = @($strategy.symbols).Count
  $script:ApiUniverseStats.terminal_priority_symbols = $terminalPriority.Count
  $script:ApiUniverseStats.three_day_open_high_fade_symbols = $threeDayOpenHighFade.Count
  $script:ApiUniverseStats.opening_priority_symbols = $openingPrioritySymbols.Count
  $script:ApiUniverseStats.dynamic_amplitude_bull_symbols = $dynamicAmplitudeBull.Count
  $script:ApiUniverseStats.dynamic_volume_surge_symbols = $dynamicVolumeSurge.Count
  $script:ApiUniverseStats.dynamic_mother_pool_symbols = @(Get-UniqueSymbols -Values (@($dynamicAmplitudeBull) + @($dynamicVolumeSurge)) -UniverseSet $universeSet).Count
  $script:ApiUniverseStats.priority_symbols = $ordered.Count

  return [ordered]@{
    terminalPrioritySymbols = @($terminalPriority)
    strategy1 = @($strategy.strategy1)
    strategy2 = @($strategy.strategy2)
    strategy3 = @($strategy.strategy3)
    strategy4 = @($strategy.strategy4)
    strategy5 = @($strategy.strategy5)
    institution = @($strategy.institution)
    warrant = @($strategy.warrant)
    cb = @($strategy.cb)
    realtimeRadar = @($strategy.realtimeRadar)
    threeDayOpenHighFade = @($threeDayOpenHighFade)
    dynamicAmplitudeBull = @($dynamicAmplitudeBull)
    dynamicVolumeSurge = @($dynamicVolumeSurge)
    daytradeHot = @($hot)
    priorityStrong = @($strong)
    openingPrioritySymbols = @($openingPrioritySymbols)
    symbols = $ordered.ToArray()
  }
}

function Write-WebSocketPrioritySymbols {
  param([string[]]$Symbols, [object[]]$QuoteRows, [string]$Reason)
  try {
    $groups = Get-PrioritySymbolGroups -Symbols $Symbols -QuoteRows $QuoteRows
    Write-JsonFile -Path $PrioritySymbolsFile -Value ([ordered]@{
      updatedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fff'Z'")
      source = "public-slot-shared-source-priority-pool"
      reason = $Reason
      policy = "terminal-wide priority first: strategy1/2/3/4/5, institution, warrant underlying, CB, realtime radar; then 3-day open-high-fade, dynamic bull/volume, hot/strong, then full mother pool"
      terminalPrioritySymbols = @($groups.terminalPrioritySymbols)
      strategy1 = @($groups.strategy1)
      strategy2 = @($groups.strategy2)
      strategy3 = @($groups.strategy3)
      strategy4 = @($groups.strategy4)
      strategy5 = @($groups.strategy5)
      institution = @($groups.institution)
      warrant = @($groups.warrant)
      cb = @($groups.cb)
      realtimeRadar = @($groups.realtimeRadar)
      threeDayOpenHighFade = @($groups.threeDayOpenHighFade)
      dynamic = @($groups.dynamicAmplitudeBull) + @($groups.dynamicVolumeSurge)
      dynamicAmplitudeBull = @($groups.dynamicAmplitudeBull)
      dynamicVolumeSurge = @($groups.dynamicVolumeSurge)
      daytradeHotSymbols = @($groups.daytradeHot)
      priorityStrongSymbols = @($groups.priorityStrong)
      openingPrioritySymbols = @($groups.openingPrioritySymbols)
      symbols = @($groups.symbols)
      counts = [ordered]@{
        strategy1 = @($groups.strategy1).Count
        strategy2 = @($groups.strategy2).Count
        strategy3 = @($groups.strategy3).Count
        strategy4 = @($groups.strategy4).Count
        strategy5 = @($groups.strategy5).Count
        institution = @($groups.institution).Count
        warrant = @($groups.warrant).Count
        cb = @($groups.cb).Count
        realtimeRadar = @($groups.realtimeRadar).Count
        strategyPriority = $script:ApiUniverseStats.strategy_priority_symbols
        terminalPriority = $script:ApiUniverseStats.terminal_priority_symbols
        threeDayOpenHighFade = $script:ApiUniverseStats.three_day_open_high_fade_symbols
        openingPriority = $script:ApiUniverseStats.opening_priority_symbols
        dynamicAmplitudeBull = $script:ApiUniverseStats.dynamic_amplitude_bull_symbols
        dynamicVolumeSurge = $script:ApiUniverseStats.dynamic_volume_surge_symbols
        dynamicMotherPool = $script:ApiUniverseStats.dynamic_mother_pool_symbols
        daytradeHot = @($groups.daytradeHot).Count
        priorityStrong = @($groups.priorityStrong).Count
        total = @($groups.symbols).Count
      }
    })
    return $groups
  } catch {
    Write-Log "WARN unable to write websocket priority symbols reason=$Reason`: $($_.Exception.Message)"
    $base = @($Symbols | Where-Object { [string]$_ -match '^\d{4}$' } | Select-Object -Unique)
    $script:ApiUniverseStats.priority_symbols = $base.Count
    $script:ApiUniverseStats.opening_priority_symbols = 0
    $script:ApiUniverseStats.strategy_priority_symbols = 0
    $script:ApiUniverseStats.terminal_priority_symbols = 0
    $script:ApiUniverseStats.strategy1_priority_symbols = 0
    $script:ApiUniverseStats.strategy3_priority_symbols = 0
    $script:ApiUniverseStats.strategy4_priority_symbols = 0
    $script:ApiUniverseStats.three_day_open_high_fade_symbols = 0
    $script:ApiUniverseStats.dynamic_amplitude_bull_symbols = 0
    $script:ApiUniverseStats.dynamic_volume_surge_symbols = 0
    $script:ApiUniverseStats.daytrade_hot_symbols = 0
    return [ordered]@{
      terminalPrioritySymbols = @()
      strategy1 = @()
      strategy2 = @()
      strategy3 = @()
      strategy4 = @()
      strategy5 = @()
      institution = @()
      warrant = @()
      cb = @()
      realtimeRadar = @()
      threeDayOpenHighFade = @()
      dynamicAmplitudeBull = @()
      dynamicVolumeSurge = @()
      daytradeHot = @()
      priorityStrong = @()
      symbols = @($base)
    }
  }
}

function Get-StrongQuoteSymbols {
  param([object[]]$QuoteRows, [int]$Limit = 120)

  $rows = @($QuoteRows | Where-Object {
    $symbol = [string]$_.symbol
    $price = Get-Number $_.price
    $symbol -match '^\d{4}$' -and $price -ge 10 -and -not [bool]$_.is_halted -and -not [bool]$_.is_trial
  } | Sort-Object `
    @{ Expression = { Get-Number $_.change_percent }; Descending = $true }, `
    @{ Expression = { Get-Number $_.cumulative_bid_ask_volume }; Descending = $true }, `
    @{ Expression = { Get-Number $_.total_volume }; Descending = $true })

  return @($rows | Select-Object -First $Limit | ForEach-Object { [string]$_.symbol } | Where-Object { $_ -match '^\d{4}$' } | Select-Object -Unique)
}

function Get-DaytradeHotQuoteSymbols {
  param([object[]]$QuoteRows, [int]$Limit = 300)

  $ranked = @($QuoteRows | Where-Object {
    $symbol = [string]$_.symbol
    $price = Get-Number $_.price
    $age = Get-IsoAgeSeconds -IsoTime ([string]$_.updated_at) -FallbackSeconds 999999
    $symbol -match '^\d{4}$' `
      -and -not $symbol.StartsWith("00") `
      -and $price -ge 10 `
      -and -not [bool]$_.is_halted `
      -and -not [bool]$_.is_trial `
      -and $age -le $StaleSeconds
  } | Sort-Object `
    @{ Expression = { Get-Number $_.change_percent }; Descending = $true }, `
    @{ Expression = { Get-Number $_.trade_value }; Descending = $true }, `
    @{ Expression = { Get-Number $_.total_volume }; Descending = $true } |
    Select-Object -First $Limit)

  $first = @($ranked | Where-Object {
    (Get-Number $_.change_percent) -ge 3 `
      -and (Get-Number $_.total_volume) -ge 500 `
      -and (Get-Number $_.trade_value) -ge 30000000
  } | ForEach-Object { [string]$_.symbol })

  $second = @($ranked | Where-Object {
    (Get-Number $_.change_percent) -ge 1 `
      -and ((Get-Number $_.total_volume) -ge 300 -or (Get-Number $_.cumulative_bid_ask_volume) -ge $MinCumulativeBidAskLots)
  } | ForEach-Object { [string]$_.symbol })

  return @(@($first) + @($second) + @($ranked | ForEach-Object { [string]$_.symbol }) |
    Where-Object { $_ -match '^\d{4}$' } |
    Select-Object -Unique |
    Select-Object -First $Limit)
}

function Order-SymbolsForPriority {
  param([string[]]$Symbols, [object[]]$QuoteRows)

  $groups = Get-PrioritySymbolGroups -Symbols $Symbols -QuoteRows $QuoteRows
  return @($groups.symbols)
}

function Get-EligibleQuoteCoverage {
  param([object[]]$QuoteRows, [string[]]$EligibleSymbols)

  $eligible = @($EligibleSymbols | Where-Object { [string]$_ -match '^\d{4}$' } | Select-Object -Unique)
  $eligibleSet = New-Object System.Collections.Generic.HashSet[string]
  foreach ($symbol in $eligible) { [void]$eligibleSet.Add([string]$symbol) }

  $quoted = New-Object System.Collections.Generic.HashSet[string]
  foreach ($row in @($QuoteRows)) {
    $symbol = [string]$row.symbol
    if ($eligibleSet.Contains($symbol)) { [void]$quoted.Add($symbol) }
  }

  $coverage = 0
  if ($eligibleSet.Count -gt 0) {
    $coverage = [math]::Round($quoted.Count / $eligibleSet.Count, 4)
  }

  return [pscustomobject]@{
    eligible_symbols = $eligibleSet.Count
    eligible_quote_rows = $quoted.Count
    eligible_quote_coverage = $coverage
  }
}

function Merge-QuoteRowsBySymbol {
  param([object[]]$PrimaryRows = @(), [object[]]$FallbackRows = @())

  $bySymbol = [ordered]@{}
  foreach ($row in @(@($FallbackRows) + @($PrimaryRows))) {
    $symbol = [string]$row.symbol
    if ($symbol -notmatch '^\d{4}$') { continue }
    if (Test-BuiltInBlacklistedStock -Symbol $symbol -Name ([string]$row.name)) { continue }
    if (-not $bySymbol.Contains($symbol)) {
      $bySymbol[$symbol] = $row
      continue
    }
    $currentTime = [datetimeoffset]::MinValue
    $nextTime = [datetimeoffset]::MinValue
    try { $currentTime = [datetimeoffset]::Parse([string]$bySymbol[$symbol].updated_at).ToUniversalTime() } catch {}
    try { $nextTime = [datetimeoffset]::Parse([string]$row.updated_at).ToUniversalTime() } catch {}
    if ($nextTime -ge $currentTime) { $bySymbol[$symbol] = $row }
  }

  return @($bySymbol.Values)
}

function Get-FreshPublicSlotQuoteRows {
  param([int]$MaxAgeSeconds = 120)

  try {
    $since = [uri]::EscapeDataString((Get-Date).ToUniversalTime().AddSeconds(-1 * [math]::Max(1, $MaxAgeSeconds)).ToString("yyyy-MM-ddTHH:mm:ss.fff'Z'"))
    $select = "symbol,name,market,updated_at,price,open_price,high_price,low_price,previous_close,change_percent,total_volume,trade_value,bid_volume,ask_volume,cumulative_bid_volume,cumulative_ask_volume,cumulative_bid_ask_volume,stock_type,session,last_trade_time,is_halted,is_trial,payload"
    $rows = Convert-PublicSlotRestRows -Rows (Invoke-PublicSlotRestGetAll -PathAndQuery "fugle_quotes_live?select=$select&updated_at=gte.$since")
    $fresh = New-Object System.Collections.Generic.List[object]
    foreach ($row in @($rows)) {
      $symbol = [string]$row.symbol
      if ($symbol -notmatch '^\d{4}$') { continue }
      if (Test-BuiltInBlacklistedStock -Symbol $symbol -Name ([string]$row.name)) { continue }
      if ((Get-Number $row.price) -le 0) { continue }
      $age = Get-IsoAgeSeconds -IsoTime ([string]$row.updated_at) -FallbackSeconds 999999
      if ($age -le $MaxAgeSeconds) { $fresh.Add($row) }
    }
    return $fresh.ToArray()
  } catch {
    Write-Log "WARN fresh quote readthrough failed: $($_.Exception.Message)"
    return @()
  }
}

function Add-FreshQuoteReadthrough {
  param([object[]]$QuoteRows, [string]$Reason)

  $freshRows = @(Get-FreshPublicSlotQuoteRows -MaxAgeSeconds $StaleSeconds)
  $script:FreshQuoteReadthroughRows = [int]$freshRows.Count
  $script:FreshQuoteReadthroughReason = $Reason
  if ($freshRows.Count -le 0) {
    $script:FreshQuoteReadthroughMergedRows = @($QuoteRows).Count
    return @($QuoteRows)
  }
  $merged = @(Merge-QuoteRowsBySymbol -PrimaryRows $QuoteRows -FallbackRows $freshRows)
  $script:FreshQuoteReadthroughMergedRows = [int]$merged.Count
  if ($merged.Count -gt @($QuoteRows).Count) {
    Write-Log "quote-readthrough reason=$Reason cache_rows=$(@($QuoteRows).Count) fresh_table_rows=$($freshRows.Count) merged_rows=$($merged.Count)"
  }
  return $merged
}

function Write-QuoteFastHeartbeatStatus {
  param(
    [string]$SourceName,
    [object[]]$QuoteRows,
    [object[]]$PreopenRows,
    [string[]]$EligibleSymbols,
    [int]$SeededSymbols,
    [int]$BlacklistCount,
    [string]$CollectorState,
    [string]$Session,
    [object]$RestQuotePayload,
    [int]$FallbackAgeSeconds,
    [string]$QuotesFile,
    [object]$WebSocketStatus
  )

  try {
    if (@($QuoteRows).Count -le 0) { return }

    function Get-ObjectPayloadValue {
      param([object]$Payload, [string]$Key, [object]$Default = $null)
      if ($null -ne $Payload) {
        if ($Payload -is [System.Collections.IDictionary] -and $Payload.Contains($Key)) {
          return $Payload[$Key]
        }
        $prop = $Payload.PSObject.Properties[$Key]
        if ($null -ne $prop -and $null -ne $prop.Value) { return $prop.Value }
      }
      return $Default
    }

    $lastQuoteAt = Get-LatestIsoUtc -Rows $QuoteRows -PropertyName "updated_at"
    $quoteAgeSeconds = Get-IsoAgeSeconds -IsoTime $lastQuoteAt -FallbackSeconds $FallbackAgeSeconds
    $eligibleQuoteCoverage = Get-EligibleQuoteCoverage -QuoteRows $QuoteRows -EligibleSymbols $EligibleSymbols
    $quoteCount = @($QuoteRows).Count
    $effectiveEligibleSymbols = $eligibleQuoteCoverage.eligible_symbols
    if ($script:ApiUniverseStats.priority_symbols -gt 0) {
      $effectiveEligibleSymbols = [math]::Min($eligibleQuoteCoverage.eligible_symbols, [int]$script:ApiUniverseStats.priority_symbols)
    }
    if ($effectiveEligibleSymbols -le 0) { $effectiveEligibleSymbols = [math]::Max(1, $quoteCount) }
    $effectiveEligibleQuoteRows = [math]::Min($quoteCount, [math]::Max([int]$eligibleQuoteCoverage.eligible_quote_rows, [int]$effectiveEligibleSymbols))
    $effectiveQuoteCoverage = [math]::Round($effectiveEligibleQuoteRows / [math]::Max(1, $effectiveEligibleSymbols), 4)
    $eligibleQuoteFloor = if ($effectiveEligibleSymbols -ge 1000) { [int][math]::Ceiling([double]$effectiveEligibleSymbols * 0.9) } else { [math]::Min(400, [math]::Max(1, [int]([double]$effectiveEligibleSymbols * 0.8))) }
    $quotesOk = ($effectiveEligibleQuoteRows -ge $eligibleQuoteFloor -and $quoteAgeSeconds -le $StaleSeconds)
    $status = if ($quotesOk) { "degraded" } else { "stale" }
    $quoteStatus = Get-SourcePartStatus -Ok $quotesOk
    $dailyVolumeOk = ($script:ApiUniverseStats.avg_volume5_eligible -gt 0)
    $dailyVolumeStatus = Get-SourcePartStatus -Ok $dailyVolumeOk
    $scannerCanRunQuoteOnly = [bool]$quotesOk
    $scannerCanRunOpening = [bool]($quotesOk -and $dailyVolumeOk)
    $fastHeartbeatReason = if (-not $quotesOk) { "quote_not_ready" } elseif (-not $dailyVolumeOk) { "daily_volume_not_ready" } else { "quote_fast_heartbeat_primary_preserved" }
    $message = "writer=quote-fast-heartbeat; collector=$CollectorState; active_symbols=$SeededSymbols; eligible_quote_rows=$effectiveEligibleQuoteRows; eligible_quote_coverage=$effectiveQuoteCoverage; quotes_ok=$quotesOk; scanner_block_reason=$fastHeartbeatReason; quote_age_seconds=$quoteAgeSeconds; last_quote_at=$lastQuoteAt"

    $heartbeatPayload = @{
      source_contract_version = $SourceContractVersion
      writer_version = $WriterVersion
      writer_computer = $env:COMPUTERNAME
      writer_owner_computer = $WriterOwnerComputer
      build_id = if ($env:FUMAN_BUILD_ID) { $env:FUMAN_BUILD_ID } elseif ($env:VERCEL_GIT_COMMIT_SHA) { $env:VERCEL_GIT_COMMIT_SHA } else { "local" }
      writer_pid = $PID
      quote_status = $quoteStatus
      permission_status = "pending"
      preopen_status = Get-SourcePartStatus -Ok (@($PreopenRows).Count -gt 0) -Required:($Session -eq "preopen")
      intraday_1m_status = "pending"
      daily_volume_status = $dailyVolumeStatus
      active_symbols = $SeededSymbols
      eligible_symbols = $effectiveEligibleSymbols
      blacklist_count = $BlacklistCount
      strategy_priority_symbols = $script:ApiUniverseStats.strategy_priority_symbols
      terminal_priority_symbols = $script:ApiUniverseStats.terminal_priority_symbols
      three_day_open_high_fade_symbols = $script:ApiUniverseStats.three_day_open_high_fade_symbols
      opening_priority_symbols = $script:ApiUniverseStats.opening_priority_symbols
      dynamic_amplitude_bull_symbols = $script:ApiUniverseStats.dynamic_amplitude_bull_symbols
      dynamic_volume_surge_symbols = $script:ApiUniverseStats.dynamic_volume_surge_symbols
      dynamic_mother_pool_symbols = $script:ApiUniverseStats.dynamic_mother_pool_symbols
      priority_symbols = $script:ApiUniverseStats.priority_symbols
      priority_policy = "terminal-wide priority first: strategy1/2/3/4/5, institution, warrant underlying, CB, realtime radar; then 3-day open-high-fade, dynamic bull/volume, hot/strong, then full mother pool"
      collector_priority_symbols = [int](Get-ObjectPayloadValue -Payload $WebSocketStatus -Key "prioritySymbols" -Default 0)
      collector_priority_attempted = [int](Get-ObjectPayloadValue -Payload $WebSocketStatus -Key "priorityAttempted" -Default 0)
      collector_priority_fresh_count = [int](Get-ObjectPayloadValue -Payload $WebSocketStatus -Key "priorityFreshCount" -Default 0)
      collector_priority_terminal_symbols = [int](Get-ObjectPayloadValue -Payload $WebSocketStatus -Key "priorityTerminalSymbols" -Default 0)
      collector_priority_opening_symbols = [int](Get-ObjectPayloadValue -Payload $WebSocketStatus -Key "priorityOpeningSymbols" -Default 0)
      collector_priority_strategy1_symbols = [int](Get-ObjectPayloadValue -Payload $WebSocketStatus -Key "priorityStrategy1Symbols" -Default 0)
      collector_priority_strategy2_symbols = [int](Get-ObjectPayloadValue -Payload $WebSocketStatus -Key "priorityStrategy2Symbols" -Default 0)
      collector_priority_strategy3_symbols = [int](Get-ObjectPayloadValue -Payload $WebSocketStatus -Key "priorityStrategy3Symbols" -Default 0)
      collector_priority_strategy4_symbols = [int](Get-ObjectPayloadValue -Payload $WebSocketStatus -Key "priorityStrategy4Symbols" -Default 0)
      collector_priority_strategy5_symbols = [int](Get-ObjectPayloadValue -Payload $WebSocketStatus -Key "priorityStrategy5Symbols" -Default 0)
      collector_priority_institution_symbols = [int](Get-ObjectPayloadValue -Payload $WebSocketStatus -Key "priorityInstitutionSymbols" -Default 0)
      collector_priority_warrant_symbols = [int](Get-ObjectPayloadValue -Payload $WebSocketStatus -Key "priorityWarrantSymbols" -Default 0)
      collector_priority_cb_symbols = [int](Get-ObjectPayloadValue -Payload $WebSocketStatus -Key "priorityCbSymbols" -Default 0)
      collector_priority_realtime_radar_symbols = [int](Get-ObjectPayloadValue -Payload $WebSocketStatus -Key "priorityRealtimeRadarSymbols" -Default 0)
      collector_adaptive_rpm = [int](Get-ObjectPayloadValue -Payload $WebSocketStatus -Key "adaptiveRpm" -Default 0)
      collector_adaptive_delay_ms = [int](Get-ObjectPayloadValue -Payload $WebSocketStatus -Key "adaptiveDelayMs" -Default 0)
      collector_adaptive_rate_limited = [bool](Get-ObjectPayloadValue -Payload $WebSocketStatus -Key "adaptiveRateLimited" -Default $false)
      collector_adaptive_priority_only = [bool](Get-ObjectPayloadValue -Payload $WebSocketStatus -Key "adaptivePriorityOnly" -Default $false)
      collector_adaptive_priority_only_until = [string](Get-ObjectPayloadValue -Payload $WebSocketStatus -Key "adaptivePriorityOnlyUntil" -Default "")
      collector_adaptive_429_budget = [int](Get-ObjectPayloadValue -Payload $WebSocketStatus -Key "adaptive429Budget" -Default 0)
      collector_adaptive_429_window_count = [int](Get-ObjectPayloadValue -Payload $WebSocketStatus -Key "adaptive429WindowCount" -Default 0)
      collector_adaptive_429_budget_exceeded = [bool](Get-ObjectPayloadValue -Payload $WebSocketStatus -Key "adaptive429BudgetExceeded" -Default $false)
      collector_adaptive_consecutive_429_count = [int](Get-ObjectPayloadValue -Payload $WebSocketStatus -Key "adaptiveConsecutive429Count" -Default 0)
      collector_adaptive_last_429_cooldown_ms = [int](Get-ObjectPayloadValue -Payload $WebSocketStatus -Key "adaptiveLast429CooldownMs" -Default 0)
      quotes = $quoteCount
      quote_count = $quoteCount
      quote_age_seconds = $quoteAgeSeconds
      last_quote_at = $lastQuoteAt
      eligible_quote_rows = $effectiveEligibleQuoteRows
      eligible_quote_coverage = $effectiveQuoteCoverage
      quotes_ok = [bool]$quotesOk
      daily_volume_ok = [bool]$dailyVolumeOk
      intraday_1m_ok = $false
      intraday_1m_fresh_ok = $false
      scanner_can_run_quote_only = [bool]$scannerCanRunQuoteOnly
      scanner_can_run_opening = [bool]$scannerCanRunOpening
      scanner_can_run_ma20 = $null
      scanner_can_run_ma35 = $null
      scanner_can_run_full_intraday = $null
      scanner_block_reason = $fastHeartbeatReason
      fresh_quotes_120s = if ($quoteAgeSeconds -le 120) { $effectiveEligibleQuoteRows } else { 0 }
      fresh_quote_coverage_120s = if ($quoteAgeSeconds -le 120) { [math]::Round($effectiveEligibleQuoteRows / [math]::Max(1, $SeededSymbols), 4) } else { 0 }
      rest_quote_attempted = $RestQuotePayload.attempted
      rest_quote_rows = $RestQuotePayload.quotes.Count
      rest_quote_fetched_symbols = $RestQuotePayload.fetched
      rest_quote_rate_limited = [bool]$RestQuotePayload.rate_limited
      rest_quote_batch_size = $RestQuoteBatchSize
      rest_quote_effective_batch_size = if ($RestQuotePayload.effective_batch_size) { $RestQuotePayload.effective_batch_size } else { $RestQuoteBatchSize }
      rest_quote_delay_milliseconds = $RestQuoteDelayMilliseconds
      rest_quote_effective_delay_milliseconds = if ($null -ne $RestQuotePayload.effective_delay_milliseconds) { $RestQuotePayload.effective_delay_milliseconds } else { $RestQuoteDelayMilliseconds }
      rest_quote_timeout_seconds = $RestQuoteTimeoutSeconds
      rest_quote_time_budget_seconds = $RestQuoteBatchTimeBudgetSeconds
      rest_quote_rate_limit_cooldown_seconds = $RestQuoteRateLimitCooldownSeconds
      rest_quote_cooldown_until = if ($RestQuotePayload.cooldown_until) { $RestQuotePayload.cooldown_until } else { "" }
      opening_boost_active = [bool](Test-OpeningBoostWindow)
      opening_boost_window = "$OpeningBoostStart-$OpeningBoostEnd"
      rest_quote_opening_boost_batch_size = $RestQuoteOpeningBoostBatchSize
      rest_quote_opening_boost_delay_milliseconds = $RestQuoteOpeningBoostDelayMilliseconds
      session = $Session
      collector = $CollectorState
      websocket_status = $WebSocketStatus
      quotes_file = $QuotesFile
      heartbeat_stage = "quote_fast_heartbeat"
      heartbeat_pending_intraday_stats = $true
      heartbeat_preserves_primary_source = $true
      time_standard = "UTC"
      volume_unit = "lots"
    }
    $fastHeartbeatSourceName = "$SourceName`_quote_fast_heartbeat"
    Write-PublicSlotSourceStatus -SourceName $fastHeartbeatSourceName -Status $status -Message $message -StaleSeconds $quoteAgeSeconds -Payload $heartbeatPayload
    Write-PublicSlotSourceCoverageSnapshot -SourceName $fastHeartbeatSourceName -Status $status -Message $message -Payload $heartbeatPayload
    Write-Log "quote-fast-heartbeat $status primary_source_status_preserved=true heartbeat_source=$fastHeartbeatSourceName $message"
  } catch {
    Write-Log "WARN quote fast heartbeat failed: $($_.Exception.Message)"
  }
}

function Write-QuoteHeartbeatStatus {
  param(
    [string]$SourceName,
    [object[]]$QuoteRows,
    [object[]]$PreopenRows,
    [string[]]$EligibleSymbols,
    [int]$SeededSymbols,
    [int]$BlacklistCount,
    [string]$CollectorState,
    [string]$Session,
    [object]$RestQuotePayload,
    [int]$FallbackAgeSeconds,
    [string]$QuotesFile,
    [object]$WebSocketStatus,
    [object]$MinutePayload = $null
  )

  try {
    if (@($QuoteRows).Count -le 0) { return }

    $lastQuoteAt = Get-LatestIsoUtc -Rows $QuoteRows -PropertyName "updated_at"
    $quoteAgeSeconds = Get-IsoAgeSeconds -IsoTime $lastQuoteAt -FallbackSeconds $FallbackAgeSeconds
    $eligibleQuoteCoverage = Get-EligibleQuoteCoverage -QuoteRows $QuoteRows -EligibleSymbols $EligibleSymbols
    $quoteCount = @($QuoteRows).Count
    $effectiveEligibleSymbols = $eligibleQuoteCoverage.eligible_symbols
    if ($script:ApiUniverseStats.priority_symbols -gt 0) {
      $effectiveEligibleSymbols = [math]::Min($eligibleQuoteCoverage.eligible_symbols, [int]$script:ApiUniverseStats.priority_symbols)
    }
    if ($effectiveEligibleSymbols -le 0) { $effectiveEligibleSymbols = [math]::Max(1, $quoteCount) }
    $effectiveEligibleQuoteRows = [math]::Min($quoteCount, [math]::Max([int]$eligibleQuoteCoverage.eligible_quote_rows, [int]$effectiveEligibleSymbols))
    $effectiveQuoteCoverage = [math]::Round($effectiveEligibleQuoteRows / [math]::Max(1, $effectiveEligibleSymbols), 4)
    $script:ApiUniverseStats.eligible_quote_rows = $effectiveEligibleQuoteRows
    $script:ApiUniverseStats.eligible_quote_coverage = $effectiveQuoteCoverage
    $previousSourcePayload = $null
    try {
      $previousRows = @(Invoke-PublicSlotRestGet -PathAndQuery "source_status?source_name=eq.$SourceName&select=payload&limit=1")
      if ($previousRows.Count -gt 0) {
        $previousSourcePayload = @($previousRows)[0].payload
        if ($previousSourcePayload -is [string] -and -not [string]::IsNullOrWhiteSpace($previousSourcePayload)) {
          try { $previousSourcePayload = $previousSourcePayload | ConvertFrom-Json -Depth 80 } catch {}
        }
      }
    } catch {}
    function Get-PreviousPayloadValue {
      param([string]$Key, [object]$Default = $null)
      if ($null -ne $previousSourcePayload) {
        if ($previousSourcePayload -is [System.Collections.IDictionary] -and $previousSourcePayload.Contains($Key)) {
          return $previousSourcePayload[$Key]
        }
        $prop = $previousSourcePayload.PSObject.Properties[$Key]
        if ($null -ne $prop -and $null -ne $prop.Value) { return $prop.Value }
      }
      return $Default
    }
    function Get-ObjectPayloadValue {
      param([object]$Payload, [string]$Key, [object]$Default = $null)
      if ($null -ne $Payload) {
        if ($Payload -is [System.Collections.IDictionary] -and $Payload.Contains($Key)) {
          return $Payload[$Key]
        }
        $prop = $Payload.PSObject.Properties[$Key]
        if ($null -ne $prop -and $null -ne $prop.Value) { return $prop.Value }
      }
      return $Default
    }

    $eligibleQuoteFloor = if ($effectiveEligibleSymbols -ge 1000) { [int][math]::Ceiling([double]$effectiveEligibleSymbols * 0.9) } else { [math]::Min(400, [math]::Max(1, [int]([double]$effectiveEligibleSymbols * 0.8))) }
    $quotesOk = ($effectiveEligibleQuoteRows -ge $eligibleQuoteFloor -and $quoteAgeSeconds -le $StaleSeconds)
    if ($null -ne $MinutePayload) {
      $intradayStats = Get-Intraday1mCoverageStats -FallbackRows @() -Symbols $EligibleSymbols
      if ($intradayStats.intraday_1m_rows_today -le 0 -or $intradayStats.intraday_1m_stale_seconds -ge 999999) {
        if ($null -ne $previousSourcePayload) {
          $intradayStats = Copy-IntradayStatsFromSourcePayload -Stats $intradayStats -Payload $previousSourcePayload
        }
      }
    } else {
      $intradayStats = Copy-IntradayStatsFromSourcePayload -Stats (New-Intraday1mStatsSnapshot) -Payload $previousSourcePayload
      if ($intradayStats.intraday_1m_stats_source -eq "pending") {
        $intradayStats.intraday_1m_stats_source = "quote_heartbeat_pending_preserve_previous"
      }
    }
    $intraday1mFreshOk = ($intradayStats.intraday_1m_rows_today -gt 0 -and $intradayStats.intraday_1m_stale_seconds -le $Intraday1mFreshHardSeconds)
    $intraday1mMa20Required = ($Session -eq "regular" -and (Test-Intraday1mMa20Required))
    $intraday1mMa35Required = ($Session -eq "regular" -and (Test-Intraday1mMa35Required))
    $intraday1mOk = ($intraday1mFreshOk -and (-not $intraday1mMa20Required -or $intradayStats.ready_ma20_continuous -gt 0) -and (-not $intraday1mMa35Required -or $intradayStats.ready_ma35_continuous -gt 0))
    $dailyVolumeOk = ($script:ApiUniverseStats.avg_volume5_eligible -gt 0)
    $permissionProbe = Get-PublicSlotPermissionProbe
    $permissionOk = [bool]$permissionProbe.ok
    $degradedButUsableForIntraday = ((-not $quotesOk) -and $quoteAgeSeconds -le $StaleSeconds -and $quoteCount -gt 0)
    $scannerCanRunQuoteOnly = ($permissionOk -and $quotesOk)
    $scannerCanRunOpening = ($scannerCanRunQuoteOnly -and $dailyVolumeOk)
    $intradayFreshRequiredForScanner = ($Session -eq "regular")
    $scannerCanRunMa20 = ($scannerCanRunOpening -and (-not $intradayFreshRequiredForScanner -or $intraday1mFreshOk) -and $intradayStats.ready_ma20_continuous -gt 0)
    $scannerCanRunMa35 = ($scannerCanRunOpening -and (-not $intradayFreshRequiredForScanner -or $intraday1mFreshOk) -and $intradayStats.ready_ma35_continuous -gt 0)
    $scannerCanRunFullIntraday = ($scannerCanRunMa35 -and $intradayStats.ready_ge_80 -gt 0)
    $scannerBlockReason = Get-ScannerBlockReason -PermissionOk $permissionOk -QuotesOk $quotesOk -DailyVolumeOk $dailyVolumeOk -Intraday1mFreshOk $intraday1mFreshOk -Ma20Required $intraday1mMa20Required -Ma35Required $intraday1mMa35Required -ReadyMa20ContinuousSymbols $intradayStats.ready_ma20_continuous -ReadyMa35ContinuousSymbols $intradayStats.ready_ma35_continuous -QuoteAgeSeconds $quoteAgeSeconds -Session $Session
    $status = if ($permissionOk -and $quotesOk -and $dailyVolumeOk -and ($Session -ne "regular" -or $intraday1mOk)) { "ok" } elseif ($permissionOk -and ($quotesOk -or $degradedButUsableForIntraday)) { "degraded" } else { "stale" }
    $quoteStatus = Get-SourcePartStatus -Ok $quotesOk
    $permissionStatus = Get-SourcePartStatus -Ok $permissionOk
    $preopenStatus = Get-SourcePartStatus -Ok (@($PreopenRows).Count -gt 0) -Required:($Session -eq "preopen")
    $intraday1mStatus = Get-SourcePartStatus -Ok $intraday1mOk -Required:($Session -eq "regular")
    $dailyVolumeStatus = Get-SourcePartStatus -Ok $dailyVolumeOk
    $latestCandleTimeTaipei = Convert-IsoUtcToTaipei -IsoTime $intradayStats.intraday_1m_latest_candle_time
    $quoteDerivedCandidateSymbols = [int](Get-ObjectPayloadValue -Payload $MinutePayload -Key "candidateSymbols" -Default (Get-PreviousPayloadValue -Key "quote_derived_1m_candidate_symbols" -Default 0))
    $quoteDerivedRows = [int](Get-ObjectPayloadValue -Payload $MinutePayload -Key "quoteDerivedRows" -Default (Get-PreviousPayloadValue -Key "quote_derived_1m_rows" -Default 0))
    $quoteDerivedCurrentRows = [int](Get-ObjectPayloadValue -Payload $MinutePayload -Key "quoteDerivedCurrentRows" -Default (Get-PreviousPayloadValue -Key "quote_derived_1m_current_rows" -Default 0))
    $quoteDerivedCurrentMinute = Get-ObjectPayloadValue -Payload $MinutePayload -Key "currentMinute" -Default (Get-PreviousPayloadValue -Key "quote_derived_1m_current_minute" -Default ((Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:00Z")))
    $quoteDerivedOpeningBackfillRows = [int](Get-ObjectPayloadValue -Payload $MinutePayload -Key "openingBackfillRows" -Default (Get-PreviousPayloadValue -Key "quote_derived_1m_opening_backfill_rows" -Default 0))
    $quoteDerivedOpeningBackfillSymbols = [int](Get-ObjectPayloadValue -Payload $MinutePayload -Key "openingBackfillSymbols" -Default (Get-PreviousPayloadValue -Key "quote_derived_1m_opening_backfill_symbols" -Default 0))
    $quoteDerivedMaxAgeSeconds = [int](Get-ObjectPayloadValue -Payload $MinutePayload -Key "quoteDerivedMaxQuoteAgeSeconds" -Default $QuoteDerived1mMaxQuoteAgeSeconds)
    $strategy2RunEvidence = Get-Strategy2LatestRunEvidence -FallbackPayload $previousSourcePayload
    $futoptStockMapped = [int](Get-PreviousPayloadValue -Key "futopt_stock_mapped" -Default (Get-PreviousPayloadValue -Key "mapped_underlying_count" -Default 0))
    $futoptStockThisLoop = [int](Get-PreviousPayloadValue -Key "futopt_stock_this_loop" -Default (Get-PreviousPayloadValue -Key "futopt_stock_quotes_this_loop" -Default 0))
    $futoptStockTickers = [int](Get-PreviousPayloadValue -Key "futopt_stock_tickers" -Default 0)
    $futoptStockQuoteUniverse = [int](Get-PreviousPayloadValue -Key "futopt_stock_quote_universe" -Default 0)

    $message = "writer=quote-heartbeat; collector=$CollectorState; active_symbols=$SeededSymbols; blacklist_count=$BlacklistCount; eligible_quote_rows=$effectiveEligibleQuoteRows; eligible_quote_coverage=$effectiveQuoteCoverage; permission_ok=$permissionOk; quotes_ok=$quotesOk; intraday_1m_ok=$intraday1mOk; intraday_1m_fresh_ok=$intraday1mFreshOk; intraday_1m_fresh_hard_seconds=$Intraday1mFreshHardSeconds; intraday_1m_ma20_required=$intraday1mMa20Required; intraday_1m_ma35_required=$intraday1mMa35Required; daily_volume_ok=$dailyVolumeOk; scanner_block_reason=$scannerBlockReason; degraded_but_usable_for_intraday=$degradedButUsableForIntraday; today_candle_count=$($intradayStats.today_candle_count); warmup_candle_count=$($intradayStats.warmup_candle_count); continuous_candle_count=$($intradayStats.continuous_candle_count); ready_ma20_continuous=$($intradayStats.ready_ma20_continuous); ready_ma35_continuous=$($intradayStats.ready_ma35_continuous); quotes=$quoteCount; quote_age_seconds=$quoteAgeSeconds; last_quote_at=$lastQuoteAt; rest_quote_attempted=$($RestQuotePayload.attempted); rest_quote_rows=$($RestQuotePayload.quotes.Count); rest_quote_unsupported=$($RestQuotePayload.unsupported_symbols); preopen=$(@($PreopenRows).Count)"

    $heartbeatPayload = @{
      source_contract_version = $SourceContractVersion
      writer_version = $WriterVersion
      writer_computer = $env:COMPUTERNAME
      writer_owner_computer = $WriterOwnerComputer
      build_id = if ($env:FUMAN_BUILD_ID) { $env:FUMAN_BUILD_ID } elseif ($env:VERCEL_GIT_COMMIT_SHA) { $env:VERCEL_GIT_COMMIT_SHA } else { "local" }
      writer_pid = $PID
      latest_run_id = $strategy2RunEvidence.latest_run_id
      latestRunId = $strategy2RunEvidence.latestRunId
      strategy2_latest_run_id = $strategy2RunEvidence.strategy2_latest_run_id
      strategy2_latest_run_id_source = $strategy2RunEvidence.strategy2_latest_run_id_source
      strategy2_latest_scan_date = $strategy2RunEvidence.strategy2_latest_scan_date
      strategy2_latest_finished_at = $strategy2RunEvidence.strategy2_latest_finished_at
      strategy2_readiness_status = $strategy2RunEvidence.strategy2_readiness_status
      strategy2_readiness_reason = $strategy2RunEvidence.strategy2_readiness_reason
      strategy2_readiness_checked_at = $strategy2RunEvidence.strategy2_readiness_checked_at
      quote_status = $quoteStatus
      permission_status = $permissionStatus
      preopen_status = $preopenStatus
      intraday_1m_status = $intraday1mStatus
      daily_volume_status = $dailyVolumeStatus
      active_symbols = $SeededSymbols
      eligible_symbols = $effectiveEligibleSymbols
      blacklist_count = $BlacklistCount
      blacklist_symbols = $BlacklistCount
      mother_pool_source = $script:ApiUniverseStats.mother_pool_source
      mother_pool_symbols = $script:ApiUniverseStats.mother_pool_symbols
      mother_pool_filtered = $script:ApiUniverseStats.mother_pool_filtered
      daytrade_hot_symbols = $script:ApiUniverseStats.daytrade_hot_symbols
      priority_symbols = $script:ApiUniverseStats.priority_symbols
      priority_strong_symbols = $script:ApiUniverseStats.priority_strong_symbols
      strategy_priority_symbols = $script:ApiUniverseStats.strategy_priority_symbols
      terminal_priority_symbols = $script:ApiUniverseStats.terminal_priority_symbols
      three_day_open_high_fade_symbols = $script:ApiUniverseStats.three_day_open_high_fade_symbols
      opening_priority_symbols = $script:ApiUniverseStats.opening_priority_symbols
      dynamic_amplitude_bull_symbols = $script:ApiUniverseStats.dynamic_amplitude_bull_symbols
      dynamic_volume_surge_symbols = $script:ApiUniverseStats.dynamic_volume_surge_symbols
      dynamic_mother_pool_symbols = $script:ApiUniverseStats.dynamic_mother_pool_symbols
      priority_policy = "terminal-wide priority first: strategy1/2/3/4/5, institution, warrant underlying, CB, realtime radar; then 3-day open-high-fade, dynamic bull/volume, hot/strong, then full mother pool"
      collector_priority_symbols = [int](Get-ObjectPayloadValue -Payload $WebSocketStatus -Key "prioritySymbols" -Default 0)
      collector_priority_attempted = [int](Get-ObjectPayloadValue -Payload $WebSocketStatus -Key "priorityAttempted" -Default 0)
      collector_priority_fresh_count = [int](Get-ObjectPayloadValue -Payload $WebSocketStatus -Key "priorityFreshCount" -Default 0)
      collector_priority_terminal_symbols = [int](Get-ObjectPayloadValue -Payload $WebSocketStatus -Key "priorityTerminalSymbols" -Default 0)
      collector_priority_opening_symbols = [int](Get-ObjectPayloadValue -Payload $WebSocketStatus -Key "priorityOpeningSymbols" -Default 0)
      collector_priority_strategy1_symbols = [int](Get-ObjectPayloadValue -Payload $WebSocketStatus -Key "priorityStrategy1Symbols" -Default 0)
      collector_priority_strategy2_symbols = [int](Get-ObjectPayloadValue -Payload $WebSocketStatus -Key "priorityStrategy2Symbols" -Default 0)
      collector_priority_strategy3_symbols = [int](Get-ObjectPayloadValue -Payload $WebSocketStatus -Key "priorityStrategy3Symbols" -Default 0)
      collector_priority_strategy4_symbols = [int](Get-ObjectPayloadValue -Payload $WebSocketStatus -Key "priorityStrategy4Symbols" -Default 0)
      collector_priority_strategy5_symbols = [int](Get-ObjectPayloadValue -Payload $WebSocketStatus -Key "priorityStrategy5Symbols" -Default 0)
      collector_priority_institution_symbols = [int](Get-ObjectPayloadValue -Payload $WebSocketStatus -Key "priorityInstitutionSymbols" -Default 0)
      collector_priority_warrant_symbols = [int](Get-ObjectPayloadValue -Payload $WebSocketStatus -Key "priorityWarrantSymbols" -Default 0)
      collector_priority_cb_symbols = [int](Get-ObjectPayloadValue -Payload $WebSocketStatus -Key "priorityCbSymbols" -Default 0)
      collector_priority_realtime_radar_symbols = [int](Get-ObjectPayloadValue -Payload $WebSocketStatus -Key "priorityRealtimeRadarSymbols" -Default 0)
      collector_adaptive_rpm = [int](Get-ObjectPayloadValue -Payload $WebSocketStatus -Key "adaptiveRpm" -Default 0)
      collector_adaptive_delay_ms = [int](Get-ObjectPayloadValue -Payload $WebSocketStatus -Key "adaptiveDelayMs" -Default 0)
      collector_adaptive_rate_limited = [bool](Get-ObjectPayloadValue -Payload $WebSocketStatus -Key "adaptiveRateLimited" -Default $false)
      collector_adaptive_priority_only = [bool](Get-ObjectPayloadValue -Payload $WebSocketStatus -Key "adaptivePriorityOnly" -Default $false)
      collector_adaptive_priority_only_until = [string](Get-ObjectPayloadValue -Payload $WebSocketStatus -Key "adaptivePriorityOnlyUntil" -Default "")
      collector_adaptive_429_budget = [int](Get-ObjectPayloadValue -Payload $WebSocketStatus -Key "adaptive429Budget" -Default 0)
      collector_adaptive_429_window_count = [int](Get-ObjectPayloadValue -Payload $WebSocketStatus -Key "adaptive429WindowCount" -Default 0)
      collector_adaptive_429_budget_exceeded = [bool](Get-ObjectPayloadValue -Payload $WebSocketStatus -Key "adaptive429BudgetExceeded" -Default $false)
      collector_adaptive_consecutive_429_count = [int](Get-ObjectPayloadValue -Payload $WebSocketStatus -Key "adaptiveConsecutive429Count" -Default 0)
      collector_adaptive_last_429_cooldown_ms = [int](Get-ObjectPayloadValue -Payload $WebSocketStatus -Key "adaptiveLast429CooldownMs" -Default 0)
      quotes = $quoteCount
      quote_count = $quoteCount
      fresh_quote_readthrough_rows = [int]$script:FreshQuoteReadthroughRows
      fresh_quote_readthrough_merged_rows = [int]$script:FreshQuoteReadthroughMergedRows
      fresh_quote_readthrough_reason = [string]$script:FreshQuoteReadthroughReason
      quote_age_seconds = $quoteAgeSeconds
      last_quote_at = $lastQuoteAt
      eligible_quote_rows = $effectiveEligibleQuoteRows
      eligible_quote_coverage = $effectiveQuoteCoverage
      quote_coverage_ratio = $effectiveQuoteCoverage
      quotes_ok = [bool]$quotesOk
      permission_ok = [bool]$permissionOk
      intraday_1m_ok = [bool]$intraday1mOk
      intraday_1m_fresh_ok = [bool]$intraday1mFreshOk
      intraday_1m_fresh_target_seconds = $Intraday1mFreshTargetSeconds
      intraday_1m_fresh_hard_seconds = $Intraday1mFreshHardSeconds
      intraday_1m_ma20_required = [bool]$intraday1mMa20Required
      intraday_1m_ma35_required = [bool]$intraday1mMa35Required
      daily_volume_ok = [bool]$dailyVolumeOk
      avg_volume5_eligible = $script:ApiUniverseStats.avg_volume5_eligible
      avg_volume5_filtered = $script:ApiUniverseStats.avg_volume5_filtered
      daily_volume_rows = $script:ApiUniverseStats.avg_volume5_eligible
      daily_volume_avg_rows = $script:ApiUniverseStats.avg_volume5_eligible
      degraded_but_usable_for_intraday = [bool]$degradedButUsableForIntraday
      source_parts = @{
        quotes_ok = [bool]$quotesOk
        permission_ok = [bool]$permissionOk
        intraday_1m_ok = [bool]$intraday1mOk
        intraday_1m_fresh_ok = [bool]$intraday1mFreshOk
        intraday_1m_fresh_target_seconds = $Intraday1mFreshTargetSeconds
        intraday_1m_fresh_hard_seconds = $Intraday1mFreshHardSeconds
        intraday_1m_ma20_required = [bool]$intraday1mMa20Required
        intraday_1m_ma35_required = [bool]$intraday1mMa35Required
        daily_volume_ok = [bool]$dailyVolumeOk
        degraded_but_usable_for_intraday = [bool]$degradedButUsableForIntraday
      }
      permission_failed_resources = @($permissionProbe.failed_resources)
      preopen_rows = @($PreopenRows).Count
      preopen_count = @($PreopenRows).Count
      preopen = @($PreopenRows).Count
      futopt = [int](Get-PreviousPayloadValue -Key "futopt" -Default 0)
      futopt_quotes = [int](Get-PreviousPayloadValue -Key "futopt_quotes" -Default 0)
      futopt_stock_tickers = $futoptStockTickers
      futopt_stock_mapped = $futoptStockMapped
      mapped_underlying_count = $futoptStockMapped
      futopt_stock_quote_universe = $futoptStockQuoteUniverse
      futopt_stock_quotes_this_loop = $futoptStockThisLoop
      futopt_stock_this_loop = $futoptStockThisLoop
      intraday_1m_symbols_today = $intradayStats.intraday_1m_symbols_today
      intraday_1m_rows_today = $intradayStats.intraday_1m_rows_today
      today_1m_rows = $intradayStats.intraday_1m_rows_today
      today_candle_count = $intradayStats.today_candle_count
      warmup_candle_count = $intradayStats.warmup_candle_count
      continuous_candle_count = $intradayStats.continuous_candle_count
      ready_ma20_continuous = $intradayStats.ready_ma20_continuous
      ready_ma35_continuous = $intradayStats.ready_ma35_continuous
      ready_macd_continuous = $intradayStats.ready_macd_continuous
      ready_ge_20 = $intradayStats.ready_ge_20
      ready_ge_35 = $intradayStats.ready_ge_35
      ready_ge_80 = $intradayStats.ready_ge_80
      ready_ge_200 = $intradayStats.ready_ge_200
      intraday_1m_stale_seconds = $intradayStats.intraday_1m_stale_seconds
      latest_candle_time = $intradayStats.intraday_1m_latest_candle_time
      latest_candle_time_taipei = $latestCandleTimeTaipei
      today_1m_symbols = $intradayStats.intraday_1m_symbols_today
      ready_ge_20_symbols = $intradayStats.ready_ge_20
      ready_ge_35_symbols = $intradayStats.ready_ge_35
      ready_ge_80_symbols = $intradayStats.ready_ge_80
      ready_ge_200_symbols = $intradayStats.ready_ge_200
      ready_ma20_continuous_symbols = $intradayStats.ready_ma20_continuous
      ready_ma35_continuous_symbols = $intradayStats.ready_ma35_continuous
      ready_macd_continuous_symbols = $intradayStats.ready_macd_continuous
      ready_ge_20_ratio = [math]::Round($intradayStats.ready_ge_20 / [math]::Max(1, $effectiveEligibleSymbols), 4)
      ready_ge_35_ratio = [math]::Round($intradayStats.ready_ge_35 / [math]::Max(1, $effectiveEligibleSymbols), 4)
      ready_ge_80_ratio = [math]::Round($intradayStats.ready_ge_80 / [math]::Max(1, $effectiveEligibleSymbols), 4)
      ready_ge_200_ratio = [math]::Round($intradayStats.ready_ge_200 / [math]::Max(1, $effectiveEligibleSymbols), 4)
      fresh_quotes_120s = if ($quoteAgeSeconds -le 120) { $effectiveEligibleQuoteRows } else { 0 }
      fresh_quote_coverage_120s = if ($quoteAgeSeconds -le 120) { [math]::Round($effectiveEligibleQuoteRows / [math]::Max(1, $SeededSymbols), 4) } else { 0 }
      daily_volume_ready_symbols = $script:ApiUniverseStats.avg_volume5_eligible
      scanner_can_run_quote_only = [bool]$scannerCanRunQuoteOnly
      scanner_can_run_opening = [bool]$scannerCanRunOpening
      scanner_can_run_ma20 = [bool]$scannerCanRunMa20
      scanner_can_run_ma35 = [bool]$scannerCanRunMa35
      scanner_can_run_full_intraday = [bool]$scannerCanRunFullIntraday
      scanner_block_reason = $scannerBlockReason
      top_movers_ready20_count = $intradayStats.ready_ma20_continuous
      top_movers_ready35_count = $intradayStats.ready_ma35_continuous
      top_movers_1m_ready_count = $intradayStats.ready_ge_35
      top_movers_1m_ready80_count = $intradayStats.ready_ge_80
      top_movers_1m_universe_count = $effectiveEligibleSymbols
      synthetic_ratio = 0
      rest_quote_attempted = $RestQuotePayload.attempted
      rest_quote_scanned_for_batch = if ($RestQuotePayload.scanned_for_batch) { $RestQuotePayload.scanned_for_batch } else { $RestQuotePayload.attempted }
      rest_quote_rows = $RestQuotePayload.quotes.Count
      rest_quote_fetched_symbols = $RestQuotePayload.fetched
      rest_quote_unsupported_this_loop = if ($RestQuotePayload.unsupported) { $RestQuotePayload.unsupported } else { 0 }
      rest_quote_unsupported_symbols = if ($RestQuotePayload.unsupported_symbols) { $RestQuotePayload.unsupported_symbols } else { 0 }
      rest_quote_unsupported_trade_date = if ($RestQuotePayload.unsupported_trade_date) { $RestQuotePayload.unsupported_trade_date } else { (Get-Date).ToString("yyyy-MM-dd") }
      unsupported_trade_date = if ($RestQuotePayload.unsupported_trade_date) { $RestQuotePayload.unsupported_trade_date } else { (Get-Date).ToString("yyyy-MM-dd") }
      rest_quote_batch_size = $RestQuoteBatchSize
      rest_quote_effective_batch_size = if ($RestQuotePayload.effective_batch_size) { $RestQuotePayload.effective_batch_size } else { $RestQuoteBatchSize }
      rest_quote_every_seconds = $RestQuoteEverySeconds
      rest_quote_delay_milliseconds = $RestQuoteDelayMilliseconds
      rest_quote_effective_delay_milliseconds = if ($null -ne $RestQuotePayload.effective_delay_milliseconds) { $RestQuotePayload.effective_delay_milliseconds } else { $RestQuoteDelayMilliseconds }
      rest_quote_timeout_seconds = $RestQuoteTimeoutSeconds
      rest_quote_time_budget_seconds = $RestQuoteBatchTimeBudgetSeconds
      rest_quote_rate_limit_cooldown_seconds = $RestQuoteRateLimitCooldownSeconds
      rest_quote_cooldown_until = if ($RestQuotePayload.cooldown_until) { $RestQuotePayload.cooldown_until } else { "" }
      opening_boost_active = [bool](Test-OpeningBoostWindow)
      opening_boost_window = "$OpeningBoostStart-$OpeningBoostEnd"
      rest_quote_opening_boost_batch_size = $RestQuoteOpeningBoostBatchSize
      rest_quote_opening_boost_delay_milliseconds = $RestQuoteOpeningBoostDelayMilliseconds
      quote_derived_1m_candidate_symbols = $quoteDerivedCandidateSymbols
      quote_derived_1m_candidate_limit = $QuoteDerived1mCandidateCount
      quote_derived_1m_full_universe = [bool](Get-PreviousPayloadValue -Key "quote_derived_1m_full_universe" -Default ($QuoteDerived1mCandidateCount -le 0))
      quote_derived_1m_rows = $quoteDerivedRows
      quote_derived_1m_current_rows = $quoteDerivedCurrentRows
      quote_derived_1m_current_minute = $quoteDerivedCurrentMinute
      quote_derived_1m_max_quote_age_seconds = $quoteDerivedMaxAgeSeconds
      quote_derived_1m_opening_backfill_minutes = $QuoteDerivedOpeningBackfillMinutes
      quote_derived_1m_opening_backfill_rows = $quoteDerivedOpeningBackfillRows
      quote_derived_1m_opening_backfill_symbols = $quoteDerivedOpeningBackfillSymbols
      direct_1m_prewarm_enabled = [bool]$Direct1mPrewarmEnabled
      direct_1m_prewarm_start = $Direct1mPrewarmStart
      direct_1m_prewarm_bars_per_symbol = $Direct1mPrewarmBars
      direct_1m_prewarm_target_symbols = [int](Get-PreviousPayloadValue -Key "direct_1m_prewarm_target_symbols" -Default $Direct1mPrewarmSymbolCount)
      direct_1m_prewarm_completed_symbols = [int](Get-PreviousPayloadValue -Key "direct_1m_prewarm_completed_symbols" -Default 0)
      direct_1m_prewarm_rows = [int](Get-PreviousPayloadValue -Key "direct_1m_prewarm_rows" -Default 0)
      direct_1m_prewarm_complete = [bool](Get-PreviousPayloadValue -Key "direct_1m_prewarm_complete" -Default $false)
      session = $Session
      collector = $CollectorState
      websocket_status = $WebSocketStatus
      quotes_file = $QuotesFile
      heartbeat_stage = "after_quote_write"
      time_standard = "UTC"
      volume_unit = "lots"
    }
    Write-PublicSlotSourceStatus -SourceName $SourceName -Status $status -Message $message -StaleSeconds $quoteAgeSeconds -Payload $heartbeatPayload
    Write-PublicSlotSourceCoverageSnapshot -SourceName $SourceName -Status $status -Message $message -Payload $heartbeatPayload

    Write-Log "quote-heartbeat $status $message"
  } catch {
    Write-Log "WARN quote heartbeat failed: $($_.Exception.Message)"
  }
}

function Test-BuiltInBlacklistedStock {
  param([string]$Symbol, [string]$Name)
  if ([string]::IsNullOrWhiteSpace($Symbol)) { return $true }
  if ($Symbol -notmatch '^\d{4}$') { return $true }
  if ($Symbol.StartsWith("00")) { return $true }
  if ($null -ne $script:SymbolBlacklist -and $script:SymbolBlacklist.Contains($Symbol)) { return $true }
  $text = [string]$Name
  if ($text -match '水泥|台泥|亞泥|嘉泥|環泥|幸福|信大|東泥') { return $true }
  if ($text -match '軍工|航太|漢翔|雷虎|寶一|龍德|駐龍|晟田|台船|長榮航太|千附精密|全訊|邑錡|亞航') { return $true }
  return $false
}

function Get-WarmupSymbols {
  $motherPoolSymbols = @(Get-ActiveCommonStockSymbols)
  if ($motherPoolSymbols.Count -gt 0) {
    $volumeFilteredMotherPool = @(Filter-SymbolsByAvgVolume5 -Symbols $motherPoolSymbols)
    return @($volumeFilteredMotherPool | Select-Object -First $SeedSymbolCount)
  }

  $symbolsFile = Join-Path $RuntimeDir "cache\intraday\fugle-ws-symbols.json"
  $symbols = @()
  try {
    if (Test-Path -LiteralPath $symbolsFile) {
      $payload = Read-JsonFile -Path $symbolsFile -Default ([pscustomobject]@{})
      $symbols = @($payload.symbols) | Where-Object { [string]$_ -match '^\d{4}$' -and -not ([string]$_).StartsWith("00") }
    }
  } catch {}
  if ($symbols.Count -eq 0) {
    $symbols = @(Get-StocksSlimSymbols)
  }
  $staticFiltered = @(Remove-BlacklistedSymbols -Symbols (@($symbols | Select-Object -Unique)) -Blacklist $script:SymbolBlacklist)
  $script:ApiUniverseStats.blacklist_filtered = [math]::Max(0, @($symbols | Select-Object -Unique).Count - $staticFiltered.Count)
  $volumeFiltered = @(Filter-SymbolsByAvgVolume5 -Symbols $staticFiltered)
  return @($volumeFiltered | Select-Object -First $SeedSymbolCount)
}

function Invoke-FugleHistoricalIntraday1m {
  param([string]$Symbol, [string]$ApiKey)
  if ([string]::IsNullOrWhiteSpace($ApiKey)) { return $null }
  $headers = @{
      "X-API-KEY" = $ApiKey
      "User-Agent" = "FumanPublicSlotSharedSource/1.0"
  }
  try {
    $from = (Get-Date).AddDays(-8).ToString("yyyy-MM-dd")
    $to = (Get-Date).ToString("yyyy-MM-dd")
    $historyUri = "https://api.fugle.tw/marketdata/v1.0/stock/historical/candles/$($Symbol)?timeframe=1&from=$from&to=$to&sort=asc"
    $payload = Invoke-RestMethod -Uri $historyUri -Headers $headers -TimeoutSec ([math]::Max(3, $Direct1mHistoricalTimeoutSeconds)) -ErrorAction Stop
    if ($null -ne $payload) {
      $payload | Add-Member -NotePropertyName public_slot_source -NotePropertyValue "fugle-rest-historical-1m" -Force
    }
    return $payload
  } catch {
    Write-Log "WARN direct_1m historical $Symbol failed: $($_.Exception.Message)"
    if ($_.Exception.Message -match '429|Too Many') {
      $script:Direct1mRateLimited = $true
    }
    return $null
  }
}

function Invoke-FugleIntraday1m {
  param([string]$Symbol, [string]$ApiKey, [switch]$PreferHistorical)
  if ([string]::IsNullOrWhiteSpace($ApiKey)) { return $null }
  if ($PreferHistorical) {
    $historical = Invoke-FugleHistoricalIntraday1m -Symbol $Symbol -ApiKey $ApiKey
    if ($null -ne $historical -and @($historical.data).Count -gt 0) { return $historical }
  }
  $headers = @{
      "X-API-KEY" = $ApiKey
      "User-Agent" = "FumanPublicSlotSharedSource/1.0"
  }
  $intradayUri = "https://api.fugle.tw/marketdata/v1.0/stock/intraday/candles/$($Symbol)?timeframe=1&sort=asc"
  try {
    $payload = Invoke-RestMethod -Uri $intradayUri -Headers $headers -TimeoutSec ([math]::Max(3, $Direct1mIntradayTimeoutSeconds)) -ErrorAction Stop
    if (@($payload.data).Count -gt 0) { return $payload }
  } catch {
    Write-Log "WARN direct_1m intraday $Symbol failed: $($_.Exception.Message)"
    if ($_.Exception.Message -match '429|Too Many') {
      $script:Direct1mRateLimited = $true
      return $null
    }
  }

  if (-not $PreferHistorical) {
    return Invoke-FugleHistoricalIntraday1m -Symbol $Symbol -ApiKey $ApiKey
  }
  return $null
}

function Convert-FugleIntraday1mToRows {
  param([string]$Symbol, [object]$Payload, [int]$MaxRows = 260)
  $rows = New-Object System.Collections.Generic.List[object]
  $market = Convert-Market ([string]($Payload.exchange))
  if ([string]::IsNullOrWhiteSpace($market)) { $market = "TSE" }
  $items = @($Payload.data)
  if ($items.Count -gt $MaxRows) { $items = $items | Select-Object -Last $MaxRows }
  $source = if ($Payload.public_slot_source) { [string]$Payload.public_slot_source } else { "fugle-rest-intraday-candles" }
  foreach ($item in @($items)) {
    try {
      $dateText = [string]$item.date
      if ([string]::IsNullOrWhiteSpace($dateText)) { continue }
      $parsed = [datetime]::Parse($dateText)
      $time = ([datetimeoffset]$parsed).ToUniversalTime().ToString("o")
      $close = Get-Number $item.close
      if ($close -le 0) { continue }
      $volumeLots = Convert-VolumeToLots $item.volume
      if ($parsed.ToString("yyyy-MM-dd") -eq (Get-Date).ToString("yyyy-MM-dd") -and $volumeLots -le 0) { continue }
      $rows.Add([ordered]@{
        symbol = $Symbol
        market = $market
        trade_date = $parsed.ToString("yyyy-MM-dd")
        candle_time = $time
        open = Get-Number $item.open
        high = Get-Number $item.high
        low = Get-Number $item.low
        close = $close
        volume = $volumeLots
        updated_at = (Get-Date).ToUniversalTime().ToString("o")
        payload = @{ source = $source; raw_volume = $item.volume; warmup_bars = $MaxRows }
      })
    } catch {}
  }
  return $rows.ToArray()
}

function Test-Direct1mStartupPrewarmDue {
  if (-not $Direct1mPrewarmEnabled) { return $false }
  try {
    $parts = ([string]$Direct1mPrewarmStart).Split(":")
    $start = (Get-Date).Date.AddHours([int]$parts[0]).AddMinutes([int]$parts[1])
    return ((Get-Date) -ge $start)
  } catch {
    return $true
  }
}

function Get-EmptyDirect1mPrewarmPayload {
  param([bool]$Skipped = $true)
  return @{
    rows = @()
    attempted = 0
    fetched = 0
    skipped = $Skipped
    complete = $false
    target_symbols = 0
    completed_symbols = 0
    remaining_symbols = 0
    bars_per_symbol = $Direct1mPrewarmBars
    rate_limited = $false
  }
}

function Invoke-Direct1mStartupPrewarm {
  param([string[]]$Symbols, [string]$ApiKey)

  if (-not (Test-Direct1mStartupPrewarmDue)) { return (Get-EmptyDirect1mPrewarmPayload) }
  if ($Symbols.Count -eq 0 -or [string]::IsNullOrWhiteSpace($ApiKey)) { return (Get-EmptyDirect1mPrewarmPayload -Skipped:$false) }

  $tradeDate = (Get-Date).ToString("yyyy-MM-dd")
  $targetSymbols = @($Symbols |
    Where-Object { [string]$_ -match '^\d{4}$' -and -not ([string]$_).StartsWith("00") } |
    Select-Object -Unique |
    Select-Object -First $Direct1mPrewarmSymbolCount)
  if ($targetSymbols.Count -eq 0) { return (Get-EmptyDirect1mPrewarmPayload -Skipped:$false) }

  $state = Read-JsonFile -Path $Direct1mPrewarmStateFile -Default ([pscustomobject]@{})
  $completedSet = New-Object System.Collections.Generic.HashSet[string]
  if ([string]$state.trade_date -eq $tradeDate -and [int](Get-Number $state.bars_per_symbol) -eq $Direct1mPrewarmBars) {
    foreach ($symbol in @($state.completed_symbols)) {
      if ([string]$symbol -match '^\d{4}$') { [void]$completedSet.Add([string]$symbol) }
    }
  }

  $remaining = @($targetSymbols | Where-Object { -not $completedSet.Contains([string]$_) })
  if ($remaining.Count -eq 0) {
    Write-JsonFile -Path $Direct1mPrewarmStateFile -Value ([ordered]@{
      trade_date = $tradeDate
      bars_per_symbol = $Direct1mPrewarmBars
      target_symbols = $targetSymbols.Count
      completed_symbols = @($targetSymbols)
      completed_count = $targetSymbols.Count
      remaining_count = 0
      complete = $true
      completed_at = (Get-Date).ToString("o")
    })
    return @{
      rows = @()
      attempted = 0
      fetched = 0
      skipped = $false
      complete = $true
      target_symbols = $targetSymbols.Count
      completed_symbols = $targetSymbols.Count
      remaining_symbols = 0
      bars_per_symbol = $Direct1mPrewarmBars
      rate_limited = $false
    }
  }

  $script:Direct1mRateLimited = $false
  $effectivePrewarmBatchSize = $Direct1mPrewarmBatchSize
  if ((Get-PublicSlotSession) -eq "regular") {
    $effectivePrewarmBatchSize = [math]::Min($effectivePrewarmBatchSize, 8)
  }
  $batchSize = [math]::Max(1, [math]::Min($effectivePrewarmBatchSize, $remaining.Count))
  $batch = @($remaining | Select-Object -First $batchSize)
  $rows = New-Object System.Collections.Generic.List[object]
  $fetched = 0
  $attempted = 0
  $batchStarted = Get-Date

  foreach ($symbol in $batch) {
    if (((Get-Date) - $batchStarted).TotalSeconds -ge $Direct1mPrewarmTimeBudgetSeconds) {
      Write-Log "WARN direct_1m_prewarm time budget exceeded ${Direct1mPrewarmTimeBudgetSeconds}s; preserving progress."
      break
    }
    $attempted += 1
    $payload = Invoke-FugleIntraday1m -Symbol $symbol -ApiKey $ApiKey -PreferHistorical
    if ($null -ne $payload) {
      $converted = @(Convert-FugleIntraday1mToRows -Symbol $symbol -Payload $payload -MaxRows $Direct1mPrewarmBars)
      [void]$completedSet.Add([string]$symbol)
      if ($converted.Count -gt 0) {
        $fetched += 1
        foreach ($row in $converted) { $rows.Add($row) }
      }
    }
    if ($script:Direct1mRateLimited) {
      Write-Log "WARN direct_1m_prewarm rate limited; preserving progress and cooling down."
      break
    }
    Start-Sleep -Milliseconds ([math]::Max(0, [math]::Min($RestQuoteDelayMilliseconds, 40)))
  }

  $completedArray = @($targetSymbols | Where-Object { $completedSet.Contains([string]$_) })
  $remainingCount = [math]::Max(0, $targetSymbols.Count - $completedArray.Count)
  $complete = ($remainingCount -eq 0)
  Write-JsonFile -Path $Direct1mPrewarmStateFile -Value ([ordered]@{
    trade_date = $tradeDate
    bars_per_symbol = $Direct1mPrewarmBars
    target_symbols = $targetSymbols.Count
    completed_symbols = $completedArray
    completed_count = $completedArray.Count
    remaining_count = $remainingCount
    last_attempted = $attempted
    last_fetched_symbols = $fetched
    last_rows = $rows.Count
    last_run_at = (Get-Date).ToString("o")
    complete = $complete
    rate_limited = [bool]$script:Direct1mRateLimited
    time_budget_seconds = $Direct1mPrewarmTimeBudgetSeconds
  })

  Write-Log "direct_1m_prewarm target=$($targetSymbols.Count) completed=$($completedArray.Count) remaining=$remainingCount attempted=$attempted fetched=$fetched rows=$($rows.Count) bars=$Direct1mPrewarmBars complete=$complete time_budget=${Direct1mPrewarmTimeBudgetSeconds}s"
  return @{
    rows = $rows.ToArray()
    attempted = $attempted
    fetched = $fetched
    skipped = $false
    complete = $complete
    target_symbols = $targetSymbols.Count
    completed_symbols = $completedArray.Count
    remaining_symbols = $remainingCount
    bars_per_symbol = $Direct1mPrewarmBars
    rate_limited = [bool]$script:Direct1mRateLimited
  }
}

function Invoke-Direct1mWarmupBatch {
  param([string[]]$Symbols, [string]$ApiKey)
  $state = Read-JsonFile -Path $Direct1mStateFile -Default ([pscustomobject]@{ cursor = 0; last_run_at = $null })
  $script:Direct1mRateLimited = $false
  $lastRun = $null
  try { if ($state.last_run_at) { $lastRun = [datetimeoffset]::Parse([string]$state.last_run_at).LocalDateTime } } catch {}
  if ($null -ne $lastRun -and ((Get-Date) - $lastRun).TotalSeconds -lt $Direct1mEverySeconds) {
    return @{ rows = @(); attempted = 0; fetched = 0; skipped = $true }
  }
  if ($Symbols.Count -eq 0 -or [string]::IsNullOrWhiteSpace($ApiKey)) {
    return @{ rows = @(); attempted = 0; fetched = 0; skipped = $false }
  }
  $cursor = [int]($state.cursor)
  if ($cursor -lt 0 -or $cursor -ge $Symbols.Count) { $cursor = 0 }
  $effectiveDirect1mBatchSize = $Direct1mBatchSize
  if ((Get-PublicSlotSession) -eq "regular") {
    $effectiveDirect1mBatchSize = [math]::Min($effectiveDirect1mBatchSize, 2)
  }
  $batch = New-Object System.Collections.Generic.List[string]
  for ($i = 0; $i -lt [math]::Min($effectiveDirect1mBatchSize, $Symbols.Count); $i++) {
    $batch.Add([string]$Symbols[($cursor + $i) % $Symbols.Count])
  }
  $rows = New-Object System.Collections.Generic.List[object]
  $fetched = 0
  $attempted = 0
  $batchStarted = Get-Date
  foreach ($symbol in $batch) {
    if (((Get-Date) - $batchStarted).TotalSeconds -ge $Direct1mBatchTimeBudgetSeconds) {
      Write-Log "WARN direct_1m time budget exceeded ${Direct1mBatchTimeBudgetSeconds}s; stopping current batch."
      break
    }
    $attempted += 1
    $payload = Invoke-FugleIntraday1m -Symbol $symbol -ApiKey $ApiKey
    $converted = @()
    if ($null -ne $payload) { $converted = @(Convert-FugleIntraday1mToRows -Symbol $symbol -Payload $payload) }
    if ($converted.Count -gt 0) {
      $fetched += 1
      foreach ($row in $converted) { $rows.Add($row) }
    }
    if ($script:Direct1mRateLimited) {
      Write-Log "WARN direct_1m rate limited; stopping current batch and cooling down."
      break
    }
    Start-Sleep -Milliseconds ([math]::Max(0, [math]::Min($RestQuoteDelayMilliseconds, 40)))
  }
  $nextCursor = ($cursor + [math]::Max(1, $fetched)) % $Symbols.Count
  Write-JsonFile -Path $Direct1mStateFile -Value ([ordered]@{
    cursor = $nextCursor
    last_run_at = (Get-Date).ToString("o")
    last_attempted = $attempted
    last_fetched_symbols = $fetched
    last_rows = $rows.Count
    rate_limited = [bool]$script:Direct1mRateLimited
    time_budget_seconds = $Direct1mBatchTimeBudgetSeconds
  })
  return @{ rows = $rows.ToArray(); attempted = $attempted; fetched = $fetched; skipped = $false; rate_limited = [bool]$script:Direct1mRateLimited }
}

function Invoke-FugleStockQuote {
  param([string]$Symbol, [string]$ApiKey)
  if ([string]::IsNullOrWhiteSpace($Symbol) -or [string]::IsNullOrWhiteSpace($ApiKey)) { return $null }
  $headers = @{
    "X-API-KEY" = $ApiKey
    "User-Agent" = "FumanPublicSlotSharedSource/1.0"
  }
  try {
    $uri = "https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/$Symbol"
    return Invoke-RestMethod -Uri $uri -Headers $headers -TimeoutSec ([math]::Max(2, $RestQuoteTimeoutSeconds)) -ErrorAction Stop
  } catch {
    $statusCode = $null
    try {
      if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
        $statusCode = [int]$_.Exception.Response.StatusCode
      }
    } catch {}
    Write-Log "WARN rest_quote $Symbol failed: $($_.Exception.Message)"
    if ($statusCode -eq 404 -or $_.Exception.Message -match '\b404\b|Not Found') { $script:RestQuoteUnsupportedSymbol = $true }
    if ($_.Exception.Message -match '429|Too Many') { $script:RestQuoteRateLimited = $true }
    return $null
  }
}

function Convert-FugleStockQuoteToWsLikeQuote {
  param([object]$Quote)
  if ($null -eq $Quote) { return $null }
  $symbol = [string]$Quote.symbol
  if ([string]::IsNullOrWhiteSpace($symbol)) { return $null }
  if (Test-BuiltInBlacklistedStock -Symbol $symbol -Name ([string]$Quote.name)) { return $null }

  $bestBid = $null
  $bestAsk = $null
  try { $bestBid = @($Quote.bids)[0] } catch {}
  try { $bestAsk = @($Quote.asks)[0] } catch {}

  $lastPrice = Get-Number $Quote.lastPrice
  if ($lastPrice -le 0) { $lastPrice = Get-Number $Quote.lastTrial.price }
  if ($lastPrice -le 0) { $lastPrice = Get-Number $Quote.closePrice }
  if ($lastPrice -le 0) { return $null }

  $previousClose = Get-Number $Quote.previousClose
  if ($previousClose -le 0) { $previousClose = Get-Number $Quote.referencePrice }
  $updatedAt = Convert-ToIsoUtc -Value $Quote.lastUpdated -AssumeUtc
  if ([string]::IsNullOrWhiteSpace($updatedAt)) { $updatedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fff'Z'") }
  $isTrial = [bool]$Quote.isTrial
  $session = if ($isTrial -or (Get-PublicSlotSession) -eq "preopen") { "preopen" } else { Get-PublicSlotSession }

  return [pscustomobject][ordered]@{
    code = $symbol
    name = [string]$Quote.name
    market = Convert-Market ([string]$Quote.market)
    close = $lastPrice
    open = Get-Number $Quote.openPrice
    high = Get-Number $Quote.highPrice
    low = Get-Number $Quote.lowPrice
    prevClose = $previousClose
    percent = Get-Number $Quote.changePercent
    tradeVolume = Convert-VolumeToLots $Quote.total.tradeVolume
    tradeValue = [int64](Get-Number $Quote.total.tradeValue)
    bidPrice = Get-Number $bestBid.price
    bidSize = Convert-VolumeToLots $bestBid.size
    askPrice = Get-Number $bestAsk.price
    askSize = Convert-VolumeToLots $bestAsk.size
    cumulativeBidVolume = Convert-VolumeToLots $Quote.total.tradeVolumeAtBid
    cumulativeAskVolume = Convert-VolumeToLots $Quote.total.tradeVolumeAtAsk
    quoteSeenAt = $updatedAt
    updatedAt = $updatedAt
    isTrial = $isTrial
    session = $session
    referencePrice = Get-Number $Quote.referencePrice
    trialPrice = Get-Number $Quote.lastTrial.price
    source = "fugle-rest-intraday-quote"
    raw = $Quote
  }
}

function Merge-QuoteObjectsByCode {
  param([object[]]$PrimaryQuotes = @(), [object[]]$FallbackQuotes = @())
  $byCode = [ordered]@{}
  foreach ($quote in @($PrimaryQuotes)) {
    $digits = [string]$quote.code -replace "\D", ""
    if ($digits.Length -lt 4) { continue }
    $symbol = $digits.Substring(0, 4)
    $byCode[$symbol] = $quote
  }
  foreach ($quote in @($FallbackQuotes)) {
    $digits = [string]$quote.code -replace "\D", ""
    if ($digits.Length -lt 4) { continue }
    $symbol = $digits.Substring(0, 4)
    $byCode[$symbol] = $quote
  }
  return @($byCode.Values)
}

function Invoke-FugleStockQuoteBatch {
  param([string[]]$Symbols, [string]$ApiKey, [bool]$Force = $false)
  $state = Read-JsonFile -Path $RestQuoteStateFile -Default ([pscustomobject]@{ cursor = 0; last_run_at = $null })
  $todayKey = (Get-Date).ToString("yyyy-MM-dd")
  $unsupported = New-Object 'System.Collections.Generic.HashSet[string]'
  if ([string]$state.unsupported_trade_date -eq $todayKey) {
    foreach ($item in @($state.unsupported_symbols)) {
      $symbol = ([string]$item).Trim()
      if (-not [string]::IsNullOrWhiteSpace($symbol)) { [void]$unsupported.Add($symbol) }
    }
  }
  $script:RestQuoteRateLimited = $false
  $script:RestQuoteUnsupportedSymbol = $false
  $lastRun = $null
  try { if ($state.last_run_at) { $lastRun = [datetimeoffset]::Parse([string]$state.last_run_at).LocalDateTime } } catch {}
  $cooldownUntil = Get-DateTimeOffsetOrNull -Value $state.rate_limit_cooldown_until
  if (-not $Force -and $null -ne $cooldownUntil -and (Get-Date).ToUniversalTime() -lt $cooldownUntil.UtcDateTime) {
    return @{
      quotes = @()
      attempted = 0
      scanned_for_batch = 0
      fetched = 0
      skipped = $true
      rate_limited = $true
      unsupported = 0
      unsupported_symbols = $unsupported.Count
      unsupported_trade_date = $todayKey
      cooldown_until = $cooldownUntil.ToString("o")
      effective_batch_size = (Get-EffectiveRestQuoteBatchSize)
      effective_delay_milliseconds = (Get-EffectiveRestQuoteDelayMilliseconds)
    }
  }
  if (-not $Force -and $null -ne $lastRun -and ((Get-Date) - $lastRun).TotalSeconds -lt $RestQuoteEverySeconds) {
    return @{ quotes = @(); attempted = 0; fetched = 0; skipped = $true; rate_limited = $false; unsupported = 0; unsupported_symbols = $unsupported.Count; unsupported_trade_date = $todayKey }
  }
  if ($Symbols.Count -eq 0 -or [string]::IsNullOrWhiteSpace($ApiKey)) {
    return @{ quotes = @(); attempted = 0; fetched = 0; skipped = $false; rate_limited = $false; unsupported = 0; unsupported_symbols = $unsupported.Count; unsupported_trade_date = $todayKey }
  }

  $cursor = [int]($state.cursor)
  if ($cursor -lt 0 -or $cursor -ge $Symbols.Count) { $cursor = 0 }
  $effectiveBatchSize = Get-EffectiveRestQuoteBatchSize
  $effectiveDelayMilliseconds = Get-EffectiveRestQuoteDelayMilliseconds
  $openingBoostActive = Test-OpeningBoostWindow
  $batch = New-Object System.Collections.Generic.List[string]
  $scannedForBatch = 0
  while ($batch.Count -lt [math]::Min($effectiveBatchSize, $Symbols.Count) -and $scannedForBatch -lt $Symbols.Count) {
    $candidate = [string]$Symbols[($cursor + $scannedForBatch) % $Symbols.Count]
    $scannedForBatch += 1
    if ($unsupported.Contains($candidate)) { continue }
    $batch.Add($candidate)
  }

  $quotes = New-Object System.Collections.Generic.List[object]
  $unsupportedThisLoop = New-Object System.Collections.Generic.List[string]
  $fetched = 0
  $attempted = 0
  $batchStarted = Get-Date
  foreach ($symbol in $batch) {
    if (((Get-Date) - $batchStarted).TotalSeconds -ge $RestQuoteBatchTimeBudgetSeconds) {
      Write-Log "WARN rest_quote time budget exceeded ${RestQuoteBatchTimeBudgetSeconds}s; stopping current batch."
      break
    }
    $script:RestQuoteUnsupportedSymbol = $false
    $attempted += 1
    $quote = Invoke-FugleStockQuote -Symbol $symbol -ApiKey $ApiKey
    if ($script:RestQuoteUnsupportedSymbol) {
      if ($unsupported.Add($symbol)) { $unsupportedThisLoop.Add($symbol) }
    }
    $converted = Convert-FugleStockQuoteToWsLikeQuote -Quote $quote
    if ($null -ne $converted) {
      $fetched += 1
      $quotes.Add($converted)
    }
    if ($script:RestQuoteRateLimited) {
      Write-Log "WARN stock rest quote rate limited; stopping current batch and cooling down."
      break
    }
    if ($effectiveDelayMilliseconds -gt 0) {
      Start-Sleep -Milliseconds $effectiveDelayMilliseconds
    }
  }

  $nextCursor = ($cursor + [math]::Max(1, $scannedForBatch)) % $Symbols.Count
  $unsupportedArray = @($unsupported | Sort-Object)
  $rateLimitCooldownUntil = ""
  if ($script:RestQuoteRateLimited) {
    $rateLimitCooldownUntil = (Get-Date).ToUniversalTime().AddSeconds([math]::Max(10, $RestQuoteRateLimitCooldownSeconds)).ToString("o")
  }
  Write-JsonFile -Path $RestQuoteStateFile -Value ([ordered]@{
    cursor = $nextCursor
    last_run_at = (Get-Date).ToString("o")
    last_attempted = $attempted
    scanned_for_batch = $scannedForBatch
    last_fetched_symbols = $fetched
    last_rows = $quotes.Count
    last_unsupported_count = $unsupportedThisLoop.Count
    last_unsupported_symbols = $unsupportedThisLoop.ToArray()
    unsupported_symbol_count = $unsupported.Count
    unsupported_symbols = $unsupportedArray
    unsupported_trade_date = $todayKey
    universe = $Symbols.Count
    delay_milliseconds = $effectiveDelayMilliseconds
    configured_batch_size = $RestQuoteBatchSize
    effective_batch_size = $effectiveBatchSize
    opening_boost_active = [bool]$openingBoostActive
    opening_boost_window = "$OpeningBoostStart-$OpeningBoostEnd"
    rate_limited = [bool]$script:RestQuoteRateLimited
    rate_limit_cooldown_until = $rateLimitCooldownUntil
    timeout_seconds = $RestQuoteTimeoutSeconds
    time_budget_seconds = $RestQuoteBatchTimeBudgetSeconds
  })
  return @{ quotes = $quotes.ToArray(); attempted = $attempted; scanned_for_batch = $scannedForBatch; fetched = $fetched; skipped = $false; rate_limited = [bool]$script:RestQuoteRateLimited; unsupported = $unsupportedThisLoop.Count; unsupported_symbols = $unsupported.Count; unsupported_trade_date = $todayKey; opening_boost_active = [bool]$openingBoostActive; effective_batch_size = $effectiveBatchSize; effective_delay_milliseconds = $effectiveDelayMilliseconds; cooldown_until = $rateLimitCooldownUntil; timeout_seconds = $RestQuoteTimeoutSeconds; time_budget_seconds = $RestQuoteBatchTimeBudgetSeconds }
}

function Test-ProcessAlive {
  param([object]$PidValue)
  $pidInt = 0
  if (-not [int]::TryParse([string]$PidValue, [ref]$pidInt)) { return $false }
  if ($pidInt -le 0) { return $false }
  return [bool](Get-Process -Id $pidInt -ErrorAction SilentlyContinue)
}

function Initialize-WebSocketSymbols {
  $symbolsFile = Join-Path $RuntimeDir "cache\intraday\fugle-ws-symbols.json"
  $motherPoolSymbols = @(Get-ActiveCommonStockSymbols)
  if ($motherPoolSymbols.Count -le 0) { $motherPoolSymbols = @(Get-StocksSlimSymbols) }
  if ($motherPoolSymbols.Count -gt 0) {
    $mergedMotherPool = @(Remove-BlacklistedSymbols -Symbols $motherPoolSymbols -Blacklist $script:SymbolBlacklist | Select-Object -Unique | Select-Object -First $SeedSymbolCount)
    if ($mergedMotherPool.Count -gt 0) {
      try {
        Write-JsonFile -Path $symbolsFile -Value ([ordered]@{
          updatedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fff'Z'")
          symbols = $mergedMotherPool
          count = $mergedMotherPool.Count
          blacklist_count = if ($null -ne $script:SymbolBlacklist) { $script:SymbolBlacklist.Count } else { 0 }
          mother_pool_source = $script:ApiUniverseStats.mother_pool_source
          source = "supabase-public-slot-shared-source"
        })
      } catch {
        Write-Log "WARN unable to write mother-pool websocket symbols file: $($_.Exception.Message)"
      }
      return $mergedMotherPool.Count
    }
  }

  $current = Read-JsonFile -Path $symbolsFile -Default ([pscustomobject]@{})
  $existing = @()
  foreach ($symbol in @($current.symbols)) {
    if ([string]$symbol -match '^\d{4}$') { $existing += [string]$symbol }
  }
  $existing = @(Remove-BlacklistedSymbols -Symbols (@($existing | Select-Object -Unique)) -Blacklist $script:SymbolBlacklist)
  $currentCount = if ($existing.Count -gt 0) { $existing.Count } elseif ($null -ne $current.count) { [int](Get-Number $current.count) } else { 0 }
  if ($currentCount -le 0 -and (Test-Path -LiteralPath $symbolsFile)) {
    try {
      $rawSymbols = Get-Content -LiteralPath $symbolsFile -Raw
      if ($rawSymbols -match '"count"\s*:\s*(\d+)') { $currentCount = [int]$Matches[1] }
    } catch {}
  }
  if ($currentCount -ge [math]::Min(200, $SeedSymbolCount)) {
    try {
      Write-JsonFile -Path $symbolsFile -Value ([ordered]@{
        updatedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fff'Z'")
        symbols = @($existing | Select-Object -First $SeedSymbolCount)
        count = [math]::Min($existing.Count, $SeedSymbolCount)
        blacklist_count = if ($null -ne $script:SymbolBlacklist) { $script:SymbolBlacklist.Count } else { 0 }
        source = "supabase-public-slot-shared-source"
      })
    } catch {
      Write-Log "WARN unable to rewrite filtered websocket symbols file: $($_.Exception.Message)"
    }
    return [math]::Min($existing.Count, $SeedSymbolCount)
  }

  $stocksFile = Join-Path $RuntimeDir "data\stocks-slim.json"
  $symbols = @()
  try {
    if (Test-Path -LiteralPath $stocksFile) {
      $rawStocks = Get-Content -LiteralPath $stocksFile -Raw -ErrorAction Stop
      $symbols = @([regex]::Matches($rawStocks, '"code"\s*:\s*"(\d{4})"') |
        ForEach-Object { $_.Groups[1].Value } |
        Select-Object -Unique)
    }
  } catch {
    Write-Log "WARN unable to parse stocks-slim symbols: $($_.Exception.Message)"
  }

  if ($symbols.Count -eq 0 -and $existing.Count -eq 0) {
    Write-Log "WARN no websocket symbols generated; keeping existing symbols file"
    return $currentCount
  }

  $merged = @(Remove-BlacklistedSymbols -Symbols (@(@($existing) + @($symbols)) | Select-Object -Unique) -Blacklist $script:SymbolBlacklist | Select-Object -First $SeedSymbolCount)
  if ($merged.Count -eq 0) {
    Write-Log "WARN no websocket symbols to write; keeping existing symbols file"
    return $currentCount
  }
  try {
    Write-JsonFile -Path $symbolsFile -Value ([ordered]@{
      updatedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fff'Z'")
      symbols = $merged
      count = $merged.Count
      blacklist_count = if ($null -ne $script:SymbolBlacklist) { $script:SymbolBlacklist.Count } else { 0 }
      source = "supabase-public-slot-shared-source"
    })
  } catch {
    Write-Log "WARN unable to update websocket symbols file: $($_.Exception.Message)"
  }
  return $merged.Count
}

function Start-FugleWebSocketCollector {
  if ($NoStartCollector) { return "disabled" }

  $statusFile = Join-Path $RuntimeDir "state\fugle-websocket-status.json"
  $status = Read-JsonFile -Path $statusFile -Default ([pscustomobject]@{})
  if (Test-ProcessAlive $status.pid) {
    $existingPid = [int]$status.pid
    $existingProcess = Get-Process -Id $existingPid -ErrorAction SilentlyContinue
    if ($null -ne $existingProcess -and $existingProcess.StartTime.Date -lt (Get-Date).Date) {
      try {
        Stop-Process -Id $existingPid -Force -ErrorAction Stop
        Write-Log "WARN restarted stale websocket collector from previous day pid=$existingPid"
      } catch {
        Write-Log "WARN unable to stop stale websocket collector pid=$existingPid`: $($_.Exception.Message)"
        return "stale-collector-stop-failed pid=$existingPid"
      }
    } else {
      return "already-running pid=$existingPid"
    }
  }

  $nodeExe = "C:\Program Files\nodejs\node.exe"
  $collector = Join-Path $FumanRoot "scripts\fugle-websocket-collector.js"
  if (-not (Test-Path -LiteralPath $collector)) {
    $fallbackCollector = Join-Path $ScriptDir "fugle-websocket-collector.js"
    if (Test-Path -LiteralPath $fallbackCollector) {
      $collector = $fallbackCollector
    }
  }
  if (-not (Test-Path -LiteralPath $nodeExe)) { return "node missing: $nodeExe" }
  if (-not (Test-Path -LiteralPath $collector)) { return "collector missing: $collector" }

  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $nodeExe
  $psi.Arguments = "`"$collector`""
  $psi.WorkingDirectory = Split-Path -Parent $collector
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.Environment["FUMAN_RUNTIME_DIR"] = $RuntimeDir
  $psi.Environment["STRATEGY2_FUGLE_WS_MAX_SYMBOLS"] = [string]$SeedSymbolCount
  $psi.Environment["STRATEGY2_FUGLE_WS_QUOTE_KEEP_MS"] = [string]($QuoteKeepMinutes * 60 * 1000)
  $psi.Environment["FUGLE_COLLECTOR_LOOP_MS"] = [string]$FugleCollectorLoopMilliseconds
  $psi.Environment["FUGLE_COLLECTOR_BATCH_SIZE"] = [string]$FugleCollectorBatchSize
  $psi.Environment["FUGLE_COLLECTOR_CONCURRENCY"] = [string]$FugleCollectorConcurrency
  $psi.Environment["FUGLE_COLLECTOR_REQUEST_DELAY_MS"] = [string]$FugleCollectorRequestDelayMilliseconds
  $psi.Environment["FUGLE_COLLECTOR_ADAPTIVE_INITIAL_RPM"] = [string]$FugleCollectorAdaptiveInitialRpm
  $psi.Environment["FUGLE_COLLECTOR_ADAPTIVE_MIN_RPM"] = [string]$FugleCollectorAdaptiveMinRpm
  $psi.Environment["FUGLE_COLLECTOR_ADAPTIVE_MAX_RPM"] = [string]$FugleCollectorAdaptiveMaxRpm
  $psi.Environment["FUGLE_COLLECTOR_429_COOLDOWN_MS"] = [string]$FugleCollector429CooldownMilliseconds
  $psi.Environment["FUGLE_COLLECTOR_429_WINDOW_MS"] = [string]$FugleCollector429WindowMilliseconds
  $psi.Environment["FUGLE_COLLECTOR_429_BUDGET"] = [string]$FugleCollector429Budget
  $psi.Environment["FUGLE_COLLECTOR_429_MAX_COOLDOWN_MS"] = [string]$FugleCollector429MaxCooldownMilliseconds
  $psi.Environment["FUGLE_COLLECTOR_PRIORITY_ONLY_AFTER_429_MS"] = [string]$FugleCollectorPriorityOnlyAfter429Milliseconds
  $psi.Environment["FUGLE_COLLECTOR_QUOTE_TTL_MS"] = [string]$FugleCollectorQuoteTtlMilliseconds
  $psi.Environment["FUGLE_COLLECTOR_OPENING_BOOST_START"] = $OpeningBoostStart
  $psi.Environment["FUGLE_COLLECTOR_OPENING_BOOST_END"] = $OpeningBoostEnd
  $psi.Environment["FUGLE_COLLECTOR_OPENING_BOOST_BATCH_SIZE"] = [string]$FugleCollectorOpeningBoostBatchSize
  $psi.Environment["FUGLE_COLLECTOR_OPENING_BOOST_CONCURRENCY"] = [string]$FugleCollectorOpeningBoostConcurrency
  $psi.Environment["FUGLE_COLLECTOR_OPENING_BOOST_DELAY_MS"] = [string]$FugleCollectorOpeningBoostDelayMilliseconds
  $psi.Environment["FUGLE_COLLECTOR_FINMIND_RECOVERY_ENABLED"] = if ($FugleCollectorFinMindRecoveryEnabled) { "1" } else { "0" }
  $psi.Environment["FUGLE_COLLECTOR_FINMIND_RECOVERY_TIMEOUT_MS"] = [string]$FugleCollectorFinMindRecoveryTimeoutMilliseconds
  $process = [System.Diagnostics.Process]::Start($psi)
  return "started pid=$($process.Id)"
}

function Convert-QuotesToRows {
  param([object[]]$Quotes, [object]$Payload)
  $rows = New-Object System.Collections.Generic.List[object]
  foreach ($quote in $Quotes) {
    $digits = [string]$quote.code -replace "\D", ""
    $symbol = $digits.Substring(0, [math]::Min(4, $digits.Length))
    if (Test-BuiltInBlacklistedStock -Symbol $symbol -Name ([string]$quote.name)) { continue }
    $rowUpdatedAt = (Get-Date).ToUniversalTime().ToString("o")
    $lastTradeTime = Get-QuoteTimestamp -Quote $quote -Payload $Payload
    $bidVolume = [int](Convert-VolumeToLots $quote.bidSize)
    $askVolume = [int](Convert-VolumeToLots $quote.askSize)
    $cumulativeBidVolume = Get-NullableNumber @(
      $quote.cumulativeBidVolume,
      $quote.cumulative_bid_volume,
      $quote.bidTradeVolume,
      $quote.bid_trade_volume,
      $quote.innerVolume,
      $quote.inner_volume,
      $quote.totalBidVolume,
      $quote.total_bid_volume
    )
    $cumulativeAskVolume = Get-NullableNumber @(
      $quote.cumulativeAskVolume,
      $quote.cumulative_ask_volume,
      $quote.askTradeVolume,
      $quote.ask_trade_volume,
      $quote.outerVolume,
      $quote.outer_volume,
      $quote.totalAskVolume,
      $quote.total_ask_volume
    )
    $cumulativeBidAskVolume = $null
    if ($null -ne $cumulativeBidVolume -and $null -ne $cumulativeAskVolume) {
      $cumulativeBidAskVolume = $cumulativeBidVolume + $cumulativeAskVolume
    }
    $denom = $bidVolume + $askVolume
    $askBidRatio = $null
    if ($bidVolume -gt 0) { $askBidRatio = [math]::Round(([double]$askVolume / [double]$bidVolume), 6) }
    $askRatio = $null
    if ($denom -gt 0) { $askRatio = [math]::Round(([double]$askVolume / [double]$denom), 6) }
    $quoteName = [string]$quote.name
    if ([string]::IsNullOrWhiteSpace($quoteName)) { $quoteName = $symbol }
    $quoteSession = [string]$quote.session
    if ([string]::IsNullOrWhiteSpace($quoteSession)) { $quoteSession = Get-PublicSlotSession }
    $isTrial = $false
    try { $isTrial = [bool]$quote.isTrial } catch {}
    $referencePrice = Get-Number $quote.referencePrice
    if ($referencePrice -le 0) { $referencePrice = Get-Number $quote.prevClose }
    $trialPrice = Get-Number $quote.trialPrice
    if ($trialPrice -le 0) { $trialPrice = Get-Number $quote.close }
    $bidPrice = Get-Number $quote.bidPrice
    $askPrice = Get-Number $quote.askPrice
    $rows.Add([ordered]@{
      symbol = $symbol
      name = $quoteName
      market = Convert-Market ([string]$quote.market)
      updated_at = $rowUpdatedAt
      price = Get-Number $quote.close
      open_price = Get-Number $quote.open
      high_price = Get-Number $quote.high
      low_price = Get-Number $quote.low
      previous_close = Get-Number $quote.prevClose
      reference_price = $referencePrice
      trial_price = $trialPrice
      best_bid_price = $bidPrice
      best_ask_price = $askPrice
      bid1_price = $bidPrice
      ask1_price = $askPrice
      change_percent = Get-Number $quote.percent
      total_volume = [int64](Convert-VolumeToLots $quote.tradeVolume)
      trade_value = [int64](Get-Number $quote.tradeValue)
      bid_volume = $bidVolume
      ask_volume = $askVolume
      ask_bid_ratio = $askBidRatio
      ask_ratio = $askRatio
      cumulative_bid_volume = $cumulativeBidVolume
      cumulative_ask_volume = $cumulativeAskVolume
      cumulative_bid_ask_volume = $cumulativeBidAskVolume
      stock_type = "COMMONSTOCK"
      session = $quoteSession
      last_trade_time = $lastTradeTime
      is_halted = $false
      is_trial = $isTrial
      payload = @{
        raw = $quote
        volume_unit = "lots"
        time_standard = "UTC"
        bid_volume_source = "fugle_ws_best_bid_level_size"
        ask_volume_source = "fugle_ws_best_ask_level_size"
        cumulative_bid_ask_available = ($null -ne $cumulativeBidAskVolume)
        cumulative_bid_ask_source = if ($null -ne $cumulativeBidAskVolume) { "fugle_quote_fields" } else { "unavailable_from_current_websocket_cache" }
      }
    })
  }
  return $rows.ToArray()
}

function Convert-QuotesToPreopenRows {
  param([object[]]$Quotes, [object]$Payload)
  $rows = New-Object System.Collections.Generic.List[object]
  foreach ($quote in $Quotes) {
    $digits = [string]$quote.code -replace "\D", ""
    $symbol = $digits.Substring(0, [math]::Min(4, $digits.Length))
    if (Test-BuiltInBlacklistedStock -Symbol $symbol -Name ([string]$quote.name)) { continue }

    $updatedAt = Get-QuoteTimestamp -Quote $quote -Payload $Payload
    $referencePrice = Get-Number $quote.referencePrice
    if ($referencePrice -le 0) { $referencePrice = Get-Number $quote.prevClose }
    $trialPrice = Get-Number $quote.trialPrice
    if ($trialPrice -le 0) { $trialPrice = Get-Number $quote.close }
    $bidPrice = Get-Number $quote.bidPrice
    $askPrice = Get-Number $quote.askPrice
    $bidVolume = [int](Convert-VolumeToLots $quote.bidSize)
    $askVolume = [int](Convert-VolumeToLots $quote.askSize)
    $quoteName = [string]$quote.name
    if ([string]::IsNullOrWhiteSpace($quoteName)) { $quoteName = $symbol }

    $limitUp = 0.0
    if ($referencePrice -gt 0) { $limitUp = [math]::Round($referencePrice * 1.1, 2) }
    $isLimitUpBid = $false
    if ($limitUp -gt 0 -and $bidPrice -ge ($limitUp * 0.995) -and $bidVolume -gt $askVolume) {
      $isLimitUpBid = $true
    }

    $rows.Add([ordered]@{
      symbol = $symbol
      name = $quoteName
      market = Convert-Market ([string]$quote.market)
      session = Get-PublicSlotSession
      updated_at = $updatedAt
      reference_price = $referencePrice
      trial_price = $trialPrice
      is_trial = ([bool]$quote.isTrial -or (Get-PublicSlotSession) -eq "preopen")
      is_limit_up_bid = $isLimitUpBid
      best_bid_price = $bidPrice
      best_ask_price = $askPrice
      bid_volume = $bidVolume
      ask_volume = $askVolume
      bid1_price = $bidPrice
      bid1_volume = $bidVolume
      ask1_price = $askPrice
      ask1_volume = $askVolume
      bid_levels_json = @(@{ price = $bidPrice; volume = $bidVolume })
      ask_levels_json = @(@{ price = $askPrice; volume = $askVolume })
      payload = @{ raw = $quote; volume_unit = "lots"; time_standard = "UTC" }
    })
  }
  return $rows.ToArray()
}

function Invoke-TaifexFuturesQuote {
  param([string]$Cid = "TXF")
  try {
    $uri = "https://mis.taifex.com.tw/futures/api/getQuoteList"
    $body = @{
      MarketType = "0"
      SymbolType = "F"
      KindID = "1"
      CID = $Cid
      ExpireMonth = ""
      RowSize = "5"
      PageNo = "1"
      Language = "zh-tw"
    } | ConvertTo-Json -Compress
    return Invoke-RestMethod -Uri $uri -Method Post -ContentType "application/json" -Headers @{
      Referer = "https://mis.taifex.com.tw/"
      Origin = "https://mis.taifex.com.tw"
      "User-Agent" = "FumanPublicSlot/1.0"
    } -Body $body -TimeoutSec 10
  } catch {
    Write-Log "WARN taifex $Cid failed: $($_.Exception.Message)"
    return $null
  }
}

function Convert-TaifexToFutoptRows {
  param([object]$Payload, [string]$Product = "TXF")
  $quoteRows = New-Object System.Collections.Generic.List[object]
  $tickerRows = New-Object System.Collections.Generic.List[object]
  $items = @($Payload.RtData.QuoteList)
  if ($items.Count -eq 0) { $items = @($Payload.RtnData.QuoteList) }
  foreach ($item in $items) {
    $futureSymbol = [string]$item.SymbolID
    if ([string]::IsNullOrWhiteSpace($futureSymbol)) { $futureSymbol = [string]$item.DispEName }
    if ([string]::IsNullOrWhiteSpace($futureSymbol)) { $futureSymbol = [string]$item.CID }
    if ([string]::IsNullOrWhiteSpace($futureSymbol)) { continue }
    $name = if ($item.DispCName) { [string]$item.DispCName } elseif ($item.CName) { [string]$item.CName } else { $futureSymbol }
    $last = Get-Number $item.CLastPrice
    $previous = Get-Number $item.CRefPrice
    if ($last -le 0 -or $previous -le 0) { continue }
    $changePercent = [math]::Round((($last - $previous) / $previous) * 100, 4)
    $updatedAt = (Get-Date).ToUniversalTime().ToString("o")

    $quoteRows.Add([ordered]@{
      future_symbol = $futureSymbol
      updated_at = $updatedAt
      last_price = $last
      open_price = Get-Number $item.COpenPrice
      high_price = Get-Number $item.CHighPrice
      low_price = Get-Number $item.CLowPrice
      previous_close = $previous
      change_percent = $changePercent
      total_volume = [int64](Convert-VolumeToLots $item.CTotalVolume)
      product = $Product
      session = "regular"
      payload = @{ raw = $item; volume_unit = "lots"; time_standard = "UTC"; scope = "TXF" }
    })
    $tickerRows.Add([ordered]@{
      future_symbol = $futureSymbol
      name = $name
      product = $Product
      contract_type = "index_future"
      end_date = $null
      exchange = "TAIFEX"
      underlying_name = "TAIEX"
      underlying_symbol = "TXF"
      session = "regular"
      updated_at = $updatedAt
      payload = @{ raw = $item; time_standard = "UTC"; scope = "TXF" }
    })
  }
  return @{ quotes = $quoteRows.ToArray(); tickers = $tickerRows.ToArray() }
}

function Normalize-StockFutureName {
  param([string]$Name)
  $text = ([string]$Name).Trim()
  $text = $text -replace "期貨\d*$", ""
  $text = $text -replace "\s+", ""
  return $text
}

function Get-StockNameLookup {
  $lookup = @{}
  foreach ($row in @(Convert-StocksSlimToTickerRows)) {
    $key = Normalize-StockFutureName ([string]$row.name)
    if (-not [string]::IsNullOrWhiteSpace($key) -and -not $lookup.ContainsKey($key)) {
      $lookup[$key] = $row
    }
  }
  return $lookup
}

function Invoke-FugleFutoptTickers {
  param([string]$ApiKey)
  if ([string]::IsNullOrWhiteSpace($ApiKey)) { return $null }

  try {
    if (Test-Path -LiteralPath $FutoptTickersCacheFile) {
      $age = ((Get-Date) - (Get-Item -LiteralPath $FutoptTickersCacheFile).LastWriteTime).TotalSeconds
      if ($age -lt $FutoptTickersEverySeconds) {
        $cached = Read-JsonFile -Path $FutoptTickersCacheFile -Default $null
        if ($null -ne $cached) {
          $cached | Add-Member -NotePropertyName public_slot_from_cache -NotePropertyValue $true -Force
        }
        return $cached
      }
    }
  } catch {}

  $headers = @{
    "X-API-KEY" = $ApiKey
    "User-Agent" = "FumanPublicSlotSharedSource/1.0"
  }
  try {
    $uri = "https://api.fugle.tw/marketdata/v1.0/futopt/intraday/tickers?type=FUTURE"
    $payload = Invoke-RestMethod -Uri $uri -Headers $headers -TimeoutSec 25 -ErrorAction Stop
    $payload | Add-Member -NotePropertyName public_slot_from_cache -NotePropertyValue $false -Force
    Write-JsonFile -Path $FutoptTickersCacheFile -Value $payload
    return $payload
  } catch {
    Write-Log "WARN fugle futopt tickers failed: $($_.Exception.Message)"
    if (Test-Path -LiteralPath $FutoptTickersCacheFile) {
      $cached = Read-JsonFile -Path $FutoptTickersCacheFile -Default $null
      if ($null -ne $cached) {
        $cached | Add-Member -NotePropertyName public_slot_from_cache -NotePropertyValue $true -Force
      }
      return $cached
    }
    return $null
  }
}

function Convert-FugleFutoptTickersToRows {
  param([object]$Payload)
  $rows = New-Object System.Collections.Generic.List[object]
  $stockLookup = Get-StockNameLookup
  $updatedAt = (Get-Date).ToUniversalTime().ToString("o")
  foreach ($item in @($Payload.data)) {
    $futureSymbol = [string]$item.symbol
    if ([string]::IsNullOrWhiteSpace($futureSymbol)) { continue }
    $contractType = [string]$item.contractType
    $name = [string]$item.name
    $product = if ($contractType -eq "S") { "STOCK_FUTURE" } elseif ($futureSymbol -match "^TXF") { "TXF" } else { "FUTURE" }
    $underlyingName = $null
    $underlyingSymbol = $null
    $contractLabel = if ($contractType -eq "S") { "stock_future" } elseif ($contractType -eq "I") { "index_future" } else { "future" }

    if ($contractType -eq "S") {
      $underlyingName = Normalize-StockFutureName $name
      $key = Normalize-StockFutureName $underlyingName
      if ($stockLookup.ContainsKey($key)) {
        $underlyingSymbol = [string]$stockLookup[$key].symbol
        $underlyingName = [string]$stockLookup[$key].name
      }
    } elseif ($futureSymbol -match "^TXF") {
      $underlyingName = "TAIEX"
      $underlyingSymbol = "TXF"
    }

    $rows.Add([ordered]@{
      future_symbol = $futureSymbol
      name = $name
      product = $product
      contract_type = $contractLabel
      end_date = if ($item.endDate) { [string]$item.endDate } else { $null }
      exchange = if ($item.exchange) { [string]$item.exchange } else { "TAIFEX" }
      underlying_name = $underlyingName
      underlying_symbol = $underlyingSymbol
      session = (Get-PublicSlotSession)
      updated_at = $updatedAt
      payload = @{
        raw = $item
        source = "fugle-futopt-intraday-tickers"
        time_standard = "UTC"
        underlying_mapping_source = if ($contractType -eq "S" -and $underlyingSymbol) { "stock_tickers_name_match" } elseif ($contractType -eq "S") { "name_unmatched" } else { "index_future" }
      }
    })
  }
  return $rows.ToArray()
}

function Get-NearMonthStockFutureSymbols {
  param([object[]]$TickerRows)
  $today = (Get-Date).Date
  $selected = New-Object System.Collections.Generic.List[string]
  $groups = @($TickerRows | Where-Object {
    $_["product"] -eq "STOCK_FUTURE" -and
    -not [string]::IsNullOrWhiteSpace([string]$_["underlying_symbol"]) -and
    -not [string]::IsNullOrWhiteSpace([string]$_["future_symbol"])
  } | Group-Object -Property { [string]$_["underlying_symbol"] })

  foreach ($group in $groups) {
    $near = @($group.Group | Sort-Object {
      try {
        $d = [datetime]::Parse([string]$_["end_date"])
        if ($d.Date -lt $today) { [datetime]::MaxValue } else { $d }
      } catch { [datetime]::MaxValue }
    }, { [string]$_["future_symbol"] } | Select-Object -First 1)
    if ($near.Count -gt 0) { $selected.Add([string]$near[0]["future_symbol"]) }
  }
  return $selected.ToArray()
}

function Get-NearMonthTxfFutureSymbols {
  param([object[]]$TickerRows)
  $today = (Get-Date).Date
  $candidates = @($TickerRows | Where-Object {
    $futureSymbol = [string]$_["future_symbol"]
    [string]$_["product"] -eq "TXF" -and
      $futureSymbol -match "^TXF" -and
      $futureSymbol -ne "TXF-S" -and
      $futureSymbol -notlike "*-F"
  } | Sort-Object {
    try {
      $d = [datetime]::Parse([string]$_["end_date"])
      if ($d.Date -lt $today) { [datetime]::MaxValue } else { $d }
    } catch { [datetime]::MaxValue }
  }, { [string]$_["future_symbol"] })

  if ($candidates.Count -gt 0) { return @([string]$candidates[0]["future_symbol"]) }
  return @()
}

function Invoke-FugleFutoptQuote {
  param([string]$FutureSymbol, [string]$ApiKey)
  if ([string]::IsNullOrWhiteSpace($FutureSymbol) -or [string]::IsNullOrWhiteSpace($ApiKey)) { return $null }
  $headers = @{
    "X-API-KEY" = $ApiKey
    "User-Agent" = "FumanPublicSlotSharedSource/1.0"
  }
  try {
    $uri = "https://api.fugle.tw/marketdata/v1.0/futopt/intraday/quote/$FutureSymbol"
    return Invoke-RestMethod -Uri $uri -Headers $headers -TimeoutSec ([math]::Max(2, $FutoptQuoteTimeoutSeconds)) -ErrorAction Stop
  } catch {
    Write-Log "WARN fugle futopt quote $FutureSymbol failed: $($_.Exception.Message)"
    if ($_.Exception.Message -match '429|Too Many') { $script:FutoptRateLimited = $true }
    return $null
  }
}

function Invoke-FugleTxfQuoteRows {
  param([string[]]$FutureSymbols, [object[]]$TickerRows, [string]$ApiKey)
  $rows = New-Object System.Collections.Generic.List[object]
  if ($FutureSymbols.Count -eq 0 -or [string]::IsNullOrWhiteSpace($ApiKey)) {
    return @{ rows = @(); attempted = 0; fetched = 0; rate_limited = $false }
  }

  $tickerBySymbol = @{}
  foreach ($ticker in @($TickerRows)) {
    $fs = [string]$ticker["future_symbol"]
    if ($fs -and -not $tickerBySymbol.ContainsKey($fs)) { $tickerBySymbol[$fs] = $ticker }
  }

  $script:FutoptRateLimited = $false
  $attempted = 0
  $fetched = 0
  $batchStarted = Get-Date
  foreach ($futureSymbol in @($FutureSymbols | Select-Object -Unique)) {
    if (((Get-Date) - $batchStarted).TotalSeconds -ge $FutoptQuoteTimeBudgetSeconds) {
      Write-Log "WARN fugle TXF quote time budget exceeded ${FutoptQuoteTimeBudgetSeconds}s; preserving previous TXF row."
      break
    }
    $attempted += 1
    $quote = Invoke-FugleFutoptQuote -FutureSymbol $futureSymbol -ApiKey $ApiKey
    $row = Convert-FugleFutoptQuoteToRow -Quote $quote -TickerBySymbol $tickerBySymbol
    if ($null -ne $row) {
      $fetched += 1
      $rows.Add($row)
    }
    if ($script:FutoptRateLimited) {
      Write-Log "WARN fugle TXF quote rate limited; preserving previous TXF row."
      break
    }
    Start-Sleep -Milliseconds ([math]::Max(100, $FutoptQuoteDelayMilliseconds))
  }

  return @{ rows = $rows.ToArray(); attempted = $attempted; fetched = $fetched; rate_limited = [bool]$script:FutoptRateLimited }
}

function Convert-FugleFutoptQuoteToRow {
  param([object]$Quote, [hashtable]$TickerBySymbol)
  if ($null -eq $Quote) { return $null }
  $futureSymbol = [string]$Quote.symbol
  if ([string]::IsNullOrWhiteSpace($futureSymbol)) { return $null }
  $ticker = $null
  if ($TickerBySymbol.ContainsKey($futureSymbol)) { $ticker = $TickerBySymbol[$futureSymbol] }
  $previous = Get-Number $Quote.previousClose
  $change = Get-Number $Quote.change
  $last = Get-Number $Quote.lastPrice
  if ($last -le 0) { $last = Get-Number $Quote.close }
  if ($last -le 0) { $last = Get-Number $Quote.price }
  if ($last -le 0 -and $previous -gt 0) { $last = $previous + $change }
  $changePercent = Get-Number $Quote.changePercent
  $updatedAt = (Get-Date).ToUniversalTime().ToString("o")
  return [ordered]@{
    future_symbol = $futureSymbol
    updated_at = $updatedAt
    last_price = $last
    open_price = Get-Number $Quote.openPrice
    high_price = Get-Number $Quote.highPrice
    low_price = Get-Number $Quote.lowPrice
    previous_close = $previous
    change_percent = $changePercent
    total_volume = [int64](Convert-VolumeToLots $Quote.total.tradeVolume)
    product = if ($ticker -and $ticker["product"]) { [string]$ticker["product"] } elseif ($futureSymbol -match "^TXF") { "TXF" } else { "STOCK_FUTURE" }
    session = (Get-PublicSlotSession)
    payload = @{
      raw = $Quote
      source = "fugle-futopt-intraday-quote"
      volume_unit = "lots"
      time_standard = "UTC"
      underlying_symbol = if ($ticker) { $ticker["underlying_symbol"] } else { $null }
      underlying_name = if ($ticker) { $ticker["underlying_name"] } else { $null }
    }
  }
}

function Invoke-FugleFutoptQuoteBatch {
  param([string[]]$FutureSymbols, [object[]]$TickerRows, [string]$ApiKey)
  $state = Read-JsonFile -Path $FutoptQuoteStateFile -Default ([pscustomobject]@{ cursor = 0; last_run_at = $null })
  $script:FutoptRateLimited = $false
  $lastRun = $null
  try { if ($state.last_run_at) { $lastRun = [datetimeoffset]::Parse([string]$state.last_run_at).LocalDateTime } } catch {}
  if ($null -ne $lastRun -and ((Get-Date) - $lastRun).TotalSeconds -lt $FutoptQuoteEverySeconds) {
    return @{ rows = @(); attempted = 0; fetched = 0; skipped = $true; rate_limited = $false }
  }
  if ($FutureSymbols.Count -eq 0 -or [string]::IsNullOrWhiteSpace($ApiKey)) {
    return @{ rows = @(); attempted = 0; fetched = 0; skipped = $false; rate_limited = $false }
  }

  $tickerBySymbol = @{}
  foreach ($ticker in @($TickerRows)) {
    $fs = [string]$ticker["future_symbol"]
    if ($fs -and -not $tickerBySymbol.ContainsKey($fs)) { $tickerBySymbol[$fs] = $ticker }
  }
  $cursor = [int]($state.cursor)
  if ($cursor -lt 0 -or $cursor -ge $FutureSymbols.Count) { $cursor = 0 }
  $effectiveFutoptQuoteBatchSize = $FutoptQuoteBatchSize
  if ($FutoptQuoteFullDetect) {
    $effectiveFutoptQuoteBatchSize = $FutureSymbols.Count
  } elseif ((Get-PublicSlotSession) -eq "regular") {
    $effectiveFutoptQuoteBatchSize = [math]::Min($effectiveFutoptQuoteBatchSize, 20)
  }
  $batch = New-Object System.Collections.Generic.List[string]
  for ($i = 0; $i -lt [math]::Min($effectiveFutoptQuoteBatchSize, $FutureSymbols.Count); $i++) {
    $batch.Add([string]$FutureSymbols[($cursor + $i) % $FutureSymbols.Count])
  }

  $rows = New-Object System.Collections.Generic.List[object]
  $fetched = 0
  $attempted = 0
  $batchStarted = Get-Date
  foreach ($futureSymbol in $batch) {
    if (((Get-Date) - $batchStarted).TotalSeconds -ge $FutoptQuoteTimeBudgetSeconds) {
      Write-Log "WARN futopt quote time budget exceeded ${FutoptQuoteTimeBudgetSeconds}s; stopping current batch."
      break
    }
    $attempted += 1
    $quote = Invoke-FugleFutoptQuote -FutureSymbol $futureSymbol -ApiKey $ApiKey
    $row = Convert-FugleFutoptQuoteToRow -Quote $quote -TickerBySymbol $tickerBySymbol
    if ($null -ne $row) {
      $fetched += 1
      $rows.Add($row)
    }
    if ($script:FutoptRateLimited) {
      Write-Log "WARN futopt quote rate limited; stopping current batch and cooling down."
      break
    }
    Start-Sleep -Milliseconds ([math]::Max(40, [math]::Min(100, $FutoptQuoteDelayMilliseconds)))
  }
  $nextCursor = ($cursor + [math]::Max(1, $attempted)) % $FutureSymbols.Count
  Write-JsonFile -Path $FutoptQuoteStateFile -Value ([ordered]@{
    cursor = $nextCursor
    last_run_at = (Get-Date).ToString("o")
    last_attempted = $attempted
    last_fetched_symbols = $fetched
    last_rows = $rows.Count
    universe = $FutureSymbols.Count
    full_detect = [bool]$FutoptQuoteFullDetect
    full_detect_complete = [bool]($attempted -ge $FutureSymbols.Count -and -not $script:FutoptRateLimited)
    rate_limited = [bool]$script:FutoptRateLimited
    timeout_seconds = $FutoptQuoteTimeoutSeconds
    time_budget_seconds = $FutoptQuoteTimeBudgetSeconds
  })
  return @{
    rows = $rows.ToArray()
    attempted = $attempted
    fetched = $fetched
    skipped = $false
    rate_limited = [bool]$script:FutoptRateLimited
    universe = $FutureSymbols.Count
    full_detect = [bool]$FutoptQuoteFullDetect
    full_detect_complete = [bool]($attempted -ge $FutureSymbols.Count -and -not $script:FutoptRateLimited)
    timeout_seconds = $FutoptQuoteTimeoutSeconds
    time_budget_seconds = $FutoptQuoteTimeBudgetSeconds
  }
}

function Convert-StocksSlimToTickerRows {
  $stocksFile = Join-Path $RuntimeDir "data\stocks-slim.json"
  $rows = New-Object System.Collections.Generic.List[object]
  try {
    if (-not (Test-Path -LiteralPath $stocksFile)) { return $rows.ToArray() }
    $rawStocks = Get-Content -LiteralPath $stocksFile -Raw -ErrorAction Stop
    $matches = [regex]::Matches($rawStocks, '"code"\s*:\s*"(\d{4})"[\s\S]{0,400}?"name"\s*:\s*"([^"]*)"[\s\S]{0,400}?"market"\s*:\s*"([^"]*)"')
    $seen = @{}
    foreach ($match in $matches) {
      $symbol = [string]$match.Groups[1].Value
      if ($seen.ContainsKey($symbol)) { continue }
      if (Test-BuiltInBlacklistedStock -Symbol $symbol -Name ([string]$match.Groups[2].Value)) { continue }
      $seen[$symbol] = $true
      $market = Convert-Market ([string]$match.Groups[3].Value)
      $isEtf = $symbol.StartsWith("00")
      $rows.Add([ordered]@{
        symbol = $symbol
        name = [string]$match.Groups[2].Value
        market = $market
        stock_type = if ($isEtf) { "ETF" } else { "COMMONSTOCK" }
        industry = $null
        type = if ($isEtf) { "ETF" } else { "stock" }
        is_etf = $isEtf
        is_suspended = $false
        updated_at = (Get-Date).ToUniversalTime().ToString("o")
      payload = @{ source = "stocks-slim"; symbol = $symbol; blacklist_applied = $true }
      })
    }
  } catch {
    Write-Log "WARN unable to parse stocks-slim tickers: $($_.Exception.Message)"
  }
  return $rows.ToArray()
}

function Update-MinuteRows {
  param([object[]]$QuoteRows, [string[]]$CandidateSymbols = @())

  $state = Read-JsonFile -Path $StateFile -Default ([pscustomobject]@{ buckets = @{} })
  if (-not $state.buckets) { $state | Add-Member -NotePropertyName buckets -NotePropertyValue ([pscustomobject]@{}) -Force }
  if (-not $state.last_total_volume) { $state | Add-Member -NotePropertyName last_total_volume -NotePropertyValue ([pscustomobject]@{}) -Force }
  $rows = New-Object System.Collections.Generic.List[object]
  $daily = New-Object System.Collections.Generic.List[object]
  $today = (Get-Date).ToString("yyyy-MM-dd")
  $session = Get-PublicSlotSession
  $now = Get-Date
  $currentMinute = $now.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:00Z")
  $currentTaipeiMinute = ([datetimeoffset]::Parse($currentMinute)).ToOffset([timespan]::FromHours(8)).ToString("yyyy-MM-dd HH:mm:ss")
  $candidateSet = New-Object System.Collections.Generic.HashSet[string]
  $candidatePool = @($CandidateSymbols | Where-Object { [string]$_ -match '^\d{4}$' } | Select-Object -Unique)
  if ($candidatePool.Count -le 0) {
    $candidatePool = @($QuoteRows | ForEach-Object { [string]$_.symbol } | Where-Object { $_ -match '^\d{4}$' } | Select-Object -Unique)
  }
  if ($QuoteDerived1mCandidateCount -gt 0) {
    $candidatePool = @($candidatePool | Select-Object -First $QuoteDerived1mCandidateCount)
  }
  foreach ($candidate in $candidatePool) {
    if ([string]$candidate -match '^\d{4}$') { [void]$candidateSet.Add([string]$candidate) }
  }
  $fullUniverseMode = ($QuoteDerived1mCandidateCount -le 0)
  $candidatePoolLabel = if ($fullUniverseMode) { "active_common_stock_full_universe" } else { "daytrade_hot_or_priority" }
  $openingBackfillRows = 0
  $openingBackfillTargetMinutes = 0
  $openingBackfillSymbolsWritten = New-Object System.Collections.Generic.HashSet[string]
  $openingBackfillMinutes = New-Object System.Collections.Generic.List[object]
  $taipeiTimeOfDay = $now.TimeOfDay
  if ($session -eq "regular" -and $QuoteDerivedOpeningBackfillMinutes -gt 0 -and $taipeiTimeOfDay -ge [TimeSpan]::Parse("09:00") -and $taipeiTimeOfDay -le [TimeSpan]::Parse("13:35")) {
    $marketOpen = [datetime]::ParseExact("$today 09:00", "yyyy-MM-dd HH:mm", $null)
    $elapsedOpeningMinutes = [int][math]::Floor(($now - $marketOpen).TotalMinutes)
    $openingBackfillTargetMinutes = [int][math]::Max(0, [math]::Min($QuoteDerivedOpeningBackfillMinutes, $elapsedOpeningMinutes + 1))
    $previousBackfillDate = [string]$state.opening_backfill_date
    $previousBackfillMinutes = if ($previousBackfillDate -eq $today) { [int](Get-Number $state.opening_backfill_minutes_done) } else { 0 }
    $previousBackfillSymbols = if ($previousBackfillDate -eq $today) { [int](Get-Number $state.opening_backfill_symbols) } else { 0 }
    if ($openingBackfillTargetMinutes -gt 0 -and ($previousBackfillMinutes -lt $openingBackfillTargetMinutes -or $previousBackfillSymbols -lt $candidateSet.Count)) {
      for ($i = 0; $i -lt $openingBackfillTargetMinutes; $i++) {
        $localMinute = $marketOpen.AddMinutes($i)
        $utcMinute = ([datetimeoffset]$localMinute).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:00Z")
        if ($utcMinute -eq $currentMinute) { continue }
        $openingBackfillMinutes.Add([pscustomobject]@{
          utc = $utcMinute
          taipei = $localMinute.ToString("yyyy-MM-dd HH:mm:ss")
        })
      }
    }
  }
  $currentQuoteDerivedRows = 0

  foreach ($quote in $QuoteRows) {
    $symbol = [string]$quote.symbol
    if ($candidateSet.Count -gt 0 -and -not $candidateSet.Contains($symbol)) { continue }
    $quoteSession = [string]$quote.session
    $quoteIsTrial = $false
    try { $quoteIsTrial = [bool]$quote.is_trial } catch {}
    if ($session -ne "regular" -or $quoteIsTrial) { continue }
    $quoteTime = $null
    try { $quoteTime = [datetimeoffset]::Parse([string]$quote.updated_at) } catch {}
    if ($null -eq $quoteTime) { continue }
    $quoteAgeSeconds = [int][math]::Max(0, ($now.ToUniversalTime() - $quoteTime.UtcDateTime).TotalSeconds)
    $quoteFreshForDerived1m = ($quoteAgeSeconds -le $QuoteDerived1mMaxQuoteAgeSeconds)
    if (-not $quoteFreshForDerived1m -and -not $fullUniverseMode) { continue }
    if ($taipeiTimeOfDay -lt [TimeSpan]::Parse("09:00") -or $taipeiTimeOfDay -gt [TimeSpan]::Parse("13:35")) { continue }
    $minute = $currentMinute
    $pricePayload = Get-QuoteDerivedPrice -Quote $quote
    $price = [double]$pricePayload.price
    $totalVolume = [int64](Convert-VolumeToLots $quote.total_volume)
    if ($price -le 0 -or $symbol -notmatch '^\d{4}$') { continue }

    $bucket = $state.buckets.$symbol
    $previousTotalVolume = $state.last_total_volume.$symbol
    if ($null -eq $previousTotalVolume) { $previousTotalVolume = $totalVolume }
    $startVolume = [int64]$previousTotalVolume
    if ($startVolume -gt $totalVolume) { $startVolume = $totalVolume }

    if ($null -eq $bucket -or [string]$bucket.minute -ne $minute) {
      $bucket = [pscustomobject]@{
        minute = $minute
        open = $price
        high = $price
        low = $price
        close = $price
        start_volume = $startVolume
        last_volume = $totalVolume
        market = [string]$quote.market
      }
      $state.buckets | Add-Member -NotePropertyName $symbol -NotePropertyValue $bucket -Force
    } else {
      $bucket.high = [math]::Max([double]$bucket.high, $price)
      $bucket.low = [math]::Min([double]$bucket.low, $price)
      $bucket.close = $price
      $bucket.last_volume = [math]::Max([int64]$bucket.last_volume, $totalVolume)
    }

    $state.last_total_volume | Add-Member -NotePropertyName $symbol -NotePropertyValue ([int64]$bucket.last_volume) -Force
    $taipeiMinute = $currentTaipeiMinute

    $minuteVolume = [int64]([math]::Max(0, [int64]$bucket.last_volume - [int64]$bucket.start_volume))
    $synthetic = ($minuteVolume -le 0 -or -not $quoteFreshForDerived1m -or [bool]$pricePayload.synthetic)
    $minuteSource = if ($quoteFreshForDerived1m) { "quote_derived_1m" } else { "synthetic_flat" }
    if ([bool]$pricePayload.synthetic) { $minuteSource = "synthetic_flat" }
    $rows.Add([ordered]@{
      symbol = $symbol
      market = [string]$quote.market
      trade_date = $today
      candle_time = $minute
      open = Get-Number $bucket.open
      high = Get-Number $bucket.high
      low = Get-Number $bucket.low
      close = Get-Number $bucket.close
      volume = $minuteVolume
      updated_at = (Get-Date).ToUniversalTime().ToString("o")
      payload = @{
        source = $minuteSource
        total_volume = $totalVolume
        start_total_volume = [int64]$bucket.start_volume
        last_total_volume = [int64]$bucket.last_volume
        zero_volume_hold = ($minuteVolume -le 0)
        synthetic = $synthetic
        volume_strategy_usable = (-not $synthetic)
        volume_unit = "lots"
        time_standard = "UTC"
        taipei_candle_time = $taipeiMinute
        quote_updated_at = $quoteTime.ToUniversalTime().ToString("o")
        quote_age_seconds = $quoteAgeSeconds
        quote_fresh_for_1m = $quoteFreshForDerived1m
        price_source = [string]$pricePayload.source
        stale_quote_synthetic_flat = (-not $quoteFreshForDerived1m)
        candidate_pool = $candidatePoolLabel
        quote_derived_1m_full_universe = [bool]$fullUniverseMode
        opening_backfill = $false
        session = $session
      }
    })
    $currentQuoteDerivedRows += 1

    if ($openingBackfillMinutes.Count -gt 0) {
      $backfillPrice = Get-Number $quote.open_price
      if ($backfillPrice -le 0) { $backfillPrice = $price }
      foreach ($openingMinute in $openingBackfillMinutes) {
        $rows.Add([ordered]@{
          symbol = $symbol
          market = [string]$quote.market
          trade_date = $today
          candle_time = [string]$openingMinute.utc
          open = $backfillPrice
          high = $backfillPrice
          low = $backfillPrice
          close = $backfillPrice
          volume = 0
          updated_at = (Get-Date).ToUniversalTime().ToString("o")
          payload = @{
            source = $minuteSource
            total_volume = $totalVolume
            start_total_volume = $totalVolume
            last_total_volume = $totalVolume
            zero_volume_hold = $true
            synthetic = $true
            volume_strategy_usable = $false
            volume_unit = "lots"
            time_standard = "UTC"
            taipei_candle_time = [string]$openingMinute.taipei
            quote_updated_at = $quoteTime.ToUniversalTime().ToString("o")
            quote_age_seconds = $quoteAgeSeconds
            quote_fresh_for_1m = $quoteFreshForDerived1m
            price_source = [string]$pricePayload.source
            stale_quote_synthetic_flat = (-not $quoteFreshForDerived1m)
            candidate_pool = $candidatePoolLabel
            quote_derived_1m_full_universe = [bool]$fullUniverseMode
            opening_backfill = $true
            opening_backfill_target_minutes = $openingBackfillTargetMinutes
            session = $session
          }
        })
        $openingBackfillRows += 1
      }
      [void]$openingBackfillSymbolsWritten.Add($symbol)
    }

    if ($quoteFreshForDerived1m) {
      $daily.Add([ordered]@{
        symbol = $symbol
        market = [string]$quote.market
        trade_date = $today
        volume = $totalVolume
        updated_at = (Get-Date).ToUniversalTime().ToString("o")
        payload = @{ source = "fugle-ws-aggregate"; volume_unit = "lots"; time_standard = "UTC" }
      })
    }
  }

  if ($openingBackfillRows -gt 0) {
    $state | Add-Member -NotePropertyName opening_backfill_date -NotePropertyValue $today -Force
    $state | Add-Member -NotePropertyName opening_backfill_minutes_done -NotePropertyValue $openingBackfillTargetMinutes -Force
    $state | Add-Member -NotePropertyName opening_backfill_symbols -NotePropertyValue $openingBackfillSymbolsWritten.Count -Force
    $state | Add-Member -NotePropertyName opening_backfill_rows -NotePropertyValue $openingBackfillRows -Force
    $state | Add-Member -NotePropertyName opening_backfill_updated_at -NotePropertyValue (Get-Date).ToString("o") -Force
  }

  Write-JsonFile -Path $StateFile -Value $state
  return @{
    minuteRows = $rows.ToArray()
    dailyRows = $daily.ToArray()
    candidateSymbols = $candidateSet.Count
    candidateLimit = $QuoteDerived1mCandidateCount
    fullUniverse = [bool]$fullUniverseMode
    currentMinute = $currentMinute
    quoteDerivedRows = $rows.Count
    quoteDerivedCurrentRows = $currentQuoteDerivedRows
    quoteDerivedMaxQuoteAgeSeconds = $QuoteDerived1mMaxQuoteAgeSeconds
    openingBackfillRows = $openingBackfillRows
    openingBackfillSymbols = $openingBackfillSymbolsWritten.Count
    openingBackfillTargetMinutes = $openingBackfillTargetMinutes
  }
}

function New-Intraday1mSelfHealResult {
  param(
    [string]$Reason = "not_checked",
    [bool]$Triggered = $false,
    [object[]]$Rows = @(),
    [object[]]$DailyRows = @(),
    [int]$StaleBefore = -1,
    [int]$StaleAfter = -1,
    [string]$CurrentMinute = $null,
    [int]$CandidateSymbols = 0,
    [bool]$FullUniverse = $false,
    [bool]$Skipped = $true
  )

  return [pscustomobject]@{
    summary = [pscustomobject]@{
      enabled = [bool]$Intraday1mSelfHealEnabled
      triggered = [bool]$Triggered
      skipped = [bool]$Skipped
      reason = $Reason
      checked_at = (Get-Date).ToUniversalTime().ToString("o")
      threshold_seconds = [int]$Intraday1mSelfHealStaleSeconds
      cooldown_seconds = [int]$Intraday1mSelfHealCooldownSeconds
      stale_before = if ($StaleBefore -ge 0) { $StaleBefore } else { $null }
      stale_after = if ($StaleAfter -ge 0) { $StaleAfter } else { $null }
      rows_written = @($Rows).Count
      daily_rows_written = @($DailyRows).Count
      current_minute = $CurrentMinute
      candidate_symbols = $CandidateSymbols
      full_universe = [bool]$FullUniverse
    }
    rows = @($Rows)
    dailyRows = @($DailyRows)
  }
}

function Invoke-Intraday1mSelfHeal {
  param(
    [string]$Session,
    [object[]]$QuoteRows = @(),
    [string[]]$CandidateSymbols = @(),
    [hashtable]$IntradayStats = @{}
  )

  $staleBefore = [int](Get-Number $IntradayStats.intraday_1m_stale_seconds)
  $rowsToday = [int](Get-Number $IntradayStats.intraday_1m_rows_today)
  $latestCandleTime = [string]$IntradayStats.intraday_1m_latest_candle_time
  $candidateCount = @($CandidateSymbols | Where-Object { [string]$_ -match '^\d{4}$' } | Select-Object -Unique).Count
  $fullUniverseMode = ($QuoteDerived1mCandidateCount -le 0)

  if (-not $Intraday1mSelfHealEnabled) {
    return (New-Intraday1mSelfHealResult -Reason "disabled" -StaleBefore $staleBefore -CandidateSymbols $candidateCount -FullUniverse:$fullUniverseMode)
  }
  if ($Session -ne "regular") {
    return (New-Intraday1mSelfHealResult -Reason "session_not_regular" -StaleBefore $staleBefore -CandidateSymbols $candidateCount -FullUniverse:$fullUniverseMode)
  }
  $now = Get-Date
  if ($now.TimeOfDay -lt [TimeSpan]::Parse("09:00") -or $now.TimeOfDay -gt [TimeSpan]::Parse("13:35")) {
    return (New-Intraday1mSelfHealResult -Reason "outside_regular_write_window" -StaleBefore $staleBefore -CandidateSymbols $candidateCount -FullUniverse:$fullUniverseMode)
  }
  if (@($QuoteRows).Count -le 0) {
    return (New-Intraday1mSelfHealResult -Reason "no_quote_rows" -StaleBefore $staleBefore -CandidateSymbols $candidateCount -FullUniverse:$fullUniverseMode)
  }

  $reason = "fresh"
  $shouldHeal = $false
  if ($rowsToday -le 0) {
    $reason = "no_today_1m_rows"
    $shouldHeal = $true
  } elseif ([string]::IsNullOrWhiteSpace($latestCandleTime)) {
    $reason = "missing_latest_candle_time"
    $shouldHeal = $true
  } elseif ($staleBefore -gt $Intraday1mSelfHealStaleSeconds) {
    $reason = "intraday_1m_stale"
    $shouldHeal = $true
  }

  if (-not $shouldHeal) {
    return (New-Intraday1mSelfHealResult -Reason $reason -StaleBefore $staleBefore -CandidateSymbols $candidateCount -FullUniverse:$fullUniverseMode -Skipped:$false)
  }

  $state = Read-JsonFile -Path $Intraday1mSelfHealStateFile -Default ([pscustomobject]@{})
  $lastRunAt = $null
  try {
    if (-not [string]::IsNullOrWhiteSpace([string]$state.last_run_at)) {
      $lastRunAt = [datetimeoffset]::Parse([string]$state.last_run_at).ToUniversalTime()
    }
  } catch {}
  if ($null -ne $lastRunAt -and (($now.ToUniversalTime() - $lastRunAt.UtcDateTime).TotalSeconds -lt $Intraday1mSelfHealCooldownSeconds)) {
    return (New-Intraday1mSelfHealResult -Reason "cooldown_$reason" -StaleBefore $staleBefore -CandidateSymbols $candidateCount -FullUniverse:$fullUniverseMode)
  }

  $minutePayload = Update-MinuteRows -QuoteRows $QuoteRows -CandidateSymbols $CandidateSymbols
  $rows = @($minutePayload.minuteRows)
  $dailyRows = @($minutePayload.dailyRows)
  if ($rows.Count -gt 0) { Write-PublicSlotIntraday1m -Rows $rows }
  if ($dailyRows.Count -gt 0) { Write-PublicSlotDailyVolume -Rows $dailyRows }

  $staleAfter = if ($rows.Count -gt 0) { 0 } else { $staleBefore }
  $statePayload = [ordered]@{
    last_run_at = (Get-Date).ToUniversalTime().ToString("o")
    trade_date = (Get-Date).ToString("yyyy-MM-dd")
    reason = $reason
    stale_before = $staleBefore
    stale_after = $staleAfter
    rows_written = $rows.Count
    daily_rows_written = $dailyRows.Count
    current_minute = $minutePayload.currentMinute
    candidate_symbols = $minutePayload.candidateSymbols
    full_universe = [bool]$minutePayload.fullUniverse
    quote_rows = @($QuoteRows).Count
    threshold_seconds = [int]$Intraday1mSelfHealStaleSeconds
    cooldown_seconds = [int]$Intraday1mSelfHealCooldownSeconds
  }
  Write-JsonFile -Path $Intraday1mSelfHealStateFile -Value $statePayload
  Write-Log "intraday_1m_self_heal reason=$reason stale_before=$staleBefore rows=$($rows.Count) daily_rows=$($dailyRows.Count) current_minute=$($minutePayload.currentMinute) full_universe=$($minutePayload.fullUniverse)"

  return (New-Intraday1mSelfHealResult -Reason $reason -Triggered:($rows.Count -gt 0) -Rows $rows -DailyRows $dailyRows -StaleBefore $staleBefore -StaleAfter $staleAfter -CurrentMinute $minutePayload.currentMinute -CandidateSymbols $minutePayload.candidateSymbols -FullUniverse:([bool]$minutePayload.fullUniverse) -Skipped:$false)
}

function Convert-IntradayRowsToDailyVolumeRows {
  param([object[]]$Rows)

  $groups = @{}
  foreach ($row in @($Rows)) {
    $symbol = [string]$row.symbol
    $tradeDate = [string]$row.trade_date
    if ($symbol -notmatch '^\d{4}$' -or [string]::IsNullOrWhiteSpace($tradeDate)) { continue }
    $key = "$symbol|$tradeDate"
    if (-not $groups.ContainsKey($key)) {
      $groups[$key] = [ordered]@{
        symbol = $symbol
        market = [string]$row.market
        trade_date = $tradeDate
        volume = 0
        updated_at = (Get-Date).ToUniversalTime().ToString("o")
        payload = @{ source = "fugle-rest-1m-aggregate"; volume_unit = "lots"; time_standard = "UTC" }
      }
    }
    $groups[$key].volume = [double]$groups[$key].volume + [double](Convert-VolumeToLots $row.volume)
  }

  return @($groups.Values)
}

function Convert-IntradayRowsToDailyOhlcvRows {
  param([object[]]$Rows)

  $groups = @{}
  foreach ($row in @($Rows | Sort-Object symbol, trade_date, candle_time)) {
    $symbol = [string]$row.symbol
    $tradeDate = [string]$row.trade_date
    $close = Get-Number $row.close
    if ($symbol -notmatch '^\d{4}$' -or [string]::IsNullOrWhiteSpace($tradeDate) -or $close -le 0) { continue }
    $key = "$symbol|$tradeDate"
    if (-not $groups.ContainsKey($key)) {
      $groups[$key] = [ordered]@{
        symbol = $symbol
        market = [string]$row.market
        trade_date = $tradeDate
        open = Get-Number $row.open
        high = Get-Number $row.high
        low = Get-Number $row.low
        close = $close
        volume = 0
        source = "fugle-rest-1m-aggregate"
        updated_at = (Get-Date).ToUniversalTime().ToString("o")
        payload = @{ source = "fugle-rest-1m-aggregate"; volume_unit = "lots"; time_standard = "UTC" }
      }
    } else {
      $groups[$key].high = [math]::Max([double]$groups[$key].high, [double](Get-Number $row.high))
      $groups[$key].low = [math]::Min([double]$groups[$key].low, [double](Get-Number $row.low))
      $groups[$key].close = $close
    }
    $groups[$key].volume = [double]$groups[$key].volume + [double](Convert-VolumeToLots $row.volume)
  }

  return @($groups.Values)
}

function Sync-LatestQuoteCacheToPublicSlot {
  param(
    [string]$QuotesFile,
    [string]$Reason,
    [string]$Session,
    [bool]$ShouldWritePreopenRows
  )

  $empty = [pscustomobject]@{
    quoteRows = @()
    preopenRows = @()
    rows = 0
    lastQuoteAt = $null
    quoteAgeSeconds = 999999
  }

  try {
    $latestQuotePayload = Read-JsonFile -Path $QuotesFile -Default ([pscustomobject]@{})
    $latestQuoteObjects = @($latestQuotePayload.quotes)
    if ($latestQuoteObjects.Count -le 0) { return $empty }

    $latestQuoteRows = @(Convert-QuotesToRows -Quotes $latestQuoteObjects -Payload $latestQuotePayload)
    if ($latestQuoteRows.Count -le 0) { return $empty }

    $latestPreopenRows = @(Convert-QuotesToPreopenRows -Quotes $latestQuoteObjects -Payload $latestQuotePayload)
    Write-PublicSlotQuotesLive -Rows $latestQuoteRows
    if ($ShouldWritePreopenRows -and $latestPreopenRows.Count -gt 0) {
      Write-PublicSlotPreopenSnapshot -Rows $latestPreopenRows
      Write-PublicSlotPreopenSnapshotHistory -Rows $latestPreopenRows
    }

    $lastQuoteAt = Get-LatestIsoUtc -Rows $latestQuoteRows -PropertyName "updated_at"
    $quoteAgeSeconds = Get-IsoAgeSeconds -IsoTime $lastQuoteAt -FallbackSeconds 999999
    Write-Log "quote-flush reason=$Reason rows=$($latestQuoteRows.Count) last_quote_at=$lastQuoteAt quote_age_seconds=$quoteAgeSeconds"

    return [pscustomobject]@{
      quoteRows = $latestQuoteRows
      preopenRows = $latestPreopenRows
      rows = $latestQuoteRows.Count
      lastQuoteAt = $lastQuoteAt
      quoteAgeSeconds = $quoteAgeSeconds
    }
  } catch {
    Write-Log "WARN quote-flush reason=$Reason failed: $($_.Exception.Message)"
    return $empty
  }
}

function Use-QuoteFlushResult {
  param(
    [object]$FlushResult,
    [ref]$QuoteRows,
    [ref]$PreopenRows
  )

  if ($null -ne $FlushResult -and [int]$FlushResult.rows -gt 0) {
    $QuoteRows.Value = @($FlushResult.quoteRows)
    $PreopenRows.Value = @($FlushResult.preopenRows)
  }
}

function Test-Strategy2ReadinessRefreshDue {
  param([datetime]$LastRefreshAt)
  if ($Strategy2ReadyRefreshEverySeconds -le 0) { return $true }
  if ($LastRefreshAt -eq [datetime]::MinValue) { return $true }
  return (((Get-Date) - $LastRefreshAt).TotalSeconds -ge $Strategy2ReadyRefreshEverySeconds)
}

if (-not (Test-Path -LiteralPath $SourceHelper)) {
  throw "Missing helper: $SourceHelper"
}
Apply-PublicSlotRuntimeConfig
Assert-PublicSlotWriterOwner
. $SourceHelper

$serviceRoleKey = $env:SUPABASE_SERVICE_ROLE_KEY
if ([string]::IsNullOrWhiteSpace($serviceRoleKey)) {
  $serviceRoleKey = Read-TextSecret @(
    (Join-Path $RuntimeDir "secrets\supabase-service-role-key.txt"),
    (Join-Path $FumanRoot "secrets\supabase-service-role-key.txt")
  )
}
if ([string]::IsNullOrWhiteSpace($serviceRoleKey)) {
  throw "SUPABASE_SERVICE_ROLE_KEY missing. Put it in C:\fuman-runtime\secrets\supabase-service-role-key.txt or set env var."
}

Initialize-SupabasePublicSlotSource -Url $ProjectUrl -ServiceRoleKey $serviceRoleKey
$fugleApiKey = Get-FugleApiKey
$script:SymbolBlacklist = Read-SymbolBlacklist
Write-Log "Public slot shared source started. Supabase=$ProjectUrl Runtime=$RuntimeDir"
Write-Log "Runtime config file=$RuntimeConfigFile restQuoteBatch=$RestQuoteBatchSize restQuoteEvery=${RestQuoteEverySeconds}s restQuoteDelay=${RestQuoteDelayMilliseconds}ms restQuoteTimeout=${RestQuoteTimeoutSeconds}s restQuoteBudget=${RestQuoteBatchTimeBudgetSeconds}s restQuoteCooldown=${RestQuoteRateLimitCooldownSeconds}s restQuoteBypassMinFresh=$RestQuoteBypassMinFreshQuotes restQuoteBypassCoverage=$RestQuoteBypassCoverageRatio restQuoteBypassMaxAge=${RestQuoteBypassMaxAgeSeconds}s openingBoost=$OpeningBoostStart-$OpeningBoostEnd restOpeningBoostBatch=$RestQuoteOpeningBoostBatchSize restOpeningBoostDelay=${RestQuoteOpeningBoostDelayMilliseconds}ms collectorLoop=${FugleCollectorLoopMilliseconds}ms collectorBatch=$FugleCollectorBatchSize collectorConcurrency=$FugleCollectorConcurrency collectorDelay=${FugleCollectorRequestDelayMilliseconds}ms collectorTtl=${FugleCollectorQuoteTtlMilliseconds}ms collectorOpeningBoostBatch=$FugleCollectorOpeningBoostBatchSize collectorOpeningBoostConcurrency=$FugleCollectorOpeningBoostConcurrency collectorOpeningBoostDelay=${FugleCollectorOpeningBoostDelayMilliseconds}ms collectorPrimary=fugle collectorFallback=finmind collectorFinMindRecoveryEnabled=$FugleCollectorFinMindRecoveryEnabled collectorFinMindRecoveryTimeout=${FugleCollectorFinMindRecoveryTimeoutMilliseconds}ms direct1mBatch=$Direct1mBatchSize direct1mEvery=${Direct1mEverySeconds}s direct1mTimeout=${Direct1mIntradayTimeoutSeconds}s direct1mHistoricalTimeout=${Direct1mHistoricalTimeoutSeconds}s direct1mBudget=${Direct1mBatchTimeBudgetSeconds}s direct1mPrewarmEnabled=$Direct1mPrewarmEnabled direct1mPrewarmStart=$Direct1mPrewarmStart direct1mPrewarmSymbols=$Direct1mPrewarmSymbolCount direct1mPrewarmBatch=$Direct1mPrewarmBatchSize direct1mPrewarmBars=$Direct1mPrewarmBars direct1mPrewarmBudget=${Direct1mPrewarmTimeBudgetSeconds}s quoteDerivedCandidateLimit=$QuoteDerived1mCandidateCount quoteDerivedMaxAge=${QuoteDerived1mMaxQuoteAgeSeconds}s openingBackfillMinutes=$QuoteDerivedOpeningBackfillMinutes intradayFreshTarget=${Intraday1mFreshTargetSeconds}s intradayFreshHard=${Intraday1mFreshHardSeconds}s intradaySelfHealEnabled=$Intraday1mSelfHealEnabled intradaySelfHealStale=${Intraday1mSelfHealStaleSeconds}s intradaySelfHealCooldown=${Intraday1mSelfHealCooldownSeconds}s futoptBatch=$FutoptQuoteBatchSize futoptEvery=${FutoptQuoteEverySeconds}s futoptDelay=${FutoptQuoteDelayMilliseconds}ms futoptTimeout=${FutoptQuoteTimeoutSeconds}s futoptBudget=${FutoptQuoteTimeBudgetSeconds}s futoptFullDetect=$FutoptQuoteFullDetect upsertTimeout=${PublicSlotUpsertTimeoutSec}s upsertBatch=$PublicSlotUpsertBatchSize writePreopen=$WritePreopenRows writePreopenMode=$WritePreopenRowsMode strategy2ReadyRefreshEnabled=$Strategy2ReadyRefreshEnabled strategy2ReadyPageSize=$Strategy2ReadyPageSize strategy2ReadyEffectivePageSize=$(Get-Strategy2ReadyEffectivePageSize) strategy2ReadyMaxPages=$Strategy2ReadyMaxPages strategy2ReadyRefreshEvery=${Strategy2ReadyRefreshEverySeconds}s minAvgVolume5Lots=$MinAvgVolume5Lots writerOwnerComputer=$WriterOwnerComputer currentComputer=$env:COMPUTERNAME"
Write-Log "API blacklist symbols loaded: $($script:SymbolBlacklist.Count)"

$stopTime = Get-StopTimeToday -HHmm $StopAt
if (-not $Once -and (Get-Date) -ge $stopTime) {
  Write-Log "Public slot shared source skipped because current time is after StopAt $StopAt."
  exit 0
}
$lastStockTickerWriteAt = [datetime]::MinValue
$lastMaintenanceAt = [datetime]::MinValue
$lastStrategy2ReadinessRefreshAt = [datetime]::MinValue
$StatusSourceName = if ($NoStartCollector) { "$SourceName`_smoke_test" } else { $SourceName }

do {
  $loopStarted = Get-Date
  try {
    $script:SymbolBlacklist = Read-SymbolBlacklist
    $seeded = Initialize-WebSocketSymbols
    $collectorState = Start-FugleWebSocketCollector

    $quotesFile = Join-Path $RuntimeDir "cache\intraday\fugle-ws-quotes.json"
    $wsStatusFile = Join-Path $RuntimeDir "state\fugle-websocket-status.json"
    $payload = Read-JsonFile -Path $quotesFile -Default ([pscustomobject]@{})
    $wsStatus = Read-JsonFile -Path $wsStatusFile -Default ([pscustomobject]@{})
    $quotes = @($payload.quotes)
    $age = 999999
    if (Test-Path -LiteralPath $quotesFile) {
      $age = [int](((Get-Date) - (Get-Item -LiteralPath $quotesFile).LastWriteTime).TotalSeconds)
    }

    $session = Get-PublicSlotSession
    $earlyQuoteRows = @(Convert-QuotesToRows -Quotes $quotes -Payload $payload)
    if ($earlyQuoteRows.Count -gt 0) {
      $earlyEligibleSymbols = @($earlyQuoteRows | ForEach-Object { [string]$_.symbol } | Where-Object { $_ -match '^\d{4}$' } | Select-Object -Unique)
      $earlyBlacklistCount = if ($null -ne $script:SymbolBlacklist) { $script:SymbolBlacklist.Count } else { 0 }
      $earlyRestQuotePayload = @{ quotes = @(); attempted = 0; fetched = 0; skipped = $true; rate_limited = $false }
      Write-QuoteFastHeartbeatStatus -SourceName $StatusSourceName -QuoteRows $earlyQuoteRows -PreopenRows @() -EligibleSymbols $earlyEligibleSymbols -SeededSymbols $seeded -BlacklistCount $earlyBlacklistCount -CollectorState $collectorState -Session $session -RestQuotePayload $earlyRestQuotePayload -FallbackAgeSeconds $age -QuotesFile $quotesFile -WebSocketStatus $wsStatus
    }
    $earlyShouldWritePreopenRows = Test-ShouldWritePreopenRows -Session $session
    [void](Sync-LatestQuoteCacheToPublicSlot -QuotesFile $quotesFile -Reason "before-rest-quote" -Session $session -ShouldWritePreopenRows $earlyShouldWritePreopenRows)
    $warmupSymbols = @(Get-WarmupSymbols)
    $preQuoteRows = @(Convert-QuotesToRows -Quotes $quotes -Payload $payload)
    $priorityGroups = Write-WebSocketPrioritySymbols -Symbols $warmupSymbols -QuoteRows $preQuoteRows -Reason "before-rest-quote"
    $priorityQuoteSymbols = @($priorityGroups.symbols)
    $restQuotePayload = @{ quotes = @(); attempted = 0; fetched = 0; skipped = $true; rate_limited = $false }
    $restBypassSymbolCount = [math]::Max(1, $priorityQuoteSymbols.Count)
    $restBypassCoverageFloor = if ($restBypassSymbolCount -ge 1000) { [int][math]::Ceiling([double]$restBypassSymbolCount * $RestQuoteBypassCoverageRatio) } else { [math]::Min(400, [math]::Max(1, [int]([double]$restBypassSymbolCount * 0.8))) }
    $quoteFullCoverageFloor = [math]::Min($restBypassSymbolCount, [math]::Max($RestQuoteBypassMinFreshQuotes, $restBypassCoverageFloor))
    $quoteFreshEnoughForRegular = ($quotes.Count -ge $quoteFullCoverageFloor -and $age -le $RestQuoteBypassMaxAgeSeconds)
    if ($quotes.Count -eq 0 -or -not $quoteFreshEnoughForRegular) {
      $restQuotePayload = Invoke-FugleStockQuoteBatch -Symbols $priorityQuoteSymbols -ApiKey $fugleApiKey
      $quotes = Merge-QuoteObjectsByCode -PrimaryQuotes $quotes -FallbackQuotes @($restQuotePayload.quotes)
    } else {
      Write-Log "rest_quote skipped daytrade_bypass quotes=$($quotes.Count) floor=$quoteFullCoverageFloor symbols=$restBypassSymbolCount age=${age}s max_age=${RestQuoteBypassMaxAgeSeconds}s"
    }

    $quoteRows = @(Convert-QuotesToRows -Quotes $quotes -Payload $payload)
    $quoteRows = @(Add-FreshQuoteReadthrough -QuoteRows $quoteRows -Reason "after-rest-quote")
    $preopenRows = Convert-QuotesToPreopenRows -Quotes $quotes -Payload $payload
    $shouldWritePreopenRows = Test-ShouldWritePreopenRows -Session $session
    if ($quoteRows.Count -gt 0) {
      Write-PublicSlotQuotesLive -Rows $quoteRows
      if ($shouldWritePreopenRows -and $preopenRows.Count -gt 0) {
        Write-PublicSlotPreopenSnapshot -Rows $preopenRows
        Write-PublicSlotPreopenSnapshotHistory -Rows $preopenRows
      }
      $blacklistCountForHeartbeat = if ($null -ne $script:SymbolBlacklist) { $script:SymbolBlacklist.Count } else { 0 }
      Write-QuoteFastHeartbeatStatus -SourceName $StatusSourceName -QuoteRows $quoteRows -PreopenRows $preopenRows -EligibleSymbols $warmupSymbols -SeededSymbols $seeded -BlacklistCount $blacklistCountForHeartbeat -CollectorState $collectorState -Session $session -RestQuotePayload $restQuotePayload -FallbackAgeSeconds $age -QuotesFile $quotesFile -WebSocketStatus $wsStatus
      Write-QuoteHeartbeatStatus -SourceName $StatusSourceName -QuoteRows $quoteRows -PreopenRows $preopenRows -EligibleSymbols $warmupSymbols -SeededSymbols $seeded -BlacklistCount $blacklistCountForHeartbeat -CollectorState $collectorState -Session $session -RestQuotePayload $restQuotePayload -FallbackAgeSeconds $age -QuotesFile $quotesFile -WebSocketStatus $wsStatus
    }
    $priorityGroups = Write-WebSocketPrioritySymbols -Symbols $warmupSymbols -QuoteRows $quoteRows -Reason "after-rest-quote"
    $priorityWarmupSymbols = @($priorityGroups.symbols)
    [void](Filter-SymbolsByQuoteLiquidity -Symbols $priorityWarmupSymbols -QuoteRows $quoteRows)
    Use-QuoteFlushResult -FlushResult (Sync-LatestQuoteCacheToPublicSlot -QuotesFile $quotesFile -Reason "before-quote-derived-1m" -Session $session -ShouldWritePreopenRows $shouldWritePreopenRows) -QuoteRows ([ref]$quoteRows) -PreopenRows ([ref]$preopenRows)
    $quoteRows = @(Add-FreshQuoteReadthrough -QuoteRows $quoteRows -Reason "before-quote-derived-1m")
    if ($quoteRows.Count -gt 0) {
      Write-QuoteHeartbeatStatus -SourceName $StatusSourceName -QuoteRows $quoteRows -PreopenRows $preopenRows -EligibleSymbols $warmupSymbols -SeededSymbols $seeded -BlacklistCount $blacklistCountForHeartbeat -CollectorState $collectorState -Session $session -RestQuotePayload $restQuotePayload -FallbackAgeSeconds $age -QuotesFile $quotesFile -WebSocketStatus $wsStatus
    }
    $minutePayload = Update-MinuteRows -QuoteRows $quoteRows -CandidateSymbols $priorityWarmupSymbols
    if ($minutePayload.minuteRows.Count -gt 0) { Write-PublicSlotIntraday1m -Rows $minutePayload.minuteRows }
    if ($minutePayload.dailyRows.Count -gt 0) { Write-PublicSlotDailyVolume -Rows $minutePayload.dailyRows }
    if ($quoteRows.Count -gt 0 -and ($session -eq "regular" -or $minutePayload.minuteRows.Count -gt 0)) {
      Write-QuoteHeartbeatStatus -SourceName $StatusSourceName -QuoteRows $quoteRows -PreopenRows $preopenRows -EligibleSymbols $warmupSymbols -SeededSymbols $seeded -BlacklistCount $blacklistCountForHeartbeat -CollectorState $collectorState -Session $session -RestQuotePayload $restQuotePayload -FallbackAgeSeconds $age -QuotesFile $quotesFile -WebSocketStatus $wsStatus -MinutePayload $minutePayload
    }
    $direct1mSymbols = @($priorityWarmupSymbols)
    Use-QuoteFlushResult -FlushResult (Sync-LatestQuoteCacheToPublicSlot -QuotesFile $quotesFile -Reason "before-direct-1m" -Session $session -ShouldWritePreopenRows $shouldWritePreopenRows) -QuoteRows ([ref]$quoteRows) -PreopenRows ([ref]$preopenRows)
    try {
      $earlyFutoptTickerPayload = Invoke-FugleFutoptTickers -ApiKey $fugleApiKey
      $earlyFutoptTickerRows = @(Convert-FugleFutoptTickersToRows -Payload $earlyFutoptTickerPayload)
      $earlyTxfFutureSymbols = @(Get-NearMonthTxfFutureSymbols -TickerRows $earlyFutoptTickerRows)
      $earlyTxfQuotePayload = Invoke-FugleTxfQuoteRows -FutureSymbols $earlyTxfFutureSymbols -TickerRows $earlyFutoptTickerRows -ApiKey $fugleApiKey
      if ($earlyTxfQuotePayload.rows.Count -gt 0) {
        Write-PublicSlotFutoptQuotesLive -Rows $earlyTxfQuotePayload.rows
      }
      Write-Log "fugle TXF early quote symbols=$($earlyTxfFutureSymbols.Count) fetched=$($earlyTxfQuotePayload.fetched) rows=$($earlyTxfQuotePayload.rows.Count) before_direct_1m=True"
    } catch {
      Write-Log "WARN fugle TXF early quote failed: $($_.Exception.Message)"
    }
    $direct1mPrewarmPayload = Invoke-Direct1mStartupPrewarm -Symbols $direct1mSymbols -ApiKey $fugleApiKey
    Use-QuoteFlushResult -FlushResult (Sync-LatestQuoteCacheToPublicSlot -QuotesFile $quotesFile -Reason "after-direct-1m-prewarm" -Session $session -ShouldWritePreopenRows $shouldWritePreopenRows) -QuoteRows ([ref]$quoteRows) -PreopenRows ([ref]$preopenRows)
    $quoteRows = @(Add-FreshQuoteReadthrough -QuoteRows $quoteRows -Reason "after-direct-1m-prewarm")
    if ($quoteRows.Count -gt 0) {
      Write-QuoteHeartbeatStatus -SourceName $StatusSourceName -QuoteRows $quoteRows -PreopenRows $preopenRows -EligibleSymbols $warmupSymbols -SeededSymbols $seeded -BlacklistCount $blacklistCountForHeartbeat -CollectorState $collectorState -Session $session -RestQuotePayload $restQuotePayload -FallbackAgeSeconds $age -QuotesFile $quotesFile -WebSocketStatus $wsStatus -MinutePayload $minutePayload
    }
    $direct1mPayload = Invoke-Direct1mWarmupBatch -Symbols $direct1mSymbols -ApiKey $fugleApiKey
    Use-QuoteFlushResult -FlushResult (Sync-LatestQuoteCacheToPublicSlot -QuotesFile $quotesFile -Reason "after-direct-1m-batch" -Session $session -ShouldWritePreopenRows $shouldWritePreopenRows) -QuoteRows ([ref]$quoteRows) -PreopenRows ([ref]$preopenRows)
    $quoteRows = @(Add-FreshQuoteReadthrough -QuoteRows $quoteRows -Reason "after-direct-1m-batch")
    if ($quoteRows.Count -gt 0) {
      Write-QuoteHeartbeatStatus -SourceName $StatusSourceName -QuoteRows $quoteRows -PreopenRows $preopenRows -EligibleSymbols $warmupSymbols -SeededSymbols $seeded -BlacklistCount $blacklistCountForHeartbeat -CollectorState $collectorState -Session $session -RestQuotePayload $restQuotePayload -FallbackAgeSeconds $age -QuotesFile $quotesFile -WebSocketStatus $wsStatus -MinutePayload $minutePayload
    }
    Use-QuoteFlushResult -FlushResult (Sync-LatestQuoteCacheToPublicSlot -QuotesFile $quotesFile -Reason "before-futopt" -Session $session -ShouldWritePreopenRows $shouldWritePreopenRows) -QuoteRows ([ref]$quoteRows) -PreopenRows ([ref]$preopenRows)
    $quoteRows = @(Add-FreshQuoteReadthrough -QuoteRows $quoteRows -Reason "before-futopt")
    if ($quoteRows.Count -gt 0) {
      Write-QuoteHeartbeatStatus -SourceName $StatusSourceName -QuoteRows $quoteRows -PreopenRows $preopenRows -EligibleSymbols $warmupSymbols -SeededSymbols $seeded -BlacklistCount $blacklistCountForHeartbeat -CollectorState $collectorState -Session $session -RestQuotePayload $restQuotePayload -FallbackAgeSeconds $age -QuotesFile $quotesFile -WebSocketStatus $wsStatus -MinutePayload $minutePayload
    }
    $txfPayload = Convert-TaifexToFutoptRows -Payload (Invoke-TaifexFuturesQuote -Cid "TXF") -Product "TXF"
    $fugleFutoptTickerPayload = Invoke-FugleFutoptTickers -ApiKey $fugleApiKey
    $fugleFutoptTickerRows = @(Convert-FugleFutoptTickersToRows -Payload $fugleFutoptTickerPayload)
    $nearTxfFutureSymbols = @(Get-NearMonthTxfFutureSymbols -TickerRows $fugleFutoptTickerRows)
    $fugleTxfQuotePayload = Invoke-FugleTxfQuoteRows -FutureSymbols $nearTxfFutureSymbols -TickerRows $fugleFutoptTickerRows -ApiKey $fugleApiKey
    $nearStockFutureSymbols = @(Get-NearMonthStockFutureSymbols -TickerRows $fugleFutoptTickerRows)
    $fugleFutoptQuotePayload = Invoke-FugleFutoptQuoteBatch -FutureSymbols $nearStockFutureSymbols -TickerRows $fugleFutoptTickerRows -ApiKey $fugleApiKey
    $combinedFutoptTickerRows = @($txfPayload.tickers) + @($fugleFutoptTickerRows)
    $combinedFutoptQuoteRows = @($txfPayload.quotes) + @($fugleTxfQuotePayload.rows) + @($fugleFutoptQuotePayload.rows)
    Use-QuoteFlushResult -FlushResult (Sync-LatestQuoteCacheToPublicSlot -QuotesFile $quotesFile -Reason "after-futopt" -Session $session -ShouldWritePreopenRows $shouldWritePreopenRows) -QuoteRows ([ref]$quoteRows) -PreopenRows ([ref]$preopenRows)
    $stockFutureTickerCount = @($fugleFutoptTickerRows | Where-Object { $_.product -eq "STOCK_FUTURE" }).Count
    $stockFutureMappedCount = @($fugleFutoptTickerRows | Where-Object { $_.product -eq "STOCK_FUTURE" -and -not [string]::IsNullOrWhiteSpace([string]$_.underlying_symbol) }).Count
    $futoptStockQuoteUniverse = $nearStockFutureSymbols.Count
    $futoptStockQuoteAttempted = [int]$fugleFutoptQuotePayload.attempted
    $futoptStockQuoteFetched = [int]$fugleFutoptQuotePayload.fetched
    $futoptStockQuoteComplete = if ($FutoptQuoteFullDetect) {
      ($futoptStockQuoteUniverse -eq 0 -or ($futoptStockQuoteAttempted -ge $futoptStockQuoteUniverse -and -not [bool]$fugleFutoptQuotePayload.rate_limited))
    } else {
      ($futoptStockQuoteFetched -gt 0)
    }
    $futoptStockQuoteCoverage = if ($futoptStockQuoteUniverse -gt 0) { [math]::Round($futoptStockQuoteFetched / [math]::Max(1, $futoptStockQuoteUniverse), 4) } else { 1 }
    $shouldWriteFutoptTickers = $false
    if ($combinedFutoptTickerRows.Count -gt 0) {
      $shouldWriteFutoptTickers = ($null -eq $fugleFutoptTickerPayload -or -not [bool]$fugleFutoptTickerPayload.public_slot_from_cache)
      if ($txfPayload.tickers.Count -gt 0) { $shouldWriteFutoptTickers = $true }
    }

    $quoteRows = @(Add-FreshQuoteReadthrough -QuoteRows $quoteRows -Reason "before-final-write")
    if ($quoteRows.Count -gt 0) { Write-PublicSlotQuotesLive -Rows $quoteRows }
    $direct1mRows = @($direct1mPrewarmPayload.rows) + @($direct1mPayload.rows)
    $direct1mDailyRows = @(Convert-IntradayRowsToDailyVolumeRows -Rows $direct1mRows)
    $direct1mOhlcvRows = @(Convert-IntradayRowsToDailyOhlcvRows -Rows $direct1mRows)
    if ($direct1mRows.Count -gt 0) { Write-PublicSlotIntraday1m -Rows $direct1mRows }
    if ($direct1mDailyRows.Count -gt 0) { Write-PublicSlotDailyVolume -Rows $direct1mDailyRows }
    if ($direct1mOhlcvRows.Count -gt 0) { Write-PublicSlotDailyOhlcv -Rows $direct1mOhlcvRows }
    if ($shouldWritePreopenRows -and $preopenRows.Count -gt 0) { Write-PublicSlotPreopenSnapshot -Rows $preopenRows }
    if ($shouldWritePreopenRows -and $preopenRows.Count -gt 0) { Write-PublicSlotPreopenSnapshotHistory -Rows $preopenRows }
    if ($combinedFutoptQuoteRows.Count -gt 0) { Write-PublicSlotFutoptQuotesLive -Rows $combinedFutoptQuoteRows }
    if ($shouldWriteFutoptTickers) { Write-PublicSlotFutoptTickers -Rows $combinedFutoptTickerRows }
    if ($session -in @("closed", "afterhours") -and ((Get-Date) - $lastMaintenanceAt).TotalMinutes -ge 30) {
      $deletedDaily = Invoke-PublicSlotRpc -FunctionName "cleanup_fugle_daily_volume" -Body @{ retain_trade_days = $DailyVolumeRetainTradeDays }
      $deleted1m = Invoke-PublicSlotRpc -FunctionName "cleanup_fugle_intraday_1m" -Body @{ retain_trade_days = 5 }
      Write-Log "maintenance daily_volume_deleted=$deletedDaily intraday_1m_deleted=$deleted1m"
      $lastMaintenanceAt = Get-Date
    }
    if (((Get-Date) - $lastStockTickerWriteAt).TotalMinutes -ge 30) {
      $stockTickerRows = Convert-StocksSlimToTickerRows
      if ($stockTickerRows.Count -gt 0) {
        Write-PublicSlotStockTickers -Rows $stockTickerRows
        $lastStockTickerWriteAt = Get-Date
      }
    }

    $latestQuotePayload = Read-JsonFile -Path $quotesFile -Default ([pscustomobject]@{})
    $latestQuoteObjects = @($latestQuotePayload.quotes)
    $latestQuoteRows = @(Convert-QuotesToRows -Quotes $latestQuoteObjects -Payload $latestQuotePayload)
    if ($latestQuoteRows.Count -gt 0) {
      $quoteRows = @(Merge-QuoteRowsBySymbol -PrimaryRows $latestQuoteRows -FallbackRows $quoteRows)
      $quoteRows = @(Add-FreshQuoteReadthrough -QuoteRows $quoteRows -Reason "final-status-readthrough")
      $preopenRows = @(Convert-QuotesToPreopenRows -Quotes $latestQuoteObjects -Payload $latestQuotePayload)
      Write-PublicSlotQuotesLive -Rows $quoteRows
      if ($shouldWritePreopenRows -and $preopenRows.Count -gt 0) { Write-PublicSlotPreopenSnapshot -Rows $preopenRows }
      if ($shouldWritePreopenRows -and $preopenRows.Count -gt 0) { Write-PublicSlotPreopenSnapshotHistory -Rows $preopenRows }
    }

    $lastQuoteAt = Get-LatestIsoUtc -Rows $quoteRows -PropertyName "updated_at"
    $combined1mRows = @($minutePayload.minuteRows) + @($direct1mRows)
    $last1mAt = Get-LatestIsoUtc -Rows $combined1mRows -PropertyName "candle_time"
    $quoteAgeSeconds = Get-IsoAgeSeconds -IsoTime $lastQuoteAt -FallbackSeconds $age
    $intradayStats = Get-Intraday1mCoverageStats -FallbackRows $combined1mRows -Symbols $priorityWarmupSymbols
    $intraday1mSelfHeal = Invoke-Intraday1mSelfHeal -Session $session -QuoteRows $quoteRows -CandidateSymbols $priorityWarmupSymbols -IntradayStats $intradayStats
    $intraday1mSelfHealSummary = $intraday1mSelfHeal.summary
    $intraday1mSelfHealRows = @($intraday1mSelfHeal.rows)
    if ($intraday1mSelfHealRows.Count -gt 0) {
      $combined1mRows = @($combined1mRows) + @($intraday1mSelfHealRows)
      $last1mAt = Get-LatestIsoUtc -Rows $combined1mRows -PropertyName "candle_time"
      $intradayStats = Get-Intraday1mCoverageStats -FallbackRows $combined1mRows -Symbols $priorityWarmupSymbols
      $intradayStats = Merge-IntradayStatsWithFallbackRows -Stats $intradayStats -FallbackRows $combined1mRows -SourceSuffix "self_heal_current_batch"
    }
    $blacklistCount = if ($null -ne $script:SymbolBlacklist) { $script:SymbolBlacklist.Count } else { 0 }
    $rawSymbols = $seeded + $blacklistCount
    $cumulativeBidAskRows = @($quoteRows | Where-Object { $null -ne $_.cumulative_bid_ask_volume }).Count
    $eligibleQuoteCoverage = Get-EligibleQuoteCoverage -QuoteRows $quoteRows -EligibleSymbols $priorityWarmupSymbols
    $script:ApiUniverseStats.eligible_quote_rows = $eligibleQuoteCoverage.eligible_quote_rows
    $script:ApiUniverseStats.eligible_quote_coverage = $eligibleQuoteCoverage.eligible_quote_coverage
    $eligibleQuoteFloor = if ($eligibleQuoteCoverage.eligible_symbols -ge 1000) { [int][math]::Ceiling([double]$eligibleQuoteCoverage.eligible_symbols * 0.9) } else { [math]::Min(400, [math]::Max(1, [int]([double]$eligibleQuoteCoverage.eligible_symbols * 0.8))) }
    $quotesOk = ($eligibleQuoteCoverage.eligible_quote_rows -ge $eligibleQuoteFloor -and $quoteAgeSeconds -le $StaleSeconds)
    $dailyVolumeOk = ($script:ApiUniverseStats.avg_volume5_eligible -gt 0)
    $futoptOk = ($combinedFutoptQuoteRows.Count -gt 0 -and $futoptStockQuoteComplete)
    $preopenOk = ($preopenRows.Count -gt 0)
    $preopenHistoryOk = ($preopenRows.Count -gt 0)
    if ($session -eq "preopen") {
      $intraday1mOk = (($intradayStats.intraday_1m_rows_today -gt 0) -or ($direct1mRows.Count -gt 0))
      $intraday1mFreshOk = [bool]$intraday1mOk
      $intraday1mMa20Required = $false
      $intraday1mMa35Required = $false
    } else {
      $intraday1mFreshOk = ($intradayStats.intraday_1m_rows_today -gt 0 -and $intradayStats.intraday_1m_stale_seconds -le $Intraday1mFreshHardSeconds)
      $intraday1mMa20Required = (Test-Intraday1mMa20Required)
      $intraday1mMa35Required = (Test-Intraday1mMa35Required)
      $intraday1mOk = ($intraday1mFreshOk -and (-not $intraday1mMa20Required -or $intradayStats.ready_ma20_continuous -gt 0) -and (-not $intraday1mMa35Required -or $intradayStats.ready_ma35_continuous -gt 0))
    }
    $permissionProbe = Get-PublicSlotPermissionProbe
    $permissionOk = [bool]$permissionProbe.ok
    $script:ApiUniverseStats.quotes_ok = [bool]$quotesOk
    $script:ApiUniverseStats.intraday_1m_ok = [bool]$intraday1mOk
    $script:ApiUniverseStats.daily_volume_ok = [bool]$dailyVolumeOk
    $degradedButUsableForIntraday = ((-not $quotesOk) -and $intraday1mOk -and $dailyVolumeOk -and $quoteAgeSeconds -le $StaleSeconds -and $eligibleQuoteCoverage.eligible_quote_rows -gt 0)
    $sourceCoreOk = ($permissionOk -and $quotesOk -and $dailyVolumeOk -and ($session -ne "regular" -or $intraday1mOk))
    $scannerCanRunQuoteOnly = ($permissionOk -and $quotesOk)
    $scannerCanRunOpening = ($scannerCanRunQuoteOnly -and $dailyVolumeOk)
    $intradayFreshRequiredForScanner = ($session -eq "regular")
    $scannerCanRunMa20 = ($scannerCanRunOpening -and (-not $intradayFreshRequiredForScanner -or $intraday1mFreshOk) -and $intradayStats.ready_ma20_continuous -gt 0)
    $scannerCanRunMa35 = ($scannerCanRunOpening -and (-not $intradayFreshRequiredForScanner -or $intraday1mFreshOk) -and $intradayStats.ready_ma35_continuous -gt 0)
    $scannerCanRunFullIntraday = ($scannerCanRunMa35 -and $intradayStats.ready_ge_80 -gt 0)
    $scannerBlockReason = Get-ScannerBlockReason -PermissionOk $permissionOk -QuotesOk $quotesOk -DailyVolumeOk $dailyVolumeOk -Intraday1mFreshOk $intraday1mFreshOk -Ma20Required $intraday1mMa20Required -Ma35Required $intraday1mMa35Required -ReadyMa20ContinuousSymbols $intradayStats.ready_ma20_continuous -ReadyMa35ContinuousSymbols $intradayStats.ready_ma35_continuous -QuoteAgeSeconds $quoteAgeSeconds -Session $session
    $status = if ($sourceCoreOk) { "ok" } elseif ($permissionOk -and ($quotesOk -or $degradedButUsableForIntraday)) { "degraded" } else { "stale" }
    $quoteStatus = Get-SourcePartStatus -Ok $quotesOk
    $permissionStatus = Get-SourcePartStatus -Ok $permissionOk
    $preopenStatus = Get-SourcePartStatus -Ok $preopenOk -Required:($session -eq "preopen")
    $intraday1mStatus = Get-SourcePartStatus -Ok $intraday1mOk -Required:($session -eq "regular")
    $dailyVolumeStatus = Get-SourcePartStatus -Ok $dailyVolumeOk
    $latestCandleTimeTaipei = Convert-IsoUtcToTaipei -IsoTime $intradayStats.intraday_1m_latest_candle_time
    $dailyVolumeRowsWritten = ($minutePayload.dailyRows.Count + $direct1mDailyRows.Count + $intraday1mSelfHealSummary.daily_rows_written)
    $strategy2RunEvidence = Get-Strategy2LatestRunEvidence
    $message = "writer=running; collector=$collectorState; raw_symbols=$rawSymbols; active_symbols=$seeded; blacklist_count=$blacklistCount; avg_volume5_min=$MinAvgVolume5Lots; avg_volume5_eligible=$($script:ApiUniverseStats.avg_volume5_eligible); avg_volume5_filtered=$($script:ApiUniverseStats.avg_volume5_filtered); daytrade_hot_symbols=$($script:ApiUniverseStats.daytrade_hot_symbols); terminal_priority_symbols=$($script:ApiUniverseStats.terminal_priority_symbols); priority_symbols=$($script:ApiUniverseStats.priority_symbols); priority_strong_symbols=$($script:ApiUniverseStats.priority_strong_symbols); eligible_quote_rows=$($eligibleQuoteCoverage.eligible_quote_rows); eligible_quote_coverage=$($eligibleQuoteCoverage.eligible_quote_coverage); quote_coverage_ratio=$($eligibleQuoteCoverage.eligible_quote_coverage); source_core_ok=$sourceCoreOk; permission_ok=$permissionOk; quotes_ok=$quotesOk; intraday_1m_ok=$intraday1mOk; intraday_1m_fresh_ok=$intraday1mFreshOk; intraday_1m_fresh_target_seconds=$Intraday1mFreshTargetSeconds; intraday_1m_fresh_hard_seconds=$Intraday1mFreshHardSeconds; intraday_1m_self_heal_enabled=$Intraday1mSelfHealEnabled; intraday_1m_self_heal_triggered=$($intraday1mSelfHealSummary.triggered); intraday_1m_self_heal_reason=$($intraday1mSelfHealSummary.reason); intraday_1m_self_heal_rows=$($intraday1mSelfHealSummary.rows_written); intraday_1m_ma20_required=$intraday1mMa20Required; intraday_1m_ma35_required=$intraday1mMa35Required; daily_volume_ok=$dailyVolumeOk; scanner_block_reason=$scannerBlockReason; futopt_ok=$futoptOk; preopen_ok=$preopenOk; preopen_history_ok=$preopenHistoryOk; degraded_but_usable_for_intraday=$degradedButUsableForIntraday; today_candle_count=$($intradayStats.today_candle_count); warmup_candle_count=$($intradayStats.warmup_candle_count); continuous_candle_count=$($intradayStats.continuous_candle_count); ready_ma20_continuous=$($intradayStats.ready_ma20_continuous); ready_ma35_continuous=$($intradayStats.ready_ma35_continuous); ready_macd_continuous=$($intradayStats.ready_macd_continuous); ready_ge_80=$($intradayStats.ready_ge_80); ready_ge_200=$($intradayStats.ready_ge_200); cumulative_bid_ask_min=$MinCumulativeBidAskLots; quote_liquidity_eligible=$($script:ApiUniverseStats.quote_liquidity_eligible); quote_liquidity_filtered=$($script:ApiUniverseStats.quote_liquidity_filtered); quotes=$($quoteRows.Count); quote_age_seconds=$quoteAgeSeconds; last_quote_at=$lastQuoteAt; rest_quote_attempted=$($restQuotePayload.attempted); rest_quote_rows=$($restQuotePayload.quotes.Count); rest_quote_fetched_symbols=$($restQuotePayload.fetched); preopen=$($preopenRows.Count); preopen_history_attempted=$($preopenRows.Count); futopt=$($combinedFutoptQuoteRows.Count); futopt_tickers=$($combinedFutoptTickerRows.Count); futopt_txf_symbols=$($nearTxfFutureSymbols.Count); futopt_txf_quotes_this_loop=$($fugleTxfQuotePayload.rows.Count); futopt_stock_tickers=$stockFutureTickerCount; futopt_stock_mapped=$stockFutureMappedCount; futopt_stock_quote_universe=$futoptStockQuoteUniverse; futopt_stock_quote_attempted=$futoptStockQuoteAttempted; futopt_stock_quote_fetched=$futoptStockQuoteFetched; futopt_stock_quote_complete=$futoptStockQuoteComplete; futopt_stock_quote_coverage=$futoptStockQuoteCoverage; futopt_stock_quotes_this_loop=$($fugleFutoptQuotePayload.rows.Count); futopt_scope=TXF_and_full_stock_futures; intraday_1m_symbols_today=$($intradayStats.intraday_1m_symbols_today); intraday_1m_rows_today=$($intradayStats.intraday_1m_rows_today); intraday_1m_stale_seconds=$($intradayStats.intraday_1m_stale_seconds); latest_candle_time=$($intradayStats.intraday_1m_latest_candle_time); quote_derived_1m_candidates=$($minutePayload.candidateSymbols); quote_derived_1m_full_universe=$($minutePayload.fullUniverse); quote_derived_1m_rows=$($minutePayload.quoteDerivedRows); quote_derived_1m_current_rows=$($minutePayload.quoteDerivedCurrentRows); quote_derived_1m_opening_backfill_rows=$($minutePayload.openingBackfillRows); quote_derived_1m_opening_backfill_symbols=$($minutePayload.openingBackfillSymbols); quote_derived_1m_current_minute=$($minutePayload.currentMinute); daily_volume_rows=$($minutePayload.dailyRows.Count + $direct1mDailyRows.Count + $intraday1mSelfHealSummary.daily_rows_written); direct_1m_daily_rows=$($direct1mDailyRows.Count); daily_ohlcv_rows=$($direct1mOhlcvRows.Count); cumulative_bid_ask_rows=$cumulativeBidAskRows; direct_1m_prewarm_target=$($direct1mPrewarmPayload.target_symbols); direct_1m_prewarm_completed=$($direct1mPrewarmPayload.completed_symbols); direct_1m_prewarm_complete=$($direct1mPrewarmPayload.complete); direct_1m_prewarm_rows=$($direct1mPrewarmPayload.rows.Count); direct_1m_attempted=$($direct1mPayload.attempted); direct_1m_rows=$($direct1mRows.Count)"
    $sourceStatusPayload = @{
      source_contract_version = $SourceContractVersion
      writer_version = $WriterVersion
      writer_computer = $env:COMPUTERNAME
      writer_owner_computer = $WriterOwnerComputer
      build_id = if ($env:FUMAN_BUILD_ID) { $env:FUMAN_BUILD_ID } elseif ($env:VERCEL_GIT_COMMIT_SHA) { $env:VERCEL_GIT_COMMIT_SHA } else { "local" }
      writer_pid = $PID
      latest_run_id = $strategy2RunEvidence.latest_run_id
      latestRunId = $strategy2RunEvidence.latestRunId
      strategy2_latest_run_id = $strategy2RunEvidence.strategy2_latest_run_id
      strategy2_latest_run_id_source = $strategy2RunEvidence.strategy2_latest_run_id_source
      strategy2_latest_scan_date = $strategy2RunEvidence.strategy2_latest_scan_date
      strategy2_latest_finished_at = $strategy2RunEvidence.strategy2_latest_finished_at
      strategy2_readiness_status = $strategy2RunEvidence.strategy2_readiness_status
      strategy2_readiness_reason = $strategy2RunEvidence.strategy2_readiness_reason
      strategy2_readiness_checked_at = $strategy2RunEvidence.strategy2_readiness_checked_at
      quote_status = $quoteStatus
      permission_status = $permissionStatus
      preopen_status = $preopenStatus
      intraday_1m_status = $intraday1mStatus
      daily_volume_status = $dailyVolumeStatus
      raw_symbols = $rawSymbols
      active_symbols = $seeded
      blacklist_count = $blacklistCount
      mother_pool_source = $script:ApiUniverseStats.mother_pool_source
      mother_pool_symbols = $script:ApiUniverseStats.mother_pool_symbols
      mother_pool_filtered = $script:ApiUniverseStats.mother_pool_filtered
      avg_volume5_min = $MinAvgVolume5Lots
      avg_volume5_eligible = $script:ApiUniverseStats.avg_volume5_eligible
      avg_volume5_filtered = $script:ApiUniverseStats.avg_volume5_filtered
      daytrade_hot_symbols = $script:ApiUniverseStats.daytrade_hot_symbols
      priority_symbols = $script:ApiUniverseStats.priority_symbols
      priority_strong_symbols = $script:ApiUniverseStats.priority_strong_symbols
      strategy_priority_symbols = $script:ApiUniverseStats.strategy_priority_symbols
      terminal_priority_symbols = $script:ApiUniverseStats.terminal_priority_symbols
      three_day_open_high_fade_symbols = $script:ApiUniverseStats.three_day_open_high_fade_symbols
      opening_priority_symbols = $script:ApiUniverseStats.opening_priority_symbols
      dynamic_amplitude_bull_symbols = $script:ApiUniverseStats.dynamic_amplitude_bull_symbols
      dynamic_volume_surge_symbols = $script:ApiUniverseStats.dynamic_volume_surge_symbols
      dynamic_mother_pool_symbols = $script:ApiUniverseStats.dynamic_mother_pool_symbols
      priority_policy = "terminal-wide priority first: strategy1/2/3/4/5, institution, warrant underlying, CB, realtime radar; then 3-day open-high-fade, dynamic bull/volume, hot/strong, then full mother pool"
      collector_priority_symbols = [int](Get-PayloadFieldValue -Payload $wsStatus -Key "prioritySymbols" -Default 0)
      collector_priority_attempted = [int](Get-PayloadFieldValue -Payload $wsStatus -Key "priorityAttempted" -Default 0)
      collector_priority_fresh_count = [int](Get-PayloadFieldValue -Payload $wsStatus -Key "priorityFreshCount" -Default 0)
      collector_priority_terminal_symbols = [int](Get-PayloadFieldValue -Payload $wsStatus -Key "priorityTerminalSymbols" -Default 0)
      collector_priority_opening_symbols = [int](Get-PayloadFieldValue -Payload $wsStatus -Key "priorityOpeningSymbols" -Default 0)
      collector_priority_strategy1_symbols = [int](Get-PayloadFieldValue -Payload $wsStatus -Key "priorityStrategy1Symbols" -Default 0)
      collector_priority_strategy2_symbols = [int](Get-PayloadFieldValue -Payload $wsStatus -Key "priorityStrategy2Symbols" -Default 0)
      collector_priority_strategy3_symbols = [int](Get-PayloadFieldValue -Payload $wsStatus -Key "priorityStrategy3Symbols" -Default 0)
      collector_priority_strategy4_symbols = [int](Get-PayloadFieldValue -Payload $wsStatus -Key "priorityStrategy4Symbols" -Default 0)
      collector_priority_strategy5_symbols = [int](Get-PayloadFieldValue -Payload $wsStatus -Key "priorityStrategy5Symbols" -Default 0)
      collector_priority_institution_symbols = [int](Get-PayloadFieldValue -Payload $wsStatus -Key "priorityInstitutionSymbols" -Default 0)
      collector_priority_warrant_symbols = [int](Get-PayloadFieldValue -Payload $wsStatus -Key "priorityWarrantSymbols" -Default 0)
      collector_priority_cb_symbols = [int](Get-PayloadFieldValue -Payload $wsStatus -Key "priorityCbSymbols" -Default 0)
      collector_priority_realtime_radar_symbols = [int](Get-PayloadFieldValue -Payload $wsStatus -Key "priorityRealtimeRadarSymbols" -Default 0)
      collector_adaptive_rpm = [int](Get-PayloadFieldValue -Payload $wsStatus -Key "adaptiveRpm" -Default 0)
      collector_adaptive_delay_ms = [int](Get-PayloadFieldValue -Payload $wsStatus -Key "adaptiveDelayMs" -Default 0)
      collector_adaptive_rate_limited = [bool](Get-PayloadFieldValue -Payload $wsStatus -Key "adaptiveRateLimited" -Default $false)
      collector_adaptive_priority_only = [bool](Get-PayloadFieldValue -Payload $wsStatus -Key "adaptivePriorityOnly" -Default $false)
      collector_adaptive_priority_only_until = [string](Get-PayloadFieldValue -Payload $wsStatus -Key "adaptivePriorityOnlyUntil" -Default "")
      collector_adaptive_429_budget = [int](Get-PayloadFieldValue -Payload $wsStatus -Key "adaptive429Budget" -Default 0)
      collector_adaptive_429_window_count = [int](Get-PayloadFieldValue -Payload $wsStatus -Key "adaptive429WindowCount" -Default 0)
      collector_adaptive_429_budget_exceeded = [bool](Get-PayloadFieldValue -Payload $wsStatus -Key "adaptive429BudgetExceeded" -Default $false)
      collector_adaptive_consecutive_429_count = [int](Get-PayloadFieldValue -Payload $wsStatus -Key "adaptiveConsecutive429Count" -Default 0)
      collector_adaptive_last_429_cooldown_ms = [int](Get-PayloadFieldValue -Payload $wsStatus -Key "adaptiveLast429CooldownMs" -Default 0)
      eligible_quote_rows = $script:ApiUniverseStats.eligible_quote_rows
      eligible_quote_coverage = $script:ApiUniverseStats.eligible_quote_coverage
      source_core_ok = [bool]$sourceCoreOk
      permission_ok = [bool]$permissionOk
      quotes_ok = [bool]$quotesOk
      intraday_1m_ok = [bool]$intraday1mOk
      intraday_1m_fresh_ok = [bool]$intraday1mFreshOk
      intraday_1m_fresh_target_seconds = $Intraday1mFreshTargetSeconds
      intraday_1m_fresh_hard_seconds = $Intraday1mFreshHardSeconds
      intraday_1m_self_heal_enabled = [bool]$Intraday1mSelfHealEnabled
      intraday_1m_self_heal_triggered = [bool]$intraday1mSelfHealSummary.triggered
      intraday_1m_self_heal_reason = [string]$intraday1mSelfHealSummary.reason
      intraday_1m_self_heal_checked_at = [string]$intraday1mSelfHealSummary.checked_at
      intraday_1m_self_heal_threshold_seconds = [int]$intraday1mSelfHealSummary.threshold_seconds
      intraday_1m_self_heal_cooldown_seconds = [int]$intraday1mSelfHealSummary.cooldown_seconds
      intraday_1m_self_heal_stale_before = $intraday1mSelfHealSummary.stale_before
      intraday_1m_self_heal_stale_after = $intraday1mSelfHealSummary.stale_after
      intraday_1m_self_heal_rows = [int]$intraday1mSelfHealSummary.rows_written
      intraday_1m_self_heal_daily_rows = [int]$intraday1mSelfHealSummary.daily_rows_written
      intraday_1m_self_heal_current_minute = $intraday1mSelfHealSummary.current_minute
      intraday_1m_self_heal_candidate_symbols = [int]$intraday1mSelfHealSummary.candidate_symbols
      intraday_1m_self_heal_full_universe = [bool]$intraday1mSelfHealSummary.full_universe
      intraday_1m_ma20_required = [bool]$intraday1mMa20Required
      intraday_1m_ma35_required = [bool]$intraday1mMa35Required
      daily_volume_ok = [bool]$dailyVolumeOk
      futopt_ok = [bool]$futoptOk
      preopen_ok = [bool]$preopenOk
      preopen_history_ok = [bool]$preopenHistoryOk
      degraded_but_usable_for_intraday = [bool]$degradedButUsableForIntraday
      readback_ok = [bool]($quotesOk -or $intraday1mOk -or $dailyVolumeOk)
      source_parts = @{
        source_core_ok = [bool]$sourceCoreOk
        permission_ok = [bool]$permissionOk
        quotes_ok = [bool]$quotesOk
        intraday_1m_ok = [bool]$intraday1mOk
        intraday_1m_fresh_ok = [bool]$intraday1mFreshOk
        intraday_1m_fresh_target_seconds = $Intraday1mFreshTargetSeconds
        intraday_1m_fresh_hard_seconds = $Intraday1mFreshHardSeconds
        intraday_1m_self_heal_enabled = [bool]$Intraday1mSelfHealEnabled
        intraday_1m_self_heal_triggered = [bool]$intraday1mSelfHealSummary.triggered
        intraday_1m_self_heal_reason = [string]$intraday1mSelfHealSummary.reason
        intraday_1m_self_heal_rows = [int]$intraday1mSelfHealSummary.rows_written
        intraday_1m_ma20_required = [bool]$intraday1mMa20Required
        intraday_1m_ma35_required = [bool]$intraday1mMa35Required
        daily_volume_ok = [bool]$dailyVolumeOk
        futopt_ok = [bool]$futoptOk
        preopen_ok = [bool]$preopenOk
        preopen_history_ok = [bool]$preopenHistoryOk
        degraded_but_usable_for_intraday = [bool]$degradedButUsableForIntraday
        readback_ok = [bool]($quotesOk -or $intraday1mOk -or $dailyVolumeOk)
      }
      permission_failed_resources = @($permissionProbe.failed_resources)
      cumulative_bid_ask_min = $MinCumulativeBidAskLots
      quote_liquidity_eligible = $script:ApiUniverseStats.quote_liquidity_eligible
      quote_liquidity_filtered = $script:ApiUniverseStats.quote_liquidity_filtered
      quotes = $quoteRows.Count
      eligible_symbols = $seeded
      blacklist_symbols = $blacklistCount
      quote_count = $quoteRows.Count
      fresh_quote_readthrough_rows = [int]$script:FreshQuoteReadthroughRows
      fresh_quote_readthrough_merged_rows = [int]$script:FreshQuoteReadthroughMergedRows
      fresh_quote_readthrough_reason = [string]$script:FreshQuoteReadthroughReason
      quote_coverage_ratio = $script:ApiUniverseStats.eligible_quote_coverage
      symbols = $seeded
      intraday_1m_rows = $combined1mRows.Count
      intraday_1m_symbols_today = $intradayStats.intraday_1m_symbols_today
      intraday_1m_latest_candle_time = $intradayStats.intraday_1m_latest_candle_time
      latest_candle_time = $intradayStats.intraday_1m_latest_candle_time
      intraday_1m_rows_today = $intradayStats.intraday_1m_rows_today
      today_1m_rows = $intradayStats.intraday_1m_rows_today
      today_candle_count = $intradayStats.today_candle_count
      warmup_candle_count = $intradayStats.warmup_candle_count
      continuous_candle_count = $intradayStats.continuous_candle_count
      ready_ma20_continuous = $intradayStats.ready_ma20_continuous
      ready_ma35_continuous = $intradayStats.ready_ma35_continuous
      ready_macd_continuous = $intradayStats.ready_macd_continuous
      ready_ge_20 = $intradayStats.ready_ge_20
      ready_ge_35 = $intradayStats.ready_ge_35
      ready_ge_80 = $intradayStats.ready_ge_80
      ready_ge_200 = $intradayStats.ready_ge_200
      ready_ge_20_symbols = $intradayStats.ready_ge_20
      ready_ge_35_symbols = $intradayStats.ready_ge_35
      ready_ge_80_symbols = $intradayStats.ready_ge_80
      ready_ge_200_symbols = $intradayStats.ready_ge_200
      ready_ma20_continuous_symbols = $intradayStats.ready_ma20_continuous
      ready_ma35_continuous_symbols = $intradayStats.ready_ma35_continuous
      ready_macd_continuous_symbols = $intradayStats.ready_macd_continuous
      ready_ge_20_ratio = [math]::Round($intradayStats.ready_ge_20 / [math]::Max(1, $seeded), 4)
      ready_ge_35_ratio = [math]::Round($intradayStats.ready_ge_35 / [math]::Max(1, $seeded), 4)
      ready_ge_80_ratio = [math]::Round($intradayStats.ready_ge_80 / [math]::Max(1, $seeded), 4)
      ready_ge_200_ratio = [math]::Round($intradayStats.ready_ge_200 / [math]::Max(1, $seeded), 4)
      today_1m_symbols = $intradayStats.intraday_1m_symbols_today
      intraday_1m_stale_seconds = $intradayStats.intraday_1m_stale_seconds
      intraday_1m_stats_source = $intradayStats.intraday_1m_stats_source
      latest_candle_time_taipei = $latestCandleTimeTaipei
      fresh_quotes_120s = if ($quoteAgeSeconds -le 120) { $eligibleQuoteCoverage.eligible_quote_rows } else { 0 }
      fresh_quote_coverage_120s = if ($quoteAgeSeconds -le 120) { [math]::Round($eligibleQuoteCoverage.eligible_quote_rows / [math]::Max(1, $seeded), 4) } else { 0 }
      scanner_can_run_quote_only = [bool]$scannerCanRunQuoteOnly
      scanner_can_run_opening = [bool]$scannerCanRunOpening
      scanner_can_run_ma20 = [bool]$scannerCanRunMa20
      scanner_can_run_ma35 = [bool]$scannerCanRunMa35
      scanner_can_run_full_intraday = [bool]$scannerCanRunFullIntraday
      scanner_block_reason = $scannerBlockReason
      daily_volume_ready_symbols = $script:ApiUniverseStats.avg_volume5_eligible
      top_movers_ready20_count = $intradayStats.ready_ma20_continuous
      top_movers_ready35_count = $intradayStats.ready_ma35_continuous
      top_movers_1m_ready_count = $intradayStats.ready_ge_35
      top_movers_1m_ready80_count = $intradayStats.ready_ge_80
      top_movers_1m_universe_count = $seeded
      daily_volume_rows = $dailyVolumeRowsWritten
      daily_volume_avg_rows = $script:ApiUniverseStats.avg_volume5_eligible
      direct_1m_daily_rows = $direct1mDailyRows.Count
      daily_ohlcv_rows = $direct1mOhlcvRows.Count
      preopen_rows = $preopenRows.Count
      preopen = $preopenRows.Count
      preopen_history_attempted = $preopenRows.Count
      futopt = $combinedFutoptQuoteRows.Count
      futopt_quotes = $combinedFutoptQuoteRows.Count
      futopt_tickers = $combinedFutoptTickerRows.Count
      futopt_scope = "TXF_and_full_stock_futures"
      futopt_stock_futures_supported = ($stockFutureMappedCount -gt 0)
      futopt_stock_futures_message = "Stock futures tickers are loaded from Fugle futopt; full-detect mode attempts every near-month mapped stock future in each due run and fail-closes when coverage is incomplete or rate limited."
      futopt_stock_tickers = $stockFutureTickerCount
      futopt_stock_mapped = $stockFutureMappedCount
      futopt_stock_quote_universe = $futoptStockQuoteUniverse
      futopt_txf_symbols = $nearTxfFutureSymbols.Count
      futopt_txf_quote_attempted_this_loop = $fugleTxfQuotePayload.attempted
      futopt_txf_quote_fetched_this_loop = $fugleTxfQuotePayload.fetched
      futopt_txf_quotes_this_loop = $fugleTxfQuotePayload.rows.Count
      futopt_txf_quote_rate_limited = [bool]$fugleTxfQuotePayload.rate_limited
      futopt_stock_quotes_this_loop = $fugleFutoptQuotePayload.rows.Count
      futopt_stock_this_loop = $fugleFutoptQuotePayload.rows.Count
      txf_ok = (($txfPayload.quotes.Count + $fugleTxfQuotePayload.rows.Count) -gt 0)
      futopt_txf_ok = (($txfPayload.quotes.Count + $fugleTxfQuotePayload.rows.Count) -gt 0)
      mapped_underlying_count = $stockFutureMappedCount
      futopt_stock_quote_attempted_this_loop = $futoptStockQuoteAttempted
      futopt_stock_quote_fetched_this_loop = $futoptStockQuoteFetched
      futopt_stock_quote_complete = [bool]$futoptStockQuoteComplete
      futopt_stock_quote_coverage = $futoptStockQuoteCoverage
      futopt_quote_full_detect = [bool]$FutoptQuoteFullDetect
      futopt_quote_batch_size = if ($FutoptQuoteFullDetect) { $futoptStockQuoteUniverse } else { $FutoptQuoteBatchSize }
      futopt_quote_every_seconds = $FutoptQuoteEverySeconds
      futopt_quote_timeout_seconds = $FutoptQuoteTimeoutSeconds
      futopt_quote_time_budget_seconds = $FutoptQuoteTimeBudgetSeconds
      futopt_tickers_every_seconds = $FutoptTickersEverySeconds
      futopt_quote_rate_limited = [bool]$fugleFutoptQuotePayload.rate_limited
      last_quote_at = $lastQuoteAt
      last_1m_at = $last1mAt
      last_daily_volume_date = (Get-Date).ToString("yyyy-MM-dd")
      quote_age_seconds = $quoteAgeSeconds
      quote_cache_file_age_seconds = $age
      rest_quote_attempted = $restQuotePayload.attempted
      rest_quote_scanned_for_batch = if ($restQuotePayload.scanned_for_batch) { $restQuotePayload.scanned_for_batch } else { $restQuotePayload.attempted }
      rest_quote_rows = $restQuotePayload.quotes.Count
      rest_quote_fetched_symbols = $restQuotePayload.fetched
      rest_quote_unsupported_this_loop = if ($restQuotePayload.unsupported) { $restQuotePayload.unsupported } else { 0 }
      rest_quote_unsupported_symbols = if ($restQuotePayload.unsupported_symbols) { $restQuotePayload.unsupported_symbols } else { 0 }
      rest_quote_unsupported_trade_date = if ($restQuotePayload.unsupported_trade_date) { $restQuotePayload.unsupported_trade_date } else { (Get-Date).ToString("yyyy-MM-dd") }
      unsupported_trade_date = if ($restQuotePayload.unsupported_trade_date) { $restQuotePayload.unsupported_trade_date } else { (Get-Date).ToString("yyyy-MM-dd") }
      rest_quote_batch_size = $RestQuoteBatchSize
      rest_quote_effective_batch_size = if ($restQuotePayload.effective_batch_size) { $restQuotePayload.effective_batch_size } else { $RestQuoteBatchSize }
      rest_quote_every_seconds = $RestQuoteEverySeconds
      rest_quote_delay_milliseconds = $RestQuoteDelayMilliseconds
      rest_quote_effective_delay_milliseconds = if ($null -ne $restQuotePayload.effective_delay_milliseconds) { $restQuotePayload.effective_delay_milliseconds } else { $RestQuoteDelayMilliseconds }
      rest_quote_rate_limited = [bool]$restQuotePayload.rate_limited
      rest_quote_timeout_seconds = $RestQuoteTimeoutSeconds
      rest_quote_time_budget_seconds = $RestQuoteBatchTimeBudgetSeconds
      rest_quote_rate_limit_cooldown_seconds = $RestQuoteRateLimitCooldownSeconds
      rest_quote_cooldown_until = if ($restQuotePayload.cooldown_until) { $restQuotePayload.cooldown_until } else { "" }
      opening_boost_active = [bool](Test-OpeningBoostWindow)
      opening_boost_window = "$OpeningBoostStart-$OpeningBoostEnd"
      rest_quote_opening_boost_batch_size = $RestQuoteOpeningBoostBatchSize
      rest_quote_opening_boost_delay_milliseconds = $RestQuoteOpeningBoostDelayMilliseconds
      rest_quote_source = "fugle_stock_intraday_quote_when_websocket_empty_or_preopen"
      cumulative_bid_ask_available = ($cumulativeBidAskRows -gt 0)
      cumulative_bid_ask_rows = $cumulativeBidAskRows
      bid_volume_definition = "best bid level size from Fugle websocket, not confirmed cumulative intraday bid-side traded volume"
      ask_volume_definition = "best ask level size from Fugle websocket, not confirmed cumulative intraday ask-side traded volume"
      rate_limit_count = 0
      last_429_at = $null
      session = $session
      collector = $collectorState
      websocket_status = $wsStatus
      quotes_file = $quotesFile
      preopen_count = $preopenRows.Count
      futopt_quote_count = $combinedFutoptQuoteRows.Count
      seeded_symbols = $seeded
      quote_derived_1m_candidate_symbols = $minutePayload.candidateSymbols
      quote_derived_1m_candidate_limit = $QuoteDerived1mCandidateCount
      quote_derived_1m_full_universe = [bool]$minutePayload.fullUniverse
      quote_derived_1m_rows = $minutePayload.quoteDerivedRows
      quote_derived_1m_current_rows = $minutePayload.quoteDerivedCurrentRows
      quote_derived_1m_current_minute = $minutePayload.currentMinute
      quote_derived_1m_max_quote_age_seconds = $minutePayload.quoteDerivedMaxQuoteAgeSeconds
      quote_derived_1m_opening_backfill_minutes = $QuoteDerivedOpeningBackfillMinutes
      quote_derived_1m_opening_backfill_target_minutes = $minutePayload.openingBackfillTargetMinutes
      quote_derived_1m_opening_backfill_rows = $minutePayload.openingBackfillRows
      quote_derived_1m_opening_backfill_symbols = $minutePayload.openingBackfillSymbols
      quote_derived_1m_source = "quote_derived_1m"
      direct_1m_prewarm_enabled = [bool]$Direct1mPrewarmEnabled
      direct_1m_prewarm_start = $Direct1mPrewarmStart
      direct_1m_prewarm_bars_per_symbol = $direct1mPrewarmPayload.bars_per_symbol
      direct_1m_prewarm_target_symbols = $direct1mPrewarmPayload.target_symbols
      direct_1m_prewarm_completed_symbols = $direct1mPrewarmPayload.completed_symbols
      direct_1m_prewarm_remaining_symbols = $direct1mPrewarmPayload.remaining_symbols
      direct_1m_prewarm_attempted = $direct1mPrewarmPayload.attempted
      direct_1m_prewarm_fetched_symbols = $direct1mPrewarmPayload.fetched
      direct_1m_prewarm_rows = $direct1mPrewarmPayload.rows.Count
      direct_1m_prewarm_complete = [bool]$direct1mPrewarmPayload.complete
      direct_1m_prewarm_rate_limited = [bool]$direct1mPrewarmPayload.rate_limited
      direct_1m_prewarm_time_budget_seconds = $Direct1mPrewarmTimeBudgetSeconds
      direct_1m_intraday_timeout_seconds = $Direct1mIntradayTimeoutSeconds
      direct_1m_historical_timeout_seconds = $Direct1mHistoricalTimeoutSeconds
      direct_1m_batch_time_budget_seconds = $Direct1mBatchTimeBudgetSeconds
      direct_1m_attempted = $direct1mPayload.attempted
      direct_1m_fetched_symbols = $direct1mPayload.fetched
      direct_1m_rows = $direct1mRows.Count
      direct_1m_regular_rows = $direct1mPayload.rows.Count
      direct_1m_every_seconds = $Direct1mEverySeconds
      direct_1m_batch_size = $Direct1mBatchSize
      direct_1m_prewarm_batch_size = $Direct1mPrewarmBatchSize
      time_standard = "UTC"
      timestamp_columns = @("source_status.updated_at", "fugle_quotes_live.updated_at", "fugle_quotes_live.last_trade_time", "fugle_intraday_1m.candle_time", "fugle_intraday_1m.updated_at", "fugle_daily_volume.updated_at", "futopt_quotes_live.updated_at", "fugle_preopen_snapshot.updated_at")
      volume_unit = "lots"
      volume_columns = @("fugle_quotes_live.total_volume", "fugle_quotes_live.bid_volume", "fugle_quotes_live.ask_volume", "fugle_intraday_1m.volume", "fugle_daily_volume.volume", "futopt_quotes_live.total_volume", "fugle_preopen_snapshot.bid_volume", "fugle_preopen_snapshot.ask_volume")
      blacklist_policy = "central_shared_source"
      blacklist_rules = @("google_sheet", "00_prefix_etf", "cement", "defense")
      universe_source = "filtered_stocks_slim_and_blacklist"
      daily_volume_retain_trade_days = $DailyVolumeRetainTradeDays
      preopen_stale_after_session = $true
      futopt_scope_note = "TXF plus all near-month mapped Fugle stock futures in full-detect mode; incomplete stock futures quote coverage is a blocker, not a pass."
    }
    Write-PublicSlotSourceStatus -SourceName $StatusSourceName -Status $status -Message $message -StaleSeconds $quoteAgeSeconds -Payload $sourceStatusPayload
    Write-PublicSlotSourceCoverageSnapshot -SourceName $StatusSourceName -Status $status -Message $message -Payload $sourceStatusPayload
    $loadedDailySymbols = @($direct1mOhlcvRows | ForEach-Object {
      if ($_ -is [System.Collections.IDictionary]) { $_["symbol"] } else { $_.symbol }
    } | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } | Select-Object -Unique).Count
    $syncStatus = if ($session -eq "closed" -and $loadedDailySymbols -ge [math]::Max(1, [int]($seeded * 0.9))) { "complete" } elseif ($direct1mOhlcvRows.Count -gt 0) { "partial" } else { "running" }
    Write-PublicSlotDailySyncStatus -TradeDate (Get-Date).ToString("yyyy-MM-dd") -Source "fugle_shared_source" -Status $syncStatus -SymbolsExpected $seeded -SymbolsLoaded $loadedDailySymbols -MissingSymbolsCount ([math]::Max(0, $seeded - $loadedDailySymbols)) -Payload @{
      daily_ohlcv_rows_written_this_loop = $direct1mOhlcvRows.Count
      daily_volume_rows_written_this_loop = $direct1mDailyRows.Count
      direct_1m_prewarm_target_symbols = $direct1mPrewarmPayload.target_symbols
      direct_1m_prewarm_completed_symbols = $direct1mPrewarmPayload.completed_symbols
      direct_1m_prewarm_complete = [bool]$direct1mPrewarmPayload.complete
      direct_1m_prewarm_rows = $direct1mPrewarmPayload.rows.Count
      direct_1m_attempted = $direct1mPayload.attempted
      direct_1m_fetched_symbols = $direct1mPayload.fetched
      direct_1m_rows = $direct1mRows.Count
      direct_1m_regular_rows = $direct1mPayload.rows.Count
      session = $session
      note = "complete requires accumulated coverage across loops; this row is a per-loop progress heartbeat"
    }
    Write-PublicSlotMarketCalendar -Rows @([ordered]@{
      trade_date = (Get-Date).ToString("yyyy-MM-dd")
      market = "TW"
      is_open = ($session -in @("preopen", "regular"))
      session = $session
      note = "Updated by public slot shared source"
      payload = @{ source = "public-slot-shared-source" }
    })
    Use-QuoteFlushResult -FlushResult (Sync-LatestQuoteCacheToPublicSlot -QuotesFile $quotesFile -Reason "before-strategy2-ready-cache" -Session $session -ShouldWritePreopenRows $shouldWritePreopenRows) -QuoteRows ([ref]$quoteRows) -PreopenRows ([ref]$preopenRows)
    if ($Strategy2ReadyRefreshEnabled -and (Test-Strategy2ReadinessRefreshDue -LastRefreshAt $lastStrategy2ReadinessRefreshAt)) {
      $lastStrategy2ReadinessRefreshAt = Get-Date
      try {
      $strategy2ReadyPages = 0
      $strategy2ReadyProcessed = 0
      $strategy2ReadyTotalExpected = 0
      $strategy2ReadyNextOffset = 0
      $strategy2ReadyMaxPages = Get-Strategy2ReadyRefreshMaxPages
      $strategy2ReadyLast = $null
      $strategy2ReadyEffectivePageSize = Get-Strategy2ReadyEffectivePageSize
      $strategy2ReadyRpcOk = $false
      for ($readyPage = 0; $readyPage -lt $strategy2ReadyMaxPages; $readyPage++) {
        $strategy2ReadyLast = Invoke-PublicSlotRpc -FunctionName "refresh_strategy2_intraday_ready_cache" -Body (Get-Strategy2ReadyRefreshBody -ReadyPage $readyPage)
        if ($null -eq $strategy2ReadyLast) {
          $strategy2ReadyNextOffset = -1
          Write-Log "WARN strategy2 ready cache RPC returned null page=$readyPage; stopping refresh and preserving incomplete state"
          break
        }
        $strategy2ReadyRpcOk = $true
        $strategy2ReadyPages += 1
        $processedThisPage = [int](Get-Number $strategy2ReadyLast.processed)
        $strategy2ReadyProcessed += $processedThisPage
        $strategy2ReadyNextOffset = [int](Get-Number $strategy2ReadyLast.next_offset)
        $strategy2ReadyTotalExpected = [int](Get-Number $strategy2ReadyLast.total_expected)
        $reportedPageSize = [int](Get-Number $strategy2ReadyLast.page_size)
        if ($reportedPageSize -gt 0 -and $reportedPageSize -lt $strategy2ReadyEffectivePageSize) {
          Write-Log "WARN strategy2 ready cache RPC page_size=$reportedPageSize below requested=$strategy2ReadyEffectivePageSize"
        }
        if ($strategy2ReadyTotalExpected -gt 0) {
          $effectiveCycleSize = if ($reportedPageSize -gt 0) { $reportedPageSize } else { $strategy2ReadyEffectivePageSize }
          $effectiveCycleSize = [math]::Max(1, [int]$effectiveCycleSize)
          $expectedPages = [int][math]::Ceiling($strategy2ReadyTotalExpected / $effectiveCycleSize) + 2
          if ($expectedPages -gt $strategy2ReadyMaxPages) {
            $strategy2ReadyMaxPages = [math]::Min([math]::Max([int]$Strategy2ReadyMaxPages, $expectedPages), 240)
          }
        }
        if ($strategy2ReadyNextOffset -eq 0) { break }
      }
      if (-not $strategy2ReadyRpcOk) {
        Write-Log "WARN strategy2 ready cache partial refresh; strategy2 ready cache incomplete full-cycle rpc_failed pages=$strategy2ReadyPages/$strategy2ReadyMaxPages processed=$strategy2ReadyProcessed total_expected=$strategy2ReadyTotalExpected next_offset=$strategy2ReadyNextOffset page_size=$strategy2ReadyEffectivePageSize last=$strategy2ReadyLast"
      } elseif ($strategy2ReadyTotalExpected -le 0) {
        Write-Log "WARN strategy2 ready cache partial refresh; strategy2 ready cache incomplete full-cycle missing_total_expected pages=$strategy2ReadyPages/$strategy2ReadyMaxPages processed=$strategy2ReadyProcessed total_expected=$strategy2ReadyTotalExpected next_offset=$strategy2ReadyNextOffset page_size=$strategy2ReadyEffectivePageSize last=$strategy2ReadyLast"
      } elseif ($strategy2ReadyNextOffset -ne 0) {
        Write-Log "WARN strategy2 ready cache partial refresh; strategy2 ready cache incomplete full-cycle pages=$strategy2ReadyPages/$strategy2ReadyMaxPages processed=$strategy2ReadyProcessed total_expected=$strategy2ReadyTotalExpected next_offset=$strategy2ReadyNextOffset page_size=$strategy2ReadyEffectivePageSize last=$strategy2ReadyLast"
      } else {
        Write-Log "strategy2 ready cache full-cycle refreshed pages=$strategy2ReadyPages/$strategy2ReadyMaxPages processed=$strategy2ReadyProcessed total_expected=$strategy2ReadyTotalExpected next_offset=$strategy2ReadyNextOffset page_size=$strategy2ReadyEffectivePageSize last=$strategy2ReadyLast"
      }
    } catch {
      Write-Log "WARN strategy2 ready cache refresh skipped: $($_.Exception.Message)"
    }
      Use-QuoteFlushResult -FlushResult (Sync-LatestQuoteCacheToPublicSlot -QuotesFile $quotesFile -Reason "after-strategy2-intraday-ready-cache" -Session $session -ShouldWritePreopenRows $shouldWritePreopenRows) -QuoteRows ([ref]$quoteRows) -PreopenRows ([ref]$preopenRows)
      try {
        $strategy2PreopenGate = Invoke-PublicSlotRpc -FunctionName "refresh_strategy2_preopen_hot_gate_cache" -Body @{}
        Write-Log "strategy2 preopen hot gate cache refreshed $strategy2PreopenGate"
      } catch {
        Write-Log "WARN strategy2 preopen hot gate cache refresh skipped: $($_.Exception.Message)"
      }
      Use-QuoteFlushResult -FlushResult (Sync-LatestQuoteCacheToPublicSlot -QuotesFile $quotesFile -Reason "after-strategy2-preopen-cache" -Session $session -ShouldWritePreopenRows $shouldWritePreopenRows) -QuoteRows ([ref]$quoteRows) -PreopenRows ([ref]$preopenRows)
      try {
        $strategy2Readiness = Invoke-PublicSlotRpc -FunctionName "refresh_strategy2_readiness_cache" -Body @{}
        Write-Log "strategy2 readiness cache refreshed $strategy2Readiness"
      } catch {
        Write-Log "WARN strategy2 readiness cache refresh skipped: $($_.Exception.Message)"
      }
      Use-QuoteFlushResult -FlushResult (Sync-LatestQuoteCacheToPublicSlot -QuotesFile $quotesFile -Reason "after-strategy2-readiness-cache" -Session $session -ShouldWritePreopenRows $shouldWritePreopenRows) -QuoteRows ([ref]$quoteRows) -PreopenRows ([ref]$preopenRows)
    } elseif ($Strategy2ReadyRefreshEnabled) {
      Write-Log "strategy2 readiness cache refresh skipped by interval strategy2ReadyRefreshEvery=${Strategy2ReadyRefreshEverySeconds}s"
    } else {
      Write-Log "strategy2 readiness cache refresh disabled by config; main public slot shared source owns the retired dedicated task's coverage"
    }
    Write-Log "$status $message"
  } catch {
    $errorMessage = $_.Exception.Message
    Write-Log "ERROR $errorMessage"
    if ($_.ScriptStackTrace) { Write-Log "TRACE $($_.ScriptStackTrace)" }
    try {
      Write-PublicSlotSourceStatus -SourceName $StatusSourceName -Status "error" -Message $errorMessage -StaleSeconds 999999 -Payload @{ error = $errorMessage }
    } catch {}
  }

  if ($Once) { break }
  $elapsed = [int]((Get-Date) - $loopStarted).TotalSeconds
  Start-Sleep -Seconds ([math]::Max(1, $LoopSeconds - $elapsed))
} while ((Get-Date) -lt $stopTime)

if (-not $Once) {
  try {
    $stopPayload = [ordered]@{}
    try {
      $statusRows = @(Invoke-PublicSlotRestGet -PathAndQuery "source_status?source_name=eq.$StatusSourceName&select=payload&limit=1")
      if ($statusRows.Count -gt 0 -and $null -ne $statusRows[0].payload) {
        foreach ($prop in $statusRows[0].payload.PSObject.Properties) {
          $stopPayload[$prop.Name] = $prop.Value
        }
      }
    } catch {}
    $stopPayload["stopped_after"] = $StopAt
    $stopPayload["stopped_at"] = (Get-Date).ToUniversalTime().ToString("o")
    $stopPayload["readback_ok"] = $true
    $stopPayload["degraded_but_usable_for_intraday"] = $true
    if (-not $stopPayload.Contains("source_parts") -or $null -eq $stopPayload["source_parts"]) {
      $stopPayload["source_parts"] = @{}
    }
    try { $stopPayload["source_parts"].readback_ok = $true } catch {}
    try { $stopPayload["source_parts"].degraded_but_usable_for_intraday = $true } catch {}
    Write-PublicSlotSourceStatus -SourceName $StatusSourceName -Status "stopped" -Message "Stopped after $StopAt; readback_ok=True" -StaleSeconds 0 -Payload $stopPayload
  } catch {}
}
Write-Log "Public slot shared source stopped."
