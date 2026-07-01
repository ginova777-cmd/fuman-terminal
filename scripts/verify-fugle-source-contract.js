const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const CONTRACT_VERSION = "fugle-source-contract-20260629-01";
const STATIC_ONLY = process.argv.includes("--static-only");
const LIVE = process.argv.includes("--live") || (!STATIC_ONLY && process.env.SUPABASE_SOURCE_CONTRACT_LIVE !== "0");
const LIVE_MIN_FRESH_QUOTE_COVERAGE_120S = Number(process.env.FUGLE_SOURCE_CONTRACT_MIN_FRESH_QUOTE_COVERAGE_120S || 0.9);
const LIVE_MIN_INTRADAY_1M_COVERAGE = Number(process.env.FUGLE_SOURCE_CONTRACT_MIN_INTRADAY_1M_COVERAGE || 1);
const LIVE_MAX_INTRADAY_1M_STALE_SECONDS = Number(process.env.FUGLE_SOURCE_CONTRACT_MAX_INTRADAY_1M_STALE_SECONDS || 120);

const issues = [];
const EMPTY_PAYLOAD_OK = new Set(["scanner_block_reason"]);

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function readSecret(name) {
  for (const file of [
    path.join(RUNTIME_DIR, "secrets", name),
    path.join(ROOT, "secrets", name),
  ]) {
    try {
      const value = fs.readFileSync(file, "utf8").trim();
      if (value) return value;
    } catch {}
  }
  return "";
}

function requireIncludes(file, markers) {
  const text = read(file);
  for (const marker of markers) {
    if (!text.includes(marker)) issues.push(`${file} missing ${marker}`);
  }
}

function requireRegex(file, regex, label) {
  if (!regex.test(read(file))) issues.push(`${file} missing ${label}`);
}

