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
const STRATEGY3_QUOTES_TABLE = process.env.STRATEGY3_SUPABASE_QUOTES_TABLE || "fugle_quotes_latest";
const STRATEGY3_QUOTE_READY_VIEW = process.env.STRATEGY3_SUPABASE_QUOTE_READY_VIEW || "v_strategy3_quote_ready";
const STRATEGY3_INTRADAY_1M_STATUS_VIEW = process.env.STRATEGY3_SUPABASE_1M_STATUS_VIEW || "v_strategy3_intraday_1m_status";
const STRATEGY3_INTRADAY_1M_RPC = process.env.STRATEGY3_SUPABASE_1M_RPC || "get_strategy3_intraday_1m_latest_n";
const STRATEGY3_CAPITAL_TABLE = process.env.STRATEGY3_SUPABASE_CAPITAL_TABLE || "stock_capital_latest";
const STRATEGY3_DAILY_VOLUME_TABLE = process.env.STRATEGY3_SUPABASE_DAILY_VOLUME_TABLE || "stock_daily_volume";
const REQUIRED_READ_TARGETS = [
  ["source_status", { select: "source_name", limit: 1 }],
  [QUOTES_HEALTH_VIEW, { select: "active_symbols", limit: 1 }],
  [QUOTES_TABLE, { select: "symbol", limit: 1 }],
  [INTRADAY_1M_TABLE, { select: "symbol", limit: 1 }],
  [INTRADAY_1M_STATUS_VIEW, { select: "symbol", limit: 1 }],
  [STOCK_UNIVERSE_TABLE, { select: "symbol", limit: 1 }],
  [DAILY_VOLUME_AVG_VIEW, { select: "symbol", limit: 1 }],
];
const STRATEGY3_REQUIRED_READ_TARGETS = [
  [STRATEGY3_QUOTES_TABLE, { select: "*", limit: 1 }],
  [STRATEGY3_QUOTE_READY_VIEW, { select: "*", limit: 1 }],
  [STRATEGY3_INTRADAY_1M_STATUS_VIEW, { select: "*", limit: 1 }],
  [STRATEGY3_CAPITAL_TABLE, { select: "*", limit: 1 }],
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

async function fetchRpcRows(functionName, body = {}, options = {}) {
  if (!hasCredentials()) throw new Error("missing Supabase anon credentials");
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: {
      ...headers(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout ? AbortSignal.timeout(options.timeout || 20000) : undefined,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${functionName} HTTP ${response.status} ${text.slice(0, 180)}`.trim());
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
  const code = normalizeCode(row?.symbol || row?.code);
  if (!/^\d{4}$/.test(code)) return null;
  const close = cleanNumber(row.price ?? row.close ?? row.last_price);
  const prevClose = cleanNumber(row.previous_close ?? row.prev_close ?? row.reference_price);
  if (!close || !prevClose) return null;
  const change = close - prevClose;
  const quoteTimeRaw = row.last_trade_time || row.updated_at || "";
  const quoteTime = taipeiTimeText(quoteTimeRaw);
  const quoteAgeSeconds = secondsSince(quoteTimeRaw) ?? secondsBetweenNowAndTimeText(quoteTime);
  return {
    code,
    symbol: code,
    name: row.name || row.stock_name || code,
    market: row.market || "",
    close,
    price: close,
    open: cleanNumber(row.open_price ?? row.open),
    high: cleanNumber(row.high_price ?? row.high) || close,
    low: cleanNumber(row.low_price ?? row.low) || close,
    prevClose,
    previousClose: prevClose,
    change,
    percent: cleanNumber(row.change_percent) || (prevClose ? (change / prevClose) * 100 : 0),
    tradeVolume: cleanNumber(row.total_volume ?? row.volume ?? row.trade_volume),
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
    stockType: row.stock_type || row.type || "",
    session: row.session || "",
    isHalted: row.is_halted === true,
    isTrial: row.is_trial === true,
    cumulativeBidVolume: cleanNumber(row.cumulative_bid_volume),
    cumulativeAskVolume: cleanNumber(row.cumulative_ask_volume),
    cumulativeBidAskVolume: cleanNumber(row.cumulative_bid_ask_volume),
  };
}

function normalizeStrategy3QuoteReady(row) {
  const quote = normalizeQuote(row);
  if (!quote) return null;
  const rawAvgVolume = cleanNumber(row.avg_volume_5 ?? row.avg_5d_volume ?? row.avg_volume ?? row.volume_avg_5 ?? row.five_day_avg_volume);
  const rawVolume = cleanNumber(row.total_volume ?? row.trade_volume ?? row.volume);
  const impliedShares = quote.close ? cleanNumber(row.trade_value) / quote.close : 0;
  const volumeLooksLikeLots = rawVolume > 0 && impliedShares > 0 && Math.abs(impliedShares - rawVolume * 1000) / Math.max(impliedShares, 1) < 0.08;
  const tradeVolume = volumeLooksLikeLots ? rawVolume * 1000 : quote.tradeVolume;
  const avgVolume = volumeLooksLikeLots ? rawAvgVolume * 1000 : rawAvgVolume;
  const volumeRatio = avgVolume ? tradeVolume / avgVolume : cleanNumber(row.volume_ratio ?? row.volume_ratio_5 ?? row.projected_ratio ?? row.volumeRatio);
  return {
    ...quote,
    tradeVolume,
    value: cleanNumber(row.trade_value) || quote.value,
    tradeValue: cleanNumber(row.trade_value) || quote.tradeValue,
    avgVolume,
    volumeRatio,
    projectedRatio: volumeRatio,
    issuedShares: cleanNumber(row.issued_shares),
    after1300CandleCount: cleanNumber(row.after_1300_candle_count ?? row.candles_after_1300),
    hasAfter1300Candle: row.has_after_1300_candle === true || cleanNumber(row.after_1300_candle_count) > 0,
    has1300Candle: row.has_1300_candle === true,
    intradayCandleCount: cleanNumber(row.today_candle_count ?? row.candle_count ?? row.rows_today),
    latestCandleTime: row.latest_candle_time || "",
    is_blacklisted: row.is_blacklisted,
    is_daytrade_unsuitable: row.is_daytrade_unsuitable,
    is_etf: row.is_etf,
    is_warrant: row.is_warrant,
    is_cb: row.is_cb,
    quoteReadySource: STRATEGY3_QUOTE_READY_VIEW,
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

async function verifyStrategy3ReadAccess() {
  const checks = [];
  for (const [table, params] of STRATEGY3_REQUIRED_READ_TARGETS) {
    try {
      await fetchRows(table, params, { timeout: 8000 });
      checks.push({ table, ok: true });
    } catch (error) {
      checks.push({ table, ok: false, error: error?.message || String(error) });
    }
  }
  try {
    await fetchRpcRows(STRATEGY3_INTRADAY_1M_RPC, { symbols: ["2330"], bars_per_symbol: 1 }, { timeout: 8000 });
    checks.push({ table: STRATEGY3_INTRADAY_1M_RPC, ok: true });
  } catch (error) {
    checks.push({ table: STRATEGY3_INTRADAY_1M_RPC, ok: false, error: error?.message || String(error) });
  }
  const failed = checks.filter((item) => !item.ok);
  return { ok: failed.length === 0, checks, failed };
}

async function fetchStrategy3QuoteReady(options = {}) {
  const rows = [];
  const pageSize = Number(options.pageSize || process.env.STRATEGY3_QUOTE_READY_PAGE_SIZE || 250);
  const limit = Number(options.limit || 5000);
  const select = [
    "symbol",
    "code",
    "name",
    "market",
    "price",
    "close",
    "prev_close",
    "previous_close",
    "change",
    "change_percent",
    "trade_volume",
    "total_volume",
    "trade_value",
    "high",
    "low",
    "open",
    "updated_at",
    "last_trade_time",
    "avg_volume_5",
    "avg_volume_20",
    "volume_ratio_5",
    "issued_shares",
    "today_candle_count",
    "after_1300_candle_count",
    "latest_candle_time",
    "has_1300_candle",
    "has_after_1300_candle",
    "ready_35",
    "ready_80",
    "ready_100",
    "stock_type",
    "is_halted",
    "is_trial",
    "is_blacklisted",
    "is_daytrade_unsuitable",
    "is_etf",
    "is_warrant",
    "is_cb",
    "session",
  ].join(",");
  try {
    for (let offset = 0; offset < limit; offset += pageSize) {
      const page = await fetchRows(STRATEGY3_QUOTE_READY_VIEW, {
        select,
        limit: Math.min(pageSize, limit - offset),
        offset,
      }, { timeout: options.timeout || 30000 });
      rows.push(...page);
      if (page.length < pageSize) break;
    }
  } catch (error) {
    if (options.allowLatestFallback === false) throw error;
    const fallback = await fetchStrategy3QuoteLatestReady(options);
    return {
      ...fallback,
      warning: `${STRATEGY3_QUOTE_READY_VIEW} unavailable; used ${fallback.source}: ${error?.message || String(error)}`,
    };
  }
  const quotes = rows
    .map(normalizeStrategy3QuoteReady)
    .filter(Boolean)
    .filter((quote) => !options.maxQuoteAgeSeconds || quoteIsFresh(quote, options.maxQuoteAgeSeconds));
  return {
    ok: quotes.length >= Number(options.minQuotes || 0),
    error: quotes.length >= Number(options.minQuotes || 0) ? "" : `strategy3 quotes ${quotes.length}<${Number(options.minQuotes || 0)}`,
    quotes,
    source: STRATEGY3_QUOTE_READY_VIEW,
  };
}

async function fetchStrategy3DailyVolumeAverageMap(codes = [], days = 5) {
  const byCode = new Map();
  const normalized = [...new Set((codes || []).map(normalizeCode).filter((code) => /^\d{4}$/.test(code)))];
  const groups = normalized.length ? chunk(normalized, 250) : [[]];
  const maxDays = Math.max(1, Number(days || 5));
  for (const group of groups) {
    const params = {
      select: "symbol,code,volume_shares,volume,volume_lots,date,trade_date,updated_at",
      order: "trade_date.desc",
      limit: group.length ? Math.max(group.length * maxDays * 3, group.length) : 15000,
    };
    if (group.length) params.symbol = inFilter(group);
    const rows = await fetchRows(STRATEGY3_DAILY_VOLUME_TABLE, params);
    for (const row of rows) {
      const code = normalizeCode(row.symbol || row.code);
      if (!/^\d{4}$/.test(code)) continue;
      if (group.length && !group.includes(code)) continue;
      const list = byCode.get(code) || [];
      if (list.length >= maxDays) continue;
      const volumeShares = cleanNumber(row.volume_shares) || (cleanNumber(row.volume_lots) * 1000) || cleanNumber(row.volume);
      if (volumeShares > 0) {
        list.push(volumeShares);
        byCode.set(code, list);
      }
    }
  }
  const avgByCode = new Map();
  byCode.forEach((values, code) => {
    if (values.length) avgByCode.set(code, values.reduce((sum, value) => sum + value, 0) / values.length);
  });
  return avgByCode;
}

async function fetchStrategy3QuoteLatestReady(options = {}) {
  const rows = [];
  const pageSize = Number(options.latestPageSize || process.env.STRATEGY3_QUOTES_LATEST_PAGE_SIZE || 1000);
  const limit = Number(options.limit || 5000);
  const select = [
    "symbol",
    "code",
    "name",
    "market",
    "close",
    "last_price",
    "open",
    "high",
    "low",
    "prev_close",
    "previous_close",
    "change_percent",
    "change",
    "trade_volume_lots",
    "trade_volume",
    "trade_volume_shares",
    "total_volume",
    "trade_value",
    "updated_at",
    "last_trade_time",
    "quote_time",
    "quote_age_seconds",
    "quote_source",
    "is_quote_fresh",
    "stock_type",
    "session",
    "is_halted",
    "is_trial",
  ].join(",");
  for (let offset = 0; offset < limit; offset += pageSize) {
    const page = await fetchRows(STRATEGY3_QUOTES_TABLE, {
      select,
      limit: Math.min(pageSize, limit - offset),
      offset,
    }, { timeout: options.latestTimeout || options.timeout || 20000 });
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  const quotes = rows
    .map((row) => normalizeStrategy3QuoteReady({
      ...row,
      price: row.last_price ?? row.close,
      total_volume: row.trade_volume_shares ?? row.total_volume ?? row.trade_volume,
    }))
    .filter(Boolean)
    .filter((quote) => !options.maxQuoteAgeSeconds || quoteIsFresh(quote, options.maxQuoteAgeSeconds));
  const status = await fetchStrategy3Intraday1mStatus(quotes.map((quote) => quote.code));
  const avgVolumeMap = await fetchStrategy3DailyVolumeAverageMap(quotes.map((quote) => quote.code), 5).catch(() => new Map());
  const merged = quotes.map((quote) => {
    const statusRow = status.byCode.get(quote.code) || {};
    const avgVolume = avgVolumeMap.get(quote.code) || quote.avgVolume || 0;
    const volumeRatio = avgVolume ? quote.tradeVolume / avgVolume : quote.volumeRatio;
    return {
      ...quote,
      avgVolume,
      volumeRatio,
      projectedRatio: volumeRatio,
      after1300CandleCount: cleanNumber(statusRow.after_1300_candle_count ?? statusRow.candles_after_1300),
      hasAfter1300Candle: statusRow.has_after_1300_candle === true || cleanNumber(statusRow.after_1300_candle_count) > 0,
      has1300Candle: statusRow.has_1300_candle === true,
      intradayCandleCount: cleanNumber(statusRow.today_candle_count ?? statusRow.rows_today),
      latestCandleTime: statusRow.latest_candle_time || quote.latestCandleTime,
      quoteReadySource: `${STRATEGY3_QUOTES_TABLE}+${STRATEGY3_INTRADAY_1M_STATUS_VIEW}+${STRATEGY3_DAILY_VOLUME_TABLE}`,
    };
  });
  return {
    ok: merged.length >= Number(options.minQuotes || 0),
    error: merged.length >= Number(options.minQuotes || 0) ? "" : `strategy3 latest quotes ${merged.length}<${Number(options.minQuotes || 0)}`,
    quotes: merged,
    source: `${STRATEGY3_QUOTES_TABLE}+${STRATEGY3_INTRADAY_1M_STATUS_VIEW}+${STRATEGY3_DAILY_VOLUME_TABLE}`,
  };
}

async function fetchStrategy3CapitalMap(codes = []) {
  const byCode = new Map();
  const normalized = [...new Set((codes || []).map(normalizeCode).filter((code) => /^\d{4}$/.test(code)))];
  const groups = normalized.length ? chunk(normalized, 300) : [[]];
  for (const group of groups) {
    const params = { select: "*", limit: group.length || 5000 };
    if (group.length) params.symbol = inFilter(group);
    let rows = [];
    try {
      rows = await fetchRows(STRATEGY3_CAPITAL_TABLE, params);
    } catch (error) {
      if (!group.length) throw error;
      const codeParams = { select: "*", limit: group.length, code: inFilter(group) };
      rows = await fetchRows(STRATEGY3_CAPITAL_TABLE, codeParams);
    }
    rows.forEach((row) => {
      const code = normalizeCode(row.symbol || row.code);
      const shares = cleanNumber(row.issued_shares ?? row.capital_shares ?? row.common_shares ?? row.shares);
      if (/^\d{4}$/.test(code) && shares > 0) byCode.set(code, shares);
    });
  }
  return { ok: true, byCode, source: STRATEGY3_CAPITAL_TABLE };
}

async function fetchStrategy3Intraday1mStatus(codes = []) {
  const byCode = new Map();
  const normalized = [...new Set((codes || []).map(normalizeCode).filter((code) => /^\d{4}$/.test(code)))];
  const groups = normalized.length ? chunk(normalized, 300) : [[]];
  for (const group of groups) {
    const params = { select: "*", limit: group.length || 5000 };
    if (group.length) params.symbol = inFilter(group);
    const rows = await fetchRows(STRATEGY3_INTRADAY_1M_STATUS_VIEW, params);
    rows.forEach((row) => {
      const code = normalizeCode(row.symbol || row.code);
      byCode.set(code, {
        ...row,
        symbol: code,
        latest_candle_age_seconds: secondsSince(row.latest_candle_time || row.updated_at),
        today_candle_count: cleanNumber(row.today_candle_count ?? row.candle_count ?? row.rows_today),
        after_1300_candle_count: cleanNumber(row.after_1300_candle_count ?? row.candles_after_1300),
        ready_ge_100: row.ready_ge_100 === true || cleanNumber(row.candle_count) >= 100,
      });
    });
  }
  return { ok: true, byCode, source: STRATEGY3_INTRADAY_1M_STATUS_VIEW };
}

async function fetchStrategy3Intraday1mLatestN(code, limit = 160) {
  const symbol = normalizeCode(code);
  if (!/^\d{4}$/.test(symbol)) return { ok: false, error: "invalid symbol", rows: [], candles: [] };
  let rows = [];
  const payloads = [
    { symbols: [symbol], bars_per_symbol: Number(limit || 160) },
    { p_symbol: symbol, p_limit: Number(limit || 160) },
    { symbol, limit_n: Number(limit || 160) },
    { in_symbol: symbol, in_limit: Number(limit || 160) },
  ];
  let lastError = null;
  for (const payload of payloads) {
    try {
      rows = await fetchRpcRows(STRATEGY3_INTRADAY_1M_RPC, payload);
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  const candles = rows.map((row) => ({
    symbol: normalizeCode(row.symbol || row.code),
    candleTime: row.candle_time || row.time,
    time: row.candle_time || row.time,
    open: cleanNumber(row.open),
    high: cleanNumber(row.high),
    low: cleanNumber(row.low),
    close: cleanNumber(row.close),
    volume: cleanNumber(row.volume),
    updatedAt: row.updated_at,
    tradeDate: row.trade_date,
  })).filter((row) => row.close > 0);
  candles.sort((a, b) => Date.parse(a.candleTime || a.time || "") - Date.parse(b.candleTime || b.time || ""));
  return { ok: candles.length >= 35, error: candles.length >= 35 ? "" : `candle_count=${candles.length}<35`, rows: candles, candles, source: STRATEGY3_INTRADAY_1M_RPC };
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


function normalizeFutoptQuote(row) {
  const symbol = String(row?.future_symbol || row?.symbol || "").trim().toUpperCase();
  if (!symbol) return null;
  const lastPrice = cleanNumber(row?.last_price ?? row?.price);
  const previousClose = cleanNumber(row?.previous_close ?? row?.reference_price);
  const changePercent = cleanNumber(row?.change_percent) || (previousClose ? ((lastPrice - previousClose) / previousClose) * 100 : 0);
  return {
    future_symbol: symbol,
    symbol,
    updated_at: row?.updated_at || "",
    last_price: lastPrice,
    open_price: cleanNumber(row?.open_price),
    high_price: cleanNumber(row?.high_price),
    low_price: cleanNumber(row?.low_price),
    previous_close: previousClose,
    change_percent: changePercent,
    total_volume: cleanNumber(row?.total_volume ?? row?.volume),
    product: row?.product || "",
    session: row?.session || "",
    payload: row?.payload || {},
  };
}

async function fetchFutoptTickerMap(options = {}) {
  const byUnderlying = new Map();
  const rows = await fetchRows("futopt_tickers", {
    select: "future_symbol,name,product,contract_type,end_date,exchange,underlying_name,underlying_symbol,session,updated_at,payload",
    order: "underlying_symbol.asc,end_date.asc",
    limit: options.limit || 5000,
  }, { timeout: options.timeout || 20000 });
  rows.forEach((row) => {
    const underlying = normalizeCode(row?.underlying_symbol || row?.payload?.underlyingSymbol || row?.payload?.underlying_symbol);
    const futureSymbol = String(row?.future_symbol || "").trim().toUpperCase();
    if (!/^\d{4}$/.test(underlying) || !futureSymbol) return;
    const list = byUnderlying.get(underlying) || [];
    list.push({
      future_symbol: futureSymbol,
      name: row?.name || "",
      product: row?.product || "",
      contract_type: row?.contract_type || "",
      end_date: row?.end_date || "",
      exchange: row?.exchange || "",
      underlying_name: row?.underlying_name || "",
      underlying_symbol: underlying,
      session: row?.session || "",
      updated_at: row?.updated_at || "",
      payload: row?.payload || {},
    });
    byUnderlying.set(underlying, list);
  });
  return { ok: true, rows, byUnderlying, count: rows.length };
}

async function fetchFutoptQuotesLive(symbols = [], options = {}) {
  const bySymbol = new Map();
  const normalized = [...new Set((symbols || []).map((item) => String(item || "").trim().toUpperCase()).filter(Boolean))];
  const groups = normalized.length ? chunk(normalized, 250) : [[]];
  for (const group of groups) {
    const params = {
      select: "future_symbol,updated_at,last_price,open_price,high_price,low_price,previous_close,change_percent,total_volume,product,session,payload",
      order: "updated_at.desc",
      limit: group.length || options.limit || 5000,
    };
    if (group.length) params.future_symbol = `in.(${group.join(",")})`;
    const rows = await fetchRows("futopt_quotes_live", params, { timeout: options.timeout || 20000 });
    rows.map(normalizeFutoptQuote).filter(Boolean).forEach((quote) => bySymbol.set(quote.future_symbol, quote));
  }
  const txf = [...bySymbol.values()].find((quote) => quote.future_symbol === "TXF" || String(quote.product || "").toUpperCase() === "TXF") || null;
  return { ok: true, bySymbol, txf, count: bySymbol.size };
}

async function fetchPreopenSnapshots(codes = [], options = {}) {
  const normalized = [...new Set((codes || []).map(normalizeCode).filter((code) => /^\d{4}$/.test(code)))];
  const rowsOut = [];
  const groups = normalized.length ? chunk(normalized, 250) : [[]];
  for (const group of groups) {
    const params = {
      select: "symbol,name,market,updated_at,reference_price,trial_price,is_trial,is_limit_up_bid,best_bid_price,best_ask_price,bid_volume,ask_volume,bid1_price,bid1_volume,bid2_price,bid2_volume,bid3_price,bid3_volume,bid4_price,bid4_volume,bid5_price,bid5_volume,ask1_price,ask1_volume,ask2_price,ask2_volume,ask3_price,ask3_volume,ask4_price,ask4_volume,ask5_price,ask5_volume,bid_levels_json,ask_levels_json,payload",
      order: "updated_at.desc",
      limit: group.length || options.limit || 5000,
    };
    if (group.length) params.symbol = inFilter(group);
    rowsOut.push(...await fetchRows("fugle_preopen_snapshot", params, { timeout: options.timeout || 20000 }));
  }
  return { ok: true, rows: rowsOut, count: rowsOut.length };
}

async function fetchPreopenSnapshotHistory(codes = [], options = {}) {
  const byCode = new Map();
  const normalized = [...new Set((codes || []).map(normalizeCode).filter((code) => /^\d{4}$/.test(code)))];
  const table = options.table || "v_fugle_preopen_snapshot_history";
  const select = "symbol,observed_at,updated_at,name,market,session,trade_date,reference_price,trial_price,is_trial,is_limit_up_bid,best_bid_price,best_ask_price,bid_volume,ask_volume,bid1_price,bid1_volume,bid2_price,bid2_volume,bid3_price,bid3_volume,bid4_price,bid4_volume,bid5_price,bid5_volume,ask1_price,ask1_volume,ask2_price,ask2_volume,ask3_price,ask3_volume,ask4_price,ask4_volume,ask5_price,ask5_volume,bid_levels_json,ask_levels_json,payload";
  try {
    for (const group of chunk(normalized, 120)) {
      const params = {
        select,
        symbol: inFilter(group),
        order: "observed_at.desc",
        limit: options.limit || Math.max(300, group.length * 10),
      };
      if (options.sinceIso) params.observed_at = `gte.${options.sinceIso}`;
      const rows = await fetchRows(table, params, { timeout: options.timeout || 20000 });
      rows.forEach((row) => {
        const code = normalizeCode(row?.symbol);
        if (!/^\d{4}$/.test(code)) return;
        const list = byCode.get(code) || [];
        list.push(row);
        byCode.set(code, list);
      });
    }
    return { ok: true, rows: [...byCode.values()].flat(), byCode };
  } catch (error) {
    if (table !== "fugle_preopen_snapshot_history") {
      return fetchPreopenSnapshotHistory(codes, { ...options, table: "fugle_preopen_snapshot_history" });
    }
    throw error;
  }
}

async function fetchFutoptStockMappingReady(options = {}) {
  const rows = await fetchRows("v_futopt_stock_mapping_ready", {
    select: "stock_symbol,stock_name,future_symbol,fut_change_percent,txf_change_percent,rel_to_txf,total_volume,quote_updated_at,quote_age_seconds,has_mapping,has_quote,quote_fresh_180s,futopt_ready",
    order: "rel_to_txf.desc,total_volume.desc",
    limit: options.limit || 5000,
  }, { timeout: options.timeout || 20000 });
  return { ok: true, rows, count: rows.length };
}

async function fetchPreopenFinalBlindBuyReady(codes = [], options = {}) {
  const rowsOut = [];
  const normalized = [...new Set((codes || []).map(normalizeCode).filter((code) => /^\d{4}$/.test(code)))];
  const groups = normalized.length ? chunk(normalized, 250) : [[]];
  for (const group of groups) {
    const params = {
      select: "symbol,name,market,reference_price,trial_price,is_trial,is_limit_up_bid,best_bid_price,bid_volume,ask_volume,snapshots_last_1m,has_3_snapshots_last_1m,final_blind_buy_history_ready,latest_observed_at",
      order: "snapshots_last_1m.desc,latest_observed_at.desc",
      limit: group.length || options.limit || 5000,
    };
    if (group.length) params.symbol = inFilter(group);
    rowsOut.push(...await fetchRows("v_fugle_preopen_final_blind_buy_ready", params, { timeout: options.timeout || 20000 }));
  }
  return { ok: true, rows: rowsOut, count: rowsOut.length };
}

async function fetchSourceStatus(sourceName = SOURCE_NAME, options = {}) {
  const rows = await fetchRows("source_status", {
    select: "source_name,updated_at,message,payload",
    source_name: `eq.${sourceName}`,
    order: "updated_at.desc",
    limit: 1,
  }, { timeout: options.timeout || 12000 });
  return { ok: true, rows, latest: rows[0] || null };
}
module.exports = {
  fetchSourceStatus,
fetchPreopenFinalBlindBuyReady,
fetchFutoptStockMappingReady,
fetchPreopenSnapshotHistory,
fetchPreopenSnapshots,
fetchFutoptQuotesLive,
fetchFutoptTickerMap,
fetchActiveCommonStockQuotes,
  fetchDailyVolumeAverages,
  fetchIntraday1m,
  fetchIntraday1mStatus,
  fetchQuotesByCodes,
  fetchStrategy3CapitalMap,
  fetchStrategy3Intraday1mLatestN,
  fetchStrategy3Intraday1mStatus,
  fetchStrategy3QuoteReady,
  getStrategy2SourceHealth,
  verifyStrategy3ReadAccess,
};




