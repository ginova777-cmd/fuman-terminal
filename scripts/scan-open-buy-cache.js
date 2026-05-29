const fs = require("fs");
const path = require("path");
const scanOpenBuy = require("../api/scan-open-buy");
const fetchStocks = require("../stocks");
const { fetchMisQuotes } = require("../lib/mis-quotes");

const { ROOT, dataPath } = require("./runtime-paths");
const OUT_FILE = dataPath("open-buy-latest.json");
const BACKUP_FILE = dataPath("open-buy-backup.json");
const SCORECARD_SOURCE_FILE = dataPath("open-buy-scorecard-source.json");
const BATCH_SIZE = Number(process.env.OPEN_BUY_BATCH_SIZE || 48);
const BATCHES_PER_RUN = Number(process.env.OPEN_BUY_BATCHES_PER_RUN || 5);
const FULL_SCAN = process.env.FULL_SCAN === "1";
const STOCK_URL = process.env.STOCK_UNIVERSE_URL || "https://fuman-terminal.vercel.app/api/stocks";
const USE_MIS_QUOTES = process.env.OPEN_BUY_USE_MIS === "1";

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function preserveScorecardSource(payload) {
  if (!(payload.matches || []).length) return;
  fs.mkdirSync(path.dirname(SCORECARD_SOURCE_FILE), { recursive: true });
  fs.writeFileSync(SCORECARD_SOURCE_FILE, `${JSON.stringify({
    ...payload,
    source: "open-buy-scorecard-source",
    preservedAt: new Date().toISOString(),
  }, null, 2)}\n`);
}

function sourceDate(payload) {
  const direct = String(payload?.usedDate || payload?.date || payload?.quoteDate || "").replace(/\D/g, "");
  if (/^\d{8}$/.test(direct)) return direct;
  const matchDate = String((payload?.matches || []).find((item) => item?.quoteDate)?.quoteDate || "").replace(/\D/g, "");
  if (/^\d{8}$/.test(matchDate)) return matchDate;
  const updated = Date.parse(payload?.updatedAt || "");
  if (!Number.isFinite(updated)) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(updated)).replace(/\D/g, "");
}

function preservePreviousTradingSource(previousPayload, currentPayload) {
  const previousDate = sourceDate(previousPayload);
  const currentDate = sourceDate(currentPayload);
  if (!(previousPayload.matches || []).length) return;
  if (!/^\d{8}$/.test(previousDate) || !/^\d{8}$/.test(currentDate)) return;
  if (previousDate > currentDate) return;
  if (previousDate === currentDate) {
    const previousUpdated = Date.parse(previousPayload.updatedAt || previousPayload.preservedAt || "");
    const currentUpdated = Date.parse(currentPayload.updatedAt || currentPayload.preservedAt || "");
    if (!Number.isFinite(previousUpdated) || !Number.isFinite(currentUpdated) || previousUpdated >= currentUpdated) return;
  }
  preserveScorecardSource(previousPayload);
}

function normalizeCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 4);
}

