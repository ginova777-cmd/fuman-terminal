const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const scanStrategy4 = require("../api/scan-strategy4");
const fetchStocks = require("../stocks");
const { fetchMisQuotes } = require("../lib/mis-quotes");

const ROOT = path.resolve(__dirname, "..");
const OUT_FILE = path.join(ROOT, "data", "strategy4-latest.json");
const BACKUP_FILE = path.join(ROOT, "data", "strategy4-backup.json");
const BATCH_SIZE = Number(process.env.STRATEGY4_BATCH_SIZE || 80);
const CHUNK_SIZE = Number(process.env.STRATEGY4_CHUNK_SIZE || BATCH_SIZE);
const RETRY_CHUNK_SIZE = Number(process.env.STRATEGY4_RETRY_CHUNK_SIZE || CHUNK_SIZE);
const BATCHES_PER_RUN = Number(process.env.STRATEGY4_BATCHES_PER_RUN || 999);
const FULL_SCAN = process.env.FULL_SCAN !== "0";
const SYNC_PARTIAL = process.env.STRATEGY4_SYNC_PARTIAL === "1";
const SYNC_SCRIPT = path.join(ROOT, "run-strategy4-partial-sync.ps1");
const STOCK_URL = process.env.STOCK_UNIVERSE_URL || "https://fuman-terminal.vercel.app/api/stocks";
const MIN_UNIVERSE_SIZE = Number(process.env.STRATEGY4_MIN_UNIVERSE_SIZE || 1700);
const MIN_MATCH_COUNT = Number(process.env.STRATEGY4_MIN_MATCH_COUNT || 10);
const MIN_MATCH_RATIO_TO_PREVIOUS = Number(process.env.STRATEGY4_MIN_MATCH_RATIO_TO_PREVIOUS || 0.5);
const MAX_YAHOO_SOURCE_RATIO = Number(process.env.STRATEGY4_MAX_YAHOO_SOURCE_RATIO || 0.2);
const USE_MIS_QUOTES = process.env.STRATEGY4_USE_MIS === "1";
const FAIL_ON_INCOMPLETE = process.env.STRATEGY4_FAIL_ON_INCOMPLETE !== "0";
const ALLOW_PARTIAL_PUBLISH = process.env.STRATEGY4_ALLOW_PARTIAL_PUBLISH === "1";
const RUN_STAMP = process.env.STRATEGY4_SCAN_STAMP || new Date().toISOString().slice(0, 10).replace(/-/g, "");

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function normalizeCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 4);
}

function cleanNumber(value) {
  return Number(String(value ?? "").replace(/[,+%]/g, "").trim()) || 0;
}

async function fetchJson(url, timeout = 20000) {
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
      headers: {},
      setHeader(key, value) { this.headers[key] = value; },
      status(code) { this.statusCode = code; return this; },
      json(payload) {
        if (this.statusCode >= 400) reject(new Error(payload?.error || `stocks HTTP ${this.statusCode}`));
        else if ((payload?.errors || []).length) reject(new Error(payload.errors.join("; ")));
        else resolve(payload);
      },
      end() { resolve({ ok: false, stocks: [] }); },
    };
    Promise.resolve(fetchStocks(req, res)).catch(reject);
  });
}

function normalizeStock(row) {
  const code = normalizeCode(row.Code || row.code || row["證券代號"]);
  const name = String(row.Name || row.name || row["證券名稱"] || "").trim();
  if (!/^\d{4}$/.test(code) || /^00/.test(code) || !name) return null;
  return {
    code,
    name,
    market: String(row.Market || row.market || row["市場"] || "").trim().toUpperCase(),
    close: cleanNumber(row.ClosingPrice || row.close),
    percent: cleanNumber(row.Percent || row.percent),
    value: cleanNumber(row.TradeValue || row.value),
    tradeVolume: cleanNumber(row.TradeVolume || row.tradeVolume),
  };
}

