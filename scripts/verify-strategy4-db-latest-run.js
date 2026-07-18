const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
function readSecret(name) {
  for (const file of [path.join(RUNTIME_DIR, "secrets", name), path.join(ROOT, "secrets", name)]) {
    try { return fs.readFileSync(file, "utf8").trim(); } catch {}
  }
  return "";
}
const SUPABASE_URL = (process.env.STRATEGY4_SUPABASE_URL || process.env.SUPABASE_URL || readSecret("supabase-url.txt") || "").replace(/\/+$/, "");
const SUPABASE_KEY = process.env.STRATEGY4_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || readSecret("supabase-service-role-key.txt") || readSecret("terminal-supabase-key.txt") || readSecret("supabase-anon-key.txt");
const RUNS_TABLE = process.env.STRATEGY4_SUPABASE_RUNS_TABLE || "strategy4_scan_runs";
const RESULTS_TABLE = process.env.STRATEGY4_SUPABASE_RESULTS_TABLE || "strategy4_scan_results";
const MIN_ACCEPTED_COVERAGE_RATIO = Number(process.env.STRATEGY4_MIN_ACCEPTED_COVERAGE_RATIO || 0.95);
function query(params) { const search = new URLSearchParams(); Object.entries(params).forEach(([key, value]) => search.set(key, String(value))); return search.toString(); }
async function supabase(pathname, init = {}) {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("missing Supabase URL/key");
  const response = await fetch(`${SUPABASE_URL}${pathname}`, { ...init, headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Accept: "application/json", ...(init.headers || {}) } });
  const text = await response.text();
  if (!response.ok && response.status !== 206) throw new Error(`${pathname} HTTP ${response.status} ${text.slice(0, 240)}`.trim());
  let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
  return { response, text, json };
}
function summarizeCoverage(coverage) {
  if (!coverage || typeof coverage !== "object") return null;
  const remainingMissing = Array.isArray(coverage.remainingMissing)
    ? coverage.remainingMissing.map((item) => ({
      code: String(item?.code || item?.symbol || ""),
      lastDate: String(item?.lastDate || ""),
      rows: Number(item?.rows || 0),
      source: String(item?.source || ""),
    })).filter((item) => /^\d{4}$/.test(item.code)).slice(0, 50)
    : [];
  return {
    ok: coverage.ok === true,
    phase: String(coverage.phase || ""),
    source: String(coverage.source || ""),
    universe: Number(coverage.universe || 0),
    coverageRatio: Number(coverage.coverageRatio || 0),
    remainingMiss: Number(coverage.remainingMiss || 0),
    rawRemainingMiss: Number(coverage.rawRemainingMiss || 0),
    qualityStatus: String(coverage.qualityStatus || ""),
    acceptedReason: String(coverage.acceptedReason || ""),
    supabaseVolumeRows: Number(coverage.supabaseVolumeRows || 0),
    insufficientHistoryCount: Number(coverage.insufficientHistoryCount || 0),
    remainingMissing,
  };
}
async function main() {
  const latestRun = await supabase(`/rest/v1/${RUNS_TABLE}?${query({ select: "*", strategy: "eq.strategy4", status: "eq.complete", order: "updated_at.desc", limit: 1 })}`);
  const row = Array.isArray(latestRun.json) ? latestRun.json[0] : null;
  if (!row?.run_id) throw new Error("missing latest complete Strategy4 run");
  const countResp = await supabase(`/rest/v1/${RESULTS_TABLE}?${query({ select: "run_id", run_id: `eq.${row.run_id}` })}`, { headers: { Prefer: "count=exact", Range: "0-0" } });
  const range = countResp.response.headers.get("content-range") || "";
  const match = range.match(/\/(\d+)$/);
  const readbackCount = match ? Number(match[1]) || 0 : 0;
  const resultCount = Number(row.result_count || 0);
  const expectedTotal = Number(row.expected_total || 0);
  const scannedCount = Number(row.scanned_count || 0);
  const qualityStatus = String(row.quality_status || "");
  const noDataCount = Number(row.no_data_count || 0);
  const errorCount = Number(row.error_count || 0);
  const coverage = summarizeCoverage(row.payload?.supabaseCoverage || row.payload?.selfTest?.sourceHealth?.supabaseCoverage || null);
  const coverageAccepted = coverage && Number(coverage.coverageRatio || 0) >= MIN_ACCEPTED_COVERAGE_RATIO
    && (Number(coverage.remainingMiss || 0) === 0 || Number(coverage.remainingMiss || 0) === noDataCount);
  const qualityAccepted = qualityStatus === "complete" || (qualityStatus === "degraded" && coverageAccepted);
  const ok = row.complete === true && qualityAccepted && expectedTotal > 0 && scannedCount === expectedTotal && resultCount > 0 && readbackCount === resultCount && errorCount === 0;
  console.log(JSON.stringify({ ok, runId: row.run_id, updatedAt: row.updated_at || row.finished_at || "", expectedTotal, scannedCount, resultCount, readbackCount, qualityStatus, qualityAccepted, complete: row.complete === true, noDataCount, errorCount, sourceSnapshotCapturedAt: row.payload?.source_snapshot_captured_at || row.payload?.generatedAt || row.generated_at || "", supabaseCoverage: coverage }, null, 2));
  if (!ok) process.exitCode = 1;
}
main().catch((error) => { console.error(JSON.stringify({ ok: false, error: error.message }, null, 2)); process.exit(1); });
