"use strict";

process.env.SUPABASE_ANON_KEY = "contract-test-anon";

const { readCanonicalDaytradeWater, taipeiDate, canonicalRunId } = require("../lib/daytrade-canonical-water-reader");

function response(rows, status = 200) {
  return new Response(JSON.stringify(rows), { status, headers: { "Content-Type": "application/json" } });
}

function gateRow(tradeDate, overrides = {}) {
  return {
    source_name: "fugle_daytrade_source",
    status: "ready",
    canonical_gate_grade: "A",
    canonical_gate_status: "ready",
    formal_entry_allowed: true,
    formal_entry_speed_verdict: "YES",
    scanner_can_run_opening: true,
    formal_source_alignment_ok: true,
    priority_fresh_quote_coverage_120s: 1,
    quote_age_seconds: 1,
    websocket_formal_ready: true,
    websocket_connected: true,
    websocket_authenticated: true,
    websocket_rest_disabled: true,
    websocket_streaming_channels: ["trades", "aggregates", "candles"],
    failed_checks: [],
    trade_date: tradeDate,
    canonical_run_id: canonicalRunId(tradeDate),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function candles(tradeDate, symbol, count = 61) {
  const latest = Date.now() - 60000;
  return Array.from({ length: count }, (_, index) => ({
    symbol,
    market: "TSE",
    trade_date: tradeDate,
    candle_time: new Date(latest - index * 60000).toISOString(),
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1000,
    source: "fugle_websocket_candles",
    synthetic: false,
    updated_at: new Date().toISOString(),
    payload: {},
  }));
}

function installFetch(tradeDate, options = {}) {
  const calls = [];
  calls.quoteQueries = [];
  global.fetch = async (input) => {
    const url = new URL(String(input));
    const target = url.pathname.split("/").pop();
    calls.push(target);
    if (target === "source_status") return response([{ ...gateRow(tradeDate, { status: "ok" }), payload: gateRow(tradeDate, options.sourceOverrides) }]);
    if (target === "v_fugle_daytrade_canonical_gate") return response([gateRow(tradeDate, options.canonicalOverrides)]);
    if (target === "v_fugle_daytrade_unattended_gate_status") return response([gateRow(tradeDate, options.unattendedOverrides)]);
    if (target === "v_fugle_daytrade_mother_pool_v4_1") return response(options.poolRows || [{ trade_date: tradeDate, symbol: "2330", name: "台積電", market: "TSE", mother_pool_rank: 1, priority_reason: "test", pool_source: "terminal_union", pool_layer: "warmup", entry_score: 1, upgrade_score: 0, source_flags: [], source_run_ids: [canonicalRunId(tradeDate)], priority_reasons: ["test"], source_updated_at: new Date().toISOString(), source_freshness: "same_trade_date_current", price: 100, open_price: 99, previous_close: 98, change_percent: 2, total_volume: 1000, trade_value: 100000, quote_seen_at: new Date().toISOString(), quote_age_seconds: 1, last_trade_time: new Date().toISOString(), last_trade_age_seconds: 1, latest_candle_time: new Date().toISOString(), intraday_1m_stale_seconds: 1, ma5: 101, ma10: 100, ma20: 99, ma5_ma10_ma20_bullish: true, contract_version: "4.1.0", canonical_run_id: canonicalRunId(tradeDate), updated_at: new Date().toISOString() }]);
    if (target === "fugle_daytrade_quotes_live") {
      calls.quoteQueries.push(url);
      return response([{ symbol: "2330", trade_date: tradeDate, name: "台積電", price: 100, quote_seen_at: new Date().toISOString(), last_trade_time: new Date().toISOString(), updated_at: new Date().toISOString(), ...options.quoteOverrides }]);
    }
    if (target === "v_fugle_daytrade_intraday_1m_status") return response([{ symbol: "2330", latest_candle_time: new Date(Date.now() - 60000).toISOString(), today_candle_count: 61, updated_at: new Date().toISOString() }]);
    if (target === "get_fugle_daytrade_intraday_1m_latest_n") return response(candles(tradeDate, "2330"));
    return response([], 404);
  };
  return calls;
}

async function main() {
  const tradeDate = taipeiDate();
  const checks = {};

  const healthyCalls = installFetch(tradeDate);
  const healthy = await readCanonicalDaytradeWater({ tradeDate, symbols: ["2330"], barsPerSymbol: 61 });
  checks.healthy_contract_complete = healthy.ok === true
    && healthy.receipt?.complete === true
    && healthy.receipt?.status === "complete"
    && healthy.receipt?.canonical_run_id === canonicalRunId(tradeDate)
    && healthy.receipt?.contract_version === "4.1.0"
    && healthy.receipt?.sources?.mother_pool === "v_fugle_daytrade_mother_pool_v4_1"
    && healthy.receipt?.mother_pool_read_rows === 1
    && healthy.receipt?.mother_pool_capacity_is_hard_gate === false
    && healthy.receipt?.quote_fresh_coverage_120s === 1
    && healthy.receipt?.quote_trade_date_policy === "require_explicit_fugle_daytrade_quotes_live_trade_date_v1"
    && healthy.receipt?.event_evidence?.[0]?.quote_trade_date_ok === true
    && healthy.receipt?.event_evidence?.[0]?.intraday_1m_sample_count === 61;
  checks.quote_table_explicit_trade_date_required = healthyCalls.quoteQueries.length > 0
    && healthyCalls.quoteQueries.every((url) => String(url.searchParams.get("select") || "").split(",").includes("trade_date"))
    && healthyCalls.quoteQueries.every((url) => url.searchParams.get("trade_date") === `eq.${tradeDate}`);

  installFetch(tradeDate, { quoteOverrides: { trade_date: "2026-09-07", quote_seen_at: new Date().toISOString(), last_trade_time: new Date().toISOString() } });
  const wrongExplicitDate = await readCanonicalDaytradeWater({ tradeDate, symbols: ["2330"], barsPerSymbol: 61 });
  checks.wrong_explicit_quote_trade_date_fails_closed = wrongExplicitDate.ok === false
    && wrongExplicitDate.failedChecks.includes("canonical_water_mother_pool_quote_coverage_below_095")
    && wrongExplicitDate.failedChecks.includes("canonical_water_event_quote_not_ready:2330");

  checks.fixed_read_order = healthyCalls.indexOf("source_status") < healthyCalls.indexOf("v_fugle_daytrade_canonical_gate")
    && healthyCalls.indexOf("v_fugle_daytrade_canonical_gate") < healthyCalls.indexOf("v_fugle_daytrade_unattended_gate_status")
    && healthyCalls.indexOf("v_fugle_daytrade_unattended_gate_status") < healthyCalls.indexOf("v_fugle_daytrade_mother_pool_v4_1")
    && healthyCalls.indexOf("v_fugle_daytrade_mother_pool_v4_1") < healthyCalls.indexOf("fugle_daytrade_quotes_live")
    && healthyCalls.indexOf("fugle_daytrade_quotes_live") < healthyCalls.indexOf("get_fugle_daytrade_intraday_1m_latest_n");

  const blockedCalls = installFetch(tradeDate, { canonicalOverrides: { canonical_gate_grade: "D", canonical_gate_status: "not_ready", formal_entry_allowed: false, formal_entry_speed_verdict: "NO" } });
  const blocked = await readCanonicalDaytradeWater({ tradeDate, symbols: ["2330"] });
  checks.gate_failure_stops_before_pool = blocked.ok === false
    && blocked.firstBlocker === "canonical_water_canonical_gate_grade_not_A"
    && !blockedCalls.includes("v_fugle_daytrade_mother_pool_v4_1")
    && !blockedCalls.includes("fugle_daytrade_quotes_live")
    && !blockedCalls.includes("get_fugle_daytrade_intraday_1m_latest_n");

  installFetch(tradeDate, {
    sourceOverrides: { status: "degraded", canonical_gate_grade: "B", canonical_gate_status: "not_ready", formal_entry_allowed: false, formal_entry_speed_verdict: "NO", priority_fresh_quote_coverage_120s: 0.75 },
    canonicalOverrides: { canonical_gate_grade: "D", canonical_gate_status: "not_ready", formal_entry_allowed: false, formal_entry_speed_verdict: "NO", priority_fresh_quote_coverage_120s: 0.75 },
    unattendedOverrides: { canonical_gate_grade: "D", canonical_gate_status: "not_ready", formal_entry_allowed: false, formal_entry_speed_verdict: "NO", priority_fresh_quote_coverage_120s: 0.75 },
  });
  const telegramObservation = await readCanonicalDaytradeWater({ tradeDate, symbols: [], telegramObservation: true });
  checks.telegram_observation_uses_per_symbol_gate = telegramObservation.ok === true
    && telegramObservation.receipt?.reader_mode === "telegram_observation_per_symbol_fail_closed"
    && telegramObservation.receipt?.contract_version === "4.1.0"
    && telegramObservation.receipt?.market_event_sync_coverage_120s === 1;

  installFetch(tradeDate, { poolRows: [{ trade_date: tradeDate, symbol: "2317", name: "鴻海", market: "TSE", mother_pool_rank: 1, source_updated_at: new Date().toISOString(), source_freshness: "same_trade_date_current", contract_version: "4.1.0", canonical_run_id: canonicalRunId(tradeDate) }] });
  const missingMember = await readCanonicalDaytradeWater({ tradeDate, symbols: ["2330"] });
  checks.event_must_be_in_current_mother_pool = missingMember.ok === false
    && missingMember.failedChecks.includes("canonical_water_event_not_in_mother_pool:2330");

  installFetch(tradeDate, { quoteOverrides: { trade_date: "", quote_seen_at: "", last_trade_time: "", updated_at: "", payload: {} } });
  const missingQuoteDate = await readCanonicalDaytradeWater({ tradeDate, symbols: ["2330"] });
  checks.missing_quote_trade_date_fails_closed = missingQuoteDate.ok === false
    && missingQuoteDate.failedChecks.includes("canonical_water_mother_pool_quote_coverage_below_095")
    && missingQuoteDate.failedChecks.includes("canonical_water_event_quote_not_ready:2330");

  const failedChecks = Object.entries(checks).filter(([, value]) => value !== true).map(([name]) => name);
  console.log(JSON.stringify({
    ok: failedChecks.length === 0,
    contract: "daytrade_canonical_water_reader_contract_verifier_v1",
    checks,
    failed_checks: failedChecks,
    first_blocker: failedChecks[0] || null,
    read_only: true,
  }, null, 2));
  process.exitCode = failedChecks.length ? 1 : 0;
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, first_blocker: "contract_verifier_exception", error: error?.stack || error?.message || String(error) }, null, 2));
  process.exitCode = 1;
});
