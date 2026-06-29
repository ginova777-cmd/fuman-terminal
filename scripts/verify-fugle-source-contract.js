const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const CONTRACT_VERSION = "fugle-source-contract-20260629-01";
const STATIC_ONLY = process.argv.includes("--static-only");
const LIVE = process.argv.includes("--live") || (!STATIC_ONLY && process.env.SUPABASE_SOURCE_CONTRACT_LIVE !== "0");

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
    "quote_derived_1m_current_minute",
    "quote_derived_1m_rows",
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

  const statusRows = await restGet(baseUrl, key, "source_status?source_name=eq.fugle_shared_source&select=source_name,status,updated_at,message,payload&limit=1");
  if (!Array.isArray(statusRows) || !statusRows[0]) {
    issues.push("source_status missing fugle_shared_source row");
  } else {
    const payload = statusRows[0].payload || {};
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
      "today_1m_symbols",
      "today_1m_rows",
      "warmup_candle_count",
      "continuous_candle_count",
      "ready_ma20_continuous_symbols",
      "ready_ma35_continuous_symbols",
      "ready_macd_continuous_symbols",
      "quote_derived_1m_candidate_symbols",
      "quote_derived_1m_rows",
      "quote_derived_1m_current_minute",
      "quote_derived_1m_max_quote_age_seconds",
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
