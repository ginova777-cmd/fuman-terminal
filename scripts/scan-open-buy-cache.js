const fs = require("fs");
const path = require("path");
const scanOpenBuy = require("../api/scan-open-buy");
const fetchStocks = require("../stocks");
const { fetchMisQuotes } = require("../lib/mis-quotes");
const { publishStrategyCacheStatus } = require("../lib/strategy-cache-status");

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
const SUPABASE_OPEN_BUY_RUNS_TABLE = process.env.SUPABASE_OPEN_BUY_RUNS_TABLE || "strategy1_open_buy_runs";
const SUPABASE_OPEN_BUY_RESULTS_TABLE = process.env.SUPABASE_OPEN_BUY_RESULTS_TABLE || "strategy1_open_buy_results";
const OPEN_BUY_SYNC_SUPABASE_RESULTS = process.env.OPEN_BUY_SYNC_SUPABASE_RESULTS !== "0";
const OPEN_BUY_API_ONLY = true;

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
  const latestUrl = `${baseUrl}/rest/v1/${SUPABASE_OPEN_BUY_TABLE}?id=eq.latest&select=id,updated_at,match_count,scanned_count,total_count,run_id`;
  const latestResponse = await fetch(latestUrl, {
    headers: {
      apikey: SUPABASE_READBACK_KEY,
      Authorization: `Bearer ${SUPABASE_READBACK_KEY}`,
    },
  });
  if (!latestResponse.ok) {
    const text = await latestResponse.text().catch(() => "");
    throw new Error(`latest readback HTTP ${latestResponse.status} ${text.slice(0, 160)}`.trim());
  }
  const rows = await latestResponse.json();
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) throw new Error("latest readback missing row");
  const expectedMs = Date.parse(expected.updated_at || "");
  const actualMs = Date.parse(row.updated_at || "");
  const timeOk = Number.isFinite(expectedMs) && Number.isFinite(actualMs) && actualMs >= expectedMs - 5000;
  if (Number(row.match_count) !== expected.match_count ||
      Number(row.scanned_count) !== expected.scanned_count ||
      Number(row.total_count) !== expected.total_count ||
      String(row.run_id || "") !== String(expected.run_id || "") ||
      !timeOk) {
    throw new Error(`latest readback mismatch run=${row.run_id}/${expected.run_id} updated=${row.updated_at} match=${row.match_count}/${expected.match_count} scanned=${row.scanned_count}/${expected.scanned_count} total=${row.total_count}/${expected.total_count}`);
  }
  const runUrl = `${baseUrl}/rest/v1/${SUPABASE_OPEN_BUY_RUNS_TABLE}?strategy=eq.strategy1&status=eq.complete&complete=eq.true&select=run_id,finished_at,result_count,scanned_count,expected_total&order=finished_at.desc&limit=1`;
  const runResponse = await fetch(runUrl, {
    headers: {
      apikey: SUPABASE_READBACK_KEY,
      Authorization: `Bearer ${SUPABASE_READBACK_KEY}`,
    },
  });
  if (!runResponse.ok) {
    const text = await runResponse.text().catch(() => "");
    throw new Error(`run gate readback HTTP ${runResponse.status} ${text.slice(0, 160)}`.trim());
  }
  const runRows = await runResponse.json();
  const run = Array.isArray(runRows) ? runRows[0] : null;
  if (!run?.run_id) throw new Error("run gate missing latest complete run");
  if (String(run.run_id) !== String(expected.run_id)) {
    throw new Error(`run gate mismatch latest=${run.run_id} expected=${expected.run_id}`);
  }
  if (Number(run.result_count) < expected.match_count ||
      Number(run.scanned_count) !== expected.scanned_count ||
      Number(run.expected_total) !== expected.total_count) {
    throw new Error(`run gate count mismatch result=${run.result_count}>=${expected.match_count} scanned=${run.scanned_count}/${expected.scanned_count} total=${run.expected_total}/${expected.total_count}`);
  }
  const resultsUrl = `${baseUrl}/rest/v1/${SUPABASE_OPEN_BUY_RESULTS_TABLE}?run_id=eq.${encodeURIComponent(expected.run_id)}&strategy=eq.strategy1&select=code`;
  const resultsResponse = await fetch(resultsUrl, {
    method: "HEAD",
    headers: {
      apikey: SUPABASE_READBACK_KEY,
      Authorization: `Bearer ${SUPABASE_READBACK_KEY}`,
      Prefer: "count=exact",
    },
  });
  if (!resultsResponse.ok) {
    const text = await resultsResponse.text().catch(() => "");
    throw new Error(`result gate readback HTTP ${resultsResponse.status} ${text.slice(0, 160)}`.trim());
  }
  const contentRange = resultsResponse.headers.get("content-range") || "";
  const resultCount = Number(contentRange.match(/\/(\d+)$/)?.[1] || 0);
  if (resultCount < expected.match_count || resultCount !== Number(run.result_count)) {
    throw new Error(`result gate row count mismatch rows=${resultCount} run=${run.result_count} buy=${expected.match_count}`);
  }
  return { latest: row, run, resultCount, gate: "run_id" };
}

