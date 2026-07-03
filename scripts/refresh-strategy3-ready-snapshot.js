"use strict";

const fs = require("fs");
const path = require("path");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = String(
  process.env.SUPABASE_URL
  || process.env.FUMAN_SUPABASE_URL
  || readSecret("supabase-url.txt")
  || "https://cpmpfhbzutkiecccekfr.supabase.co"
).replace(/\/+$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.FUMAN_SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_ANON_KEY
  || process.env.FUMAN_SUPABASE_ANON_KEY
  || readSecret("supabase-service-role-key.txt")
  || readSecret("supabase-anon-key.txt");

const PAGE_SIZE = Math.max(10, Math.min(Number(process.env.STRATEGY3_READY_SNAPSHOT_PAGE_SIZE || 50), 1000));
const MIN_INTRADAY_1M_CANDIDATES = Math.max(1, Number(process.env.STRATEGY3_MIN_INTRADAY_1M_CANDIDATES || 1000));
const MIN_INTRADAY_1M_CANDLES = Math.max(1, Number(process.env.STRATEGY3_MIN_INTRADAY_1M_CANDLES || 35));
const SESSION_LATEST_MINUTE = Number(process.env.STRATEGY3_SESSION_LATEST_MINUTE || (12 * 60 + 50));

function readSecret(file) {
  try { return fs.readFileSync(path.join(RUNTIME_DIR, "secrets", file), "utf8").trim(); } catch { return ""; }
}

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function taipeiTradeDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function normalizeCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 4);
}

function headers(extra = {}) {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("missing Supabase credentials");
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    ...extra,
  };
}

function query(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  });
  return search.toString();
}

async function request(method, route, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${route}`, {
    method,
    headers: headers(options.headers),
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout ? AbortSignal.timeout(options.timeout || 45000) : undefined,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${route} HTTP ${response.status} ${text.slice(0, 500)}`.trim());
  }
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

async function fetchRows(table, params = {}, options = {}) {
  return request("GET", `/rest/v1/${table}?${query(params)}`, { timeout: options.timeout || 45000 });
}

async function fetchAllRows(table, params = {}, options = {}) {
  const maxRows = Math.max(PAGE_SIZE, Number(options.maxRows || 8000));
  const out = [];
  for (let offset = 0; offset < maxRows; offset += PAGE_SIZE) {
    const rows = await fetchRows(table, { ...params, limit: PAGE_SIZE, offset }, options);
    out.push(...(Array.isArray(rows) ? rows : []));
    if (!Array.isArray(rows) || rows.length < PAGE_SIZE) break;
  }
  return out;
}

async function rpc(functionName, body = {}) {
  return request("POST", `/rest/v1/rpc/${functionName}`, { body, timeout: 90000 });
}

function latestTime(...values) {
  return values
    .map((value) => String(value || ""))
    .filter(Boolean)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] || null;
}

function candleMinutes(value) {
  const text = String(value || "");
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

function sessionReady(status = {}) {
  const count = cleanNumber(status.today_candle_count ?? status.candle_count ?? status.rows_today);
  if (count >= MIN_INTRADAY_1M_CANDLES) return true;
  const minute = candleMinutes(status.latest_candle_time || status.updated_at);
  return count > 0 && minute != null && minute >= SESSION_LATEST_MINUTE;
}

function isEligibleQuote(row) {
  const code = normalizeCode(row.symbol || row.code);
  if (!/^\d{4}$/.test(code) || code.startsWith("00")) return false;
  if (row.is_halted === true || row.is_trial === true) return false;
  const stockType = String(row.stock_type || "").toUpperCase();
  if (stockType && stockType !== "COMMONSTOCK") return false;
  return cleanNumber(row.close || row.last_price) > 0;
}

async function mapLimit(items, limit, mapper) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return out;
}

async function patchExistingRows(rows) {
  let updated = 0;
  await mapLimit(rows, Number(process.env.STRATEGY3_READY_SNAPSHOT_PATCH_CONCURRENCY || 16), async (row) => {
    const route = `/rest/v1/strategy3_ready_snapshot?${query({
      requested_trade_date: `eq.${row.requested_trade_date}`,
      symbol: `eq.${row.symbol}`,
    })}`;
    await request("PATCH", route, {
      body: row,
      headers: { Prefer: "return=minimal" },
      timeout: 45000,
    });
    updated += 1;
  });
  return updated;
}

