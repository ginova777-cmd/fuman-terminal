"use strict";

const fs = require("fs");
const path = require("path");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const MIN_INTRADAY_1M_CANDIDATES = Math.max(1, Number(process.env.STRATEGY3_MIN_INTRADAY_1M_CANDIDATES || 1000));
const MIN_INTRADAY_1M_CANDLES = Math.max(1, Number(process.env.STRATEGY3_MIN_INTRADAY_1M_CANDLES || 35));
const SESSION_LATEST_MINUTE = Number(process.env.STRATEGY3_SESSION_LATEST_MINUTE || (12 * 60 + 50));
const PAGE_SIZE = Math.max(10, Math.min(Number(process.env.STRATEGY3_SESSION_READINESS_PAGE_SIZE || 50), 1000));
const MAX_ROWS = Math.max(PAGE_SIZE, Number(process.env.STRATEGY3_SESSION_READINESS_MAX_ROWS || 6000));

function readSecret(file) {
  try { return fs.readFileSync(path.join(RUNTIME_DIR, "secrets", file), "utf8").trim(); } catch { return ""; }
}

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

function headers(extra = {}) {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("missing Supabase credentials");
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    ...extra,
  };
}

async function request(method, route, body) {
  const response = await fetch(`${SUPABASE_URL}${route}`, {
    method,
    headers: headers(),
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout ? AbortSignal.timeout(60000) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${route} HTTP ${response.status} ${text.slice(0, 400)}`.trim());
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

async function rpc(functionName, body) {
  return request("POST", `/rest/v1/rpc/${functionName}`, body || {});
}

async function getRows(route) {
  const rows = await request("GET", route);
  return Array.isArray(rows) ? rows : [];
}

async function getPagedRows(routeBase) {
  const out = [];
  const separator = routeBase.includes("?") ? "&" : "?";
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
    const page = await getRows(`${routeBase}${separator}limit=${PAGE_SIZE}&offset=${offset}`);
    out.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return out;
}

async function main() {
  const tradeDate = argValue("--trade-date", process.env.STRATEGY3_TRADE_DATE || taipeiTradeDate());
  let statusRefresh = null;
  let statusRefreshWarning = "";
  try {
    statusRefresh = await rpc("refresh_strategy3_intraday_1m_status_latest", { p_trade_date: tradeDate });
  } catch (error) {
    statusRefreshWarning = error?.message || String(error);
  }
  const rows = await getPagedRows([
    "/rest/v1/v_strategy3_intraday_1m_status",
    "?select=symbol,latest_candle_time,today_candle_count,updated_at",
  ].join(""));
  const latestCandleTime = rows.map((row) => row.latest_candle_time).filter(Boolean).sort((a, b) => Date.parse(b) - Date.parse(a))[0] || "";
  const sessionRows = rows.filter((row) => {
    const count = Number(row.today_candle_count || 0);
    const minute = candleMinutes(row.latest_candle_time || row.updated_at);
    return count >= MIN_INTRADAY_1M_CANDLES || (count > 0 && minute != null && minute >= SESSION_LATEST_MINUTE);
  });
  const ready = sessionRows.length >= MIN_INTRADAY_1M_CANDIDATES;
  console.log(JSON.stringify({
    ok: true,
    ready,
    source: "v_strategy3_intraday_1m_status",
    tradeDate,
    sessionReadyCount: sessionRows.length,
    minIntraday1mCandidates: MIN_INTRADAY_1M_CANDIDATES,
    minIntraday1mCandles: MIN_INTRADAY_1M_CANDLES,
    sessionLatestMinute: SESSION_LATEST_MINUTE,
    latestCandleTime,
    status: ready ? "ready" : "not_ready",
    reason: ready ? "09:00-12:59 intraday status ready" : `sessionReadyCount ${sessionRows.length} below ${MIN_INTRADAY_1M_CANDIDATES}`,
    statusRefreshWarning,
    statusRefresh,
  }));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    ready: false,
    source: "v_strategy3_intraday_1m_status",
    error: error?.message || String(error),
  }));
  process.exit(1);
});
