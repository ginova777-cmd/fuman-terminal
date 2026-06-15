"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = String(
  process.env.SUPABASE_URL
  || process.env.FUMAN_SUPABASE_URL
  || "https://cpmpfhbzutkiecccekfr.supabase.co"
).replace(/\/+$/, "");

function readSecretText(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
  || process.env.FUMAN_SUPABASE_ANON_KEY
  || readSecretText(path.join(RUNTIME_DIR, "secrets", "supabase-anon-key.txt"))
  || readSecretText(path.join(ROOT, "secrets", "supabase-anon-key.txt"));

const SOURCE_NAME = process.env.STRATEGY2_SUPABASE_SOURCE_NAME || "fugle_shared_source";
const QUOTES_TABLE = process.env.STRATEGY2_SUPABASE_QUOTES_TABLE || "fugle_quotes_live";
const INTRADAY_1M_TABLE = process.env.STRATEGY2_SUPABASE_1M_TABLE || "fugle_intraday_1m";
const INTRADAY_1M_STATUS_VIEW = process.env.STRATEGY2_SUPABASE_1M_STATUS_VIEW || "v_fugle_intraday_1m_status";
const STOCK_UNIVERSE_TABLE = process.env.STRATEGY2_SUPABASE_STOCK_UNIVERSE_TABLE || "stock_universe";
const DAILY_VOLUME_TABLE = process.env.STRATEGY2_SUPABASE_DAILY_VOLUME_TABLE || "fugle_daily_volume";

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function normalizeCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 4);
}

function taipeiTodayKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function secondsSince(value) {
  const ms = Date.parse(String(value || ""));
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.round((Date.now() - ms) / 1000));
}

function taipeiTimeText(value) {
  const parsed = Date.parse(String(value || ""));
  if (Number.isFinite(parsed)) {
    return new Date(parsed).toLocaleTimeString("en-GB", {
      timeZone: "Asia/Taipei",
      hour12: false,
    });
  }
  const match = String(value || "").match(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/);
  if (!match) return "";
  return match[1].length === 5 ? `${match[1]}:00` : match[1];
}

function hasCredentials() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

function headers() {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    Accept: "application/json",
  };
}

function buildUrl(table, params = {}) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  });
  return url.toString();
}

