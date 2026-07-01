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

const TABLE = process.env.STRATEGY4_SUPABASE_RESULTS_TABLE || "strategy4_scan_results";
const RUNS_TABLE = process.env.STRATEGY4_SUPABASE_RUNS_TABLE || "strategy4_scan_runs";
const EXPECTED_SCHEMA = "strategy4-cache-v3-unit-contract";
const EXPECTED_UNIT = "lots";
const EXPECTED_SOURCE = "supabase:strategy4_daily_ohlcv_view";
const STOCK_DAILY_VOLUME_SOURCE = "supabase:stock_daily_volume";
const LEGACY_LOTS_SOURCE = "supabase:fugle_daily_volume:legacy-lots";
const ALLOWED_DATA_CONTRACT_SOURCES = new Set([EXPECTED_SOURCE, STOCK_DAILY_VOLUME_SOURCE, LEGACY_LOTS_SOURCE]);

function apiOnlyError(error, detail = "") {
  return {
    ok: false,
    cacheSource: "api-only",
    error,
    detail,
    transport: {
      source: "supabase",
      table: TABLE,
      runTable: RUNS_TABLE,
      gate: "run_id",
      via: "api/strategy4-latest",
      fetchedAt: new Date().toISOString(),
    },
  };
}

function setDesktopSnapshotCache(response) {
  response.setHeader("Cache-Control", "public, max-age=45, stale-while-revalidate=180");
  response.setHeader("CDN-Cache-Control", "public, max-age=45, stale-while-revalidate=240");
  response.setHeader("Vercel-CDN-Cache-Control", "public, max-age=45, stale-while-revalidate=240");
}

async function fetchRowsFrom(table, query) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${query}`;
  const response = await fetch(url, {
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

async function fetchRows(query) {
  return fetchRowsFrom(TABLE, query);
}

async function fetchExactCount(table, query) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${query}`;
  const response = await fetch(url, {
    method: "HEAD",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: "count=exact",
    },
    cache: "no-store",
  });
  if (!response.ok) return 0;
  const range = response.headers.get("content-range") || "";
  const match = range.match(/\/(\d+)$/);
  return match ? Number(match[1]) || 0 : 0;
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function isAllowedDataContractSource(value) {
  const source = String(value || "").trim();
  return !source || ALLOWED_DATA_CONTRACT_SOURCES.has(source);
}

function parseRequestOptions(request) {
  try {
    const url = new URL(request.url || "", "http://localhost");
    const canvas = url.searchParams.get("canvas") === "1" || url.searchParams.get("compact") === "1";
    const limit = Math.max(1, Math.min(canvas ? 120 : 2000, cleanNumber(url.searchParams.get("limit")) || (canvas ? 70 : 2000)));
    return { canvas, limit };
  } catch {
    return { canvas: false, limit: 2000 };
  }
}

function normalizeSignalList(value) {
  return Array.isArray(value) ? value : [];
}

function normalizePayload(row) {
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  const signals = normalizeSignalList(payload.signals || row.signals);
  const swingZone = String(payload.swingZone || payload.zone || row.zone || "").trim();
  const swingZoneLabel = String(payload.swingZoneLabel || payload.zoneLabel || row.zone_label || "").trim();
  return {
    ...payload,
    code: String(payload.code || row.code || "").trim(),
    name: String(payload.name || row.name || row.code || "").trim(),
    close: cleanNumber(payload.close || payload.price || row.price),
    price: cleanNumber(payload.price || payload.close || row.price),
    percent: cleanNumber(payload.percent ?? payload.changePercent ?? row.change_percent),
    volume: cleanNumber(payload.volume || row.volume),
    value: cleanNumber(payload.value || payload.tradeValue || row.trade_value),
    swingScore: cleanNumber(payload.swingScore || payload.score || row.score),
    score: cleanNumber(payload.score || payload.swingScore || row.score),
    swingZone,
    swingZoneLabel,
    zone: swingZone,
    zoneLabel: swingZoneLabel,
    zone_label: swingZoneLabel,
    pattern: String(payload.pattern || payload.strategy || swingZoneLabel || swingZone).trim(),
    signals,
    reason: String(payload.reason || row.reason || signals.map((signal) => signal.reason).filter(Boolean).join("；")).trim(),
  };
}

