"use strict";
const fs = require("fs");
const path = require("path");
const { terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const CACHE_DIR = process.env.FUGLE_HISTORY_CACHE_DIR || path.join(RUNTIME_DIR, "cache", "fugle", "historical");
const OUT_DIR = path.join(RUNTIME_DIR, "data", "scan-receipts");
const SUPABASE_URL = terminalSupabaseUrl({ root: ROOT, runtimeDir: RUNTIME_DIR }).replace(/\/+$/, "");
const SUPABASE_KEY = terminalSupabaseKey({ root: ROOT, runtimeDir: RUNTIME_DIR });
const MIN_SOURCE_ROWS = Math.max(1500, Number(process.env.STRATEGY4_SOURCE_ROOT_MIN_ROWS || process.env.STRATEGY4_STANDARD_MIN_SOURCE_ROWS || 1500));
const MIN_CACHE_SYMBOLS = Math.max(1500, Number(process.env.STRATEGY4_SOURCE_ROOT_MIN_CACHE_SYMBOLS || 1500));
const MIN_HISTORY_BARS = Number(process.env.STRATEGY4_MIN_HISTORY_BARS || 60);

function cleanNumber(value) {
  const n = Number(String(value ?? "").replace(/[,%%+]/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}
function compactDate(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 8 ? digits.slice(0, 8) : "";
}
function isoDate(value) {
  const digits = compactDate(value);
  return digits ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}` : "";
}
function taipeiDate() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
async function rest(pathname, { count = false } = {}) {
  const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Accept: "application/json" };
  if (count) headers.Prefer = "count=exact";
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, { headers, cache: "no-store" });
  const text = await response.text();
  if (!response.ok) throw new Error(`${pathname} HTTP ${response.status} ${text.slice(0, 240)}`.trim());
  const rows = text ? JSON.parse(text) : [];
  const range = response.headers.get("content-range") || "";
  const match = range.match(/\/(\d+)$/);
  return { rows: Array.isArray(rows) ? rows : [], count: match ? Number(match[1]) || 0 : (Array.isArray(rows) ? rows.length : 0) };
}
async function countTable(table, dateField, date) {
  const query = `${table}?select=*&${dateField}=eq.${encodeURIComponent(date)}&limit=1`;
  return (await rest(query, { count: true })).count;
}
async function latestTableDate(table, dateField) {
  const rows = (await rest(`${table}?select=${dateField}&order=${dateField}.desc&limit=1`)).rows;
  return isoDate(rows[0]?.[dateField] || "");
}
async function readSyncStatus(date) {
  const rows = (await rest(`fugle_daily_sync_status?select=trade_date,source,status,symbols_expected,symbols_loaded,missing_symbols_count,updated_at,payload&trade_date=eq.${encodeURIComponent(date)}&source=eq.fugle&order=updated_at.desc&limit=1`)).rows;
  return rows[0] || null;
}
async function universeCount() {
  for (const table of ["strategy4_stock_universe_view", "stock_universe"]) {
    try {
      const query = table === "strategy4_stock_universe_view"
        ? `${table}?select=*&limit=1`
        : `${table}?select=*&stock_type=eq.COMMONSTOCK&is_active=eq.true&is_etf=eq.false&is_warrant=eq.false&is_cb=eq.false&limit=1`;
      const count = (await rest(query, { count: true })).count;
      if (count > 0) return { table, count };
    } catch {}
  }
  return { table: "", count: 0 };
}
function inspectHistoryCache(date) {
  const files = fs.existsSync(CACHE_DIR) ? fs.readdirSync(CACHE_DIR).filter((name) => /^\d{4}\.json$/i.test(name)) : [];
  let fresh = 0;
  let stale = 0;
  let insufficient = 0;
  const staleSample = [];
  const insufficientSample = [];
  for (const name of files) {
    try {
      const payload = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, name), "utf8"));
      const rows = Array.isArray(payload.rows) ? payload.rows : [];
      const lastDate = isoDate(rows.at(-1)?.date || payload.to || "");
      if (lastDate !== date) {
        stale += 1;
        if (staleSample.length < 20) staleSample.push({ code: name.slice(0, 4), to: payload.to || "", lastDate, rows: rows.length });
        continue;
      }
      if (rows.length < MIN_HISTORY_BARS) {
        insufficient += 1;
        if (insufficientSample.length < 20) insufficientSample.push({ code: name.slice(0, 4), rows: rows.length, lastDate });
        continue;
      }
      fresh += 1;
    } catch {
      stale += 1;
      if (staleSample.length < 20) staleSample.push({ code: name.slice(0, 4), reason: "invalid_json" });
    }
  }
  return { cacheDir: CACHE_DIR, files: files.length, fresh, stale, insufficient, staleSample, insufficientSample };
}
async function main() {
  const targetDate = isoDate(process.argv.find((arg) => arg.startsWith("--date="))?.slice(7) || process.env.FUMAN_SCANNER_TARGET_DATE || process.env.FUMAN_SCANNER_TARGET_TRADE_DATE || taipeiDate());
  if (!targetDate) throw new Error("missing_target_date");
  const issues = [];
  const warnings = [];
  const [universe, ohlcvRows, volumeRows, stockDailyRows, latestOhlcv, latestVolume, latestStockDaily, syncStatus] = await Promise.all([
    universeCount(),
    countTable("fugle_daily_ohlcv", "trade_date", targetDate).catch((error) => ({ error: error.message, count: 0 })),
    countTable("fugle_daily_volume", "trade_date", targetDate).catch((error) => ({ error: error.message, count: 0 })),
    countTable("stock_daily_volume", "trade_date", targetDate).catch((error) => ({ error: error.message, count: 0 })),
    latestTableDate("fugle_daily_ohlcv", "trade_date").catch(() => ""),
    latestTableDate("fugle_daily_volume", "trade_date").catch(() => ""),
    latestTableDate("stock_daily_volume", "trade_date").catch(() => ""),
    readSyncStatus(targetDate).catch(() => null),
  ]);
  const ohlcvCount = cleanNumber(ohlcvRows.count ?? ohlcvRows);
  const volumeCount = cleanNumber(volumeRows.count ?? volumeRows);
  const stockDailyCount = cleanNumber(stockDailyRows.count ?? stockDailyRows);
  const cache = inspectHistoryCache(targetDate);

  if (universe.count < MIN_SOURCE_ROWS) issues.push(`strategy4_universe_too_low:${universe.count}<${MIN_SOURCE_ROWS}`);
  if (latestOhlcv && latestOhlcv !== targetDate) issues.push(`fugle_daily_ohlcv_latest_date_mismatch:${latestOhlcv}:target=${targetDate}`);
  if (latestVolume && latestVolume !== targetDate) issues.push(`fugle_daily_volume_latest_date_mismatch:${latestVolume}:target=${targetDate}`);
  if (ohlcvCount < MIN_SOURCE_ROWS) issues.push(`fugle_daily_ohlcv_rows_too_low:${ohlcvCount}<${MIN_SOURCE_ROWS}`);
  if (volumeCount < MIN_SOURCE_ROWS) issues.push(`fugle_daily_volume_rows_too_low:${volumeCount}<${MIN_SOURCE_ROWS}`);
  if (stockDailyCount > 0 && latestStockDaily !== targetDate) issues.push(`stock_daily_volume_latest_date_mismatch:${latestStockDaily}:target=${targetDate}`);
  if (cache.fresh < MIN_CACHE_SYMBOLS) issues.push(`history_cache_fresh_symbols_too_low:${cache.fresh}<${MIN_CACHE_SYMBOLS}`);
  if (syncStatus) {
    const loaded = cleanNumber(syncStatus.symbols_loaded);
    const missing = cleanNumber(syncStatus.missing_symbols_count);
    if (syncStatus.status !== "complete" && loaded < MIN_SOURCE_ROWS) issues.push(`sync_status_not_complete:${syncStatus.status}:loaded=${loaded}:missing=${missing}`);
  } else {
    warnings.push(`sync_status_missing:${targetDate}`);
  }

  const payload = {
    ok: issues.length === 0,
    verifier: "verify-strategy4-source-root",
    checked_at: new Date().toISOString(),
    targetDate,
    minSourceRows: MIN_SOURCE_ROWS,
    minCacheSymbols: MIN_CACHE_SYMBOLS,
    universe,
    supabase: {
      fugle_daily_ohlcv: { latestDate: latestOhlcv, rowsOnTargetDate: ohlcvCount },
      fugle_daily_volume: { latestDate: latestVolume, rowsOnTargetDate: volumeCount },
      stock_daily_volume: { latestDate: latestStockDaily, rowsOnTargetDate: stockDailyCount },
      fugle_daily_sync_status: syncStatus,
    },
    cache,
    first_blocker: issues[0] || "",
    reason_code: issues.length ? "strategy4_source_root_not_ready" : "strategy4_source_root_ready",
    allowed_action: issues.length ? "fail_closed_run_strategy4_source_prewarm_repair_then_reverify" : "allow_strategy4_full_scan",
    warnings,
    issues,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const key = targetDate.replace(/-/g, "");
  fs.writeFileSync(path.join(OUT_DIR, "strategy4-source-root-latest.json"), JSON.stringify(payload, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(OUT_DIR, `strategy4-source-root-${key}.json`), JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(payload, null, 2));
  if (issues.length) process.exit(1);
}
main().catch((error) => {
  console.error(JSON.stringify({ ok: false, verifier: "verify-strategy4-source-root", error: error?.message || String(error) }, null, 2));
  process.exit(1);
});
