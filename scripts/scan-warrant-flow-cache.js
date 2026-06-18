const fs = require("fs");
const path = require("path");
const scanWarrantFlow = require("../api/scan-warrant-flow");
const { writeSummary } = require("./cache-summary");

const { ROOT, dataPath, repoPath } = require("./runtime-paths");
const OUT_FILE = dataPath("warrant-flow-latest.json");
const BACKUP_FILE = dataPath("warrant-flow-backup.json");
const SUMMARY_FILE = dataPath("warrant-flow-summary.json");
const STOCK_QUOTES_FILE = dataPath("stocks-quotes-slim.json");
const SYNC_ROOT = process.env.FUMAN_SYNC_DIR || "C:\\fuman-terminal-sync";
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = (
  process.env.SUPABASE_URL
  || process.env.FUMAN_SUPABASE_URL
  || readSecretText(path.join(RUNTIME_DIR, "secrets", "supabase-url.txt"))
  || "https://cpmpfhbzutkiecccekfr.supabase.co"
).replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.FUMAN_SUPABASE_SERVICE_ROLE_KEY
  || readSecretText(path.join(RUNTIME_DIR, "secrets", "supabase-service-role-key.txt"));
const WARRANT_FLOW_RUNS_TABLE = process.env.WARRANT_FLOW_SUPABASE_RUNS_TABLE || "warrant_flow_scan_runs";
const WARRANT_FLOW_RESULTS_TABLE = process.env.WARRANT_FLOW_SUPABASE_RESULTS_TABLE || "warrant_flow_scan_results";
const WARRANT_FLOW_API_ONLY = true;

function readSecretText(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
}

