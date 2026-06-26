"use strict";

const fs = require("fs");
const path = require("path");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const MIN_AFTER_1300 = Math.max(1, Number(process.env.STRATEGY3_MIN_AFTER_1300_CANDIDATES || 20));

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

async function main() {
  const tradeDate = argValue("--trade-date", process.env.STRATEGY3_TRADE_DATE || taipeiTradeDate());
  const statusRefresh = await rpc("refresh_strategy3_intraday_1m_status_latest", { p_trade_date: tradeDate });
  const rows = await getRows([
    "/rest/v1/v_strategy3_intraday_1m_status",
    "?select=symbol,latest_candle_time,today_candle_count,after_1300_candle_count,has_after_1300_candle,updated_at",
    "&after_1300_candle_count=gt.0",
    "&order=latest_candle_time.desc",
    "&limit=5000",
  ].join(""));
  const latestCandleTime = rows.map((row) => row.latest_candle_time).filter(Boolean).sort((a, b) => Date.parse(b) - Date.parse(a))[0] || "";
  const ready = rows.length >= MIN_AFTER_1300;
  console.log(JSON.stringify({
    ok: true,
    ready,
    source: "v_strategy3_intraday_1m_status",
    tradeDate,
    after1300ReadyCount: rows.length,
    minAfter1300: MIN_AFTER_1300,
    latestCandleTime,
    status: ready ? "ready" : "not_ready",
    reason: ready ? "after1300 intraday status ready" : `after1300ReadyCount ${rows.length} below ${MIN_AFTER_1300}`,
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
