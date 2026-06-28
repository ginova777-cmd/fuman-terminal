"use strict";

const fs = require("fs");
const path = require("path");
const { serverSupabaseKey, serverSupabaseUrl } = require("../lib/server-supabase-key");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const CONTRACT_FILE = path.join(ROOT, "ops", "public-slot", "ScorecardSourceContract.sql");
const SOURCE_FILE = process.env.FUMAN_SCORECARD_SOURCE_FILE || path.join(ROOT, "data", "scorecard-latest.json");
const RECEIPT_FILE = process.env.FUMAN_SCORECARD_SOURCE_RECEIPT
  || path.join(RUNTIME_DIR, "data", "scan-receipts", "scorecard-source-supabase.json");
const TERMINAL_SCORECARD_SOURCE = "terminal-complete-run-scorecard";
const SCORECARD_HISTORY_DAYS = Math.max(1, Number(process.env.FUMAN_SCORECARD_HISTORY_DAYS || "30"));
const TERMINAL_SCORECARD_STRATEGIES = [
  "即時雷達成績單",
  "策略1成績單",
  "策略1開盤入成績單",
  "策略2成績單",
  "策略2-A區進場",
  "策略3成績單",
  "策略3隔日沖成績單",
  "策略4成績單",
  "策略5成績單",
  "買賣超成績單",
  "權證成績單",
  "CB成績單",
];

function arg(name, fallback = "") {
  const prefix = `--${name}=`;
  const found = process.argv.find((item) => item.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function has(name) {
  return process.argv.includes(`--${name}`);
}

function mode() {
  return arg("mode", process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "backfill");
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, "").trim());
  return Number.isFinite(number) ? number : null;
}

function dateOnly(value) {
  const text = cleanText(value);
  if (!text) return "";
  const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  const digits = text.replace(/\D/g, "");
  if (/^\d{8}$/.test(digits)) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  return text.slice(0, 10);
}

