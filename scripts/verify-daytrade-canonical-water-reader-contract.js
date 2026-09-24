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
    volume_strategy_usable: true,
    updated_at: new Date().toISOString(),
    payload: {},
  }));
}

function v41PoolRow(tradeDate, overrides = {}) {
  const now = new Date().toISOString();
  return {
    contract_version: "4.1.0", trade_date: tradeDate, canonical_run_id: canonicalRunId(tradeDate),
    writer_run_id: `writer-${tradeDate}`, generation_id: `generation-${tradeDate}`, symbol: "2330", name: "台積電", market: "TSE",
    source_name: "fugle_daytrade_source", source_trade_date: tradeDate, source_updated_at: now, source_freshness: "same_trade_date_current", updated_at: now,
    mother_pool_rank: 1, priority_rank: 1, mother_pool_score: 90, priority_score: 88, entry_score: 87, upgrade_score: 1,
    priority_reason: "test", priority_reasons: ["test"], mother_reason: "test", mother_source: "writer", pool_source: "terminal_union", pool_layer: "warmup",
    source_flags: ["test_source"], source_run_ids: [canonicalRunId(tradeDate)], mother_readiness_status: "ready", is_formal_entry_eligible: true,
    price: 100, open_price: 99, previous_close: 98, high_price: 101, low_price: 97, change_percent: 2, total_volume: 1000, trade_value: 100000,
    avg_volume5: 900, quote_trade_date: tradeDate, quote_seen_at: now, quote_age_seconds: 1, last_trade_time: now, last_trade_age_seconds: 1,
    latest_candle_time: now, intraday_1m_stale_seconds: 1, mother_updated_at: now, pool_updated_trade_date: tradeDate,
    sector_name: "半導體", sector_strength_score: 80, sector_member_active_count: 10, industry_signal_fast_injected: false,
    industry_signal_fast_inject_industries: [], ma5: 101, ma10: 100, ma20: 99, ma5_ma10_ma20_bullish: true,
    ...overrides,
  };
}

