"use strict";

const { buildScannerCoreResults, MIN_CHANGE_PERCENT, MAX_CHANGE_PERCENT } = require("./run-strategy3-v2-complete-scan");
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
    price: 106, open_price: 100, previous_close: 100, high_price: 106, low_price: 99, change_percent: 6, total_volume: 20000, trade_value: 2120000,
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
    quoteBySymbol: new Map([[symbol, { symbol, trade_date: tradeDate, name: pool.name, price: 106, previous_close: 100, change_percent: 6, quote_seen_at: pool.quote_seen_at, last_trade_time: pool.last_trade_time }]]),
    candleRowsBySymbol: new Map([[symbol, candleRows()]]),
    evidenceBySymbol: new Map(),
    symbolDataGaps: new Map(),
    receipt: { contract_version: MOTHER_POOL_CONTRACT_VERSION, canonical_run_id: canonicalRunId, consumer_commit: "test", mother_pool_pages: 1, quote_valid_rows: 1, intraday_1m_valid_rows: 1, symbol_data_gap_rows: 0 },
    ...overrides,
  };
}

function technicalEvidence(overrides = {}) {
  return new Map([[symbol, {
    ok: true,
    source_ready: true,
    reason: "",
    hourly60: { ok: true, current_k: 65, previous_k: 60, current_d: 58, previous_d: 54, current_rsi3: 68, previous_rsi3: 63, current_rsi6: 62, previous_rsi6: 59, kd_over_d: true, kd_trend_up: true, rsi3_over_rsi6: true, rsi_trend_up: true, signal_pass: true, bar_count: 18 },
    daily: { ok: true, current_k: 70, previous_k: 66, current_d: 63, previous_d: 60, current_rsi3: 70, previous_rsi3: 65, current_rsi6: 64, previous_rsi6: 61, kd_over_d: true, kd_trend_up: true, rsi3_over_rsi6: true, rsi_trend_up: true, signal_pass: true, bar_count: 30 },
    sources: { hourly60: "test:completed_60m", daily: "test:daily" },
    hourly_strategy3_pass: true,
    daily_strategy3_pass: true,
    ...overrides,
  }]]);
}

const readTechnical = async () => technicalEvidence();
function atrRvolEvidence(overrides = {}) {
  return new Map([[symbol, {
    ok: true, source_ready: true, reason: "", atr14: 2, current_true_range: 3, tr_atr_ratio: 1.5,
    close_location: 0.9, session_rvol_5d: 2, tail_rvol_5d: 2.2,
    comparable_history_dates: ["d1", "d2", "d3", "d4", "d5"],
    checks: { rvol_history_5_sessions: true, atr_history_14_periods: true, close_location_ge_075: true, session_rvol_ge_15: true, tail_rvol_ge_15: true, tr_atr_ratio_08_22: true },
    ...overrides,
  }]]);
}
const readAtrRvol = async () => atrRvolEvidence();

