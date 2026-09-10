"use strict";

const { buildScannerCoreResults } = require("./run-strategy3-v2-complete-scan");
const { taipeiDate, MOTHER_POOL_VIEW, MOTHER_POOL_CONTRACT_VERSION, INTRADAY_1M_RPC } = require("./strategy3-v2-contract");

const tradeDate = taipeiDate();
const symbol = "2330";
const canonicalRunId = `fugle_daytrade_source:${tradeDate.replace(/\D/g, "")}:canonical`;

function poolRow() {
  return {
    contract_version: MOTHER_POOL_CONTRACT_VERSION, trade_date: tradeDate, canonical_run_id: canonicalRunId,
    writer_run_id: "writer-test", generation_id: "generation-test", symbol, name: "台積電", market: "TSE",
    source_name: "fugle_daytrade_source", source_trade_date: tradeDate, source_updated_at: `${tradeDate}T12:59:00+08:00`, source_freshness: "same_trade_date_current", updated_at: `${tradeDate}T13:00:00+08:00`,
    mother_pool_rank: 1, priority_rank: 1, mother_pool_score: 90, priority_score: 89, entry_score: 88, upgrade_score: 1,
    priority_reason: "test", priority_reasons: ["test"], mother_reason: "test", mother_source: "writer", pool_source: "terminal_union", pool_layer: "warmup",
    source_flags: ["test"], source_run_ids: [canonicalRunId], mother_readiness_status: "ready", is_formal_entry_eligible: true,
    price: 103, open_price: 100, previous_close: 100, high_price: 104, low_price: 99, change_percent: 3, total_volume: 20000, trade_value: 2060000,
    avg_volume5: 15000, quote_trade_date: tradeDate, quote_seen_at: `${tradeDate}T13:02:00+08:00`, quote_age_seconds: 1,
    last_trade_time: `${tradeDate}T13:02:00+08:00`, last_trade_age_seconds: 1, latest_candle_time: `${tradeDate}T13:02:00+08:00`, intraday_1m_stale_seconds: 1,
    mother_updated_at: `${tradeDate}T13:02:00+08:00`, pool_updated_trade_date: tradeDate, sector_name: "半導體", sector_strength_score: 90,
    sector_member_active_count: 20, industry_signal_fast_injected: true, industry_signal_fast_inject_industries: ["半導體"],
    ma5: 102, ma10: 101, ma20: 100, ma5_ma10_ma20_bullish: true,
  };
}

function candleRows() {
  return Array.from({ length: 20 }, (_, index) => {
    const minute = 43 + index;
    const hour = 12 + Math.floor(minute / 60);
    const minuteOfHour = minute % 60;
    return {
      trade_date: tradeDate, symbol, candle_time: `${tradeDate}T${String(hour).padStart(2, "0")}:${String(minuteOfHour).padStart(2, "0")}:00+08:00`,
      open: 100, high: 104, low: 99, close: minute >= 59 ? 101 : 100, volume: 1000, synthetic: false, volume_strategy_usable: true,
      updated_at: `${tradeDate}T13:03:00+08:00`,
    };
  });
}

function water(overrides = {}) {
  const pool = poolRow();
  return {
    ok: true,
    skipped: false,
    failedChecks: [],
    firstBlocker: null,
    poolBySymbol: new Map([[symbol, pool]]),
    quoteBySymbol: new Map([[symbol, { symbol, trade_date: tradeDate, name: pool.name, price: 103, previous_close: 100, change_percent: 3, quote_seen_at: pool.quote_seen_at, last_trade_time: pool.last_trade_time }]]),
    candleRowsBySymbol: new Map([[symbol, candleRows()]]),
    evidenceBySymbol: new Map(),
    symbolDataGaps: new Map(),
    receipt: { contract_version: MOTHER_POOL_CONTRACT_VERSION, canonical_run_id: canonicalRunId, consumer_commit: "test", mother_pool_pages: 1, quote_valid_rows: 1, intraday_1m_valid_rows: 1, symbol_data_gap_rows: 0 },
    ...overrides,
  };
}

async function main() {
  const eligible = await buildScannerCoreResults(async () => water());
  const noMatchWater = water();
  noMatchWater.quoteBySymbol.get(symbol).change_percent = 1;
  const zeroMatch = await buildScannerCoreResults(async () => noMatchWater);
  const gapWater = water({ symbolDataGaps: new Map([[symbol, ["quote_data_gap"]]]) });
  gapWater.receipt.symbol_data_gap_rows = 1;
  const isolated = await buildScannerCoreResults(async () => gapWater);
  const first = eligible.results[0] || {};
  const checks = {
    v4_1_candidate_created: eligible.results.length === 1,
    v4_1_membership_source_preserved: first.universe_source === MOTHER_POOL_VIEW && first.contract_version === MOTHER_POOL_CONTRACT_VERSION && first.canonical_run_id === canonicalRunId,
    rpc_entry_source_preserved: first.entry_price_source === `${INTRADAY_1M_RPC}:first_close_1259_1302`,
    new_fields_preserved: first.writer_run_id === "writer-test" && first.generation_id === "generation-test" && first.sector_name === "半導體" && first.ma5_ma10_ma20_bullish === true,
    zero_match_keeps_healthy_scan_evidence: zeroMatch.results.length === 0 && zeroMatch.ready_20_candle_symbols === 1,
    symbol_data_gap_isolated: isolated.results.length === 0 && isolated.symbol_data_gap_rows === 1,
  };
  const failedChecks = Object.entries(checks).filter(([, ok]) => ok !== true).map(([name]) => name);
  console.log(JSON.stringify({ ok: failedChecks.length === 0, contract: "strategy3-v2-mother-pool-v4-1-scan-contract-v1", checks, failed_checks: failedChecks, first_blocker: failedChecks[0] || null, read_only: true }, null, 2));
  process.exitCode = failedChecks.length ? 1 : 0;
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, first_blocker: "strategy3_v2_scan_contract_exception", error: error?.stack || error?.message || String(error) }, null, 2));
  process.exitCode = 1;
});