function installFetch(tradeDate, options = {}) {
  const calls = [];
  calls.quoteQueries = [];
  calls.poolQueries = [];
  global.fetch = async (input) => {
    const url = new URL(String(input));
    const target = url.pathname.split("/").pop();
    calls.push(target);
    if (target === "market_calendar") return response([{ market: "TW", trade_date: tradeDate, is_open: true, calendar_contract: "market-calendar-contract-v1", updated_at: new Date().toISOString() }]);
    if (target === "source_status") return response([{ ...gateRow(tradeDate, { status: "ok" }), payload: gateRow(tradeDate, options.sourceOverrides) }]);
    if (target === "v_fugle_daytrade_canonical_gate") return response([gateRow(tradeDate, options.canonicalOverrides)]);
    if (target === "v_fugle_daytrade_unattended_gate_status") return response([gateRow(tradeDate, options.unattendedOverrides)]);
    if (target === "v_fugle_daytrade_mother_pool_v4_1") {
      calls.poolQueries.push(url);
      return response(options.poolRows || [v41PoolRow(tradeDate)]);
    }
    if (target === "v_fugle_daytrade_mother_pool_receipt_v4_1") return response(options.receiptRows || [{ verification_run_id: `verify-${tradeDate}`, contract_version: "4.1.0", trade_date: tradeDate, canonical_run_id: canonicalRunId(tradeDate), verified_at: new Date().toISOString(), complete: true, mother_pool_rows: (options.poolRows || [1]).length, failed_checks: [], first_blocker: null }]);
    if (target === "fugle_daytrade_quotes_live") {
      calls.quoteQueries.push(url);
      return response([{ symbol: "2330", trade_date: tradeDate, name: "台積電", price: 100, quote_seen_at: new Date().toISOString(), last_trade_time: new Date().toISOString(), updated_at: new Date().toISOString(), ...options.quoteOverrides }]);
    }
    if (target === "v_fugle_daytrade_intraday_1m_status") return response([{ symbol: "2330", latest_candle_time: new Date(Date.now() - 60000).toISOString(), today_candle_count: 61, updated_at: new Date().toISOString() }]);
    if (target === "get_fugle_daytrade_intraday_1m_latest_n") return response(options.candleRows || candles(tradeDate, "2330"));
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
    && healthy.receipt?.mother_pool_symbols?.join(",") === "2330"
    && healthy.receipt?.mother_pool_page_size === 200
    && healthy.receipt?.mother_pool_page_count === 1
    && healthy.receipt?.mother_pool_capacity_is_hard_gate === false
    && healthy.receipt?.quote_fresh_coverage_120s === 1
    && healthy.receipt?.quote_trade_date_policy === "require_explicit_fugle_daytrade_quotes_live_trade_date_v1"
    && healthy.receipt?.event_evidence?.[0]?.quote_trade_date_ok === true
    && healthy.receipt?.event_evidence?.[0]?.intraday_1m_sample_count === 61
    && healthy.poolBySymbol.get("2330")?.source_flags?.includes("test_source")
    && Boolean(healthy.poolBySymbol.get("2330")?.latest_candle_time);
  checks.quote_table_explicit_trade_date_required = healthyCalls.quoteQueries.length > 0
    && healthyCalls.quoteQueries.every((url) => String(url.searchParams.get("select") || "").split(",").includes("trade_date"))
    && healthyCalls.quoteQueries.every((url) => url.searchParams.get("trade_date") === `eq.${tradeDate}`);
  const normalizedHealthyRow = healthy.poolBySymbol.get("2330") || {};
  const requiredV41Fields = [
    "contract_version", "trade_date", "canonical_run_id", "symbol", "name", "market",
    "mother_pool_rank", "priority_reason", "pool_source", "pool_layer", "entry_score", "upgrade_score",
    "source_flags", "source_run_ids", "priority_reasons", "source_updated_at", "source_freshness", "updated_at",
    "price", "open_price", "previous_close", "change_percent", "total_volume", "trade_value",
    "quote_seen_at", "quote_age_seconds", "last_trade_time", "last_trade_age_seconds",
    "latest_candle_time", "intraday_1m_stale_seconds", "ma5", "ma10", "ma20", "ma5_ma10_ma20_bullish",
  ];
  checks.v4_1_required_fields_preserved = requiredV41Fields.every((field) => Object.prototype.hasOwnProperty.call(normalizedHealthyRow, field));

  // Regression: a PostgREST server can cap the entire RPC response at 1,000
  // rows. Twenty-three symbols still need all 61 bars each, including the tail.
  const batchSymbols = Array.from({ length: 23 }, (_, index) => String(2100 + index));
  const batchCalls = installFetch(tradeDate, { poolRows: batchSymbols.map(symbol => v41PoolRow(tradeDate, { symbol })) });
  const ordinaryFetch = global.fetch;
  const rpcSizes = [];
  global.fetch = async (input, init = {}) => {
    const target = new URL(String(input)).pathname.split('/').pop();
    if (target === 'get_fugle_daytrade_intraday_1m_latest_n') {
      const body = JSON.parse(init.body);
      rpcSizes.push(body.symbols.length * body.bars_per_symbol);
      return response(body.symbols.flatMap(symbol => candles(tradeDate, symbol, body.bars_per_symbol)).slice(0, 1000));
    }
    if (target === 'fugle_daytrade_quotes_live') return response(batchSymbols.map(symbol => ({ symbol, trade_date: tradeDate, price: 100, quote_seen_at: new Date().toISOString(), last_trade_time: new Date().toISOString() })));
    if (target === 'v_fugle_daytrade_intraday_1m_status') return response(batchSymbols.map(symbol => ({ symbol, latest_candle_time: new Date(Date.now()-60000).toISOString(), today_candle_count: 61 })));
    return ordinaryFetch(input, init);
  };
  const cappedRpc = await readCanonicalDaytradeWater({ tradeDate, symbols: batchSymbols, barsPerSymbol: 61 });
  checks.rpc_row_cap_preserves_all_23_symbols = cappedRpc.ok === true
    && cappedRpc.receipt?.intraday_1m_rpc_rows === 1403
    && cappedRpc.receipt?.event_evidence?.length === 23
    && cappedRpc.receipt.event_evidence.every(row => row.intraday_1m_sample_count === 61 && row.intraday_1m_ready)
    && rpcSizes.length > 1 && rpcSizes.every(size => size <= 1000);

  const strategyCalls = installFetch(tradeDate);
  const strategy3 = await readCanonicalDaytradeWater({
    tradeDate,
    consumerName: "strategy3_v2",
    strategy3Consumer: true,
    requireMarketCalendar: true,
    requireMotherPoolReceipt: true,
    hydrateMotherPoolCandles: true,
    minimumCandlesPerSymbol: 20,
    barsPerSymbol: 61,
  });
  checks.strategy3_v4_1_contract_complete = strategy3.ok === true
    && strategy3.receipt?.reader_mode === "strategy3_v2_mother_pool_v4_1"
    && strategy3.receipt?.mother_pool_http_status === 200
    && strategy3.receipt?.mother_pool_rows === 1
    && strategy3.receipt?.mother_pool_pages === 1
    && strategy3.receipt?.unique_symbols === 1
    && strategy3.receipt?.quote_valid_rows === 1
    && strategy3.receipt?.intraday_1m_valid_rows === 1
    && strategy3.receipt?.symbol_data_gap_rows === 0
    && strategy3.receipt?.global_formal_gate_blocked === false
    && strategy3.receipt?.receipt_incomplete === false
    && strategy3.candleRowsBySymbol.get("2330")?.length === 61;
  checks.strategy3_v4_1_read_order = strategyCalls.indexOf("market_calendar") < strategyCalls.indexOf("source_status")
    && strategyCalls.indexOf("source_status") < strategyCalls.indexOf("v_fugle_daytrade_canonical_gate")
    && strategyCalls.indexOf("v_fugle_daytrade_unattended_gate_status") < strategyCalls.indexOf("v_fugle_daytrade_mother_pool_v4_1")
    && strategyCalls.indexOf("v_fugle_daytrade_mother_pool_v4_1") < strategyCalls.indexOf("v_fugle_daytrade_mother_pool_receipt_v4_1")
    && strategyCalls.indexOf("v_fugle_daytrade_mother_pool_receipt_v4_1") < strategyCalls.indexOf("fugle_daytrade_quotes_live")
    && strategyCalls.indexOf("fugle_daytrade_quotes_live") < strategyCalls.indexOf("get_fugle_daytrade_intraday_1m_latest_n");
  checks.strategy3_v4_1_pool_query_contract = strategyCalls.poolQueries.length > 0
    && strategyCalls.poolQueries.every((url) => url.searchParams.get("trade_date") === `eq.${tradeDate}`)
    && strategyCalls.poolQueries.every((url) => url.searchParams.get("canonical_run_id") === `eq.${canonicalRunId(tradeDate)}`)
    && strategyCalls.poolQueries.every((url) => url.searchParams.get("contract_version") === "eq.4.1.0")
    && strategyCalls.poolQueries.every((url) => url.searchParams.get("order") === "symbol.asc")
    && strategyCalls.poolQueries.every((url) => url.searchParams.get("limit") === "200");

  installFetch(tradeDate, { candleRows: candles(tradeDate, "2330").map((row, index) => index === 0 ? { ...row, volume_strategy_usable: false } : row) });
  const strategy3Gap = await readCanonicalDaytradeWater({ tradeDate, consumerName: "strategy3_v2", strategy3Consumer: true, requireMarketCalendar: true, requireMotherPoolReceipt: true, hydrateMotherPoolCandles: true, minimumCandlesPerSymbol: 20, barsPerSymbol: 61 });
  checks.strategy3_unusable_volume_is_symbol_data_gap = strategy3Gap.ok === true
    && strategy3Gap.symbolDataGaps.get("2330")?.includes("intraday_1m_not_volume_strategy_usable")
    && strategy3Gap.receipt?.symbol_data_gap_rows === 1;

  const missingSectorRow = v41PoolRow(tradeDate);
  delete missingSectorRow.sector_name;
  installFetch(tradeDate, { poolRows: [missingSectorRow] });
  const missingSector = await readCanonicalDaytradeWater({ tradeDate, consumerName: "strategy3_v2", strategy3Consumer: true, requireMarketCalendar: true, requireMotherPoolReceipt: true, hydrateMotherPoolCandles: true, minimumCandlesPerSymbol: 20, barsPerSymbol: 61 });
  checks.strategy3_missing_business_field_is_symbol_data_gap = missingSector.ok === true
    && missingSector.symbolDataGaps.get("2330")?.includes("mother_pool_field_missing:sector_name");

  const missingIdentityRow = v41PoolRow(tradeDate);
  delete missingIdentityRow.writer_run_id;
  installFetch(tradeDate, { poolRows: [missingIdentityRow] });
  const missingIdentity = await readCanonicalDaytradeWater({ tradeDate, consumerName: "strategy3_v2", strategy3Consumer: true, requireMarketCalendar: true, requireMotherPoolReceipt: true, hydrateMotherPoolCandles: true, minimumCandlesPerSymbol: 20, barsPerSymbol: 61 });
  checks.strategy3_missing_identity_field_fails_closed = missingIdentity.ok === false
    && missingIdentity.failedChecks.some((code) => code.startsWith("canonical_water_mother_pool_identity_fields_missing:2330:writer_run_id"));

  installFetch(tradeDate, { receiptRows: [{ contract_version: "4.1.0", trade_date: tradeDate, canonical_run_id: canonicalRunId(tradeDate), complete: false, mother_pool_rows: 1, failed_checks: ["test"], first_blocker: "test" }] });
  const incompleteReceipt = await readCanonicalDaytradeWater({ tradeDate, consumerName: "strategy3_v2", strategy3Consumer: true, requireMarketCalendar: true, requireMotherPoolReceipt: true, hydrateMotherPoolCandles: true, minimumCandlesPerSymbol: 20, barsPerSymbol: 61 });
  checks.strategy3_incomplete_producer_receipt_fails_closed = incompleteReceipt.ok === false
    && incompleteReceipt.receipt?.receipt_incomplete === true
    && incompleteReceipt.failedChecks.includes("canonical_water_mother_pool_receipt_incomplete");

  installFetch(tradeDate, { poolRows: [{ trade_date: tradeDate, symbol: "2330", source_updated_at: new Date().toISOString(), source_freshness: "same_trade_date_current", contract_version: "4.0.0", canonical_run_id: canonicalRunId(tradeDate) }] });
  const wrongContract = await readCanonicalDaytradeWater({ tradeDate, symbols: [], telegramObservation: true });
  checks.wrong_mother_pool_contract_fails_closed = wrongContract.ok === false
    && wrongContract.failedChecks.includes("canonical_water_mother_pool_contract_version_mismatch");

  installFetch(tradeDate, { poolRows: [{ trade_date: tradeDate, symbol: "2330", source_updated_at: new Date().toISOString(), source_freshness: "same_trade_date_current", contract_version: "4.1.0", canonical_run_id: "fugle_daytrade_source:20260908:canonical" }] });
  const wrongRun = await readCanonicalDaytradeWater({ tradeDate, symbols: [], telegramObservation: true });
  checks.wrong_mother_pool_run_fails_closed = wrongRun.ok === false
    && wrongRun.failedChecks.includes("canonical_water_mother_pool_canonical_run_id_mismatch");

  installFetch(tradeDate, { poolRows: [{ trade_date: tradeDate, symbol: "2330", source_updated_at: new Date().toISOString(), source_freshness: "stale", contract_version: "4.1.0", canonical_run_id: canonicalRunId(tradeDate) }] });
  const staleSource = await readCanonicalDaytradeWater({ tradeDate, symbols: [], telegramObservation: true });
  checks.stale_mother_pool_source_fails_closed = staleSource.ok === false
    && staleSource.failedChecks.includes("canonical_water_mother_pool_source_freshness_invalid");

  installFetch(tradeDate, { poolRows: [{ trade_date: tradeDate, symbol: "2330", source_updated_at: new Date().toISOString(), source_freshness: "same_trade_date_current", contract_version: "4.1.0", canonical_run_id: canonicalRunId(tradeDate), ma35: 1 }] });
  const retiredMa = await readCanonicalDaytradeWater({ tradeDate, symbols: [], telegramObservation: true });
  checks.retired_ma_field_fails_closed = retiredMa.ok === false
    && retiredMa.failedChecks.includes("canonical_water_mother_pool_retired_ma_field_present");

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
