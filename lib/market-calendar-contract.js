"use strict";

const path = require("path");
const { isTwseTradingDay, taipeiDateParts, dateKey } = require("../scripts/twse-trading-day");

function taipeiToday(now = new Date()) {
  return dateKey(taipeiDateParts(now));
}

function compactDate(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function isoDate(value) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const digits = compactDate(text);
  return digits.length === 8 ? digits.slice(0, 4) + "-" + digits.slice(4, 6) + "-" + digits.slice(6, 8) : "";
}

function normalizeClosedReason(reason = "") {
  const text = String(reason || "").toLowerCase();
  if (/typhoon|颱風|停班|停課/.test(text)) return "typhoon_holiday";
  if (/weekend|週末|星期六|星期日/.test(text)) return "weekend";
  if (/twse|exchange|休市|停止交易|market_closed/.test(text)) return "exchange_closed";
  if (/holiday|國定|放假/.test(text)) return "national_holiday";
  return text || "market_closed";
}

function taipeiClockParts(now = new Date()) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now).reduce((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});
}

function minutesFromHHMM(value, fallback) {
  const digits = String(value || "").replace(/\D/g, "").padStart(4, "0").slice(0, 4);
  const hour = Number(digits.slice(0, 2));
  const minute = Number(digits.slice(2, 4));
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) return fallback;
  return hour * 60 + minute;
}

function taipeiMinuteOfDay(now = new Date()) {
  const parts = taipeiClockParts(now);
  return Number(parts.hour || 0) * 60 + Number(parts.minute || 0);
}

function sourceWindow(now = new Date()) {
  const currentMinute = taipeiMinuteOfDay(now);
  const startMinute = minutesFromHHMM(process.env.FUMAN_FORMAL_SOURCE_WINDOW_START || "0830", 8 * 60 + 30);
  const endMinute = minutesFromHHMM(process.env.FUMAN_FORMAL_SOURCE_WINDOW_END || "1335", 13 * 60 + 35);
  return {
    start: `${String(Math.floor(startMinute / 60)).padStart(2, "0")}:${String(startMinute % 60).padStart(2, "0")}`,
    end: `${String(Math.floor(endMinute / 60)).padStart(2, "0")}:${String(endMinute % 60).padStart(2, "0")}`,
    startMinute,
    endMinute,
    currentMinute,
    inWindow: currentMinute >= startMinute && currentMinute <= endMinute,
    phase: currentMinute < startMinute ? "before_formal_source_window" : currentMinute > endMinute ? "after_formal_source_window" : "formal_source_window",
  };
}

async function findPreviousTradingDate(now, stateDir, maxLookbackDays = 14) {
  const base = now instanceof Date ? now : new Date(now || Date.now());
  for (let offset = 1; offset <= maxLookbackDays; offset += 1) {
    const probe = new Date(base.getTime() - offset * 24 * 60 * 60 * 1000);
    const status = await isTwseTradingDay(probe, { stateDir, ignoreOverrides: false }).catch(() => null);
    if (status?.isTradingDay === true) return status.date || taipeiToday(probe);
  }
  return "";
}

function displayReason(reason = "") {
  const normalized = normalizeClosedReason(reason);
  return {
    typhoon_holiday: "颱風假休市",
    national_holiday: "國定假日休市",
    exchange_closed: "交易所休市",
    weekend: "週末休市",
    market_closed: "市場休市",
    trading_day_outside_formal_source_window: "交易日非正式掃描時段",
  }[normalized] || "市場休市";
}