function countBy(values) {
  return values.reduce((acc, value) => {
    const key = String(value || "(blank)");
    acc[key] = cleanNumber(acc[key]) + 1;
    return acc;
  }, {});
}

function buildStrategy4SourceHealth(rows, run, matches) {
  const runPayload = run?.payload && typeof run.payload === "object" ? run.payload : {};
  const sourceWarnings = Array.isArray(runPayload.sourceWarnings) ? [...runPayload.sourceWarnings] : [];
  const resultSourceCounts = countBy(rows.map((row) => row.price_source || row.payload?.priceSource || ""));
  const allExpectedSource = Object.keys(resultSourceCounts).length === 1 && resultSourceCounts[EXPECTED_SOURCE] === rows.length;
  const qualityStatus = String(run?.quality_status || rows[0]?.quality_status || "");
  if (qualityStatus === "degraded" && !sourceWarnings.length && !runPayload.supabaseCoverage) {
    sourceWarnings.push("Legacy degraded run has no source detail in strategy4_scan_runs.payload; inferred source mix from result rows.");
  }
  return {
    status: qualityStatus === "complete" ? "ok" : qualityStatus,
    qualityStatus,
    sourceWarnings,
    resultSourceCounts,
    allRowsExpectedSource: allExpectedSource,
    yahooSourceCount: cleanNumber(runPayload.yahooSourceCount),
    yahooSourceRatio: cleanNumber(runPayload.yahooSourceRatio),
    misSourceCount: cleanNumber(runPayload.misSourceCount),
    misSourceRatio: cleanNumber(runPayload.misSourceRatio),
    dataSourceCounts: runPayload.dataSourceCounts || {},
    supabaseCoverage: runPayload.supabaseCoverage || null,
    expectedTotal: cleanNumber(run?.expected_total),
    scannedCount: cleanNumber(run?.scanned_count),
    resultCount: cleanNumber(run?.result_count) || matches.length,
    noDataCount: cleanNumber(run?.no_data_count),
    errorCount: cleanNumber(run?.error_count),
  };
}

function buildStrategy4GateContract(rows, run, matches) {
  const runPayload = run?.payload && typeof run.payload === "object" ? run.payload : {};
  const gate = runPayload.supabasePublishGate && typeof runPayload.supabasePublishGate === "object" ? runPayload.supabasePublishGate : null;
  const supabaseCoverage = runPayload.supabaseCoverage && typeof runPayload.supabaseCoverage === "object" ? runPayload.supabaseCoverage : {};
  const qualityStatus = String(run?.quality_status || rows[0]?.quality_status || "");
  const fallbackUsed = false;
  const retentionOk = run?.complete === true
    && String(run?.status || "") === "complete"
    && qualityStatus === "complete"
    && cleanNumber(run?.result_count) > 0
    && fallbackUsed === false;
  const gateIssues = Array.isArray(gate?.issues) ? gate.issues : [];
  const gateWarnings = Array.isArray(gate?.warnings) ? gate.warnings : [];
  const dailyVolumeFreshness = supabaseCoverage?.coverageRatio ?? (supabaseCoverage?.qualityStatus === "complete" ? 1 : null);
  const sourceCoverageBase = gate?.sourceCoverage || {
    fresh_quote_coverage_120s: null,
    today_1m_symbols: null,
    ready_ge_35: null,
    latest_candle_time: "",
    intraday_1m_stale_seconds: null,
    preopen_coverage: null,
    daily_volume_freshness: dailyVolumeFreshness,
    supabaseCoverage,
  };
  const publishAllowed = retentionOk && gateIssues.length === 0 && gate?.publishAllowed !== false;
  const status = gate?.status || (publishAllowed ? "ready" : qualityStatus === "complete" ? "ready" : "degraded");
  const sourceCoverage = {
    ...sourceCoverageBase,
    ok: publishAllowed,
    ready: publishAllowed,
    status: publishAllowed ? "ready" : status || "degraded",
    reason: publishAllowed ? "strategy4_source_publish_gate_ready" : gateIssues.join("; ") || "strategy4_source_publish_gate_blocked",
  };
  const writeBudget = gate?.writePolicy || {
    allowLatestWrite: publishAllowed,
    allowCompleteRunWrite: publishAllowed,
    preservePreviousCompleteRun: !publishAllowed,
    reason: publishAllowed ? "Strategy4 latest complete run is publishable" : "Strategy4 must preserve previous complete run",
  };
  const warnings = [
    ...gateWarnings,
    ...(gate ? [] : [{ severity: "warning", id: "strategy4-publish-gate-snapshot-missing", message: "latest complete run predates Strategy4 publish gate snapshot; next scanner run will persist gate evidence" }]),
  ];
  return {
    status,
    sourceCoverage,
    staleSeconds: cleanNumber(gate?.staleSeconds ?? sourceCoverage?.intraday_1m_stale_seconds),
    latestRunId: String(run?.run_id || ""),
    fallbackUsed,
    writeBudget,
    retentionOk,
    issues: gateIssues,
    warnings,
    publishAllowed,
    mustPreserveLatest: !publishAllowed,
    gate,
  };
}

