"use strict";

const fs = require("fs");
const path = require("path");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const MIN_INTRADAY_1M_CANDIDATES = Math.max(1, Number(process.env.STRATEGY3_MIN_INTRADAY_1M_CANDIDATES || 1000));
const MIN_INTRADAY_1M_CANDLES = Math.max(1, Number(process.env.STRATEGY3_MIN_INTRADAY_1M_CANDLES || 35));
const SESSION_LATEST_MINUTE = Number(process.env.STRATEGY3_SESSION_LATEST_MINUTE || (12 * 60 + 50));
const STRATEGY3_INTRADAY_STATUS_VIEW = process.env.STRATEGY3_SUPABASE_1M_STATUS_VIEW || "v_strategy2_intraday_ready";
const STRATEGY3_INTRADAY_1M_TABLE = process.env.STRATEGY3_SUPABASE_1M_TABLE || "fugle_intraday_1m";
// Contract marker: 09:00-12:59 intraday status ready is evaluated from Strategy2 daytrade 1m readiness.

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

async function getRowsPaged(route, pageSize = 1000) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const separator = route.includes("?") ? "&" : "?";
    const page = await getRows(`${route}${separator}limit=${pageSize}&offset=${offset}`);
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

async function fetchRawLatestValidDaySession() {
  const latestRows = await getRows(`/rest/v1/${STRATEGY3_INTRADAY_1M_TABLE}?select=trade_date&order=trade_date.desc&limit=1`);
  const tradeDate = String(latestRows?.[0]?.trade_date || "");
  if (!tradeDate) return null;
  const rows = await getRowsPaged([
    `/rest/v1/${STRATEGY3_INTRADAY_1M_TABLE}`,
    "?select=symbol,candle_time,trade_date,updated_at",
    "&order=symbol.asc,candle_time.desc",
  ].join(""));
  const byCode = new Map();
  for (const row of rows) {
    const symbol = String(row.symbol || "").replace(/\D/g, "").slice(0, 4);
    if (!/^\d{4}$/.test(symbol)) continue;
    const current = byCode.get(symbol) || { symbol, today_candle_count: 0, continuous_candle_count: 0, latest_candle_time: "", updated_at: "" };
    if (current.continuous_candle_count >= 200) continue;
    if (String(row.trade_date || "") === tradeDate) current.today_candle_count += 1;
    current.continuous_candle_count += 1;
    if (row.candle_time && (!current.latest_candle_time || Date.parse(row.candle_time) > Date.parse(current.latest_candle_time))) current.latest_candle_time = row.candle_time;
    if (row.updated_at && (!current.updated_at || Date.parse(row.updated_at) > Date.parse(current.updated_at))) current.updated_at = row.updated_at;
    byCode.set(symbol, current);
  }
  for (const [symbol, row] of byCode) {
    if (String(row.latest_candle_time || "").slice(0, 10) !== tradeDate) byCode.delete(symbol);
  }
  const readyRows = [...byCode.values()].filter(isStrategy3DaytradeReadyRow);
  const latestCandleTime = readyRows.map((row) => row.latest_candle_time).filter(Boolean).sort((a, b) => Date.parse(b) - Date.parse(a))[0] || "";
  return {
    source: `${STRATEGY3_INTRADAY_1M_TABLE}:latest-valid-day`,
    tradeDate,
    rowCount: byCode.size,
    readyCount: readyRows.length,
    latestCandleTime,
  };
}

async function fetchStrategy2ReadinessStatus() {
  const rows = await getRows("/rest/v1/v_strategy2_readiness_status?select=status,reason,strategy2_ready_100,detection_expected_count,intraday_1m_ready_count,latest_run_id,checked_at&limit=1");
  return rows[0] || null;
}

