/*
 * Source-side near-one and preopen snapshot worker.
 *
 * This worker is intentionally separate from terminal/UI/scorecard closure.
 * It reads the existing Fugle WebSocket cache and dedicated daytrade tables,
 * then writes only the immutable source contract introduced by
 * DaytradeNearOnePreopenContract_20260729.sql.
 *
 * Run on the daytrade source/writer host, one process only:
 *   node scripts/run-daytrade-near-one-source.js --apply --once
 *
 * Without --apply it is read-only/dry-run. It never opens a WebSocket.
 */

const fs = require("fs");
const path = require("path");
const {
  readFugleFutoptWebSocketQuotes,
} = require("../lib/fugle-futopt-websocket");

const SUPABASE_URL = (process.env.SUPABASE_URL
  || process.env.FUMAN_SUPABASE_URL
  || "https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/+$/, "");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const CACHE_DIR = process.env.FUMAN_CACHE_DIR || path.join(RUNTIME_DIR, "cache");
const LOCK_FILE = path.join(RUNTIME_DIR, "locks", "daytrade-near-one-source.lock");
const MAX_LOCK_AGE_MS = 15 * 60 * 1000;
const READ_TIMEOUT_MS = Math.max(3000, Number(process.env.DAYTRADE_SUPABASE_READ_TIMEOUT_MS || 8000));
const WRITE_TIMEOUT_MS = Math.max(5000, Number(process.env.DAYTRADE_SUPABASE_WRITE_TIMEOUT_MS || 12000));
const APPLY = process.argv.includes("--apply") || /^(1|true|yes|on)$/i.test(process.env.FUMAN_DAYTRADE_NEAR_ONE_APPLY || "");
const ONCE = process.argv.includes("--once");
const SYMBOLS = ["3105", "2455", "2303", "2327"];
const CAPTURE_SLOTS = ["0845", "0850", "0855", "0859"];

function readText(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

function readSecret(name) {
  return readText(path.join(RUNTIME_DIR, "secrets", name))
    || readText(path.join(process.cwd(), "secrets", name))
    || readText(path.join("C:", "fuman-terminal", "secrets", name));
}

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.FUMAN_SUPABASE_SERVICE_ROLE_KEY
  || readSecret("supabase-service-role-key.txt");
const READ_KEY = process.env.SUPABASE_ANON_KEY
  || process.env.FUMAN_SUPABASE_ANON_KEY
  || readSecret("supabase-anon-key.txt")
  || SERVICE_KEY;

function argValue(name, fallback = "") {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || fallback;
}

function normalizeCode(value) {
  const text = String(value || "").replace(/\D/g, "").slice(0, 4);
  return /^\d{4}$/.test(text) ? text : "";
}

function numberValue(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(String(value).replace(/,/g, "").replace(/%/g, "").trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeFutureSymbol(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
}

function normalizeIso(value, fallback = "") {
  if (value === null || value === undefined || value === "") return fallback;
  const raw = String(value).trim();
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function taipeiDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(value);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function taipeiMinutes(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Taipei", hour12: false, hour: "2-digit", minute: "2-digit",
  }).formatToParts(value);
  return Number(parts.find((part) => part.type === "hour")?.value || 0) * 60
    + Number(parts.find((part) => part.type === "minute")?.value || 0);
}

function captureSlot(now = new Date()) {
  const minutes = taipeiMinutes(now);
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  if (hour === 8 && [45, 50, 55, 59].includes(minute)) return `${String(hour).padStart(2, "0")}${String(minute).padStart(2, "0")}`;
  return "";
}

function ageSeconds(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? Math.max(0, Math.floor((Date.now() - parsed) / 1000)) : 999999;
}

function headers(key) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

function requireKey(write = false) {
  const key = write ? SERVICE_KEY : READ_KEY;
  if (!key) throw new Error(write ? "missing Supabase service role key" : "missing Supabase read key");
  return key;
}

async function supabaseGet(resource, query, options = {}) {
  const key = requireKey(Boolean(options.service));
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${resource}?${query}`, {
    headers: headers(key),
    signal: AbortSignal.timeout ? AbortSignal.timeout(READ_TIMEOUT_MS) : undefined,
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${resource} HTTP ${response.status}: ${body.slice(0, 240)}`);
  return body ? JSON.parse(body) : [];
}

async function supabaseGetPaged(resource, query, options = {}) {
  const rows = [];
  const pageSize = Math.max(1, Math.min(Number(options.pageSize || 1000), 1000));
  for (let offset = 0; offset < 10000; offset += pageSize) {
    const suffix = `${query}&limit=${pageSize}&offset=${offset}`;
    const page = await supabaseGet(resource, suffix, options);
    rows.push(...(Array.isArray(page) ? page : []));
    if (!Array.isArray(page) || page.length < pageSize) break;
  }
  return rows;
}

async function supabaseUpsert(resource, rows, onConflict) {
  if (!APPLY || !rows.length) return { written: 0, dryRun: !APPLY };
  const key = requireKey(true);
  let written = 0;
  for (let offset = 0; offset < rows.length; offset += 200) {
    const chunk = rows.slice(offset, offset + 200);
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${resource}?on_conflict=${encodeURIComponent(onConflict)}`, {
      method: "POST",
      headers: { ...headers(key), Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(chunk),
      signal: AbortSignal.timeout ? AbortSignal.timeout(WRITE_TIMEOUT_MS) : undefined,
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`${resource} HTTP ${response.status}: ${body.slice(0, 240)}`);
    written += chunk.length;
  }
  return { written };
}

async function supabaseInsertIgnore(resource, rows, onConflict) {
  if (!APPLY || !rows.length) return { written: 0, dryRun: !APPLY };
  const key = requireKey(true);
  let written = 0;
  for (let offset = 0; offset < rows.length; offset += 200) {
    const chunk = rows.slice(offset, offset + 200);
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${resource}?on_conflict=${encodeURIComponent(onConflict)}`, {
      method: "POST",
      headers: { ...headers(key), Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(chunk),
      signal: AbortSignal.timeout ? AbortSignal.timeout(WRITE_TIMEOUT_MS) : undefined,
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`${resource} HTTP ${response.status}: ${body.slice(0, 240)}`);
    written += chunk.length;
  }
  return { written };
}
function acquireLock() {
  fs.mkdirSync(path.dirname(LOCK_FILE), { recursive: true });
  try {
    const fd = fs.openSync(LOCK_FILE, "wx");
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    fs.closeSync(fd);
    return true;
  } catch (error) {
    try {
      const stat = fs.statSync(LOCK_FILE);
      if (Date.now() - stat.mtimeMs > MAX_LOCK_AGE_MS) {
        fs.rmSync(LOCK_FILE, { force: true });
        return acquireLock();
      }
    } catch {}
    if (error?.code === "EEXIST") return false;
    throw error;
  }
}

function releaseLock() {
  try { fs.rmSync(LOCK_FILE, { force: true }); } catch {}
}

function parseExpiry(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const iso = normalizeIso(text);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : iso.slice(0, 10);
}

function contractMonth(value, expiry) {
  const text = String(value || "").trim();
  if (text) return text;
  return /^\d{4}-\d{2}-\d{2}$/.test(expiry) ? expiry.slice(0, 7) : "";
}

function tickerUnderlying(row) {
  return normalizeCode(row?.underlying_symbol || row?.payload?.underlying_symbol || row?.payload?.underlyingSymbol);
}

function tickerExpiry(row) {
  return parseExpiry(row?.end_date || row?.expiry_date || row?.payload?.end_date || row?.payload?.expiry_date);
}

async function readTickerMap(tradeDate) {
  const rows = await supabaseGetPaged(
    "futopt_tickers",
    "select=future_symbol,name,product,contract_type,end_date,exchange,underlying_name,underlying_symbol,session,updated_at,payload&order=underlying_symbol.asc,end_date.asc",
    { service: true, pageSize: 1000 },
  );
  const byUnderlying = new Map();
  for (const row of rows) {
    const symbol = tickerUnderlying(row);
    const futureSymbol = normalizeFutureSymbol(row?.future_symbol);
    const expiry = tickerExpiry(row);
    const product = String(row?.product || row?.payload?.product || "").toUpperCase();
    if (!symbol || !futureSymbol || product === "TXF" || futureSymbol.startsWith("TXF")) continue;
    const list = byUnderlying.get(symbol) || [];
    list.push({
      symbol,
      fut_contract: futureSymbol,
      contract_month: contractMonth(row?.contract_month || row?.payload?.contract_month, expiry),
      expiry_date: expiry,
      name: row?.name || row?.underlying_name || symbol,
      product,
      payload: row?.payload || {},
    });
    byUnderlying.set(symbol, list);
  }
  const canonical = [];
  for (const [symbol, candidates] of byUnderlying) {
    const valid = candidates
      .filter((row) => row.expiry_date && row.expiry_date >= tradeDate)
      .sort((a, b) => a.expiry_date.localeCompare(b.expiry_date) || a.fut_contract.localeCompare(b.fut_contract));
    const selected = valid[0];
    if (!selected) continue;
    canonical.push({
      trade_date: tradeDate,
      symbol,
      fut_contract: selected.fut_contract,
      contract_month: selected.contract_month,
      expiry_date: selected.expiry_date,
      is_near_one: true,
      resolved_at: new Date().toISOString(),
      source: "fugle_daytrade_source:canonical_near_one",
      payload: {
        ticker_name: selected.name,
        candidate_count: candidates.length,
        selection_rule: "earliest_non_expired_end_date",
        ticker_payload: selected.payload,
      },
    });
  }
  return { rows: canonical, tickerRows: rows.length, mappedSymbols: byUnderlying.size };
}

function selectQuote(byFuture, contract, tradeDate) {
  const row = byFuture.get(contract.fut_contract);
  if (!row) return null;
  const observed = normalizeIso(row.updated_at || row.quoteSeenAt, "");
  if (!observed || taipeiDate(observed) !== tradeDate) return null;
  return {
    observed_at: observed,
    fut_price: numberValue(row.last_price ?? row.price),
    fut_change_pct: numberValue(row.change_percent ?? row.payload?.changePercent),
    fut_volume: numberValue(row.total_volume ?? row.volume ?? row.payload?.total?.tradeVolume),
    payload: row.payload || {},
  };
}

function trialFromSnapshot(row) {
  if (!row) return null;
  const trial = numberValue(row.trial_price ?? row.payload?.trialPrice ?? row.payload?.trial_price);
  const ref = numberValue(row.reference_price ?? row.payload?.referencePrice ?? row.payload?.reference_price);
  const trialChange = numberValue(row.trial_change_pct ?? row.payload?.trialChangePercent ?? row.payload?.trial_change_pct);
  return {
    trial_price: trial,
    trial_change_pct: trialChange !== null ? trialChange : (trial !== null && ref ? ((trial - ref) / ref) * 100 : null),
    best_bid: numberValue(row.best_bid_price ?? row.bid1_price ?? row.payload?.bestBidPrice),
    best_ask: numberValue(row.best_ask_price ?? row.ask1_price ?? row.payload?.bestAskPrice),
    bid_volume: numberValue(row.bid_volume ?? row.bid1_volume ?? row.payload?.bidVolume),
    ask_volume: numberValue(row.ask_volume ?? row.ask1_volume ?? row.payload?.askVolume),
    payload: row.payload || {},
  };
}

async function readPreopenRows(symbols) {
  const rows = [];
  for (let offset = 0; offset < symbols.length; offset += 200) {
    const group = symbols.slice(offset, offset + 200);
    const filter = group.map((symbol) => encodeURIComponent(symbol)).join(",");
    rows.push(...await supabaseGetPaged(
      "fugle_preopen_snapshot",
      `select=symbol,updated_at,reference_price,trial_price,trial_change_pct,best_bid_price,best_ask_price,bid_volume,ask_volume,bid1_price,bid1_volume,ask1_price,ask1_volume,payload&symbol=in.(${filter})&order=updated_at.desc`,
      { service: true, pageSize: 200 },
    ));
  }
  return rows;
}
function latestBySymbol(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const symbol = normalizeCode(row?.symbol);
    if (!symbol || map.has(symbol)) continue;
    map.set(symbol, row);
  }
  return map;
}

async function captureSlotRows(tradeDate, slot, canonicalRows, quoteRows, preopenRows) {
  const byFuture = new Map();
  for (const row of quoteRows) {
    const future = normalizeFutureSymbol(row?.future_symbol);
    if (future) byFuture.set(future, row);
  }
  const preopenBySymbol = latestBySymbol(preopenRows);
  const capturedAt = new Date().toISOString();
  const rows = [];
  for (const contract of canonicalRows) {
    const quote = selectQuote(byFuture, contract, tradeDate);
    const trial = trialFromSnapshot(preopenBySymbol.get(contract.symbol));
    const ratio = trial?.ask_volume && trial.ask_volume > 0 && trial.bid_volume !== null
      ? trial.bid_volume / trial.ask_volume : null;
    rows.push({
      trade_date: tradeDate,
      capture_slot: slot,
      underlying_symbol: contract.symbol,
      fut_contract: contract.fut_contract,
      contract_month: contract.contract_month,
      expiry_date: contract.expiry_date,
      captured_at: capturedAt,
      fut_price: quote?.fut_price ?? null,
      fut_change_pct: quote?.fut_change_pct ?? null,
      fut_volume: quote?.fut_volume ?? null,
      trial_price: trial?.trial_price ?? null,
      trial_change_pct: trial?.trial_change_pct ?? null,
      best_bid: trial?.best_bid ?? null,
      best_ask: trial?.best_ask ?? null,
      bid_ask_ratio: ratio,
      natural_schedule_evidence: true,
      source: "fugle_daytrade_source:preopen_snapshot",
      payload: {
        natural_schedule_evidence: true,
        natural_schedule_phase: slot,
        websocket_quote_seen_at: quote?.observed_at || null,
        preopen_snapshot_updated_at: preopenBySymbol.get(contract.symbol)?.updated_at || null,
        missing_fields: [
          ["fut_price", quote?.fut_price], ["trial_price", trial?.trial_price],
          ["best_bid", trial?.best_bid], ["best_ask", trial?.best_ask],
        ].filter(([, value]) => value === null || value === undefined).map(([name]) => name),
      },
    });
  }
  return rows;
}

async function runOnce() {
  const tradeDate = argValue("trade-date", taipeiDate());
  const slot = argValue("slot", captureSlot());
  const result = {
    ok: false,
    mode: APPLY ? "apply" : "dry-run",
    tradeDate,
    captureSlot: slot || null,
    naturalScheduleEvidence: Boolean(slot && CAPTURE_SLOTS.includes(slot)),
    canonicalRows: 0,
    snapshotRows: 0,
    sourceStatus: "unknown",
    failedChecks: [],
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) result.failedChecks.push("invalid_trade_date");
  if (!slot || !CAPTURE_SLOTS.includes(slot)) result.failedChecks.push("not_in_natural_capture_slot");
  const tickerResult = await readTickerMap(tradeDate);
  result.canonicalRows = tickerResult.rows.length;
  result.tickerRows = tickerResult.tickerRows;
  result.mappedSymbols = tickerResult.mappedSymbols;
  if (!tickerResult.rows.length) result.failedChecks.push("canonical_near_one_rows_missing");
  const quoteCache = readFugleFutoptWebSocketQuotes({ maxAgeMs: 5 * 60 * 1000 });
  const cacheRows = [...quoteCache.quotes.values()];
  const dedicatedRows = await supabaseGetPaged(
    "fugle_daytrade_futopt_quotes_live",
    "select=future_symbol,underlying_symbol,last_price,change_percent,total_volume,updated_at,product,payload&order=updated_at.desc",
    { service: true, pageSize: 1000 },
  );
  const byFuture = new Map();
  for (const row of [...dedicatedRows, ...cacheRows]) {
    const future = normalizeFutureSymbol(row?.future_symbol);
    if (!future || !byFuture.has(future)) byFuture.set(future, row);
  }
  const activeQuotes = tickerResult.rows.filter((row) => selectQuote(byFuture, row, tradeDate));
  result.websocketFreshRows = activeQuotes.length;
  if (!activeQuotes.length) result.failedChecks.push("websocket_quote_source_missing");
  const preopenRows = await readPreopenRows(tickerResult.rows.map((row) => row.symbol));
  const snapshotRows = slot ? await captureSlotRows(tradeDate, slot, tickerResult.rows, [...dedicatedRows, ...cacheRows], preopenRows) : [];
  result.snapshotRows = snapshotRows.length;
  result.snapshotCompleteRows = snapshotRows.filter((row) => row.fut_price !== null && row.trial_price !== null).length;
  if (slot && !snapshotRows.length) result.failedChecks.push("natural_snapshot_rows_missing");
  let pendingSnapshotRows = snapshotRows;
  if (APPLY && slot) {
    const existing = await supabaseGet(
      "fugle_daytrade_preopen_futopt_snapshots",
      `select=underlying_symbol&trade_date=eq.${encodeURIComponent(tradeDate)}&capture_slot=eq.${encodeURIComponent(slot)}`,
      { service: true },
    );
    const existingSymbols = new Set(existing.map((row) => normalizeCode(row?.underlying_symbol)).filter(Boolean));
    pendingSnapshotRows = snapshotRows.filter((row) => !existingSymbols.has(row.underlying_symbol));
    result.existingSnapshotRows = existing.length;
    result.pendingSnapshotRows = pendingSnapshotRows.length;
  }
  if (APPLY) {
    await supabaseUpsert("fugle_daytrade_canonical_near_one_contracts", tickerResult.rows, "trade_date,symbol");
    if (pendingSnapshotRows.length) await supabaseInsertIgnore(
      "fugle_daytrade_preopen_futopt_snapshots",
      pendingSnapshotRows,
      "trade_date,capture_slot,underlying_symbol",
    );
  }
  result.sourceStatus = result.failedChecks.length ? "degraded" : "ready";
  result.ok = result.failedChecks.length === 0 && result.naturalScheduleEvidence;
  result.note = result.ok
    ? "source contract captured; inverse convergence is computed only after 0845 and 0859 are both complete"
    : "fail-closed; missing source fields remain null and cannot be treated as success";
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function main() {
  if (!acquireLock()) {
    console.log(JSON.stringify({ ok: false, status: "already_running", lockFile: LOCK_FILE }));
    return;
  }
  try {
    if (ONCE) {
      await runOnce();
      return;
    }
    const maxSeconds = Number(argValue("max-seconds", "0")) || 0;
    const started = Date.now();
    while (!maxSeconds || Date.now() - started < maxSeconds * 1000) {
      await runOnce();
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  } finally {
    releaseLock();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, status: "error", error: error?.message || String(error) }, null, 2));
  process.exitCode = 1;
});
