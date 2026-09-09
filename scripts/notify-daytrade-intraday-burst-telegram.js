const fs = require("fs");
const path = require("path");
const { statePath, runtimePath } = require("./runtime-paths");
const { hasTelegramConfig, sendTelegramText } = require("./telegram-push");
const { readCanonicalDaytradeWater, canonicalRunId } = require("../lib/daytrade-canonical-water-reader");

const OUTBOX_FILE = statePath("daytrade-intraday-burst-telegram-outbox.json");
const STATE_FILE = statePath("daytrade-intraday-burst-telegram-state.json");
const RECEIPT_DIR = runtimePath("data", "scan-receipts");
const COOLDOWN_SECONDS = Math.max(60, Number(process.env.DAYTRADE_BURST_TELEGRAM_COOLDOWN_SECONDS || 300));
const MAX_EVENT_AGE_SECONDS = Math.max(30, Number(process.env.DAYTRADE_BURST_TELEGRAM_MAX_EVENT_AGE_SECONDS || 180));
const FIVE_MINUTE_MAX_STALE_SECONDS = Math.max(300, Number(process.env.DAYTRADE_BURST_TELEGRAM_5M_MAX_STALE_SECONDS || 600));
const SUPABASE_URL = String(process.env.SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/+$/, "");
const FIVE_MINUTE_RECEIPT_CONTRACT = "daytrade_intraday_5m_runner_verifier_receipt_v4";
const FIVE_MINUTE_CLASSIFICATION_CONTRACT = "daytrade_intraday_5m_branch_independent_strict_wait_v1";
const FIVE_MINUTE_STRATEGY_VERSION = "golden-cross-any-macd-3-9-3-v4";
const FIVE_MINUTE_CALCULATION_VERSION = "five-minute-indicators-macd-3-9-3-v4";

function readJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + "\n");
}
function readSecret(name) {
  try { return fs.readFileSync(runtimePath("secrets", name), "utf8").trim(); } catch { return ""; }
}
function taipeiDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const items = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return items.year + "-" + items.month + "-" + items.day;
}
function taipeiMinutes(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(value);
  const items = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(items.hour) * 60 + Number(items.minute);
}
function compactDate(value) { return String(value || "").replace(/\D/g, "").slice(0, 8); }
function numberValue(value, fallback = 0) { const number = Number(value); return Number.isFinite(number) ? number : fallback; }
function isTradingWindow(value = new Date()) { const minutes = taipeiMinutes(value); return minutes >= 540 && minutes <= 750; }
function formatNumber(value, digits = 2) { return numberValue(value, 0).toLocaleString("zh-TW", { maximumFractionDigits: digits, minimumFractionDigits: 0 }); }
function eventLabel(type) {
  if (type === "price_breakout_1pct") return "瞬間拉抬";
  if (type === "volume_burst_rolling60_x2") return "瞬間巨量";
  return "盤中雷達";
}
function eventMessage(event) {
  const fiveMinuteSuffix = event.five_minute_confirmation_status === "CONFIRMED_STRONG_5M" ? " (5分K強)" : "";
  const identity = (String(event.symbol || "") + " " + String(event.name || "")).trim() + fiveMinuteSuffix;
  const signalLabels = { kd_5_3_3: "KD(5,3,3)黃金交叉", rsi_4_cross_6: "RSI(4)突破RSI(6)", macd_7_12_20: "MACD(7,12,20)黃金交叉" };
  const technical = (Array.isArray(event.technical_golden_cross_signals) ? event.technical_golden_cross_signals : []).map((key) => signalLabels[key] || key).join("／");
  return [
    "當沖盤中雷達｜" + eventLabel(event.trigger_type),
    identity,
    "入場價: " + formatNumber(event.latest_1m_close),
    "技術確認: " + technical,
    "產業雷達: " + String(event.industry || "未分類") + "｜" + (event.industry_persistent_large_inflow === true ? "前三名持續流入" : "盤中突發大額流入") + "｜量價續強｜排行 " + formatNumber(event.industry_flow_rank, 0),
  ].join("\n");
}
async function readFiveMinuteConfirmations(events, tradeDate, nowMs = Date.now()) {
  const symbols = [...new Set((Array.isArray(events) ? events : []).map((event) => String(event?.symbol || "")).filter((symbol) => /^\d{4}$/.test(symbol)))];
  const result = { status: symbols.length ? "DATA_GAP_5M" : "not_required", view: "v_fugle_intraday_5m_readback", receipt_view: "v_fugle_intraday_5m_verification_readback", receipt_contract: FIVE_MINUTE_RECEIPT_CONTRACT, run_id: "", rows: 0, confirmed_strong: 0, bySymbol: new Map(), reason: null };
  if (!symbols.length) return result;
  const key = process.env.SUPABASE_ANON_KEY || readSecret("supabase-anon-key.txt");
  if (!key) { result.reason = "anon_key_missing"; return result; }
  try {
    const headers = { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" };
    const receiptFields = ["contract", "strategy_version", "calculation_version", "classification_contract", "run_id", "trade_date", "status", "complete", "exit_code", "first_blocker", "anon_http_status", "ssl_ok", "verified_at", "latest_complete_bar_end", "macd_parameters"];
    const receiptUrl = `${SUPABASE_URL}/rest/v1/v_fugle_intraday_5m_verification_readback?select=${receiptFields.join(",")}&trade_date=eq.${tradeDate}&order=verified_at.desc&limit=1`;
    const receiptResponse = await fetch(receiptUrl, { headers, signal: AbortSignal.timeout(10000) });
    if (!receiptResponse.ok) { result.reason = `receipt_anon_http_${receiptResponse.status}`; return result; }
    const receipt = (await receiptResponse.json())?.[0];
    const macdParameters = receipt?.macd_parameters || {};
    const receiptOk = receipt?.contract === FIVE_MINUTE_RECEIPT_CONTRACT
      && receipt?.strategy_version === FIVE_MINUTE_STRATEGY_VERSION
      && receipt?.calculation_version === FIVE_MINUTE_CALCULATION_VERSION
      && receipt?.classification_contract === FIVE_MINUTE_CLASSIFICATION_CONTRACT
      && receipt?.trade_date === tradeDate
      && receipt?.status === "complete"
      && receipt?.complete === true
      && Number(receipt?.exit_code) === 0
      && !receipt?.first_blocker
      && receipt?.ssl_ok === true
      && Number(receipt?.anon_http_status) === 200
      && Number(macdParameters.fast) === 3
      && Number(macdParameters.slow) === 9
      && Number(macdParameters.signal) === 3
      && /^five-minute-/.test(String(receipt?.run_id || ""));
    if (!receiptOk) { result.reason = "five_minute_v4_receipt_not_complete_or_mismatched"; return result; }
    result.run_id = String(receipt.run_id);

    const fields = ["symbol", "trade_date", "run_id", "bar_end", "bar_complete", "bar_kind", "confirmation_eligible", "data_gap_5m", "source_status", "trend_5m_status", "golden_cross_any_5m", "trend_5m_strategy_version", "calculation_version", "classification_contract", "macd_fast_period", "macd_slow_period", "macd_signal_period", "rsi3_cross_rsi6_up_5m", "kd_5_3_golden_cross_5m", "macd_3_9_3_dif_5m", "macd_3_9_3_dea_5m", "macd_3_9_3_histogram_5m", "previous_macd_3_9_3_dif_5m", "previous_macd_3_9_3_dea_5m", "macd_3_9_3_golden_cross_5m", "macd_3_9_3_zero_cross_up_5m", "ma5_cross_ma10_up_5m", "ma10_cross_ma20_up_5m", "ma5_cross_ma20_up_5m"];
    const url = `${SUPABASE_URL}/rest/v1/v_fugle_intraday_5m_readback?select=${fields.join(",")}&trade_date=eq.${tradeDate}&run_id=eq.${encodeURIComponent(result.run_id)}&symbol=in.(${symbols.join(",")})`;
    const response = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) { result.reason = `anon_http_${response.status}`; return result; }
    const rows = await response.json();
    result.rows = Array.isArray(rows) ? rows.length : 0;
    for (const row of Array.isArray(rows) ? rows : []) {
      const barEndMs = Date.parse(row?.bar_end || "");
      const branchValues = [row?.rsi3_cross_rsi6_up_5m, row?.kd_5_3_golden_cross_5m, row?.macd_3_9_3_golden_cross_5m, row?.ma5_cross_ma10_up_5m, row?.ma10_cross_ma20_up_5m, row?.ma5_cross_ma20_up_5m];
      const anyBranchTrue = branchValues.some((value) => value === true);
      const allBranchesFalse = branchValues.every((value) => value === false);
      const rowContractOk = String(row?.trade_date || "") === tradeDate
        && String(row?.run_id || "") === result.run_id
        && row?.bar_complete === true
        && row?.bar_kind === "regular_session"
        && row?.confirmation_eligible === true
        && row?.data_gap_5m !== true
        && row?.source_status === "ok"
        && row?.trend_5m_strategy_version === FIVE_MINUTE_STRATEGY_VERSION
        && row?.calculation_version === FIVE_MINUTE_CALCULATION_VERSION
        && row?.classification_contract === FIVE_MINUTE_CLASSIFICATION_CONTRACT
        && Number(row?.macd_fast_period) === 3
        && Number(row?.macd_slow_period) === 9
        && Number(row?.macd_signal_period) === 3
        && Number.isFinite(barEndMs)
        && barEndMs <= nowMs
        && nowMs - barEndMs <= FIVE_MINUTE_MAX_STALE_SECONDS * 1000;
      const confirmed = rowContractOk && row?.trend_5m_status === "CONFIRMED_STRONG_5M" && row?.golden_cross_any_5m === true && anyBranchTrue;
      const waiting = rowContractOk && row?.trend_5m_status === "WAIT_5M_CONFIRMATION" && row?.golden_cross_any_5m === false && allBranchesFalse;
      const signals = [
        row?.rsi3_cross_rsi6_up_5m === true ? "rsi3_cross_rsi6" : "",
        row?.kd_5_3_golden_cross_5m === true ? "kd_5_3_3" : "",
        row?.macd_3_9_3_golden_cross_5m === true ? "macd_3_9_3" : "",
        row?.ma5_cross_ma10_up_5m === true ? "ma5_cross_ma10" : "",
        row?.ma10_cross_ma20_up_5m === true ? "ma10_cross_ma20" : "",
        row?.ma5_cross_ma20_up_5m === true ? "ma5_cross_ma20" : "",
      ].filter(Boolean);
      result.bySymbol.set(String(row.symbol), { five_minute_confirmation_status: confirmed ? "CONFIRMED_STRONG_5M" : (waiting ? "WAIT_5M_CONFIRMATION" : "DATA_GAP_5M"), five_minute_bar_end: String(row?.bar_end || ""), five_minute_run_id: String(row?.run_id || ""), five_minute_confirmation_signals: signals, five_minute_macd_parameters: { fast: 3, slow: 9, signal: 3 }, five_minute_macd_zero_cross_up_diagnostic: rowContractOk ? row?.macd_3_9_3_zero_cross_up_5m === true : null });
      if (confirmed) result.confirmed_strong += 1;
    }
    result.status = "ready";
    return result;
  } catch (error) {
    result.reason = error?.message || String(error);
    return result;
  }
}
function eventKey(event) { return String(event.trade_date) + ":" + event.symbol + ":" + event.trigger_type; }
function telegramIdempotencyKey(tradeDate, event) {
  return "daytrade-intraday-burst:" + compactDate(tradeDate) + ":" + event.symbol + ":" + event.trigger_type + ":" + String(event.latest_1m_time || event.event_time || "").replace(/\D/g, "");
}
function receiptPath(tradeDate) { return path.join(RECEIPT_DIR, "daytrade-intraday-burst-telegram-" + compactDate(tradeDate) + ".json"); }
function canonicalSentEvent(event, tradeDate) {
  const eventTime = String(event?.event_time || event?.latest_1m_time || "");
  const sentAt = String(event?.sent_at || "");
  const symbol = String(event?.symbol || "");
  const triggerType = String(event?.trigger_type || "");
  if (!eventTime || !sentAt || !/^\d{4}$/.test(symbol) || !["price_breakout_1pct", "volume_burst_rolling60_x2"].includes(triggerType)) return null;
  const normalized = {
    event_key: String(event?.event_key || telegramIdempotencyKey(tradeDate, { symbol, trigger_type: triggerType, latest_1m_time: eventTime })),
    tradeDate,
    trade_date: tradeDate,
    symbol,
    name: String(event?.name || ""),
    trigger_type: triggerType,
    event_time: eventTime,
    latest_1m_time: eventTime,
    sent_at: sentAt,
    sent: true,
    send_result: "sent",
    industry: String(event?.industry || ""),
    industry_flow_direction: String(event?.industry_flow_direction || ""),
    industry_flow_label: String(event?.industry_flow_label || ""),
    industry_flow_rank: Number.isFinite(Number(event?.industry_flow_rank)) ? Number(event.industry_flow_rank) : null,
    industry_heat_score: Number.isFinite(Number(event?.industry_heat_score)) ? Number(event.industry_heat_score) : null,
    industry_flow_priority: String(event?.industry_flow_priority || ""),
    industry_net_flow_proxy: Number.isFinite(Number(event?.industry_net_flow_proxy)) ? Number(event.industry_net_flow_proxy) : null,
    five_minute_confirmation_status: String(event?.five_minute_confirmation_status || "DATA_GAP_5M"),
    five_minute_bar_end: String(event?.five_minute_bar_end || ""),
    five_minute_confirmation_signals: Array.isArray(event?.five_minute_confirmation_signals) ? event.five_minute_confirmation_signals : [],
  };
  if (Number.isFinite(Number(event?.telegram_target_count))) normalized.telegram_target_count = Number(event.telegram_target_count);
  return normalized;
}
function uniqueEvents(events, tradeDate) {
  const byKey = new Map();
  for (const raw of Array.isArray(events) ? events : []) {
    const event = canonicalSentEvent(raw, tradeDate);
    if (!event) continue;
    const previous = byKey.get(event.event_key) || {};
    byKey.set(event.event_key, { ...previous, ...event, name: event.name || previous.name || "" });
  }
  return [...byKey.values()].sort((a, b) => String(a.sent_at).localeCompare(String(b.sent_at)) || a.event_key.localeCompare(b.event_key));
}
function sentEventsFromState(tradeDate) {
  const state = readJson(STATE_FILE, {});
  if (state?.trade_date !== tradeDate || !state.sent || typeof state.sent !== "object") return [];
  return Object.entries(state.sent).flatMap(([key, value]) => {
    const [date, symbol, triggerType] = String(key).split(":");
    if (date !== tradeDate || !["price_breakout_1pct", "volume_burst_rolling60_x2"].includes(triggerType)) return [];
    const event = canonicalSentEvent({
      symbol,
      trigger_type: triggerType,
      latest_1m_time: value?.latest_1m_time || "",
      sent_at: value?.sent_at || "",
    }, tradeDate);
    return event ? [event] : [];
  });
}
function completeCanonicalWaterReceipt(value, tradeDate) {
  return value && typeof value === "object"
    && value.contract === "daytrade_canonical_water_reader_v1"
    && value.contract_version === "4.1.0"
    && value.status === "complete"
    && value.complete === true
    && String(value.trade_date || "") === tradeDate
    && !value.first_blocker
    && Array.isArray(value.failed_checks)
    && value.failed_checks.length === 0;
}
function writeReceiptWithHistory(receipt) {
  const file = receiptPath(receipt.trade_date);
  const previous = readJson(file, {});
  const previousSent = previous?.trade_date === receipt.trade_date ? previous.sent_events : [];
  const stateSent = sentEventsFromState(receipt.trade_date);
  const attemptSentCount = Array.isArray(receipt.sent_events) ? receipt.sent_events.length : 0;
  const currentCompleteCanonicalWater = completeCanonicalWaterReceipt(receipt.canonical_water, receipt.trade_date)
    ? receipt.canonical_water
    : null;
  const previousCompleteCanonicalWater = previous?.trade_date === receipt.trade_date
    ? [previous?.last_complete_canonical_water, previous?.canonical_water]
      .find((value) => completeCanonicalWaterReceipt(value, receipt.trade_date)) || null
    : null;
  receipt.last_complete_canonical_water = currentCompleteCanonicalWater || previousCompleteCanonicalWater;
  receipt.sent_events = uniqueEvents([...(Array.isArray(previousSent) ? previousSent : []), ...stateSent, ...(receipt.sent_events || [])], receipt.trade_date);
  receipt.sent_event_count = receipt.sent_events.length;
  receipt.last_attempt = {
    checked_at: receipt.checked_at,
    detected_events: receipt.detected_events,
    sent_events: attemptSentCount,
    skipped_events: Array.isArray(receipt.skipped_events) ? receipt.skipped_events.length : 0,
    first_blocker: receipt.first_blocker,
  };
  // A later out-of-window pass is informational; it cannot erase a proven same-day send.
  if (receipt.sent_events.length > 0 && receipt.first_blocker === "outside_trading_window") receipt.first_blocker = null;
  receipt.complete = true;
  receipt.status = receipt.ok === true ? "complete" : "failed";
  receipt.finished_at = new Date().toISOString();
  writeJson(file, receipt);
}
function validEvent(event, tradeDate, nowMs) {
  const failures = [];
  const triggerType = String(event.trigger_type || "");
  if (String(event.trade_date || "") !== tradeDate) failures.push("trade_date_mismatch");
  if (String(event.canonical_run_id || "") !== canonicalRunId(tradeDate)) failures.push("canonical_run_id_mismatch");
  if (event.canonical_water_mother_pool_member !== true) failures.push("canonical_water_not_in_mother_pool");
  if (event.canonical_water_quote_fresh !== true) failures.push("canonical_water_quote_not_fresh");
  if (event.canonical_water_intraday_1m_ready !== true) failures.push("canonical_water_intraday_1m_not_ready");
  if (!/^\d{4}$/.test(String(event.symbol || ""))) failures.push("symbol_invalid");
  if (numberValue(event.price) < 50) failures.push("price_below_50");
  if (event.tradable_mother_pool !== true) failures.push("not_daytrade_mother_pool_eligible");
  if (event.quote_fresh !== true || numberValue(event.quote_age_seconds, 999999) > 120) failures.push("quote_not_fresh");
  if (!["price_breakout_1pct", "volume_burst_rolling60_x2"].includes(triggerType)) failures.push("trigger_type_invalid");
  if (String(event.rolling_1m_baseline_status || "") !== "ready") failures.push("rolling_1m_baseline_not_ready");
  if (numberValue(event.rolling_1m_baseline_sample_count) < 60) failures.push("rolling_1m_samples_below_60");
  if (String(event.technical_indicator_status || "") !== "ready") failures.push("technical_indicator_not_ready");
  if (String(event.industry_flow_status || "") !== "ready" || !String(event.industry || "").trim()) failures.push("industry_heatmap_not_ready");
  if (!Number.isFinite(Number(event.industry_heat_score)) || !["inflow", "outflow", "neutral"].includes(String(event.industry_flow_direction || ""))) failures.push("industry_flow_invalid");
  if (event.industry_persistent_large_inflow !== true && event.industry_sudden_large_inflow !== true) failures.push("industry_not_top3_or_sudden_inflow");
  if (event.industry_volume_expansion_confirmed !== true) failures.push("industry_volume_expansion_not_confirmed");
  if (event.industry_price_rise_continuing !== true) failures.push("industry_price_rise_not_continuing");
  const technicalSignals = Array.isArray(event.technical_golden_cross_signals) ? event.technical_golden_cross_signals : [];
  const allowedTechnicalSignals = ["kd_5_3_3", "rsi_4_cross_6", "macd_7_12_20"];
  if (event.technical_golden_cross_any !== true || !technicalSignals.some((signal) => allowedTechnicalSignals.includes(String(signal)))) failures.push("technical_golden_cross_not_met");
  const fiveMinuteSignals = Array.isArray(event.five_minute_confirmation_signals) ? event.five_minute_confirmation_signals : [];
  if (String(event.five_minute_confirmation_status || "") !== "CONFIRMED_STRONG_5M" || fiveMinuteSignals.length === 0) failures.push("five_minute_not_confirmed_strong");
  if (triggerType === "price_breakout_1pct" && !(numberValue(event.latest_1m_close) >= numberValue(event.rolling_1m_prior_high_close) * 1.01)) failures.push("price_rule_not_met");
  if (triggerType === "volume_burst_rolling60_x2" && !(numberValue(event.latest_1m_volume) >= numberValue(event.rolling_1m_baseline_volume) * 2)) failures.push("volume_rule_not_met");
  const eventTime = Date.parse(event.latest_1m_time || event.checked_at || "");
  if (!Number.isFinite(eventTime) || nowMs - eventTime > MAX_EVENT_AGE_SECONDS * 1000) failures.push("event_too_old");
  return failures;
}
async function notifyFromOutbox(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const startedAt = now.toISOString();
  const checkedAt = startedAt;
  const nowMs = now.getTime();
  const tradeDate = options.tradeDate || taipeiDate();
  const outbox = readJson(OUTBOX_FILE, {});
  const events = Array.isArray(outbox.events) ? outbox.events : [];
  const receipt = {
    ok: false, complete: false, status: "running", contract: "daytrade_intraday_burst_telegram_v1", trade_date: tradeDate, checked_at: checkedAt, started_at: startedAt, finished_at: null,
    contract_version: "4.1.0",
    strategy_name: "daytrade_intraday_burst_telegram",
    strategy_contract: "daytrade_intraday_burst_telegram_v1",
    run_id: canonicalRunId(tradeDate),
    source_name: "fugle_daytrade_source",
    writes_supabase: false,
    event_candidate_source: "local_writer_outbox_after_supabase_canonical_revalidation",
    source: "fugle_formal_1m", alert_scope: "daytrade_mother_pool_only_0900_1230_with_same_day_fugle_1m_coverage_and_industry_heatmap",
    conditions: { price_breakout: "latest_1m_close >= prior_rolling60_high_close * 1.01", volume_burst: "latest_1m_volume >= prior_rolling60_average_volume * 2", min_rolling_samples: 60, technical_cross_any: ["kd_5_3_3", "rsi_4_cross_6", "macd_7_12_20"], five_minute_confirmation_required: true, five_minute_required_status: "CONFIRMED_STRONG_5M" },
    source_status_at_run: null, canonical_gate_at_run: null, unattended_gate_at_run: null,
    canonical_run_id: canonicalRunId(tradeDate), mother_pool_read_rows: 0,
    accepted_mother_pool_symbols: 0,
    requested_symbols: 0, evaluated_symbols: 0, matched_symbols: 0,
    quote_source_table: "fugle_daytrade_quotes_live",
    intraday_1m_source_table: "get_fugle_daytrade_intraday_1m_latest_n",
    intraday_5m_source_view: "v_fugle_intraday_5m_readback",
    latest_complete_5m_bar_end: null,
    source_updated_at: null, latest_quote_time: null, latest_1m_time: null,
    data_gap_count: 0, failed_checks: [],
    detected_events: 0, sent_events: [], skipped_events: [], first_blocker: null,
  };
  if (options.tradingWindowOverride !== true && !isTradingWindow(now)) {
    receipt.ok = true; receipt.first_blocker = "outside_trading_window";
    writeReceiptWithHistory(receipt); return receipt;
  }
  const canonicalWater = options.canonicalWaterResult || await readCanonicalDaytradeWater({
    tradeDate,
    symbols: events.map((event) => event?.symbol),
    barsPerSymbol: 61,
    telegramObservation: true,
  });
  receipt.canonical_water = canonicalWater.receipt;
  receipt.source_status_at_run = canonicalWater.receipt?.source_status_at_run || null;
  receipt.canonical_gate_at_run = canonicalWater.receipt?.canonical_gate_at_run || null;
  receipt.unattended_gate_at_run = canonicalWater.receipt?.unattended_gate_at_run || null;
  receipt.canonical_run_id = canonicalWater.receipt?.canonical_run_id || canonicalRunId(tradeDate);
  receipt.mother_pool_read_rows = numberValue(canonicalWater.receipt?.mother_pool_read_rows, 0);
  receipt.accepted_mother_pool_symbols = receipt.mother_pool_read_rows;
  receipt.requested_symbols = receipt.mother_pool_read_rows;
  receipt.evaluated_symbols = events.length;
  receipt.source_updated_at = canonicalWater.receipt?.source_status_at_run?.updated_at || null;
  receipt.latest_quote_time = canonicalWater.receipt?.latest_quote_time || null;
  receipt.latest_1m_time = canonicalWater.receipt?.latest_1m_time || null;
  receipt.data_gap_count = numberValue(canonicalWater.receipt?.data_gap_count, 0);
  receipt.failed_checks = Array.isArray(canonicalWater.failedChecks) ? canonicalWater.failedChecks : [];
  if (!canonicalWater.ok) {
    receipt.first_blocker = canonicalWater.firstBlocker || "canonical_water_data_gap";
    writeReceiptWithHistory(receipt); return receipt;
  }
  if (String(outbox.trade_date || "") !== tradeDate) {
    receipt.first_blocker = "outbox_trade_date_mismatch_or_missing";
    writeReceiptWithHistory(receipt); return receipt;
  }
  if (String(outbox.alert_scope || "") !== "daytrade_mother_pool_only_0900_1230_with_same_day_fugle_1m_coverage_and_industry_heatmap") {
    receipt.first_blocker = "outbox_scope_not_mother_pool_only";
    writeReceiptWithHistory(receipt); return receipt;
  }
  if (String(outbox.canonical_run_id || outbox.run_id || "") !== receipt.canonical_run_id) {
    receipt.first_blocker = "outbox_canonical_run_id_mismatch";
    receipt.failed_checks = [receipt.first_blocker];
    writeReceiptWithHistory(receipt); return receipt;
  }
  if (String(outbox.industry_heatmap_status || "") !== "ready" || !Array.isArray(outbox.industry_heatmap) || outbox.industry_heatmap.length === 0) {
    receipt.first_blocker = "industry_heatmap_not_ready";
    writeReceiptWithHistory(receipt); return receipt;
  }
  if (!hasTelegramConfig()) {
    receipt.first_blocker = "telegram_not_configured";
    writeReceiptWithHistory(receipt); return receipt;
  }
  const state = readJson(STATE_FILE, { sent: {} });
  const sent = state && state.trade_date === tradeDate && state.sent && typeof state.sent === "object" ? state.sent : {};
  receipt.detected_events = events.length;
  const fiveMinute = await readFiveMinuteConfirmations(events, tradeDate, nowMs);
  receipt.five_minute_confirmation = { status: fiveMinute.status, view: fiveMinute.view, receipt_view: fiveMinute.receipt_view, receipt_contract: fiveMinute.receipt_contract, run_id: fiveMinute.run_id, strategy_version: FIVE_MINUTE_STRATEGY_VERSION, calculation_version: FIVE_MINUTE_CALCULATION_VERSION, classification_contract: FIVE_MINUTE_CLASSIFICATION_CONTRACT, macd_parameters: { fast: 3, slow: 9, signal: 3 }, rows: fiveMinute.rows, confirmed_strong: fiveMinute.confirmed_strong, reason: fiveMinute.reason };
  receipt.latest_complete_5m_bar_end = [...fiveMinute.bySymbol.values()].map((row) => String(row?.five_minute_bar_end || "")).filter(Boolean).sort().pop() || null;
  const oldBypass = process.env.FUMAN_ALLOW_DAYTRADE_BURST_TELEGRAM;
  process.env.FUMAN_ALLOW_DAYTRADE_BURST_TELEGRAM = "true";
  try {
    for (const rawEvent of events) {
      const canonicalEvidence = canonicalWater.evidenceBySymbol.get(String(rawEvent?.symbol || "")) || {};
      const event = {
        ...rawEvent,
        canonical_run_id: receipt.canonical_run_id,
        canonical_water_mother_pool_member: canonicalEvidence.mother_pool_member === true,
        canonical_water_quote_fresh: canonicalEvidence.quote_fresh === true && canonicalEvidence.quote_trade_date_ok === true,
        canonical_water_intraday_1m_ready: canonicalEvidence.intraday_1m_ready === true && canonicalEvidence.intraday_1m_trade_date_ok === true,
        ...(fiveMinute.bySymbol.get(String(rawEvent?.symbol || "")) || { five_minute_confirmation_status: "DATA_GAP_5M", five_minute_bar_end: "", five_minute_confirmation_signals: [] }),
      };
      const failures = validEvent(event, tradeDate, nowMs);
      const key = eventKey(event);
      const sentAt = Date.parse(sent[key]?.sent_at || "");
      if (Number.isFinite(sentAt) && nowMs - sentAt < COOLDOWN_SECONDS * 1000) {
        receipt.skipped_events.push({ symbol: event.symbol, trigger_type: event.trigger_type, reason: "cooldown_active" }); continue;
      }
      if (failures.length) {
        receipt.skipped_events.push({ symbol: event.symbol, trigger_type: event.trigger_type, reason: failures[0], failures }); continue;
      }
      try {
        const results = await sendTelegramText(eventMessage(event), {
          motherPoolIntradayBurstTelegram: true, dataConfirmed: true, eventTime: event.latest_1m_time || event.checked_at,
          maxEventAgeSec: MAX_EVENT_AGE_SECONDS,
          idempotencyKey: telegramIdempotencyKey(tradeDate, event),
          dedupeScope: "daytrade-intraday-burst:" + compactDate(tradeDate),
        });
        const allSent = Array.isArray(results) && results.length > 0 && results.every((result) => result.sent === true);
        if (allSent) {
          sent[key] = { sent_at: checkedAt, latest_1m_time: event.latest_1m_time, trigger_type: event.trigger_type };
          receipt.sent_events.push(canonicalSentEvent({ ...event, event_time: event.latest_1m_time, sent_at: checkedAt, telegram_target_count: results.length }, tradeDate));
        } else {
          receipt.skipped_events.push({ symbol: event.symbol, trigger_type: event.trigger_type, reason: results?.[0]?.reason || "telegram_send_skipped" });
        }
      } catch (error) {
        receipt.skipped_events.push({ symbol: event.symbol, trigger_type: event.trigger_type, reason: "telegram_send_failed", detail: error?.message || String(error) });
      }
    }
  } finally {
    if (oldBypass === undefined) delete process.env.FUMAN_ALLOW_DAYTRADE_BURST_TELEGRAM;
    else process.env.FUMAN_ALLOW_DAYTRADE_BURST_TELEGRAM = oldBypass;
  }
  writeJson(STATE_FILE, { trade_date: tradeDate, updated_at: checkedAt, sent });
  receipt.matched_symbols = receipt.sent_events.length;
  receipt.ok = true; writeReceiptWithHistory(receipt); return receipt;
}
if (require.main === module) {
  const tradeDate = process.argv.find((value) => value.startsWith("--trade-date="))?.slice("--trade-date=".length);
  notifyFromOutbox({ tradeDate }).then((result) => {
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.first_blocker && result.first_blocker !== "outside_trading_window" ? 1 : 0;
  }).catch((error) => { console.error(error.stack || error.message || String(error)); process.exitCode = 1; });
}
module.exports = { notifyFromOutbox, eventMessage, readFiveMinuteConfirmations };




