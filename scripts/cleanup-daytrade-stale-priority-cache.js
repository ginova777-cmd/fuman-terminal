"use strict";

const fs = require("fs");
const path = require("path");

const RUNTIME = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const apply = process.argv.includes("--apply");
const json = process.argv.includes("--json");
const CACHE_PATH = path.join(RUNTIME, "cache", "intraday", "fugle-daytrade-ws-priority-symbols.json");
const QUOTE_CACHE_PATHS = [
  path.join(RUNTIME, "cache", "intraday", "fugle-daytrade-ws-quotes.json"),
  path.join(RUNTIME, "cache", "intraday", "fugle-daytrade-ws-quotes-v2.json"),
  path.join(RUNTIME, "cache", "intraday", "fugle-ws-quotes.json"),
  path.join(RUNTIME, "cache", "intraday", "fugle-daytrade-quotes-latest.json"),
];
const STATUS_DIR = path.join(RUNTIME, "status");
const RECEIPT_DIR = path.join(RUNTIME, "data", "scan-receipts");

const PRIORITY_KEYS = [
  "daytradeMotherPoolSymbols",
  "daytradePrioritySymbols",
  "daytradeHotPoolSymbols",
  "daytradeCandlePrioritySymbols",
  "openingReport0830PrewarmSymbols",
  "openingReport0830QuoteRefreshSymbols",
  "terminalPrioritySymbols",
  "openingPrioritySymbols",
  "daytradePriorityExtensionSymbols",
  "userCaseSymbols",
  "userCaseCandlePrioritySymbols",
];
const STALE_CACHE_KEYS = [...PRIORITY_KEYS, "symbols"];

function arg(name, fallback = "") {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value === `--${name}` || value.startsWith(prefix));
  if (!found) return fallback;
  return found === `--${name}` ? "1" : found.slice(prefix.length);
}

function taipeiDateParts() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return { iso: `${get("year")}-${get("month")}-${get("day")}`, id: `${get("year")}${get("month")}${get("day")}` };
}

function compactDate(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function symbolOf(value) {
  return String(value?.symbol || value?.code || value || "").replace(/\D/g, "").slice(0, 4);
}

function n(value, fallback = NaN) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function quotePriceBySymbol() {
  const prices = {};
  for (const quotePath of QUOTE_CACHE_PATHS) {
    const payload = readJson(quotePath, {});
    const rows = Array.isArray(payload?.quotes) ? payload.quotes : (Array.isArray(payload) ? payload : Array.isArray(payload?.rows) ? payload.rows : []);
    for (const row of rows) {
      const symbol = symbolOf(row);
      const price = n(row?.price ?? row?.last_price ?? row?.lastPrice ?? row?.close, NaN);
      if (symbol && Number.isFinite(price) && price > 0) prices[symbol] = price;
    }
  }
  return prices;
}
function unique(items) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const key = JSON.stringify(item);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function main() {
  const date = taipeiDateParts();
  const tradeDate = arg("trade-date", date.iso);
  const tradeDateId = compactDate(tradeDate) || date.id;
  const cache = readJson(CACHE_PATH, null);
  const failures = [];
  const rejected = [];
  const touchedKeys = [];
  let rewritten = false;
  let cacheDate = "";

  if (cache && typeof cache === "object") {
    cacheDate = compactDate(cache.tradeDate || cache.trade_date || cache.priorityBridge?.tradeDate || cache.updatedAt);
    const staleWholeCache = !cacheDate || cacheDate !== tradeDateId;
    const priceBySymbol = { ...(cache.daytradePoolPriceBySymbol || cache.priceBySymbol || {}), ...quotePriceBySymbol() };

    for (const key of (staleWholeCache ? STALE_CACHE_KEYS : PRIORITY_KEYS)) {
      const original = Array.isArray(cache[key]) ? cache[key] : [];
      if (!original.length) continue;

      const kept = [];
      let changed = false;
      for (const item of original) {
        const symbol = symbolOf(item);
        const price = n(priceBySymbol[symbol], NaN);
        const lowPrice = Number.isFinite(price) && price > 0 && price < 50;
        if (staleWholeCache || lowPrice) {
          changed = true;
          rejected.push({
            key,
            symbol,
            price: Number.isFinite(price) ? price : null,
            cache_trade_date: cacheDate || null,
            trade_date: tradeDate,
            reason: staleWholeCache ? (cacheDate ? "stale_cache_trade_date_mismatch" : "stale_cache_trade_date_missing") : "low_price_priority_cache_rejected",
          });
        } else {
          kept.push(item);
        }
      }

      if (changed) {
        touchedKeys.push(key);
        if (apply) cache[key] = kept;
        rewritten = true;
      }
    }

    if (apply && rewritten) {
      cache.lastStaleCacheCleanupAt = new Date().toISOString();
      cache.lastStaleCacheCleanupTradeDate = tradeDate;
      cache.staleCacheRejectedCount = rejected.length;
      writeJson(CACHE_PATH, cache);
    }
  }

  const now = new Date().toISOString();
  const payload = {
    ok: failures.length === 0,
    applied: apply,
    dryRun: !apply,
    checkedAt: now,
    checked_at: now,
    trade_date: tradeDate,
    tradeDate: tradeDate,
    contract: "daytrade-stale-priority-cache-cleanup-v1",
    cache_path: CACHE_PATH,
    cache_exists: !!cache,
    cache_trade_date: cacheDate || null,
    priority_keys_checked: PRIORITY_KEYS,
    touched_keys: unique(touchedKeys),
    stale_cache_rejected_count: rejected.length,
    low_price_rejected_count: rejected.filter((item) => item.reason === "low_price_priority_cache_rejected").length,
    stale_cache_rejected: unique(rejected).slice(0, 500),
    failures,
    reason_code: failures[0]?.code || (rejected.length ? "stale_cache_rejected_daily_cleanup" : "no_stale_cache_rejected"),
    protected: ["formal candidates", "strategy results", "daily OHLCV", "formal 1m evidence tables", "latest scorecards"],
  };

  const statusFile = path.join(STATUS_DIR, `daytrade-stale-priority-cache-cleanup-${tradeDateId}.json`);
  const latestReceipt = path.join(RECEIPT_DIR, "daytrade-priority-cache-stale-rejected-latest.json");
  const datedReceipt = path.join(RECEIPT_DIR, `daytrade-priority-cache-stale-rejected-${tradeDateId}.json`);
  payload.receiptFile = statusFile;
  payload.latestReceiptFile = latestReceipt;
  payload.datedReceiptFile = datedReceipt;
  writeJson(statusFile, payload);
  writeJson(latestReceipt, payload);
  writeJson(datedReceipt, payload);

  console.log(json ? JSON.stringify(payload, null, 2) : `daytrade stale priority cache cleanup: rejected=${payload.stale_cache_rejected_count} applied=${payload.applied}`);
  if (!payload.ok) process.exitCode = 1;
}

main();
