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
const QUOTES_HEALTH_VIEW = process.env.STRATEGY2_SUPABASE_QUOTES_HEALTH_VIEW || "v_fugle_quotes_live_health";
const STOCK_UNIVERSE_TABLE = process.env.STRATEGY2_SUPABASE_STOCK_UNIVERSE_TABLE || "stock_universe";
const DAILY_VOLUME_AVG_VIEW = process.env.STRATEGY2_SUPABASE_DAILY_VOLUME_AVG_VIEW || "fugle_daily_volume_avg";
const STRATEGY2_REJECTION_DEBUG_TABLE = process.env.STRATEGY2_REJECTION_DEBUG_TABLE || "strategy2_rejection_debug";
const REQUIRED_READ_TARGETS = [
  ["source_status", { select: "source_name", limit: 1 }],
  [QUOTES_HEALTH_VIEW, { select: "active_symbols", limit: 1 }],
  [QUOTES_TABLE, { select: "symbol", limit: 1 }],
  [INTRADAY_1M_TABLE, { select: "symbol", limit: 1 }],
  [INTRADAY_1M_STATUS_VIEW, { select: "symbol", limit: 1 }],
  [STOCK_UNIVERSE_TABLE, { select: "symbol", limit: 1 }],
  [DAILY_VOLUME_AVG_VIEW, { select: "symbol", limit: 1 }],
];

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

function secondsBetweenNowAndTimeText(value) {
  const match = String(value || "").match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/);
  if (!match) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const dict = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const timestamp = Date.parse(`${dict.year}-${dict.month}-${dict.day}T${String(match[1]).padStart(2, "0")}:${match[2]}:${match[3] || "00"}+08:00`);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.round((Date.now() - timestamp) / 1000));
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
  const quoteAgeSeconds = secondsSince(quoteTimeRaw) ?? secondsBetweenNowAndTimeText(quoteTime);
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
    quoteAgeSeconds,
    quoteFresh: quoteAgeSeconds == null ? null : quoteAgeSeconds <= 120,
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
  const age = cleanNumber(quote.quoteAgeSeconds) || secondsSince(quote.quoteTimeRaw || quote.updatedAt);
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

async function verifyAnonReadAccess() {
  const checks = [];
  for (const [table, params] of REQUIRED_READ_TARGETS) {
    try {
      await fetchRows(table, params, { timeout: 8000 });
      checks.push({ table, ok: true });
    } catch (error) {
      checks.push({ table, ok: false, error: error?.message || String(error) });
    }
  }
  const failed = checks.filter((item) => !item.ok);
  return { ok: failed.length === 0, checks, failed };
}