async function fetchUniverse() {
  let parsed = [];
  try {
    const payload = await fetchJson(STOCK_URL, 30000);
    const rows = Array.isArray(payload) ? payload : (payload.stocks || []);
    parsed = rows.map(normalizeStock).filter(Boolean);
    if (parsed.length < MIN_UNIVERSE_SIZE) {
      console.log(`stock endpoint partial universe: ${parsed.length}, fallback to local TWSE+TPEX fetch`);
      parsed = [];
    }
  } catch (error) {
    console.log(`stock endpoint fallback: ${error.message}`);
  }

  if (!parsed.length) {
    const payload = await callLocalStocksHandler();
    const rows = Array.isArray(payload) ? payload : (payload.stocks || []);
    parsed = rows.map(normalizeStock).filter(Boolean);
  }
  const byCode = new Map();
  parsed.forEach((stock) => byCode.set(stock.code, stock));
  parsed = [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
  if (parsed.length < MIN_UNIVERSE_SIZE) {
    throw new Error(`Strategy4 stock universe too small: ${parsed.length}/${MIN_UNIVERSE_SIZE}`);
  }
  if (!USE_MIS_QUOTES) return parsed;
  const quotes = await fetchMisQuotes(parsed.map((stock) => stock.code));
  return parsed.map((stock) => {
    const quote = quotes.get(stock.code);
    return quote ? { ...stock, ...quote, name: quote.name || stock.name } : stock;
  });
}
function runHandler(stocks) {
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
        if (this.statusCode >= 400) reject(new Error(payload?.error || `HTTP ${this.statusCode}`));
        else resolve(payload);
      },
      end() { resolve({ ok: false, matches: [] }); },
    };
    Promise.resolve(scanStrategy4(req, res)).catch(reject);
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

function mergeMatches(matches, universe, currentMatches) {
  (matches || []).forEach((item) => {
    const base = universe.find((stock) => stock.code === item.code) || {};
    currentMatches.set(item.code, {
      ...base,
      ...item,
      name: base.name || item.name || item.code,
    });
  });
}

function mergeSourceCounts(sourceCounts, currentSourceCounts) {
  Object.entries(sourceCounts || {}).forEach(([source, count]) => {
    const key = source || "unknown";
    currentSourceCounts.set(key, (currentSourceCounts.get(key) || 0) + Number(count || 0));
  });
}

function buildOutput({ codes, scannedThisRun, scanned, noDataCodes, scanErrors, currentMatches, dataSourceCounts, complete, runMode, scanStamp }) {
  const matches = [...currentMatches.values()]
    .sort((a, b) => (b.swingScore || b.score || 0) - (a.swingScore || a.score || 0) || (b.percent || 0) - (a.percent || 0));
  const noDataCount = noDataCodes.size;
  const errorCount = scanErrors.length;
  const pendingCount = codes.length - scanned.size + noDataCount;
  const qualityStatus = complete && noDataCount === 0 && errorCount === 0 ? "complete" : "incomplete";
  const sourceCounts = Object.fromEntries([...dataSourceCounts.entries()].sort(([a], [b]) => a.localeCompare(b)));
  const yahooSourceCount = Object.entries(sourceCounts)
    .filter(([source]) => /^yahoo/i.test(source))
    .reduce((sum, [, count]) => sum + Number(count || 0), 0);
  const totalSourceCount = Object.values(sourceCounts).reduce((sum, count) => sum + Number(count || 0), 0);
  const yahooSourceRatio = totalSourceCount ? Number((yahooSourceCount / totalSourceCount).toFixed(4)) : 0;
  return {
    ok: true,
    source: qualityStatus === "complete" ? "github-actions" : "github-actions-partial",
    priceSource: USE_MIS_QUOTES ? "official-daily-k-plus-mis" : "official-daily-k",
    updatedAt: new Date().toISOString(),
    scanStamp,
    fullScan: FULL_SCAN,
    runMode,
    complete: qualityStatus === "complete",
    qualityStatus,
    pendingCount,
    noDataCount,
    errorCount,
    total: codes.length,
    scannedThisRun,
    scannedCodes: [...scanned].filter((code) => codes.includes(code)),
    noDataCodes: [...noDataCodes],
    errors: scanErrors,
    dataSourceCounts: sourceCounts,
    yahooSourceCount,
    yahooSourceRatio,
    count: matches.length,
    matches,
  };
}