function forbidRegex(file, regex, label) {
  if (regex.test(read(file))) issues.push(`${file} must not contain ${label}`);
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    if (value === undefined || value === null || String(value).trim() === "") continue;
    const number = Number(String(value ?? "").replace(/[,+%]/g, "").trim());
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function boolValue(value) {
  if (value === true) return true;
  if (value === false) return false;
  return /^(1|true|yes|ready|ok)$/i.test(String(value ?? "").trim());
}

function staticChecks() {
  requireIncludes("ops/public-slot/FugleSourceResourceContract.sql", [
    CONTRACT_VERSION,
    "create table if not exists public.source_status",
    "create table if not exists public.fugle_source_coverage",
    "create or replace view public.v_fugle_source_contract_health",
    "source_contract_version",
    "writer_version",
    "quote_status",
    "permission_status",
    "preopen_status",
    "intraday_1m_status",
    "daily_volume_status",
    "fresh_quotes_120s",
    "fresh_quote_coverage_120s",
    "mother_pool_source",
    "mother_pool_symbols",
    "quote_derived_1m_full_universe",
    "quote_derived_1m_opening_backfill_rows",
    "intraday_1m_fresh_hard_seconds",
    "quote_fresh_coverage_low",
    "quote_derived_not_full_universe",
    "today_1m_symbols",
    "today_1m_rows",
    "warmup_candle_count",
    "continuous_candle_count",
    "ready_ge_20_symbols",
    "ready_ge_35_symbols",
    "ready_ma20_continuous_symbols",
    "ready_ma35_continuous_symbols",
    "ready_macd_continuous_symbols",
    "ready_ma20_continuous",
    "ready_ma35_continuous",
    "ready_macd_continuous",
    "top_movers_ready20_count",
    "top_movers_ready35_count",
    "scanner_can_run_quote_only",
    "scanner_can_run_opening",
    "scanner_can_run_ma20",
    "scanner_can_run_ma35",
    "scanner_can_run_full_intraday",
    "scanner_block_reason",
    "latest_candle_time_taipei",
    "v_fugle_quotes_commonstock_active",
    "fugle_quotes_live",
    "stock_tickers",
    "fugle_daily_volume_avg",
    "fugle_daily_volume",
    "fugle_intraday_1m",
    "v_fugle_intraday_1m_status",
    "get_fugle_intraday_1m_latest_n",
    "v_daytrade_hot_symbol_readiness",
    "volume_strategy_usable",
    "synthetic",
    "v_stock_future_live_contract",
    "v_strategy12_stock_future_contract_health",
    "fugle_preopen_snapshot",
    "fugle_preopen_snapshot_history",
    "market_calendar",
  ]);

  requireIncludes("ops/public-slot/SupabasePublicSlotSource.ps1", [
    "Write-PublicSlotSourceCoverageSnapshot",
    "fugle_source_coverage",
    "writer_observed_at",
    "quote_status",
    "permission_status",
    "intraday_1m_status",
    "ready_ge_20_symbols",
    "ready_ge_35_symbols",
    "warmup_candle_count",
    "continuous_candle_count",
    "ready_ma20_continuous_symbols",
    "ready_ma35_continuous_symbols",
    "ready_macd_continuous_symbols",
    "fresh_quotes_120s",
    "scanner_can_run_ma20",
    "scanner_block_reason",
    "volume_strategy_usable",
    "synthetic",
    "latest_candle_time_taipei",
  ]);

  requireIncludes("ops/public-slot/Run-PublicSlotSharedSource.ps1", [
    CONTRACT_VERSION,
    "public-slot-shared-source-20260629-01",
    "source_contract_version",
    "writer_version",
    "writer_pid",
    "writer_computer",
    "writer_owner_computer",
    "quote_status",
    "permission_status",
    "preopen_status",
    "intraday_1m_status",
    "daily_volume_status",
    "Test-Intraday1mMa20Required",
    "Get-PublicSlotPermissionProbe",
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
    "FUGLE_COLLECTOR_OPENING_BOOST_BATCH_SIZE",
    "progressive quote fill",
    "FUGLE_COLLECTOR_FINMIND_RECOVERY_ENABLED",
    "FugleCollectorFinMindRecoveryEnabled",
    "Add-FreshQuoteReadthrough",
    "Get-FreshPublicSlotQuoteRows",
    "fresh_quote_readthrough_rows",
    "rest_quote_effective_batch_size",
    "WriterOwnerComputer",
    "FUMAN_PUBLIC_SLOT_WRITER_OWNER_COMPUTER",
    "Assert-PublicSlotWriterOwner",
    "writer_owner_computer",
    "quoteFullCoverageFloor",
    "Get-ActiveCommonStockSymbols",
    "stock_universe",
    "mother_pool_source",
    "quote_derived_1m_full_universe",
    "quote_derived_1m_current_minute",
    "quote_derived_1m_rows",
    "quote_derived_1m_opening_backfill_rows",
    "MinutePayload",
    "Get-ObjectPayloadValue",
    "if ($readyMa20 -lt $readyMa35)",
    "-MinutePayload $minutePayload",
    "fresh_quote_coverage_120s",
    "volume_strategy_usable",
    "scanner_can_run_ma20",
    "scanner_block_reason",
    "ready_ge_20_symbols",
    "ready_ge_35_symbols",
    "warmup_candle_count",
    "continuous_candle_count",
    "ready_ma20_continuous_symbols",
    "ready_ma35_continuous_symbols",
    "ready_macd_continuous_symbols",
    "ready_ge_80_symbols",
    "ready_ge_200_symbols",
    "latest_candle_time_taipei",
    "Write-PublicSlotSourceCoverageSnapshot",
    "Get-Strategy2ReadyRefreshMaxPages",
    "strategy2 ready cache partial refresh",
  ]);

  for (const [name, text] of [
    ["Start-PublicSlotSharedSource.cmd", read("ops/public-slot/Start-PublicSlotSharedSource.cmd")],
    ["Start-Strategy2ReadinessSource.cmd", read("ops/public-slot/Start-Strategy2ReadinessSource.cmd")],
  ]) {
    for (const marker of ["-RestQuoteBatchSize 240", "-FugleCollectorBatchSize 320", "-FugleCollectorConcurrency 4", "-FugleCollectorRequestDelayMilliseconds 20"]) {
      if (text.includes(marker)) issues.push(`${name} must not pass old high-rate public-slot quote setting ${marker}`);
    }
  }

  requireIncludes("ops/public-slot/SupabasePublicSlotSource.ps1", [
    "Write-PublicSlotFutoptQuotesLive",
    "underlying_symbol",
    "underlying_name",
    "hasUnderlyingColumns",
    "ConvertTo-PublicSlotPayloadHashtable",
  ]);

  requireIncludes("ops/public-slot/SharedSourceReadOnlyScorecardPatch_20260701.sql", [
    "v_fuman_shared_source_readonly_scorecard",
    "fresh_quote_readthrough_rows",
    "fresh_quote_readthrough_merged_rows",
    "rest_quote_effective_batch_size",
    "rest_quote_unsupported_symbols",
    "unsupported_trade_date",
    "opening_boost_active",
    "futopt_stock_this_loop",
    "writer_owner_computer",
    "collector_primary_source",
    "collector_fallback_source",
    "finmind_recovery_fetched",
    "finmind_recovery_error",
    "finmind_recovery_cooldown_until",
    "rest_quote_unsupported_symbols",
    "rest_quote_unsupported_this_loop",
    "websocket_status",
    "readonly_verdict",
    "grant select",
  ]);

  requireIncludes("ops/public-slot/Test-PublicSlotSharedSourceReadOnly.ps1", [
    "v_fuman_shared_source_readonly_scorecard",
    "mode = \"read-only\"",
    "fresh_quote_coverage_120s",
    "scanner_can_run_quote_only",
    "scanner_can_run_opening",
    "intraday_1m_stale_seconds",
    "ready_ma35_continuous",
    "futopt_stock_mapped",
    "opening_boost_not_active_while_coverage_low",
    "rest_quote_rate_limited_while_coverage_low",
    "fresh_quote_readthrough_not_running",
    "rest_quote_effective_batch_zero",
  ]);

  requireIncludes("scripts/fugle-websocket-collector.js", [
    "OPENING_BOOST_START",
    "OPENING_BOOST_END",
    "OPENING_BOOST_BATCH_SIZE",
    "FINMIND_RECOVERY_ENABLED",
    "fetchFinMindRecoveryQuotes",
    "finmindRecoveryFetched",
    "effectiveCollectorConfig",
    "openingBoostActive",
    "REQUEST_TIMEOUT_MS",
    "REQUEST_RETRIES",
  ]);

  requireIncludes("ops/public-slot/fugle-websocket-collector.js", [
    "OPENING_BOOST_START",
    "OPENING_BOOST_END",
    "OPENING_BOOST_BATCH_SIZE",
    "FINMIND_RECOVERY_ENABLED",
    "fetchFinMindRecoveryQuotes",
    "finmindRecoveryFetched",
    "effectiveCollectorConfig",
    "openingBoostActive",
    "REQUEST_TIMEOUT_MS",
    "REQUEST_RETRIES",
  ]);

  requireIncludes("ops/public-slot/Watchdog-PublicSlotSharedSource.ps1", [
    "MaxIntraday1mStaleSeconds",
    "intraday_1m_stale_seconds",
    "Intraday1mStaleSeconds",
    "Start-SharedSourceTask -Reason",
    "-Restart",
    "schtasks /End /TN $TaskName",
  ]);

  requireIncludes("ops/public-slot/Strategy2Readiness100SourcePatch.sql", [
    "warmup_candle_count",
    "continuous_candle_count",
    "ready_ma20_continuous",
    "ready_ma35_continuous",
    "ready_macd_continuous",
    "public.v_fugle_intraday_1m_status",
  ]);

  requireIncludes("lib/supabase-public-slot.js", [
    "warmup_candle_count",
    "continuous_candle_count",
    "ready_ma20_continuous",
    "ready_ma35_continuous",
    "ready_macd_continuous",
  ]);

  requireIncludes("scripts/scan-intraday-signals.js", [
    "ma20Window",
    "ma20Source",
    "row.minute <= targetMinute",
    "continuous_candle_count",
    "ready_ma35_continuous",
  ]);

  requireIncludes("scripts/replay-strategy2-full-window-from-1m.js", [
    "dayCandles",
    "allCandles",
    "ma20Source",
  ]);

  requireIncludes("scripts/verify-publish-gate.js", [
    "verify-fugle-source-contract.js",
    CONTRACT_VERSION,
    "FugleSourceResourceContract.sql",
  ]);

  requireRegex("package.json", /"verify:fugle-source-contract"\s*:/, "verify:fugle-source-contract script");
  requireRegex("package.json", /"verify:shared-source-readonly"\s*:/, "verify:shared-source-readonly script");

  for (const file of [
    "ops/public-slot/Strategy2Readiness100SourcePatch.sql",
    "ops/public-slot/Strategy2ReadinessContractCache.sql",
    "ops/public-slot/SupabasePublicSlot-StrategyViewsAndHealthPatch.sql",
    "lib/supabase-public-slot.js",
    "scripts/verify-strategy2-battle-state.js",
  ]) {
    forbidRegex(file, /today_candle_count\W*>=\W*(20|35)|rows_today\W*>=\W*(20|35)/, "today-only candle count as MA readiness");
    forbidRegex(file, /intraday_1m_not_ready_ge_35/, "old intraday_1m_not_ready_ge_35 reason");
  }
  forbidRegex(
    "ops/public-slot/Run-PublicSlotSharedSource.ps1",
    /v_fugle_intraday_1m_status\?select=\$statusSelect&has_today_data=eq\.true/,
    "has_today_data filter for MA readiness REST fallback"
  );
  forbidRegex(
    "ops/public-slot/FugleSourceLiveRepairB6_Intraday1mCoverageStatsRpc_20260630.sql",
    /today_candle_count\s*>\s*0\s+and\s+continuous_candle_count\s*>=\s*(20|35|80|200)/i,
    "today-only coverage RPC MA readiness"
  );
  forbidRegex(
    "ops/public-slot/SharedSourceReadOnlyScorecardPatch_20260701.sql",
    /insert\s+into|update\s+public\.source_status|delete\s+from|truncate\s+/i,
    "data writes in read-only shared source scorecard"
  );
  forbidRegex(
    "ops/public-slot/Test-PublicSlotSharedSourceReadOnly.ps1",
    /Write-PublicSlot|Invoke-PublicSlotUpsert|Invoke-RestMethod[\s\S]{0,120}-Method\s+(Post|Patch|Delete)|Set-Content|Add-Content|Out-File/i,
    "writes in read-only shared source verifier"
  );
}

async function restGet(baseUrl, key, pathAndQuery) {
  const response = await fetch(`${baseUrl}/rest/v1/${pathAndQuery}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`GET ${pathAndQuery} HTTP ${response.status} ${text.slice(0, 240)}`.trim());
  if (!text.trim()) return [];
  return JSON.parse(text);
}

async function rpc(baseUrl, key, name, body) {
  const response = await fetch(`${baseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`RPC ${name} HTTP ${response.status} ${text.slice(0, 240)}`.trim());
  if (!text.trim()) return null;
  return JSON.parse(text);
}

function requirePayload(payload, keys, sourceName) {
  for (const key of keys) {
    if (payload?.[key] === undefined || payload?.[key] === null || (!EMPTY_PAYLOAD_OK.has(key) && String(payload[key]).trim() === "")) {
      issues.push(`${sourceName} payload missing ${key}`);
    }
  }
}

async function liveChecks() {
  const baseUrl = String(
    process.env.SUPABASE_URL ||
    process.env.FUMAN_SUPABASE_URL ||
    readSecret("supabase-url.txt") ||
    readSecret("terminal-supabase-url.txt") ||
    "https://cpmpfhbzutkiecccekfr.supabase.co"
  ).replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.FUMAN_SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.FUMAN_SUPABASE_ANON_KEY ||
    readSecret("supabase-service-role-key.txt") ||
    readSecret("terminal-supabase-service-role-key.txt") ||
    readSecret("supabase-anon-key.txt") ||
    readSecret("terminal-supabase-key.txt");

  if (!key) {
    console.log("[fugle-source-contract] live checks skipped: missing Supabase key");
    return;
  }

  let sourceRegularSession = false;
  const statusRows = await restGet(baseUrl, key, "source_status?source_name=eq.fugle_shared_source&select=source_name,status,updated_at,message,payload&limit=1");
  if (!Array.isArray(statusRows) || !statusRows[0]) {
    issues.push("source_status missing fugle_shared_source row");
  } else {
    const payload = statusRows[0].payload || {};
    sourceRegularSession = String(payload.session || "").toLowerCase() === "regular";
    requirePayload(payload, [
      "source_contract_version",
      "writer_version",
      "build_id",
      "writer_pid",
      "quote_status",
      "permission_status",
      "preopen_status",
      "intraday_1m_status",
      "daily_volume_status",
      "quote_age_seconds",
      "last_quote_at",
      "latest_candle_time",
      "latest_candle_time_taipei",
      "intraday_1m_stale_seconds",
      "ready_ge_20_symbols",
      "ready_ge_35_symbols",
      "ready_ge_80_symbols",
      "ready_ge_200_symbols",
      "fresh_quotes_120s",
      "fresh_quote_coverage_120s",
      "today_1m_symbols",
      "today_1m_rows",
      "warmup_candle_count",
      "continuous_candle_count",
      "ready_ma20_continuous_symbols",
      "ready_ma35_continuous_symbols",
      "ready_macd_continuous_symbols",
      "quote_derived_1m_candidate_symbols",
      "mother_pool_source",
      "mother_pool_symbols",
      "quote_derived_1m_full_universe",
      "quote_derived_1m_rows",
      "quote_derived_1m_current_rows",
      "quote_derived_1m_current_minute",
      "quote_derived_1m_max_quote_age_seconds",
      "quote_derived_1m_opening_backfill_minutes",
      "quote_derived_1m_opening_backfill_rows",
      "quote_derived_1m_opening_backfill_symbols",
      "intraday_1m_fresh_target_seconds",
      "intraday_1m_fresh_hard_seconds",
      "direct_1m_prewarm_enabled",
      "direct_1m_prewarm_bars_per_symbol",
      "direct_1m_prewarm_target_symbols",
      "direct_1m_prewarm_completed_symbols",
      "direct_1m_prewarm_rows",
      "direct_1m_prewarm_complete",
      "daily_volume_ready_symbols",
      "top_movers_ready20_count",
      "top_movers_ready35_count",
      "scanner_can_run_quote_only",
      "scanner_can_run_opening",
      "scanner_can_run_ma20",
      "scanner_can_run_ma35",
      "scanner_can_run_full_intraday",
      "scanner_block_reason",
      "quotes",
      "active_symbols",
      "eligible_quote_rows",
      "eligible_quote_coverage",
      "preopen",
      "futopt",
      "futopt_quotes",
      "daily_volume_rows",
      "daily_volume_avg_rows",
      "degraded_but_usable_for_intraday",
    ], "source_status:fugle_shared_source");
    if (payload.source_contract_version !== CONTRACT_VERSION) {
      issues.push(`source_status source_contract_version mismatch: ${payload.source_contract_version || "(missing)"}`);
    }
    const readyMa20 = Number(payload.ready_ma20_continuous_symbols || payload.ready_ge_20_symbols || 0);
    const readyMa35 = Number(payload.ready_ma35_continuous_symbols || payload.ready_ge_35_symbols || 0);
    const readyMacd = Number(payload.ready_macd_continuous_symbols || 0);
    const readyGe80 = Number(payload.ready_ge_80_symbols || 0);
    if (readyMa35 > readyMa20) {
      issues.push(`source_status ready_ma20_continuous_symbols ${readyMa20} below ready_ma35_continuous_symbols ${readyMa35}`);
    }
    if (readyGe80 > readyMacd) {
      issues.push(`source_status ready_macd_continuous_symbols ${readyMacd} below ready_ge_80_symbols ${readyGe80}`);
    }
    if (sourceRegularSession) {
      const activeSymbols = firstFiniteNumber(payload.active_symbols, payload.mother_pool_symbols, payload.eligible_symbols, payload.seeded_symbols);
      const expectedIntradaySymbols = activeSymbols > 0 ? activeSymbols : firstFiniteNumber(payload.today_1m_symbols, payload.intraday_1m_symbols_today);
      const today1mSymbols = firstFiniteNumber(payload.today_1m_symbols, payload.intraday_1m_symbols_today);
      const staleSeconds = firstFiniteNumber(payload.intraday_1m_stale_seconds, 999999);
      const freshQuoteCoverage120s = firstFiniteNumber(payload.fresh_quote_coverage_120s, payload.eligible_quote_coverage);
      const hasCandidateLimit = payload.quote_derived_1m_candidate_limit !== undefined && payload.quote_derived_1m_candidate_limit !== null;
      const fullUniverse = boolValue(payload.quote_derived_1m_full_universe) || (hasCandidateLimit && firstFiniteNumber(payload.quote_derived_1m_candidate_limit) <= 0);
      const minIntradaySymbols = Math.ceil(expectedIntradaySymbols * LIVE_MIN_INTRADAY_1M_COVERAGE);
      const intradayStatus = String(payload.intraday_1m_status || "").toLowerCase();
      if (freshQuoteCoverage120s < LIVE_MIN_FRESH_QUOTE_COVERAGE_120S) {
        issues.push(`source_status fresh_quote_coverage_120s ${freshQuoteCoverage120s} < ${LIVE_MIN_FRESH_QUOTE_COVERAGE_120S}`);
      }
      if (!fullUniverse) {
        issues.push("source_status quote_derived_1m_full_universe is not true during regular session");
      }
      if (expectedIntradaySymbols >= 1000 && today1mSymbols < minIntradaySymbols) {
        issues.push(`source_status today_1m_symbols ${today1mSymbols}/${expectedIntradaySymbols} below live gate ${LIVE_MIN_INTRADAY_1M_COVERAGE}`);
      }
      if (expectedIntradaySymbols >= 1000 && readyMa35 < minIntradaySymbols && boolValue(payload.intraday_1m_ma35_required)) {
        issues.push(`source_status ready_ma35_continuous_symbols ${readyMa35}/${expectedIntradaySymbols} below live gate ${LIVE_MIN_INTRADAY_1M_COVERAGE}`);
      }
      if (staleSeconds > LIVE_MAX_INTRADAY_1M_STALE_SECONDS) {
        issues.push(`source_status intraday_1m_stale_seconds ${staleSeconds} > ${LIVE_MAX_INTRADAY_1M_STALE_SECONDS}`);
      }
      if (intradayStatus && intradayStatus !== "ready") {
        issues.push(`source_status intraday_1m_status=${payload.intraday_1m_status}`);
      }
      if (boolValue(payload.intraday_1m_ma35_required) && !boolValue(payload.scanner_can_run_ma35)) {
        issues.push("source_status scanner_can_run_ma35 is false while MA35 is required");
      }
    }
  }

  const probes = [
    ["fugle_source_coverage", "source_name,checked_at,status,quote_status,permission_status,intraday_1m_status,daily_volume_status,active_symbols,quotes_symbols,fresh_quotes_120s,today_1m_symbols,today_1m_rows,warmup_candle_count,continuous_candle_count,intraday_1m_symbols_today,ready_ge_20_symbols,ready_ge_35_symbols,ready_ma20_continuous_symbols,ready_ma35_continuous_symbols,ready_macd_continuous_symbols,top_movers_ready20_count,top_movers_ready35_count,scanner_can_run_ma20,scanner_block_reason,latest_candle_time_taipei&source_name=eq.fugle_shared_source&order=checked_at.desc&limit=1"],
    ["v_fugle_quotes_commonstock_active", "symbol,name,market,updated_at,price,total_volume,bid_volume,ask_volume,stock_type,session&limit=1"],
    ["fugle_quotes_live", "symbol,name,market,updated_at,price,total_volume,bid_volume,ask_volume,payload&limit=1"],
    ["stock_tickers", "symbol,name,market,stock_type,industry,type,is_etf,is_suspended,updated_at,payload&limit=1"],
    ["fugle_daily_volume", "symbol,market,trade_date,volume,updated_at,payload&limit=1"],
    ["fugle_intraday_1m", "symbol,market,trade_date,candle_time,open,high,low,close,volume,updated_at,payload&order=updated_at.desc&limit=1"],
    ["v_fugle_intraday_1m_status", "symbol,market,latest_candle_time,latest_candle_time_taipei,today_candle_count,warmup_candle_count,continuous_candle_count,candle_count,has_today_data,ready_ma20_continuous,ready_ma35_continuous,ready_macd_continuous,ready_ge_20,ready_ge_35,ready_ge_80,ready_ge_200,updated_at&limit=1"],
    ["v_daytrade_hot_symbol_readiness", "symbol,name,price,open_price,amplitude_from_open,total_volume,trade_value,avg_volume5,today_candle_count,warmup_candle_count,continuous_candle_count,ready_ma20_continuous,ready_ma35_continuous,ready_macd_continuous,latest_candle_time_taipei,reason&limit=1"],
    ["market_calendar", "trade_date,market,is_open,session,note,updated_at,payload&limit=1"],
  ];

  for (const [table, query] of probes) {
    try {
      const rows = await restGet(baseUrl, key, `${table}?select=${query}`);
      if (table === "fugle_intraday_1m" && Array.isArray(rows) && rows[0]) {
        const payload = rows[0].payload || {};
        for (const marker of ["source", "synthetic", "volume_strategy_usable"]) {
          if (payload[marker] === undefined || payload[marker] === null) {
            issues.push(`fugle_intraday_1m latest payload missing ${marker}`);
          }
        }
      }
    } catch (error) {
      issues.push(`${table} probe failed: ${error.message}`);
    }
  }

  for (const optionalProbe of [
    ["fugle_daily_volume_avg", "symbol,market,trade_date,volume,avg5_volume,avg_volume5,updated_at,payload&limit=1"],
    ["v_stock_future_live_contract", "trade_date,symbol,stock_name,future_symbol,source_symbol,futopt_last_price,futopt_change_percent,futopt_total_volume,futopt_updated_at,txf_future_symbol,txf_change_percent,relative_to_txf_percent,futopt_fresh_60s,txf_fresh_60s,source_status,reason,updated_at&limit=1"],
    ["v_strategy12_stock_future_contract_health", "contract_rows,ready_rows,stale_rows,not_ready_rows,star_precheck_rows,strategy2_futopt_gate_rows,latest_futopt_updated_at,latest_txf_updated_at,source_status,reason,checked_at&limit=1"],
    ["fugle_preopen_snapshot", "symbol,name,market,session,updated_at,reference_price,trial_price,is_trial,is_limit_up_bid,best_bid_price,best_ask_price,bid_volume,ask_volume,bid_levels_json,ask_levels_json,payload&limit=1"],
    ["fugle_preopen_snapshot_history", "symbol,name,market,session,updated_at,reference_price,trial_price,is_trial,is_limit_up_bid,best_bid_price,best_ask_price,bid_volume,ask_volume,bid_levels_json,ask_levels_json,payload&limit=1"],
  ]) {
    try {
      await restGet(baseUrl, key, `${optionalProbe[0]}?select=${optionalProbe[1]}`);
    } catch (error) {
      issues.push(`${optionalProbe[0]} probe failed: ${error.message}`);
    }
  }

  try {
    await rpc(baseUrl, key, "get_fugle_intraday_1m_latest_n", { symbols: ["2330"], bars_per_symbol: 1 });
  } catch (error) {
    issues.push(`get_fugle_intraday_1m_latest_n probe failed: ${error.message}`);
  }

  if (sourceRegularSession) {
    try {
      const readinessRows = await restGet(baseUrl, key, "v_strategy2_readiness_status?select=status,reason,detection_expected_count,intraday_1m_ready_count,intraday_1m_coverage,strategy2_ready_100,checked_at&limit=1");
      const row = readinessRows[0] || {};
      const expected = firstFiniteNumber(row.detection_expected_count);
      const ready = firstFiniteNumber(row.intraday_1m_ready_count);
      const minReady = Math.ceil(expected * LIVE_MIN_INTRADAY_1M_COVERAGE);
      if (expected >= 1000 && ready < minReady) {
        issues.push(`v_strategy2_readiness_status intraday_1m_ready_count ${ready}/${expected} below live gate ${LIVE_MIN_INTRADAY_1M_COVERAGE}`);
      }
    } catch (error) {
      issues.push(`v_strategy2_readiness_status probe failed: ${error.message}`);
    }
  }
}

(async () => {
  staticChecks();
  if (LIVE) await liveChecks();

  if (issues.length) {
    console.error("[fugle-source-contract] failed");
    for (const issue of issues) console.error("- " + issue);
    process.exit(1);
  }
  console.log(`[fugle-source-contract] ok version=${CONTRACT_VERSION} live=${LIVE && !STATIC_ONLY}`);
})().catch((error) => {
  console.error("[fugle-source-contract] failed");
  console.error(error.stack || error.message);
  process.exit(1);
});