function dateDaysAgo(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - Math.max(0, days - 1));
  return date.toISOString().slice(0, 10);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeReceipt(payload) {
  fs.mkdirSync(path.dirname(RECEIPT_FILE), { recursive: true });
  fs.writeFileSync(RECEIPT_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function supabaseConfig() {
  const url = serverSupabaseUrl();
  const key = serverSupabaseKey();
  if (!url || !key) throw new Error("missing Supabase URL/key");
  return { url, key };
}

function headers(key, extra = {}) {
  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    accept: "application/json",
    ...extra,
  };
}

async function restGet(table, query) {
  const { url, key } = supabaseConfig();
  const response = await fetch(`${url}/rest/v1/${table}?${query}`, {
    headers: headers(key),
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { ok: response.ok, status: response.status, text, json };
}

async function restUpsert(table, rows, conflict) {
  if (!rows.length) return { ok: true, status: 204, rows: 0 };
  const { url, key } = supabaseConfig();
  const response = await fetch(`${url}/rest/v1/${table}?on_conflict=${encodeURIComponent(conflict)}`, {
    method: "POST",
    headers: headers(key, {
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=minimal",
    }),
    body: JSON.stringify(rows),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${table} upsert HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  return { ok: true, status: response.status, rows: rows.length };
}

async function restDelete(table, query) {
  const { url, key } = supabaseConfig();
  const response = await fetch(`${url}/rest/v1/${table}?${query}`, {
    method: "DELETE",
    headers: headers(key, {
      prefer: "return=minimal",
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${table} delete HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  return { ok: true, status: response.status };
}

async function pgMetaQuery(sql) {
  const { url, key } = supabaseConfig();
  const endpoints = [
    "/pg/meta/query",
    "/pg/meta/default/query",
    "/postgres/meta/query",
  ];
  const attempts = [];
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(`${url}${endpoint}`, {
        method: "POST",
        headers: headers(key, { "content-type": "application/json" }),
        body: JSON.stringify({ query: sql }),
      });
      const text = await response.text();
      attempts.push({ endpoint, status: response.status, text: text.slice(0, 500) });
      if (response.ok) return { ok: true, endpoint, status: response.status, text };
    } catch (error) {
      attempts.push({ endpoint, status: 0, text: error?.message || String(error) });
    }
  }
  return { ok: false, attempts };
}

function stableRecordId(row, index) {
  const existing = cleanText(row.record_id);
  if (existing) return existing;
  const date = dateOnly(row.record_date || row.date || row.trade_date);
  const strategy = cleanText(row.strategy || row.source_sheet || "未分類").replace(/\s+/g, "_");
  const ticker = cleanText(row.ticker || row.code || row.symbol || `row${index + 1}`);
  const entryTime = cleanText(row.entry_time || row.time || "").replace(/\W+/g, "");
  return [date, strategy, ticker, entryTime || index + 1].filter(Boolean).join("-");
}

function normalizeRecord(row, index) {
  const recordDate = dateOnly(row.record_date || row.date || row.trade_date);
  const ticker = cleanText(row.ticker || row.code || row.symbol);
  const entryPrice = cleanNumber(row.entry_price ?? row.entryPrice ?? row.price);
  const highPrice = cleanNumber(row.high_price ?? row.highPrice ?? row.high);
  return {
    record_id: stableRecordId(row, index),
    record_date: recordDate,
    strategy: cleanText(row.strategy || row.source_sheet || "未分類") || "未分類",
    ticker,
    name: cleanText(row.name || row.stock_name || row.ticker_name),
    entry_time: cleanText(row.entry_time || row.time || row.entryTime),
    entry_price: entryPrice,
    high_price: highPrice,
    pnl: entryPrice && highPrice ? Math.round((highPrice - entryPrice) * 10000) / 10000 : (cleanNumber(row.pnl ?? row.profit ?? row.return_pct ?? row.returnPct) ?? 0),
    source: cleanText(row.source || row.source_sheet || "scorecard-latest-json"),
    reason: cleanText(row.reason || row.note || row.result),
  };
}

function summarizeRows(records) {
  const map = new Map();
  for (const row of records) {
    const key = `${row.record_date}|||${row.strategy}`;
    const bucket = map.get(key) || [];
    bucket.push(row);
    map.set(key, bucket);
  }
  return [...map.entries()].map(([key, rows]) => {
    const [summaryDate, strategy] = key.split("|||");
    const pnls = rows.map((row) => cleanNumber(row.pnl) ?? 0);
    const wins = pnls.filter((value) => value > 0).length;
    const losses = pnls.filter((value) => value < 0).length;
    const flats = pnls.length - wins - losses;
    const totalPnl = pnls.reduce((sum, value) => sum + value, 0);
    return {
      summary_date: summaryDate,
      strategy,
      signals: rows.length,
      backtestable: rows.length,
      wins,
      losses,
      flats,
      win_rate_pct: rows.length ? (wins / rows.length) * 100 : 0,
      total_pnl: totalPnl,
      avg_pnl: rows.length ? totalPnl / rows.length : 0,
      max_profit: pnls.length ? Math.max(...pnls) : 0,
      max_loss: pnls.length ? Math.min(...pnls) : 0,
      status: "complete",
      note: "backfilled from data/scorecard-latest.json",
      source: "scorecard-latest-json",
    };
  });
}

function normalizeDaily(row) {
  return {
    summary_date: dateOnly(row.summary_date || row.date || row.record_date),
    strategy: cleanText(row.strategy || "未分類") || "未分類",
    signals: cleanNumber(row.signals),
    backtestable: cleanNumber(row.backtestable),
    wins: cleanNumber(row.wins),
    losses: cleanNumber(row.losses),
    flats: cleanNumber(row.flats),
    win_rate_pct: cleanNumber(row.win_rate_pct ?? row.winRate),
    total_pnl: cleanNumber(row.total_pnl ?? row.pnl),
    avg_pnl: cleanNumber(row.avg_pnl),
    max_profit: cleanNumber(row.max_profit),
    max_loss: cleanNumber(row.max_loss),
    status: cleanText(row.status || "complete"),
    note: cleanText(row.note),
    source: cleanText(row.source || row.source_sheet || "scorecard-latest-json"),
  };
}

function scorecardRowsFromPayload(payload) {
  const records = dedupeBy(
    (Array.isArray(payload.records) ? payload.records : [])
    .map(normalizeRecord)
    .filter((row) => row.record_date && row.ticker),
    (row) => row.record_id,
  );
  const daily = dedupeBy(
    (Array.isArray(payload?.summary?.daily) ? payload.summary.daily : [])
    .map(normalizeDaily)
    .filter((row) => row.summary_date && row.strategy),
    (row) => `${row.summary_date}|||${row.strategy}`,
  );
  return {
    records,
    daily: daily.length ? daily : summarizeRows(records),
  };
}

function dedupeBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = cleanText(keyFn(row));
    if (!key) continue;
    map.set(key, row);
  }
  return [...map.values()];
}

async function chunkedUpsert(table, rows, conflict, size = 500) {
  let total = 0;
  for (let index = 0; index < rows.length; index += size) {
    const slice = rows.slice(index, index + size);
    await restUpsert(table, slice, conflict);
    total += slice.length;
  }
  return total;
}

async function probe() {
  const result = {};
  for (const table of ["trade_records", "strategy_daily_summary", "v_scorecard_source_health"]) {
    const response = await restGet(table, "select=*&limit=1");
    result[table] = {
      ok: response.ok,
      status: response.status,
      sample: Array.isArray(response.json) ? response.json[0] || null : response.json,
      reason: response.ok ? "" : (response.json?.message || response.text.slice(0, 240)),
    };
  }
  return result;
}

async function applyContract() {
  const sql = fs.readFileSync(CONTRACT_FILE, "utf8");
  const result = await pgMetaQuery(sql);
  if (!result.ok) {
    const compact = result.attempts.map((item) => `${item.endpoint} HTTP ${item.status}: ${item.text}`).join(" | ");
    throw new Error(`DDL apply unavailable through Supabase REST/pg-meta: ${compact}`);
  }
  return result;
}

async function backfill() {
  const payload = readJson(arg("source-file", SOURCE_FILE));
  const { records, daily } = scorecardRowsFromPayload(payload);
  if (!records.length) throw new Error("source payload has no scorecard records");
  if (!daily.length) throw new Error("source payload has no daily summaries and could not derive any");
  const latestDate = records.map((row) => row.record_date).sort().at(-1) || "";
  const historyCutoff = dateDaysAgo(SCORECARD_HISTORY_DAYS);
  const isTerminalCompleteRun = records.some((row) => row.source === TERMINAL_SCORECARD_SOURCE)
    || cleanText(payload.exportSource) === TERMINAL_SCORECARD_SOURCE;
  const cleanup = { skipped: true };
  if (isTerminalCompleteRun && latestDate) {
    cleanup.skipped = false;
    cleanup.terminalSource = {
      currentTradeRecords: await restDelete(
        "trade_records",
        `source=eq.${encodeURIComponent(TERMINAL_SCORECARD_SOURCE)}&record_date=eq.${encodeURIComponent(latestDate)}`,
      ),
      currentDailyRows: await restDelete(
        "strategy_daily_summary",
        `source=eq.${encodeURIComponent(TERMINAL_SCORECARD_SOURCE)}&summary_date=eq.${encodeURIComponent(latestDate)}`,
      ),
      tradeRecords: await restDelete(
        "trade_records",
        `source=eq.${encodeURIComponent(TERMINAL_SCORECARD_SOURCE)}&record_date=lt.${encodeURIComponent(historyCutoff)}`,
      ),
      dailyRows: await restDelete(
        "strategy_daily_summary",
        `source=eq.${encodeURIComponent(TERMINAL_SCORECARD_SOURCE)}&summary_date=lt.${encodeURIComponent(historyCutoff)}`,
      ),
    };
    cleanup.legacyStrategies = [];
    for (const strategy of TERMINAL_SCORECARD_STRATEGIES) {
      cleanup.legacyStrategies.push({
        strategy,
        currentTradeRecords: await restDelete(
          "trade_records",
          `strategy=eq.${encodeURIComponent(strategy)}&record_date=eq.${encodeURIComponent(latestDate)}`,
        ),
        currentDailyRows: await restDelete(
          "strategy_daily_summary",
          `strategy=eq.${encodeURIComponent(strategy)}&summary_date=eq.${encodeURIComponent(latestDate)}`,
        ),
        tradeRecords: await restDelete(
          "trade_records",
          `strategy=eq.${encodeURIComponent(strategy)}&record_date=lt.${encodeURIComponent(historyCutoff)}`,
        ),
        dailyRows: await restDelete(
          "strategy_daily_summary",
          `strategy=eq.${encodeURIComponent(strategy)}&summary_date=lt.${encodeURIComponent(historyCutoff)}`,
        ),
      });
    }
  }
  const tradeRows = await chunkedUpsert("trade_records", records, "record_id");
  const dailyRows = await chunkedUpsert("strategy_daily_summary", daily, "summary_date,strategy");
  return {
    sourceFile: arg("source-file", SOURCE_FILE),
    latestDate,
    historyDays: SCORECARD_HISTORY_DAYS,
    historyCutoff,
    cleanup,
    tradeRows,
    dailyRows,
  };
}

async function health() {
  const response = await restGet("v_scorecard_source_health", "select=*&limit=1");
  if (!response.ok) throw new Error(`health view unavailable HTTP ${response.status}: ${(response.json?.message || response.text).slice(0, 300)}`);
  return Array.isArray(response.json) ? response.json[0] || null : response.json;
}

async function main() {
  const selected = mode();
  const result = { ok: true, mode: selected, checkedAt: new Date().toISOString() };
  if (selected === "probe") result.probe = await probe();
  else if (selected === "apply") result.apply = await applyContract();
  else if (selected === "backfill") result.backfill = await backfill();
  else if (selected === "health") result.health = await health();
  else if (selected === "all") {
    result.apply = has("skip-apply") ? { skipped: true } : await applyContract();
    result.backfill = await backfill();
    result.health = await health();
  } else {
    throw new Error(`unknown mode: ${selected}`);
  }
  writeReceipt(result);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  const payload = {
    ok: false,
    mode: mode(),
    checkedAt: new Date().toISOString(),
    error: error?.message || String(error),
  };
  try { writeReceipt(payload); } catch {}
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
});
