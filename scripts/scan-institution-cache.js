const fs = require("fs");
const path = require("path");
const scanInstitution = require("../api/institution");
const { fetchMisQuotes } = require("../lib/mis-quotes");
const { writeSummary } = require("./cache-summary");

const { ROOT, dataPath } = require("./runtime-paths");
const { chipTradeExclusion, loadChipTradeBlacklist } = require("../lib/chip-trade-exclusions");
const OUT_FILE = dataPath("institution-latest.json");
const BACKUP_FILE = dataPath("institution-backup.json");
const SUMMARY_FILE = dataPath("institution-summary.json");
const STOCK_URL = process.env.STOCK_UNIVERSE_URL || "https://fuman-terminal.vercel.app/api/stocks";
const MIN_PUBLISH_ROWS = Number(process.env.INSTITUTION_MIN_PUBLISH_ROWS || 1000);
const MAX_FALLBACK_AGE_DAYS = Number(process.env.INSTITUTION_MAX_FALLBACK_AGE_DAYS || 5);

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeInstitutionOutput(output) {
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(output, null, 2)}\n`);
  writeSummary("institution", output, SUMMARY_FILE);
  fs.writeFileSync(BACKUP_FILE, `${JSON.stringify({ ...output, source: "github-actions-backup" }, null, 2)}\n`);
}

function publishFallback(previous, reason, details = {}) {
  const previousData = previous && typeof previous.data === "object" ? previous.data : {};
  const previousCount = Object.keys(previousData).length;
  const previousAge = ageInDays(previous.usedDate);
  if (previousCount < MIN_PUBLISH_ROWS || previousAge > MAX_FALLBACK_AGE_DAYS) return false;
  const output = {
    ...previous,
    ok: true,
    source: "github-actions-fallback",
    fallbackFromPrevious: true,
    fallbackReason: reason,
    updatedAt: new Date().toISOString(),
    sourceHealth: {
      ...(previous.sourceHealth || {}),
      fallback: true,
      fallbackReason: reason,
      fallbackDetails: details,
      previousUpdatedAt: previous.updatedAt || "",
      previousUsedDate: previous.usedDate || "",
      previousCount,
      previousAgeDays: previousAge,
    },
    count: previousCount,
    data: previousData,
  };
  writeInstitutionOutput(output);
  console.warn(`institution fallback published from previous cache: rows ${previousCount}, usedDate ${output.usedDate || "--"}, reason ${reason}`);
  return true;
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

function formatTwseDate(date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

function formatTpexDate(date) {
  return `${String(date.getFullYear() - 1911).padStart(3, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
}

function recentTradingDates(limit = 8) {
  const dates = [];
  const date = new Date();
  date.setDate(date.getDate() - 1);
  for (let i = 0; dates.length < limit && i < 18; i++) {
    const day = date.getDay();
    if (day !== 0 && day !== 6) dates.push(new Date(date));
    date.setDate(date.getDate() - 1);
  }
  return dates;
}

function signedChange(sign, value) {
  const amount = cleanNumber(value);
  const text = String(sign || "");
  if (text.includes("-") || text.includes("color:green")) return -Math.abs(amount);
  if (text.includes("+") || text.includes("color:red")) return Math.abs(amount);
  return amount;
}

function collectTradingMetric(bucket, code, close, change, volume) {
  if (!/^\d{4}$/.test(code) || close <= 0 || volume <= 0) return;
  const prevClose = close - change;
  const pct = prevClose > 0 ? (change / prevClose) * 100 : 0;
  const list = bucket.get(code) || [];
  list.push({ pct, volume });
  bucket.set(code, list);
}

async function fetchHistoricalTradingMetrics() {
  const bucket = new Map();
  const warnings = [];
  for (const date of recentTradingDates()) {
    try {
      const tradeDate = formatTwseDate(date);
      const payload = await fetchJson(`https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${tradeDate}&type=ALLBUT0999&response=json`, 25000);
      const table = (payload.tables || []).find((item) => String(item.title || "").includes("每日收盤行情"));
      const fields = table?.fields || [];
      const data = table?.data || [];
      const codeIndex = fields.findIndex((field) => String(field).includes("證券代號"));
      const closeIndex = fields.findIndex((field) => String(field).includes("收盤價"));
      const signIndex = fields.findIndex((field) => String(field).includes("漲跌(+/-)"));
      const changeIndex = fields.findIndex((field) => String(field).includes("漲跌價差"));
      const volumeIndex = fields.findIndex((field) => String(field).includes("成交股數"));
      if (codeIndex >= 0 && closeIndex >= 0 && changeIndex >= 0 && volumeIndex >= 0) {
        data.forEach((row) => collectTradingMetric(
          bucket,
          String(row[codeIndex] || "").trim(),
          cleanNumber(row[closeIndex]),
          signedChange(signIndex >= 0 ? row[signIndex] : "", row[changeIndex]),
          cleanNumber(row[volumeIndex])
        ));
      }
    } catch (error) {
      warnings.push(`twse 5-day metrics failed: ${formatTwseDate(date)} :: ${error.message}`);
    }
    try {
      const tradeDate = formatTpexDate(date);
      const payload = await fetchJson(`https://www.tpex.org.tw/web/stock/aftertrading/daily_close_quotes/stk_quote_result.php?l=zh-tw&o=json&d=${encodeURIComponent(tradeDate)}&s=0,asc,0`, 25000);
      const table = (payload.tables || []).find((item) => (item.data || []).length);
      const fields = table?.fields || [];
      const data = table?.data || [];
      const codeIndex = fields.findIndex((field) => String(field).includes("代號"));
      const closeIndex = fields.findIndex((field) => String(field).includes("收盤"));
      const changeIndex = fields.findIndex((field) => String(field).includes("漲跌"));
      const volumeIndex = fields.findIndex((field) => String(field).includes("成交股數"));
      if (codeIndex >= 0 && closeIndex >= 0 && changeIndex >= 0 && volumeIndex >= 0) {
        data.forEach((row) => collectTradingMetric(
          bucket,
          String(row[codeIndex] || "").trim(),
          cleanNumber(row[closeIndex]),
          cleanNumber(row[changeIndex]),
          cleanNumber(row[volumeIndex])
        ));
      }
    } catch (error) {
      warnings.push(`tpex 5-day metrics failed: ${formatTpexDate(date)} :: ${error.message}`);
    }
  }
  const map = new Map();
  bucket.forEach((values, code) => {
    const usable = values.slice(0, 5);
    if (!usable.length) return;
    const fiveDayPctSum = usable.reduce((sum, item) => sum + item.pct, 0);
    const fiveDayAvgVolume = usable.reduce((sum, item) => sum + item.volume, 0) / usable.length;
    map.set(code, {
      fiveDayPctSum: Number(fiveDayPctSum.toFixed(2)),
      fiveDayAvgVolume: Math.round(fiveDayAvgVolume),
    });
  });
  return { map, warnings };
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

function enrichInstitutionData(data, quoteMap, tradingMetricMap = new Map()) {
  const output = {};
  for (const [code, row] of Object.entries(data || {})) {
    const quote = quoteMap.get(code) || {};
    const metrics = tradingMetricMap.get(code) || {};
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
      fiveDayPctSum: Number.isFinite(Number(row.fiveDayPctSum)) ? Number(row.fiveDayPctSum) : (metrics.fiveDayPctSum || 0),
      fiveDayAvgVolume: cleanNumber(row.fiveDayAvgVolume) || metrics.fiveDayAvgVolume || 0,
    };
  }
  return output;
}

async function main() {
  const previous = readJson(OUT_FILE, readJson(BACKUP_FILE, { ok: true, data: {} }));
  const [payload, stockPayload, tradingMetricResult] = await Promise.all([runHandler(), runStocksHandler(), fetchHistoricalTradingMetrics()]);
  if ((payload.errors || []).length) {
    console.warn(`institution source warnings: ${(payload.errors || []).join(" | ")}`);
  }
  const stockRows = Array.isArray(stockPayload?.stocks) ? stockPayload.stocks.length : 0;
  if (!stockPayload?.ok || stockRows < 100) {
    console.warn(`stock universe quote enrichment weak: ok=${Boolean(stockPayload?.ok)}, rows=${stockRows}`);
  }
  const quoteMap = buildQuoteMap(stockPayload);
  const misQuotes = await fetchMisQuotes(Object.keys(payload.data || {}));
  if (!misQuotes.size) {
    console.warn("MIS quote enrichment returned 0 rows; institution rows will still be guarded by official source freshness");
  }
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
  tradingMetricResult.warnings.forEach((warning) => console.warn(`institution metric warning: ${warning}`));
  const enrichedData = enrichInstitutionData(payload.data || {}, quoteMap, tradingMetricResult.map);
  const blacklistCodes = loadChipTradeBlacklist();
  const data = {};
  const excludedCounts = {};
  for (const [code, row] of Object.entries(enrichedData)) {
    const exclusion = chipTradeExclusion(row, blacklistCodes);
    if (exclusion.excluded) {
      for (const reason of exclusion.reasons) excludedCounts[reason] = (excludedCounts[reason] || 0) + 1;
      continue;
    }
    data[code] = row;
  }
  const count = Object.keys(data).length;
  const output = {
    ...payload,
    ok: true,
    source: "github-actions",
    updatedAt: new Date().toISOString(),
    quoteUpdatedAt: stockPayload?.updatedAt || "",
    sourceHealth: {
      fiveDayMetricCount: tradingMetricResult.map.size,
      excludedBeforePublish: Object.values(excludedCounts).reduce((sum, value) => sum + value, 0),
      excludedCounts,
      warningCount: tradingMetricResult.warnings.length,
      warnings: tradingMetricResult.warnings.slice(0, 8),
    },
    count,
    data,
  };

  const dataAge = ageInDays(output.usedDate);
  if (count < MIN_PUBLISH_ROWS) {
    const reason = `scan returned too few rows (${count})`;
    if (publishFallback(previous, reason, { count, minimum: MIN_PUBLISH_ROWS, warnings: tradingMetricResult.warnings.slice(0, 8) })) return;
    console.error(`institution cache ${reason}; no acceptable fallback cache available`);
    process.exit(2);
  }
  if (dataAge > 3) {
    const reason = `scan stale: usedDate ${output.usedDate || "--"}, age ${dataAge} days`;
    if (publishFallback(previous, reason, { usedDate: output.usedDate || "", ageDays: dataAge })) return;
    console.error(`institution cache is stale: usedDate ${output.usedDate || "--"}, age ${dataAge} days; no acceptable fallback cache available`);
    process.exit(2);
  }

  writeInstitutionOutput(output);
  console.log(`institution cache updated: rows ${count}, usedDate ${output.usedDate || "--"}, stockRows ${stockRows}, misQuotes ${misQuotes.size}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

