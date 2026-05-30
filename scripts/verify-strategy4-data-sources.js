const fs = require("fs");
const path = require("path");
const { fetchMisQuotes } = require("../lib/mis-quotes");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const FUGLE_API_KEY_FILE = process.env.FUGLE_API_KEY_FILE || path.join(RUNTIME_DIR, "secrets", "fugle-api-key.txt");
const FUGLE_API_KEY = process.env.FUGLE_API_KEY || process.env.FUGLE_MARKETDATA_API_KEY || readSecret(FUGLE_API_KEY_FILE);
const REQUIRE_FUGLE = process.env.STRATEGY4_REQUIRE_FUGLE === "1";
const REQUIRE_YAHOO = process.env.STRATEGY4_REQUIRE_YAHOO === "1";
const REQUIRE_MIS = process.env.STRATEGY4_REQUIRE_MIS === "1";
const MIN_HEALTHY_HISTORY_SOURCES = Number(process.env.STRATEGY4_MIN_HEALTHY_HISTORY_SOURCES || 2);
const MIN_ROWS = Number(process.env.STRATEGY4_SOURCE_HEALTH_MIN_ROWS || 60);
const TEST_CODE = String(process.env.STRATEGY4_SOURCE_HEALTH_CODE || "2330").replace(/\D/g, "").slice(0, 4) || "2330";
const TEST_TPEX_CODE = String(process.env.STRATEGY4_SOURCE_HEALTH_TPEX_CODE || "5274").replace(/\D/g, "").slice(0, 4) || "5274";

function readSecret(file) {
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
}

