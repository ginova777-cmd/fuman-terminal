const fs = require("fs");
const path = require("path");
const { statePath, runtimePath } = require("./runtime-paths");
const { hasTelegramConfig, sendTelegramText } = require("./telegram-push");

const OUTBOX_FILE = statePath("daytrade-intraday-burst-telegram-outbox.json");
const STATE_FILE = statePath("daytrade-intraday-burst-telegram-state.json");
const RECEIPT_DIR = runtimePath("data", "scan-receipts");
const COOLDOWN_SECONDS = Math.max(60, Number(process.env.DAYTRADE_BURST_TELEGRAM_COOLDOWN_SECONDS || 300));
const MAX_EVENT_AGE_SECONDS = Math.max(30, Number(process.env.DAYTRADE_BURST_TELEGRAM_MAX_EVENT_AGE_SECONDS || 180));

function readJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + "\n");
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
function isTradingWindow() { const minutes = taipeiMinutes(); return minutes >= 540 && minutes <= 750; }
function formatNumber(value, digits = 2) { return numberValue(value, 0).toLocaleString("zh-TW", { maximumFractionDigits: digits, minimumFractionDigits: 0 }); }
function eventLabel(type) {
  if (type === "price_breakout_1pct") return "瞬間拉抬";
  if (type === "volume_burst_rolling60_x2") return "瞬間巨量";
  return "盤中雷達";
}
function eventMessage(event) {
  const identity = (String(event.symbol || "") + " " + String(event.name || "")).trim();
  const signalLabels = { kd_5_3_3: "KD(5,3,3)黃金交叉", rsi_4_cross_6: "RSI(4)突破RSI(6)", macd_7_12_20: "MACD(7,12,20)黃金交叉" };
  const technical = (Array.isArray(event.technical_golden_cross_signals) ? event.technical_golden_cross_signals : []).map((key) => signalLabels[key] || key).join("／");
  return [
    "當沖盤中雷達｜" + eventLabel(event.trigger_type),
    identity,
    "入場價: " + formatNumber(event.latest_1m_close),
    "技術確認: " + technical,
  ].join("\n");
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
function writeReceiptWithHistory(receipt) {
  const file = receiptPath(receipt.trade_date);
  const previous = readJson(file, {});
  const previousSent = previous?.trade_date === receipt.trade_date ? previous.sent_events : [];
  const stateSent = sentEventsFromState(receipt.trade_date);
  const attemptSentCount = Array.isArray(receipt.sent_events) ? receipt.sent_events.length : 0;
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
  writeJson(file, receipt);
}
function validEvent(event, tradeDate, nowMs) {
  const failures = [];
  const triggerType = String(event.trigger_type || "");
  if (String(event.trade_date || "") !== tradeDate) failures.push("trade_date_mismatch");
  if (!/^\d{4}$/.test(String(event.symbol || ""))) failures.push("symbol_invalid");
  if (numberValue(event.price) < 50) failures.push("price_below_50");
  if (event.tradable_mother_pool !== true) failures.push("not_daytrade_mother_pool_eligible");
  if (event.quote_fresh !== true || numberValue(event.quote_age_seconds, 999999) > 120) failures.push("quote_not_fresh");
  if (!["price_breakout_1pct", "volume_burst_rolling60_x2"].includes(triggerType)) failures.push("trigger_type_invalid");
  if (String(event.rolling_1m_baseline_status || "") !== "ready") failures.push("rolling_1m_baseline_not_ready");
  if (numberValue(event.rolling_1m_baseline_sample_count) < 60) failures.push("rolling_1m_samples_below_60");
  if (String(event.technical_indicator_status || "") !== "ready") failures.push("technical_indicator_not_ready");
  const technicalSignals = Array.isArray(event.technical_golden_cross_signals) ? event.technical_golden_cross_signals : [];
  const allowedTechnicalSignals = ["kd_5_3_3", "rsi_4_cross_6", "macd_7_12_20"];
  if (event.technical_golden_cross_any !== true || !technicalSignals.some((signal) => allowedTechnicalSignals.includes(String(signal)))) failures.push("technical_golden_cross_not_met");
  if (triggerType === "price_breakout_1pct" && !(numberValue(event.latest_1m_close) >= numberValue(event.rolling_1m_prior_high_close) * 1.01)) failures.push("price_rule_not_met");
  if (triggerType === "volume_burst_rolling60_x2" && !(numberValue(event.latest_1m_volume) >= numberValue(event.rolling_1m_baseline_volume) * 2)) failures.push("volume_rule_not_met");
  const eventTime = Date.parse(event.latest_1m_time || event.checked_at || "");
  if (!Number.isFinite(eventTime) || nowMs - eventTime > MAX_EVENT_AGE_SECONDS * 1000) failures.push("event_too_old");
  return failures;
}
async function notifyFromOutbox(options = {}) {
  const checkedAt = new Date().toISOString();
  const nowMs = Date.now();
  const tradeDate = options.tradeDate || taipeiDate();
  const outbox = readJson(OUTBOX_FILE, {});
  const receipt = {
    ok: false, contract: "daytrade_intraday_burst_telegram_v1", trade_date: tradeDate, checked_at: checkedAt,
    source: "fugle_formal_1m", alert_scope: "strategy2_mother_pool_only_0900_1230_with_same_day_fugle_1m_coverage",
    conditions: { price_breakout: "latest_1m_close >= prior_rolling60_high_close * 1.01", volume_burst: "latest_1m_volume >= prior_rolling60_average_volume * 2", min_rolling_samples: 20 },
    detected_events: 0, sent_events: [], skipped_events: [], first_blocker: null,
  };
  if (String(outbox.trade_date || "") !== tradeDate) {
    receipt.first_blocker = "outbox_trade_date_mismatch_or_missing";
    writeReceiptWithHistory(receipt); return receipt;
  }
  if (String(outbox.alert_scope || "") !== "strategy2_mother_pool_only_0900_1230_with_same_day_fugle_1m_coverage") {
    receipt.first_blocker = "outbox_scope_not_mother_pool_only";
    writeReceiptWithHistory(receipt); return receipt;
  }
  if (!isTradingWindow()) {
    receipt.ok = true; receipt.first_blocker = "outside_trading_window";
    writeReceiptWithHistory(receipt); return receipt;
  }
  if (!hasTelegramConfig()) {
    receipt.first_blocker = "telegram_not_configured";
    writeReceiptWithHistory(receipt); return receipt;
  }
  const state = readJson(STATE_FILE, { sent: {} });
  const sent = state && state.trade_date === tradeDate && state.sent && typeof state.sent === "object" ? state.sent : {};
  const events = Array.isArray(outbox.events) ? outbox.events : [];
  receipt.detected_events = events.length;
  const oldBypass = process.env.FUMAN_ALLOW_DAYTRADE_BURST_TELEGRAM;
  process.env.FUMAN_ALLOW_DAYTRADE_BURST_TELEGRAM = "true";
  try {
    for (const event of events) {
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
  receipt.ok = true; writeReceiptWithHistory(receipt); return receipt;
}
if (require.main === module) {
  const tradeDate = process.argv.find((value) => value.startsWith("--trade-date="))?.slice("--trade-date=".length);
  notifyFromOutbox({ tradeDate }).then((result) => {
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.first_blocker && result.first_blocker !== "outside_trading_window" ? 1 : 0;
  }).catch((error) => { console.error(error.stack || error.message || String(error)); process.exitCode = 1; });
}
module.exports = { notifyFromOutbox };




