param(
  [string]$FumanRoot = "C:\fuman-terminal",
  [string]$RuntimeDir = "C:\fuman-runtime",
  [switch]$Repair
)

$ErrorActionPreference = "Continue"

$LogDir = Join-Path $RuntimeDir "logs"
$LogFile = Join-Path $LogDir "public-slot-anti-rollback.log"
$ConfigPath = Join-Path $RuntimeDir "config\public-slot-shared-source.json"
$RunnerPath = Join-Path $FumanRoot "ops\public-slot\Run-PublicSlotSharedSource.ps1"
$HelperPath = Join-Path $FumanRoot "ops\public-slot\SupabasePublicSlotSource.ps1"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Write-GuardLog {
  param([string]$Message)
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Write-Host $line
  Add-Content -LiteralPath $LogFile -Value $line -Encoding utf8
}

function Read-Text {
  param([string]$Path)
  try {
    if (Test-Path -LiteralPath $Path) { return Get-Content -LiteralPath $Path -Raw -ErrorAction Stop }
  } catch {}
  return ""
}

function Write-DefaultRuntimeConfig {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ConfigPath) | Out-Null
  [ordered]@{
    loopSeconds = 3
    stopAt = "14:05"
    minAvgVolume5Lots = 0
    restQuoteBatchSize = 40
    restQuoteEverySeconds = 3
    restQuoteDelayMilliseconds = 75
    restQuoteTimeoutSeconds = 4
    restQuoteBatchTimeBudgetSeconds = 8
    restQuoteRateLimitCooldownSeconds = 60
    restQuoteBypassMinFreshQuotes = 1500
    restQuoteBypassCoverageRatio = 0.9
    restQuoteBypassMaxAgeSeconds = 90
    openingBoostStart = "08:45"
    openingBoostEnd = "13:30"
    restQuoteOpeningBoostBatchSize = 40
    restQuoteOpeningBoostDelayMilliseconds = 75
    fugleCollectorLoopMilliseconds = 1000
    fugleCollectorBatchSize = 120
    fugleCollectorConcurrency = 2
    fugleCollectorRequestDelayMilliseconds = 80
    fugleCollectorQuoteTtlMilliseconds = 120000
    fugleCollectorOpeningBoostBatchSize = 120
    fugleCollectorOpeningBoostConcurrency = 2
    fugleCollectorOpeningBoostDelayMilliseconds = 80
    fugleCollectorFinMindRecoveryEnabled = $true
    fugleCollectorFinMindRecoveryTimeoutMilliseconds = 30000
    direct1mBatchSize = 8
    direct1mEverySeconds = 20
    direct1mIntradayTimeoutSeconds = 6
    direct1mHistoricalTimeoutSeconds = 8
    direct1mBatchTimeBudgetSeconds = 20
    direct1mPrewarmEnabled = $true
    direct1mPrewarmStart = "07:00"
    direct1mPrewarmSymbolCount = 2000
    direct1mPrewarmBatchSize = 80
    direct1mPrewarmBars = 200
    direct1mPrewarmTimeBudgetSeconds = 45
    quoteDerived1mCandidateCount = 0
    quoteDerived1mMaxQuoteAgeSeconds = 120
    quoteDerivedOpeningBackfillMinutes = 6
    intraday1mFreshTargetSeconds = 60
    intraday1mFreshHardSeconds = 120
    futoptQuoteBatchSize = 120
    futoptQuoteEverySeconds = 20
    futoptQuoteDelayMilliseconds = 100
    futoptQuoteTimeoutSeconds = 5
    futoptQuoteTimeBudgetSeconds = 45
    futoptQuoteFullDetect = $true
    futoptTickersEverySeconds = 300
    publicSlotUpsertTimeoutSec = 45
    publicSlotUpsertBatchSize = 300
    writePreopenRows = $true
    writePreopenRowsMode = "preopen"
    strategy2ReadyRefreshEnabled = $true
    strategy2ReadyPageSize = 500
    writerOwnerComputer = ""
    readOnlyMonitor = $false
  } | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $ConfigPath -Encoding utf8
}

