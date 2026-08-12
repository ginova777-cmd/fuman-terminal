"use strict";
const fs = require("fs");
const path = require("path");
const { terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const OUT_DIR = path.join(RUNTIME_DIR, "data", "scan-receipts");
const SUPABASE_URL = terminalSupabaseUrl({ root: ROOT, runtimeDir: RUNTIME_DIR }).replace(/\/+$/, "");
const SUPABASE_KEY = terminalSupabaseKey({ root: ROOT, runtimeDir: RUNTIME_DIR });
const RUNS_TABLE = process.env.STRATEGY4_SUPABASE_RUNS_TABLE || "strategy4_scan_runs";
const RESULTS_TABLE = process.env.STRATEGY4_SUPABASE_RESULTS_TABLE || "strategy4_scan_results";
const LOOKBACK = Number(process.env.STRATEGY4_MATCH_YIELD_BASELINE_LOOKBACK || 20);
const MIN_NORMAL_COUNT = Number(process.env.STRATEGY4_MATCH_YIELD_MIN_NORMAL_COUNT || 100);
const MIN_BASELINE_SAMPLES = Number(process.env.STRATEGY4_MATCH_YIELD_MIN_BASELINE_SAMPLES || 3);
const MIN_RATIO_TO_BASELINE = Number(process.env.STRATEGY4_MATCH_YIELD_MIN_RATIO_TO_BASELINE || 0.5);
const MIN_RATIO_TO_ELIGIBLE = Number(process.env.STRATEGY4_MATCH_YIELD_MIN_RATIO_TO_ELIGIBLE || 0.05);
const MIN_SOURCE_ROWS_RAW = Number(process.env.STRATEGY4_STANDARD_MIN_SOURCE_ROWS || 1500);
const MIN_SOURCE_ROWS = Number.isFinite(MIN_SOURCE_ROWS_RAW) ? Math.max(1500, MIN_SOURCE_ROWS_RAW) : 1500;

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,%%+]/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}
function compactDate(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 8 ? digits.slice(0, 8) : "";
}
function taipeiDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}${get("month")}${get("day")}`;
}
function median(values) {
  const nums = values.map(cleanNumber).filter((value) => value > 0).sort((a, b) => a - b);
  if (!nums.length) return 0;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}
function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
async function supabaseRows(pathname) {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("missing_supabase_credentials");
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Accept: "application/json" },
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${pathname} HTTP ${response.status} ${text.slice(0, 240)}`.trim());
  return text ? JSON.parse(text) : [];
}
async function latestRun(runId = "") {
  const select = encodeURIComponent("run_id,scan_date,status,complete,expected_total,scanned_count,result_count,no_data_count,error_count,quality_status,finished_at,payload");
  const query = runId
    ? `${RUNS_TABLE}?select=${select}&run_id=eq.${encodeURIComponent(runId)}&limit=1`
    : `${RUNS_TABLE}?select=${select}&strategy=eq.strategy4&status=eq.complete&complete=eq.true&order=finished_at.desc&limit=1`;
  const rows = await supabaseRows(query);
  return Array.isArray(rows) ? rows[0] : null;
}
async function recentRuns() {
  const select = encodeURIComponent("run_id,scan_date,status,complete,expected_total,scanned_count,result_count,no_data_count,error_count,quality_status,finished_at,payload");
  const rows = await supabaseRows(`${RUNS_TABLE}?select=${select}&strategy=eq.strategy4&status=eq.complete&complete=eq.true&order=finished_at.desc&limit=${LOOKBACK}`);
  return Array.isArray(rows) ? rows : [];
}
async function latestRows(runId) {
  const select = encodeURIComponent("run_id,code,rank,price,change_percent,score,zone,payload");
  const rows = await supabaseRows(`${RESULTS_TABLE}?select=${select}&strategy=eq.strategy4&run_id=eq.${encodeURIComponent(runId)}&order=rank.asc&limit=500`);
  return Array.isArray(rows) ? rows : [];
}
function volumeFilterContract(run) {
  const filter = safeObject(safeObject(run?.payload).volumeFilter);
  return { enabled: filter.enabled === true, threshold: cleanNumber(filter.minAvgVolume5 || filter.threshold) };
}
function sameVolumeFilterContract(left, right) {
  const a = volumeFilterContract(left);
  const b = volumeFilterContract(right);
  return a.enabled === b.enabled && (!a.enabled || a.threshold === b.threshold);
}
function eligibleCountFromRun(run) {
  const payload = safeObject(run?.payload);
  const total = cleanNumber(run?.expected_total || payload.total || payload.expectedTotal);
  const volumeFiltered = cleanNumber(payload.volumeFilteredCount || payload.volumeFilter?.filtered?.length);
  const quoteFiltered = cleanNumber(payload.quoteLiquidityFilteredCount || payload.quoteLiquidityFilter?.filtered?.length);
  const noData = cleanNumber(run?.no_data_count || payload.noDataCount);
  const errors = cleanNumber(run?.error_count || payload.errorCount);
  return Math.max(0, total - volumeFiltered - quoteFiltered - noData - errors);
}
function sourceHealthFromRun(run) {
  const payload = safeObject(run?.payload);
  const coverage = safeObject(payload.supabaseCoverage);
  const publishGate = safeObject(payload.supabasePublishGate);
  return {
    dataContractSource: String(run?.data_contract_source || payload.dataContractSource || ""),
    sourceLatestDate: String(coverage.latestDate || coverage.selectedDate || publishGate.latestDate || payload.sourceLatestDate || ""),
    sourceTargetDate: String(coverage.targetDate || coverage.scanStamp || payload.scanStamp || run?.scan_date || ""),
    minRequiredRows: cleanNumber(coverage.minRequiredRows || publishGate.minRequiredRows || MIN_SOURCE_ROWS),
    rowCount: cleanNumber(coverage.rowCount || publishGate.rowCount),
    dateAligned: coverage.dateAligned ?? publishGate.dateAligned ?? null,
  };
}
async function main() {
  const expectedDate = compactDate(process.argv.find((arg) => arg.startsWith("--date="))?.slice("--date=".length)) || taipeiDateKey();
  const requestedRunId = String(process.argv.find((arg) => arg.startsWith("--run-id="))?.slice("--run-id=".length) || "").trim();
  const current = await latestRun(requestedRunId);
  if (!current?.run_id) throw new Error("strategy4_complete_run_missing");
  const history = await recentRuns();
  const rows = await latestRows(current.run_id);
  const historyBeforeCurrent = history.filter((run) => run.run_id !== current.run_id);
  const normalHistory = historyBeforeCurrent.filter((run) =>
    run.complete === true
    && String(run.status || "") === "complete"
    && ["complete", "degraded"].includes(String(run.quality_status || ""))
    && cleanNumber(run.expected_total) >= MIN_SOURCE_ROWS
    && cleanNumber(run.scanned_count) >= cleanNumber(run.expected_total)
    && cleanNumber(run.result_count) >= MIN_NORMAL_COUNT
  );
  const activeVolumeFilter = volumeFilterContract(current);
  // Baselines are meaningful only for the same persisted selection contract.
  const compatibleNormalHistory = normalHistory.filter((run) => sameVolumeFilterContract(run, current));
  const baselineCounts = compatibleNormalHistory.map((run) => cleanNumber(run.result_count));
  const baselineMedian = median(baselineCounts);
  const currentCount = cleanNumber(current.result_count);
  const expectedTotal = cleanNumber(current.expected_total);
  const scannedCount = cleanNumber(current.scanned_count);
  const eligibleCount = eligibleCountFromRun(current);
  const minByBaseline = baselineCounts.length >= MIN_BASELINE_SAMPLES ? Math.max(10, Math.floor(baselineMedian * MIN_RATIO_TO_BASELINE)) : 0;
  const minByEligible = eligibleCount >= MIN_NORMAL_COUNT ? Math.max(10, Math.floor(eligibleCount * MIN_RATIO_TO_ELIGIBLE)) : 0;
  const sourceHealth = sourceHealthFromRun(current);
  const issues = [];
  const warnings = [];

  if (current.run_id && !String(current.run_id).includes(expectedDate)) issues.push(`run_id_date_mismatch:${current.run_id}:expected=${expectedDate}`);
  if (expectedTotal < MIN_SOURCE_ROWS) issues.push(`expected_total_too_low:${expectedTotal}<${MIN_SOURCE_ROWS}`);
  if (scannedCount < expectedTotal) issues.push(`scan_not_complete:${scannedCount}/${expectedTotal}`);
  if (rows.length !== currentCount) issues.push(`result_rows_count_mismatch:${rows.length}/${currentCount}`);
  if (sourceHealth.minRequiredRows < MIN_SOURCE_ROWS) issues.push(`strategy4_source_min_rows_disabled:${sourceHealth.minRequiredRows}<${MIN_SOURCE_ROWS}`);
  const sourceLatest = compactDate(sourceHealth.sourceLatestDate);
  const sourceTarget = compactDate(sourceHealth.sourceTargetDate) || expectedDate;
  if (sourceLatest && sourceTarget && sourceLatest !== sourceTarget) issues.push(`strategy4_source_date_mismatch:${sourceLatest}:target=${sourceTarget}`);
  if (baselineCounts.length >= MIN_BASELINE_SAMPLES && currentCount < minByBaseline) {
    issues.push(`strategy4_match_yield_collapse:current=${currentCount}:baselineMedian=${baselineMedian}:min=${minByBaseline}`);
  } else if (baselineCounts.length < MIN_BASELINE_SAMPLES) {
    warnings.push(`baseline_samples_low:${baselineCounts.length}<${MIN_BASELINE_SAMPLES}`);
  }
  if (minByEligible && currentCount < minByEligible) {
    issues.push(`strategy4_match_yield_below_eligible_floor:current=${currentCount}:eligible=${eligibleCount}:min=${minByEligible}`);
  }

  const payload = {
    ok: issues.length === 0,
    verifier: "verify-strategy4-match-yield-diagnostics",
    checked_at: new Date().toISOString(),
    expectedDate,
    runId: current.run_id,
    scanDate: current.scan_date,
    status: current.status,
    qualityStatus: current.quality_status,
    expectedTotal,
    scannedCount,
    resultCount: currentCount,
    resultRows: rows.length,
    noDataCount: cleanNumber(current.no_data_count),
    errorCount: cleanNumber(current.error_count),
    eligibleCount,
    baseline: { lookback: LOOKBACK, minNormalCount: MIN_NORMAL_COUNT, minBaselineSamples: MIN_BASELINE_SAMPLES, sampleCount: baselineCounts.length, counts: baselineCounts, median: baselineMedian, minByBaseline, minRatioToBaseline: MIN_RATIO_TO_BASELINE },
    eligibleFloor: { minRatioToEligible: MIN_RATIO_TO_ELIGIBLE, minByEligible },
    sourceHealth,
    recentRuns: history.slice(0, 12).map((run) => ({ runId: run.run_id, scanDate: run.scan_date, resultCount: cleanNumber(run.result_count), expectedTotal: cleanNumber(run.expected_total), scannedCount: cleanNumber(run.scanned_count), qualityStatus: run.quality_status })),
    sample: rows.slice(0, 10).map((row) => ({ rank: cleanNumber(row.rank), code: row.code, price: cleanNumber(row.price), score: cleanNumber(row.score), zone: row.zone })),
    first_blocker: issues[0] || "",
    reason_code: issues.length ? "strategy4_match_yield_or_source_health_failed" : "strategy4_match_yield_ok",
    allowed_action: issues.length ? "fail_closed_repair_strategy4_source_prewarm_then_rerun_full_scan" : "allow_publish",
    warnings,
    issues,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const latestFile = path.join(OUT_DIR, "strategy4-match-yield-diagnostics-latest.json");
  const datedFile = path.join(OUT_DIR, `strategy4-match-yield-diagnostics-${expectedDate}.json`);
  fs.writeFileSync(latestFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.writeFileSync(datedFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(payload, null, 2));
  if (issues.length) process.exit(1);
}
main().catch((error) => {
  console.error(JSON.stringify({ ok: false, verifier: "verify-strategy4-match-yield-diagnostics", error: error?.message || String(error) }, null, 2));
  process.exit(1);
});
