"use strict";

const fs = require("fs");
const path = require("path");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const MIN_READY_FOR_STRATEGY3 = Math.max(1, Number(process.env.STRATEGY3_MIN_INTRADAY_1M_CANDIDATES || 1000));
const MIN_CANDLES_FOR_STRATEGY3 = Math.max(1, Number(process.env.STRATEGY3_FORMAL_MIN_INTRADAY_1M_CANDLES || process.env.STRATEGY3_MIN_INTRADAY_1M_CANDLES || 20));
const MIN_READY_FOR_STRATEGY2 = Math.max(1, Number(process.env.STRATEGY2_MIN_INTRADAY_1M_READY || 1500));
const STATUS_VIEW = process.env.STRATEGY2_READINESS_STATUS_VIEW || "v_strategy2_readiness_status";
const READY_VIEW = process.env.STRATEGY2_INTRADAY_READY_VIEW || "v_strategy2_intraday_ready";
const DAYTRADE_STATUS_VIEW = process.env.STRATEGY3_DAYTRADE_INTRADAY_STATUS_VIEW || "v_fugle_daytrade_intraday_1m_status";
const MISSING_VIEW = process.env.STRATEGY2_READINESS_MISSING_VIEW || "v_strategy2_readiness_missing";
const RAW_1M_TABLE = process.env.STRATEGY3_SUPABASE_1M_TABLE || "fugle_intraday_1m";

