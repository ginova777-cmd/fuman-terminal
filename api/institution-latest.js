const fs = require("fs");
const path = require("path");
const { readEndpointFromDesktopSnapshot } = require("../lib/desktop-route-snapshot-cache");
const { runTimeSourceSnapshotResponseFields, wrapJsonRunTimeSourceEvidence } = require("../lib/run-time-source-snapshot-contract");
const { terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");

function readSecretText(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = terminalSupabaseUrl({ runtimeDir: RUNTIME_DIR });
const SUPABASE_KEY = terminalSupabaseKey({ runtimeDir: RUNTIME_DIR });

const TABLE = process.env.INSTITUTION_SUPABASE_RESULTS_TABLE || "institution_scan_results";
const LATEST_RUN_VIEW = process.env.INSTITUTION_SUPABASE_LATEST_RUN_VIEW || "v_institution_latest_complete_run";
const INSTITUTION_FIELD_CONTRACT_VERSION = "buy-sell-derived-fields-20260629-01";

function setDesktopSnapshotCache(response) {
  response.setHeader("Cache-Control", "public, max-age=45, stale-while-revalidate=180");
  response.setHeader("CDN-Cache-Control", "public, max-age=45, stale-while-revalidate=240");
  response.setHeader("Vercel-CDN-Cache-Control", "public, max-age=45, stale-while-revalidate=240");
}

function apiOnlyError(reason = "") {
  return {
    ok: false,
    status: "critical",
    error: "institution_api_only_unavailable",
    detail: reason,
    cacheSource: "none",
    fieldContractVersion: INSTITUTION_FIELD_CONTRACT_VERSION,
    sourceCoverage: {},
    staleSeconds: 999999,
    latestRunId: "",
    fallbackUsed: false,
    writeBudget: { status: "blocked", allowed: false, reason },
    retentionOk: false,
    issues: [{ severity: "critical", id: "institution-api-unavailable", message: reason || "institution API unavailable" }],
    warnings: [],
    publishAllowed: false,
    data: {},
    rows: [],
    transport: {
      source: "supabase",
      latestRunView: LATEST_RUN_VIEW,
      gate: "complete-run-readback",
      via: "api/institution-latest",
      fetchedAt: new Date().toISOString(),
    },
  };
}

async function fetchRowsFrom(table, query) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${table} HTTP ${response.status} ${text.slice(0, 180)}`.trim());
  }
  const rows = await response.json();
  return Array.isArray(rows) ? rows : [];
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function readRequestOptions(request) {
  try {
    const url = new URL(request.url, `https://${request.headers.host || "localhost"}`);
    const canvas = url.searchParams.get("canvas") === "1";
    const compact = url.searchParams.get("compact") === "1" || url.searchParams.get("shell") === "1";
    const live = url.searchParams.get("live") === "1" || url.searchParams.get("noSnapshot") === "1";
    const smallPayload = canvas || compact;
    const limit = Math.max(1, Math.min(smallPayload ? 120 : 3000, cleanNumber(url.searchParams.get("limit")) || (smallPayload ? 80 : 3000)));
    const fieldContract = String(url.searchParams.get("fieldContract") || "").trim();
    return { canvas, compact, live, smallPayload, limit, fieldContract };
  } catch {
    return { canvas: false, compact: false, live: false, smallPayload: false, limit: 3000, fieldContract: "" };
  }
}

function payloadMatchesFieldContract(payload, requestedContract = "") {
  if (!requestedContract) return true;
  return String(payload?.fieldContractVersion || "") === requestedContract;
}

function payloadHasMachineState(payload) {
  return Boolean(
    payload
    && typeof payload === "object"
    && "ok" in payload
    && "status" in payload
    && payload.sourceCoverage
    && "staleSeconds" in payload
    && "latestRunId" in payload
    && "fallbackUsed" in payload
    && payload.writeBudget
    && "retentionOk" in payload
    && Array.isArray(payload.issues)
    && Array.isArray(payload.warnings)
  );
}