function writeLatestToRoots(payload) {
  for (const file of [...new Set([
    OUT_FILE,
    repoPath("data", "warrant-flow-latest.json"),
    path.join(SYNC_ROOT, "data", "warrant-flow-latest.json"),
  ])]) {
    writeJson(file, payload);
  }
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

function normalizeDateKey(value) {
  const text = String(value || "").trim();
  const roc = text.match(/^(\d{3})(\d{2})(\d{2})$/);
  if (roc) return `${1911 + Number(roc[1])}${roc[2]}${roc[3]}`;
  return text.replace(/\D/g, "").slice(0, 8);
}

function dateForSupabase(value) {
  const key = normalizeDateKey(value);
  if (key.length === 8) return `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;
  return new Date().toISOString().slice(0, 10);
}

function warrantFlowRunIdFromOutput(output) {
  const date = normalizeDateKey(output.tradeDate || output.sourceDate || output.usedDate || output.updatedAt) || "unknown";
  const time = String(output.updatedAt || new Date().toISOString()).replace(/\D/g, "").slice(0, 14).padEnd(14, "0");
  return String(output.runId || process.env.WARRANT_FLOW_RUN_ID || `warrant-flow-${date}-${time}`).replace(/[^a-zA-Z0-9_-]/g, "-");
}

async function upsertSupabaseRows(table, rows, conflict) {
  if (!rows.length) return;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("warrant-flow supabase credentials missing");
  const batchSize = Math.max(1, Number(process.env.WARRANT_FLOW_SUPABASE_BATCH_SIZE || 300));
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${encodeURIComponent(conflict)}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(chunk),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`${table} upsert HTTP ${response.status}: ${text.slice(0, 240)}`);
    }
  }
}

function buildWarrantFlowRunRow(output, runId, status = "complete") {
  const complete = status === "complete";
  const scanTime = String(output.updatedAt || new Date().toISOString());
  const resultCount = cleanNumber(output.count) + cleanNumber(output.volumeCount) + cleanNumber(output.singleSignalCount);
  return {
    run_id: runId,
    strategy: "warrant_flow",
    scan_date: dateForSupabase(output.tradeDate || output.sourceDate || output.usedDate || output.updatedAt),
    started_at: String(output.startedAt || output.updatedAt || new Date().toISOString()),
    finished_at: complete ? scanTime : null,
    status,
    expected_total: resultCount,
    scanned_count: resultCount,
    result_count: complete ? resultCount : 0,
    complete,
    quality_status: complete ? "complete" : status,
    source: String(output.source || "").trim(),
    schema_version: output.schemaVersion || "warrant-flow-run-id-complete-v1",
    data_contract_source: output.dataContractSource || "warrant-flow-cache",
    generated_at: scanTime,
    updated_at: scanTime,
    payload: {
      count: cleanNumber(output.count),
      volumeCount: cleanNumber(output.volumeCount),
      singleSignalCount: cleanNumber(output.singleSignalCount),
      tradeDate: output.tradeDate || "",
      sourceDate: output.sourceDate || "",
    },
  };
}

function warrantCode(item, type, index) {
  return String(item.warrantCode || item.code || item.underlyingCode || `${type}-${index + 1}`).trim();
}

function buildWarrantFlowResultRows(output, runId) {
  const scanDate = dateForSupabase(output.tradeDate || output.sourceDate || output.usedDate || output.updatedAt);
  const scanTime = String(output.updatedAt || new Date().toISOString());
  const groups = [
    ["match", output.matches || []],
    ["volume", output.volumeMatches || []],
    ["single", output.singleSignals || []],
  ];
  const rows = [];
  for (const [type, items] of groups) {
    items.forEach((item, index) => {
      rows.push({
        run_id: runId,
        strategy: "warrant_flow",
        result_type: type,
        scan_date: scanDate,
        code: warrantCode(item, type, index),
        name: String(item.warrantName || item.name || item.underlyingName || "").trim(),
        underlying_code: String(item.underlyingCode || item.code || "").trim(),
        underlying_name: String(item.underlyingName || item.name || "").trim(),
        close: cleanNumber(item.underlyingClose || item.displayClose || item.close),
        change_percent: cleanNumber(item.underlyingPercent ?? item.displayPercent ?? item.percent),
        trade_value: cleanNumber(item.callValue || item.value || item.tradeValue),
        score: cleanNumber(item.finalScore || item.score),
        rank: index + 1,
        reason: String(item.reason || item.actionLabel || "").trim(),
        payload: item,
        complete: true,
        quality_status: "complete",
        schema_version: output.schemaVersion || "warrant-flow-run-id-complete-v1",
        data_contract_source: output.dataContractSource || "warrant-flow-cache",
        generated_at: scanTime,
        updated_at: scanTime,
      });
    });
  }
  return rows.filter((row) => row.code);
}

async function publishWarrantFlowCompleteRunToSupabase(output) {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    console.warn("warrant-flow supabase run_id gate skipped: missing service role key");
    return null;
  }
  const runId = warrantFlowRunIdFromOutput(output);
  const running = buildWarrantFlowRunRow(output, runId, "running");
  const rows = buildWarrantFlowResultRows(output, runId);
  await upsertSupabaseRows(WARRANT_FLOW_RUNS_TABLE, [running], "run_id");
  await upsertSupabaseRows(WARRANT_FLOW_RESULTS_TABLE, rows, "run_id,strategy,result_type,code");
  await upsertSupabaseRows(WARRANT_FLOW_RUNS_TABLE, [buildWarrantFlowRunRow(output, runId, "complete")], "run_id");
  console.log(`warrant-flow supabase run_id gate ok: ${runId}, rows ${rows.length}`);
  return runId;
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

function normalizeVolumeMatch(item, quoteMap = new Map()) {
  const normalized = normalizeMatch(item, quoteMap);
  return {
    ...normalized,
    thirtyMinuteVolume: cleanNumber(item.thirtyMinuteVolume),
    floatingUnits: cleanNumber(item.floatingUnits),
    volumeMultiple: cleanNumber(item.volumeMultiple),
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
  const volumeMatches = Array.isArray(payload.volumeMatches)
    ? payload.volumeMatches.map((item) => normalizeVolumeMatch(item, stockQuoteMap))
    : [];
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
    volumeCount: volumeMatches.length,
    volumeMatches,
    singleSignalCount: singleSignals.length,
    singleSignals,
  };
  output.tradeDate = [...new Set(matches.map((item) => String(item.tradeDate || "")).filter(Boolean))].sort().at(-1) || output.tradeDate || "";
  output.runId = warrantFlowRunIdFromOutput(output);
  output.complete = true;
  output.schemaVersion = output.schemaVersion || "warrant-flow-run-id-complete-v1";
  output.dataContractSource = output.dataContractSource || "warrant-flow-cache";

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

  await publishWarrantFlowCompleteRunToSupabase(output);

  if (WARRANT_FLOW_API_ONLY) {
    console.log(`warrant-flow API-only: skipped static warrant-flow*.json output, matches ${matches.length}, tradeDate ${newestTradeDate || "--"}`);
    return;
  }
  writeLatestToRoots(output);
  writeSummary("warrant", output, SUMMARY_FILE);
  writeJson(BACKUP_FILE, { ...output, source: "github-actions-backup" });
  console.log(`warrant-flow cache updated: matches ${matches.length}, tradeDate ${newestTradeDate || "--"}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