function isStrategy3DaytradeReadyRow(row) {
  const count = Number(row.today_candle_count || 0);
  const continuous = Number(row.continuous_candle_count || 0);
  const minute = candleMinutes(row.latest_candle_time || row.intraday_1m_status_updated_at || row.updated_at);
  if (row.ready_ge_35 === true || row.ready_ma35_continuous === true || continuous >= MIN_INTRADAY_1M_CANDLES) return true;
  return count >= MIN_INTRADAY_1M_CANDLES || (count > 0 && minute != null && minute >= SESSION_LATEST_MINUTE);
}

async function main() {
  const tradeDate = argValue("--trade-date", process.env.STRATEGY3_TRADE_DATE || taipeiTradeDate());
  let strategy2Readiness = null;
  let statusRefresh = null;
  let statusRefreshWarning = "";
  try {
    statusRefresh = await rpc("refresh_strategy2_readiness_cache", {});
    strategy2Readiness = await fetchStrategy2ReadinessStatus();
  } catch (error) {
    statusRefreshWarning = error?.message || String(error);
  }
  const rows = await getRowsPaged([
    `/rest/v1/${STRATEGY3_INTRADAY_STATUS_VIEW}`,
    "?select=symbol,latest_candle_time,today_candle_count,continuous_candle_count,ready_ge_35,ready_ma35_continuous,intraday_1m_status_updated_at,quote_updated_at",
    "&order=latest_candle_time.desc",
  ].join(""));
  const latestCandleTime = rows.map((row) => row.latest_candle_time).filter(Boolean).sort((a, b) => Date.parse(b) - Date.parse(a))[0] || "";
  const sessionRows = rows.filter(isStrategy3DaytradeReadyRow);
  const strategy2IntradayReady = Number(strategy2Readiness?.intraday_1m_ready_count || 0);
  const strategy2Expected = Number(strategy2Readiness?.detection_expected_count || 0);
  const rawLatestValidDay = Math.max(sessionRows.length, strategy2IntradayReady) < MIN_INTRADAY_1M_CANDIDATES
    ? await fetchRawLatestValidDaySession().catch((error) => ({ error: error?.message || String(error), readyCount: 0, rowCount: 0 }))
    : null;
  const effectiveReadyCount = Math.max(sessionRows.length, strategy2IntradayReady, Number(rawLatestValidDay?.readyCount || 0));
  const ready = effectiveReadyCount >= MIN_INTRADAY_1M_CANDIDATES;
  console.log(JSON.stringify({
    ok: true,
    ready,
    source: rawLatestValidDay?.readyCount >= MIN_INTRADAY_1M_CANDIDATES ? rawLatestValidDay.source : STRATEGY3_INTRADAY_STATUS_VIEW,
    upstreamSource: "Strategy2 daytrade 1m",
    tradeDate: rawLatestValidDay?.readyCount >= MIN_INTRADAY_1M_CANDIDATES ? rawLatestValidDay.tradeDate : tradeDate,
    sessionReadyCount: effectiveReadyCount,
    viewReadyCount: sessionRows.length,
    rawLatestValidDay,
    strategy2IntradayReadyCount: strategy2IntradayReady,
    strategy2DetectionExpectedCount: strategy2Expected,
    minIntraday1mCandidates: MIN_INTRADAY_1M_CANDIDATES,
    minIntraday1mCandles: MIN_INTRADAY_1M_CANDLES,
    sessionLatestMinute: SESSION_LATEST_MINUTE,
    latestCandleTime: latestCandleTime || rawLatestValidDay?.latestCandleTime || "",
    status: ready ? "ready" : "not_ready",
    reason: ready ? "Strategy2 daytrade intraday 1m source ready for Strategy3" : `Strategy2 daytrade intraday 1m ready ${effectiveReadyCount} below ${MIN_INTRADAY_1M_CANDIDATES}`,
    strategy2Readiness,
    statusRefreshWarning,
    statusRefresh,
  }));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    ready: false,
    source: STRATEGY3_INTRADAY_STATUS_VIEW,
    upstreamSource: "Strategy2 daytrade 1m",
    error: error?.message || String(error),
  }));
  process.exit(1);
});