async function main() {
  const eligible = await buildScannerCoreResults(async () => water(), readTechnical, readAtrRvol);
  const belowRangeWater = water();
  belowRangeWater.quoteBySymbol.get(symbol).change_percent = 4.99;
  const belowRange = await buildScannerCoreResults(async () => belowRangeWater, readTechnical, readAtrRvol);
  const aboveRangeWater = water();
  aboveRangeWater.quoteBySymbol.get(symbol).change_percent = 8.01;
  const aboveRange = await buildScannerCoreResults(async () => aboveRangeWater, readTechnical, readAtrRvol);
  const limitUpWater = water();
  limitUpWater.quoteBySymbol.get(symbol).change_percent = 10;
  const limitUp = await buildScannerCoreResults(async () => limitUpWater, readTechnical, readAtrRvol);
  const lowerBoundaryWater = water();
  lowerBoundaryWater.quoteBySymbol.get(symbol).change_percent = 5;
  const lowerBoundary = await buildScannerCoreResults(async () => lowerBoundaryWater, readTechnical, readAtrRvol);
  const upperBoundaryWater = water();
  upperBoundaryWater.quoteBySymbol.get(symbol).change_percent = 8;
  const upperBoundary = await buildScannerCoreResults(async () => upperBoundaryWater, readTechnical, readAtrRvol);
  const gapWater = water({ symbolDataGaps: new Map([[symbol, ["quote_data_gap"]]]) });
  gapWater.receipt.symbol_data_gap_rows = 1;
  const isolated = await buildScannerCoreResults(async () => gapWater, readTechnical, readAtrRvol);
  const hourlyKdLagAccepted = await buildScannerCoreResults(async () => water(), async () => technicalEvidence({
    hourly60: { ok: true, current_k: 55, previous_k: 50, current_d: 57, previous_d: 58, current_rsi3: 64, previous_rsi3: 60, current_rsi6: 58, previous_rsi6: 55, kd_over_d: false, kd_trend_up: false, rsi3_over_rsi6: true, rsi_trend_up: true, signal_pass: false },
    hourly_strategy3_pass: true,
  }), readAtrRvol);
  const hourlyRsiRejected = await buildScannerCoreResults(async () => water(), async () => technicalEvidence({
    ok: false,
    hourly60: { ok: true, current_k: 55, previous_k: 60, current_d: 57, previous_d: 58, current_rsi3: 56, previous_rsi3: 58, current_rsi6: 57, previous_rsi6: 59, kd_over_d: false, kd_trend_up: false, rsi3_over_rsi6: false, rsi_trend_up: false, signal_pass: false },
    hourly_strategy3_pass: false,
    reason: "hourly60_rsi3_over_rsi6_trend_not_up",
  }), readAtrRvol);
  const dailyGap = await buildScannerCoreResults(async () => water(), async () => technicalEvidence({
    ok: false,
    source_ready: false,
    daily: { ok: false, reason: "indicator_history_below_10_bars" },
    reason: "daily_indicator_history_below_10_bars",
  }), readAtrRvol);
  const atrRvolGap = await buildScannerCoreResults(async () => water(), readTechnical, async () => atrRvolEvidence({ ok: false, source_ready: false, reason: "atr_rvol_history_data_gap" }));
  const first = eligible.results[0] || {};
  const checks = {
    v4_1_candidate_created: eligible.results.length === 1,
    v4_1_membership_source_preserved: first.universe_source === MOTHER_POOL_VIEW && first.contract_version === MOTHER_POOL_CONTRACT_VERSION && first.canonical_run_id === canonicalRunId,
    rpc_entry_source_preserved: first.entry_price_source === `${INTRADAY_1M_RPC}:first_close_1259_1302`,
    new_fields_preserved: first.writer_run_id === "writer-test" && first.generation_id === "generation-test" && first.sector_name === "半導體" && first.ma5_ma10_ma20_bullish === true,
    change_percent_contract_is_5_to_8_inclusive: MIN_CHANGE_PERCENT === 5 && MAX_CHANGE_PERCENT === 8 && eligible.change_percent_gate?.min_inclusive === 5 && eligible.change_percent_gate?.max_inclusive === 8,
    lower_boundary_5_percent_is_accepted: lowerBoundary.results.length === 1,
    upper_boundary_8_percent_is_accepted: upperBoundary.results.length === 1,
    below_5_percent_is_excluded: belowRange.results.length === 0 && belowRange.change_percent_gate?.below_range_count === 1,
    above_8_percent_is_excluded: aboveRange.results.length === 0 && aboveRange.change_percent_gate?.above_range_or_limit_up_count === 1,
    limit_up_is_explicitly_excluded: limitUp.results.length === 0 && limitUp.change_percent_gate?.limit_up_excluded === true,
    candidate_reason_declares_new_gate: first.reason_codes?.includes("strategy3_v2_change_percent_5_to_8_inclusive") && first.reason_codes?.includes("strategy3_v2_limit_up_exclusion_passed"),
    technical_gate_requires_hourly_rsi_and_daily_full_trend: eligible.technical_trend_gate?.required === true && eligible.technical_trend_gate?.confirmed_count === 1,
    atr_rvol_gate_is_required: eligible.atr_rvol_gate?.required === true && eligible.atr_rvol_gate?.confirmed_count === 1,
    intraday_1m_is_shared_with_daytrade_source: eligible.candle_source?.ownership === "shared_with_daytrade_canonical_source"
      && eligible.candle_source?.writer === "fugle_daytrade_source"
      && eligible.candle_source?.table === "fugle_daytrade_intraday_1m"
      && eligible.candle_source?.independent_strategy3_writer === false,
    intraday_1m_is_same_trade_date_only: eligible.candle_source?.trade_date_policy === "same_trade_date_only",
    technical_evidence_is_preserved: first.technical_trend_confirmation?.hourly_strategy3_pass === true && first.technical_trend_confirmation?.daily_strategy3_pass === true,
    atr_rvol_evidence_is_preserved: first.atr_rvol_confirmation?.checks?.tail_rvol_ge_15 === true,
    hourly_kd_lag_is_not_a_hard_blocker: hourlyKdLagAccepted.results.length === 1,
    hourly_rsi_not_up_is_excluded: hourlyRsiRejected.results.length === 0 && hourlyRsiRejected.technical_trend_gate?.trend_rejected_count === 1,
    daily_indicator_gap_is_excluded_per_symbol: dailyGap.results.length === 0 && dailyGap.technical_trend_gate?.source_gap_count === 1,
    candidate_reason_declares_technical_gates: first.reason_codes?.includes("strategy3_v2_60m_rsi3_over_rsi6_trend_up") && first.reason_codes?.includes("strategy3_v2_daily_k_over_d_rsi3_over_rsi6_trend_up") && first.reason_codes?.includes("strategy3_v2_atr_rvol_tail_momentum_confirmed"),
    atr_rvol_history_gap_isolated: atrRvolGap.results.length === 0 && atrRvolGap.atr_rvol_gate?.source_gap_count === 1,
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