function scanDateFromOutput(output) {
  const stamp = String(output.usedDate || output.date || "").replace(/\D/g, "");
  if (/^\d{8}$/.test(stamp)) return `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`;
  const updatedAt = String(output.updatedAt || "");
  return /^\d{4}-\d{2}-\d{2}/.test(updatedAt) ? updatedAt.slice(0, 10) : new Date().toISOString().slice(0, 10);
}

function openBuyRunIdFromOutput(output) {
  const scanDate = scanDateFromOutput(output).replace(/-/g, "");
  const stamp = Date.parse(String(output.startedAt || output.updatedAt || ""));
  const time = Number.isFinite(stamp)
    ? new Date(stamp).toISOString().replace(/\D/g, "").slice(0, 14)
    : new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return String(output.runId || process.env.OPEN_BUY_RUN_ID || `strategy1-${scanDate}-${time}`).replace(/[^a-zA-Z0-9_-]/g, "-");
}

function normalizeSignals(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") : [];
}

function buildOpenBuyResultRows(output, runId) {
  const rows = Array.isArray(output.rows) && output.rows.length ? output.rows : (Array.isArray(output.matches) ? output.matches : []);
  const scanDate = scanDateFromOutput(output);
  const scanTime = String(output.updatedAt || new Date().toISOString());
  return rows.map((stock, index) => ({
    run_id: runId,
    strategy: "strategy1",
    scan_date: scanDate,
    code: normalizeCode(stock.code),
    name: String(stock.name || stock.code || "").trim(),
    price: cleanNumber(stock.close || stock.price),
    close: cleanNumber(stock.close || stock.price),
    change_percent: cleanNumber(stock.percent ?? stock.changePercent ?? stock.pct),
    volume: cleanNumber(stock.volume || stock.tradeVolume),
    trade_volume: cleanNumber(stock.tradeVolume || stock.volume),
    trade_value: cleanNumber(stock.value || stock.tradeValue),
    score: cleanNumber(stock.score),
    rank: index + 1,
    reason: String(stock.reason || "").trim(),
    signals: normalizeSignals(stock.signals || stock.openBuySignals),
    payload: stock,
    decision: String(stock.decision || stock.strategy1Decision?.decision || "BUY").trim().toUpperCase(),
    block_reason: String(stock.blockReason || stock.strategy1Decision?.blockReason || "").trim(),
    setup_type: String(stock.setupType || stock.strategy1Decision?.setupType || stock.setup || "").trim(),
    complete: Boolean(output.complete),
    quality_status: output.complete ? "complete" : "incomplete",
    generated_at: String(output.startedAt || output.updatedAt || new Date().toISOString()),
    updated_at: scanTime,
  })).filter((row) => /^\d{4}$/.test(row.code));
}

