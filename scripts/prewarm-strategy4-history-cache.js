const fs = require("fs");
const path = require("path");
const scanStrategy4 = require("../api/scan-strategy4");
const fetchStocks = require("../stocks");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const STATE_DIR = process.env.FUMAN_STATE_DIR || path.join(RUNTIME_DIR, "state");
const FUGLE_HISTORY_CACHE_DIR = process.env.FUGLE_HISTORY_CACHE_DIR || path.join(RUNTIME_DIR, "cache", "fugle", "historical");
const SECRET_DIR = path.join(RUNTIME_DIR, "secrets");
const STATUS_FILE = path.join(STATE_DIR, "strategy4-history-prewarm-status.json");
const VOLUME_AVG5_FILE = path.join(RUNTIME_DIR, "cache", "strategy4-volume-avg5.json");
const BATCH_SIZE = Number(process.env.STRATEGY4_PREWARM_BATCH_SIZE || 40);
const BATCHES_PER_RUN = Number(process.env.STRATEGY4_PREWARM_BATCHES_PER_RUN || 0);
const SLEEP_MS = Number(process.env.STRATEGY4_PREWARM_SLEEP_MS || 800);
const MAX_REMAINING_MISS = Number(process.env.STRATEGY4_PREWARM_MAX_REMAINING_MISS || 2000);
const STRATEGY4_MIN_HISTORY_BARS = Number(process.env.STRATEGY4_MIN_HISTORY_BARS || 60);
const HISTORY_LOOKBACK_DAYS = Number(process.env.STRATEGY4_HISTORY_LOOKBACK_DAYS || 420);
const HISTORY_CACHE_ROWS = Number(process.env.STRATEGY4_HISTORY_CACHE_ROWS || 260);
const SUPABASE_ONLY = process.env.STRATEGY4_PREWARM_SUPABASE_ONLY !== "0";
const SUPABASE_TABLES = String(process.env.STRATEGY4_SUPABASE_HISTORY_TABLES || "strategy4_daily_ohlcv_view")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const SUPABASE_CODE_FIELDS = String(process.env.STRATEGY4_SUPABASE_HISTORY_CODE_FIELDS || "code,symbol,stock_id,data_id")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const SUPABASE_DATE_FIELDS = String(process.env.STRATEGY4_SUPABASE_HISTORY_DATE_FIELDS || "trade_date,date,trading_date")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
}

const SUPABASE_URL = (
  process.env.STRATEGY4_SUPABASE_URL
  || process.env.SUPABASE_URL
  || readText(path.join(SECRET_DIR, "strategy4-supabase-url.txt"))
  || readText(path.join(SECRET_DIR, "supabase-url.txt"))
  || "https://cpmpfhbzutkiecccekfr.supabase.co"
).replace(/\/$/, "");
const SUPABASE_KEY = process.env.STRATEGY4_SUPABASE_ANON_KEY
  || process.env.SUPABASE_ANON_KEY
  || readText(path.join(SECRET_DIR, "strategy4-supabase-anon-key.txt"))
  || readText(path.join(SECRET_DIR, "supabase-anon-key.txt"));
const FINMIND_API_TOKEN = process.env.FINMIND_API_TOKEN
  || process.env.FINMIND_TOKEN
  || readText(path.join(SECRET_DIR, "finmind-api-token.txt"))
  || readText("C:\\fuman-runtime\\secrets\\finmind-api-token.txt");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 4);
}

function cleanNumber(value) {
  return Number(String(value ?? "").replace(/[,+%]/g, "").trim()) || 0;
}

function flagTrue(value) {
  if (value === true) return true;
  const text = String(value ?? "").trim().toLowerCase();
  return text === "true" || text === "1" || text === "yes" || text === "y";
}

function isoDateDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function rocToIso(value) {
  const parts = String(value || "").split("/");
  if (parts.length !== 3) return "";
  const year = Number(parts[0]) + 1911;
  return `${year}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
}

function monthStartsBetween(from, to) {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const endMonth = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  const months = [];
  while (cursor <= endMonth) {
    months.push(`${cursor.getUTCFullYear()}/${String(cursor.getUTCMonth() + 1).padStart(2, "0")}/01`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

function historyCacheFile(code) {
  return path.join(FUGLE_HISTORY_CACHE_DIR, `${normalizeCode(code)}.json`);
}

function normalizeHistoryRow(row) {
  const date = String(row.date || row.trade_date || row.trading_date || "").slice(0, 10);
  const close = cleanNumber(row.close || row.closing_price || row.price);
  const rawVolume = cleanNumber(row.volume_lots ?? row.volumeLots ?? row.volume ?? row.trade_volume ?? row.trading_volume ?? row.Trading_Volume);
  const unit = String(row.volumeUnit || row.volume_unit || "").toLowerCase();
  const rawShares = cleanNumber(row.volume_shares ?? row.volumeShares);
  const volumeShares = rawShares || (/share|stock|股/.test(unit) ? rawVolume : (rawVolume ? rawVolume * 1000 : 0));
  const volumeLots = /share|stock|股/.test(unit) ? rawVolume / 1000 : rawVolume;
  if (!date || !close || !volumeLots) return null;
  return {
    date,
    volume: Number(volumeLots.toFixed(4)),
    volume_lots: Number(volumeLots.toFixed(4)),
    volume_shares: Number(volumeShares.toFixed(0)),
    volumeUnit: "lots",
    value: cleanNumber(row.trade_value_twd ?? row.tradeValueTwd ?? row.value ?? row.turnover ?? row.trade_value ?? row.trading_money ?? row.Trading_money),
    open: cleanNumber(row.open || row.opening_price),
    high: cleanNumber(row.high || row.max || row.highest_price),
    low: cleanNumber(row.low || row.min || row.lowest_price),
    close,
    change: cleanNumber(row.change || row.spread),
  };
}

function normalizeVolumeRow(row) {
  const date = String(row.date || row.trade_date || row.trading_date || "").slice(0, 10);
  const rawVolume = cleanNumber(row.volume_lots ?? row.volumeLots ?? row.volume ?? row.trade_volume ?? row.trading_volume ?? row.Trading_Volume);
  const unit = String(row.volumeUnit || row.volume_unit || "").toLowerCase();
  const rawShares = cleanNumber(row.volume_shares ?? row.volumeShares);
  const volumeShares = rawShares || (/share|stock|股/.test(unit) ? rawVolume : (rawVolume ? rawVolume * 1000 : 0));
  const volumeLots = /share|stock|股/.test(unit) ? rawVolume / 1000 : rawVolume;
  if (!date || !volumeLots) return null;
  return {
    date,
    volume: Number(volumeLots.toFixed(4)),
    volume_lots: Number(volumeLots.toFixed(4)),
    volume_shares: Number(volumeShares.toFixed(0)),
    volumeUnit: "lots",
  };
}

function writePrefilterVolumeCache(code, from, to, rows, source = "supabase-fugle-volume") {
  const normalizedRows = rows
    .map(normalizeVolumeRow)
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-5);
  if (normalizedRows.length < 5) return false;
  if (to && normalizedRows[normalizedRows.length - 1]?.date !== to) return false;
  fs.mkdirSync(FUGLE_HISTORY_CACHE_DIR, { recursive: true });
  fs.writeFileSync(historyCacheFile(code), `${JSON.stringify({
    code: normalizeCode(code),
    from,
    to,
    source,
    updatedAt: new Date().toISOString(),
    rows: normalizedRows,
  }, null, 2)}\n`);
  return true;
}

function writeHistoryCache(code, from, to, rows, source = "supabase-fugle", options = {}) {
  const normalizedRows = rows
    .map(normalizeHistoryRow)
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-HISTORY_CACHE_ROWS);
  const minRows = Number(options.minRows || STRATEGY4_MIN_HISTORY_BARS);
  if (normalizedRows.length < minRows) return false;
  if (to && normalizedRows[normalizedRows.length - 1]?.date !== to) return false;
  fs.mkdirSync(FUGLE_HISTORY_CACHE_DIR, { recursive: true });
  fs.writeFileSync(historyCacheFile(code), `${JSON.stringify({
    code: normalizeCode(code),
    from,
    to,
    source,
    updatedAt: new Date().toISOString(),
    rows: normalizedRows,
  }, null, 2)}\n`);
  return true;
}

function hasFreshHistoryCache(code, from, to) {
  try {
    const payload = JSON.parse(fs.readFileSync(historyCacheFile(code), "utf8"));
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    const latestDate = rows
      .map((row) => String(row.date || row.trade_date || "").slice(0, 10))
      .filter(Boolean)
      .sort()
      .at(-1) || "";
    return payload?.code === normalizeCode(code)
      && payload?.from === from
      && payload?.to === to
      && rows.length >= STRATEGY4_MIN_HISTORY_BARS
      && (!to || latestDate === to);
  } catch {
    return false;
  }
}

function historyCacheSummary(code, from, to) {
  try {
    const payload = JSON.parse(fs.readFileSync(historyCacheFile(code), "utf8"));
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    return {
      code: normalizeCode(code),
      source: String(payload?.source || ""),
      from: String(payload?.from || ""),
      to: String(payload?.to || ""),
      rows: rows.length,
      firstDate: rows[0]?.date || rows[0]?.trade_date || "",
      lastDate: rows[rows.length - 1]?.date || rows[rows.length - 1]?.trade_date || "",
      freshRange: payload?.from === from && payload?.to === to && (!to || (rows[rows.length - 1]?.date || rows[rows.length - 1]?.trade_date || "") === to),
    };
  } catch {
    return {
      code: normalizeCode(code),
      source: "",
      from: "",
      to: "",
      rows: 0,
      firstDate: "",
      lastDate: "",
      freshRange: false,
    };
  }
}

function historyCacheHasAnyRows(code) {
  try {
    const payload = JSON.parse(fs.readFileSync(historyCacheFile(code), "utf8"));
    return Array.isArray(payload?.rows) && payload.rows.length > 0;
  } catch {
    return false;
  }
}

function writeStatus(status) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATUS_FILE, `${JSON.stringify({
    ...status,
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function updateVolumeAvg5Cache(rows) {
  const cache = readJson(VOLUME_AVG5_FILE, { source: "supabase:fugle_daily_volume", byCode: {} });
  const byCode = cache.byCode && typeof cache.byCode === "object" ? cache.byCode : {};
  let updated = 0;
  rows.forEach((row) => {
    const code = normalizeCode(row.symbol || row.code || row.stock_id || row.data_id);
    const date = String(row.trade_date || row.date || row.trading_date || "").slice(0, 10);
    const volume = cleanNumber(row.volume || row.trade_volume || row.trading_volume);
    if (!/^\d{4}$/.test(code) || !date || !volume) return;
    const current = Array.isArray(byCode[code]) ? byCode[code] : [];
    const map = new Map(current.map((item) => [item.date, item]));
    map.set(date, { date, volume });
    byCode[code] = [...map.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-10);
    updated += 1;
  });
  fs.mkdirSync(path.dirname(VOLUME_AVG5_FILE), { recursive: true });
  fs.writeFileSync(VOLUME_AVG5_FILE, `${JSON.stringify({
    source: "supabase:fugle_daily_volume",
    updatedAt: new Date().toISOString(),
    byCode,
  }, null, 2)}\n`);
  return updated;
}

async function fetchSupabaseDailyVolumeRows(from, to) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; offset < 100000; offset += pageSize) {
    const url = new URL(`${SUPABASE_URL}/rest/v1/fugle_daily_volume`);
    url.searchParams.set("select", "symbol,trade_date,volume");
    url.searchParams.append("trade_date", `gte.${from}`);
    url.searchParams.append("trade_date", `lte.${to}`);
    url.searchParams.set("order", "trade_date.asc");
    const response = await fetch(url, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Accept: "application/json",
        Range: `${offset}-${offset + pageSize - 1}`,
      },
    });
    if (!response.ok) break;
    const page = await response.json();
    if (!Array.isArray(page) || !page.length) break;
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function readSupabaseSyncStatus(to) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const url = new URL(`${SUPABASE_URL}/rest/v1/fugle_daily_sync_status`);
  url.searchParams.set("select", "trade_date,source,status,finished_at,symbols_expected,symbols_loaded,missing_symbols_count,error_message,updated_at");
  url.searchParams.set("trade_date", `eq.${to}`);
  url.searchParams.set("source", "eq.fugle");
  url.searchParams.set("order", "updated_at.desc");
  url.searchParams.set("limit", "1");
  const response = await fetch(url, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) return null;
  const rows = await response.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function fetchSupabaseRows(table, codeField, dateField, codes, from, to) {
  if (!SUPABASE_URL || !SUPABASE_KEY || !table || !codeField || !dateField || !codes.length) return null;
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; offset < 100000; offset += pageSize) {
    const url = new URL(`${SUPABASE_URL}/rest/v1/${encodeURIComponent(table)}`);
    url.searchParams.set("select", "*");
    url.searchParams.set(codeField, `in.(${codes.join(",")})`);
    url.searchParams.append(dateField, `gte.${from}`);
    url.searchParams.append(dateField, `lte.${to}`);
    url.searchParams.set("order", `${dateField}.asc`);
    const response = await fetch(url, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Accept: "application/json",
        Range: `${offset}-${offset + pageSize - 1}`,
      },
    });
    if (!response.ok) return rows.length ? rows : null;
    const page = await response.json();
    if (!Array.isArray(page) || !page.length) break;
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function warmFromSupabase(stocks, from, to) {
  const codes = stocks.map((stock) => stock.code);
  for (const table of SUPABASE_TABLES) {
    for (const codeField of SUPABASE_CODE_FIELDS) {
      for (const dateField of SUPABASE_DATE_FIELDS) {
        let rows = null;
        try {
          rows = await fetchSupabaseRows(table, codeField, dateField, codes, from, to);
        } catch {
          rows = null;
        }
        if (!rows?.length) continue;
        const byCode = new Map();
        rows.forEach((row) => {
          const code = normalizeCode(row[codeField] || row.code || row.symbol || row.stock_id || row.data_id);
          if (!codes.includes(code)) return;
          if (!byCode.has(code)) byCode.set(code, []);
          byCode.get(code).push(row);
        });
        let warmed = 0;
        byCode.forEach((items, code) => {
          if (
            writeHistoryCache(code, from, to, items, `supabase:${table}`)
            || writePrefilterVolumeCache(code, from, to, items, `supabase:${table}`)
          ) warmed += 1;
        });
        if (warmed > 0) {
          return { warmed, table, codeField, dateField };
        }
      }
    }
  }
  return { warmed: 0, table: "", codeField: "", dateField: "" };
}

function normalizeFinMindHistoryRows(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return rows.map((row) => ({
    date: String(row.date || "").slice(0, 10),
    volume: cleanNumber(row.Trading_Volume),
    volumeUnit: "shares",
    value: cleanNumber(row.Trading_money),
    open: cleanNumber(row.open),
    high: cleanNumber(row.max),
    low: cleanNumber(row.min),
    close: cleanNumber(row.close),
    change: cleanNumber(row.spread),
  })).filter((row) => row.date && row.close);
}

function normalizeTpexOfficialRows(payload) {
  const table = Array.isArray(payload?.tables) ? payload.tables[0] : null;
  if (!Array.isArray(table?.data)) return [];
  return table.data.map((row) => ({
    date: rocToIso(row[0]),
    volume: cleanNumber(row[1]),
    volumeUnit: "lots",
    value: cleanNumber(row[2]) * 1000,
    open: cleanNumber(row[3]),
    high: cleanNumber(row[4]),
    low: cleanNumber(row[5]),
    close: cleanNumber(row[6]),
    change: cleanNumber(row[7]),
  })).filter((row) => row.date && row.close);
}

async function fetchFinMindHistoryRows(code, from, to) {
  if (!FINMIND_API_TOKEN) return [];
  const params = new URLSearchParams({
    dataset: "TaiwanStockPrice",
    data_id: code,
    start_date: from,
    end_date: to,
  });
  const response = await fetch(`https://api.finmindtrade.com/api/v4/data?${params.toString()}`, {
    headers: {
      Accept: "application/json",
      Referer: "https://finmindtrade.com/",
      Authorization: `Bearer ${FINMIND_API_TOKEN}`,
    },
  });
  if (!response.ok) throw new Error(`FinMind ${code} HTTP ${response.status}`);
  return normalizeFinMindHistoryRows(await response.json());
}

async function fetchTpexOfficialHistoryRows(code, from, to) {
  const byDate = new Map();
  for (const month of monthStartsBetween(from, to)) {
    const url = `https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock?code=${code}&date=${encodeURIComponent(month)}&id=&response=json`;
    let parsed = null;
    let lastError = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await fetch(url, {
          headers: {
            Accept: "application/json, text/plain, */*",
            Referer: "https://www.tpex.org.tw/",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
            "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
            "Cache-Control": "no-cache",
          },
        });
        const text = await response.text();
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (!/^\s*\{/.test(text)) throw new Error(`non-json ${text.slice(0, 24).replace(/\s+/g, " ")}`);
        parsed = JSON.parse(text);
        break;
      } catch (error) {
        lastError = error.message || String(error);
        await sleep(250 * attempt);
      }
    }
    if (!parsed) {
      console.log(`strategy4 tpex official month skipped ${code} ${month}: ${lastError}`);
      continue;
    }
    normalizeTpexOfficialRows(parsed)
      .filter((row) => row.date >= from && row.date <= to)
      .forEach((row) => byDate.set(row.date, row));
    await sleep(Math.max(120, Math.min(SLEEP_MS || 120, 500)));
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

async function warmFromFinMind(stocks, from, to) {
  if (!stocks.length) return { warmed: 0, partial: 0, failed: 0 };
  if (!FINMIND_API_TOKEN) {
    console.log("strategy4 finmind history warm skipped: missing token");
    return { warmed: 0, partial: 0, failed: 0 };
  }
  let warmed = 0;
  let partial = 0;
  let failed = 0;
  for (const stock of stocks) {
    try {
      const rows = await fetchFinMindHistoryRows(stock.code, from, to);
      const isFull = rows.length >= STRATEGY4_MIN_HISTORY_BARS;
      const written = rows.length > 0
        ? writeHistoryCache(stock.code, from, to, rows, isFull ? "finmind:TaiwanStockPrice" : "finmind:TaiwanStockPrice:partial", { minRows: isFull ? STRATEGY4_MIN_HISTORY_BARS : 1 })
        : false;
      console.log(`strategy4 finmind history warm ${stock.code}: rows ${rows.length}, written ${written}`);
      if (written && isFull) {
        warmed += 1;
      } else if (written) {
        partial += 1;
      }
    } catch (error) {
      failed += 1;
      console.log(`strategy4 finmind history warm failed ${stock.code}: ${error.message || error}`);
    }
    if (SLEEP_MS > 0) await sleep(Math.min(SLEEP_MS, 200));
  }
  return { warmed, partial, failed };
}

async function warmFromTpexOfficial(stocks, from, to) {
  if (!stocks.length) return { warmed: 0, partial: 0, skipped: 0, failed: 0 };
  let warmed = 0;
  let partial = 0;
  let skipped = 0;
  let failed = 0;
  for (const stock of stocks) {
    const market = String(stock.market || "").toUpperCase();
    if (market && market !== "TPEX" && market !== "OTC") {
      skipped += 1;
      continue;
    }
    try {
      const rows = await fetchTpexOfficialHistoryRows(stock.code, from, to);
      const isFull = rows.length >= STRATEGY4_MIN_HISTORY_BARS;
      const written = rows.length > 0
        ? writeHistoryCache(stock.code, from, to, rows, isFull ? "tpex-official" : "tpex-official:partial", { minRows: isFull ? STRATEGY4_MIN_HISTORY_BARS : 1 })
        : false;
      console.log(`strategy4 tpex official history warm ${stock.code}: rows ${rows.length}, written ${written}`);
      if (written && isFull) {
        warmed += 1;
      } else if (written) {
        partial += 1;
      }
    } catch (error) {
      failed += 1;
      console.log(`strategy4 tpex official history warm failed ${stock.code}: ${error.message || error}`);
    }
  }
  return { warmed, partial, skipped, failed };
}

function callStocksHandler() {
  return new Promise((resolve, reject) => {
    const req = { method: "GET", query: {} };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(key, value) { this.headers[key] = value; },
      status(code) { this.statusCode = code; return this; },
      json(payload) {
        if (this.statusCode >= 400) reject(new Error(payload?.error || `stocks HTTP ${this.statusCode}`));
        else resolve(payload);
      },
      end() { resolve({ ok: false, stocks: [] }); },
    };
    Promise.resolve(fetchStocks(req, res)).catch(reject);
  });
}

function callStrategy4Handler(stocks) {
  return new Promise((resolve, reject) => {
    const req = {
      method: "GET",
      query: {
        codes: stocks.map((stock) => stock.code).join(","),
        markets: stocks.map((stock) => stock.market || "").join(","),
      },
    };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(key, value) { this.headers[key] = value; },
      status(code) { this.statusCode = code; return this; },
      json(payload) {
        if (this.statusCode >= 400) reject(new Error(payload?.error || `strategy4 HTTP ${this.statusCode}`));
        else resolve(payload);
      },
      end() { resolve({ ok: false, matches: [] }); },
    };
    Promise.resolve(scanStrategy4(req, res)).catch(reject);
  });
}

