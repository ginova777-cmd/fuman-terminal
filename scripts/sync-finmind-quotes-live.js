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

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function isoTaipeiText(value) {
  const text = String(value || "").trim();
  if (!text) return new Date().toISOString();
  const normalized = text.includes("T") ? text : text.replace(" ", "T");
  const date = new Date(`${normalized}+08:00`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function normalizeRow(row) {
  const symbol = String(row?.stock_id || "").trim();
  if (!/^\d{4}$/.test(symbol)) return null;
  const price = number(row.close);
  const changePrice = number(row.change_price);
  const changePercent = number(row.change_rate);
  const previousClose = price && changePrice
    ? price - changePrice
    : price && changePercent
      ? price / (1 + changePercent / 100)
      : 0;
  if (!price) return null;
  return {
    symbol,
    name: String(row.stock_name || row.name || ""),
    price,
    previous_close: previousClose || null,
    change_price: changePrice,
    change_percent: changePercent,
    open_price: number(row.open) || null,
    high_price: number(row.high) || null,
    low_price: number(row.low) || null,
    total_volume_lots: number(row.total_volume),
    trade_value_twd: number(row.total_amount || row.amount),
    buy_price: number(row.buy_price) || null,
    buy_volume_lots: number(row.buy_volume),
    sell_price: number(row.sell_price) || null,
    sell_volume_lots: number(row.sell_volume),
    volume_ratio: number(row.volume_ratio),
    quote_time: isoTaipeiText(row.date || row.datetime || row.date_time),
    source: "finmind:taiwan_stock_tick_snapshot",
    payload: row,
    updated_at: new Date().toISOString(),
  };
}

async function fetchFinMindSnapshot(codes) {
  if (!FINMIND_TOKEN) throw new Error("missing FinMind token");
  const url = new URL("https://api.finmindtrade.com/api/v4/taiwan_stock_tick_snapshot");
  if (codes.length) codes.forEach((code) => url.searchParams.append("data_id", code));
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${FINMIND_TOKEN}`,
      "User-Agent": "FumanFinMindSupplement/1.0",
    },
    signal: timeoutSignal(30000),
  });
  if (!response.ok) throw new Error(`FinMind snapshot HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.status && Number(payload.status) >= 400) throw new Error(`FinMind snapshot status ${payload.status}: ${payload.msg || ""}`);
  return Array.isArray(payload?.data) ? payload.data : [];
}

async function upsertChunk(chunk, offset) {
  let lastError = "";
  for (let attempt = 1; attempt <= SUPABASE_UPSERT_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/finmind_quotes_live?on_conflict=symbol`, {
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
      console.warn(`Supabase finmind_quotes_live chunk offset ${offset} attempt ${attempt}/${SUPABASE_UPSERT_ATTEMPTS} failed: ${lastError}; retry in ${delayMs}ms`);
      await sleep(delayMs);
    }
  }
  throw new Error(`Supabase finmind_quotes_live chunk offset ${offset} failed after ${SUPABASE_UPSERT_ATTEMPTS} attempts: ${lastError}`);
}

async function upsertSupabase(rows) {
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
  const codesArg = process.argv.find((arg) => arg.startsWith("--codes="));
  const codes = codesArg
    ? codesArg.slice("--codes=".length).split(",").map((x) => x.trim()).filter(Boolean)
    : [];
  const rawRows = await fetchFinMindSnapshot(codes);
  const rows = rawRows.map(normalizeRow).filter(Boolean);
  const written = rows.length ? await upsertSupabase(rows) : 0;
  console.log(JSON.stringify({
    ok: true,
    source: "finmind:taiwan_stock_tick_snapshot",
    requested: codes.length || "all",
    rawRows: rawRows.length,
    normalizedRows: rows.length,
    written,
    updatedAt: new Date().toISOString(),
  }));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exit(1);
});
