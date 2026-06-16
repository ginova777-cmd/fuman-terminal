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
const REQUEST_DELAY_MS = Math.max(0, Number(process.env.FINMIND_KBAR_REQUEST_DELAY_MS || 250));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timeoutSignal(ms) {
  return AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined;
}

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

function dateRange(startDate, endDate) {
  const out = [];
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return out;
  for (const d = start; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(ymd(d));
  }
  return out;
}

function defaultStart(days = 2) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return ymd(d);
}

function argValue(name, fallback) {
  const arg = process.argv.find((item) => item.startsWith(`${name}=`));
  return arg ? arg.slice(name.length + 1) : fallback;
}

function number(value) {
  const n = Number(String(value ?? "").replace(/[,+%]/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function normalizeCode(value) {
  const text = String(value || "").trim();
  return /^\d{4}$/.test(text) ? text : "";
}

function parseCodes() {
  const codesArg = argValue("--codes", process.env.FINMIND_KBAR_CODES || "");
  if (codesArg) {
    return [...new Set(codesArg.split(",").map((item) => normalizeCode(item)).filter(Boolean))];
  }
  const file = process.env.FINMIND_KBAR_CODES_FILE || path.join(RUNTIME_DIR, "config", "finmind-kbar-fallback-codes.txt");
  const text = readSecret(file);
  return [...new Set(text.split(/[\s,]+/).map((item) => normalizeCode(item)).filter(Boolean))];
}

function toTaipeiIso(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const normalized = text.includes("T") ? text : text.replace(" ", "T");
  const date = new Date(`${normalized}+08:00`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function normalizeRow(row, code) {
  const symbol = normalizeCode(row?.stock_id || row?.symbol || code);
  const dateText = String(row?.date || "").slice(0, 10);
  const minuteText = String(row?.minute || "").trim();
  const candleTime = toTaipeiIso(minuteText ? `${dateText} ${minuteText}` : (row?.date || row?.datetime || row?.time));
  if (!symbol || !candleTime) return null;
  const tradeDate = candleTime.slice(0, 10);
  const volumeLots = number(row.volume_lots ?? row.volume ?? row.Volume);
  return {
    symbol,
    candle_time: candleTime,
    trade_date: tradeDate,
    open: number(row.open) || null,
    high: number(row.max ?? row.high) || null,
    low: number(row.min ?? row.low) || null,
    close: number(row.close) || null,
    volume: volumeLots,
    volume_shares: volumeLots * 1000,
    source: "finmind:TaiwanStockKBar",
    payload: row,
    updated_at: new Date().toISOString(),
  };
}

async function fetchKbar(code, date) {
  if (!FINMIND_TOKEN) throw new Error("missing FinMind token");
  const url = new URL("https://api.finmindtrade.com/api/v4/data");
  url.searchParams.set("dataset", "TaiwanStockKBar");
  url.searchParams.set("data_id", code);
  url.searchParams.set("start_date", date);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${FINMIND_TOKEN}`, "User-Agent": "FumanFinMindKBar/1.0" },
    signal: timeoutSignal(120000),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`FinMind TaiwanStockKBar ${code} ${date} HTTP ${response.status}: ${text.slice(0, 180)}`);
  }
  const payload = await response.json();
  if (payload?.status && Number(payload.status) >= 400) throw new Error(`FinMind TaiwanStockKBar ${code} status ${payload.status}: ${payload.msg || ""}`);
  return Array.isArray(payload?.data) ? payload.data : [];
}

async function upsert(rows) {
  if (!rows.length) return 0;
  if (!SUPABASE_SERVICE_KEY) throw new Error("missing Supabase service role key");
  let written = 0;
  for (let i = 0; i < rows.length; i += SUPABASE_BATCH_SIZE) {
    const chunk = rows.slice(i, i + SUPABASE_BATCH_SIZE);
    let lastError = "";
    for (let attempt = 1; attempt <= SUPABASE_UPSERT_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/finmind_intraday_1m?on_conflict=symbol,candle_time`, {
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
        if (response.ok) {
          written += chunk.length;
          lastError = "";
          break;
        }
        const text = await response.text().catch(() => "");
        lastError = `HTTP ${response.status}: ${text.slice(0, 200)}`;
      } catch (error) {
        lastError = error?.message || String(error);
      }
      if (attempt < SUPABASE_UPSERT_ATTEMPTS) {
        const delayMs = Math.min(30000, 1000 * (2 ** (attempt - 1)));
        console.warn(`Supabase finmind_intraday_1m chunk offset ${i} attempt ${attempt}/${SUPABASE_UPSERT_ATTEMPTS} failed: ${lastError}; retry in ${delayMs}ms`);
        await sleep(delayMs);
      }
    }
    if (lastError) throw new Error(`Supabase finmind_intraday_1m chunk offset ${i} failed: ${lastError}`);
  }
  return written;
}

async function main() {
  const startDate = argValue("--start", defaultStart(Number(process.env.FINMIND_KBAR_LOOKBACK_DAYS || 2)));
  const endDate = argValue("--end", ymd(new Date()));
  const codes = parseCodes();
  if (!codes.length) {
    throw new Error("missing kbar fallback codes; pass --codes=2330,2454 or set FINMIND_KBAR_CODES");
  }
  const maxCodes = Math.max(1, Number(process.env.FINMIND_KBAR_MAX_CODES || 80));
  const selected = codes.slice(0, maxCodes);
  let allRows = [];
  const summary = {};
  const dates = dateRange(startDate, endDate);
  for (const code of selected) {
    summary[code] = { rawRows: 0, normalizedRows: 0, dates: {} };
    for (const date of dates) {
      const rawRows = await fetchKbar(code, date).catch((error) => {
        console.warn(`FinMind TaiwanStockKBar ${code} ${date} skipped: ${error.message}`);
        return [];
      });
      const rows = rawRows.map((row) => normalizeRow(row, code)).filter(Boolean);
      summary[code].rawRows += rawRows.length;
      summary[code].normalizedRows += rows.length;
      summary[code].dates[date] = { rawRows: rawRows.length, normalizedRows: rows.length };
      allRows = allRows.concat(rows);
      if (REQUEST_DELAY_MS) await sleep(REQUEST_DELAY_MS);
    }
  }
  const written = await upsert(allRows);
  console.log(JSON.stringify({
    ok: true,
    source: "finmind:TaiwanStockKBar",
    startDate,
    endDate,
    requestedCodes: codes.length,
    selectedCodes: selected.length,
    normalizedRows: allRows.length,
    written,
    summary,
    updatedAt: new Date().toISOString(),
  }));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exit(1);
});
