const fs = require("fs");
const path = require("path");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = String(
  process.env.SUPABASE_URL
  || process.env.FUMAN_SUPABASE_URL
  || readSecret(path.join(RUNTIME_DIR, "secrets", "supabase-url.txt"))
  || "https://cpmpfhbzutkiecccekfr.supabase.co"
).trim().replace(/\/+$/, "");
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.FUMAN_SUPABASE_SERVICE_ROLE_KEY
  || readSecret(path.join(RUNTIME_DIR, "secrets", "supabase-service-role-key.txt"));
const BATCH_SIZE = Math.max(1, Number(process.env.OFFICIAL_CHIP_SUPABASE_BATCH_SIZE || 250));
const UPSERT_ATTEMPTS = Math.max(1, Number(process.env.OFFICIAL_CHIP_UPSERT_ATTEMPTS || 4));
const UPSERT_TIMEOUT_MS = Math.max(5000, Number(process.env.OFFICIAL_CHIP_UPSERT_TIMEOUT_MS || 45000));
const REQUEST_DELAY_MS = Math.max(0, Number(process.env.OFFICIAL_CHIP_REQUEST_DELAY_MS || 500));

function readSecret(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timeoutSignal(ms) {
  return AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined;
}

function argValue(name, fallback) {
  const arg = process.argv.find((item) => item.startsWith(`${name}=`));
  return arg ? arg.slice(name.length + 1) : fallback;
}

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

function defaultStart(days = 5) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return ymd(d);
}

function parseIsoDate(value) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`invalid date ${text}`);
  return new Date(`${text}T12:00:00+08:00`);
}

function formatIsoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatTwseDate(date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

function formatTpexRocDate(date) {
  return `${String(date.getFullYear() - 1911).padStart(3, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
}

function dateRange(startDate, endDate) {
  const out = [];
  const current = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  while (current <= end) {
    const day = current.getDay();
    if (day !== 0 && day !== 6) out.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }
  return out;
}

function cleanNumber(value) {
  return Number(String(value ?? "").replace(/[,+%]/g, "").trim()) || 0;
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function cleanSymbol(value) {
  const symbol = cleanText(value);
  return /^\d{4}$/.test(symbol) ? symbol : "";
}

async function fetchJson(url, referer = "https://www.twse.com.tw/") {
  if (REQUEST_DELAY_MS > 0) await sleep(REQUEST_DELAY_MS);
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
      Accept: "application/json,text/plain,*/*",
      Referer: referer,
    },
    signal: timeoutSignal(45000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${url} HTTP ${response.status}: ${text.slice(0, 160)}`);
  return JSON.parse(text.replace(/^\uFEFF/, ""));
}

function institutionRow({ symbol, tradeDate, name, market, source, raw, foreignBuy = 0, foreignSell = 0, trustBuy = 0, trustSell = 0, dealerBuy = 0, dealerSell = 0 }) {
  const foreignNet = foreignBuy - foreignSell;
  const trustNet = trustBuy - trustSell;
  const dealerNet = dealerBuy - dealerSell;
  return {
    symbol,
    trade_date: tradeDate,
    name,
    foreign_buy: foreignBuy,
    foreign_sell: foreignSell,
    foreign_net: foreignNet,
    investment_trust_buy: trustBuy,
    investment_trust_sell: trustSell,
    investment_trust_net: trustNet,
    dealer_buy: dealerBuy,
    dealer_sell: dealerSell,
    dealer_net: dealerNet,
    total_net: foreignNet + trustNet + dealerNet,
    source,
    payload: { market, raw },
    updated_at: new Date().toISOString(),
  };
}

async function fetchTwseInstitution(date) {
  const tradeDate = formatIsoDate(date);
  const ymdKey = formatTwseDate(date);
  const payload = await fetchJson(`https://www.twse.com.tw/rwd/zh/fund/T86?date=${ymdKey}&selectType=ALLBUT0999&response=json`);
  if (payload?.stat && payload.stat !== "OK") return [];
  return (payload.data || []).map((row) => {
    const symbol = cleanSymbol(row[0]);
    if (!symbol) return null;
    return institutionRow({
      symbol,
      tradeDate,
      name: cleanText(row[1]),
      market: "TWSE",
      source: "twse:T86",
      raw: row,
      foreignBuy: cleanNumber(row[2]) + cleanNumber(row[5]),
      foreignSell: cleanNumber(row[3]) + cleanNumber(row[6]),
      trustBuy: cleanNumber(row[8]),
      trustSell: cleanNumber(row[9]),
      dealerBuy: cleanNumber(row[12]) + cleanNumber(row[15]),
      dealerSell: cleanNumber(row[13]) + cleanNumber(row[16]),
    });
  }).filter(Boolean);
}