function writeStrategy4Output(output, writeBackup = false) {
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(output, null, 2)}\n`);
  if (writeBackup) {
    fs.writeFileSync(BACKUP_FILE, `${JSON.stringify({ ...output, source: "github-actions-backup", backupUpdatedAt: new Date().toISOString() }, null, 2)}\n`);
  }
}

function syncStrategy4Output(label) {
  if (!SYNC_PARTIAL) return;
  if (!fs.existsSync(SYNC_SCRIPT)) {
    console.log(`strategy4 sync skipped (${label}): missing ${SYNC_SCRIPT}`);
    return;
  }
  console.log(`strategy4 sync start (${label})`);
  const result = spawnSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    SYNC_SCRIPT,
  ], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 180000,
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  if (output) {
    output.split(/\r?\n/).filter(Boolean).slice(-20).forEach((line) => console.log(`strategy4 sync: ${line}`));
  }
  if (result.error) {
    console.log(`strategy4 sync failed (${label}): ${result.error.message}`);
  } else if (result.status !== 0) {
    console.log(`strategy4 sync failed (${label}): exit ${result.status}`);
  } else {
    console.log(`strategy4 sync done (${label})`);
  }
}

async function main() {
  const universe = await fetchUniverse();
  const codes = universe.map((stock) => stock.code);
  if (!codes.length) throw new Error("No stock universe");

  const previousRaw = readJson(OUT_FILE, {
    ok: true,
    total: codes.length,
    scannedCodes: [],
    matches: [],
  });
  const backup = readJson(BACKUP_FILE, { ok: true, matches: [] });
  const scanStamp = FULL_SCAN ? RUN_STAMP : (previousRaw.scanStamp || previousRaw.stamp || RUN_STAMP);
  const currentMatches = new Map();
  const dataSourceCounts = new Map();
  const scanned = new Set();
  const noDataCodes = new Set();
  const scanErrors = [];
  let scannedThisRun = 0;
  if (!FULL_SCAN) {
    (previousRaw.matches || []).forEach((item) => currentMatches.set(item.code, item));
    mergeSourceCounts(previousRaw.dataSourceCounts, dataSourceCounts);
    (previousRaw.scannedCodes || []).forEach((code) => {
      if (codes.includes(code)) scanned.add(code);
    });
    (previousRaw.noDataCodes || []).forEach((code) => {
      if (codes.includes(code)) noDataCodes.add(code);
    });
  }

  const pendingCodes = FULL_SCAN
    ? codes
    : [...new Set([
      ...codes.filter((code) => !scanned.has(code)),
      ...noDataCodes,
    ])].filter((code) => codes.includes(code));
  const chunksToRun = Math.min(Math.ceil(pendingCodes.length / CHUNK_SIZE), BATCHES_PER_RUN);
  const runMode = FULL_SCAN ? "full" : "resume";

  console.log(`strategy4 cache start: ${runMode} scan, ${codes.length} total codes, ${pendingCodes.length} pending codes, ${chunksToRun} chunks in this run`);
  for (let chunk = 0; chunk < chunksToRun; chunk++) {
    const start = chunk * CHUNK_SIZE;
    const chunkSet = new Set(pendingCodes.slice(start, start + CHUNK_SIZE));
    const chunkStocks = universe.filter((stock) => chunkSet.has(stock.code));
    const chunkCodes = chunkStocks.map((stock) => stock.code);
    const label = `strategy4 chunk ${chunk + 1}/${chunksToRun} (${chunkCodes[0]}-${chunkCodes[chunkCodes.length - 1]})`;
    console.log(`${label} start`);
    try {
      const payload = await runHandlerWithRetry(chunkStocks, label);
      chunkCodes.forEach((code) => {
        scanned.add(code);
        noDataCodes.delete(code);
      });
      (payload.noDataCodes || []).forEach((code) => noDataCodes.add(code));
      (payload.errors || []).forEach((error) => scanErrors.push(`${label}: ${error}`));
      mergeSourceCounts(payload.sourceCounts, dataSourceCounts);
      mergeMatches(payload.matches, universe, currentMatches);
      scannedThisRun += chunkCodes.length;
      console.log(`${label} done: matches ${(payload.matches || []).length}`);
    } catch (error) {
      chunkCodes.forEach((code) => noDataCodes.add(code));
      scanErrors.push(`${label}: ${error.message || error}`);
      console.log(`${label} failed; ${chunkCodes.length} codes queued for resume`);
    }
  }

  if (FULL_SCAN && !ALLOW_PARTIAL_PUBLISH && (scanned.size !== codes.length || scannedThisRun !== codes.length)) {
    throw new Error(`Strategy4 full scan incomplete: scanned ${scanned.size}/${codes.length}`);
  }

  const firstPassOutput = buildOutput({
    codes,
    scannedThisRun,
    scanned,
    noDataCodes,
    scanErrors,
    currentMatches,
    dataSourceCounts,
    complete: scanned.size === codes.length && !scanErrors.length && !noDataCodes.size,
    runMode,
    scanStamp,
  });
  console.log(`strategy4 first pass done: ${runMode} scannedThisRun ${scannedThisRun}, scannedTotal ${scanned.size}/${codes.length}, matches ${firstPassOutput.count}, noData ${noDataCodes.size}`);
  if (SYNC_PARTIAL) {
    writeStrategy4Output(firstPassOutput, false);
    syncStrategy4Output("first-pass");
  }

  if (noDataCodes.size) {
    const retryCodes = [...noDataCodes];
    console.log(`strategy4 retry noData start: ${retryCodes.length} codes, chunk size ${RETRY_CHUNK_SIZE}`);
    for (let index = 0; index < retryCodes.length; index += RETRY_CHUNK_SIZE) {
      const retryChunkCodes = retryCodes.slice(index, index + RETRY_CHUNK_SIZE);
      const retryStocks = retryChunkCodes
        .map((code) => universe.find((stock) => stock.code === code))
        .filter(Boolean);
      const label = `strategy4 retry ${Math.floor(index / RETRY_CHUNK_SIZE) + 1}/${Math.ceil(retryCodes.length / RETRY_CHUNK_SIZE)} (${retryChunkCodes[0]}-${retryChunkCodes[retryChunkCodes.length - 1]})`;
      console.log(`${label} start`);
      const payload = await runHandlerWithRetry(retryStocks, label);
      retryChunkCodes.forEach((code) => noDataCodes.delete(code));
      (payload.noDataCodes || []).forEach((code) => noDataCodes.add(code));
      (payload.errors || []).forEach((error) => scanErrors.push(`${label}: ${error}`));
      mergeSourceCounts(payload.sourceCounts, dataSourceCounts);
      mergeMatches(payload.matches, universe, currentMatches);
      const retryOutput = buildOutput({
        codes,
        scannedThisRun,
        scanned,
        noDataCodes,
        scanErrors,
        currentMatches,
        dataSourceCounts,
        complete: false,
        runMode,
        scanStamp,
      });
      if (SYNC_PARTIAL) {
        writeStrategy4Output(retryOutput, false);
      }
      console.log(`${label} done: matches ${(payload.matches || []).length}, remaining noData ${noDataCodes.size}`);
      await sleep(500);
    }
  }

  const output = buildOutput({
    codes,
    scannedThisRun,
    scanned,
    noDataCodes,
    scanErrors,
    currentMatches,
    dataSourceCounts,
    complete: scanned.size === codes.length && !scanErrors.length && !noDataCodes.size,
    runMode,
    scanStamp,
  });

  writeStrategy4Output(output, true);
  syncStrategy4Output("complete");
  console.log(`strategy4 cache updated: ${runMode} scannedThisRun ${scannedThisRun}, scannedTotal ${scanned.size}/${codes.length}, matches ${output.count}, complete ${output.complete}`);
  if (FAIL_ON_INCOMPLETE && !ALLOW_PARTIAL_PUBLISH && !output.complete) {
    throw new Error(`Strategy4 scan incomplete: noData ${output.noDataCount}, errors ${output.errorCount}`);
  }
  if (FULL_SCAN && output.complete && output.count < MIN_MATCH_COUNT) {
    throw new Error(`Strategy4 suspiciously low match count: ${output.count}/${codes.length}, minimum ${MIN_MATCH_COUNT}`);
  }
  if (FULL_SCAN && output.complete && output.yahooSourceRatio > MAX_YAHOO_SOURCE_RATIO) {
    throw new Error(`Strategy4 excessive Yahoo fallback: ${output.yahooSourceCount}/${Object.values(output.dataSourceCounts || {}).reduce((sum, count) => sum + Number(count || 0), 0)} (${output.yahooSourceRatio}), maximum ${MAX_YAHOO_SOURCE_RATIO}`);
  }
  const previousCompleteCount = previousRaw?.complete === true ? Number(previousRaw.count || 0) : 0;
  if (FULL_SCAN && output.complete && previousCompleteCount >= MIN_MATCH_COUNT) {
    const minByHistory = Math.max(MIN_MATCH_COUNT, Math.floor(previousCompleteCount * MIN_MATCH_RATIO_TO_PREVIOUS));
    if (output.count < minByHistory) {
      throw new Error(`Strategy4 suspicious match drop: ${output.count} vs previous ${previousCompleteCount}, minimum ${minByHistory}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});


