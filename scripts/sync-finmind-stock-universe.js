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

function normalizeMarket(type) {
  const text = String(type || "").toLowerCase();
  if (text.includes("twse") || text === "tse") return "TWSE";
  if (text.includes("tpex") || text === "otc") return "TPEX";
  return String(type || "").toUpperCase();
}

function normalizeRow(row) {
  const symbol = String(row?.stock_id || "").trim();
  if (!/^\d{4}$/.test(symbol)) return null;
  const name = String(row?.stock_name || "").trim();
  const industry = String(row?.industry_category || "").trim();
  const text = `${symbol} ${name} ${industry}`;
  return {
    symbol,
    name,
    market: normalizeMarket(row?.type),
    industry,
    is_active: true,
    is_etf: /^00/.test(symbol) || /ETF|ETN|指數|高股息|台灣50|正2|反1/i.test(text),
    is_warrant: /權證|認購|認售|牛證|熊證/i.test(text),
    is_cb: /CB|可轉債/i.test(text),
    source_date: row?.date || null,
    source: "finmind:TaiwanStockInfo",
    payload: row,
    updated_at: new Date().toISOString(),
  };
}

async function fetchRows() {
  if (!FINMIND_TOKEN) throw new Error("missing FinMind token");
  const response = await fetch("https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInfo", {
    headers: { Authorization: `Bearer ${FINMIND_TOKEN}`, "User-Agent": "FumanFinMindUniverse/1.0" },
    signal: timeoutSignal(30000),
  });
  if (!response.ok) throw new Error(`FinMind TaiwanStockInfo HTTP ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload?.data) ? payload.data : [];
}

async function upsertChunk(chunk, offset) {
  let lastError = "";
  for (let attempt = 1; attempt <= SUPABASE_UPSERT_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/finmind_stock_universe?on_conflict=symbol`, {
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
      console.warn(`Supabase finmind_stock_universe chunk offset ${offset} attempt ${attempt}/${SUPABASE_UPSERT_ATTEMPTS} failed: ${lastError}; retry in ${delayMs}ms`);
      await sleep(delayMs);
    }
  }
  throw new Error(`Supabase finmind_stock_universe chunk offset ${offset} failed after ${SUPABASE_UPSERT_ATTEMPTS} attempts: ${lastError}`);
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
  const rawRows = await fetchRows();
  const bySymbol = new Map();
  rawRows.map(normalizeRow).filter(Boolean).forEach((row) => {
    const current = bySymbol.get(row.symbol);
    if (!current || String(row.source_date || "").localeCompare(String(current.source_date || "")) >= 0) {
      bySymbol.set(row.symbol, row);
    }
  });
  const rows = [...bySymbol.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
  const written = await upsert(rows);
  console.log(JSON.stringify({ ok: true, source: "finmind:TaiwanStockInfo", rawRows: rawRows.length, normalizedRows: rows.length, written }));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exit(1);
});