async function fetchRows(table, params = {}, options = {}) {
  if (!hasCredentials()) throw new Error("missing Supabase anon credentials");
  const response = await fetch(buildUrl(table, params), {
    headers: headers(),
    signal: AbortSignal.timeout ? AbortSignal.timeout(options.timeout || 20000) : undefined,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${table} HTTP ${response.status} ${text.slice(0, 180)}`.trim());
  }
  const rows = await response.json();
  return Array.isArray(rows) ? rows : [];
}

function inFilter(codes) {
  const normalized = [...new Set((codes || []).map(normalizeCode).filter((code) => /^\d{4}$/.test(code)))];
  return normalized.length ? `in.(${normalized.join(",")})` : "";
}

function chunk(items, size = 250) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function normalizeQuote(row) {
  const code = normalizeCode(row?.symbol);
  if (!/^\d{4}$/.test(code)) return null;
  const close = cleanNumber(row.price);
  const prevClose = cleanNumber(row.previous_close);
  if (!close || !prevClose) return null;
  const change = close - prevClose;
  const quoteTimeRaw = row.last_trade_time || row.updated_at || "";
  const quoteTime = taipeiTimeText(quoteTimeRaw);
  return {
    code,
    symbol: code,
    name: row.name || code,
    market: row.market || "",
    close,
    price: close,
    open: cleanNumber(row.open_price),
    high: cleanNumber(row.high_price) || close,
    low: cleanNumber(row.low_price) || close,
    prevClose,
    previousClose: prevClose,
    change,
    percent: cleanNumber(row.change_percent) || (prevClose ? (change / prevClose) * 100 : 0),
    tradeVolume: cleanNumber(row.total_volume),
    value: cleanNumber(row.trade_value),
    tradeValue: cleanNumber(row.trade_value),
    quoteTime,
    time: quoteTime,
    quoteTimeRaw,
    updatedAt: row.updated_at || "",
    quoteSeenAt: new Date().toISOString(),
    quoteSource: "supabase-fugle-live",
    realtimeFallback: "supabase-fugle-live",
    stockType: row.stock_type || "",
    session: row.session || "",
    isHalted: row.is_halted === true,
    isTrial: row.is_trial === true,
    cumulativeBidVolume: cleanNumber(row.cumulative_bid_volume),
    cumulativeAskVolume: cleanNumber(row.cumulative_ask_volume),
    cumulativeBidAskVolume: cleanNumber(row.cumulative_bid_ask_volume),
  };
}

function quoteIsFresh(quote, maxQuoteAgeSeconds) {
  const maxAge = Number(maxQuoteAgeSeconds || 0);
  if (!maxAge) return true;
  const age = secondsSince(quote.quoteTime || quote.updatedAt);
  if (age == null) return true;
  return age <= maxAge;
}

function isEligibleUniverseRow(row) {
  const code = normalizeCode(row?.symbol);
  if (!/^\d{4}$/.test(code) || code.startsWith("00")) return false;
  const text = [row?.name, row?.industry, row?.market, row?.payload?.category, row?.payload?.type].map((item) => String(item || "")).join(" ");
  if (row?.is_active === false) return false;
  if (row?.is_etf === true || row?.is_warrant === true || row?.is_cb === true || row?.is_blacklisted === true) return false;
  if (row?.is_daytrade_unsuitable === true) return false;
  if (/ETF|ETN|權證|可轉債|水泥|軍工|國防|航太/i.test(text)) return false;
  return true;
}

async function fetchUniverseMap() {
  const rows = await fetchRows(STOCK_UNIVERSE_TABLE, {
    select: "symbol,name,market,industry,is_etf,is_warrant,is_cb,is_blacklisted,is_daytrade_unsuitable,is_active,payload",
    limit: 5000,
  });
  return new Map(rows.filter(isEligibleUniverseRow).map((row) => [normalizeCode(row.symbol), row]));
}

async function getStrategy2SourceHealth(options = {}) {
  try {
    const rows = await fetchRows("source_status", {
      select: "source_name,status,updated_at,payload,message,stale_seconds,last_success_at,last_error_at",
      source_name: `eq.${SOURCE_NAME}`,
      limit: 1,
    });
    const status = rows[0] || null;
    const payload = status?.payload && typeof status.payload === "object" ? status.payload : {};
    const quoteAge = cleanNumber(payload.quote_age_seconds) || secondsSince(payload.last_quote_at || status?.updated_at);
    const quotes = cleanNumber(payload.quotes || payload.quote_count);
    const activeSymbols = cleanNumber(payload.active_symbols || payload.eligible_symbols || payload.symbols);
    const intradayRows = cleanNumber(payload.intraday_1m_rows_today || payload.intraday_1m_rows);
    const maxAge = Number(options.maxQuoteAgeSeconds || 120);
    const minQuotes = Number(options.minQuotes || 500);
    const minActive = Number(options.minActiveSymbols || 500);
    const quoteOk = quoteAge != null && quoteAge <= maxAge && quotes >= minQuotes && activeSymbols >= minActive;
    const intradayOk = options.requireIntraday1m ? intradayRows > 0 || Boolean(payload.latest_candle_time || payload.intraday_1m_latest_candle_time) : true;
    const statusOk = String(status?.status || "").toLowerCase() === "ok";
    const ok = Boolean(status && statusOk && quoteOk && intradayOk);
    return {
      ok,
      healthy: ok,
      sourceHealthy: ok,
      sourceAgeSeconds: quoteAge,
      reason: ok ? "" : [
        status ? "" : "source_status missing",
        status && !statusOk ? `status=${status.status}` : "",
        quoteAge == null || quoteAge > maxAge ? `quote_age_seconds=${quoteAge ?? "missing"}>${maxAge}` : "",
        quotes < minQuotes ? `quotes=${quotes}<${minQuotes}` : "",
        activeSymbols < minActive ? `active_symbols=${activeSymbols}<${minActive}` : "",
        !intradayOk ? "intraday_1m not ready" : "",
      ].filter(Boolean).join("; "),
      message: status?.message || "",
      status,
      payload,
    };
  } catch (error) {
    return {
      ok: false,
      healthy: false,
      sourceHealthy: false,
      sourceAgeSeconds: null,
      reason: error?.message || String(error),
      message: error?.message || String(error),
      status: null,
      payload: {},
    };
  }
}

async function fetchActiveCommonStockQuotes(options = {}) {
  const health = await getStrategy2SourceHealth(options);
  if (!health.ok) {
    return { ok: false, error: health.reason || health.message || "source_status unhealthy", quotes: [], sourceHealthy: false, sourceAgeSeconds: health.sourceAgeSeconds };
  }
  const universe = await fetchUniverseMap();
  const rows = await fetchRows(QUOTES_TABLE, {
    select: "symbol,name,market,updated_at,price,open_price,high_price,low_price,previous_close,change_percent,total_volume,trade_value,last_trade_time,session,is_halted,is_trial,stock_type,cumulative_bid_volume,cumulative_ask_volume,cumulative_bid_ask_volume",
    limit: 5000,
  });
  let quotes = rows
    .map(normalizeQuote)
    .filter(Boolean)
    .filter((quote) => universe.has(quote.code))
    .filter((quote) => quoteIsFresh(quote, options.maxQuoteAgeSeconds))
    .map((quote) => ({ ...quote, name: universe.get(quote.code)?.name || quote.name }));
  if (quotes.length < Number(options.minQuotes || 0) && health.ok) {
    quotes = rows
      .map(normalizeQuote)
      .filter(Boolean)
      .filter((quote) => universe.has(quote.code))
      .map((quote) => ({ ...quote, name: universe.get(quote.code)?.name || quote.name, acceptedBySourceHealth: true }));
  }
  return {
    ok: quotes.length >= Number(options.minQuotes || 0),
    error: quotes.length >= Number(options.minQuotes || 0) ? "" : `quotes ${quotes.length}<${Number(options.minQuotes || 0)}`,
    quotes,
    sourceHealthy: true,
    sourceAgeSeconds: health.sourceAgeSeconds,
    health,
  };
}

async function fetchQuotesByCodes(codes, options = {}) {
  const byCode = new Map();
  const normalized = [...new Set((codes || []).map(normalizeCode).filter((code) => /^\d{4}$/.test(code)))];
  const health = await getStrategy2SourceHealth(options);
  if (!health.ok) return { ok: false, error: health.reason || "source_status unhealthy", byCode, sourceHealthy: false, sourceAgeSeconds: health.sourceAgeSeconds };
  for (const group of chunk(normalized, 250)) {
    const rows = await fetchRows(QUOTES_TABLE, {
      select: "symbol,name,market,updated_at,price,open_price,high_price,low_price,previous_close,change_percent,total_volume,trade_value,last_trade_time,session,is_halted,is_trial,stock_type,cumulative_bid_volume,cumulative_ask_volume,cumulative_bid_ask_volume",
      symbol: inFilter(group),
      limit: group.length,
    });
    const mapped = rows.map(normalizeQuote).filter(Boolean);
    mapped.filter((quote) => quoteIsFresh(quote, options.maxQuoteAgeSeconds)).forEach((quote) => byCode.set(quote.code, quote));
    if (health.ok && mapped.length && mapped.filter((quote) => byCode.has(quote.code)).length < Math.min(group.length, mapped.length)) {
      mapped.forEach((quote) => {
        if (!byCode.has(quote.code)) byCode.set(quote.code, { ...quote, acceptedBySourceHealth: true });
      });
    }
  }
  return { ok: true, byCode, sourceHealthy: true, sourceAgeSeconds: health.sourceAgeSeconds };
}

async function fetchIntraday1m(code, limit = 240, options = {}) {
  const symbol = normalizeCode(code);
  if (!/^\d{4}$/.test(symbol)) return { ok: false, error: "invalid symbol", rows: [], candles: [], sourceHealthy: false, sourceAgeSeconds: null };
  const health = await getStrategy2SourceHealth({ maxQuoteAgeSeconds: options.maxSourceAgeSeconds || options.maxQuoteAgeSeconds || 120 });
  if (!health.ok) return { ok: false, error: health.reason || "source_status unhealthy", rows: [], candles: [], sourceHealthy: false, sourceAgeSeconds: health.sourceAgeSeconds };
  const rows = await fetchRows(INTRADAY_1M_TABLE, {
    select: "symbol,market,candle_time,open,high,low,close,volume,updated_at,trade_date",
    symbol: `eq.${symbol}`,
    order: "candle_time.desc",
    limit: Math.max(35, Number(limit || 240)),
  });
  const candles = rows.reverse().map((row) => ({
    symbol: normalizeCode(row.symbol),
    candleTime: row.candle_time,
    time: row.candle_time,
    open: cleanNumber(row.open),
    high: cleanNumber(row.high),
    low: cleanNumber(row.low),
    close: cleanNumber(row.close),
    volume: cleanNumber(row.volume),
    updatedAt: row.updated_at,
    tradeDate: row.trade_date,
  })).filter((row) => row.close > 0);
  return { ok: candles.length >= 35, error: candles.length >= 35 ? "" : `candle_count=${candles.length}<35`, rows: candles, candles, sourceHealthy: true, sourceAgeSeconds: health.sourceAgeSeconds };
}

async function fetchIntraday1mStatus(codes = []) {
  const byCode = new Map();
  const normalized = [...new Set((codes || []).map(normalizeCode).filter((code) => /^\d{4}$/.test(code)))];
  try {
    const groups = normalized.length ? chunk(normalized, 300) : [[]];
    for (const group of groups) {
      const params = {
        select: "symbol,market,latest_candle_time,candle_count,rows_today,ready_ge_35,ready_ge_80,ready_ge_200,has_today_data,updated_at",
        limit: group.length || 5000,
      };
      if (group.length) params.symbol = inFilter(group);
      const rows = await fetchRows(INTRADAY_1M_STATUS_VIEW, params);
      rows.forEach((row) => byCode.set(normalizeCode(row.symbol), row));
    }
    return { ok: true, byCode };
  } catch (error) {
    return { ok: false, error: error?.message || String(error), byCode };
  }
}

async function fetchDailyVolumeAverages(codes = [], days = 5) {
  const byCode = new Map();
  const normalized = [...new Set((codes || []).map(normalizeCode).filter((code) => /^\d{4}$/.test(code)))];
  try {
    for (const group of chunk(normalized, 250)) {
      const rows = await fetchRows(DAILY_VOLUME_TABLE, {
        select: "symbol,market,trade_date,volume,updated_at",
        symbol: inFilter(group),
        order: "trade_date.desc",
        limit: Math.max(group.length * Math.max(Number(days || 5), 5), group.length),
      });
      const grouped = new Map();
      rows.forEach((row) => {
        const code = normalizeCode(row.symbol);
        if (!grouped.has(code)) grouped.set(code, []);
        grouped.get(code).push(row);
      });
      grouped.forEach((items, code) => {
        const latest = items
          .sort((a, b) => String(b.trade_date || "").localeCompare(String(a.trade_date || "")))
          .slice(0, Number(days || 5));
        const volumes = latest.map((row) => cleanNumber(row.volume)).filter((value) => value > 0);
        byCode.set(code, {
          avgVolume: volumes.length ? volumes.reduce((sum, value) => sum + value, 0) / volumes.length : 0,
          days: volumes.length,
          latestTradeDate: latest[0]?.trade_date || "",
        });
      });
    }
    return { ok: true, byCode };
  } catch (error) {
    return { ok: false, error: error?.message || String(error), byCode };
  }
}

module.exports = {
  fetchActiveCommonStockQuotes,
  fetchDailyVolumeAverages,
  fetchIntraday1m,
  fetchIntraday1mStatus,
  fetchQuotesByCodes,
  getStrategy2SourceHealth,
};
