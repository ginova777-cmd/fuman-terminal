const fs = require("fs");
const path = require("path");
const { isTwseTradingDay } = require("./twse-trading-day");

const PROJECT_URL = process.env.SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co";
const SOURCE_NAME = process.env.DAYTRADE_SOURCE_NAME || "fugle_daytrade_source";

function readTextSecret(paths) {
  for (const file of paths) {
    try {
      if (!fs.existsSync(file)) continue;
      const value = fs.readFileSync(file, "utf8").trim();
      if (value) return value;
    } catch {
      // optional secret path
    }
  }
  return "";
}

function numberValue(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(String(value).replace(/,/g, "").replace(/%/g, "").trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

function hasValue(object, key) {
  return object && Object.prototype.hasOwnProperty.call(object, key) && object[key] !== null && object[key] !== undefined && object[key] !== "";
}

function stringValue(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function boolValue(value) {
  if (typeof value === "boolean") return value;
  return /^(1|true|yes|ok|ready)$/i.test(String(value || "").trim());
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientRestError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return message.includes("57014")
    || message.includes("statement timeout")
    || message.includes("operation was aborted")
    || message.includes("timeout");
}

async function retryTransient(label, action) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (!isTransientRestError(error) || attempt === 3) throw error;
      await sleepMs(350 * attempt);
    }
  }
  throw lastError || new Error(`${label} failed`);
}
function firstObject(value) {
  return Array.isArray(value) ? value[0] || null : value || null;
}

async function restGet(anonKey, pathAndQuery) {
  return retryTransient(`GET ${pathAndQuery}`, async () => {
    const url = `${PROJECT_URL.replace(/\/$/, "")}/rest/v1/${pathAndQuery}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined,
    });
    const text = await response.text();
    if (!response.ok) {
      const error = new Error(`GET ${pathAndQuery} HTTP ${response.status}: ${text.slice(0, 240)}`);
      error.status = response.status;
      throw error;
    }
    return text ? JSON.parse(text) : null;
  });
}
async function restPost(anonKey, rpcName, body) {
  return retryTransient(`POST rpc/${rpcName}`, async () => {
    const url = `${PROJECT_URL.replace(/\/$/, "")}/rest/v1/rpc/${rpcName}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body || {}),
      signal: AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined,
    });
    const text = await response.text();
    if (!response.ok) {
      const error = new Error(`POST rpc/${rpcName} HTTP ${response.status}: ${text.slice(0, 240)}`);
      error.status = response.status;
      throw error;
    }
    return text ? JSON.parse(text) : null;
  });
}
function websocketEvidence(payload = {}) {
  const channels = arrayValue(payload.websocket_streaming_channels ?? payload.websocketStreamingChannels);
  return {
    quoteTransport: stringValue(payload.quote_transport),
    websocketStatusOk: boolValue(payload.websocket_status_ok),
    websocketMode: stringValue(payload.websocket_mode),
    websocketConnected: boolValue(payload.websocket_connected),
    websocketAuthenticated: boolValue(payload.websocket_authenticated),
    websocketRestDisabled: boolValue(payload.websocket_rest_disabled),
    websocketFormalReady: boolValue(payload.websocket_formal_ready),
    websocketStreamingChannels: channels,
    websocketRequiredChannelsReady: ["trades", "aggregates", "candles"].every((channel) => channels.includes(channel)),
  };
}

