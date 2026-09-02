"use strict";

const fs = require("fs");
const path = require("path");
const { normalizeBurstEvents, observationLabel } = require("../lib/daytrade-intraday-burst-readback");

const ROOT = path.resolve(__dirname, "..");
function read(file) { return fs.readFileSync(path.join(ROOT, file), "utf8"); }

const events = [
  { trade_date: "2026-08-29", symbol: "2408", name: "南亞科", latest_1m_time: "2026-08-29T09:15:00+08:00", latest_1m_close: 101, latest_1m_volume: 200, rolling_1m_prior_high_close: 100, rolling_1m_baseline_volume: 100, rolling_1m_baseline_sample_count: 60, rolling_1m_baseline_status: "ready", intraday_1m_stale_seconds: 10, checked_at: "2026-08-29T09:15:10+08:00", trigger_type: "price_breakout_1pct" },
  { trade_date: "2026-08-29", symbol: "2408", name: "南亞科", latest_1m_time: "2026-08-29T09:15:00+08:00", latest_1m_close: 101, latest_1m_volume: 200, rolling_1m_prior_high_close: 100, rolling_1m_baseline_volume: 100, rolling_1m_baseline_sample_count: 60, rolling_1m_baseline_status: "ready", intraday_1m_stale_seconds: 10, checked_at: "2026-08-29T09:15:10+08:00", trigger_type: "volume_burst_rolling60_x2" },
];
const rows = normalizeBurstEvents(events, { tradeDate: "2026-08-29", checkedAt: "2026-08-29T09:15:10+08:00" });
const writer = read("scripts/run-daytrade-source-writer.js");
const water = read("scripts/run-strategy2-v3-water-scan.js");
const reader = read("lib/daytrade-intraday-burst-reader.js");
const signal = read("lib/strategy2-v3-signal.js");
const liveScan = read("scripts/run-strategy2-v3-live-scan.js");
const readonlyVerifier = read("scripts/verify-daytrade-intraday-burst-readback-readonly.js");
const sql = read("ops/public-slot/DaytradeIntradayBurstReadback_20260829.sql");
const checks = {
  exact_price_rule: writer.includes("latest1mClose >= priceTriggerLevel"),
  exact_volume_rule: writer.includes("latest1mVolume >= volumeTriggerLevel"),
  writer_persists_local_readback: writer.includes("daytrade-intraday-burst-readback.json") && writer.includes("normalizeBurstEvents(events"),
  writer_persists_supabase_readback: writer.includes('"fugle_daytrade_intraday_burst_events"') && writer.includes('"trade_date,symbol,candle_time"'),
  view_contract_present: sql.includes("v_fugle_daytrade_intraday_burst_readback") && sql.includes("prior_rolling60_high_close") && sql.includes("prior_rolling60_average_volume"),
  reader_is_canonical_view_only: water.includes("readBurstReadback") && reader.includes("burst_readback_missing") && reader.includes("v_fugle_daytrade_intraday_burst_readback"),
  strategy_observation_only: signal.includes("attachBurstObservation") && liveScan.includes("burstObservationLabel") && !signal.includes("burstReadback.formalCandidate"),
  merge_same_minute_triggers: rows.length === 1 && rows[0].burst_type === "pullup_and_volume",
  exact_merged_labels: observationLabel(rows[0]) === "觀察｜瞬間拉抬+瞬間巨量",
  valid_formula_stays_ok: rows[0]?.data_status === "OK",
  zero_rows_requires_writer_health: readonlyVerifier.includes("v_fugle_daytrade_source_health_readback") && readonlyVerifier.includes("burst_writer_health_missing") && readonlyVerifier.includes('dataGap ? "DATA_GAP"'),
  off_session_zero_rows_stays_off_session: readonlyVerifier.includes('const noMatch = marketSession &&') && readonlyVerifier.includes('const burstStatus = !marketSession ? "OFF_SESSION"'),
};
const failedChecks = Object.entries(checks).filter(([, value]) => !value).map(([key]) => key);
console.log(JSON.stringify({ ok: failedChecks.length === 0, contract: "daytrade_intraday_burst_readback_contract_v1", checks, failed_checks: failedChecks, first_blocker: failedChecks[0] || null, read_only: true }, null, 2));
process.exitCode = failedChecks.length ? 1 : 0;
