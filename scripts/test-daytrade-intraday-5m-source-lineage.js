"use strict";

const assert = require("node:assert/strict");
const { calculate } = require("./daytrade-intraday-5m-v4");

const calculatedAt = "2026-09-15T04:15:00.000Z";
const baseBar = {
  trade_date: "2026-09-15",
  symbol: "2330",
  candle_time: "2026-09-15T04:10:00.000Z",
  bar_start: "2026-09-15T04:10:00.000Z",
  bar_end: "2026-09-15T04:15:00.000Z",
  open: 100,
  high: 101,
  low: 99,
  close: 100,
  volume: 123,
  bar_count: 5,
  bar_kind: "regular_session",
  bar_complete: true,
  confirmation_eligible: true,
  gap_reason: null,
};

const nativeSource = "fugle_stock_intraday_candles_timeframe_5";
const nativeRow = calculate(
  [{ ...baseBar, source: nativeSource }],
  "five-minute-test-native-source",
  calculatedAt,
)[0];
assert.equal(nativeRow.source, nativeSource, "native Fugle 5m source must survive calculation");

const fallbackRow = calculate(
  [{ ...baseBar, symbol: "2317" }],
  "five-minute-test-legacy-fallback",
  calculatedAt,
)[0];
assert.equal(
  fallbackRow.source,
  "fugle_daytrade_intraday_1m",
  "legacy source fallback should remain only for inputs with no source field",
);

console.log("PASS: native 5m source attribution is preserved; legacy fallback is unchanged.");