function normalizeSourceStatus(row) {
  const payload = row?.payload || {};
  return {
    status: stringValue(row?.status),
    message: stringValue(row?.message),
    updatedAt: stringValue(row?.updated_at),
    daytradeGateGrade: stringValue(payload.daytrade_gate_grade),
    gateGrade: stringValue(payload.gate_grade),
    gateStatus: stringValue(payload.gate_status),
    formalEntrySpeedVerdict: stringValue(payload.formal_entry_speed_verdict),
    priorityGateGrade: stringValue(payload.priority_gate_grade),
    priorityFreshQuotes120s: numberValue(payload.priority_fresh_quotes_120s),
    priorityPoolSymbols: numberValue(payload.priority_pool_symbols),
    priorityFreshQuoteCoverage120s: numberValue(payload.priority_fresh_quote_coverage_120s),
    motherPoolSymbols: numberValue(payload.mother_pool_symbols),
    formalScanPoolSymbols: numberValue(payload.formal_scan_pool_symbols),
    basePoolEligibleSymbols: numberValue(payload.base_pool_eligible_symbols ?? payload.mother_pool_base_pool_symbols),
    basePoolPendingSymbols: numberValue(payload.base_pool_pending_symbols ?? payload.mother_pool_base_pool_pending_symbols),
    basePoolShortfall: numberValue(payload.base_pool_shortfall),
    motherPoolFreshQuoteCoverage120s: numberValue(payload.mother_pool_fresh_coverage_120s),
    motherPoolFreshQuotes120s: numberValue(payload.mother_pool_fresh_quotes_120s),
    reasonCode: stringValue(payload.reason_code),
    failedChecks: arrayValue(payload.failed_checks),
    motherPoolBasePoolFailureCounts: payload.mother_pool_base_pool_failure_counts || {},
    motherPoolBasePoolPendingCounts: payload.mother_pool_base_pool_pending_counts || {},
    hasPriorityPoolSymbols: hasValue(payload, "priority_pool_symbols"),
    hasPriorityFreshQuoteCoverage120s: hasValue(payload, "priority_fresh_quote_coverage_120s"),
    hasScannerCanRunOpening: hasValue(payload, "scanner_can_run_opening"),
    quoteAgeSeconds: numberValue(payload.quote_age_seconds, 999999),
    formalEntryAllowed: boolValue(payload.formal_entry_allowed),
    dailyVolumeStatus: stringValue(payload.daily_volume_status),
    intraday1mStaleSeconds: numberValue(payload.intraday_1m_stale_seconds, 999999),
    scannerCanRunQuoteOnly: boolValue(payload.scanner_can_run_quote_only),
    scannerCanRunOpening: boolValue(payload.scanner_can_run_opening),
    rateLimitStatus: stringValue(payload.rate_limit_status),
    readyMa20Continuous: numberValue(payload.ready_ma20_continuous),
    readyMa35Continuous: numberValue(payload.ready_ma35_continuous),
    formalGateScope: stringValue(payload.formal_gate_scope),
    formalSourceName: stringValue(payload.formal_source_name),
    formalGateSource: stringValue(payload.formal_gate_source),
    formalQuoteSource: stringValue(payload.formal_quote_source),
    formalIntraday1mSource: stringValue(payload.formal_intraday_1m_source),
    quoteSourceDaytradeOk: boolValue(payload.quote_source_daytrade_ok),
    intraday1mSourceDaytradeOk: boolValue(payload.intraday_1m_source_daytrade_ok),
    formalSourceAlignmentOk: boolValue(payload.formal_source_alignment_ok),
    strategyChipStatus: stringValue(payload.formal_priority_strategy_chip_status),
    strategyChipCompleteLatestRun: boolValue(payload.formal_priority_strategy_chip_complete_latest_run_evidence),
    formalPrioritySpeedOk: boolValue(payload.formal_priority_speed_ok),
    fullMarketSpeedBlocking: payload.full_market_speed_blocking === false ? false : boolValue(payload.full_market_speed_blocking),
    gateSpeedOk: boolValue(payload.gate_speed_ok),
    formalSpeedScope: stringValue(payload.formal_speed_scope),
    quoteSpeedScope: stringValue(payload.quote_speed_scope),
    ...websocketEvidence(payload),
  };
}

function normalizeGate(row) {
  const payload = row?.payload || {};
  return {
    gateGrade: stringValue(row?.canonical_gate_grade || row?.daytrade_gate_grade || row?.gate_grade || row?.gate),
    gateStatus: stringValue(row?.canonical_gate_status || row?.gate_status || row?.status),
    reason: stringValue(row?.canonical_gate_reason || row?.reason || row?.canonical_reason || row?.scanner_block_reason),
    hasCanonicalGateReason: hasValue(row, "canonical_gate_reason"),
    priorityPoolSymbols: numberValue(row?.priority_pool_symbols),
    priorityFreshQuoteCoverage120s: numberValue(row?.priority_fresh_quote_coverage_120s),
    motherPoolSymbols: numberValue(row?.mother_pool_symbols),
    formalScanPoolSymbols: numberValue(row?.formal_scan_pool_symbols ?? payload.formal_scan_pool_symbols),
    formalPrioritySymbols: numberValue(row?.formal_priority_symbols),
    formalFreshQuoteCoverage120s: numberValue(row?.formal_fresh_quote_coverage_120s),
    formalMaxQuoteAgeSeconds: numberValue(row?.formal_max_quote_age_seconds, 999999),
    formalScope: stringValue(row?.formal_scope),
    scannerCanRunOpening: boolValue(row?.scanner_can_run_opening),
    hasPriorityPoolSymbols: hasValue(row, "priority_pool_symbols"),
    hasPriorityFreshQuoteCoverage120s: hasValue(row, "priority_fresh_quote_coverage_120s"),
    hasScannerCanRunOpening: hasValue(row, "scanner_can_run_opening"),
    quoteAgeSeconds: numberValue(row?.quote_age_seconds, 999999),
    freshQuotes120s: numberValue(row?.fresh_quotes_120s),
    scorecardRequiredOkCount: numberValue(row?.scorecard_required_ok_count),
    scorecardRequiredCount: numberValue(row?.scorecard_required_count),
    formalEntryAllowed: boolValue(row?.formal_entry_allowed),
    dailyVolumeStatus: stringValue(row?.daily_volume_status),
    intraday1mStaleSeconds: numberValue(row?.intraday_1m_stale_seconds, 999999),
    formalSourceAlignmentOk: boolValue(row?.formal_source_alignment_ok),
    formalEntrySpeedVerdict: stringValue(row?.formal_entry_speed_verdict),
    strategyChipStatus: stringValue(row?.formal_priority_strategy_chip_status || payload.formal_priority_strategy_chip_status),
    strategyChipCompleteLatestRun: boolValue(row?.formal_priority_strategy_chip_complete_latest_run_evidence ?? payload.formal_priority_strategy_chip_complete_latest_run_evidence),
    daytradeSourceSpeedOk: boolValue(row?.daytrade_source_speed_ok),
    readyMa20Continuous: numberValue(row?.ready_ma20_continuous_symbols ?? row?.ready_ma20_continuous),
    readyMa35Continuous: numberValue(row?.ready_ma35_continuous_symbols ?? row?.ready_ma35_continuous),
    ...websocketEvidence(row || {}),
  };
}