function normalizeStock(row) {
  const code = normalizeCode(row.Code || row.code || row.symbol || row["證券代號"]);
  const name = String(row.Name || row.name || row["證券名稱"] || "").trim();
  const industry = String(row.industry || row.officialIndustry || row.primaryIndustry || "").trim();
  const text = `${code} ${name} ${industry}`;
  if (!/^\d{4}$/.test(code) || /^00/.test(code) || !name) return null;
  if (row.is_active === false || flagTrue(row.is_etf) || flagTrue(row.is_warrant) || flagTrue(row.is_cb) || flagTrue(row.is_blacklisted) || flagTrue(row.is_daytrade_unsuitable)) return null;
  if (/(ETF|ETN|DR|指數|台灣50|高股息|正2|反1|期貨|債|權證|認購|認售|牛證|熊證|CB|可轉債)/i.test(text)) return null;
  if (/水泥|軍工|國防|航太|漢翔|雷虎|龍德|駐龍|晟田|寶一|亞航|千附/i.test(text)) return null;
  return {
    code,
    name,
    market: String(row.Market || row.market || row["市場"] || "").trim().toUpperCase(),
    close: cleanNumber(row.ClosingPrice || row.close),
    percent: cleanNumber(row.Percent || row.percent),
    industry,
  };
}