async function fetchTpexInstitution(date) {
  const tradeDate = formatIsoDate(date);
  const rocDate = formatTpexRocDate(date);
  const payload = await fetchJson(
    `https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&se=AL&t=D&d=${encodeURIComponent(rocDate)}`,
    "https://www.tpex.org.tw/"
  );
  const table = (payload.tables || [payload]).find((item) => Array.isArray(item?.data) || Array.isArray(item?.aaData)) || payload;
  return (table.data || table.aaData || []).map((row) => {
    const symbol = cleanSymbol(row[0]);
    if (!symbol) return null;
    return institutionRow({
      symbol,
      tradeDate,
      name: cleanText(row[1]),
      market: "TPEX",
      source: "tpex:3itrade_hedge_result",
      raw: row,
      foreignBuy: cleanNumber(row[2]),
      foreignSell: cleanNumber(row[3]),
      trustBuy: cleanNumber(row[11]),
      trustSell: cleanNumber(row[12]),
      dealerBuy: cleanNumber(row[20]),
      dealerSell: cleanNumber(row[21]),
    });
  }).filter(Boolean);
}

function marginRow({ symbol, tradeDate, name, market, source, raw, marginBuy = 0, marginSell = 0, marginCashRepayment = 0, marginBalance = 0, shortSell = 0, shortBuy = 0, shortCashRepayment = 0, shortBalance = 0 }) {
  return {
    symbol,
    trade_date: tradeDate,
    name,
    margin_buy: marginBuy,
    margin_sell: marginSell,
    margin_cash_repayment: marginCashRepayment,
    margin_balance: marginBalance,
    short_sell: shortSell,
    short_buy: shortBuy,
    short_cash_repayment: shortCashRepayment,
    short_balance: shortBalance,
    source,
    payload: { market, raw },
    updated_at: new Date().toISOString(),
  };
}

async function fetchTwseMargin(date) {
  const tradeDate = formatIsoDate(date);
  const ymdKey = formatTwseDate(date);
  const payload = await fetchJson(`https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date=${ymdKey}&selectType=ALL&response=json`);
  if (payload?.stat && payload.stat !== "OK") return [];
  const table = (payload.tables || []).find((item) => String(item.title || "").includes("融資融券彙總"));
  return (table?.data || []).map((row) => {
    const symbol = cleanSymbol(row[0]);
    if (!symbol) return null;
    return marginRow({
      symbol,
      tradeDate,
      name: cleanText(row[1]),
      market: "TWSE",
      source: "twse:MI_MARGN",
      raw: row,
      marginBuy: cleanNumber(row[2]),
      marginSell: cleanNumber(row[3]),
      marginCashRepayment: cleanNumber(row[4]),
      marginBalance: cleanNumber(row[6]),
      shortBuy: cleanNumber(row[8]),
      shortSell: cleanNumber(row[9]),
      shortCashRepayment: cleanNumber(row[10]),
      shortBalance: cleanNumber(row[12]),
    });
  }).filter(Boolean);
}

async function fetchTpexMargin(date) {
  const tradeDate = formatIsoDate(date);
  const rocDate = formatTpexRocDate(date);
  const payload = await fetchJson(
    `https://www.tpex.org.tw/web/stock/margin_trading/margin_balance/margin_bal_result.php?l=zh-tw&o=json&d=${encodeURIComponent(rocDate)}&s=0,asc`,
    "https://www.tpex.org.tw/"
  );
  const table = (payload.tables || [payload]).find((item) => Array.isArray(item?.data) || Array.isArray(item?.aaData)) || payload;
  return (table.data || table.aaData || []).map((row) => {
    const symbol = cleanSymbol(row[0]);
    if (!symbol) return null;
    return marginRow({
      symbol,
      tradeDate,
      name: cleanText(row[1]),
      market: "TPEX",
      source: "tpex:margin_balance",
      raw: row,
      marginBuy: cleanNumber(row[3]),
      marginSell: cleanNumber(row[4]),
      marginCashRepayment: cleanNumber(row[5]),
      marginBalance: cleanNumber(row[6]),
      shortSell: cleanNumber(row[11]),
      shortBuy: cleanNumber(row[12]),
      shortCashRepayment: cleanNumber(row[13]),
      shortBalance: cleanNumber(row[14]),
    });
  }).filter(Boolean);
}