function readSecret(file) {
  try {
    return fs.readFileSync(path.join(RUNTIME_DIR, "secrets", file), "utf8").trim();
  } catch {
    return "";
  }
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

function headers() {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("missing Supabase credentials");
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

async function request(method, route, body, timeoutMs = 60000) {
  const response = await fetch(`${SUPABASE_URL}${route}`, {
    method,
    headers: headers(),
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${route} HTTP ${response.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

async function rpc(functionName, body = {}) {
  return request("POST", `/rest/v1/rpc/${functionName}`, body, 90000);
}

async function getRows(route) {
  const rows = await request("GET", route);
  return Array.isArray(rows) ? rows : [];
}

async function getRowsPaged(baseRoute, pageSize = 1000, maxRows = 10000) {
  const rows = [];
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const separator = baseRoute.includes("?") ? "&" : "?";
    const page = await getRows(`${baseRoute}${separator}limit=${pageSize}&offset=${offset}`);
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

function numberValue(value) {
  const number = Number(String(value ?? "").replace(/[,%]/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

function isReady(row) {
  const continuous = numberValue(row.continuous_candle_count ?? row.candle_count);
  return row.ready_ma20_continuous === true || row.ready_ge_20 === true || continuous >= MIN_CANDLES_FOR_STRATEGY3;
}

function latestTime(rows, key) {
  return rows.map((row) => row[key]).filter(Boolean).sort((a, b) => Date.parse(b) - Date.parse(a))[0] || "";
}

async function fetchRawLatestValidDayReadiness() {
  const latestRows = await getRows(`/rest/v1/${RAW_1M_TABLE}?select=trade_date&order=trade_date.desc&limit=1`);
  const tradeDate = String(latestRows?.[0]?.trade_date || "");
  if (!tradeDate) return null;
  const rows = await getRowsPaged([
    `/rest/v1/${RAW_1M_TABLE}`,
    "?select=symbol,candle_time,trade_date,updated_at",
    "&order=symbol.asc,candle_time.desc",
  ].join(""), 1000, 400000);
  const byCode = new Map();
  for (const row of rows) {
    const symbol = String(row.symbol || "").replace(/\D/g, "").slice(0, 4);
    if (!/^\d{4}$/.test(symbol)) continue;
    const current = byCode.get(symbol) || { symbol, continuous_candle_count: 0, latest_candle_time: "", updated_at: "" };
    if (current.continuous_candle_count >= 200) continue;
    current.continuous_candle_count += 1;
    if (String(row.trade_date || "") === tradeDate) current.today_candle_count = numberValue(current.today_candle_count) + 1;
    if (row.candle_time && (!current.latest_candle_time || Date.parse(row.candle_time) > Date.parse(current.latest_candle_time))) current.latest_candle_time = row.candle_time;
    if (row.updated_at && (!current.updated_at || Date.parse(row.updated_at) > Date.parse(current.updated_at))) current.updated_at = row.updated_at;
    byCode.set(symbol, current);
  }
  for (const [symbol, row] of byCode) {
    if (String(row.latest_candle_time || "").slice(0, 10) !== tradeDate) byCode.delete(symbol);
  }
  const readyRows = [...byCode.values()].filter(isReady);
  return {
    source: `${RAW_1M_TABLE}:latest-valid-day`,
    tradeDate,
    expected: byCode.size,
    readyCount: readyRows.length,
    latestCandleTime: latestTime(readyRows, "latest_candle_time"),
    latestStatusUpdatedAt: latestTime(readyRows, "updated_at"),
  };
}

async function main() {
  let refreshResult = null;
  let refreshWarning = "";
  try {
    refreshResult = await rpc("refresh_strategy2_readiness_cache", {});
  } catch (error) {
    refreshWarning = error?.message || String(error);
  }

  const statusRows = await getRows(`/rest/v1/${STATUS_VIEW}?select=*&limit=1`);
  const status = statusRows[0] || null;
  const readyRows = await getRowsPaged([
    `/rest/v1/${READY_VIEW}`,
    "?select=symbol,name,latest_candle_time,today_candle_count,continuous_candle_count,ready_ge_35,ready_ma20_continuous,ready_ma35_continuous,intraday_1m_status_updated_at,quote_updated_at",
    "&order=symbol.asc",
  ].join(""));
  const daytradeStatusRows = await getRowsPaged([
    `/rest/v1/${DAYTRADE_STATUS_VIEW}`,
    "?select=symbol,latest_candle_time,today_candle_count,continuous_candle_count,ready_ge_20,ready_ge_35,ready_ma20_continuous,ready_ma35_continuous,updated_at",
    "&order=symbol.asc",
  ].join(""));
  const missingRows = await getRows([
    `/rest/v1/${MISSING_VIEW}`,
    "?select=checked_at,gate,symbol,name,missing_reason,details",
    "&gate=eq.09%3A00_13%3A30_intraday_1m",
    "&order=symbol.asc",
    "&limit=25",
  ].join(""));

  let rawFallback = null;
  const readyCountFromView = readyRows.filter(isReady).length;
  const daytradeStatusReadyCount = daytradeStatusRows.filter(isReady).length;
  const expectedFromView = readyRows.length;
  const statusReadyCount = numberValue(status?.intraday_1m_ready_count);
  const statusExpected = numberValue(status?.detection_expected_count);
  if (Math.max(readyCountFromView, daytradeStatusReadyCount, statusReadyCount) < MIN_READY_FOR_STRATEGY3) {
    rawFallback = await fetchRawLatestValidDayReadiness().catch((error) => ({ error: error?.message || String(error), readyCount: 0, expected: 0 }));
  }
  const effectiveReady = Math.max(readyCountFromView, daytradeStatusReadyCount, statusReadyCount, numberValue(rawFallback?.readyCount));
  const expected = Math.max(expectedFromView, daytradeStatusRows.length, statusExpected, numberValue(rawFallback?.expected));
  const strategy3Safe = effectiveReady >= MIN_READY_FOR_STRATEGY3;
  const strategy2Safe = effectiveReady >= Math.min(MIN_READY_FOR_STRATEGY2, expected || MIN_READY_FOR_STRATEGY2);

  const result = {
    ok: strategy3Safe,
    status: strategy3Safe ? "ready_for_strategy3" : "not_ready_for_strategy3",
    checkedAt: new Date().toISOString(),
    source: daytradeStatusReadyCount >= MIN_READY_FOR_STRATEGY3 ? DAYTRADE_STATUS_VIEW : (rawFallback?.readyCount >= MIN_READY_FOR_STRATEGY3 ? rawFallback.source : READY_VIEW),
    statusView: STATUS_VIEW,
    daytradeStatusView: DAYTRADE_STATUS_VIEW,
    missingView: MISSING_VIEW,
    refreshResult,
    refreshWarning,
    expected,
    readyCount: effectiveReady,
    rawLatestValidDay: rawFallback,
    readyCountFromView,
    statusReadyCount,
    expectedFromView,
    statusExpected,
    strategy3MinReady: MIN_READY_FOR_STRATEGY3,
    strategy3MinCandles: MIN_CANDLES_FOR_STRATEGY3,
    strategy2MinReady: MIN_READY_FOR_STRATEGY2,
    strategy3SafeForReuse: strategy3Safe,
    strategy2DaytradeReadyEnough: strategy2Safe,
    latestCandleTime: latestTime(daytradeStatusRows, "latest_candle_time") || latestTime(readyRows, "latest_candle_time") || rawFallback?.latestCandleTime || "",
    latestStatusUpdatedAt: latestTime(daytradeStatusRows, "updated_at") || latestTime(readyRows, "intraday_1m_status_updated_at") || rawFallback?.latestStatusUpdatedAt || "",
    missingSampleCount: missingRows.length,
    missingSample: missingRows.map((row) => ({
      symbol: row.symbol || "",
      name: row.name || "",
      missingReason: row.missing_reason || "",
      todayCandleCount: numberValue(row.details?.today_candle_count),
      continuousCandleCount: numberValue(row.details?.continuous_candle_count),
      latestCandleTime: row.details?.latest_candle_time || "",
      readyMa20Continuous: row.details?.ready_ma20_continuous ?? null,
      readyMa35Continuous: row.details?.ready_ma35_continuous ?? null,
    })),
    publishAllowedForStrategy3: strategy3Safe,
    scannerBehaviorForStrategy3: strategy3Safe
      ? "Strategy3 may read and reuse Strategy2 daytrade 1m"
      : "Strategy3 must preserve previous good and block latest until Strategy2 daytrade 1m MA20/session-ready rows reach threshold",
    reason: strategy3Safe
      ? `Strategy2 daytrade 1m ready ${effectiveReady}/${expected}; Strategy3 threshold ${MIN_READY_FOR_STRATEGY3}`
      : `Strategy2 daytrade 1m ready ${effectiveReady}/${expected}; below Strategy3 threshold ${MIN_READY_FOR_STRATEGY3}`,
  };

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    status: "failed",
    checkedAt: new Date().toISOString(),
    source: READY_VIEW,
    error: error?.message || String(error),
    publishAllowedForStrategy3: false,
    scannerBehaviorForStrategy3: "Strategy3 must preserve previous good and block latest because Strategy2 daytrade 1m chain check failed",
  }, null, 2));
  process.exit(1);
});