function normalizeRow(row) {
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  const foreign = cleanNumber(payload.foreign ?? row.foreign_net);
  const trust = cleanNumber(payload.trust ?? row.trust_net);
  const dealer = cleanNumber(payload.dealer ?? row.dealer_net);
  const total = cleanNumber(payload.total ?? row.total_net);
  const tradeVolume = cleanNumber(payload.tradeVolume || row.trade_volume);
  const fiveDayAvgVolume = cleanNumber(payload.fiveDayAvgVolume || payload.five_day_avg_volume);
  const foreignTrustBuyVolumePct = cleanNumber(payload.foreignTrustBuyVolumePct ?? payload.institutionBuyVolumePct ?? payload.foreignTrustVolumePct)
    || (fiveDayAvgVolume > 0 ? ((foreign + trust) / fiveDayAvgVolume) * 100 : 0);
  const foreignStreak = cleanNumber(payload.foreignStreak ?? payload.foreign_streak);
  const trustStreak = cleanNumber(payload.trustStreak ?? payload.trust_streak);
  const jointStreak = cleanNumber(payload.jointStreak ?? payload.joint_streak);
  return {
    ...payload,
    code: String(payload.code || row.code || "").trim(),
    name: String(payload.name || row.name || row.code || "").trim(),
    close: cleanNumber(payload.close || row.close),
    percent: cleanNumber(payload.percent ?? row.change_percent),
    tradeVolume,
    value: cleanNumber(payload.value || row.trade_value),
    foreign,
    trust,
    dealer,
    total,
    foreignNet: foreign,
    foreign_net: foreign,
    trustNet: trust,
    investmentTrustNet: trust,
    investment_trust_net: trust,
    dealerNet: dealer,
    dealer_net: dealer,
    totalNet: total,
    total_net: total,
    institutionTotalNet: total,
    institution_total_net: total,
    fiveDayAvgVolume,
    five_day_avg_volume: fiveDayAvgVolume,
    foreignTrustBuyVolumePct,
    foreignTrustVolumePct: foreignTrustBuyVolumePct,
    institutionBuyVolumePct: foreignTrustBuyVolumePct,
    foreignStreak,
    foreign_streak: foreignStreak,
    trustStreak,
    trust_streak: trustStreak,
    jointStreak,
    joint_streak: jointStreak,
  };
}

function normalizeSourceHealth(row = {}) {
  return {
    coverageStatus: String(row.coverage_status || row.coverageStatus || "").toLowerCase(),
    latestTradeDate: String(row.latest_trade_date || row.latestTradeDate || ""),
    institutionalRows: cleanNumber(row.institutional_rows || row.institutionalRows),
    marginRows: cleanNumber(row.margin_rows || row.marginRows),
    unifiedRows: cleanNumber(row.unified_rows || row.unifiedRows),
    validAfterExclusionRows: cleanNumber(row.valid_after_exclusion_rows || row.validAfterExclusionRows),
    minRequiredRows: cleanNumber(row.min_required_rows || row.minRequiredRows || 1500),
    reason: String(row.reason || ""),
    updatedAt: row.unified_latest_updated_at || row.margin_latest_updated_at || row.institutional_latest_updated_at || row.updated_at || "",
  };
}

function secondsSince(value) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) return 999999;
  return Math.max(0, Math.round((Date.now() - parsed) / 1000));
}

async function fetchInstitutionSourceHealth() {
  const rows = await fetchRowsFrom(
    "v_institution_source_health",
    [
      "select=coverage_status,latest_trade_date,institutional_rows,margin_rows,unified_rows,valid_after_exclusion_rows,min_required_rows,reason,unified_latest_updated_at,margin_latest_updated_at,institutional_latest_updated_at",
      "limit=1",
    ].join("&")
  );
  return normalizeSourceHealth(rows[0] || {});
}