async function buildMarketCalendarContract(options = {}) {
  const now = options.now || new Date();
  const stateDir = options.stateDir || process.env.FUMAN_STATE_DIR || path.join(process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime", "state");
  const tradingDay = await isTwseTradingDay(now, { stateDir });
  const today = tradingDay.date || taipeiToday(now);
  const tradingDayOpen = tradingDay.isTradingDay === true;
  const formalWindow = sourceWindow(now);
  const sourceFreshnessRequired = tradingDayOpen && formalWindow.inWindow;
  const marketOpen = tradingDayOpen;
  const closedReason = marketOpen ? "" : normalizeClosedReason(tradingDay.reason || tradingDay.row?.Name || tradingDay.row?.Description);
  const skipReason = marketOpen
    ? (sourceFreshnessRequired ? "" : `trading_day_${formalWindow.phase}`)
    : "market_closed";
  const explicitPreviousTradingDate = isoDate(options.previousTradingDate || process.env.FUMAN_PREVIOUS_TRADING_DATE || "") || "";
  const previousTradingDate = sourceFreshnessRequired ? "" : (marketOpen ? await findPreviousTradingDate(now, stateDir) : (explicitPreviousTradingDate || await findPreviousTradingDate(now, stateDir)));
  const displayTradeDate = sourceFreshnessRequired ? today : (previousTradingDate || today || "previous_trading_day");
  return {
    ok: true,
    contract: "market-calendar-contract-v1",
    checkedAt: new Date().toISOString(),
    requestedDate: today,
    marketDate: today,
    marketOpen,
    marketStatus: marketOpen ? (sourceFreshnessRequired ? "open" : formalWindow.phase) : "closed",
    closedReason,
    closedReasonText: marketOpen ? (sourceFreshnessRequired ? "" : displayReason("trading_day_outside_formal_source_window")) : displayReason(closedReason || tradingDay.reason),
    finalMarketOpen: marketOpen,
    tradingDayOpen,
    formalSourceWindow: formalWindow,
    formalSourceWindowOpen: sourceFreshnessRequired,
    sourceFreshnessRequired,
    formalScanSkipped: !sourceFreshnessRequired,
    skipReason,
    preservePreviousGood: !sourceFreshnessRequired,
    latestPointerUpdated: false,
    emptyResultWritten: false,
    scannerAction: sourceFreshnessRequired ? "allow_formal_scan" : "skip_formal_scan",
    displayMode: sourceFreshnessRequired ? "live_market" : (marketOpen ? "trading_day_wait_source_window_previous_good" : "market_closed_previous_good"),
    displayTradeDate,
    resumePolicy: "auto_resume_next_trading_day",
    evidenceStatus: sourceFreshnessRequired ? "complete" : (marketOpen ? "waiting_source_window" : "market_closed"),
    unattendedStatus: sourceFreshnessRequired ? "YES" : (marketOpen ? "WAITING_SOURCE_WINDOW" : "SKIPPED_MARKET_CLOSED"),
    tradingDay,
    override: tradingDay.override === true,
    overrideFile: tradingDay.overrideFile || "",
    lockedBy: tradingDay.lockedBy || "",
  };
}

function installMarketCalendarResponse(response, marketCalendar) {
  if (!response || response.__marketCalendarInstalled || !marketCalendar) return response;
  const originalJson = typeof response.json === "function" ? response.json.bind(response) : null;
  if (originalJson) {
    response.json = (payload) => originalJson(attachMarketCalendar(payload, marketCalendar));
  }
  response.__marketCalendarInstalled = true;
  return response;
}

function attachMarketCalendar(payload, marketCalendar) {
  if (!payload || typeof payload !== "object" || !marketCalendar) return payload;
  const shouldPreserve = marketCalendar.sourceFreshnessRequired !== true;
  return {
    ...payload,
    marketCalendar,
    marketOpen: marketCalendar.marketOpen,
    marketStatus: marketCalendar.marketStatus,
    closedReason: marketCalendar.closedReason,
    closedReasonText: marketCalendar.closedReasonText,
    requestedDate: marketCalendar.requestedDate,
    displayTradeDate: shouldPreserve ? marketCalendar.displayTradeDate : (payload.displayTradeDate || payload.tradeDate || payload.usedDate || marketCalendar.displayTradeDate),
    formalScanSkipped: shouldPreserve,
    skipReason: shouldPreserve ? marketCalendar.skipReason : (payload.skipReason || ""),
    sourceFreshnessRequired: marketCalendar.sourceFreshnessRequired,
    preservePreviousGood: shouldPreserve ? true : payload.preservePreviousGood,
    latestPointerUpdated: shouldPreserve ? false : payload.latestPointerUpdated,
    emptyResultWritten: shouldPreserve ? false : payload.emptyResultWritten,
  };
}

module.exports = {
  buildMarketCalendarContract,
  attachMarketCalendar,
  installMarketCalendarResponse,
  normalizeClosedReason,
  sourceWindow,
};