function isoDateDaysAgo(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function monthStarts(count = 7) {
  const out = [];
  const date = new Date();
  date.setUTCDate(1);
  for (let i = 0; i < count; i++) {
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
    out.push({
      twse: `${yyyy}${mm}01`,
      tpex: `${yyyy}/${mm}/01`,
    });
    date.setUTCMonth(date.getUTCMonth() - 1);
  }
  return out;
}

async function fetchJson(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FumanTerminalBot/1.0)",
        Accept: "application/json,text/plain,*/*",
        ...(options.headers || {}),
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function countFugleRows(payload) {
  const rows = payload?.data || payload?.candles || payload?.items || payload;
  return Array.isArray(rows) ? rows.length : 0;
}

function countYahooRows(payload) {
  const result = payload?.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const quote = result?.indicators?.quote?.[0] || {};
  return timestamps.filter((_, index) => Number.isFinite(Number(quote.close?.[index]))).length;
}

function countOfficialRows(payload) {
  const rows = payload?.data || payload?.tables?.[0]?.data || [];
  return Array.isArray(rows) ? rows.length : 0;
}

async function checkTwseOfficial() {
  let rows = 0;
  let lastError = "";
  for (const item of monthStarts()) {
    try {
      const url = `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${item.twse}&stockNo=${TEST_CODE}`;
      const payload = await fetchJson(url, { headers: { Referer: "https://www.twse.com.tw/" } });
      rows += countOfficialRows(payload);
      if (rows >= MIN_ROWS) break;
    } catch (error) {
      lastError = error.message || String(error);
    }
  }
  if (rows >= MIN_ROWS) return { ok: true, source: "twse-official-history", rows, history: true, error: "" };

  const latestUrl = "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL";
  const payload = await fetchJson(latestUrl, { headers: { Referer: "https://www.twse.com.tw/" } });
  const latestRows = Array.isArray(payload) ? payload.filter((row) => String(row.Code || "") === TEST_CODE).length : 0;
  return {
    ok: latestRows > 0,
    source: "twse-official-latest",
    rows: latestRows,
    history: false,
    error: latestRows > 0 ? `history unavailable (${lastError || `too few rows: ${rows}/${MIN_ROWS}`}); latest daily-all OK` : `history unavailable and latest missing (${lastError})`,
  };
}

async function checkTpexOfficial() {
  let rows = 0;
  for (const item of monthStarts()) {
    const url = `https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock?code=${TEST_TPEX_CODE}&date=${encodeURIComponent(item.tpex)}&id=&response=json`;
    const payload = await fetchJson(url, { headers: { Referer: "https://www.tpex.org.tw/" } });
    rows += countOfficialRows(payload);
    if (rows >= MIN_ROWS) break;
  }
  return { ok: rows >= MIN_ROWS, source: "tpex-official", rows, history: true, error: rows >= MIN_ROWS ? "" : `too few rows: ${rows}/${MIN_ROWS}` };
}

async function checkFugle() {
  if (!FUGLE_API_KEY) {
    return { ok: false, source: "fugle", rows: 0, error: `missing API key: ${FUGLE_API_KEY_FILE}` };
  }
  const params = new URLSearchParams({
    symbol: TEST_CODE,
    from: isoDateDaysAgo(280),
    to: isoDateDaysAgo(0),
  });
  const url = `https://api.fugle.tw/marketdata/v1.0/stock/historical/candles/${TEST_CODE}?${params.toString()}`;
  const payload = await fetchJson(url, { headers: { Referer: "https://developer.fugle.tw/", "X-API-KEY": FUGLE_API_KEY } });
  const rows = countFugleRows(payload);
  return { ok: rows >= MIN_ROWS, source: "fugle", rows, history: true, error: rows >= MIN_ROWS ? "" : `too few rows: ${rows}/${MIN_ROWS}` };
}

async function checkYahoo() {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${TEST_CODE}.TW?range=9mo&interval=1d&events=history&includeAdjustedClose=true`;
  const payload = await fetchJson(url, { headers: { Referer: "https://finance.yahoo.com/" } });
  const rows = countYahooRows(payload);
  return { ok: rows >= MIN_ROWS, source: "yahoo-tw", rows, history: true, error: rows >= MIN_ROWS ? "" : `too few rows: ${rows}/${MIN_ROWS}` };
}

async function checkMis() {
  const quotes = await fetchMisQuotes([TEST_CODE, TEST_TPEX_CODE]);
  const rows = quotes.size;
  return { ok: rows > 0, source: "mis", rows, history: false, error: rows > 0 ? "" : "no MIS quotes returned" };
}

(async () => {
  const checks = [];
  for (const fn of [checkTwseOfficial, checkTpexOfficial, checkFugle, checkYahoo, checkMis]) {
    try {
      checks.push(await fn());
    } catch (error) {
      const source = fn === checkTwseOfficial ? "twse-official"
        : fn === checkTpexOfficial ? "tpex-official"
        : fn === checkFugle ? "fugle"
        : fn === checkYahoo ? "yahoo-tw"
        : "mis";
      checks.push({ ok: false, source, rows: 0, history: fn !== checkMis, error: error.message || String(error) });
    }
  }

  checks.forEach((check) => {
    const status = check.ok ? "OK" : "FAIL";
    console.log(`Strategy4 data source ${status}: ${check.source}, rows=${check.rows}${check.error ? `, ${check.error}` : ""}`);
  });

  const fugle = checks.find((check) => check.source === "fugle");
  const yahoo = checks.find((check) => check.source === "yahoo-tw");
  const mis = checks.find((check) => check.source === "mis");
  const healthyHistorySources = checks.filter((check) => check.history && check.ok).length;
  if (healthyHistorySources < MIN_HEALTHY_HISTORY_SOURCES) {
    throw new Error(`Strategy4 healthy history sources too few: ${healthyHistorySources}/${MIN_HEALTHY_HISTORY_SOURCES}`);
  }
  if (REQUIRE_FUGLE && !fugle?.ok) throw new Error(`Strategy4 Fugle health check failed: ${fugle?.error || "unknown error"}`);
  if (REQUIRE_YAHOO && !yahoo?.ok) throw new Error(`Strategy4 Yahoo health check failed: ${yahoo?.error || "unknown error"}`);
  if (REQUIRE_MIS && !mis?.ok) throw new Error(`Strategy4 MIS health check failed: ${mis?.error || "unknown error"}`);
  if (!yahoo?.ok) console.log("Strategy4 Yahoo health check is warning-only because Yahoo is the informal last fallback.");
  if (!mis?.ok) console.log("Strategy4 MIS health check is warning-only because historical sources can still complete the scan.");
})().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