async function fetchSupabaseUniverse() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  const rows = [];
  const pageSize = 1000;
  for (const table of ["strategy4_stock_universe_view", "stock_universe", "stock_tickers"]) {
    rows.length = 0;
    for (let offset = 0; offset < 5000; offset += pageSize) {
      const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
      url.searchParams.set("select", table === "strategy4_stock_universe_view"
        ? "symbol,name,market,industry,is_strategy4_eligible,is_active"
        : (table === "stock_universe"
          ? "symbol,name,market,industry,is_etf,is_warrant,is_cb,is_blacklisted,is_daytrade_unsuitable,is_active"
          : "symbol,name,market,stock_type,industry,is_etf,is_suspended"));
      if (table === "strategy4_stock_universe_view") {
        url.searchParams.set("is_strategy4_eligible", "eq.true");
      } else if (table === "stock_universe") {
        url.searchParams.set("is_active", "eq.true");
        url.searchParams.set("is_etf", "eq.false");
        url.searchParams.set("is_warrant", "eq.false");
        url.searchParams.set("is_cb", "eq.false");
        url.searchParams.set("is_blacklisted", "eq.false");
        url.searchParams.set("is_daytrade_unsuitable", "eq.false");
      } else {
        url.searchParams.set("stock_type", "eq.COMMONSTOCK");
        url.searchParams.set("is_etf", "eq.false");
        url.searchParams.set("is_suspended", "eq.false");
      }
      url.searchParams.set("order", "symbol.asc");
      const response = await fetch(url, {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          Accept: "application/json",
          Range: `${offset}-${offset + pageSize - 1}`,
        },
      });
      if (!response.ok) break;
      const page = await response.json();
      if (!Array.isArray(page) || !page.length) break;
      rows.push(...page);
      if (page.length < pageSize) break;
    }
    if (rows.length) {
      console.log(`strategy4 supabase ${table} prewarm universe: ${rows.length}`);
      return rows.map(normalizeStock).filter(Boolean);
    }
  }
  return [];
}

