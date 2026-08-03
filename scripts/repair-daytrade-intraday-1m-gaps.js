const fs = require("fs");
const path = require("path");
const { expectedMinuteLabels, buildTimelineAudit, isSynthetic } = require("../lib/daytrade-intraday-1m-timeline");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.FUMAN_SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/+$/, "");
const args = new Set(process.argv.slice(2));
const valueArg = (name, fallback = "") => {
  const item = process.argv.find((arg) => arg.startsWith(`${name}=`));
  return item ? item.slice(name.length + 1) : fallback;
};
const APPLY = args.has("--apply");
const SYNTHESIZE = args.has("--synthesize");
const FINAL = args.has("--final");
const TRADE_DATE = valueArg("--trade-date", "");
const MAX_SYMBOLS = Math.max(1, Number(valueArg("--max-symbols", "2000")) || 2000);
const PAGE_SIZE = 1000;
const REQUEST_TIMEOUT_MS = 45000;
const REST_DELAY_MS = Math.max(250, Number(valueArg("--delay-ms", process.env.FUGLE_INTRADAY_REPAIR_DELAY_MS || "1000")) || 1000);

function readSecret(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}
function secret(name) {
  return process.env[name] || readSecret(path.join(RUNTIME_DIR, "secrets", name === "FUGLE_API_KEY" ? "fugle-api-key.txt" : "supabase-service-role-key.txt"));
}
function taipeiDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function taipeiMinuteNow() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  return Number(parts.find((part) => part.type === "hour")?.value || 0) * 60 + Number(parts.find((part) => part.type === "minute")?.value || 0);
}
function normalizeSymbol(value) { return String(value || "").replace(/\D/g, "").slice(0, 4); }
function number(value) { const n = Number(String(value ?? "").replace(/,/g, "")); return Number.isFinite(n) ? n : null; }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms))); }
function headers(key) { return { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" }; }
async function request(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
async function supabaseGet(resource, query, key) {
  const rows = [];
  for (let offset = 0; offset < 1000000; offset += PAGE_SIZE) {
    const page = await request(`${SUPABASE_URL}/rest/v1/${resource}?${query}`, { headers: { ...headers(key), Range: `${offset}-${offset + PAGE_SIZE - 1}` } });
    if (!Array.isArray(page) || !page.length) break;
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}
async function supabaseUpsert(resource, rows, conflict, key) {
  if (!rows.length) return 0;
  let written = 0;
  for (let i = 0; i < rows.length; i += 400) {
    const chunk = rows.slice(i, i + 400);
    await request(`${SUPABASE_URL}/rest/v1/${resource}?on_conflict=${encodeURIComponent(conflict)}`, {
      method: "POST", headers: { ...headers(key), Prefer: "resolution=merge-duplicates,return=minimal", "Content-Type": "application/json" }, body: JSON.stringify(chunk),
    });
    written += chunk.length;
  }
  return written;
}
async function acquireLease(key, ownerId) {
  const result = await request(`${SUPABASE_URL}/rest/v1/rpc/acquire_fugle_daytrade_intraday_writer_lease`, {
    method: "POST", headers: { ...headers(key), "Content-Type": "application/json" }, body: JSON.stringify({ p_owner_id: ownerId, p_lease_seconds: 180 }),
  });
  if (!result?.ok) throw new Error(`writer lease unavailable: ${result?.reason || "unknown"}`);
}
async function releaseLease(key, ownerId) {
  try { await request(`${SUPABASE_URL}/rest/v1/rpc/release_fugle_daytrade_intraday_writer_lease`, { method: "POST", headers: { ...headers(key), "Content-Type": "application/json" }, body: JSON.stringify({ p_owner_id: ownerId }) }); } catch {}
}
async function fugleCandles(symbol, apiKey) {
  const url = `https://api.fugle.tw/marketdata/v1.0/stock/intraday/candles/${encodeURIComponent(symbol)}?timeframe=1`;
  const result = await request(url, { headers: { "X-API-KEY": apiKey, Accept: "application/json" } });
  return Array.isArray(result) ? result : (Array.isArray(result?.data) ? result.data : []);
}
function candleTime(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}
function rowMinute(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date);
  return `${parts.find((part) => part.type === "hour")?.value || "00"}:${parts.find((part) => part.type === "minute")?.value || "00"}`;
}
function normalizeRestCandle(symbol, raw, tradeDate) {
  const time = candleTime(raw.date || raw.candleTime || raw.time);
  if (!time || taipeiDate(time) !== tradeDate) return null;
  const close = number(raw.close);
  if (!close) return null;
  return { symbol, candle_time: time, trade_date: tradeDate, open: number(raw.open), high: number(raw.high), low: number(raw.low), close, volume: number(raw.volume) ?? 0 };
}
function makeRealRow(base, market = "") {
  return { ...base, market, source: "fugle_daytrade_writer:rest_gap_repair", source_channel: "rest", candle_origin: "rest_candle", synthetic: false, volume_strategy_usable: true, websocket_row: false, rest_repair_row: true, intraday_odd_lot: false, updated_at: new Date().toISOString(), payload: { source_channel: "rest", candle_origin: "rest_candle", synthetic: false, volume_strategy_usable: true, intradayOddLot: false } };
}
function makeSyntheticRow(symbol, tradeDate, label, close, market = "") {
  const [hour, minute] = label.split(":").map(Number);
  const utc = new Date(`${tradeDate}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+08:00`).toISOString();
  return { symbol, market, candle_time: utc, trade_date: tradeDate, open: close, high: close, low: close, close, volume: 0, source: "fugle_daytrade_writer:synthetic_flat", source_channel: "synthetic", candle_origin: "synthetic_flat", synthetic: true, volume_strategy_usable: false, websocket_row: false, rest_repair_row: false, intraday_odd_lot: false, updated_at: new Date().toISOString(), payload: { synthetic: true, volume_strategy_usable: false, candle_origin: "synthetic_flat", source_channel: "synthetic", intradayOddLot: false } };
}
async function main() {
  const tradeDate = TRADE_DATE || taipeiDate();
  const currentMinute = FINAL ? 13 * 60 + 30 : Math.min(13 * 60 + 30, taipeiMinuteNow() - 1);
  const expectedMinutes = expectedMinuteLabels({ endMinute: currentMinute });
  if (currentMinute < 9 * 60) throw new Error("session_not_started");
  const serviceKey = secret("SUPABASE_SERVICE_ROLE_KEY");
  const fugleKey = secret("FUGLE_API_KEY");
  if (!serviceKey) throw new Error("missing Supabase service role key");
  if (!fugleKey) throw new Error("missing Fugle API key");
  const ownerId = `${process.env.COMPUTERNAME || "writer-host"}:${process.pid}:gap-repair`;
  if (APPLY) await acquireLease(serviceKey, ownerId);
  let writtenReal = 0; let writtenSynthetic = 0; let repairedSymbols = 0; let failedSymbols = 0;
  try {
    const universe = (await supabaseGet("stock_universe", "select=symbol,market&is_active=eq.true&is_blacklisted=eq.false&is_daytrade_unsuitable=eq.false&limit=2000", serviceKey)).slice(0, MAX_SYMBOLS);
    const existing = await supabaseGet("fugle_daytrade_intraday_1m", `select=symbol,market,candle_time,trade_date,open,high,low,close,volume,source,source_channel,candle_origin,synthetic,volume_strategy_usable,websocket_row,rest_repair_row,payload&trade_date=eq.${encodeURIComponent(tradeDate)}&limit=1000000`, serviceKey);
    const bySymbol = new Map();
    for (const row of existing) { const symbol = normalizeSymbol(row.symbol); if (!symbol) continue; if (!bySymbol.has(symbol)) bySymbol.set(symbol, []); bySymbol.get(symbol).push(row); }
    for (const item of universe) {
      const symbol = normalizeSymbol(item.symbol); if (!symbol) continue;
      const localRows = bySymbol.get(symbol) || [];
      const auditBefore = buildTimelineAudit({ symbol, tradeDate, rows: localRows, expectedMinutes });
      if (!auditBefore.missing_minutes.length) { await supabaseUpsert("fugle_daytrade_intraday_1m_timeline_audit", [{ ...auditBefore, checked_at: new Date().toISOString(), payload: { source: "gap-repair", synthesize: SYNTHESIZE } }], "symbol,trade_date", serviceKey); continue; }
      repairedSymbols += 1;
      const have = new Set(localRows.filter((row) => !isSynthetic(row) && row.volume_strategy_usable !== false && !String(row.source || "").includes("quote_derived")).map((row) => rowMinute(row.candle_time)));
      let fetched = [];
      try { fetched = (await fugleCandles(symbol, fugleKey)).map((raw) => normalizeRestCandle(symbol, raw, tradeDate)).filter(Boolean); } catch (error) { failedSymbols += 1; console.error(`[gap-repair] ${symbol} REST failed: ${error.message}`); }
      await sleep(REST_DELAY_MS);
      const realRows = fetched.filter((row) => expectedMinutes.includes(rowMinute(row.candle_time)) && !have.has(rowMinute(row)));
      if (APPLY) writtenReal += await supabaseUpsert("fugle_daytrade_intraday_1m", realRows.map((row) => makeRealRow(row, item.market || "")), "symbol,candle_time", serviceKey);
      localRows.push(...realRows.map((row) => makeRealRow(row, item.market || "")));
      if (SYNTHESIZE) {
        const covered = new Set(localRows.map((row) => rowMinute(row.candle_time)));
        let previousClose = null;
        const syntheticRows = [];
        for (const label of expectedMinutes) {
          const row = localRows.find((candidate) => rowMinute(candidate.candle_time) === label && !isSynthetic(candidate) && candidate.volume_strategy_usable !== false && !String(candidate.source || "").includes("quote_derived") && number(candidate.close));
          if (row) { previousClose = number(row.close); continue; }
          if (!covered.has(label) && previousClose) { const synthetic = makeSyntheticRow(symbol, tradeDate, label, previousClose, item.market || ""); syntheticRows.push(synthetic); localRows.push(synthetic); covered.add(label); }
        }
        if (APPLY) writtenSynthetic += await supabaseUpsert("fugle_daytrade_intraday_1m", syntheticRows, "symbol,candle_time", serviceKey);
      }
      const audit = buildTimelineAudit({ symbol, tradeDate, rows: localRows, expectedMinutes });
      if (APPLY) await supabaseUpsert("fugle_daytrade_intraday_1m_timeline_audit", [{ ...audit, checked_at: new Date().toISOString(), payload: { source: "gap-repair", synthesize: SYNTHESIZE, apply: true } }], "symbol,trade_date", serviceKey);
      else console.log(JSON.stringify(audit));
    }
    console.log(JSON.stringify({ ok: true, apply: APPLY, tradeDate, expectedMinutes: expectedMinutes.length, repairedSymbols, failedSymbols, writtenReal, writtenSynthetic, synthesize: SYNTHESIZE, restDelayMs: REST_DELAY_MS, replayAllowedRequiresMissingMinutesEmpty: true }, null, 2));
  } finally { if (APPLY) await releaseLease(serviceKey, ownerId); }
}
main().catch((error) => { console.error(JSON.stringify({ ok: false, error: error.message || String(error) }, null, 2)); process.exit(1); });
