"use strict";

const fs = require("fs");
const path = require("path");
const { RUNTIME_DIR, MIN_READY_SYMBOLS, MIN_CANDLES_PER_SYMBOL, taipeiDate, readJson } = require("./strategy3-v2-contract");
const { reservePath, normalizeSymbols } = require("../lib/daytrade-candle-reserve");

const tradeDate = process.argv.find((arg) => arg.startsWith("--trade-date="))?.slice("--trade-date=".length) || taipeiDate();
const statusPath = path.join(RUNTIME_DIR, "state", "fugle-daytrade-websocket-status-v2.json");
const candlePath = path.join(RUNTIME_DIR, "cache", "intraday", "fugle-daytrade-ws-candles-v2.json");
const reserveFile = reservePath(RUNTIME_DIR, tradeDate);
const status = readJson(statusPath, {});
const reserve = readJson(reserveFile, null);
const now = new Date();
const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", hour12: false, hour: "2-digit", minute: "2-digit" }).formatToParts(now);
const clock = Object.fromEntries(parts.map((part) => [part.type, part.value]));
const minute = Number(clock.hour) * 60 + Number(clock.minute);
const isToday = tradeDate === taipeiDate();
const reserveSymbols = normalizeSymbols(reserve?.symbols);
const reserveSet = new Set(reserveSymbols);
const cache = readJson(candlePath, {});
const candles = Array.isArray(cache?.candles) ? cache.candles : [];
const counts = new Map();
for (const candle of candles) {
  const candleDate = String(candle.tradeDate || candle.date || "").slice(0, 10);
  const symbol = String(candle.code || candle.symbol || "").replace(/\D/g, "").slice(0, 4);
  if (candleDate !== tradeDate || !reserveSet.has(symbol)) continue;
  counts.set(symbol, (counts.get(symbol) || 0) + 1);
}
const reserveReady20 = [...counts.values()].filter((count) => count >= MIN_CANDLES_PER_SYMBOL).length;
const requiredReady = Math.ceil(MIN_READY_SYMBOLS * 0.9);
const afterReserveWindow = !isToday || minute >= 8 * 60 + 45;
const afterReadinessWindow = !isToday || minute >= 12 * 60 + 30;
const checks = [];
function check(name, ok, details = {}) { checks.push({ name, ok, ...details }); }
if (afterReserveWindow) {
  check("same_day_reserve_exists", Boolean(reserve), { reserveFile });
  check("reserve_trade_date", String(reserve?.tradeDate || "") === tradeDate, { value: reserve?.tradeDate || null });
  check("reserve_capacity_1000", reserveSymbols.length >= MIN_READY_SYMBOLS, { reserveSymbols: reserveSymbols.length, required: MIN_READY_SYMBOLS });
  check("collector_reports_frozen_reserve", Number(status.frozenCandleSymbols || 0) >= MIN_READY_SYMBOLS && String(status.candleReserveSource || "").includes("frozen_reserve"), { frozenCandleSymbols: status.frozenCandleSymbols || 0, candleReserveSource: status.candleReserveSource || null });
}
if (afterReadinessWindow) {
  check("reserve_ready_20_candles_at_90_percent", reserveReady20 >= requiredReady, { reserveReady20, requiredReady, minCandlesPerSymbol: MIN_CANDLES_PER_SYMBOL });
}
const failed_checks = checks.filter((item) => !item.ok).map((item) => item.name);
const statusLabel = !afterReserveWindow ? "PREOPEN_PENDING" : !afterReadinessWindow ? "RESERVE_ACTIVE_HYDRATING" : failed_checks.length ? "RESERVE_NOT_READY" : "RESERVE_READY";
console.log(JSON.stringify({
  ok: failed_checks.length === 0,
  contract: "strategy3_v2_candle_reserve_readonly_v1",
  status: statusLabel,
  trade_date: tradeDate,
  checked_at: new Date().toISOString(),
  reserve_file: reserveFile,
  status_file: statusPath,
  candle_cache: candlePath,
  reserve_symbols: reserveSymbols.length,
  reserve_ready_20_candles: reserveReady20,
  required_ready_20_candles: requiredReady,
  checks,
  failed_checks,
  first_blocker: failed_checks[0] || null,
  read_only: true,
}, null, 2));
process.exitCode = failed_checks.length ? 1 : 0;