function sourceWebsocketOk(source) {
  return source.websocketStatusOk === true
    && source.websocketConnected === true
    && source.websocketAuthenticated === true
    && source.websocketMode === "streaming"
    && source.quoteTransport.startsWith("websocket_")
    && source.websocketRestDisabled === true
    && source.websocketRequiredChannelsReady === true
    && source.websocketFormalReady === true;
}

function gateWebsocketOk(gate) {
  return sourceWebsocketOk(gate) && gate.websocketFormalReady === true;
}

function isSourceA(source) {
  return source.status === "ok"
    && source.daytradeGateGrade === "A"
    && source.hasPriorityPoolSymbols === true
    && source.priorityPoolSymbols === 40
    && source.hasPriorityFreshQuoteCoverage120s === true
    && source.priorityFreshQuoteCoverage120s >= 0.90
    && source.quoteAgeSeconds <= 90
    && source.formalEntryAllowed === true
    && source.scannerCanRunQuoteOnly === true
    && source.hasScannerCanRunOpening === true
    && source.scannerCanRunOpening === true
    && source.rateLimitStatus !== "rate_limited"
    && sourceWebsocketOk(source);
}

function isSourceFailClosed(source) {
  const message = `${source.status} ${source.message}`.toLowerCase();
  return ["ok", "degraded", "stopped", "not_ready"].includes(source.status)
    && source.daytradeGateGrade !== "A"
    && source.formalEntryAllowed === false
    && (source.scannerCanRunOpening === true || message.includes("formal entry not allowed") || message.includes("off-session") || message.includes("strategy_chip_complete_latest_run_missing"))
    && source.rateLimitStatus !== "rate_limited";
}

function isGateA(gate) {
  return gate.gateGrade === "A"
    && ["ready", "ok", "yes", ""].includes(gate.gateStatus.toLowerCase())
    && gate.hasCanonicalGateReason === true
    && gate.hasPriorityPoolSymbols === true
    && gate.priorityPoolSymbols === 40
    && gate.hasPriorityFreshQuoteCoverage120s === true
    && gate.priorityFreshQuoteCoverage120s >= 0.90
    && gate.hasScannerCanRunOpening === true
    && gate.scannerCanRunOpening === true
    && gate.quoteAgeSeconds <= 90
    && gate.formalEntrySpeedVerdict === "YES"
    && gateWebsocketOk(gate);
}

function isGateFailClosed(gate) {
  return gate.gateGrade !== "A"
    && gate.hasCanonicalGateReason === true
    && gate.gateStatus === "not_ready"
    && ["off_session_not_formal_entry", "formal_entry_not_allowed", "source_status_not_ok", "websocket_not_formal_ready", "strategy_chip_complete_latest_run_missing"].includes(gate.reason)
    && gate.formalEntrySpeedVerdict === "NO";
}

function gateVerdict(source, canonicalGate, unattendedGate) {
  const sourceA = isSourceA(source);
  const sourceClosed = isSourceFailClosed(source);
  const canonicalA = isGateA(canonicalGate);
  const unattendedA = isGateA(unattendedGate);
  const canonicalClosed = isGateFailClosed(canonicalGate);
  const unattendedClosed = isGateFailClosed(unattendedGate);
  if (sourceA && canonicalA && unattendedA) return { ok: true, verdict: "A_READY_ALIGNED", mode: "formal_ready", issues: [] };
  if (sourceClosed && canonicalClosed && unattendedClosed) return { ok: true, verdict: "FAIL_CLOSED_ALIGNED", mode: "formal_entry_fail_closed", issues: [] };
  const issues = [];
  if (!sourceA && !sourceClosed) issues.push("source_status_not_a_or_fail_closed");
  if (!canonicalA && !canonicalClosed) issues.push("canonical_gate_not_a_or_fail_closed");
  if (!unattendedA && !unattendedClosed) issues.push("unattended_gate_not_a_or_fail_closed");
  return { ok: false, verdict: "NOT_ALIGNED", mode: "mismatch", issues };
}


