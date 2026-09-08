const fs = require("fs");
const path = require("path");

const DEFAULT_SUPABASE_URL = "https://cpmpfhbzutkiecccekfr.supabase.co";
const OFFICIAL_SOURCES = [
  { market: "TWSE", code: "L", url: "https://mopsfin.twse.com.tw/opendata/t187ap03_L.csv" },
  { market: "TPEX", code: "O", url: "https://mopsfin.twse.com.tw/opendata/t187ap03_O.csv" },
];

const MOPS_INDUSTRY_NAMES = {
  "01": "水泥工業", "02": "食品工業", "03": "塑膠工業", "04": "紡織纖維",
  "05": "電機機械", "06": "電器電纜", "08": "玻璃陶瓷", "09": "造紙工業",
  "10": "鋼鐵工業", "11": "橡膠工業", "12": "汽車工業", "14": "建材營造",
  "15": "航運業", "16": "觀光餐旅", "17": "金融保險", "18": "貿易百貨",
  "20": "其他", "21": "化學工業", "22": "生技醫療", "23": "油電燃氣",
  "24": "半導體", "25": "電腦及週邊", "26": "光電", "27": "通信網路",
  "28": "電子零組件", "29": "電子通路", "30": "資訊服務", "31": "其他電子",
  "32": "文化創意", "33": "農業科技", "34": "電子商務", "35": "綠能環保",
  "36": "數位雲端", "37": "運動休閒", "38": "居家生活", "91": "存託憑證",
};

function runtimeRoot() {
  return process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
}

function supabaseUrl() {
  return (process.env.SUPABASE_URL || process.env.FUMAN_SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/+$/, "");
}

function readText(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

function serviceRoleKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.FUMAN_SUPABASE_SERVICE_ROLE_KEY
    || readText(path.join(runtimeRoot(), "secrets", "supabase-service-role-key.txt"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  let lastError;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      fs.writeFileSync(file, serialized, "utf8");
      return;
    } catch (error) {
      lastError = error;
      if (!["EPERM", "EACCES", "EBUSY"].includes(String(error?.code || "")) || attempt === 8) break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 75 * attempt);
    }
  }
  throw lastError;
}

function objectValue(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch { return {}; }
  }
  return {};
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const source = String(text || "");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (char === '"' && quoted && next === '"') { cell += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((char === "\r" || char === "\n") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => String(value).trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  if (!rows.length) return [];
  const fields = rows[0].map((value) => String(value).replace(/^\uFEFF/, "").trim());
  return rows.slice(1).map((values) => Object.fromEntries(fields.map((field, index) => [field, String(values[index] || "").trim()])));
}

function rocDateToIso(value) {
  const compact = String(value || "").replace(/\D/g, "");
  if (!/^\d{7}$/.test(compact)) return "";
  const year = Number(compact.slice(0, 3)) + 1911;
  return `${year}-${compact.slice(3, 5)}-${compact.slice(5, 7)}`;
}

async function fetchWithRetry(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; FumanStockMasterSync/1.0)" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    } finally { clearTimeout(timer); }
  }
  throw new Error(`${url}: ${lastError?.message || lastError}`);
}

async function fetchOfficialStockMaster() {
  const settled = await Promise.all(OFFICIAL_SOURCES.map(async (source) => {
    const csv = await fetchWithRetry(source.url);
    const parsed = parseCsv(csv);
    const rows = parsed.map((row) => {
      const symbol = String(row["公司代號"] || "").trim();
      if (!/^\d{4}$/.test(symbol)) return null;
      const industryCode = String(row["產業別"] || "").trim();
      return {
        symbol,
        name: String(row["公司簡稱"] || row["公司名稱"] || "").trim(),
        full_name: String(row["公司名稱"] || "").trim(),
        market: source.market,
        industry_code: industryCode,
        industry: MOPS_INDUSTRY_NAMES[industryCode] || industryCode,
        listing_date: String(row["上市日期"] || row["上櫃日期"] || "").trim(),
        issued_common_shares: Number(String(row["已發行普通股數或TDR原股發行股數"] || "0").replace(/,/g, "")) || 0,
        source_date: rocDateToIso(row["出表日期"]),
        source_url: source.url,
      };
    }).filter(Boolean);
    if (rows.length < 500) throw new Error(`${source.market} official rows unexpectedly low: ${rows.length}`);
    return { ...source, rows };
  }));

  const bySymbol = new Map();
  for (const source of settled) {
    for (const row of source.rows) {
      if (bySymbol.has(row.symbol)) throw new Error(`duplicate official symbol ${row.symbol}`);
      bySymbol.set(row.symbol, row);
    }
  }
  const rows = [...bySymbol.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
  if (rows.length < 1900) throw new Error(`official stock master incomplete: ${rows.length}`);
  return {
    rows,
    sources: settled.map((source) => ({ market: source.market, url: source.url, rows: source.rows.length, source_date: source.rows[0]?.source_date || "" })),
  };
}

function authHeaders(key, extra = {}) {
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra };
}