function buildPayload(rows, total, run = null, options = {}) {
  const first = rows[0] || {};
  const matches = rows
    .slice()
    .sort((a, b) => cleanNumber(a.rank) - cleanNumber(b.rank) || String(a.code).localeCompare(String(b.code)))
    .map(normalizePayload);
  const zones = matches.reduce((acc, item) => {
    const zone = String(item.swingZone || item.zone || "").toUpperCase();
    if (zone === "A" || zone === "B" || zone === "C") acc[zone] += 1;
    return acc;
  }, { A: 0, B: 0, C: 0 });
  const scanDate = String(first.scan_date || "").replace(/-/g, "");
  const gateContract = buildStrategy4GateContract(rows, run, matches);
  return {
    ok: true,
    status: gateContract.status,
    source: "supabase:strategy4_scan_results",
    cacheSource: "supabase-api",
    ...runTimeSourceSnapshotResponseFields(run?.payload || {}),
    schemaVersion: String(first.schema_version || EXPECTED_SCHEMA),
    volumeUnit: String(first.volume_unit || EXPECTED_UNIT),
    dataContractSource: String(first.data_contract_source || EXPECTED_SOURCE),
    runId: String(first.run_id || ""),
    generatedAt: String(first.generated_at || first.scan_time || first.updated_at || new Date().toISOString()),
    updatedAt: String(first.scan_time || first.updated_at || new Date().toISOString()),
    scanStamp: scanDate,
    complete: Boolean(first.complete),
    latestRunId: gateContract.latestRunId,
    fallbackUsed: gateContract.fallbackUsed,
    writeBudget: gateContract.writeBudget,
    retentionOk: gateContract.retentionOk,
    sourceCoverage: gateContract.sourceCoverage,
    staleSeconds: gateContract.staleSeconds,
    issues: gateContract.issues,
    warnings: gateContract.warnings,
    publishAllowed: gateContract.publishAllowed,
    mustPreserveLatest: gateContract.mustPreserveLatest,
    canvas: Boolean(options.canvas),
    qualityStatus: String(first.quality_status || ""),
    count: matches.length,
    total: Math.max(matches.length, cleanNumber(total), 1500),
    zones,
    sourceHealth: buildStrategy4SourceHealth(rows, run, matches),
    matches,
    transport: {
      source: "supabase",
      table: TABLE,
      runTable: RUNS_TABLE,
      runId: String(first.run_id || ""),
      gate: "run_id",
      via: "api/strategy4-latest",
      fetchedAt: new Date().toISOString(),
    },
  };
}

function zoneOfRow(row) {
  const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
  return String(payload.swingZone || payload.zone || row?.zone || "").trim().toUpperCase();
}

function compactCanvasRows(rows, limit) {
  const sorted = (Array.isArray(rows) ? rows : [])
    .slice()
    .sort((a, b) => cleanNumber(a.rank) - cleanNumber(b.rank) || String(a.code || "").localeCompare(String(b.code || "")));
  const max = Math.max(30, Math.min(70, cleanNumber(limit) || 70));
  const zoneOrder = ["A", "B", "C"];
  const baseEach = Math.max(10, Math.floor(max / zoneOrder.length));
  const picked = [];
  const seen = new Set();
  zoneOrder.forEach((zone) => {
    sorted
      .filter((row) => zoneOfRow(row) === zone)
      .slice(0, baseEach)
      .forEach((row) => {
        const key = String(row.code || row.payload?.code || "");
        if (!key || seen.has(key)) return;
        seen.add(key);
        picked.push(row);
      });
  });
  sorted.forEach((row) => {
    if (picked.length >= max) return;
    const key = String(row.code || row.payload?.code || "");
    if (!key || seen.has(key)) return;
    seen.add(key);
    picked.push(row);
  });
  return picked
    .sort((a, b) => cleanNumber(a.rank) - cleanNumber(b.rank) || String(a.code || "").localeCompare(String(b.code || "")))
    .slice(0, max);
}

