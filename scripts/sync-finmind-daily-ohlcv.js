const fs = require("fs");
const path = require("path");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.FUMAN_SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/+$/, "");

function readSecret(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

const FINMIND_TOKEN = process.env.FINMIND_API_TOKEN
  || process.env.FINMIND_TOKEN
  || readSecret(path.join(RUNTIME_DIR, "secrets", "finmind-api-token.txt"));
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.FUMAN_SUPABASE_SERVICE_ROLE_KEY
  || readSecret(path.join(RUNTIME_DIR, "secrets", "supabase-service-role-key.txt"));
const SUPABASE_BATCH_SIZE = Math.max(1, Number(process.env.FINMIND_SUPABASE_BATCH_SIZE || 200));
const SUPABASE_UPSERT_ATTEMPTS = Math.max(1, Number(process.env.FINMIND_SUPABASE_UPSERT_ATTEMPTS || 4));
const SUPABASE_UPSERT_TIMEOUT_MS = Math.max(5000, Number(process.env.FINMIND_SUPABASE_UPSERT_TIMEOUT_MS || 45000));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timeoutSignal(ms) {
  return AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined;
}

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

function defaultStart(days = 35) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return ymd(d);
}

function argValue(name, fallback) {
  const arg = process.argv.find((item) => item.startsWith(`${name}=`));
  return arg ? arg.slice(name.length + 1) : fallback;
}

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeRow(row) {
  const symbol = String(row?.stock_id || "").trim();
  if (!/^\d{4}$/.test(symbol)) return null;
  const tradeDate = String(row?.date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) return null;
  const volumeShares = number(row.Trading_Volume);
  return {
    symbol,
    trade_date: tradeDate,
    open: number(row.open) || null,
    high: number(row.max) || null,
    low: number(row.min) || null,
    close: number(row.close) || null,
    spread: number(row.spread),
    volume_shares: volumeShares,
    volume_lots: volumeShares / 1000,
    trade_value_twd: number(row.Trading_money),
    trading_turnover: number(row.Trading_turnover),
    source: "finmind:TaiwanStockPrice",
    payload: row,
    updated_at: new Date().toISOString(),
  };
}

async function fetchRows(startDate, endDate) {
  if (!FINMIND_TOKEN) throw new Error("missing FinMind token");
  const url = new URL("https://api.finmindtrade.com/api/v4/data");
  url.searchParams.set("dataset", "TaiwanStockPrice");
  url.searchParams.set("start_date", startDate);
  url.searchParams.set("end_date", endDate);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${FINMIND_TOKEN}`, "User-Agent": "FumanFinMindDaily/1.0" },
    signal: timeoutSignal(120000),
  });
  if (!response.ok) throw new Error(`FinMind TaiwanStockPrice HTTP ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload?.data) ? payload.data : [];
}

async function upsertChunk(chunk, offset) {
  let lastError = "";
  for (let attempt = 1; attempt <= SUPABASE_UPSERT_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/finmind_daily_ohlcv?on_conflict=symbol,trade_date`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(chunk),
        signal: timeoutSignal(SUPABASE_UPSERT_TIMEOUT_MS),
      });
      if (response.ok) return;
      const text = await response.text().catch(() => "");
      lastError = `HTTP ${response.status}: ${text.slice(0, 200)}`;
    } catch (error) {
      lastError = error?.message || String(error);
    }
    if (attempt < SUPABASE_UPSERT_ATTEMPTS) {
      const delayMs = Math.min(30000, 1000 * (2 ** (attempt - 1)));
      console.warn(`Supabase finmind_daily_ohlcv chunk offset ${offset} attempt ${attempt}/${SUPABASE_UPSERT_ATTEMPTS} failed: ${lastError}; retry in ${delayMs}ms`);
      await sleep(delayMs);
    }
  }
  throw new Error(`Supabase finmind_daily_ohlcv chunk offset ${offset} failed after ${SUPABASE_UPSERT_ATTEMPTS} attempts: ${lastError}`);
}

async function upsert(rows) {
  if (!SUPABASE_SERVICE_KEY) throw new Error("missing Supabase service role key");
  let written = 0;
  for (let i = 0; i < rows.length; i += SUPABASE_BATCH_SIZE) {
    const chunk = rows.slice(i, i + SUPABASE_BATCH_SIZE);
    await upsertChunk(chunk, i);
    written += chunk.length;
  }
  return written;
}

async function main() {
  const startDate = argValue("--start", defaultStart(Number(process.env.FINMIND_DAILY_LOOKBACK_DAYS || 35)));
  const endDate = argValue("--end", ymd(new Date()));
  const rawRows = await fetchRows(startDate, endDate);
  const rows = rawRows.map(normalizeRow).filter(Boolean);
  const written = await upsert(rows);
  console.log(JSON.stringify({ ok: true, source: "finmind:TaiwanStockPrice", startDate, endDate, rawRows: rawRows.length, normalizedRows: rows.length, written }));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exit(1);
});