async function getStrategy2SourceHealth(options = {}) {
  try {
    const healthRows = await fetchRows(QUOTES_HEALTH_VIEW, {
      select: "active_symbols,quote_count,fresh_quote_count_120s,fresh_quote_count_180s,quote_age_seconds,coverage_120s,coverage_180s",
      limit: 1,
    }).catch(() => []);
    const quoteHealth = healthRows[0] || {};
    const rows = await fetchRows("source_status", {
      select: "source_name,status,updated_at,payload,message,stale_seconds,last_success_at,last_error_at",
      source_name: `eq.${SOURCE_NAME}`,
      limit: 1,
    }).catch(() => []);
    const status = rows[0] || null;
    const payload = status?.payload && typeof status.payload === "object" ? status.payload : {};
    const payloadQuoteAge = cleanNumber(payload.quote_age_seconds) || secondsSince(payload.last_quote_at || status?.updated_at);
    const quoteHealthAge = cleanNumber(quoteHealth.quote_age_seconds);
    const quoteAge = payloadQuoteAge ?? quoteHealthAge;
    const quotes = cleanNumber(payload.quotes || payload.quote_count) || cleanNumber(quoteHealth.quote_count);
    const fresh120 = cleanNumber(quoteHealth.fresh_quote_count_120s) || quotes;
    const fresh180 = cleanNumber(quoteHealth.fresh_quote_count_180s) || fresh120;
    const activeSymbols = cleanNumber(payload.active_symbols || payload.eligible_symbols || payload.symbols) || cleanNumber(quoteHealth.active_symbols);
    const coverage120 = cleanNumber(quoteHealth.coverage_120s) || (activeSymbols ? fresh120 / activeSymbols : 0);
    const coverage180 = cleanNumber(quoteHealth.coverage_180s) || (activeSymbols ? fresh180 / activeSymbols : 0);
    const intradayRows = cleanNumber(payload.intraday_1m_rows_today || payload.intraday_1m_rows);
    const intradayAge = cleanNumber(payload.intraday_1m_stale_seconds);
    const latestCandleAge = secondsSince(payload.latest_candle_time || payload.intraday_1m_latest_candle_time);
    const maxAge = Number(options.maxQuoteAgeSeconds || 120);
    const maxIntradayAge = Number(options.maxIntraday1mAgeSeconds || Math.max(180, maxAge * 2));
    const minQuotes = Number(options.minQuotes || 500);
    const minActive = Number(options.minActiveSymbols || 500);
    const quoteOk = quoteAge != null
      && quoteAge <= maxAge
      && quotes >= minQuotes
      && activeSymbols >= minActive;
    const intradayOk = options.requireIntraday1m
      ? intradayRows > 0
        && Boolean(payload.latest_candle_time || payload.intraday_1m_latest_candle_time)
        && (intradayAge ? intradayAge <= maxIntradayAge : (latestCandleAge == null || latestCandleAge <= maxIntradayAge))
      : true;
    const anonRead = options.verifyAnonReadAccess ? await verifyAnonReadAccess() : { ok: true, checks: [], failed: [] };
    const statusText = String(status?.status || "").toLowerCase();
    const statusOk = !status
      || statusText === "ok"
      || (statusText === "degraded" && payload.degraded_but_usable_for_intraday === true);
    const ok = Boolean(status && statusOk && quoteOk && intradayOk && anonRead.ok);
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
        !intradayOk ? `intraday_1m not ready rows=${intradayRows} age=${intradayAge || latestCandleAge || "missing"}` : "",
        !anonRead.ok ? `anon read failed: ${anonRead.failed.map((item) => item.table).join(",")}` : "",
      ].filter(Boolean).join("; "),
      message: status?.message || "",
      status,
      payload,
      quoteHealth: {
        ...quoteHealth,
        quote_count: quotes,
        fresh_quote_count_120s: fresh120,
        fresh_quote_count_180s: fresh180,
        active_symbols: activeSymbols,
        coverage_120s: coverage120,
        coverage_180s: coverage180,
        quote_age_seconds: quoteAge,
      },
      anonRead,
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
    .map((quote) => ({ ...quote, name: universe.get(quote.code)?.name || quote.name, sourceHealthOk: true }));
  if (quotes.length < Number(options.minQuotes || 0) && health.ok) {
    quotes = rows
      .map(normalizeQuote)
      .filter(Boolean)
      .filter((quote) => universe.has(quote.code))
      .map((quote) => ({ ...quote, name: universe.get(quote.code)?.name || quote.name, acceptedBySourceHealth: true, sourceHealthOk: true }));
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
        if (!byCode.has(quote.code)) byCode.set(quote.code, { ...quote, acceptedBySourceHealth: true, sourceHealthOk: true });
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
        select: "symbol,market,latest_candle_time,candle_count,ready_ge_35,ready_ge_80,ready_ge_200,has_today_data,updated_at",
        limit: group.length || 5000,
      };
      if (group.length) params.symbol = inFilter(group);
      const rows = await fetchRows(INTRADAY_1M_STATUS_VIEW, params);
      rows.forEach((row) => byCode.set(normalizeCode(row.symbol), {
        ...row,
        latest_candle_age_seconds: secondsSince(row.latest_candle_time || row.updated_at),
        today_candle_count: cleanNumber(row.rows_today),
        ma35_available: row.ready_ge_35 === true && cleanNumber(row.candle_count) >= 35,
      }));
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
      const rows = await fetchRows(DAILY_VOLUME_AVG_VIEW, {
        select: "symbol,market,avg_5d_volume,avg_20d_volume,latest_trade_date,days_5,days_20,updated_at",
        symbol: inFilter(group),
        limit: group.length,
      });
      rows.forEach((row) => {
        const code = normalizeCode(row.symbol);
        byCode.set(code, {
          avgVolume: cleanNumber(days >= 20 ? row.avg_20d_volume : row.avg_5d_volume) || cleanNumber(row.avg_5d_volume) || cleanNumber(row.avg_20d_volume),
          avg5dVolume: cleanNumber(row.avg_5d_volume),
          avg20dVolume: cleanNumber(row.avg_20d_volume),
          days: cleanNumber(days >= 20 ? row.days_20 : row.days_5) || cleanNumber(row.days_5),
          latestTradeDate: row.latest_trade_date || "",
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