function writerCodeRegressionChecks() {
  const writerPath = path.join(__dirname, "run-daytrade-source-writer.js");
  let source = "";
  try {
    source = fs.readFileSync(writerPath, "utf8");
  } catch (error) {
    return {
      ok: false,
      path: writerPath,
      checks: {},
      issues: [`writer_code_read_failed:${error.message}`],
    };
  }
  const checks = {
    openingDetectionPhaseExists: source.includes('"opening_detection_0900_0934"') || source.includes("'opening_detection_0900_0934'"),
    openingBoostActiveCovers0900: /openingBoostActive[\s\S]{0,240}opening_detection_0900_0934/.test(source),
    dailyVolumeFastMirrorFirst: /fugle_daytrade_daily_volume_avg[\s\S]{0,420}fugle_daily_volume_avg/.test(source),
    dailyVolumeHasAnonRetry: /for \(const service of \[true, false\]\)/.test(source),
    dailyVolumeSelectsAvg5Alias: source.includes("avg5_volume"),
    dailyVolumeSelectsStatus: source.includes("daily_volume_status"),
    dailyVolumeSourceEvidence: source.includes("daily_volume_source"),
    formalSourceAlignmentPayload: source.includes("formal_source_alignment_ok"),
    websocketFormalReadyPayload: source.includes("websocket_formal_ready") && source.includes("websocket_formal_ready_reason") && source.includes("formalReadyReason"),
    websocketFormalReadyRequiresTransport: /formalReady: transportReady/.test(source) && /statusAgeSeconds <= 300/.test(source),
    formalGateRequiresWebsocket: /priorityGateA && formalEntryWindow && webSocketStatus\.formalReady/.test(source),
    strategyChipEvidencePolicyConsistent: source.includes('strategyChipCompleteLatestRun') && ((source.includes('formal_priority_strategy_chip_required_for_formal_entry: false') && source.includes('formal_priority_strategy_chip_blocks_formal_entry: false')) || (source.includes('formal_priority_strategy_chip_required_for_formal_entry: true') && source.includes('formal_priority_strategy_chip_blocks_formal_entry: !strategyChipCompleteLatestRun'))),
    formalPrioritySpeedPayload: source.includes("formal_priority_speed_ok"),
    fullMarketSpeedNonBlockingPayload: source.includes("full_market_speed_blocking: false"),
    slowTableBatchReduction: source.includes('fugle_daytrade_priority_pool')
      && source.includes('fugle_daytrade_intraday_1m')
      && source.includes('fugle_daytrade_futopt_quotes_live')
      && source.includes('batchSize: 40')
      && source.includes('BATCH_SIZE = Math.max(1, Math.min(FORMAL_DAYTRADE_PRIORITY_LIMIT'),
    websocketQuoteReadthrough: source.includes('supabaseUpsert(\'fugle_daytrade_quotes_live\', websocketQuoteRows, \'symbol\', { batchSize: 40 })')
      && source.includes('websocket_cache_mother_pool_readthrough')
      && source.includes('websocket_quote_readthrough_written'),
    gracefulMaxRunStop: source.includes('maxRunReached = false')
      && source.includes('max_run_seconds_reached_after_active_tick')
      && !source.includes('process.exit(124)'),
    motherPoolBaseEligibilityContract: source.includes('function evaluateMotherPoolBasePool')
      && source.includes('avg5 is a liquidity grade only')
      && !source.includes('avg5_volume_not_gt_3000')
      && source.includes('market_not_twse_otc')
      && source.includes('price_below_'),
    warmingMotherPoolIncludesPending: source.includes('const rankingCandidates = [...qualifiedCandidates, ...pendingCandidates]')
      && source.includes('quote_stale')
      && source.includes('quote_pending'),
    runtimeSeedsCannotBypassBasePool: source.includes('Runtime seeds may boost a candidate already selected in the warming')
      && source.includes('if (!prev)'),
    fullMarketMotherPoolRotation: source.includes('prioritySource: "dynamic_daytrade_mother_pool"')
      && source.includes('formal_gate_scope: "mother_pool_300_rotating_deep_scan"')
      && source.includes('mother_pool_scan_min_symbols')
      && source.includes('mother_pool_scan_max_symbols'),
    motherPoolMinimum300: source.includes('positiveNumber(process.env.DAYTRADE_MOTHER_POOL_MIN_SYMBOLS || CONFIG.motherPool?.targetSymbolsMin, 300)'),
    motherPoolFreshnessFirst: source.includes('Number(b.metrics?.quoteFresh === true) - Number(a.metrics?.quoteFresh === true)')
      && source.includes('mother_pool_fresh_coverage_120s'),
    motherPoolOptionalPriceFloor: source.includes('MOTHER_POOL_MIN_PRICE') && source.includes('price_below_'),
    motherPoolTradingHardFilters: source.includes('daytrade_not_allowed')
      && source.includes('halted_or_suspended')
      && source.includes('disposition_or_controlled')
      && source.includes('split_trading')
      && source.includes('manual_control')
      && source.includes('is_daytrade_unsuitable')
      && source.includes('is_warrant')
      && source.includes('is_cb')
      && source.includes('is_blacklisted'),
    hotPool40To80: source.includes('HOT_POOL_MIN_SYMBOLS') && source.includes('daytradeHotPoolSymbols') && source.includes('hot_pool_max_symbols'),
    preopenWarmupStarts0700: source.includes('PREOPEN_WARMUP_START_MINUTES = 7 * 60') && source.includes('warmup_start_taipei') && source.includes('warmupDataFillActive'),
    indicatorWarmupMa3Ma58: source.includes('current.ma3 = movingAverage(3)') && source.includes('current.ma58 = movingAverage(58)') && source.includes('indicator_set') && source.includes('macd_line') && source.includes('kd_k') && source.includes('rsi14'),
    indicatorWarmupMa20: source.includes('current.ma20 = movingAverage(20)') && source.includes('ma20: Number.isFinite(Number(row.ma20))') && source.includes('"MA20"'),
    dynamicMaTurnMotherPoolSignal: source.includes('movingAverageTurnBullish')
      && source.includes('ma3_5_10_or_ma5_10_30_turn_bullish')
      && source.includes('supplementalMaps.intradayMap = intradayMap'),
    motherPoolDynamicDiscoveryUnion: source.includes('isMotherPoolCandidate')
      && source.includes('signalCandidates')
      && source.includes('rotationCandidates')
      && source.includes('radar_rotation_fill')
      && source.includes('sourceFlags'),
    motherPoolReadbackFields: source.includes('volumeRatio5')
      && source.includes('tradeValueRank')
      && source.includes('liquidityGrade')
      && source.includes('poolReasons')
      && source.includes('sectorStrengthScore'),
    motherPoolDataGap: source.includes('dataGapRequired')
      && source.includes('candle_count')
      && source.includes('missing_window')
      && source.includes('first_candle_time'),
    motherPoolSeedSources: source.includes('strategy1') && source.includes('strategy2') && source.includes('strategy7') && source.includes('slash88') && source.includes('stock_future') && source.includes('manual_watchlist'),
    motherPoolSourceUnionAliases: source.includes('addMany("chip"')
      && source.includes('addMany("recent_strong"')
      && source.includes('addMany("yesterday_front"')
      && source.includes('addMany("yesterday_gain_amplitude_spike"'),
    motherPoolRuleVersionConsistent: source.includes('const MOTHER_POOL_RULE_VERSION')
      && source.includes('motherPoolRuleVersion: MOTHER_POOL_RULE_VERSION')
      && source.includes('ruleVersion: MOTHER_POOL_RULE_VERSION')
      && source.includes('mother_pool_rule_version: MOTHER_POOL_RULE_VERSION'),
    motherPoolSourceCountsReadback: source.includes('sourceSeedCounts')
      && source.includes('mother_pool_source_seed_counts')
      && source.includes('mother_pool_source_seed_union'),
    stockTickerSchemaCompatible: source.includes('stock_tickers')
      && source.includes('select=symbol,name,market,stock_type,type,industry,is_etf,is_suspended,payload&order=symbol.asc')
      && source.includes('stock_universe')
      && source.includes('select=symbol,name,market,industry,is_active,is_etf,is_warrant,is_cb,is_blacklisted,is_daytrade_unsuitable,payload&order=symbol.asc'),
    reasonCodePayload: source.includes('const failedChecks = []')
      && source.includes('reason_code: reasonCode')
      && source.includes('base_pool_shortfall'),
    fullMarketVolumeMirror: source.includes('syncDailyVolumeMirror(dailyVolumeMap, activeSymbols)')
      && source.includes('activeOrdinaryStockUniverse: true')
      && source.includes('DAILY_VOLUME_MIRROR_SYNC_INTERVAL_MS')
      && source.includes('{ batchSize: 250 }'),
    enrichmentPendingIsNonAuthoritative: source.includes('daytrade-source-writer-enrichment-pending.json')
      && source.includes('authoritative_source_status_preserved: true')
      && !source.includes('writeStatusAndScorecard(pendingResult)'),
  };
  const issues = [];
  for (const [key, ok] of Object.entries(checks)) {
    if (!ok) issues.push(`writer_regression_${key}_missing`);
  }
  return { ok: issues.length === 0, path: writerPath, checks, issues };
}
function writerSupervisorRegressionChecks() {
  const wrapperPath = path.join(__dirname, "..", "ops", "public-slot", "Run-DaytradeSourceWriter.ps1");
  let source = "";
  try {
    source = fs.readFileSync(wrapperPath, "utf8");
  } catch (error) {
    return { ok: false, path: wrapperPath, checks: {}, issues: [`writer_supervisor_read_failed:${error.message}`] };
  }
  const checks = {
    futoptProcessGuard: source.includes("Get-FugleFutoptWebSocketCollectorProcess"),
    futoptEnsureFunction: source.includes("function Ensure-FugleFutoptWebSocketCollector"),
    applyStartsOrReusesFutopt: /if \(\$Apply\)[\s\S]{0,900}Ensure-FugleFutoptWebSocketCollector/.test(source),
    requiredChannels: source.includes("$env:FUGLE_FUTOPT_STREAMING_CHANNELS = \"trades,aggregates,candles\""),
    subscriptionBudget: source.includes("$env:FUGLE_FUTOPT_STREAMING_MAX_TOTAL_SUBSCRIPTIONS = \"1800\"") && source.includes("$env:FUGLE_FUTOPT_STREAMING_MAX_SYMBOLS = \"500\""),
    missingCollectorRemainsFailClosed: source.includes("formal futopt status is ready"),
    futoptCollectorStartMutex: source.includes("Global\\FumanFugleDaytradeFutoptCollector"),
  };
  const issues = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => `writer_supervisor_${name}_missing`);
  return { ok: issues.length === 0, path: wrapperPath, checks, issues };
}
function websocketCodeRegressionChecks() {
  const files = {
    stockCollector: path.join(__dirname, "fugle-websocket-collector.js"),
    futoptCollector: path.join(__dirname, "fugle-futopt-websocket-collector.js"),
    verifier: path.join(__dirname, "verify-fugle-websocket-sources.js"),
  };
  const source = Object.fromEntries(Object.entries(files).map(([name, file]) => {
    try { return [name, fs.readFileSync(file, "utf8")]; } catch { return [name, ""]; }
  }));
  const checks = {
    stockCollectorFormalReady: source.stockCollector.includes("websocketConnected")
      && source.stockCollector.includes("websocketAuthenticated")
      && source.stockCollector.includes("streamingChannels")
      && source.stockCollector.includes("streamingMessages"),
    candleMergeDefinesFreshnessCutoff: /function mergeStreamingCandles\([\s\S]*?const cutoff\s*=\s*Date\.now\(\)[\s\S]*?seen\s*>=\s*cutoff/.test(source.stockCollector),
    futoptCollectorFormalReady: source.futoptCollector.includes("formalReady") && source.futoptCollector.includes("formalReadyReason"),
    futoptCollectorRequiresRecentMessage: source.futoptCollector.includes("quoteMessages + candleMessages > 0")
      && source.futoptCollector.includes("messageAgeSeconds <= 300"),
    verifierReadsFormalReady: source.verifier.includes("requiredChannels")
      && source.verifier.includes("websocket_not_connected")
      && source.verifier.includes("websocket_missing_channel"),
  };
  const issues = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => `websocket_regression_${name}_missing`);
  return { ok: issues.length === 0, files, checks, issues };
}
async function optionalProbe(label, action) {
  try {
    return { label, ok: true, rows: await action() };
  } catch (error) {
    return { label, ok: false, error: error.message };
  }
}

