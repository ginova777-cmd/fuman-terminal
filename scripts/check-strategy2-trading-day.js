"use strict";

const path = require("path");
const { isTwseTradingDay } = require("./twse-trading-day");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const STATE_DIR = process.env.FUMAN_STATE_DIR || path.join(RUNTIME_DIR, "state");

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
}

function parseDate(value) {
  const text = String(value || "").trim();
  if (!text) return new Date();
  if (/^\d{8}$/.test(text)) {
    return new Date(`${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T12:00:00+08:00`);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return new Date(`${text}T12:00:00+08:00`);
  return new Date(text);
}

async function main() {
  const date = parseDate(argValue("--date", process.env.STRATEGY2_TRADING_DAY_DATE || ""));
  const closedExitCode = Number(argValue("--closed-exit-code", process.env.STRATEGY2_CLOSED_EXIT_CODE || "10"));
  const result = await isTwseTradingDay(date, { stateDir: STATE_DIR });
  const payload = {
    ok: result.isTradingDay,
    strategy: "strategy2",
    status: result.isTradingDay ? "trading_day" : "market_closed",
    tradeDate: result.date,
    rocDate: result.rocDate,
    reason: result.isTradingDay
      ? result.reason
      : `market_closed: ${result.date} is not a TWSE trading day (${result.reason})`,
    source: result.source || "twse-trading-day",
    suggestedScannerBehavior: result.isTradingDay
      ? "run Strategy2 readiness source collectors"
      : "skip Strategy2 readiness source collectors; preserve latest complete run; do not publish new complete run",
  };
  console.log(JSON.stringify(payload, null, 2));
  if (!result.isTradingDay) process.exitCode = Number.isFinite(closedExitCode) ? closedExitCode : 10;
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    strategy: "strategy2",
    status: "failed",
    reason: `trading day check failed: ${error?.message || String(error)}`,
    suggestedScannerBehavior: "preserve latest complete run; do not publish new complete run",
  }, null, 2));
  process.exit(1);
});
