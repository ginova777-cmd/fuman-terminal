const fs = require("fs");
const path = require("path");
const { upsertSnapshot } = require("../lib/supabase-snapshots");

const ROOT = path.resolve(__dirname, "..");
const SNAPSHOT_KEY = process.env.FUMAN_SCORECARD_SNAPSHOT_KEY || "scorecard_latest";
const SNAPSHOT_FILE = path.resolve(process.argv.find((arg) => arg.startsWith("--file="))?.slice("--file=".length)
  || process.env.FUMAN_SCORECARD_SNAPSHOT_FILE
  || path.join(ROOT, "data", "scorecard-latest.json"));

function cleanText(value) {
  return String(value ?? "").trim();
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
  const records = Array.isArray(payload.records)
    ? payload.records.map((row) => normalizeRecord(row, payload.exportSource || source))
    : [];
  const summary = payload.summary && typeof payload.summary === "object" ? { ...payload.summary } : {};
  if (Array.isArray(summary.daily)) {
    summary.daily = summary.daily.map((row) => normalizeRecord(row, "回測摘要"));
  }
  return {
    ...payload,
    source,
    records,
    summary,
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
  const tradeDate = String(payload.latestDate || payload.summary?.latestDate || "").replace(/\D/g, "").slice(0, 8);
  const result = await upsertSnapshot(SNAPSHOT_KEY, payload, {
    tradeDate,
    source: "scorecard_latest",
    reason: "daily-scorecard-snapshot",
    timeoutMs: 30000,
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
    latestDate: payload.latestDate || payload.summary?.latestDate || "",
    cacheSource: payload.cacheSource,
  }, null, 2));
}

main().catch((error) => {
  console.error(`[publish-scorecard-snapshot] failed: ${error.stack || error.message}`);
  process.exit(1);
});
