const fs = require("fs");
const path = require("path");
const scanOpenBuy = require("../api/scan-open-buy");
const fetchStocks = require("../stocks");
const { fetchMisQuotes } = require("../lib/mis-quotes");

const { ROOT, dataPath, statePath } = require("./runtime-paths");
const OUT_FILE = dataPath("open-buy-latest.json");
const BACKUP_FILE = dataPath("open-buy-backup.json");
const SCORECARD_SOURCE_FILE = dataPath("open-buy-scorecard-source.json");
const SUPABASE_STATUS_FILE = statePath("open-buy-supabase-status.json");
const BATCH_SIZE = Number(process.env.OPEN_BUY_BATCH_SIZE || 48);
const BATCHES_PER_RUN = Number(process.env.OPEN_BUY_BATCHES_PER_RUN || 5);
const FULL_SCAN = process.env.FULL_SCAN === "1";
const STOCK_URL = process.env.STOCK_UNIVERSE_URL || "https://fuman-terminal.vercel.app/api/stocks";
const USE_MIS_QUOTES = process.env.OPEN_BUY_USE_MIS === "1";
const MIN_UNIVERSE_COUNT = Number(process.env.OPEN_BUY_MIN_UNIVERSE_COUNT || 1500);

function readSecretText(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

const SUPABASE_URL = process.env.SUPABASE_URL
  || process.env.FUMAN_SUPABASE_URL
  || readSecretText(path.join(ROOT, "secrets", "supabase-url.txt"))
  || readSecretText(path.join(process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime", "secrets", "supabase-url.txt"));
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_SERVICE_KEY
  || process.env.FUMAN_SUPABASE_SERVICE_KEY
  || readSecretText(path.join(ROOT, "secrets", "supabase-service-role-key.txt"))
  || readSecretText(path.join(process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime", "secrets", "supabase-service-role-key.txt"));
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
  || process.env.FUMAN_SUPABASE_ANON_KEY
  || readSecretText(path.join(ROOT, "secrets", "supabase-anon-key.txt"))
  || readSecretText(path.join(process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime", "secrets", "supabase-anon-key.txt"));
const SUPABASE_READBACK_KEY = SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_OPEN_BUY_TABLE = process.env.SUPABASE_OPEN_BUY_TABLE || "strategy1_open_buy_latest";
const SUPABASE_UPLOAD_OPTIONAL = process.env.FUMAN_SUPABASE_UPLOAD_OPTIONAL !== "0";

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
}

function writeSupabaseStatus(ok, details = {}) {
  writeJson(SUPABASE_STATUS_FILE, {
    ok,
    checkedAt: new Date().toISOString(),
    ...details,
  });
}

async function verifyOpenBuySupabaseReadback(baseUrl, expected) {
  if (!SUPABASE_READBACK_KEY) throw new Error("missing Supabase readback key");
  const url = `${baseUrl}/rest/v1/${SUPABASE_OPEN_BUY_TABLE}?id=eq.latest&select=id,updated_at,match_count,scanned_count,total_count`;
  const response = await fetch(url, {
    headers: {
      apikey: SUPABASE_READBACK_KEY,
      Authorization: `Bearer ${SUPABASE_READBACK_KEY}`,
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`readback HTTP ${response.status} ${text.slice(0, 160)}`.trim());
  }
  const rows = await response.json();
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) throw new Error("readback missing latest row");
  const expectedMs = Date.parse(expected.updated_at || "");
  const actualMs = Date.parse(row.updated_at || "");
  const timeOk = Number.isFinite(expectedMs) && Number.isFinite(actualMs) && actualMs >= expectedMs - 5000;
  if (Number(row.match_count) !== expected.match_count ||
      Number(row.scanned_count) !== expected.scanned_count ||
      Number(row.total_count) !== expected.total_count ||
      !timeOk) {
    throw new Error(`readback mismatch updated=${row.updated_at} match=${row.match_count}/${expected.match_count} scanned=${row.scanned_count}/${expected.scanned_count} total=${row.total_count}/${expected.total_count}`);
  }
  return row;
}

async function upsertOpenBuyLatestToSupabase(payload) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    writeSupabaseStatus(false, { skipped: true, reason: "missing Supabase credentials" });
    return false;
  }
  if (SUPABASE_UPLOAD_OPTIONAL && process.env.FUMAN_ENABLE_SUPABASE_UPLOAD !== "1") {
    writeSupabaseStatus(true, {
      skipped: true,
      optional: true,
      table: SUPABASE_OPEN_BUY_TABLE,
      reason: "Supabase upload optional; set FUMAN_ENABLE_SUPABASE_UPLOAD=1 to enable.",
    });
    console.log("open-buy supabase upload skipped: optional upload disabled");
    return true;
  }
  const baseUrl = SUPABASE_URL.replace(/\/+$/, "");
  const body = {
    id: "latest",
    date: payload.usedDate || payload.date || "",
    updated_at: payload.updatedAt || new Date().toISOString(),
    payload,
    match_count: Array.isArray(payload.matches) ? payload.matches.length : 0,
    scanned_count: Array.isArray(payload.scannedCodes) ? payload.scannedCodes.length : 0,
    total_count: Number(payload.total || 0),
  };
  const attempts = Number(process.env.OPEN_BUY_SUPABASE_ATTEMPTS || 4);
  let lastMessage = "";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/rest/v1/${SUPABASE_OPEN_BUY_TABLE}?on_conflict=id`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates",
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        lastMessage = `HTTP ${response.status} ${text.slice(0, 240)}`.trim();
      } else {
        await verifyOpenBuySupabaseReadback(baseUrl, body);
        writeSupabaseStatus(true, {
          table: SUPABASE_OPEN_BUY_TABLE,
          updatedAt: body.updated_at,
          matchCount: body.match_count,
          scannedCount: body.scanned_count,
          totalCount: body.total_count,
          attempt,
          readbackVerified: true,
        });
        console.log(`open-buy supabase upsert/readback ok: matches ${body.match_count}, scanned ${body.scanned_count}/${body.total_count}`);
        return true;
      }
    } catch (error) {
      const cause = error?.cause?.message ? ` (${error.cause.message})` : "";
      lastMessage = `${error?.message || String(error || "unknown error")}${cause}`;
    }

    console.warn(`open-buy supabase upsert attempt ${attempt}/${attempts} failed: ${lastMessage}`);
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(15000, 1500 * attempt)));
    }
  }
  writeSupabaseStatus(false, {
    table: SUPABASE_OPEN_BUY_TABLE,
    optional: SUPABASE_UPLOAD_OPTIONAL,
    error: lastMessage || "unknown error",
    attempts,
  });
  return false;
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

function summarizeUniverse(payload, rows, source) {
  const normalized = rows.map(normalizeStock).filter(Boolean);
  const marketCounts = normalized.reduce((counts, stock) => {
    const market = stock.market || "UNKNOWN";
    counts[market] = (counts[market] || 0) + 1;
    return counts;
  }, {});
  const twseCount = Number(payload?.twseCount || marketCounts.TWSE || 0);
  const tpexCount = Number(payload?.tpexCount || marketCounts.TPEX || 0);
  return { source, normalized, twseCount, tpexCount, total: normalized.length };
}

function assertCompleteUniverse(summary) {
  const errors = [];
  if (summary.total < MIN_UNIVERSE_COUNT) errors.push(`total ${summary.total} < ${MIN_UNIVERSE_COUNT}`);
  if (summary.twseCount <= 0) errors.push("missing TWSE");
  if (summary.tpexCount <= 0) errors.push("missing TPEX");
  if (errors.length) {
    throw new Error(`Incomplete stock universe from ${summary.source}: ${errors.join(", ")}`);
  }
}

async function loadUniverseFromPayload(payload, source) {
  const rows = Array.isArray(payload) ? payload : (payload.stocks || []);
  const summary = summarizeUniverse(payload, rows, source);
  assertCompleteUniverse(summary);
  console.log(`stock universe ${source}: total ${summary.total}, TWSE ${summary.twseCount}, TPEX ${summary.tpexCount}`);
  return summary.normalized;
}

async function fetchUniverse() {
  const timeout = Number(process.env.STOCK_UNIVERSE_TIMEOUT_MS || 90000);
  let base;
  try {
    base = await loadUniverseFromPayload(await fetchJson(STOCK_URL, timeout), "remote");
  } catch (error) {
    console.log("stock universe remote incomplete/failed: " + error.message + "; using local handler fallback");
    base = await loadUniverseFromPayload(await callLocalStocksHandler(), "local");
  }
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
  const failedCodes = new Set();
  let scannedThisRun = 0;
  const chunksToRun = Math.ceil(codes.length / BATCH_SIZE);

  function buildOutput(completedChunks, complete, statusOverride = null) {
    const matches = [...currentMatches.values()]
      .sort((a, b) => (b.score || 0) - (a.score || 0) || (b.percent || 0) - (a.percent || 0))
      .slice(0, 200);
    const quoteDate = universe.find((stock) => stock.quoteDate)?.quoteDate || String(matches[0]?.date || "").replace(/\D/g, "");
    return {
      ok: true,
      source: "github-actions",
      updatedAt: new Date().toISOString(),
      usedDate: quoteDate,
      fullScan: complete && FULL_SCAN,
      partialScan: !complete,
      scanStatus: complete ? "complete" : "running",
      completedChunks,
      totalChunks: chunksToRun,
      total: codes.length,
      scannedThisRun,
      scannedCodes: [...scanned].filter((code) => codes.includes(code)),
      count: matches.length,
      matches,
    };
  }

  async function publishOutput(output, { backupOnMatches = false } = {}) {
    fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
    fs.writeFileSync(OUT_FILE, `${JSON.stringify(output, null, 2)}\n`);
    if (backupOnMatches && output.matches.length) {
      fs.writeFileSync(BACKUP_FILE, `${JSON.stringify({ ...output, source: "github-actions-backup" }, null, 2)}\n`);
    }
    await upsertOpenBuyLatestToSupabase(output);
  }

  function mergePayloadMatches(payload) {
    (payload.matches || []).forEach((item) => {
      const base = universe.find((stock) => stock.code === item.code) || {};
      currentMatches.set(item.code, { ...base, ...item, name: base.name || item.name || item.code });
    });
  }

  async function scanCodesWithFallback(chunkCodes, label, completedChunks, depth = 0) {
    try {
      const payload = await runHandlerWithRetry(chunkCodes, label);
      chunkCodes.forEach((code) => {
        scanned.add(code);
        failedCodes.delete(code);
      });
      scannedThisRun += chunkCodes.length;
      mergePayloadMatches(payload);
      return payload.matches || [];
    } catch (error) {
      console.warn(`${label} failed after retries: ${error.message}`);
      if (chunkCodes.length <= 1) {
        failedCodes.add(chunkCodes[0]);
        return [];
      }
      const midpoint = Math.ceil(chunkCodes.length / 2);
      const left = chunkCodes.slice(0, midpoint);
      const right = chunkCodes.slice(midpoint);
      console.log(`${label} splitting failed chunk into ${left.length}+${right.length}`);
      const leftMatches = await scanCodesWithFallback(left, `${label} retry-a${depth + 1}`, completedChunks, depth + 1);
      const rightMatches = await scanCodesWithFallback(right, `${label} retry-b${depth + 1}`, completedChunks, depth + 1);
      return [...leftMatches, ...rightMatches];
    }
  }

  console.log(`open-buy cache start: full market scan, ${codes.length} codes, ${chunksToRun} chunks in one run`);
  let lastPublishedCount = 0;
  for (let chunk = 0; chunk < chunksToRun; chunk++) {
    const start = chunk * BATCH_SIZE;
    const chunkCodes = codes.slice(start, start + BATCH_SIZE);
    const label = `open-buy chunk ${chunk + 1}/${chunksToRun} (${chunkCodes[0]}-${chunkCodes[chunkCodes.length - 1]})`;
    console.log(`${label} start`);
    const matches = await scanCodesWithFallback(chunkCodes, label, chunk + 1);
    console.log(`${label} done: matches ${matches.length}, failed so far ${failedCodes.size}`);
    if (currentMatches.size > lastPublishedCount) {
      const partialOutput = buildOutput(chunk + 1, false);
      await publishOutput(partialOutput);
      lastPublishedCount = currentMatches.size;
      console.log(`open-buy partial published: chunks ${chunk + 1}/${chunksToRun}, scanned ${scannedThisRun}/${codes.length}, matches ${partialOutput.matches.length}`);
    }
  }

  if (failedCodes.size || scanned.size !== codes.length || scannedThisRun !== codes.length) {
    const incompleteOutput = buildOutput(chunksToRun, false, "incomplete");
    await publishOutput(incompleteOutput, { backupOnMatches: true });
    throw new Error(`Open-buy full scan incomplete: scanned ${scanned.size}/${codes.length}, failed ${failedCodes.size}`);
  }

  const output = buildOutput(chunksToRun, true);

  preservePreviousTradingSource((previousRaw.matches || []).length ? previousRaw : backup, output);

  await publishOutput(output, { backupOnMatches: true });
  console.log(`open-buy cache updated: full market scan scanned ${scannedThisRun}/${codes.length}, matches ${output.matches.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