async function main() {
  const from = isoDateDaysAgo(HISTORY_LOOKBACK_DAYS);
  const to = new Date().toISOString().slice(0, 10);
  let universe = await fetchSupabaseUniverse();
  if (!universe.length) {
    const payload = await callStocksHandler();
    const rows = Array.isArray(payload) ? payload : (payload.stocks || []);
    universe = rows.map(normalizeStock).filter(Boolean);
  }
  universe = universe.sort((a, b) => a.code.localeCompare(b.code));
  const missing = universe.filter((stock) => !hasFreshHistoryCache(stock.code, from, to));
  const batchesToRun = Math.min(Math.ceil(missing.length / BATCH_SIZE), BATCHES_PER_RUN);
  const sourceCounts = {};
  const errors = [];
  let scanned = 0;
  let supabaseWarmed = 0;
  const supabaseSources = {};
  let supabaseVolumeRows = 0;
  let supabaseVolumeUpdated = 0;
  let supabaseSyncStatus = null;
  let finmindWarmed = 0;
  let finmindPartial = 0;
  let finmindFailed = 0;
  let tpexWarmed = 0;
  let tpexPartial = 0;
  let tpexSkipped = 0;
  let tpexFailed = 0;

  try {
    const syncStatus = await readSupabaseSyncStatus(to);
    supabaseSyncStatus = syncStatus;
    if (syncStatus) {
      console.log(`strategy4 supabase sync status: ${syncStatus.status} ${syncStatus.symbols_loaded || 0}/${syncStatus.symbols_expected || 0}, missing ${syncStatus.missing_symbols_count || 0}`);
      if (!["complete", "partial"].includes(String(syncStatus.status || "").toLowerCase())) {
        errors.push(`supabase sync status ${syncStatus.status || "unknown"} for ${to}`);
      }
    } else {
      console.log("strategy4 supabase sync status unavailable");
    }
  } catch (error) {
    errors.push(`supabase sync status: ${error.message || error}`);
  }

  try {
    const volumeRows = await fetchSupabaseDailyVolumeRows(isoDateDaysAgo(14), to);
    supabaseVolumeRows = volumeRows.length;
    supabaseVolumeUpdated = updateVolumeAvg5Cache(volumeRows);
    console.log(`strategy4 supabase daily volume cache updated: rows ${supabaseVolumeRows}, writes ${supabaseVolumeUpdated}`);
  } catch (error) {
    errors.push(`supabase daily volume cache: ${error.message || error}`);
  }

  console.log(`strategy4 history prewarm start: universe ${universe.length}, cache missing ${missing.length}, batches ${batchesToRun}`);
  writeStatus({
    ok: true,
    source: "strategy4-history-prewarm",
    phase: "running",
    universe: universe.length,
    missingBefore: missing.length,
    scanned: 0,
    remainingMiss: missing.length,
    errors: [],
  });

  for (let batch = 0; batch < batchesToRun; batch++) {
    const chunk = missing.slice(batch * BATCH_SIZE, batch * BATCH_SIZE + BATCH_SIZE);
    if (!chunk.length) break;
    const label = `prewarm batch ${batch + 1}/${batchesToRun} (${chunk[0].code}-${chunk[chunk.length - 1].code})`;
    console.log(`${label} start`);
    const supabaseResult = await warmFromSupabase(chunk, from, to);
    if (supabaseResult.warmed > 0) {
      supabaseWarmed += supabaseResult.warmed;
      const key = `${supabaseResult.table}.${supabaseResult.codeField}.${supabaseResult.dateField}`;
      supabaseSources[key] = (supabaseSources[key] || 0) + supabaseResult.warmed;
      console.log(`${label} supabase warmed ${supabaseResult.warmed} via ${key}`);
    }
    const stillMissing = chunk.filter((stock) => !hasFreshHistoryCache(stock.code, from, to));
    if (!stillMissing.length) {
      scanned += chunk.length;
      if (SLEEP_MS > 0) await sleep(SLEEP_MS);
      continue;
    }
    const finmindResult = await warmFromFinMind(stillMissing, from, to);
    finmindWarmed += finmindResult.warmed;
    finmindPartial += finmindResult.partial;
    finmindFailed += finmindResult.failed;
    const stillMissingAfterFinMind = stillMissing.filter((stock) => !hasFreshHistoryCache(stock.code, from, to));
    if (!stillMissingAfterFinMind.length) {
      scanned += chunk.length;
      console.log(`${label} finmind warmed ${finmindResult.warmed}; remaining 0`);
      if (SLEEP_MS > 0) await sleep(SLEEP_MS);
      continue;
    }
    const tpexResult = await warmFromTpexOfficial(stillMissingAfterFinMind, from, to);
    tpexWarmed += tpexResult.warmed;
    tpexPartial += tpexResult.partial;
    tpexSkipped += tpexResult.skipped;
    tpexFailed += tpexResult.failed;
    const stillMissingAfterTpex = stillMissingAfterFinMind.filter((stock) => !hasFreshHistoryCache(stock.code, from, to));
    if (!stillMissingAfterTpex.length) {
      scanned += chunk.length;
      console.log(`${label} tpex warmed ${tpexResult.warmed}; remaining 0`);
      if (SLEEP_MS > 0) await sleep(SLEEP_MS);
      continue;
    }
    if (SUPABASE_ONLY) {
      scanned += chunk.length;
      console.log(`${label} supabase-only: skip strategy API fallback for ${stillMissingAfterTpex.length} missing history caches`);
      if (SLEEP_MS > 0) await sleep(SLEEP_MS);
      continue;
    }
    try {
      const result = await callStrategy4Handler(stillMissingAfterTpex);
      Object.entries(result.sourceCounts || {}).forEach(([source, count]) => {
        sourceCounts[source] = (sourceCounts[source] || 0) + Number(count || 0);
      });
      (result.errors || []).forEach((error) => errors.push(`${label}: ${error}`));
      scanned += chunk.length;
      console.log(`${label} done: noData ${(result.noDataCodes || []).length}, errors ${(result.errors || []).length}`);
    } catch (error) {
      errors.push(`${label}: ${error.message || error}`);
      console.log(`${label} failed: ${error.message || error}`);
    }
    if (SLEEP_MS > 0) await sleep(SLEEP_MS);
  }

  const remainingMissingStocks = universe.filter((stock) => !hasFreshHistoryCache(stock.code, from, to));
  const remainingMissingRaw = remainingMissingStocks.map((stock) => ({
    code: stock.code,
    name: stock.name,
    market: stock.market,
    ...historyCacheSummary(stock.code, from, to),
  }));
  const insufficientHistory = remainingMissingRaw.filter((item) => item.rows > 0 && item.rows < STRATEGY4_MIN_HISTORY_BARS);
  const remainingMissing = remainingMissingRaw.filter((item) => !(item.rows > 0 && item.rows < STRATEGY4_MIN_HISTORY_BARS));
  const remainingMiss = remainingMissing.length;
  const computableUniverse = Math.max(universe.length - insufficientHistory.length, 0);
  const status = {
    ok: remainingMiss <= MAX_REMAINING_MISS,
    source: "strategy4-history-prewarm",
    phase: "complete",
    universe: universe.length,
    computableUniverse,
    missingBefore: missing.length,
    scanned,
    remainingMiss,
    rawRemainingMiss: remainingMissingRaw.length,
    insufficientHistoryCount: insufficientHistory.length,
    maxRemainingMiss: MAX_REMAINING_MISS,
    sourceCounts,
    supabaseWarmed,
    supabaseSources,
    supabaseSyncStatus,
    supabaseVolumeRows,
    supabaseVolumeUpdated,
    finmindWarmed,
    finmindPartial,
    finmindFailed,
    tpexWarmed,
    tpexPartial,
    tpexSkipped,
    tpexFailed,
    remainingMissing,
    insufficientHistory,
    errors: errors.slice(-50),
  };
  writeStatus(status);
  console.log(`strategy4 history prewarm complete: scanned ${scanned}, remainingMiss ${remainingMiss}/${computableUniverse}, insufficientHistory ${insufficientHistory.length}/${universe.length}`);
  if (!status.ok) {
    throw new Error(`Strategy4 history prewarm remaining cache miss too high: ${remainingMiss}/${MAX_REMAINING_MISS}`);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  writeStatus({
    ok: false,
    source: "strategy4-history-prewarm",
    phase: "failed",
    error: error.message || String(error),
  });
  process.exit(1);
});