async function main() {
  const marketDay = await isTwseTradingDay(new Date(), { stateDir: process.env.FUMAN_STATE_DIR || "C:/fuman-runtime/state" }).catch((error) => ({ isTradingDay: true, reason: "calendar_probe_failed", error: error.message }));
  const marketClosed = marketDay.isTradingDay === false;
  const anonKey = process.env.SUPABASE_ANON_KEY || readTextSecret([
    path.join("C:", "fuman-runtime", "secrets", "supabase-anon-key.txt"),
    path.join(__dirname, "..", "secrets", "supabase-anon-key.txt"),
  ]);
  if (!anonKey) throw new Error("SUPABASE_ANON_KEY is required.");

  const futoptGateSelect = "futopt_gate_status,futopt_txf_ok,txf_ok,futopt_ready_rows,futopt_stale_rows,futopt_contract_rows,latest_futopt_updated_at,latest_txf_updated_at,futopt_reason";
  const gateSelect = [
    "canonical_gate_grade",
    "canonical_gate_status",
    "canonical_gate_reason",
    "formal_entry_allowed",
    "daily_volume_status",
    "formal_source_alignment_ok",
    "intraday_1m_stale_seconds",
    "priority_pool_symbols",
    "mother_pool_symbols",
    "formal_priority_symbols",
    "formal_fresh_quote_coverage_120s",
    "formal_max_quote_age_seconds",
    "formal_scope",
    "priority_fresh_quote_coverage_120s",
    "scanner_can_run_opening",
    "quote_age_seconds",
    "fresh_quotes_120s",
    "scorecard_required_ok_count",
    "scorecard_required_count",
    "formal_entry_speed_verdict",
    "daytrade_source_speed_ok",
    "payload",
    "ready_ma20_continuous_symbols",
    "ready_ma35_continuous_symbols",
    "quote_transport",
    "websocket_status_ok",
    "websocket_mode",
    "websocket_connected",
    "websocket_authenticated",
    "websocket_rest_disabled",
    "websocket_formal_ready",
    "websocket_streaming_channels",
  ].join(",");  const [sourceRows, canonicalRows, unattendedRows, dailyAliasProbe, intradayRpcProbe, canonicalFutoptProbe, unattendedFutoptProbe] = await Promise.all([
    restGet(anonKey, `source_status?source_name=eq.${encodeURIComponent(SOURCE_NAME)}&select=source_name,status,updated_at,message,payload&limit=1`),
    restGet(anonKey, `v_fugle_daytrade_canonical_gate?select=${gateSelect}&limit=1`),
    restGet(anonKey, `v_fugle_daytrade_unattended_gate_status?select=${gateSelect}&limit=1`),
    optionalProbe("daily_volume_alias", () => restGet(anonKey, "fugle_daytrade_daily_volume_avg?select=symbol,avg_volume5,avg5_volume,daily_volume_status&limit=1")),
    optionalProbe("daytrade_intraday_latest_n_rpc", () => restPost(anonKey, "get_fugle_daytrade_intraday_1m_latest_n", { symbols: ["2330"], bars_per_symbol: 1 })),
    optionalProbe("canonical_futopt_gate_fields", () => restGet(anonKey, `v_fugle_daytrade_canonical_gate?select=${futoptGateSelect}&limit=1`)),
    optionalProbe("unattended_futopt_gate_fields", () => restGet(anonKey, `v_fugle_daytrade_unattended_gate_status?select=${futoptGateSelect}&limit=1`)),
  ]);

  const sourceStatus = normalizeSourceStatus(firstObject(sourceRows));
  const canonicalGate = normalizeGate(firstObject(canonicalRows));
  const unattendedGate = normalizeGate(firstObject(unattendedRows));
  const alignment = marketClosed
    ? { ok: true, verdict: "MARKET_CLOSED_PRESERVE_PREVIOUS_GOOD", mode: "market_closed_previous_good", issues: [] }
    : gateVerdict(sourceStatus, canonicalGate, unattendedGate);
  const issues = [...alignment.issues];
  const writerCodeRegression = writerCodeRegressionChecks();
  const writerSupervisorRegression = writerSupervisorRegressionChecks();
  const websocketCodeRegression = websocketCodeRegressionChecks();
  issues.push(...writerCodeRegression.issues);
  issues.push(...writerSupervisorRegression.issues);
  issues.push(...websocketCodeRegression.issues);

  for (const [label, item] of [["source", sourceStatus], ["canonical", canonicalGate], ["unattended", unattendedGate]]) {
    if (item.hasPriorityPoolSymbols !== true) issues.push(`${label}_priority_pool_symbols_missing`);
    if (item.priorityPoolSymbols !== 40) issues.push(`${label}_priority_pool_symbols_not_40`);
    if (item.hasPriorityFreshQuoteCoverage120s !== true) issues.push(`${label}_priority_fresh_quote_coverage_120s_missing`);
    if (item.hasScannerCanRunOpening !== true) issues.push(`${label}_scanner_can_run_opening_missing`);
    if (item.scannerCanRunOpening !== true && item.gateGrade === "A") issues.push(`${label}_scanner_can_run_opening_false_for_a`);
    if (label !== "source" && item.hasCanonicalGateReason !== true) issues.push(`${label}_canonical_gate_reason_missing`);
    if (Number.isFinite(item.scorecardRequiredOkCount) && Number.isFinite(item.scorecardRequiredCount)
      && (item.scorecardRequiredCount <= 0
        || item.scorecardRequiredOkCount < 0
        || item.scorecardRequiredOkCount > item.scorecardRequiredCount)) {
      issues.push(`${label}_scorecard_required_count_invalid`);
    }
    if (!marketClosed && item.gateGrade === "A" && label !== "source" && gateWebsocketOk(item) !== true) issues.push(`${label}_websocket_formal_ready_false_for_a`);
    if (!marketClosed && ((label === "source" && item.daytradeGateGrade === "A") || (label !== "source" && item.gateGrade === "A"))) {
      if (sourceWebsocketOk(item) !== true) issues.push(`${label}_websocket_evidence_not_formal`);
      if (label === "source") {
        if (!["mother_pool_300_rotating_deep_scan", "priority_top40"].includes(item.formalGateScope)) issues.push("source_formal_gate_scope_not_mother_pool_or_priority_top40");
        if (item.formalSourceName !== SOURCE_NAME) issues.push("source_formal_source_name_mismatch");
        if (!item.formalGateSource.includes("v_fugle_daytrade_canonical_gate")) issues.push("source_formal_gate_source_missing_canonical_gate");
        if (item.formalQuoteSource !== "fugle_daytrade_quotes_live") issues.push("source_formal_quote_source_mismatch");
        if (!item.formalIntraday1mSource) issues.push("source_formal_intraday_1m_source_missing");
        if (item.quoteSourceDaytradeOk !== true) issues.push("source_quote_source_daytrade_not_ok_for_a");
        if (item.intraday1mSourceDaytradeOk !== true) issues.push("source_intraday_1m_source_daytrade_not_ok_for_a");
        if (item.formalSourceAlignmentOk !== true) issues.push("source_formal_source_alignment_not_ok_for_a");
        if (item.formalPrioritySpeedOk !== true || item.gateSpeedOk !== true) issues.push("source_formal_priority_speed_not_ok_for_a");
        if (item.fullMarketSpeedBlocking !== false) issues.push("source_full_market_speed_should_be_nonblocking");
        if (item.formalSpeedScope !== "priority_top40") issues.push("source_formal_speed_scope_not_priority_top40");
      }
    }
  }

  const layerAlignmentChecks = [
    ["gate_grade", sourceStatus.gateGrade, canonicalGate.gateGrade, unattendedGate.gateGrade],
    ["gate_status", sourceStatus.gateStatus, canonicalGate.gateStatus, unattendedGate.gateStatus],
    ["formal_entry_speed_verdict", sourceStatus.formalEntrySpeedVerdict, canonicalGate.formalEntrySpeedVerdict, unattendedGate.formalEntrySpeedVerdict],
    ["formal_entry_allowed", sourceStatus.formalEntryAllowed, canonicalGate.formalEntryAllowed, unattendedGate.formalEntryAllowed],
    ["scanner_can_run_opening", sourceStatus.scannerCanRunOpening, canonicalGate.scannerCanRunOpening, unattendedGate.scannerCanRunOpening],
    ["daily_volume_status", sourceStatus.dailyVolumeStatus, canonicalGate.dailyVolumeStatus, unattendedGate.dailyVolumeStatus],
    ["websocket_formal_ready", sourceStatus.websocketFormalReady, canonicalGate.websocketFormalReady, unattendedGate.websocketFormalReady],
    ["formal_source_alignment_ok", sourceStatus.formalSourceAlignmentOk, canonicalGate.formalSourceAlignmentOk, unattendedGate.formalSourceAlignmentOk],
    ["intraday_1m_stale_seconds", sourceStatus.intraday1mStaleSeconds, canonicalGate.intraday1mStaleSeconds, unattendedGate.intraday1mStaleSeconds],
  ];
  for (const [name, ...values] of layerAlignmentChecks) {
    if (name === "websocket_formal_ready" && sourceStatus.offSession === true) continue;
    if (values.some((value) => value === null || value === undefined || value === "" || Number.isNaN(value))) {
      issues.push(`layer_contract_field_missing:${name}`);
    } else if (values.some((value) => value !== values[0])) {
      issues.push(`layer_contract_field_mismatch:${name}`);
    }
  }
  if (!dailyAliasProbe.ok) issues.push(`daily_volume_alias_probe_failed:${dailyAliasProbe.error}`);
  const dailyAliasRows = Array.isArray(dailyAliasProbe.rows) ? dailyAliasProbe.rows : [];
  if (dailyAliasProbe.ok && dailyAliasRows.some((row) => !Object.prototype.hasOwnProperty.call(row || {}, "daily_volume_status"))) issues.push("daily_volume_status_missing_from_daily_volume_avg");
  if (dailyAliasProbe.ok && dailyAliasRows.some((row) => row && row.daily_volume_status !== "ready" && row.daily_volume_status !== "missing")) issues.push("daily_volume_status_invalid_value");
  if (!intradayRpcProbe.ok) issues.push(`daytrade_intraday_latest_n_rpc_probe_failed:${intradayRpcProbe.error}`);
  for (const probe of [canonicalFutoptProbe, unattendedFutoptProbe]) {
    if (!probe.ok) issues.push(`${probe.label}_probe_failed:${probe.error}`);
    const row = Array.isArray(probe.rows) ? probe.rows[0] : null;
    if (probe.ok && !row) issues.push(`${probe.label}_empty`);
    if (probe.ok && row) {
      for (const field of futoptGateSelect.split(",")) {
        if (!Object.prototype.hasOwnProperty.call(row, field)) issues.push(`${probe.label}_${field}_missing`);
      }
      if (!["ready", "not_required", "stale", "not_ready", "error"].includes(String(row.futopt_gate_status || ""))) issues.push(`${probe.label}_futopt_gate_status_invalid`);
      if (typeof row.futopt_txf_ok !== "boolean") issues.push(`${probe.label}_futopt_txf_ok_not_boolean`);
      if (typeof row.txf_ok !== "boolean") issues.push(`${probe.label}_txf_ok_not_boolean`);
    }
  }
  if (!marketClosed && canonicalGate.gateGrade === "A" && canonicalFutoptProbe.ok) {
    const row = Array.isArray(canonicalFutoptProbe.rows) ? canonicalFutoptProbe.rows[0] : null;
    if (row && String(row.futopt_gate_status || "") !== "ready") issues.push("canonical_a_with_futopt_not_ready");
    if (row && row.futopt_txf_ok !== true) issues.push("canonical_a_with_txf_not_ready");
  }
  if (!marketClosed && unattendedGate.gateGrade === "A" && unattendedFutoptProbe.ok) {
    const row = Array.isArray(unattendedFutoptProbe.rows) ? unattendedFutoptProbe.rows[0] : null;
    if (row && String(row.futopt_gate_status || "") !== "ready") issues.push("unattended_a_with_futopt_not_ready");
    if (row && row.futopt_txf_ok !== true) issues.push("unattended_a_with_txf_not_ready");
  }
  if (Math.abs(sourceStatus.priorityFreshQuoteCoverage120s - canonicalGate.priorityFreshQuoteCoverage120s) > 0.05) issues.push("source_vs_canonical_priority_coverage_mismatch");
  if (Math.abs(sourceStatus.priorityFreshQuoteCoverage120s - unattendedGate.priorityFreshQuoteCoverage120s) > 0.05) issues.push("source_vs_unattended_priority_coverage_mismatch");

  const result = {
    ok: issues.length === 0 && alignment.ok === true,
    marketContext: {
      isTradingDay: marketDay.isTradingDay === true,
      date: marketDay.date || "",
      reason: marketDay.reason || "",
      source: marketDay.source || "",
      closedPolicy: marketClosed ? "preserve_previous_good_no_formal_entry" : "formal_alignment_required",
    },
    checkedAt: new Date().toISOString(),
    sourceName: SOURCE_NAME,
    contract: "daytrade-source-contract-alignment-websocket-formal-v2",
    formalQuoteRule: "formal daytrade A requires Fugle WebSocket trades/aggregates/candles; REST may seed/backfill only",
    sourceStatus,
    canonicalGate,
    unattendedGate,
    writerCodeRegression,
    writerSupervisorRegression,
    websocketCodeRegression,
    contractProbes: {
      dailyVolumeAlias: {
        ok: dailyAliasProbe.ok,
        endpoint: "fugle_daytrade_daily_volume_avg?select=symbol,avg_volume5,avg5_volume,daily_volume_status&limit=1",
        rows: Array.isArray(dailyAliasProbe.rows) ? dailyAliasProbe.rows.length : 0,
        error: dailyAliasProbe.error || "",
      },
      intradayLatestNRpc: {
        ok: intradayRpcProbe.ok,
        rpc: "get_fugle_daytrade_intraday_1m_latest_n",
        rows: Array.isArray(intradayRpcProbe.rows) ? intradayRpcProbe.rows.length : 0,
        error: intradayRpcProbe.error || "",
      },
      canonicalFutoptGateFields: {
        ok: canonicalFutoptProbe.ok,
        endpoint: `v_fugle_daytrade_canonical_gate?select=${futoptGateSelect}&limit=1`,
        rows: Array.isArray(canonicalFutoptProbe.rows) ? canonicalFutoptProbe.rows.length : 0,
        sample: Array.isArray(canonicalFutoptProbe.rows) ? canonicalFutoptProbe.rows[0] || null : null,
        error: canonicalFutoptProbe.error || "",
      },
      unattendedFutoptGateFields: {
        ok: unattendedFutoptProbe.ok,
        endpoint: `v_fugle_daytrade_unattended_gate_status?select=${futoptGateSelect}&limit=1`,
        rows: Array.isArray(unattendedFutoptProbe.rows) ? unattendedFutoptProbe.rows.length : 0,
        sample: Array.isArray(unattendedFutoptProbe.rows) ? unattendedFutoptProbe.rows[0] || null : null,
        error: unattendedFutoptProbe.error || "",
      },
    },
    issues,
    mode: marketClosed ? "market_closed_previous_good" : alignment.mode,
    verdict: marketClosed ? "MARKET_CLOSED_PRESERVE_PREVIOUS_GOOD" : alignment.verdict,
  };
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}

main().catch((error) => {
  console.error(`[daytrade-source-contract-alignment] ${error.message}`);
  process.exitCode = 2;
});