function buildPayload(rows, run, options = {}) {
  const sorted = rows
    .slice()
    .sort((a, b) => cleanNumber(a.rank) - cleanNumber(b.rank) || String(a.code).localeCompare(String(b.code)))
    .map(normalizeRow);
  const outputRows = options.smallPayload ? sorted.slice(0, options.limit || 80) : sorted;
  const data = Object.fromEntries(outputRows.map((row) => [row.code, row]).filter(([code]) => code));
  const scanDate = String(run?.scan_date || rows[0]?.scan_date || "").replace(/-/g, "");
  const expectedTotal = cleanNumber(run?.expected_total);
  const scannedCount = cleanNumber(run?.scanned_count);
  const resultCount = cleanNumber(run?.result_count) || sorted.length;
  const sourceHealth = normalizeSourceHealth(options.sourceHealth || run?.payload?.sourceHealth || {});
  const sourceCoverageReady = sourceHealth.coverageStatus === "ready"
    && sourceHealth.validAfterExclusionRows >= sourceHealth.minRequiredRows;
  const sourceCoverage = {
    coverageStatus: sourceHealth.coverageStatus,
    latestTradeDate: sourceHealth.latestTradeDate,
    institutionalRows: sourceHealth.institutionalRows,
    marginRows: sourceHealth.marginRows,
    unifiedRows: sourceHealth.unifiedRows,
    validAfterExclusionRows: sourceHealth.validAfterExclusionRows,
    minRequiredRows: sourceHealth.minRequiredRows,
  };
  const issues = sourceCoverageReady ? [] : [{
    severity: "critical",
    id: "institution-source-coverage-not-ready",
    message: sourceHealth.reason || "institution source coverage is not ready",
    details: sourceCoverage,
  }];
  const warnings = [];
  const status = issues.length ? "degraded" : "ready";
  return {
    ok: true,
    status,
    source: "supabase:institution_scan_results",
    cacheSource: "supabase-api",
    ...runTimeSourceSnapshotResponseFields(run?.payload || {}),
    runId: String(run?.run_id || rows[0]?.run_id || ""),
    latestRunId: String(run?.run_id || rows[0]?.run_id || ""),
    updatedAt: String(run?.finished_at || rows[0]?.updated_at || new Date().toISOString()),
    usedDate: run?.payload?.usedDate || scanDate,
    quoteUpdatedAt: run?.payload?.quoteUpdatedAt || "",
    complete: true,
    qualityStatus: String(run?.quality_status || rows[0]?.quality_status || "complete"),
    schemaVersion: String(run?.schema_version || rows[0]?.schema_version || "institution-run-id-complete-v1"),
    dataContractSource: String(run?.data_contract_source || rows[0]?.data_contract_source || "institution-cache"),
    fieldContractVersion: INSTITUTION_FIELD_CONTRACT_VERSION,
    count: resultCount,
    returnedCount: outputRows.length,
    sourceCoverage,
    staleSeconds: secondsSince(sourceHealth.updatedAt || run?.finished_at || rows[0]?.updated_at),
    fallbackUsed: false,
    writeBudget: {
      status: sourceCoverageReady ? "allow" : "blocked",
      allowed: sourceCoverageReady,
      reason: sourceCoverageReady ? "institution source coverage ready" : "preserve previous complete run; source coverage degraded",
    },
    retentionOk: true,
    issues,
    warnings,
    publishAllowed: sourceCoverageReady,
    canvas: Boolean(options.canvas),
    compact: Boolean(options.compact),
    data,
    rows: outputRows,
    sourceHealth: {
      ...(run?.payload?.sourceHealth || {}),
      ...sourceHealth,
    },
    readback: {
      expectedTotal,
      scannedCount,
      resultCount,
      rowCount: sorted.length,
    },
    transport: {
      source: "supabase",
      table: TABLE,
      latestRunView: LATEST_RUN_VIEW,
      gate: "complete-run-readback",
      fieldContractVersion: INSTITUTION_FIELD_CONTRACT_VERSION,
      runId: String(run?.run_id || rows[0]?.run_id || ""),
      via: "api/institution-latest",
      fetchedAt: new Date().toISOString(),
    },
  };
}