async function upsertTable(table, rows, onConflict) {
  if (!rows.length) return 0;
  if (!SUPABASE_SERVICE_KEY) throw new Error("missing Supabase service role key");
  let written = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    let lastError = "";
    for (let attempt = 1; attempt <= UPSERT_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
          method: "POST",
          headers: {
            apikey: SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            "Content-Type": "application/json",
            Prefer: "resolution=merge-duplicates,return=minimal",
          },
          body: JSON.stringify(chunk),
          signal: timeoutSignal(UPSERT_TIMEOUT_MS),
        });
        if (response.ok) {
          written += chunk.length;
          lastError = "";
          break;
        }
        const text = await response.text().catch(() => "");
        lastError = `HTTP ${response.status}: ${text.slice(0, 240)}`;
      } catch (error) {
        lastError = error?.message || String(error);
      }
      if (attempt < UPSERT_ATTEMPTS) {
        const delayMs = Math.min(30000, 1000 * (2 ** (attempt - 1)));
        console.warn(`Supabase ${table} chunk offset ${i} attempt ${attempt}/${UPSERT_ATTEMPTS} failed: ${lastError}; retry in ${delayMs}ms`);
        await sleep(delayMs);
      }
    }
    if (lastError) throw new Error(`Supabase ${table} chunk offset ${i} failed: ${lastError}`);
  }
  return written;
}

async function fetchSupabaseRows(table, params) {
  if (!SUPABASE_SERVICE_KEY) throw new Error("missing Supabase service role key");
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      Accept: "application/json",
    },
    signal: timeoutSignal(45000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${table} read HTTP ${response.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text || "[]");
}

async function existingFinMindKeys(table, dates) {
  if (!dates.length) return new Set();
  const rows = await fetchSupabaseRows(table, {
    select: "symbol,trade_date,source",
    trade_date: `in.(${dates.join(",")})`,
    limit: "20000",
  });
  return new Set((Array.isArray(rows) ? rows : [])
    .filter((row) => String(row.source || "").toLowerCase().startsWith("finmind:"))
    .map((row) => `${row.symbol}|${row.trade_date}`));
}

async function keepOfficialOnlyForFinMindGaps(table, rows, dates) {
  if (process.env.OFFICIAL_CHIP_RESPECT_FINMIND === "0") return { rows, skippedFinMindRows: 0 };
  const finmindKeys = await existingFinMindKeys(table, dates);
  if (!finmindKeys.size) return { rows, skippedFinMindRows: 0 };
  const filtered = rows.filter((row) => !finmindKeys.has(`${row.symbol}|${row.trade_date}`));
  return { rows: filtered, skippedFinMindRows: rows.length - filtered.length };
}

async function fetchAll(fetcher, dates, label) {
  const rows = [];
  const errors = [];
  for (const date of dates) {
    try {
      const dayRows = await fetcher(date);
      rows.push(...dayRows);
      console.log(`[official-chip] ${label} ${formatIsoDate(date)} rows=${dayRows.length}`);
    } catch (error) {
      errors.push(`${label} ${formatIsoDate(date)}: ${error.message}`);
      console.warn(`[official-chip] ${label} ${formatIsoDate(date)} skipped: ${error.message}`);
    }
  }
  return { rows, errors };
}

async function main() {
  const startDate = argValue("--start", defaultStart(Number(process.env.OFFICIAL_CHIP_LOOKBACK_DAYS || 5)));
  const endDate = argValue("--end", ymd(new Date()));
  const dates = dateRange(startDate, endDate);
  const twseInstitution = await fetchAll(fetchTwseInstitution, dates, "twse-institution");
  const tpexInstitution = await fetchAll(fetchTpexInstitution, dates, "tpex-institution");
  const twseMargin = await fetchAll(fetchTwseMargin, dates, "twse-margin");
  const tpexMargin = await fetchAll(fetchTpexMargin, dates, "tpex-margin");

  const tradeDates = dates.map(formatIsoDate);
  const institutionGap = await keepOfficialOnlyForFinMindGaps("finmind_institutional_flows", [...twseInstitution.rows, ...tpexInstitution.rows], tradeDates);
  const marginGap = await keepOfficialOnlyForFinMindGaps("finmind_margin_short", [...twseMargin.rows, ...tpexMargin.rows], tradeDates);
  const institutionRows = institutionGap.rows;
  const marginRows = marginGap.rows;
  const writtenInstitutional = await upsertTable("finmind_institutional_flows", institutionRows, "symbol,trade_date");
  const writtenMargin = await upsertTable("finmind_margin_short", marginRows, "symbol,trade_date");
  const errors = [...twseInstitution.errors, ...tpexInstitution.errors, ...twseMargin.errors, ...tpexMargin.errors];

  console.log(JSON.stringify({
    ok: errors.length === 0 || writtenInstitutional > 0 || writtenMargin > 0,
    source: "official:chip",
    startDate,
    endDate,
    tradingDates: dates.map(formatIsoDate),
    institutionalRows: institutionRows.length,
    marginRows: marginRows.length,
    skippedFinMindInstitutionalRows: institutionGap.skippedFinMindRows,
    skippedFinMindMarginRows: marginGap.skippedFinMindRows,
    writtenInstitutional,
    writtenMargin,
    errors,
    updatedAt: new Date().toISOString(),
  }));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exit(1);
});
