"use strict";

const { calculateAtrRvolEvidence, ATR_PERIOD, RVOL_SESSIONS, MIN_RVOL_SESSIONS } = require("../lib/strategy3-atr-rvol-reader");

const tradeDate = "2026-09-11";
const dailyRows = Array.from({ length: 16 }, (_, index) => ({
  trade_date: `2026-08-${String(index + 10).padStart(2, "0")}`,
  open: 100 + index, high: 103 + index, low: 99 + index, close: 102 + index,
}));
const dates = ["2026-09-04", "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", tradeDate];
const intradayRows = [];
for (const date of dates) {
  const today = date === tradeDate;
  for (const minute of [540, 600, 720, 765, 780]) {
    intradayRows.push({
      candle_time: `${date}T${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}:00+08:00`,
      volume: today ? (minute >= 765 ? 300 : 200) : 100,
      synthetic: false, volume_strategy_usable: true,
    });
  }
}
const poolRow = { open_price: 116, high_price: 122, low_price: 115, price: 121, previous_close: 115 };
const healthy = calculateAtrRvolEvidence({ dailyRows, intradayRows, tradeDate, poolRow });
const twoSession = calculateAtrRvolEvidence({ dailyRows, intradayRows: intradayRows.filter((row) => [tradeDate, "2026-09-09", "2026-09-10"].some((date) => row.candle_time.startsWith(date))), tradeDate, poolRow });
const insufficient = calculateAtrRvolEvidence({ dailyRows, intradayRows: intradayRows.filter((row) => [tradeDate, "2026-09-10"].some((date) => row.candle_time.startsWith(date))), tradeDate, poolRow });
const overheat = calculateAtrRvolEvidence({ dailyRows, intradayRows, tradeDate, poolRow: { ...poolRow, high_price: 135, price: 134 } });
const checks = {
  periods_fixed: ATR_PERIOD === 14 && RVOL_SESSIONS === 5 && MIN_RVOL_SESSIONS === 2,
  five_session_standard_baseline: healthy.source_ready === true && healthy.comparable_history_dates.length === 5 && healthy.rvol_baseline_confidence === "standard",
  two_sessions_accepted_as_low_sample: twoSession.ok === true && twoSession.rvol_baseline_session_count === 2 && twoSession.rvol_baseline_confidence === "low_sample",
  rvol_and_atr_pass: healthy.ok === true && healthy.session_rvol_5d >= 1.5 && healthy.tail_rvol_5d >= 1.5,
  insufficient_history_is_data_gap: insufficient.ok === false && insufficient.source_ready === false && insufficient.reason === "atr_rvol_history_data_gap",
  atr_overheat_is_rejected: overheat.ok === false && overheat.checks.tr_atr_ratio_08_22 === false,
};
const failedChecks = Object.entries(checks).filter(([, ok]) => ok !== true).map(([name]) => name);
console.log(JSON.stringify({ ok: failedChecks.length === 0, contract: "strategy3-atr-rvol-tail-continuation-v1", checks, failed_checks: failedChecks, first_blocker: failedChecks[0] || null }, null, 2));
process.exitCode = failedChecks.length ? 1 : 0;
