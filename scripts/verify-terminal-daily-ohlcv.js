"use strict";

const fs = require("fs");
const path = require("path");
const { terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const OUT_DIR = path.resolve(process.argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length) || "outputs/terminal-daily-ohlcv");
const RESOURCE = process.argv.find((arg) => arg.startsWith("--resource="))?.slice("--resource=".length) || "v_stock_daily_ohlcv_completeness";
const MIN_SYMBOLS = Math.max(1, Number(process.env.FUMAN_DAILY_OHLC_MIN_SYMBOLS || "1500") || 1500);
const REQUIRED_DAYS = Math.max(1, Number(process.env.FUMAN_DAILY_OHLC_REQUIRED_DAYS || "20") || 20);
const TIMEOUT_MS = Math.max(1000, Number(process.env.FUMAN_DAILY_OHLC_TIMEOUT_MS || "10000") || 10000);

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function compactDate(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function isWeekdayDate(value) {
  const text = compactDate(value);
  if (!/^\d{8}$/.test(text)) return false;
  const date = new Date(`${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T00:00:00Z`);
  return ![0, 6].includes(date.getUTCDay());
}

async function readUniverseCount(base, key) {
  const rows = [];
  try {
    for (let offset = 0; offset < 10000; offset += 1000) {
      const url = new URL("/rest/v1/stock_universe", base);
      url.searchParams.set("select", "symbol");
      url.searchParams.set("is_active", "eq.true");
      url.searchParams.set("is_etf", "eq.false");
      url.searchParams.set("is_warrant", "eq.false");
      url.searchParams.set("is_cb", "eq.false");
      url.searchParams.set("is_blacklisted", "eq.false");
      url.searchParams.set("is_daytrade_unsuitable", "eq.false");
      url.searchParams.set("offset", String(offset));
      url.searchParams.set("limit", "1000");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let response;
      let responseText;
      try {
        response = await fetch(url, {
          signal: controller.signal,
          headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
        });
        responseText = await response.text();
      } finally {
        clearTimeout(timer);
      }
      let body = null;
      try { body = responseText ? JSON.parse(responseText) : null; } catch {}
      if (!response.ok) return { count: 0, error: responseText.slice(0, 300) };
      if (!Array.isArray(body) || body.length === 0) break;
      rows.push(...body);
      if (body.length < 1000) break;
    }
    return { count: rows.length, error: "" };
  } catch (error) {
    return { count: 0, error: String(error.message || error) };
  }
}
async function readSummary() {
  const base = terminalSupabaseUrl({ runtimeDir: RUNTIME_DIR }).replace(/\/+$/, '');
  const key = terminalSupabaseKey({ runtimeDir: RUNTIME_DIR });
  const universe = await readUniverseCount(base, key);
  const url = new URL(`/rest/v1/${RESOURCE}`, base);
  url.searchParams.set('select', 'trade_date,rows,ohlc_rows,ohlc_symbols');
  url.searchParams.set('order', 'trade_date.desc');
  url.searchParams.set('limit', String(Math.max(REQUIRED_DAYS + 5, 30)));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
          headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
    });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch {}
    return { ok: response.ok, status: response.status, url: `${url.pathname}${url.search}`, rows: Array.isArray(body) ? body : [], error: response.ok ? '' : text.slice(0, 500), expectedSymbols: universe.count, universeError: universe.error };
  } catch (error) {
    return { ok: false, status: 0, url: `${url.pathname}${url.search}`, rows: [], error: String(error.message || error), expectedSymbols: universe.count, universeError: universe.error };
  } finally {
    clearTimeout(timer);
  }
}

function buildResult(read) {
  const expectedSymbols = numeric(read.expectedSymbols);
  const minSymbols = expectedSymbols > 0 ? Math.ceil(expectedSymbols * 0.90) : MIN_SYMBOLS;
  const rows = read.rows
    .map((row) => ({ tradeDate: compactDate(row.trade_date), rows: numeric(row.rows), ohlcRows: numeric(row.ohlc_rows), ohlcSymbols: numeric(row.ohlc_symbols) }))
    .filter((row) => /^\d{8}$/.test(row.tradeDate) && isWeekdayDate(row.tradeDate))
    .sort((a, b) => b.tradeDate.localeCompare(a.tradeDate));
  const latest = rows[0] || null;
  const recent = rows.filter((row) => row.rows > 0).slice(0, REQUIRED_DAYS);
  const failedDays = recent.filter((row) => row.ohlcSymbols < minSymbols);
  const failures = [];
  if (!read.ok) failures.push(read.status === 404 ? 'DAILY_OHLC_CONTRACT_MISSING' : 'DAILY_OHLC_SOURCE_UNREADABLE');
  if (!latest) failures.push('DAILY_OHLC_NO_ROWS');
  else if (latest.ohlcSymbols < minSymbols) failures.push('DAILY_OHLC_LATEST_COVERAGE_LOW');
  if (recent.length < REQUIRED_DAYS) failures.push('DAILY_OHLC_HISTORY_LESS_THAN_20_TRADING_DAYS');
  if (failedDays.length) failures.push('DAILY_OHLC_RECENT_DAY_COVERAGE_LOW');
  return {
    ok: failures.length === 0,
    contract: 'terminal-daily-ohlcv-completeness-v2',
    resource: RESOURCE,
    checkedAt: new Date().toISOString(),
    expectedEligibleSymbols: expectedSymbols || null,
    minimumCoveragePercent: 90,
    latestTradeDate: latest?.tradeDate || '',
    latestValidOhlcSymbols: latest?.ohlcSymbols || 0,
    requiredMinValidSymbols: minSymbols,
    recentTradingDaysChecked: recent.length,
    requiredTradingDays: REQUIRED_DAYS,
    backfilledRecent20TradingDays: recent.length >= REQUIRED_DAYS && failedDays.length === 0,
    failures: [...new Set(failures)],
    coverage: recent,
    publishAllowed: failures.length === 0,
    reasonCode: failures.length ? 'DAILY_OHLC_INCOMPLETE' : '',
    repair: {
      required: failures.length > 0,
      command: 'pwsh -NoProfile -ExecutionPolicy Bypass -File C:\\fuman-terminal\\ops\\public-slot\\Backfill-Strategy4MissingDailyOhlcv.ps1 -MaxSymbols 2000 -RetainTradeDays 20 -DelaySeconds 8 -MinimumCoveragePercent 90',
      idempotencyKey: `daily-ohlcv:${latest?.tradeDate || 'unknown'}:20`,
      sourceWriterOnly: true,
      note: 'Repair must run on the approved source writer host; never fabricate OHLC and never publish until this verifier passes.',
    },
    readback: { status: read.status, url: read.url, error: read.error, universeError: read.universeError || '' },
  };
}

async function main() {
  const read = await readSummary();
  const result = buildResult(read);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "terminal-daily-ohlcv.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (require.main === module) main().catch((error) => { console.error(error.stack || error.message || error); process.exit(1); });

module.exports = { buildResult, compactDate };


