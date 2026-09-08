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
    if (target === "v_fugle_daytrade_mother_pool") return response(options.poolRows || [{ trade_date: tradeDate, symbol: "2330", name: "台積電", source_name: "fugle_daytrade_source", priority_rank: 1 }]);
    if (target === "fugle_daytrade_quotes_live") {
      calls.quoteQueries.push(url);
      return response([{ symbol: "2330", name: "台積電", price: 100, quote_seen_at: new Date().toISOString(), last_trade_time: new Date().toISOString(), updated_at: new Date().toISOString(), ...options.quoteOverrides }]);
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
    && healthy.receipt?.mother_pool_read_rows === 1
    && healthy.receipt?.mother_pool_capacity_is_hard_gate === false
    && healthy.receipt?.quote_fresh_coverage_120s === 1
    && healthy.receipt?.quote_trade_date_policy === "derive_asia_taipei_from_quote_seen_at_last_trade_time_updated_at"
    && healthy.receipt?.event_evidence?.[0]?.quote_trade_date_ok === true
    && healthy.receipt?.event_evidence?.[0]?.intraday_1m_sample_count === 61;
  checks.quote_table_schema_without_trade_date_supported = healthyCalls.quoteQueries.length > 0
    && healthyCalls.quoteQueries.every((url) => !String(url.searchParams.get("select") || "").split(",").includes("trade_date"))
    && healthyCalls.quoteQueries.every((url) => !url.searchParams.has("trade_date"));

  installFetch(tradeDate, { quoteOverrides: { quote_seen_at: "invalid", last_trade_time: new Date().toISOString() } });
  const fallbackQuoteTimestamp = await readCanonicalDaytradeWater({ tradeDate, symbols: ["2330"], barsPerSymbol: 61 });
  checks.quote_trade_date_uses_first_valid_timestamp = fallbackQuoteTimestamp.ok === true
    && fallbackQuoteTimestamp.receipt?.event_evidence?.[0]?.quote_trade_date_ok === true;

  checks.fixed_read_order = healthyCalls.indexOf("source_status") < healthyCalls.indexOf("v_fugle_daytrade_canonical_gate")
    && healthyCalls.indexOf("v_fugle_daytrade_canonical_gate") < healthyCalls.indexOf("v_fugle_daytrade_unattended_gate_status")
    && healthyCalls.indexOf("v_fugle_daytrade_unattended_gate_status") < healthyCalls.indexOf("v_fugle_daytrade_mother_pool")
    && healthyCalls.indexOf("v_fugle_daytrade_mother_pool") < healthyCalls.indexOf("fugle_daytrade_quotes_live")
    && healthyCalls.indexOf("fugle_daytrade_quotes_live") < healthyCalls.indexOf("get_fugle_daytrade_intraday_1m_latest_n");

  const blockedCalls = installFetch(tradeDate, { canonicalOverrides: { canonical_gate_grade: "D", canonical_gate_status: "not_ready", formal_entry_allowed: false, formal_entry_speed_verdict: "NO" } });
  const blocked = await readCanonicalDaytradeWater({ tradeDate, symbols: ["2330"] });
  checks.gate_failure_stops_before_pool = blocked.ok === false
    && blocked.firstBlocker === "canonical_water_canonical_gate_grade_not_A"
    && !blockedCalls.includes("v_fugle_daytrade_mother_pool")
    && !blockedCalls.includes("fugle_daytrade_quotes_live")
    && !blockedCalls.includes("get_fugle_daytrade_intraday_1m_latest_n");

  installFetch(tradeDate, { poolRows: [{ trade_date: tradeDate, symbol: "2317", name: "鴻海", source_name: "fugle_daytrade_source", priority_rank: 1 }] });
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
