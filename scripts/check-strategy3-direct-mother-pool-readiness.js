"use strict";

const path = require("path");
const { RUNTIME_DIR, taipeiDate, nowTaipeiIso, readJson } = require("./strategy3-v2-contract");

const tradeDate = process.argv.find((arg) => arg.startsWith("--trade-date="))?.slice(13) || taipeiDate();
const poolPath = path.join(RUNTIME_DIR, "cache", "intraday", "fugle-daytrade-ws-priority-symbols.json");
const quotePath = path.join(RUNTIME_DIR, "cache", "intraday", "fugle-daytrade-ws-quotes-v2.json");
const candlePath = path.join(RUNTIME_DIR, "cache", "intraday", "fugle-daytrade-ws-candles-v2.json");
const minimumCoverageRatio = Math.max(0.9, Number(process.env.STRATEGY3_V2_MIN_LOCAL_COVERAGE_RATIO || 0.9));

function rows(payload, key) { return Array.isArray(payload) ? payload : Array.isArray(payload?.[key]) ? payload[key] : []; }
function codeOf(value) { return String(value?.symbol || value?.code || value || "").replace(/\D/g, "").slice(0, 4); }
function minuteOf(value) {
  const time = Date.parse(value || "");
  if (!Number.isFinite(time)) return 0;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(time));
  return Number(parts.find((p) => p.type === "hour")?.value || 0) * 60 + Number(parts.find((p) => p.type === "minute")?.value || 0);
}

const pool = readJson(poolPath, null);
const quotes = readJson(quotePath, null);
const candles = readJson(candlePath, null);
const poolTradeDate = String(pool?.tradeDate || pool?.trade_date || "").slice(0, 10);
const symbols = [...new Set((pool?.daytradeMotherPoolSymbols || []).map(codeOf).filter((code) => /^\d{4}$/.test(code)))];
const symbolSet = new Set(symbols);
const quoteSymbols = new Set(rows(quotes, "quotes").map(codeOf).filter((code) => symbolSet.has(code)));
const candleCounts = new Map();
let latestCandleTime = "";
let sessionLatestMinute = 0;
for (const candle of rows(candles, "candles")) {
  if (String(candle.tradeDate || "").slice(0, 10) !== tradeDate) continue;
  const code = codeOf(candle);
  if (!symbolSet.has(code)) continue;
  candleCounts.set(code, (candleCounts.get(code) || 0) + 1);
  const timestamp = String(candle.candleTime || candle.date || "");
  const minute = minuteOf(timestamp);
  if (minute > sessionLatestMinute) { sessionLatestMinute = minute; latestCandleTime = timestamp; }
}
const readyCount = [...candleCounts.values()].filter((count) => count >= 20).length;
const expectedCount = symbols.length;
const requiredReadyCount = Math.ceil(expectedCount * minimumCoverageRatio);
const coverageRatio = expectedCount ? readyCount / expectedCount : 0;
const issues = [];
if (!pool) issues.push("mother_pool_cache_missing");
if (poolTradeDate !== tradeDate) issues.push("mother_pool_trade_date_mismatch");
if (!expectedCount) issues.push("mother_pool_empty");
if (coverageRatio < minimumCoverageRatio) issues.push("mother_pool_1m_coverage_below_90_percent");
if (sessionLatestMinute < 770) issues.push("mother_pool_latest_minute_before_1250");
if (!quoteSymbols.size) issues.push("mother_pool_quote_cache_empty");

const payload = {
  ok: issues.length === 0,
  ready: issues.length === 0,
  source: "strategy3_direct_daytrade_mother_pool_v2_cache",
  checkedAt: nowTaipeiIso(), tradeDate: poolTradeDate,
  sessionReadyCount: readyCount, expectedCount, requiredReadyCount,
  quoteReadyCount: quoteSymbols.size, coverageRatio: Number(coverageRatio.toFixed(4)),
  minimumCoverageRatio, latestCandleTime, sessionLatestMinute,
  files: { motherPool: poolPath, quotes: quotePath, candles: candlePath },
  reason: issues[0] || "strategy3_direct_mother_pool_ready", issues,
};
console.log(JSON.stringify(payload, null, 2));
process.exitCode = payload.ok ? 0 : 1;