async function main() {
  const tradeDate = argValue("--trade-date", process.env.STRATEGY3_TRADE_DATE || taipeiTradeDate());
  const refreshedAt = new Date().toISOString();

  const statusRefresh = await rpc("refresh_strategy3_intraday_1m_status_latest", { p_trade_date: tradeDate });
  const [quotes, statuses, capitals] = await Promise.all([
    fetchAllRows("fugle_quotes_latest", {
      select: [
        "symbol",
        "code",
        "name",
        "market",
        "close",
        "last_price",
        "trade_volume",
        "trade_volume_shares",
        "total_volume",
        "trade_value",
        "updated_at",
        "quote_time",
        "last_trade_time",
        "stock_type",
        "is_halted",
        "is_trial",
      ].join(","),
      order: "updated_at.desc",
    }, { maxRows: 6000 }),
    fetchAllRows("v_strategy3_intraday_1m_status", {
      select: "symbol,code,latest_candle_time,today_candle_count,updated_at",
    }, { maxRows: 6000 }),
    fetchAllRows("stock_capital_latest", {
      select: "code,issued_shares,updated_at",
      order: "updated_at.desc",
    }, { maxRows: 6000 }),
  ]);

  const statusByCode = new Map(statuses.map((row) => [normalizeCode(row.symbol || row.code), row]));
  const capitalByCode = new Map(capitals.map((row) => [normalizeCode(row.code), row]));
  const eligibleQuotes = quotes.filter(isEligibleQuote);
  const sessionReadyCount = eligibleQuotes.filter((row) => {
    const code = normalizeCode(row.symbol || row.code);
    return sessionReady(statusByCode.get(code));
  }).length;
  const maxLatestCandleTime = statuses.map((row) => row.latest_candle_time).filter(Boolean).sort((a, b) => Date.parse(b) - Date.parse(a))[0] || null;
  const sourceStatus = sessionReadyCount >= MIN_INTRADAY_1M_CANDIDATES ? "ready" : "not_ready";
  const notReadyReason = sourceStatus === "ready"
    ? null
    : `sessionReadyCount ${sessionReadyCount} below ${MIN_INTRADAY_1M_CANDIDATES}`;

  const rows = eligibleQuotes.map((quote) => {
    const code = normalizeCode(quote.symbol || quote.code);
    const status = statusByCode.get(code) || {};
    const capital = capitalByCode.get(code) || {};
    return {
      requested_trade_date: tradeDate,
      trade_date: tradeDate,
      symbol: code,
      name: quote.name || code,
      close: cleanNumber(quote.close || quote.last_price),
      volume: cleanNumber(quote.trade_volume_shares || quote.trade_volume || quote.total_volume),
      trade_value: cleanNumber(quote.trade_value),
      avg_volume: null,
      issued_shares: cleanNumber(capital.issued_shares) || null,
      latest_candle_time: status.latest_candle_time || null,
      quote_time: latestTime(quote.quote_time, quote.last_trade_time, quote.updated_at),
      updated_at: latestTime(quote.updated_at, status.updated_at, capital.updated_at, refreshedAt),
      refreshed_at: refreshedAt,
      source: "strategy3_ready_snapshot_terminal_refresh",
      source_status: sourceStatus,
      not_ready_reason: notReadyReason,
    };
  });

  const updatedRows = await patchExistingRows(rows);

  console.log(JSON.stringify({
    ok: true,
    source: "strategy3_ready_snapshot_terminal_refresh",
    tradeDate,
    insertedRows: rows.length,
    updatedRows,
    sessionReadyCount,
    minIntraday1mCandidates: MIN_INTRADAY_1M_CANDIDATES,
    minIntraday1mCandles: MIN_INTRADAY_1M_CANDLES,
    sessionLatestMinute: SESSION_LATEST_MINUTE,
    sourceStatus,
    latestCandleTime: maxLatestCandleTime,
    statusRefresh,
    refreshedAt,
  }));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    source: "strategy3_ready_snapshot_terminal_refresh",
    error: error?.message || String(error),
  }));
  process.exit(1);
});
