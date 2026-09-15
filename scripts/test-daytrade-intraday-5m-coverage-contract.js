"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { meetsEffectiveCoverage, summarizeCoverage } = require("./daytrade-intraday-5m-coverage-contract");
const { resolveVolumeUnit } = require("./daytrade-intraday-5m-volume-unit");

assert.equal(meetsEffectiveCoverage(184, 205), false, "184/205 must fail the exact 90% boundary");
assert.equal(meetsEffectiveCoverage(185, 205), true, "185/205 must pass the exact 90% boundary");
assert.equal(meetsEffectiveCoverage(169, 205), false);

const identity = {
  tradeDate: "2026-09-15",
  runId: "five-minute-contract-test",
  asOfMs: Date.parse("2026-09-15T04:15:00.000Z"),
  maxStaleSeconds: 600,
};
const makeRow = (symbol, status, overrides = {}) => ({
  symbol,
  trade_date: identity.tradeDate,
  run_id: identity.runId,
  source: "fugle_stock_intraday_candles_timeframe_5",
  is_synthetic: false,
  bar_end: "2026-09-15T04:15:00.000Z",
  bar_count: 5,
  bar_complete: true,
  confirmation_eligible: true,
  bar_kind: "regular_session",
  data_gap_5m: status === "DATA_GAP_5M",
  trend_5m_status: status,
  trend_5m_strategy_version: "golden-cross-any-macd-3-9-3-v4",
  calculation_version: "five-minute-indicators-macd-3-9-3-v4",
  classification_contract: "daytrade_intraday_5m_branch_independent_strict_wait_v1",
  ...overrides,
});

const rows = [makeRow("A001", "CONFIRMED_STRONG_5M"), makeRow("A002", "WAIT_5M_CONFIRMATION"),
  makeRow("A003", "DATA_GAP_5M"), makeRow("A004", "WAIT_5M_CONFIRMATION", { run_id: "old-run" })];
const summary = summarizeCoverage(["A001", "A002", "A003", "A004", "A005"], rows, identity);
assert.equal(summary.requested_symbols, 5, "missing symbols remain in the denominator");
assert.equal(summary.freshness_count, 3);
assert.equal(summary.effective_count, 2, "DATA_GAP, wrong run, and missing rows are not effective");
assert.equal(summarizeCoverage(["A001"], [makeRow("A001", "WAIT_5M_CONFIRMATION", { is_synthetic: null })], identity).effective_count, 0,
  "unproven legacy lineage cannot count as fresh or effective");

assert.equal(resolveVolumeUnit({ type: "EQUITY", market: "TSE" }).volume_unit, "lots");
assert.equal(resolveVolumeUnit({ type: "EQUITY", market: "OTC" }).volume_unit, "lots");
assert.equal(resolveVolumeUnit({ type: "EQUITY", market: "ESB" }).volume_unit, "shares");
assert.equal(resolveVolumeUnit({ type: "ODDLOT", market: "TSE" }).volume_unit, "shares");
assert.equal(resolveVolumeUnit({ type: "INDEX", market: "TSE" }).volume_unit, "currency_amount");
assert.equal(resolveVolumeUnit({ type: "EQUITY", market: "UNKNOWN" }).volume_available, false);

const latestViewSql = fs.readFileSync(path.join(__dirname, "..", "ops", "public-slot", "DaytradeIntraday5mLatestClosedReadback_20260915.sql"), "utf8");
assert.match(latestViewSql, /effective_threshold[^\n]*>= 0\.9/i, "latest view must exclude legacy runs with a lower threshold");
assert.match(latestViewSql, /effective_count[^\n]*\* 10[\s\S]*>= [\s\S]*total[^\n]*\* 9/i, "latest view must use exact integer cross multiplication");
assert.match(latestViewSql, /meets_effective_coverage[^\n]*is true/i, "latest view must require an affirmative 90% receipt diagnostic");

console.log("PASS: exact 184/205 and 185/205 boundaries, denominator, per-symbol effectiveness, and Fugle volume-unit mapping.");