function buildOpenBuyRunRow(output, runId) {
  const scanTime = String(output.updatedAt || new Date().toISOString());
  const rows = Array.isArray(output.rows) ? output.rows : [];
  const buyCount = rows.length ? rows.filter((row) => String(row.decision || row.strategy1Decision?.decision || "").toUpperCase() === "BUY").length : cleanNumber(output.buyCount || output.count);
  const watchCount = rows.length ? rows.filter((row) => String(row.decision || row.strategy1Decision?.decision || "").toUpperCase() === "WATCH").length : cleanNumber(output.watchCount);
  const blockCount = rows.length ? rows.filter((row) => String(row.decision || row.strategy1Decision?.decision || "").toUpperCase() === "BLOCK").length : cleanNumber(output.blockCount);
  return {
    run_id: runId,
    strategy: "strategy1",
    scan_date: scanDateFromOutput(output),
    run_trade_date: scanDateFromOutput(output),
    started_at: String(output.startedAt || output.updatedAt || new Date().toISOString()),
    finished_at: scanTime,
    status: output.complete ? "complete" : "failed",
    expected_total: cleanNumber(output.total),
    scanned_count: Array.isArray(output.scannedCodes) ? output.scannedCodes.length : cleanNumber(output.scannedThisRun),
    result_count: rows.length || (Array.isArray(output.matches) ? output.matches.length : cleanNumber(output.count)),
    error_count: Array.isArray(output.errors) ? output.errors.length : 0,
    complete: Boolean(output.complete),
    quality_status: output.complete ? "complete" : "incomplete",
    source: String(output.source || "").trim(),
    generated_at: String(output.startedAt || output.updatedAt || new Date().toISOString()),
    updated_at: scanTime,
    payload: {
      count: cleanNumber(output.count),
      total: cleanNumber(output.total),
      completedChunks: cleanNumber(output.completedChunks),
      totalChunks: cleanNumber(output.totalChunks),
      buy_count: buyCount,
      watch_count: watchCount,
      block_count: blockCount,
      usedDate: output.usedDate || output.date || "",
    },
  };
}

async function upsertOpenBuyResultsToSupabase(baseUrl, output, runId) {
  const rows = buildOpenBuyResultRows(output, runId);
  if (!rows.length) return true;
  const response = await fetch(`${baseUrl}/rest/v1/${SUPABASE_OPEN_BUY_RESULTS_TABLE}?on_conflict=run_id,strategy,code`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(rows),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`results upsert HTTP ${response.status} ${text.slice(0, 240)}`.trim());
  }
  return true;
}

async function upsertOpenBuyRunToSupabase(baseUrl, output, runId, statusOverride = "") {
  const row = buildOpenBuyRunRow(output, runId);
  if (statusOverride === "running") {
    row.status = "running";
    row.finished_at = null;
    row.complete = false;
    row.quality_status = "running";
  }
  const response = await fetch(`${baseUrl}/rest/v1/${SUPABASE_OPEN_BUY_RUNS_TABLE}?on_conflict=run_id`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify([row]),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`run upsert HTTP ${response.status} ${text.slice(0, 240)}`.trim());
  }
  return row;
}

