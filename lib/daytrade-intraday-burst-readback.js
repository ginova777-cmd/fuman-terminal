"use strict";

const CONTRACT = "daytrade_intraday_burst_readback_v1";
const SOURCE_NAME = "fugle_formal_1m";

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizedSymbol(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 4);
}

function checkedAgeSeconds(value, checkedAt) {
  const checked = Date.parse(String(checkedAt || ""));
  const candle = Date.parse(String(value || ""));
  if (!Number.isFinite(checked) || !Number.isFinite(candle)) return 999999;
  return Math.max(0, Math.floor((checked - candle) / 1000));
}

function burstType(instantPullup, instantVolume) {
  if (instantPullup && instantVolume) return "pullup_and_volume";
  if (instantPullup) return "pullup";
  if (instantVolume) return "volume";
  return "none";
}

function observationLabel(record) {
  if (record?.burst_type === "pullup_and_volume") return "觀察｜瞬間拉抬+瞬間巨量";
  if (record?.burst_type === "pullup") return "觀察｜瞬間拉抬";
  if (record?.burst_type === "volume") return "觀察｜瞬間巨量";
  return "";
}

// Telegram emits one event per trigger. The shared readback merges same-minute
// price and volume events, while retaining the exact writer inputs and rules.
function normalizeBurstEvents(events, options = {}) {
  const tradeDate = String(options.tradeDate || "");
  const checkedAt = String(options.checkedAt || new Date().toISOString());
  const byKey = new Map();
  for (const event of Array.isArray(events) ? events : []) {
    const symbol = normalizedSymbol(event?.symbol);
    const candleTime = String(event?.latest_1m_time || event?.candle_time || "");
    if (!symbol || !candleTime || (tradeDate && String(event?.trade_date || "") !== tradeDate)) continue;
    const key = `${symbol}|${candleTime}`;
    const existing = byKey.get(key) || {
      trade_date: String(event.trade_date || tradeDate),
      symbol,
      name: String(event.name || symbol),
      candle_time: candleTime,
      checked_at: String(event.checked_at || checkedAt),
      latest_1m_close: number(event.latest_1m_close),
      latest_1m_volume: number(event.latest_1m_volume),
      prior_rolling60_high_close: number(event.rolling_1m_prior_high_close),
      prior_rolling60_average_volume: number(event.rolling_1m_baseline_volume),
      rolling_sample_count: number(event.rolling_1m_baseline_sample_count),
      rolling_baseline_status: String(event.rolling_1m_baseline_status || ""),
      source_name: SOURCE_NAME,
      source_run_id: String(event.run_id || ""),
      quote_age_seconds: number(event.quote_age_seconds),
      intraday_1m_stale_seconds: number(event.intraday_1m_stale_seconds),
      instant_pullup: false,
      instant_volume: false,
    };
    existing.instant_pullup ||= String(event.trigger_type || "") === "price_breakout_1pct";
    existing.instant_volume ||= String(event.trigger_type || "") === "volume_burst_rolling60_x2";
    byKey.set(key, existing);
  }
  return [...byKey.values()].map((record) => {
    const freshAge = Number.isFinite(record.intraday_1m_stale_seconds)
      ? record.intraday_1m_stale_seconds
      : checkedAgeSeconds(record.candle_time, record.checked_at);
    const baselineReady = record.rolling_sample_count >= 20 && record.rolling_baseline_status === "ready";
    const formulasHold = (record.instant_pullup
      ? record.latest_1m_close >= record.prior_rolling60_high_close * 1.01
      : true)
      && (record.instant_volume
        ? record.latest_1m_volume >= record.prior_rolling60_average_volume * 2
        : true);
    const dataStatus = baselineReady && freshAge <= 180 && formulasHold ? "OK" : "DATA_GAP";
    const reasonCode = dataStatus === "OK" ? ""
      : !baselineReady ? "burst_rolling60_baseline_not_ready"
        : freshAge > 180 ? "burst_formal_1m_stale"
          : "burst_formula_evidence_invalid";
    return {
      ...record,
      burst_type: burstType(record.instant_pullup, record.instant_volume),
      data_status: dataStatus,
      reason_code: reasonCode,
      stale_seconds: freshAge,
    };
  }).filter((record) => record.burst_type !== "none");
}

function attachBurstObservation(candidate, burst) {
  const record = burst || null;
  const label = record?.data_status === "OK" ? observationLabel(record) : "";
  const reason = record?.data_status === "DATA_GAP" ? record.reason_code || "burst_readback_missing" : "";
  return {
    ...(candidate || {}),
    burstReadback: record,
    burstObservationLabel: label,
    burstDataGapReason: reason,
    observationLabels: [...new Set([...(candidate?.observationLabels || []), label].filter(Boolean))],
  };
}

module.exports = {
  CONTRACT,
  SOURCE_NAME,
  normalizeBurstEvents,
  observationLabel,
  attachBurstObservation,
};
