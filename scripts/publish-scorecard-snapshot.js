const fs = require("fs");
const path = require("path");
const { readSnapshot, upsertSnapshot } = require("../lib/supabase-snapshots");

const ROOT = path.resolve(__dirname, "..");
const SNAPSHOT_KEY = process.env.FUMAN_SCORECARD_SNAPSHOT_KEY || "scorecard_latest";
const SNAPSHOT_FILE = path.resolve(process.argv.find((arg) => arg.startsWith("--file="))?.slice("--file=".length)
  || process.env.FUMAN_SCORECARD_SNAPSHOT_FILE
  || path.join(ROOT, "data", "scorecard-latest.json"));
const SCORECARD_CONTRACT = "scorecard-resource-chain-v1";
const MIN_ROWS = Number(process.env.FUMAN_SCORECARD_MIN_ROWS || "450") || 0;
const MIN_ROW_RATIO = Number(process.env.FUMAN_SCORECARD_MIN_ROW_RATIO || "0.8") || 0;
const PUBLISH_TIMEOUT_MS = Math.max(120000, Number(process.env.FUMAN_SCORECARD_PUBLISH_TIMEOUT_MS || "120000") || 120000);
const ALLOW_PREVIOUS_LATEST_DATE = process.argv.includes("--allow-previous-latest-date")
  || process.env.FUMAN_SCORECARD_ALLOW_PREVIOUS_LATEST_DATE === "1";

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function compactDate(value) {
  return cleanText(value).replace(/\D/g, "").slice(0, 8);
}

function compareDateKey(a, b) {
  return compactDate(a).localeCompare(compactDate(b));
}

function compactTimestamp(value) {
  return cleanText(value).replace(/\D/g, "").slice(0, 14);
}

function latestDate(payload) {
  return cleanText(payload?.latestDate || payload?.summary?.latestDate || "");
}

function rowCount(payload) {
  return Array.isArray(payload?.records) ? payload.records.length : 0;
}

function rowSource(row = {}, fallback = "") {
  return cleanText(row.dataSource || row.data_source || row.source || row.source_sheet || fallback);
}

function normalizeRecord(row = {}, fallback = "scorecard") {
  const source = rowSource(row, fallback);
  return {
    ...row,
    source,
    dataSource: source,
    source_sheet: cleanText(row.source_sheet || source),
  };
}

function normalizePayload(payload) {
  const source = cleanText(payload.source || "supabase:scorecard_snapshot");
  const latestDate = cleanText(payload.latestDate || payload.summary?.latestDate || "");
  const updatedAt = cleanText(payload.updatedAt || new Date().toISOString());
  const runId = cleanText(payload.runId || `scorecard-${compactDate(latestDate) || "unknown"}-${compactTimestamp(updatedAt) || "snapshot"}`);
  const records = Array.isArray(payload.records)
    ? payload.records.map((row) => normalizeRecord(row, payload.exportSource || source))
    : [];
  const summary = payload.summary && typeof payload.summary === "object" ? { ...payload.summary } : {};
  const sourceReports = Array.isArray(payload.sourceReports)
    ? payload.sourceReports.map((row) => ({ ...row }))
    : [];
  if (Array.isArray(summary.daily)) {
    summary.daily = summary.daily.map((row) => normalizeRecord(row, "回測摘要"));
  }
  return {
    ...payload,
    contract: cleanText(payload.contract || SCORECARD_CONTRACT),
    qualityStatus: cleanText(payload.qualityStatus || "complete"),
    marketDate: cleanText(payload.marketDate || latestDate),
    runId,
    source,
    records,
    summary,
    sourceReports,
    sourceFields: {
      source,
      cacheSource: cleanText(payload.cacheSource || "supabase-snapshot"),
      exportSource: cleanText(payload.exportSource || source),
    },
  };
}

function readPayload() {
  const payload = normalizePayload(JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf8")));
  if (!payload || payload.ok === false || !Array.isArray(payload.records)) {
    throw new Error(`invalid scorecard snapshot payload: ${SNAPSHOT_FILE}`);
  }
  return {
    ...payload,
    source: "supabase:scorecard_snapshot",
    cacheSource: "supabase-snapshot",
    updatedAt: new Date().toISOString(),
  };
}

async function main() {
  const payload = readPayload();
  const payloadLatestDate = latestDate(payload);
  const expectedDate = cleanText(argValue("--expected-date", process.env.FUMAN_SCANNER_TARGET_DATE || process.env.FUMAN_SCANNER_TARGET_TRADE_DATE || process.env.FUMAN_SCORECARD_EXPECTED_DATE || ""));
  const tradeDate = compactDate(payloadLatestDate);
  if (!tradeDate) {
    throw new Error("refusing to publish scorecard_latest without latestDate");
  }
  if (expectedDate && compactDate(expectedDate) !== tradeDate && !ALLOW_PREVIOUS_LATEST_DATE) {
    throw new Error(`refusing to publish scorecard_latest latestDate=${payloadLatestDate}; expectedDate=${expectedDate}`);
  }
  const records = rowCount(payload);
  if (records < MIN_ROWS) {
    throw new Error(`refusing to publish scorecard_latest rows=${records}; minRows=${MIN_ROWS}`);
  }
  const current = await readSnapshot(SNAPSHOT_KEY, { allowLatestFallback: true, timeoutMs: 30000 }).catch(() => null);
  const currentLatestDate = latestDate(current?.payload);
  const currentRows = rowCount(current?.payload);
  if (currentLatestDate && compareDateKey(payloadLatestDate, currentLatestDate) < 0) {
    throw new Error(`refusing to roll back scorecard_latest from ${currentLatestDate} to ${payloadLatestDate}`);
  }
  if (currentLatestDate && compactDate(payloadLatestDate) === compactDate(currentLatestDate) && currentRows > 0) {
    const minRowsFromCurrent = Math.floor(currentRows * MIN_ROW_RATIO);
    if (records < minRowsFromCurrent) {
      throw new Error(`refusing to shrink scorecard_latest rows=${records}; currentRows=${currentRows}; minRowsFromCurrent=${minRowsFromCurrent}`);
    }
  }
  const result = await upsertSnapshot(SNAPSHOT_KEY, payload, {
    tradeDate,
    source: "scorecard_latest",
    reason: "daily-scorecard-snapshot",
    timeoutMs: PUBLISH_TIMEOUT_MS,
  });
  if (!result.ok) {
    console.error(JSON.stringify({ ok: false, publish: result }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({
    ok: true,
    key: SNAPSHOT_KEY,
    tradeDate: result.tradeDate,
    rows: payload.records.length,
    latestDate: payloadLatestDate,
    previousLatestDate: currentLatestDate,
    previousRows: currentRows,
    cacheSource: payload.cacheSource,
  }, null, 2));
}

main().catch((error) => {
  console.error(`[publish-scorecard-snapshot] failed: ${error.stack || error.message}`);
  process.exit(1);
});