function Test-RepoRuntimeConfigSupport {
  $runner = Read-Text -Path $RunnerPath
  $helper = Read-Text -Path $HelperPath
  $missing = New-Object System.Collections.Generic.List[string]
  foreach ($marker in @(
    "Apply-PublicSlotRuntimeConfig",
    "public-slot-shared-source.json",
    "FUMAN_PUBLIC_SLOT_UPSERT_TIMEOUT_SEC",
    "Test-ShouldWritePreopenRows",
    "Get-Strategy2ReadyRefreshBody",
    "Test-Intraday1mMa20Required",
    "Test-Intraday1mMa35Required",
    "Invoke-Direct1mStartupPrewarm",
    "PreferHistorical",
    "Direct1mPrewarmBars",
    "direct_1m_prewarm_target_symbols",
    "direct_1m_prewarm_complete",
    "QuoteDerived1mCandidateCount",
    "QuoteDerivedOpeningBackfillMinutes",
    "Intraday1mFreshHardSeconds",
    "FugleCollectorBatchSize",
    "FUGLE_COLLECTOR_CONCURRENCY",
    "FUGLE_COLLECTOR_QUOTE_TTL_MS",
    "OpeningBoostStart",
    "OpeningBoostEnd",
    "RestQuoteOpeningBoostBatchSize",
    "RestQuoteBatchTimeBudgetSeconds",
    "RestQuoteRateLimitCooldownSeconds",
    "RestQuoteBypassMinFreshQuotes",
    "RestQuoteBypassCoverageRatio",
    "RestQuoteBypassMaxAgeSeconds",
    "FUGLE_COLLECTOR_OPENING_BOOST_BATCH_SIZE",
    "FUGLE_COLLECTOR_FINMIND_RECOVERY_ENABLED",
    "FugleCollectorFinMindRecoveryEnabled",
    "PrioritySymbolsFile",
    "fugle-ws-priority-symbols.json",
    "Get-StrategyPrioritySymbols",
    "Get-ThreeDayOpenHighFadeSymbols",
    "Get-DynamicAmplitudeBullSymbols",
    "Get-DynamicVolumeSurgeSymbols",
    "strategy_priority_symbols",
    "three_day_open_high_fade_symbols",
    "dynamic_amplitude_bull_symbols",
    "dynamic_volume_surge_symbols",
    "collector_adaptive_rpm",
    "collector_priority_symbols",
    "Add-FreshQuoteReadthrough",
    "Get-FreshPublicSlotQuoteRows",
    "Get-ActiveCommonStockSymbols",
    "stock_universe",
    "mother_pool_source",
    "quote_derived_1m_full_universe",
    "quote_derived_1m_current_minute",
    "quote_derived_1m_rows",
    "quote_derived_1m_opening_backfill_rows",
    "fresh_quote_coverage_120s",
    "volume_strategy_usable",
    "zero_volume_hold",
    "quoteFreshEnoughForRegular",
    "rest_quote_time_budget_seconds",
    "direct_1m_batch_time_budget_seconds",
    "futopt_quote_time_budget_seconds",
    "sourceCoreOk",
    "WriterOwnerComputer",
    "FUMAN_PUBLIC_SLOT_WRITER_OWNER_COMPUTER",
    "Assert-PublicSlotWriterOwner",
    "writer_owner_computer",
    "intraday_1m_ma35_required",
    "warmup_candle_count",
    "continuous_candle_count",
    "ready_ma20_continuous_symbols",
    "ready_ma35_continuous_symbols",
    "ready_macd_continuous_symbols",
    "fugle-source-contract-20260629-01",
    "public-slot-shared-source-20260629-01",
    "source_contract_version",
    "writer_version",
    "quote_status",
    "preopen_status",
    "intraday_1m_status",
    "daily_volume_status",
    "ready_ge_35_symbols",
    "latest_candle_time_taipei",
    "Write-PublicSlotSourceCoverageSnapshot"
  )) {
    if (-not $runner.Contains($marker)) { $missing.Add("runner:$marker") }
  }
  foreach ($marker in @(
    "FUMAN_PUBLIC_SLOT_UPSERT_TIMEOUT_SEC",
    "FUMAN_PUBLIC_SLOT_UPSERT_BATCH_SIZE",
    "safeBatchSize",
    "Write-PublicSlotSourceCoverageSnapshot",
    "fugle_source_coverage",
    "warmup_candle_count",
    "continuous_candle_count",
    "ready_ma20_continuous_symbols",
    "ready_ma35_continuous_symbols",
    "ready_ge_35_symbols",
    "latest_candle_time_taipei"
  )) {
    if (-not $helper.Contains($marker)) { $missing.Add("helper:$marker") }
  }
  return $missing.ToArray()
}