async function supabaseGetPaged(table, select, options = {}) {
  const key = options.key || serviceRoleKey();
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing");
  const pageSize = options.pageSize || 1000;
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const query = new URLSearchParams({ select, order: "symbol.asc", limit: String(pageSize), offset: String(offset) });
    const response = await fetch(`${supabaseUrl()}/rest/v1/${table}?${query}`, {
      headers: authHeaders(key),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`${table} read HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const page = await response.json();
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function upsertStockTickers(rows, options = {}) {
  const key = options.key || serviceRoleKey();
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing");
  const batchSize = options.batchSize || 250;
  let written = 0;
  for (let index = 0; index < rows.length; index += batchSize) {
    const chunk = rows.slice(index, index + batchSize);
    const response = await fetch(`${supabaseUrl()}/rest/v1/stock_tickers?on_conflict=symbol`, {
      method: "POST",
      headers: authHeaders(key, {
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      }),
      body: JSON.stringify(chunk),
      signal: AbortSignal.timeout(45000),
    });
    if (!response.ok) throw new Error(`stock_tickers upsert HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
    written += chunk.length;
  }
  return written;
}

function normalizeMarket(value) {
  const text = String(value || "").trim().toUpperCase();
  if (text === "TSE") return "TWSE";
  if (text === "OTC") return "TPEX";
  return text;
}

function buildTickerRows(officialRows, existingRows, runId, updatedAt) {
  const existing = new Map(existingRows.map((row) => [String(row.symbol || ""), row]));
  return officialRows.map((row) => {
    const prior = existing.get(row.symbol) || {};
    const isTdr = /-DR$/i.test(row.name) || row.industry_code === "91";
    const payload = {
      ...objectValue(prior.payload),
      stock_master_contract: "mops_official_stock_master_v1",
      stock_master_source: "MOPS_OPEN_DATA_TWSE_TPEX",
      stock_master_source_date: row.source_date,
      stock_master_synced_at: updatedAt,
      stock_master_run_id: runId,
      blacklist_applied: false,
      official_present: true,
      official_market: row.market,
      official_industry_code: row.industry_code,
      official_listing_date: row.listing_date,
      official_issued_common_shares: row.issued_common_shares,
      scanner_eligibility_separate_from_master: true,
    };
    return {
      symbol: row.symbol,
      name: row.name,
      market: row.market,
      stock_type: isTdr ? "TDR" : "COMMONSTOCK",
      industry: row.industry,
      type: isTdr ? "dr" : "stock",
      is_etf: false,
      is_suspended: prior.is_suspended === true,
      updated_at: updatedAt,
      payload,
    };
  });
}

function compareOfficialToReadback(officialRows, tickerRows, universeRows) {
  const tickerMap = new Map(tickerRows.map((row) => [String(row.symbol || ""), row]));
  const universeMap = new Map(universeRows.map((row) => [String(row.symbol || ""), row]));
  const missingTickers = [];
  const missingUniverse = [];
  const nameMismatch = [];
  const marketMismatch = [];
  const industryMismatch = [];
  for (const official of officialRows) {
    const ticker = tickerMap.get(official.symbol);
    const universe = universeMap.get(official.symbol);
    if (!ticker) missingTickers.push(official.symbol);
    if (!universe) missingUniverse.push(official.symbol);
    if (!ticker) continue;
    if (String(ticker.name || "").trim() !== official.name) nameMismatch.push({ symbol: official.symbol, expected: official.name, actual: ticker.name || "" });
    if (normalizeMarket(ticker.market) !== official.market) marketMismatch.push({ symbol: official.symbol, expected: official.market, actual: ticker.market || "" });
    if (String(ticker.industry || "").trim() !== official.industry) industryMismatch.push({ symbol: official.symbol, expected: official.industry, actual: ticker.industry || "" });
  }
  return { tickerMap, universeMap, missingTickers, missingUniverse, nameMismatch, marketMismatch, industryMismatch };
}

module.exports = {
  DEFAULT_SUPABASE_URL,
  OFFICIAL_SOURCES,
  MOPS_INDUSTRY_NAMES,
  runtimeRoot,
  serviceRoleKey,
  writeJson,
  fetchOfficialStockMaster,
  supabaseGetPaged,
  upsertStockTickers,
  buildTickerRows,
  compareOfficialToReadback,
  normalizeMarket,
};
