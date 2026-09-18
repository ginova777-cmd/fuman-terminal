"use strict";
const assert = require("node:assert/strict");
const { calculate } = require("./daytrade-intraday-5m-v4");
const start = Date.parse("2026-09-17T01:00:00Z");
function bars(count) {
  return Array.from({ length: count }, (_, i) => ({
    symbol: "TEST", trade_date: "2026-09-17",
    bar_start: new Date(start + i * 300000).toISOString(),
    bar_end: new Date(start + (i + 1) * 300000).toISOString(),
    open: 100, high: 101, low: 99, close: 100, volume: 100,
    confirmation_eligible: true, bar_complete: true, is_synthetic: false,
    source: "isolated_fixture"
  }));
}
function latest(rows) {
  return calculate(rows, "isolated-session-warmup", "2026-09-17T03:00:00Z").at(-1);
}
assert.equal(latest(bars(16)).ma20_5m, null);
assert.equal(latest(bars(16)).trend_5m_status, "DATA_GAP_5M");
assert.equal(latest(bars(20)).ma20_5m, 100);
assert.equal(latest(bars(20)).ma10_cross_ma20_up_5m, null);
assert.equal(latest(bars(21)).ma10_cross_ma20_up_5m, false);
assert.equal(latest(bars(21)).trend_5m_status, "WAIT_5M_CONFIRMATION");
const missing = bars(22).filter((_, i) => i !== 10);
assert.equal(latest(missing).trend_5m_status, "DATA_GAP_5M");
console.log("PASS isolated: 16 bars lack MA20; 20 lack prior MA20; 21 contiguous bars permit valid WAIT; missing interval remains DATA_GAP. No runtime or DB writes.");
