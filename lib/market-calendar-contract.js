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

async function findPreviousTradingDate(now, stateDir, maxLookbackDays = 14) {
  const base = now instanceof Date ? now : new Date(now || Date.now());
  for (let offset = 1; offset <= maxLookbackDays; offset += 1) {
    const probe = new Date(base.getTime() - offset * 24 * 60 * 60 * 1000);
    const status = await isTwseTradingDay(probe, { stateDir }).catch(() => null);
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
  }[normalized] || "市場休市";
}

async function buildMarketCalendarContract(options = {}) {
  const now = options.now || new Date();
  const stateDir = options.stateDir || process.env.FUMAN_STATE_DIR || path.join(process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime", "state");
  const tradingDay = await isTwseTradingDay(now, { stateDir });
  const today = tradingDay.date || taipeiToday(now);
  const marketOpen = tradingDay.isTradingDay === true;
  const closedReason = marketOpen ? "" : normalizeClosedReason(tradingDay.reason || tradingDay.row?.Name || tradingDay.row?.Description);
  const explicitPreviousTradingDate = isoDate(options.previousTradingDate || process.env.FUMAN_PREVIOUS_TRADING_DATE || "") || "";
  const previousTradingDate = marketOpen ? "" : (explicitPreviousTradingDate || await findPreviousTradingDate(now, stateDir));
  return {
    ok: true,
    contract: "market-calendar-contract-v1",
    checkedAt: new Date().toISOString(),
    requestedDate: today,
    marketDate: today,
    marketOpen,
    marketStatus: marketOpen ? "open" : "closed",
    closedReason,
    closedReasonText: marketOpen ? "" : displayReason(closedReason || tradingDay.reason),
    finalMarketOpen: marketOpen,
    sourceFreshnessRequired: marketOpen,
    formalScanSkipped: !marketOpen,
    skipReason: marketOpen ? "" : "market_closed",
    preservePreviousGood: !marketOpen,
    latestPointerUpdated: false,
    emptyResultWritten: false,
    scannerAction: marketOpen ? "allow_formal_scan" : "skip_formal_scan",
    displayMode: marketOpen ? "live_market" : "market_closed_previous_good",
    displayTradeDate: marketOpen ? today : (previousTradingDate || "previous_trading_day"),
    resumePolicy: "auto_resume_next_trading_day",
    evidenceStatus: marketOpen ? "complete" : "market_closed",
    unattendedStatus: "YES",
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
  const closed = marketCalendar.marketOpen === false;
  return {
    ...payload,
    marketCalendar,
    marketOpen: marketCalendar.marketOpen,
    marketStatus: marketCalendar.marketStatus,
    closedReason: marketCalendar.closedReason,
    closedReasonText: marketCalendar.closedReasonText,
    requestedDate: marketCalendar.requestedDate,
    displayTradeDate: closed ? marketCalendar.displayTradeDate : (payload.displayTradeDate || payload.tradeDate || payload.usedDate || marketCalendar.displayTradeDate),
    formalScanSkipped: closed,
    skipReason: closed ? "market_closed" : (payload.skipReason || ""),
    sourceFreshnessRequired: marketCalendar.sourceFreshnessRequired,
    preservePreviousGood: closed ? true : payload.preservePreviousGood,
    latestPointerUpdated: closed ? false : payload.latestPointerUpdated,
    emptyResultWritten: closed ? false : payload.emptyResultWritten,
  };
}

module.exports = {
  buildMarketCalendarContract,
  attachMarketCalendar,
  installMarketCalendarResponse,
  normalizeClosedReason,
};
