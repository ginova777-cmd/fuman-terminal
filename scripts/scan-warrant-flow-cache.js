const fs = require("fs");
const path = require("path");
const scanWarrantFlow = require("../api/scan-warrant-flow");
const { writeSummary } = require("./cache-summary");

const { ROOT, dataPath } = require("./runtime-paths");
const OUT_FILE = dataPath("warrant-flow-latest.json");
const BACKUP_FILE = dataPath("warrant-flow-backup.json");
const SUMMARY_FILE = dataPath("warrant-flow-summary.json");
const STOCK_QUOTES_FILE = dataPath("stocks-quotes-slim.json");

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function runHandler() {
  return new Promise((resolve, reject) => {
    const req = { method: "GET", query: {} };
    const res = {
      statusCode: 200,
      setHeader() {},
      status(code) { this.statusCode = code; return this; },
      json(payload) {
        if (this.statusCode >= 400) reject(new Error(payload?.error || `HTTP ${this.statusCode}`));
        else resolve(payload);
      },
      end() { resolve({ ok: false, matches: [] }); },
    };
    Promise.resolve(scanWarrantFlow(req, res)).catch(reject);
  });
}

function cleanNumber(value) {
  return Number(String(value ?? "").replace(/[,+%]/g, "").trim()) || 0;
}

function stockCodeOf(item) {
  return String(item?.code || item?.Code || item?.["證券代號"] || "").trim();
}

function loadStockQuoteMap() {
  const payload = readJson(STOCK_QUOTES_FILE, {});
  const rows = [
    ...(Array.isArray(payload?.quotes) ? payload.quotes : []),
    ...(Array.isArray(payload?.stocks) ? payload.stocks : []),
    ...(Array.isArray(payload?.rows) ? payload.rows : []),
  ];
  return new Map(rows.map((item) => [stockCodeOf(item), item]).filter(([code]) => code));
}

function tradeDateToDate(value) {
  const text = String(value || "").trim();
  let match = text.match(/^(\d{3})(\d{2})(\d{2})$/);
  if (match) return new Date(`${1911 + Number(match[1])}-${match[2]}-${match[3]}T00:00:00+08:00`);
  match = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (match) return new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00+08:00`);
  match = text.match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
  if (match) return new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00+08:00`);
  return null;
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

function ageInDaysFromTradeDate(value) {
  const date = tradeDateToDate(value);
  if (!date) return Infinity;
  return Math.floor((taipeiDateOnly() - date) / 86400000);
}
function normalizeMatch(item, quoteMap = new Map()) {
  const code = String(item.underlyingCode || item.code || "").trim();
  const name = String(item.underlyingName || item.name || "").trim();
  const quote = quoteMap.get(code) || {};
  const quoteClose = cleanNumber(quote.close ?? quote.ClosingPrice ?? quote.z);
  const quotePercent = Number(quote.percent ?? quote.pct ?? quote.Percent ?? NaN);
  const close = quoteClose || cleanNumber(item.underlyingClose ?? item.close ?? item.stockClose);
  const percentRaw = item.underlyingPercent ?? item.percent ?? item.stockPercent;
  const percent = Number.isFinite(quotePercent)
    ? quotePercent
    : Number.isFinite(Number(percentRaw)) ? Number(percentRaw) : 0;
  return {
    ...item,
    code,
    name,
    close,
    percent,
    quoteDate: quote.quoteDate || quote.tradeDate || quote.TradeDate || item.quoteDate || "",
    displayClose: close,
    displayPercent: percent,
    underlyingCode: code,
    underlyingName: name,
    underlyingClose: close,
    underlyingPercent: percent,
  };
}

function normalizeSingleSignal(item, quoteMap = new Map()) {
  const code = String(item.underlyingCode || item.code || "").trim();
  const quote = quoteMap.get(code) || {};
  const quoteClose = cleanNumber(quote.close ?? quote.ClosingPrice ?? quote.z);
  const quotePercent = Number(quote.percent ?? quote.pct ?? quote.Percent ?? NaN);
  const close = quoteClose || cleanNumber(item.underlyingClose ?? item.close ?? item.stockClose);
  const percentRaw = item.underlyingPercent ?? item.percent ?? item.stockPercent;
  const percent = Number.isFinite(quotePercent)
    ? quotePercent
    : Number.isFinite(Number(percentRaw)) ? Number(percentRaw) : 0;
  const isNearMoney = Boolean(item.isNearMoney);
  const value = cleanNumber(item.value);
  const hasRepeatLargeSignal = Boolean(item.hasRepeatLargeSignal);
  const estimatedLargeSignalCount = cleanNumber(item.estimatedLargeSignalCount);
  const scoreBoost =
    (hasRepeatLargeSignal ? 10 : 0) +
    (estimatedLargeSignalCount >= 2 ? 4 : 0) +
    (isNearMoney ? 3 : 0) +
    (percent >= 0 && percent <= 4.5 ? 4 : percent > -3 && percent < 0 ? 2 : 0) +
    (value >= 6000000 ? 2 : 0);
  const score = Math.min(100, cleanNumber(item.score) + scoreBoost);
  return {
    ...item,
    code,
    name: String(item.underlyingName || item.name || "").trim(),
    close,
    percent,
    quoteDate: quote.quoteDate || quote.tradeDate || quote.TradeDate || item.quoteDate || "",
    displayClose: close,
    displayPercent: percent,
    underlyingCode: code,
    underlyingName: String(item.underlyingName || item.name || "").trim(),
    underlyingClose: close,
    underlyingPercent: percent,
    score,
  };
}

function isControlledSingleSignal(item) {
  const percent = Number(item?.underlyingPercent ?? item?.percent);
  return !Number.isFinite(percent) || (percent > -3 && percent <= 6);
}

async function main() {
  const backup = readJson(BACKUP_FILE, { ok: true, matches: [] });
  const payload = await runHandler();
  const stockQuoteMap = loadStockQuoteMap();
  const matches = Array.isArray(payload.matches) ? payload.matches.map((item) => normalizeMatch(item, stockQuoteMap)) : [];
  const singleSignals = Array.isArray(payload.singleSignals)
    ? payload.singleSignals.map((item) => normalizeSingleSignal(item, stockQuoteMap)).filter(isControlledSingleSignal)
    : [];
  const output = {
    ...payload,
    ok: true,
    source: "github-actions",
    updatedAt: new Date().toISOString(),
    count: matches.length,
    matches,
    singleSignalCount: singleSignals.length,
    singleSignals,
  };

  if (!matches.length) {
    console.error("warrant-flow scan returned 0 matches; keeping existing cache files unchanged");
    process.exit(2);
  }
  const tradeDates = [...new Set(matches.map((item) => String(item.tradeDate || "")).filter(Boolean))];
  const newestTradeDate = tradeDates.sort().at(-1) || "";
  const dataAge = ageInDaysFromTradeDate(newestTradeDate);
  if (dataAge > 3) {
    console.error(`warrant-flow cache is stale: newest tradeDate ${newestTradeDate || "--"}, age ${dataAge} days; keeping existing cache files unchanged`);
    process.exit(2);
  }

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(output, null, 2)}\n`);
  writeSummary("warrant", output, SUMMARY_FILE);
  fs.writeFileSync(BACKUP_FILE, `${JSON.stringify({ ...output, source: "github-actions-backup" }, null, 2)}\n`);
  console.log(`warrant-flow cache updated: matches ${matches.length}, tradeDate ${newestTradeDate || "--"}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