function Test-RuntimeConfig {
  if (-not (Test-Path -LiteralPath $ConfigPath)) { return @("missing:$ConfigPath") }
  try {
    $config = Get-Content -LiteralPath $ConfigPath -Raw -ErrorAction Stop | ConvertFrom-Json
  } catch {
    return @("invalid-json:$ConfigPath")
  }
  $missing = New-Object System.Collections.Generic.List[string]
  foreach ($name in @(
    "minAvgVolume5Lots",
    "restQuoteBatchSize",
    "restQuoteEverySeconds",
    "restQuoteDelayMilliseconds",
    "restQuoteTimeoutSeconds",
    "restQuoteBatchTimeBudgetSeconds",
    "restQuoteRateLimitCooldownSeconds",
    "restQuoteBypassMinFreshQuotes",
    "restQuoteBypassCoverageRatio",
    "restQuoteBypassMaxAgeSeconds",
    "openingBoostStart",
    "openingBoostEnd",
    "restQuoteOpeningBoostBatchSize",
    "restQuoteOpeningBoostDelayMilliseconds",
    "fugleCollectorLoopMilliseconds",
    "fugleCollectorBatchSize",
    "fugleCollectorConcurrency",
    "fugleCollectorRequestDelayMilliseconds",
    "fugleCollectorQuoteTtlMilliseconds",
    "fugleCollectorOpeningBoostBatchSize",
    "fugleCollectorOpeningBoostConcurrency",
    "fugleCollectorOpeningBoostDelayMilliseconds",
    "fugleCollectorFinMindRecoveryEnabled",
    "fugleCollectorFinMindRecoveryTimeoutMilliseconds",
    "direct1mBatchSize",
    "direct1mEverySeconds",
    "direct1mIntradayTimeoutSeconds",
    "direct1mHistoricalTimeoutSeconds",
    "direct1mBatchTimeBudgetSeconds",
    "direct1mPrewarmEnabled",
    "direct1mPrewarmStart",
    "direct1mPrewarmSymbolCount",
    "direct1mPrewarmBatchSize",
    "direct1mPrewarmBars",
    "direct1mPrewarmTimeBudgetSeconds",
    "quoteDerived1mCandidateCount",
    "quoteDerived1mMaxQuoteAgeSeconds",
    "quoteDerivedOpeningBackfillMinutes",
    "intraday1mFreshTargetSeconds",
    "intraday1mFreshHardSeconds",
    "futoptQuoteBatchSize",
    "futoptQuoteEverySeconds",
    "futoptQuoteDelayMilliseconds",
    "futoptQuoteTimeoutSeconds",
    "futoptQuoteTimeBudgetSeconds",
    "publicSlotUpsertTimeoutSec",
    "publicSlotUpsertBatchSize",
    "writePreopenRowsMode",
    "strategy2ReadyRefreshEnabled",
    "strategy2ReadyPageSize",
    "writerOwnerComputer",
    "readOnlyMonitor"
  )) {
    if ($null -eq $config.PSObject.Properties[$name]) { $missing.Add("config:$name") }
  }
  $expected = [ordered]@{
    loopSeconds = 3
    stopAt = "14:05"
    minAvgVolume5Lots = 0
    restQuoteBatchSize = 40
    restQuoteEverySeconds = 3
    restQuoteDelayMilliseconds = 75
    restQuoteTimeoutSeconds = 4
    restQuoteBatchTimeBudgetSeconds = 8
    restQuoteRateLimitCooldownSeconds = 60
    restQuoteBypassMinFreshQuotes = 1500
    restQuoteBypassCoverageRatio = 0.9
    restQuoteBypassMaxAgeSeconds = 90
    openingBoostStart = "08:45"
    openingBoostEnd = "13:30"
    restQuoteOpeningBoostBatchSize = 40
    restQuoteOpeningBoostDelayMilliseconds = 75
    fugleCollectorLoopMilliseconds = 1000
    fugleCollectorBatchSize = 120
    fugleCollectorConcurrency = 2
    fugleCollectorRequestDelayMilliseconds = 80
    fugleCollectorQuoteTtlMilliseconds = 120000
    fugleCollectorOpeningBoostBatchSize = 120
    fugleCollectorOpeningBoostConcurrency = 2
    fugleCollectorOpeningBoostDelayMilliseconds = 80
    fugleCollectorFinMindRecoveryEnabled = $true
    fugleCollectorFinMindRecoveryTimeoutMilliseconds = 30000
    direct1mBatchSize = 8
    direct1mEverySeconds = 20
    direct1mIntradayTimeoutSeconds = 6
    direct1mHistoricalTimeoutSeconds = 8
    direct1mBatchTimeBudgetSeconds = 8
    direct1mPrewarmEnabled = $true
    direct1mPrewarmStart = "07:00"
    direct1mPrewarmSymbolCount = 2000
    direct1mPrewarmBatchSize = 80
    direct1mPrewarmBars = 200
    direct1mPrewarmTimeBudgetSeconds = 10
    quoteDerived1mCandidateCount = 0
    quoteDerived1mMaxQuoteAgeSeconds = 120
    quoteDerivedOpeningBackfillMinutes = 6
    intraday1mFreshTargetSeconds = 60
    intraday1mFreshHardSeconds = 120
    futoptQuoteBatchSize = 120
    futoptQuoteEverySeconds = 20
    futoptQuoteDelayMilliseconds = 100
    futoptQuoteTimeoutSeconds = 5
    futoptQuoteTimeBudgetSeconds = 15
    futoptQuoteFullDetect = $true
    futoptTickersEverySeconds = 300
    publicSlotUpsertTimeoutSec = 45
    publicSlotUpsertBatchSize = 300
    writePreopenRowsMode = "preopen"
    strategy2ReadyRefreshEnabled = $true
    strategy2ReadyPageSize = 500
  }
  foreach ($name in $expected.Keys) {
    $prop = $config.PSObject.Properties[$name]
    if ($null -eq $prop) { continue }
    if ([string]$prop.Value -ne [string]$expected[$name]) {
      $missing.Add("config-value:$name=$($prop.Value) expected=$($expected[$name])")
    }
  }
  return $missing.ToArray()
}

$repoMissing = @(Test-RepoRuntimeConfigSupport)
if ($repoMissing.Count -gt 0 -and $Repair) {
  Write-GuardLog "repo runtime/source contract support missing; repair disabled for tracked files: $($repoMissing -join ', ')"
}
if ($repoMissing.Count -gt 0) {
  Write-GuardLog "FAILED repo runtime config support missing: $($repoMissing -join ', ')"
  exit 2
}

$configMissing = @(Test-RuntimeConfig)
if ($configMissing.Count -gt 0 -and $Repair) {
  Write-GuardLog "runtime config missing before repair: $($configMissing -join ', ')"
  Write-DefaultRuntimeConfig
  $configMissing = @(Test-RuntimeConfig)
}

if ($configMissing.Count -gt 0) {
  Write-GuardLog "FAILED runtime config missing: $($configMissing -join ', ')"
  exit 3
}

Write-GuardLog "ok public slot runtime config guard"
