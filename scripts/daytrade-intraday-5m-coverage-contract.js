"use strict";

const EFFECTIVE_COVERAGE_NUMERATOR = 7;
const EFFECTIVE_COVERAGE_DENOMINATOR = 10;
const EFFECTIVE_COVERAGE_THRESHOLD = 0.7;
const NATIVE_SOURCE = "fugle_stock_intraday_candles_timeframe_5";
const STRATEGY_VERSION = "golden-cross-any-macd-3-9-3-v4";
const CALCULATION_VERSION = "five-minute-indicators-macd-3-9-3-v4";
const CLASSIFICATION_CONTRACT = "daytrade_intraday_5m_branch_independent_strict_wait_v1";

function isFreshClosedRow(row, { tradeDate, runId, asOfMs, maxStaleSeconds }) {
  const barEnd = Date.parse(row?.bar_end || "");
  return row?.trade_date === tradeDate &&
    row?.run_id === runId &&
    row?.source === NATIVE_SOURCE &&
    row?.is_synthetic === false &&
    row?.bar_complete === true &&
    row?.confirmation_eligible === true &&
    Number(row?.bar_count) === 5 &&
    row?.bar_kind === "regular_session" &&
    Number.isFinite(barEnd) &&
    barEnd <= asOfMs &&
    asOfMs - barEnd <= maxStaleSeconds * 1000;
}

function isEffectiveRow(row, identity) {
  if (!isFreshClosedRow(row, identity) || row.data_gap_5m !== false) return false;
  if (row.trend_5m_strategy_version !== STRATEGY_VERSION ||
      row.calculation_version !== CALCULATION_VERSION ||
      row.classification_contract !== CLASSIFICATION_CONTRACT) return false;
  return row.trend_5m_status === "CONFIRMED_STRONG_5M" ||
    row.trend_5m_status === "WAIT_5M_CONFIRMATION";
}

function meetsEffectiveCoverage(effectiveCount, totalCount) {
  if (!Number.isInteger(effectiveCount) || !Number.isInteger(totalCount) || totalCount <= 0) return false;
  return effectiveCount * EFFECTIVE_COVERAGE_DENOMINATOR >=
    totalCount * EFFECTIVE_COVERAGE_NUMERATOR;
}

function summarizeCoverage(expectedSymbols, rows, identity) {
  const expected = [...new Set(expectedSymbols.map(String))];
  const bySymbol = new Map(rows.map(row => [String(row.symbol), row]));
  const fresh = expected.filter(symbol => isFreshClosedRow(bySymbol.get(symbol), identity));
  const confirmed = expected.filter(symbol => isEffectiveRow(bySymbol.get(symbol), identity) &&
    bySymbol.get(symbol).trend_5m_status === "CONFIRMED_STRONG_5M");
  const wait = expected.filter(symbol => isEffectiveRow(bySymbol.get(symbol), identity) &&
    bySymbol.get(symbol).trend_5m_status === "WAIT_5M_CONFIRMATION");
  const effective = [...confirmed, ...wait];
  const denominator = expected.length;
  return {
    requested_symbols: denominator,
    freshness_count: fresh.length,
    freshness_coverage: denominator ? fresh.length / denominator : 0,
    effective_confirmed_count: confirmed.length,
    effective_wait_count: wait.length,
    effective_count: effective.length,
    effective_coverage: denominator ? effective.length / denominator : 0,
    effective_threshold: EFFECTIVE_COVERAGE_THRESHOLD,
    effective_required_count: Math.ceil(denominator * EFFECTIVE_COVERAGE_NUMERATOR / EFFECTIVE_COVERAGE_DENOMINATOR),
    effective_gap_symbols: expected.filter(symbol => !effective.includes(symbol)),
    meets_effective_coverage: meetsEffectiveCoverage(effective.length, denominator),
  };
}

module.exports = {
  EFFECTIVE_COVERAGE_THRESHOLD,
  NATIVE_SOURCE,
  isFreshClosedRow,
  isEffectiveRow,
  meetsEffectiveCoverage,
  summarizeCoverage,
};