function cleanNumber(value) {
  return Number(String(value ?? "").replace(/[,+%]/g, "").trim()) || 0;
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

function callLocalStocksHandler() {
  return new Promise((resolve, reject) => {
    const req = { method: "GET", query: {} };
    const res = {
      statusCode: 200,
      setHeader() {},
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

function normalizeStock(row) {
  const code = normalizeCode(row.Code || row.code);
  const name = String(row.Name || row.name || "").trim();
  if (!/^\d{4}$/.test(code) || /^00/.test(code) || !name) return null;
  return {
    code,
    name,
    close: cleanNumber(row.ClosingPrice || row.close),
    percent: cleanNumber(row.Percent || row.percent),
    value: cleanNumber(row.TradeValue || row.value),
    tradeVolume: cleanNumber(row.TradeVolume || row.tradeVolume),
  };
}

async function fetchUniverse() {
  const payload = await fetchJson(STOCK_URL);
  const rows = Array.isArray(payload) ? payload : (payload.stocks || []);
  const base = rows.map(normalizeStock).filter(Boolean);
  if (!USE_MIS_QUOTES) return base;
  const quotes = await fetchMisQuotes(base.map((stock) => stock.code));
  return base.map((stock) => {
    const quote = quotes.get(stock.code);
    return quote ? { ...stock, ...quote, name: quote.name || stock.name } : stock;
  });
}

function runHandler(codes) {
  return new Promise((resolve, reject) => {
    const req = { method: "GET", query: { codes: codes.join(",") } };
    const res = {
      statusCode: 200,
      setHeader() {},
      status(code) { this.statusCode = code; return this; },
      json(payload) {
        if (this.statusCode >= 400) reject(new Error(payload?.error || `HTTP ${this.statusCode}`));
        else if ((payload?.errors || []).length) reject(new Error(payload.errors.join("; ")));
        else resolve(payload);
      },
      end() { resolve({ ok: false, matches: [] }); },
    };
    Promise.resolve(scanOpenBuy(req, res)).catch(reject);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runHandlerWithRetry(codes, label) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await runHandler(codes);
    } catch (error) {
      lastError = error;
      console.log(`${label} attempt ${attempt} failed: ${error.message}`);
      if (attempt < 3) await sleep(2500 * attempt);
    }
  }
  throw lastError;
}

async function main() {
  const universe = await fetchUniverse();
  const codes = universe.map((stock) => stock.code);
  if (!codes.length) throw new Error("No stock universe");

  const previousRaw = readJson(OUT_FILE, { ok: true, total: codes.length, scannedCodes: [], matches: [] });
  const backup = readJson(BACKUP_FILE, { ok: true, matches: [] });
  const currentMatches = new Map();
  const scanned = new Set();
  let scannedThisRun = 0;
  const chunksToRun = Math.ceil(codes.length / CHUNK_SIZE);

  console.log(`open-buy cache start: full market scan, ${codes.length} codes, ${chunksToRun} chunks in one run`);
  for (let chunk = 0; chunk < chunksToRun; chunk++) {
    const start = chunk * CHUNK_SIZE;
    const chunkCodes = codes.slice(start, start + CHUNK_SIZE);
    const label = `open-buy chunk ${chunk + 1}/${chunksToRun} (${chunkCodes[0]}-${chunkCodes[chunkCodes.length - 1]})`;
    console.log(`${label} start`);
    const payload = await runHandlerWithRetry(chunkCodes, label);
    chunkCodes.forEach((code) => scanned.add(code));
    (payload.matches || []).forEach((item) => {
      const base = universe.find((stock) => stock.code === item.code) || {};
      currentMatches.set(item.code, { ...base, ...item, name: base.name || item.name || item.code });
    });
    scannedThisRun += chunkCodes.length;
    console.log(`${label} done: matches ${(payload.matches || []).length}`);
  }

  if (scanned.size !== codes.length || scannedThisRun !== codes.length) {
    throw new Error(`Open-buy full scan incomplete: scanned ${scanned.size}/${codes.length}`);
  }

  const matches = [...currentMatches.values()]
    .sort((a, b) => (b.score || 0) - (a.score || 0) || (b.percent || 0) - (a.percent || 0))
    .slice(0, 200);
  const quoteDate = universe.find((stock) => stock.quoteDate)?.quoteDate || String(matches[0]?.date || "").replace(/\D/g, "");
  const output = {
    ok: true,
    source: "github-actions",
    updatedAt: new Date().toISOString(),
    usedDate: quoteDate,
    fullScan: FULL_SCAN,
    total: codes.length,
    scannedThisRun,
    scannedCodes: [...scanned].filter((code) => codes.includes(code)),
    count: matches.length,
    matches,
  };

  preservePreviousTradingSource((previousRaw.matches || []).length ? previousRaw : backup, output);

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(output, null, 2)}\n`);
  if (matches.length) fs.writeFileSync(BACKUP_FILE, `${JSON.stringify({ ...output, source: "github-actions-backup" }, null, 2)}\n`);
  console.log(`open-buy cache updated: full market scan scanned ${scannedThisRun}/${codes.length}, matches ${matches.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});