async function fetchLatestCompleteRun() {
  const rows = await fetchRowsFrom(
    RUNS_TABLE,
    [
      "select=run_id,scan_date,finished_at,status,complete,expected_total,scanned_count,result_count,no_data_count,error_count,schema_version,volume_unit,data_contract_source,quality_status,payload",
      "strategy=eq.strategy4",
      "status=eq.complete",
      "complete=eq.true",
      "order=finished_at.desc",
      "limit=12",
    ].join("&")
  );
  const row = rows.find((candidate) => {
    if (!candidate?.run_id) return false;
    if (candidate.schema_version && candidate.schema_version !== EXPECTED_SCHEMA) return false;
    if (candidate.volume_unit && candidate.volume_unit !== EXPECTED_UNIT) return false;
    if (!isAllowedDataContractSource(candidate.data_contract_source)) return false;
    return true;
  });
  if (!row?.run_id) return null;
  return row;
}

async function fetchLatestCompleteRows(limit = 2000) {
  const run = await fetchLatestCompleteRun();
  if (!run?.run_id) return { rows: [], run: null, gate: "missing-complete-run", runId: "" };
  const query = [
    "select=run_id,scan_date,scan_time,code,name,signals,price,change_percent,volume,trade_value,score,zone,zone_label,rank,reason,complete,quality_status,schema_version,volume_unit,data_contract_source,price_source,generated_at,payload,updated_at",
    "strategy=eq.strategy4",
    `run_id=eq.${encodeURIComponent(run.run_id)}`,
    "order=rank.asc",
    `limit=${Math.max(1, Math.min(2000, cleanNumber(limit) || 2000))}`,
  ].join("&");
  const rows = await fetchRows(query);
  return { rows, run, gate: "run_id", runId: run.run_id };
}

module.exports = async function handler(request, response) {
  wrapJsonRunTimeSourceEvidence(response, { strategy: "strategy4", endpoint: "api/strategy4-latest" });
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");

  if (request.method !== "GET") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  const cached = await readEndpointFromDesktopSnapshot(request, {
    timeoutMs: 650,
    via: "api/strategy4-latest",
  });
  if (cached) {
    setDesktopSnapshotCache(response);
    response.status(200).json(cached);
    return;
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      response.status(503).json(apiOnlyError("strategy4_supabase_not_configured"));
      return;
    }
    const options = parseRequestOptions(request);
    const latest = await fetchLatestCompleteRows(options.canvas ? 2000 : options.limit);
    const rows = options.canvas ? compactCanvasRows(latest.rows || [], options.limit) : latest.rows || [];
    if (!rows.length) {
      response.status(404).json(apiOnlyError("strategy4_complete_run_empty", latest.gate || "missing rows"));
      return;
    }
    const total = options.canvas
      ? cleanNumber(latest.run?.expected_total || latest.run?.scanned_count)
      : await fetchExactCount("strategy4_stock_universe_view", "select=symbol&is_strategy4_eligible=eq.true&limit=1").catch(() => 0);
    const payload = buildPayload(rows, total, latest.run, options);
    payload.transport.gate = latest.gate || "";
    payload.transport.runId = latest.runId || payload.transport.runId || "";
    payload.runId = latest.runId || payload.runId || "";
    if (payload.schemaVersion !== EXPECTED_SCHEMA || payload.volumeUnit !== EXPECTED_UNIT || !isAllowedDataContractSource(payload.dataContractSource)) {
      response.status(409).json(apiOnlyError("strategy4_supabase_contract_mismatch"));
      return;
    }
    setDesktopSnapshotCache(response);
    response.status(200).json(payload);
  } catch (error) {
    response.status(502).json(apiOnlyError("strategy4_api_only_failed", error?.message || String(error)));
  }
};
