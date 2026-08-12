"use strict";
// The after-close Strategy4 source writer. Fugle snapshots are the primary
// market source; an incomplete or wrong-date response fails closed.
const fs = require("fs");
const path = require("path");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co";
const TARGET_DATE = String(process.argv.find((arg) => arg.startsWith("--date=")) || "").slice(7) || taipeiDate();
const DRY_RUN = process.argv.includes("--dry-run");
const MIN_ROWS = Math.max(1500, Number(process.env.STRATEGY4_FUGLE_SNAPSHOT_MIN_ROWS || 1500));
const CACHE_DIR = path.join(RUNTIME_DIR, "cache", "fugle", "historical");
function taipeiDate() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (name) => parts.find((entry) => entry.type === name)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function readSecret(name) { try { return fs.readFileSync(path.join(RUNTIME_DIR, "secrets", name), "utf8").trim(); } catch { return ""; } }
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || readSecret("supabase-service-role-key.txt");
const FUGLE_KEY = process.env.FUGLE_API_KEY || readSecret("fugle-api-key.txt");
if (!SERVICE_KEY) throw new Error("strategy4_fugle_snapshot_missing_supabase_service_key");
if (!FUGLE_KEY) throw new Error("strategy4_fugle_snapshot_missing_api_key");
function numeric(value) { const parsed = Number(String(value ?? "").replace(/,/g, "").trim()); return Number.isFinite(parsed) ? parsed : 0; }
function isoDate(value) { const digits = String(value || "").replace(/\D/g, ""); return digits.length >= 8 ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}` : ""; }
function serviceHeaders() { return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" }; }
async function fetchJson(url, headers, attempts = 3) {
  let failure;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
      const text = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 180)}`);
      return text ? JSON.parse(text) : null;
    } catch (error) {
      failure = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    }
  }
  throw failure;
}
async function supabaseRows(resource, query) {
  const all = [];
  for (let offset = 0; offset < 10000; offset += 1000) {
    const page = await fetchJson(`${SUPABASE_URL}/rest/v1/${resource}?${query}`, { ...serviceHeaders(), Range: `${offset}-${offset + 999}` });
    all.push(...page);
    if (page.length < 1000) break;
  }
  return all;
}
async function upsert(resource, conflict, rows) {
  if (DRY_RUN || !rows.length) return;
  for (let index = 0; index < rows.length; index += 200) {
    const chunk = rows.slice(index, index + 200);
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${resource}?on_conflict=${encodeURIComponent(conflict)}`, { method: "POST", headers: { ...serviceHeaders(), Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(chunk), signal: AbortSignal.timeout(60000) });
    const text = await response.text();
    if (!response.ok) throw new Error(`${resource}_upsert_HTTP_${response.status}:${text.slice(0, 220)}`);
  }
}
function eligible(row) {
  const symbol = String(row.symbol || "");
  return /^\d{4}$/.test(symbol) && !symbol.startsWith("00") && row.is_active === true && row.is_etf !== true && row.is_warrant !== true && row.is_cb !== true && row.is_blacklisted !== true && row.is_daytrade_unsuitable !== true && !/水泥|軍工|國防|航太/.test(String(row.industry || ""));
}
async function universe() {
  const rows = await supabaseRows("stock_universe", "select=symbol,name,market,industry,is_active,is_etf,is_warrant,is_cb,is_blacklisted,is_daytrade_unsuitable&order=symbol.asc");
  return new Map(rows.filter(eligible).map((row) => [String(row.symbol), row]));
}
function parseSnapshot(payload, market) {
  const responseDate = isoDate(payload?.date);
  if (responseDate !== TARGET_DATE) throw new Error(`fugle_${market}_snapshot_date_mismatch:${responseDate || "missing"}:expected=${TARGET_DATE}`);
  const data = Array.isArray(payload?.data) ? payload.data : [];
  const rows = new Map();
  for (const quote of data) {
    const symbol = String(quote?.symbol || "").trim();
    const open = numeric(quote?.openPrice); const high = numeric(quote?.highPrice); const low = numeric(quote?.lowPrice); const close = numeric(quote?.closePrice);
    // Fugle snapshot tradeVolume is already in lots. Historical candles use shares,
    // so the unit is persisted explicitly to prevent a second conversion.
    const volumeLots = numeric(quote?.total?.tradeVolume ?? quote?.tradeVolume);
    if (!/^\d{4}$/.test(symbol) || !open || !high || !low || !close || !volumeLots) continue;
    rows.set(symbol, { symbol, name: String(quote?.name || symbol), open, high, low, close, volumeLots, source: `fugle-snapshot-${market.toLowerCase()}` });
  }
  return rows;
}
function updateCache(row, updatedAt) {
  const file = path.join(CACHE_DIR, `${row.symbol}.json`); let current = {};
  try { current = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
  const rows = (Array.isArray(current.rows) ? current.rows : []).filter((item) => String(item.date) !== TARGET_DATE);
  rows.push({ date: TARGET_DATE, open: row.open, high: row.high, low: row.low, close: row.close, volume: row.volumeLots, value: 0, change: 0, volumeUnit: "lots" });
  rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (!DRY_RUN) fs.writeFileSync(file, `${JSON.stringify({ ...current, code: row.symbol, from: current.from || TARGET_DATE, to: TARGET_DATE, source: row.source, updatedAt, rows })}\n`, "utf8");
}
async function main() {
  const [stocks, tsePayload, otcPayload] = await Promise.all([
    universe(),
    fetchJson("https://api.fugle.tw/marketdata/v1.0/stock/snapshot/quotes/TSE", { "X-API-KEY": FUGLE_KEY, Accept: "application/json" }),
    fetchJson("https://api.fugle.tw/marketdata/v1.0/stock/snapshot/quotes/OTC", { "X-API-KEY": FUGLE_KEY, Accept: "application/json" }),
  ]);
  const tse = parseSnapshot(tsePayload, "TSE"); const otc = parseSnapshot(otcPayload, "OTC"); const snapshot = new Map([...tse, ...otc]);
  const accepted = [...stocks.values()].map((meta) => ({ meta, quote: snapshot.get(String(meta.symbol)) })).filter((item) => item.quote);
  const missing = [...stocks.keys()].filter((symbol) => !snapshot.has(symbol));
  if (accepted.length < MIN_ROWS) throw new Error(`fugle_snapshot_accepted_rows_too_low:${accepted.length}<${MIN_ROWS}:missing=${missing.length}`);
  const updatedAt = new Date().toISOString();
  const ohlcv = accepted.map(({ meta, quote }) => ({ symbol: quote.symbol, market: meta.market || "", trade_date: TARGET_DATE, open: quote.open, high: quote.high, low: quote.low, close: quote.close, volume: quote.volumeLots, source: quote.source, name: meta.name || quote.name, industry: meta.industry || "", updated_at: updatedAt, payload: { source: quote.source, volume_unit: "lots", raw_volume_lots: quote.volumeLots, snapshot_script: "sync-strategy4-fugle-daily-snapshot.js" } }));
  const volume = accepted.map(({ meta, quote }) => ({ symbol: quote.symbol, market: meta.market || "", trade_date: TARGET_DATE, volume: quote.volumeLots, updated_at: updatedAt, payload: { source: quote.source, volume_unit: "lots", raw_volume_lots: quote.volumeLots, snapshot_script: "sync-strategy4-fugle-daily-snapshot.js" } }));
  accepted.forEach(({ quote }) => updateCache(quote, updatedAt));
  await upsert("fugle_daily_ohlcv", "symbol,trade_date", ohlcv); await upsert("fugle_daily_volume", "symbol,trade_date", volume);
  await upsert("fugle_daily_sync_status", "trade_date,source", [{ trade_date: TARGET_DATE, source: "fugle", started_at: updatedAt, finished_at: new Date().toISOString(), symbols_expected: stocks.size, symbols_loaded: accepted.length, missing_symbols_count: missing.length, status: "complete", error_message: null, updated_at: new Date().toISOString(), payload: { importer: "sync-strategy4-fugle-daily-snapshot.js", source: "fugle_snapshot", tse_rows: tse.size, otc_rows: otc.size, accepted_rows: accepted.length, missing_sample: missing.slice(0, 100), target_trade_date: TARGET_DATE } }]);
  console.log(JSON.stringify({ ok: true, dryRun: DRY_RUN, targetDate: TARGET_DATE, source: "fugle_snapshot", universe: stocks.size, accepted: accepted.length, missing: missing.length, tseRows: tse.size, otcRows: otc.size }, null, 2));
}
main().catch((error) => { console.error(JSON.stringify({ ok: false, targetDate: TARGET_DATE, error: error?.message || String(error) }, null, 2)); process.exit(1); });