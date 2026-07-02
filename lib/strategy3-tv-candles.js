const fs = require("fs");
const path = require("path");
const { fetchStrategy3Intraday1mLatestN } = require("./supabase-public-slot");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const FUGLE_API_KEY_FILE = process.env.FUGLE_API_KEY_FILE || path.join(RUNTIME_DIR, "secrets", "fugle-api-key.txt");
const FUGLE_TIMEOUT_MS = Math.max(3000, Number(process.env.STRATEGY3_FUGLE_1M_TIMEOUT_MS || 20000));
const MIN_FULL_ROWS = Math.max(35, Number(process.env.STRATEGY3_TV_MIN_FULL_1M_ROWS || 120));
const MAX_DEGENERATE_RATIO = Math.max(0, Number(process.env.STRATEGY3_TV_MAX_DEGENERATE_RATIO || 0.5));
const MIN_ENTRY_WINDOW_ROWS = Math.max(1, Number(process.env.STRATEGY3_TV_MIN_ENTRY_WINDOW_ROWS || 1));
const ALLOW_FUGLE_1M_DIAGNOSTIC_FALLBACK = process.env.STRATEGY3_ALLOW_FUGLE_1M_DIAGNOSTIC_FALLBACK === "1";

function readSecret(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

function fugleApiKey() {
  return process.env.FUGLE_API_KEY
    || process.env.FUGLE_MARKETDATA_API_KEY
    || readSecret(FUGLE_API_KEY_FILE);
}

function cleanNumber(value) {
  return Number(String(value ?? "").replace(/[,+%]/g, "").trim()) || 0;
}

function normalizeCode(code) {
  return String(code || "").replace(/\D/g, "").padStart(4, "0").slice(-4);
}

function candleMinutes(row) {
  const text = String(row?.candleTime || row?.time || row?.date || "");
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Taipei",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(parsed));
    const get = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
    return get("hour") * 60 + get("minute");
  }
  const match = text.match(/\b(\d{1,2}):(\d{2})(?::\d{2})?\b/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function normalizeCandle(row, symbol, source) {
  const candleTime = row.candleTime || row.candle_time || row.time || row.date || "";
  return {
    symbol,
    candleTime,
    time: candleTime,
    open: cleanNumber(row.open),
    high: cleanNumber(row.high),
    low: cleanNumber(row.low),
    close: cleanNumber(row.close),
    volume: cleanNumber(row.volume),
    updatedAt: row.updatedAt || row.updated_at || "",
    tradeDate: row.tradeDate || row.trade_date || "",
    candleSource: source,
  };
}

function sortCandles(candles) {
  return [...candles].sort((a, b) => Date.parse(a.candleTime || a.time || "") - Date.parse(b.candleTime || b.time || ""));
}

function candleQuality(candles) {
  const rows = (candles || []).filter((row) => cleanNumber(row.close) > 0 && cleanNumber(row.volume) > 0);
  const degenerateRows = rows.filter((row) => {
    const high = cleanNumber(row.high);
    const low = cleanNumber(row.low);
    return high > 0 && low > 0 && high === low;
  }).length;
  const sessionRows = rows.filter((row) => {
    const minutes = candleMinutes(row);
    return minutes != null && minutes >= 9 * 60 && minutes <= 12 * 60 + 59;
  }).length;
  const entryWindowRows = rows.filter((row) => {
    const minutes = candleMinutes(row);
    return minutes != null && minutes >= 12 * 60 + 50 && minutes <= 12 * 60 + 59;
  }).length;
  const latestCandleTime = rows.map((row) => row.candleTime || row.time || "").filter(Boolean).sort((a, b) => Date.parse(b) - Date.parse(a))[0] || "";
  return {
    rows: rows.length,
    degenerateRows,
    degenerateRatio: rows.length ? Number((degenerateRows / rows.length).toFixed(4)) : 1,
    sessionRows,
    entryWindowRows,
    latestCandleTime,
  };
}

function needsFullOhlcFallback(quality) {
  return cleanNumber(quality.rows) < MIN_FULL_ROWS
    || cleanNumber(quality.degenerateRatio) > MAX_DEGENERATE_RATIO
    || cleanNumber(quality.entryWindowRows) < MIN_ENTRY_WINDOW_ROWS;
}

function qualityReason(quality) {
  return `rows=${quality.rows}; degenerate=${quality.degenerateRows}/${quality.rows}; session=${quality.sessionRows}; entryWindow=${quality.entryWindowRows}`;
}

function betterQuality(candidate, current) {
  if (!candidate || !candidate.rows) return false;
  if (!current || !current.rows) return true;
  if (candidate.entryWindowRows > current.entryWindowRows && candidate.rows >= current.rows) return true;
  if (candidate.rows >= MIN_FULL_ROWS && candidate.degenerateRatio < current.degenerateRatio) return true;
  return candidate.rows > current.rows * 1.5 && candidate.degenerateRatio <= current.degenerateRatio;
}

async function fetchFugleIntradayCandles(code) {
  const symbol = normalizeCode(code);
  const key = fugleApiKey();
  if (!key) return { ok: false, source: "fugle_intraday_candles", error: `missing Fugle API key: ${FUGLE_API_KEY_FILE}`, candles: [], rows: [], quality: candleQuality([]) };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FUGLE_TIMEOUT_MS);
  try {
    const url = `https://api.fugle.tw/marketdata/v1.0/stock/intraday/candles/${encodeURIComponent(symbol)}?timeframe=1&sort=asc`;
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "X-API-KEY": key,
        "Referer": "https://developer.fugle.tw/",
        "User-Agent": "FumanStrategy3TvCandles/1.0",
      },
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`fugle HTTP ${response.status} ${text.slice(0, 200)}`);
    const payload = JSON.parse(text);
    const candles = sortCandles((payload.data || [])
      .map((row) => normalizeCandle(row, symbol, "fugle_intraday_candles"))
      .filter((row) => row.close > 0));
    return { ok: candles.length > 0, source: "fugle_intraday_candles", symbol: payload.symbol || symbol, candles, rows: candles, quality: candleQuality(candles) };
  } catch (error) {
    return { ok: false, source: "fugle_intraday_candles", error: error?.message || String(error), candles: [], rows: [], quality: candleQuality([]) };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchStrategy3TvCandles(code, limit = 260) {
  const symbol = normalizeCode(code);
  let supabase = null;
  try {
    supabase = await fetchStrategy3Intraday1mLatestN(symbol, limit);
  } catch (error) {
    supabase = { ok: false, source: "supabase_strategy3_intraday_1m", error: error?.message || String(error), candles: [], rows: [] };
  }
  const supabaseCandles = sortCandles((supabase.candles || supabase.rows || [])
    .map((row) => normalizeCandle(row, symbol, "supabase_strategy3_intraday_1m"))
    .filter((row) => row.close > 0));
  const supabaseQuality = candleQuality(supabaseCandles);
  const fallbackReason = qualityReason(supabaseQuality);

  if (!needsFullOhlcFallback(supabaseQuality)) {
    return {
      ...supabase,
      ok: supabaseCandles.length > 0,
      source: "supabase_strategy3_intraday_1m",
      candles: supabaseCandles,
      rows: supabaseCandles,
      quality: supabaseQuality,
      fallbackAttempted: false,
    };
  }

  if (!ALLOW_FUGLE_1M_DIAGNOSTIC_FALLBACK) {
    return {
      ...supabase,
      ok: supabaseCandles.length > 0,
      source: "supabase_strategy3_intraday_1m",
      candles: supabaseCandles,
      rows: supabaseCandles,
      quality: supabaseQuality,
      fallbackAttempted: false,
      fallbackSkipped: true,
      fallbackReason,
      fallbackError: "strategy3 Fugle direct 1m fallback disabled; use shared canonical 1m source plus priority repair writer",
    };
  }

  const fugle = await fetchFugleIntradayCandles(symbol);
  if (fugle.ok && betterQuality(fugle.quality, supabaseQuality)) {
    return {
      ...fugle,
      fallbackFrom: "supabase_strategy3_intraday_1m",
      fallbackReason,
      supabaseQuality,
      fallbackAttempted: true,
    };
  }

  return {
    ...supabase,
    ok: supabaseCandles.length > 0,
    source: "supabase_strategy3_intraday_1m",
    candles: supabaseCandles,
    rows: supabaseCandles,
    quality: supabaseQuality,
    fallbackAttempted: true,
    fallbackReason,
    fallbackError: fugle.error || "fugle quality not better",
    fugleQuality: fugle.quality,
  };
}

module.exports = {
  candleQuality,
  fetchFugleIntradayCandles,
  fetchStrategy3TvCandles,
  needsFullOhlcFallback,
  qualityReason,
};
