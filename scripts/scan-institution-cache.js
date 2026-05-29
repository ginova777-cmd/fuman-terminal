const fs = require("fs");
const path = require("path");
const scanInstitution = require("../api/institution");
const { fetchMisQuotes } = require("../lib/mis-quotes");

const { ROOT, dataPath } = require("./runtime-paths");
const OUT_FILE = dataPath("institution-latest.json");
const BACKUP_FILE = dataPath("institution-backup.json");
const STOCK_URL = process.env.STOCK_UNIVERSE_URL || "https://fuman-terminal.vercel.app/api/stocks";

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function ymdToDate(ymd) {
  const text = String(ymd || "");
  if (!/^\d{8}$/.test(text)) return null;
  return new Date(`${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T00:00:00+08:00`);
}

function taipeiDateOnly() {
  const text = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return new Date(`${text}T00:00:00+08:00`);
}

function ageInDays(ymd) {
  const date = ymdToDate(ymd);
  if (!date) return Infinity;
  return Math.floor((taipeiDateOnly() - date) / 86400000);
}

function runHandler() {
  return new Promise((resolve, reject) => {
    const req = { method: "GET", query: {} };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(key, value) { this.headers[key] = value; },
      status(code) { this.statusCode = code; return this; },
      json(payload) {
        if (this.statusCode >= 400) reject(new Error(payload?.error || `HTTP ${this.statusCode}`));
        else resolve(payload);
      },
      end() { resolve({ ok: false, data: {} }); },
    };
    Promise.resolve(scanInstitution(req, res)).catch(reject);
  });
}

async function fetchJson(url, timeout = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FumanTerminalBot/1.0)",
        Accept: "application/json,text/plain,*/*",
      },
    });
    if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function runStocksHandler() {
  try {
    return await fetchJson(STOCK_URL, 30000);
  } catch (error) {
    console.log(`stock universe fetch failed: ${error.message}`);
    return { ok: false, stocks: [] };
  }
}

function cleanNumber(value) {
  return Number(String(value ?? "").replace(/[,+%]/g, "").trim()) || 0;
}

function buildQuoteMap(payload) {
  const rows = Array.isArray(payload?.stocks) ? payload.stocks : [];
  const map = new Map();
  for (const row of rows) {
    const code = String(row.Code || row.code || "").trim();
    if (!/^\d{4}$/.test(code)) continue;
    const close = cleanNumber(row.ClosingPrice || row.close);
    const change = cleanNumber(row.Change || row.change);
    const tradeVolume = cleanNumber(row.TradeVolume || row.tradeVolume);
    const value = cleanNumber(row.TradeValue || row.value);
    const previous = close - change;
    const percent = previous ? (change / previous) * 100 : cleanNumber(row.Percent || row.percent);
    map.set(code, {
      code,
      name: String(row.Name || row.name || "").trim(),
      close,
      change,
      percent: Number(percent.toFixed ? percent.toFixed(2) : percent) || 0,
      tradeVolume,
      value,
      market: row.Market || row.market || "",
    });
  }
  return map;
}

function enrichInstitutionData(data, quoteMap) {
  const output = {};
  for (const [code, row] of Object.entries(data || {})) {
    const quote = quoteMap.get(code) || {};
    output[code] = {
      ...row,
      code,
      name: row.name || quote.name || code,
      close: cleanNumber(row.close) || quote.close || 0,
      change: Number.isFinite(Number(row.change)) ? Number(row.change) : (quote.change || 0),
      percent: Number.isFinite(Number(row.percent)) ? Number(row.percent) : (quote.percent || 0),
      tradeVolume: cleanNumber(row.tradeVolume) || quote.tradeVolume || 0,
      value: cleanNumber(row.value) || quote.value || 0,
      quoteMarket: row.quoteMarket || quote.market || "",
    };
  }
  return output;
}

async function main() {
  const backup = readJson(BACKUP_FILE, { ok: true, data: {} });
  const [payload, stockPayload] = await Promise.all([runHandler(), runStocksHandler()]);
  const quoteMap = buildQuoteMap(stockPayload);
  const misQuotes = await fetchMisQuotes(Object.keys(payload.data || {}));
  misQuotes.forEach((quote, code) => quoteMap.set(code, {
    code,
    name: quote.name,
    close: quote.close,
    change: quote.change,
    percent: Number(quote.percent.toFixed(2)),
    tradeVolume: quote.tradeVolume,
    value: quote.value,
    market: quote.market,
  }));
  const data = enrichInstitutionData(payload.data || {}, quoteMap);
  const count = Object.keys(data).length;
  const output = {
    ...payload,
    ok: true,
    source: "github-actions",
    updatedAt: new Date().toISOString(),
    quoteUpdatedAt: stockPayload?.updatedAt || "",
    count,
    data,
  };

  const dataAge = ageInDays(output.usedDate);
  if (!count) {
    console.error("institution cache scan returned 0 rows; keeping existing cache files unchanged");
    process.exit(2);
  }
  if (dataAge > 3) {
    console.error(`institution cache is stale: usedDate ${output.usedDate || "--"}, age ${dataAge} days; keeping existing cache files unchanged`);
    process.exit(2);
  }

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(output, null, 2)}\n`);
  fs.writeFileSync(BACKUP_FILE, `${JSON.stringify({ ...output, source: "github-actions-backup" }, null, 2)}\n`);
  console.log(`institution cache updated: rows ${count}, usedDate ${output.usedDate || "--"}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

