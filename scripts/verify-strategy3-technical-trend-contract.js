"use strict";

const {
  aggregateCompleted60m,
  indicatorTrend,
  dailyBars,
  KD_PERIOD,
  RSI_FAST_PERIOD,
  RSI_SLOW_PERIOD,
  MIN_INDICATOR_BARS,
} = require("../lib/strategy3-technical-trend-reader");

function risingBars(count, start = 100) {
  return Array.from({ length: count }, (_, index) => ({
    key: String(index),
    open: start + index + (index % 4 === 0 ? -3 : -1) + (index === count - 1 ? 4 : 0),
    high: start + index + 3 + (index === count - 1 ? 4 : 0),
    low: start + index - 3 + (index % 4 === 0 ? -2 : 0),
    close: start + index + (index % 4 === 0 ? -2 : 0) + (index === count - 1 ? 4 : 0),
  }));
}

function main() {
  const rising = indicatorTrend(risingBars(24));
  const fallingSeries = risingBars(22);
  fallingSeries.push({ key: "22", open: 121, high: 122, low: 116, close: 117 });
  fallingSeries.push({ key: "23", open: 117, high: 118, low: 109, close: 110 });
  const falling = indicatorTrend(fallingSeries);
  const short = indicatorTrend(risingBars(MIN_INDICATOR_BARS - 1));
  const oneMinute = [];
  for (let minute = 0; minute < 60; minute += 1) oneMinute.push({ candle_time: `2026-09-11T09:${String(minute).padStart(2, "0")}:00+08:00`, open: 100, high: 102, low: 99, close: 101, synthetic: false, volume_strategy_usable: true });
  for (let minute = 0; minute < 15; minute += 1) oneMinute.push({ candle_time: `2026-09-11T10:${String(minute).padStart(2, "0")}:00+08:00`, open: 101, high: 103, low: 100, close: 102, synthetic: false, volume_strategy_usable: true });
  const aggregated = aggregateCompleted60m(oneMinute, "2026-09-11", new Date("2026-09-11T10:15:00+08:00"));
  const daily = dailyBars(risingBars(20).map((bar, index) => ({ ...bar, trade_date: `2026-08-${String(index + 1).padStart(2, "0")}` })), "2026-09-11", { open_price: 125, high_price: 128, low_price: 124, price: 127 });
  const checks = {
    periods_are_fixed: KD_PERIOD === 5 && RSI_FAST_PERIOD === 3 && RSI_SLOW_PERIOD === 6,
    rising_k_over_d_and_rsi3_over_rsi6_pass: rising.ok === true && rising.kd_over_d === true && rising.kd_trend_up === true && rising.rsi3_over_rsi6 === true && rising.rsi_trend_up === true && rising.signal_pass === true,
    falling_kd_or_rsi_fails: falling.ok === true && falling.signal_pass === false,
    insufficient_history_is_data_gap: short.ok === false && short.reason === `indicator_history_below_${MIN_INDICATOR_BARS}_bars`,
    incomplete_current_60m_bucket_excluded: aggregated.length === 1 && aggregated[0].key === "2026-09-11:09",
    live_daily_bar_replaces_or_appends_trade_date: daily[daily.length - 1]?.key === "2026-09-11" && daily[daily.length - 1]?.close === 127,
  };
  const failedChecks = Object.entries(checks).filter(([, ok]) => ok !== true).map(([name]) => name);
  console.log(JSON.stringify({ ok: failedChecks.length === 0, contract: "strategy3-technical-trend-gate-v1", checks, failed_checks: failedChecks, first_blocker: failedChecks[0] || null }, null, 2));
  process.exitCode = failedChecks.length ? 1 : 0;
}

main();