async function upsertOpenBuyLatestToSupabase(payload) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    writeSupabaseStatus(false, { skipped: true, reason: "missing Supabase credentials" });
    return false;
  }
  if (!OPEN_BUY_SYNC_SUPABASE_RESULTS) {
    writeSupabaseStatus(false, { skipped: true, reason: "disabled" });
    return false;
  }
  if (payload.complete !== true) {
    writeSupabaseStatus(false, { skipped: true, reason: "incomplete scan is not eligible for run_id complete gate" });
    return false;
  }
  const baseUrl = SUPABASE_URL.replace(/\/+$/, "");
  const runId = openBuyRunIdFromOutput(payload);
  const body = {
    id: "latest",
    run_id: runId,
    date: payload.usedDate || payload.date || "",
    used_date: payload.usedDate || payload.date || "",
    updated_at: payload.updatedAt || new Date().toISOString(),
    scan_status: payload.complete ? "complete" : "incomplete",
    completed_chunks: Number(payload.completedChunks || 0),
    total_chunks: Number(payload.totalChunks || 0),
    scanned: Array.isArray(payload.scannedCodes) ? payload.scannedCodes.length : Number(payload.scannedThisRun || 0),
    total: Number(payload.total || 0),
    payload,
    match_count: Array.isArray(payload.matches) ? payload.matches.length : 0,
    scanned_count: Array.isArray(payload.scannedCodes) ? payload.scannedCodes.length : 0,
    total_count: Number(payload.total || 0),
  };
  const attempts = Number(process.env.OPEN_BUY_SUPABASE_ATTEMPTS || 4);
  let lastMessage = "";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await upsertOpenBuyRunToSupabase(baseUrl, payload, runId, "running");
      await upsertOpenBuyResultsToSupabase(baseUrl, payload, runId);
      await upsertOpenBuyRunToSupabase(baseUrl, payload, runId);
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
        const readback = await verifyOpenBuySupabaseReadback(baseUrl, body);
        await publishStrategyCacheStatus("strategy1", "策略1-明日開盤入", payload, {
          used_date: body.used_date,
          updated_at: body.updated_at,
          scan_status: body.scan_status,
          scanned: body.scanned,
          total: body.total,
          match_count: body.match_count,
          source: SUPABASE_OPEN_BUY_TABLE,
          log: `run_id=${runId}`,
        });
        writeSupabaseStatus(true, {
          table: SUPABASE_OPEN_BUY_TABLE,
          runTable: SUPABASE_OPEN_BUY_RUNS_TABLE,
          resultsTable: SUPABASE_OPEN_BUY_RESULTS_TABLE,
          gate: readback.gate,
          runId,
          updatedAt: body.updated_at,
          matchCount: body.match_count,
          scannedCount: body.scanned_count,
          totalCount: body.total_count,
          attempt,
          readbackVerified: true,
        });
        console.log(`open-buy supabase run_id gate ok: ${runId}, matches ${body.match_count}, scanned ${body.scanned_count}/${body.total_count}`);
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
    error: lastMessage || "unknown error",
    attempts,
  });
  await publishStrategyCacheStatus("strategy1", "策略1-明日開盤入", payload, {
    used_date: body.used_date,
    updated_at: new Date().toISOString(),
    scan_status: "failed",
    scanned: body.scanned,
    total: body.total,
    match_count: body.match_count,
    source: SUPABASE_OPEN_BUY_TABLE,
    error: lastMessage || "unknown error",
  });
  return false;
}
function preserveScorecardSource(payload) {
  if (OPEN_BUY_API_ONLY) {
    console.log("open-buy API-only: skipped static open-buy-scorecard-source.json output");
    return;
  }
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

function assertNotOlderThanPrevious(previousPayload, currentPayload) {
  const previousDate = sourceDate(previousPayload);
  const currentDate = sourceDate(currentPayload);
  if (!(previousPayload?.matches || []).length) return;
  if (!/^\d{8}$/.test(previousDate) || !/^\d{8}$/.test(currentDate)) return;
  if (currentDate < previousDate) {
    throw new Error(`Refusing to overwrite newer open-buy cache ${previousDate} with stale source ${currentDate}`);
  }
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

function runHandler(codes, stocks = []) {
  return new Promise((resolve, reject) => {
    const req = { method: "GET", query: { codes: codes.join(","), stocks: JSON.stringify(stocks) } };
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

async function runHandlerWithRetry(codes, label, stocks = []) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await runHandler(codes, stocks);
    } catch (error) {
      lastError = error;
      console.log(`${label} attempt ${attempt} failed: ${error.message}`);
      if (attempt < 3) await sleep(2500 * attempt);
    }
  }
  throw lastError;
}

async function main() {
  if (!FULL_SCAN) {
    throw new Error("Open-buy API-only requires full scan -> Supabase complete run; partial static JSON runs are disabled");
  }
  const universe = await fetchUniverse();
  const codes = universe.map((stock) => stock.code);
  if (!codes.length) throw new Error("No stock universe");

  const previousRaw = { ok: true, total: codes.length, scannedCodes: [], matches: [] };
  const backup = { ok: true, matches: [] };
  const currentMatches = new Map();
  const currentRows = new Map();
  const scanned = new Set();
  const failedCodes = new Set();
  let scannedThisRun = 0;
  const chunksToRun = Math.ceil(codes.length / BATCH_SIZE);
  const runStartedAt = new Date().toISOString();
  const scanStamp = runStartedAt.slice(0, 10).replace(/-/g, "");
  const runId = String(process.env.OPEN_BUY_RUN_ID || `strategy1-${scanStamp}-${runStartedAt.replace(/\D/g, "").slice(0, 14)}`).replace(/[^a-zA-Z0-9_-]/g, "-");

  function buildOutput(completedChunks, complete, statusOverride = null) {
    const matches = [...currentMatches.values()]
      .sort((a, b) => (b.score || 0) - (a.score || 0) || (b.percent || 0) - (a.percent || 0))
      .slice(0, 200);
    const rows = [...currentRows.values()]
      .sort((a, b) => (b.score || 0) - (a.score || 0) || String(a.code || "").localeCompare(String(b.code || "")))
      .slice(0, 2000);
    const quoteDate = universe.find((stock) => stock.quoteDate)?.quoteDate || String(matches[0]?.date || rows[0]?.date || scanStamp).replace(/\D/g, "");
    return {
      ok: true,
      source: "github-actions",
      runId,
      startedAt: runStartedAt,
      updatedAt: new Date().toISOString(),
      usedDate: quoteDate,
      fullScan: complete && FULL_SCAN,
      partialScan: !complete,
      complete: Boolean(complete),
      scanStatus: statusOverride || (complete ? "complete" : "running"),
      completedChunks,
      totalChunks: chunksToRun,
      total: codes.length,
      scannedThisRun,
      scannedCodes: [...scanned].filter((code) => codes.includes(code)),
      count: matches.length,
      resultCount: rows.length,
      buyCount: matches.length,
      watchCount: rows.filter((row) => String(row.decision || "").toUpperCase() === "WATCH").length,
      blockCount: rows.filter((row) => String(row.decision || "").toUpperCase() === "BLOCK").length,
      rows,
      matches,
    };
  }

  async function publishRunningStatus(output, log = "") {
    await publishStrategyCacheStatus("strategy1", "策略1-明日開盤入", output, {
      used_date: output.usedDate,
      updated_at: output.updatedAt,
      scan_status: output.scanStatus || (output.complete ? "complete" : "running"),
      scanned: Array.isArray(output.scannedCodes) ? output.scannedCodes.length : output.scannedThisRun,
      total: output.total,
      match_count: output.count,
      source: SUPABASE_OPEN_BUY_TABLE,
      log,
    });
  }

  async function publishCompleteOutput(output, { backupOnMatches = false } = {}) {
    if (output.complete !== true || output.scanStatus !== "complete") {
      await publishRunningStatus(output, "blocked non-complete publish to latest");
      throw new Error(`Refusing to publish non-complete open-buy output: status=${output.scanStatus} complete=${output.complete}`);
    }
    if (!OPEN_BUY_API_ONLY) {
      fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
      fs.writeFileSync(OUT_FILE, `${JSON.stringify(output, null, 2)}\n`);
      if (backupOnMatches && output.matches.length) {
        fs.writeFileSync(BACKUP_FILE, `${JSON.stringify({ ...output, source: "github-actions-backup" }, null, 2)}\n`);
      }
    } else {
      console.log(`open-buy API-only: skipped static open-buy*.json output, backup=${backupOnMatches ? "requested" : "no"}`);
    }
    await upsertOpenBuyLatestToSupabase(output);
  }

  function mergePayloadMatches(payload) {
    (payload.rows || payload.matches || []).forEach((item) => {
      const base = universe.find((stock) => stock.code === item.code) || {};
      const row = { ...base, ...item, name: base.name || item.name || item.code };
      currentRows.set(item.code, row);
      if (String(row.decision || "BUY").toUpperCase() === "BUY") currentMatches.set(item.code, row);
    });
  }

  async function scanCodesWithFallback(chunkCodes, label, completedChunks, depth = 0) {
    try {
      const chunkStocks = chunkCodes.map((code) => universe.find((stock) => stock.code === code) || { code });
      const payload = await runHandlerWithRetry(chunkCodes, label, chunkStocks);
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
      await publishRunningStatus(partialOutput, `running chunks ${chunk + 1}/${chunksToRun}`);
      lastPublishedCount = currentMatches.size;
      console.log(`open-buy running status updated: chunks ${chunk + 1}/${chunksToRun}, scanned ${scannedThisRun}/${codes.length}, matches ${partialOutput.matches.length}`);
    }
  }

  if (failedCodes.size || scanned.size !== codes.length || scannedThisRun !== codes.length) {
    const incompleteOutput = buildOutput(chunksToRun, false, "incomplete");
    await publishRunningStatus(incompleteOutput, `incomplete failed=${failedCodes.size}`);
    throw new Error(`Open-buy full scan incomplete: scanned ${scanned.size}/${codes.length}, failed ${failedCodes.size}`);
  }

  const output = buildOutput(chunksToRun, true);

  assertNotOlderThanPrevious(previousRaw, output);
  preservePreviousTradingSource((previousRaw.matches || []).length ? previousRaw : backup, output);

  await publishCompleteOutput(output, { backupOnMatches: true });
  console.log(`open-buy cache updated: full market scan scanned ${scannedThisRun}/${codes.length}, matches ${output.matches.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});


