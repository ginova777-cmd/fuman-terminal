const fs = require("fs");
const path = require("path");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const FUGLE_API_KEY_FILE = process.env.FUGLE_API_KEY_FILE || path.join(RUNTIME_DIR, "secrets", "fugle-api-key.txt");
const FUGLE_API_KEY = process.env.FUGLE_API_KEY || process.env.FUGLE_MARKETDATA_API_KEY || readSecret(FUGLE_API_KEY_FILE);
const REQUIRE_FUGLE = process.env.STRATEGY4_REQUIRE_FUGLE !== "0";
const REQUIRE_YAHOO = process.env.STRATEGY4_REQUIRE_YAHOO === "1";
const MIN_ROWS = Number(process.env.STRATEGY4_SOURCE_HEALTH_MIN_ROWS || 60);
const TEST_CODE = String(process.env.STRATEGY4_SOURCE_HEALTH_CODE || "2330").replace(/\D/g, "").slice(0, 4) || "2330";

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
  return { ok: rows >= MIN_ROWS, source: "fugle", rows, error: rows >= MIN_ROWS ? "" : `too few rows: ${rows}/${MIN_ROWS}` };
}

async function checkYahoo() {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${TEST_CODE}.TW?range=9mo&interval=1d&events=history&includeAdjustedClose=true`;
  const payload = await fetchJson(url, { headers: { Referer: "https://finance.yahoo.com/" } });
  const rows = countYahooRows(payload);
  return { ok: rows >= MIN_ROWS, source: "yahoo-tw", rows, error: rows >= MIN_ROWS ? "" : `too few rows: ${rows}/${MIN_ROWS}` };
}

(async () => {
  const checks = [];
  for (const fn of [checkFugle, checkYahoo]) {
    try {
      checks.push(await fn());
    } catch (error) {
      checks.push({ ok: false, source: fn === checkFugle ? "fugle" : "yahoo-tw", rows: 0, error: error.message || String(error) });
    }
  }

  checks.forEach((check) => {
    const status = check.ok ? "OK" : "FAIL";
    console.log(`Strategy4 data source ${status}: ${check.source}, rows=${check.rows}${check.error ? `, ${check.error}` : ""}`);
  });

  const fugle = checks.find((check) => check.source === "fugle");
  const yahoo = checks.find((check) => check.source === "yahoo-tw");
  if (REQUIRE_FUGLE && !fugle?.ok) throw new Error(`Strategy4 Fugle health check failed: ${fugle?.error || "unknown error"}`);
  if (REQUIRE_YAHOO && !yahoo?.ok) throw new Error(`Strategy4 Yahoo health check failed: ${yahoo?.error || "unknown error"}`);
  if (!yahoo?.ok) console.log("Strategy4 Yahoo health check is warning-only because Yahoo is the informal last fallback.");
})().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