async function fetchLatestCompleteRun() {
  const rows = await fetchRowsFrom(
    LATEST_RUN_VIEW,
    [
      "select=*",
      "strategy=eq.institution",
      "status=eq.complete",
      "complete=eq.true",
      "limit=1",
    ].join("&")
  );
  return rows[0]?.run_id ? rows[0] : null;
}

function validateCompleteRun(run) {
  if (!run?.run_id) throw new Error("institution_complete_run_missing");
  if (String(run.status || "") !== "complete" || run.complete !== true) throw new Error("institution_complete_run_not_complete");
  const expectedTotal = cleanNumber(run.expected_total);
  const scannedCount = cleanNumber(run.scanned_count);
  const resultCount = cleanNumber(run.result_count);
  if (expectedTotal <= 0) throw new Error("institution_expected_total_missing");
  if (scannedCount <= 0) throw new Error("institution_scanned_count_missing");
  if (expectedTotal !== scannedCount) throw new Error(`institution_scan_incomplete:${scannedCount}/${expectedTotal}`);
  if (resultCount <= 0) throw new Error("institution_result_count_missing");
}

function validateReadback(rows, run) {
  const resultCount = cleanNumber(run?.result_count);
  if (!rows.length) throw new Error("institution_complete_run_empty");
  if (resultCount > 0 && rows.length !== resultCount) {
    throw new Error(`institution_readback_count_mismatch:${rows.length}/${resultCount}`);
  }
  const incomplete = rows.find((row) => row.complete === false || String(row.quality_status || "complete") !== "complete");
  if (incomplete) throw new Error(`institution_readback_incomplete_row:${incomplete.code || ""}`);
}

async function fetchLatestCompleteRows() {
  const run = await fetchLatestCompleteRun();
  if (!run?.run_id) return { rows: [], run: null };
  validateCompleteRun(run);
  const rows = await fetchRowsFrom(
    TABLE,
    [
      "select=run_id,scan_date,code,name,close,change_percent,trade_volume,trade_value,foreign_net,trust_net,dealer_net,total_net,rank,reason,payload,complete,quality_status,schema_version,data_contract_source,generated_at,updated_at",
      "strategy=eq.institution",
      `run_id=eq.${encodeURIComponent(run.run_id)}`,
      "order=rank.asc",
      "limit=3000",
    ].join("&")
  );
  validateReadback(rows, run);
  return { rows, run };
}

module.exports = async function handler(request, response) {
  wrapJsonRunTimeSourceEvidence(response, { strategy: "institution", endpoint: "api/institution-latest" });
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");

  if (request.method !== "GET") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  const options = readRequestOptions(request);
  if (!options.live) {
    const cached = await readEndpointFromDesktopSnapshot(request, {
      timeoutMs: 650,
      via: "api/institution-latest",
    });
    if (cached && payloadMatchesFieldContract(cached, options.fieldContract) && payloadHasMachineState(cached)) {
      setDesktopSnapshotCache(response);
      response.status(200).json(cached);
      return;
    }
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      response.status(503).json(apiOnlyError("supabase_not_configured"));
      return;
    }
    const sourceHealth = await fetchInstitutionSourceHealth().catch(() => ({}));
    const latest = await fetchLatestCompleteRows();
    if (!latest.rows.length) {
      response.status(404).json(apiOnlyError("institution_scan_results_latest_empty"));
      return;
    }
    setDesktopSnapshotCache(response);
    response.status(200).json(buildPayload(latest.rows, latest.run, { ...options, sourceHealth }));
  } catch (error) {
    response.status(503).json(apiOnlyError(error?.message || String(error)));
  }
};
