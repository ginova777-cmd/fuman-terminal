const fs = require("fs");
const path = require("path");
const { isTwseTradingDay } = require("../scripts/twse-trading-day");
const { sendJson } = require("./_http-cache");
const { readEndpointFromDesktopSnapshot } = require("../lib/desktop-route-snapshot-cache");
const { terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");

function readSecretText(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = terminalSupabaseUrl({ runtimeDir: RUNTIME_DIR });
const SUPABASE_KEY = terminalSupabaseKey({ runtimeDir: RUNTIME_DIR });
let activeSupabaseUrl = SUPABASE_URL;

const TABLE = process.env.WARRANT_FLOW_SUPABASE_RESULTS_TABLE || "warrant_flow_scan_results";
const LATEST_RUN_VIEW = process.env.WARRANT_FLOW_SUPABASE_LATEST_RUN_VIEW || "v_warrant_flow_latest_complete_run";
const TWSE_STATE_DIR = process.env.FUMAN_STATE_DIR || path.join("/tmp", "fuman-state");
const REQUIRED_SCHEMA_VERSION = "warrant-flow-run-id-complete-v1";

function taipeiTodayKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date).replace(/\D/g, "");
}

function compactDateKey(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const digits = text.replace(/\D/g, "");
  if (/^\d{8}$/.test(digits)) return digits;
  if (/^\d{7}$/.test(digits)) {
    const rocYear = Number(digits.slice(0, 3));
    const month = Number(digits.slice(3, 5));
    const day = Number(digits.slice(5, 7));
    if (rocYear > 0 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${rocYear + 1911}${digits.slice(3, 5)}${digits.slice(5, 7)}`;
    }
  }
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) return taipeiTodayKey(new Date(parsed));
  return digits.slice(0, 8);
}

function isoDateKey(value) {
  const key = compactDateKey(value);
  return /^\d{8}$/.test(key) ? `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}` : "";
}

function buildEmptyMarketSession(tradingDay = null) {
  if (!tradingDay) return undefined;
  const today = taipeiTodayKey();
  const closed = !tradingDay.isTradingDay;
  return {
    today,
    taipeiDate: isoDateKey(today),
    marketDataDate: "",
    marketDataIsoDate: "",
    hasTodayMarketData: false,
    closed,
    reason: tradingDay.reason || (closed ? "non-trading-day" : "regular_trading_day"),
    source: tradingDay.source || "twse-trading-day",
  };
}

function apiOnlyError(reason = "", tradingDay = null) {
  const marketSession = buildEmptyMarketSession(tradingDay);
  const closed = marketSession?.closed === true;
  return {
    ok: false,
    error: "warrant_flow_api_only_unavailable",
    detail: reason,
    cacheSource: "none",
    runId: "",
    usedDate: "",
    sourceDate: "",
    count: 0,
    rows: [],
    matches: [],
    volumeMatches: [],
    singleSignals: [],
    updatedAt: new Date().toISOString(),
    reason: closed ? "non-trading-day-cache-empty" : "warrant_flow_api_only_unavailable",
    marketSession,
    transport: {
      source: "supabase",
      supabaseHost: safeHost(activeSupabaseUrl),
      latestRunView: LATEST_RUN_VIEW,
      gate: closed ? "non-trading-day-cache" : "run_id",
      via: "api/warrant-flow-latest",
      fetchedAt: new Date().toISOString(),
    },
  };
}

function setDesktopSnapshotCache(response) {
  response.setHeader("Cache-Control", "public, max-age=45, stale-while-revalidate=180");
  response.setHeader("CDN-Cache-Control", "public, max-age=45, stale-while-revalidate=240");
  response.setHeader("Vercel-CDN-Cache-Control", "public, max-age=45, stale-while-revalidate=240");
}

function emptySnapshotPayload(reason = "warrant_flow_snapshot_empty", tradingDay = null, options = {}) {
  const marketSession = buildEmptyMarketSession(tradingDay);
  return {
    ok: true,
    source: "supabase:warrant_flow_scan_results",
    cacheSource: "snapshot-friendly-empty",
    runId: "",
    usedDate: "",
    tradeDate: "",
    sourceDate: "",
    complete: false,
    qualityStatus: "waiting_snapshot",
    schemaVersion: "",
    dataContractSource: "snapshot-friendly-fallback",
    count: 0,
    returnedCount: 0,
    canvas: Boolean(options.canvas),
    rows: [],
    matches: [],
    volumeCount: 0,
    volumeMatches: [],
    singleSignalCount: 0,
    singleSignals: [],
    updatedAt: new Date().toISOString(),
    reason,
    marketSession,
    dataContract: {
      ok: true,
      partial: true,
      skipped: true,
      reason,
    },
    transport: {
      source: "supabase",
      supabaseHost: safeHost(activeSupabaseUrl),
      table: TABLE,
      latestRunView: LATEST_RUN_VIEW,
      gate: "snapshot-friendly-empty",
      via: "api/warrant-flow-latest",
      fetchedAt: new Date().toISOString(),
    },
  };
}

async function fetchRowsFrom(table, query) {
  const response = await fetch(`${activeSupabaseUrl}/rest/v1/${table}?${query}`, {
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

function safeHost(value) {
  try {
    return new URL(value).host;
  } catch {
    return "";
  }
}

function readRequestOptions(request) {
  try {
    const url = new URL(request.url, `https://${request.headers.host || "localhost"}`);
    const canvas = url.searchParams.get("canvas") === "1";
    const limit = Math.max(1, Math.min(canvas ? 120 : 3000, cleanNumber(url.searchParams.get("limit")) || (canvas ? 80 : 3000)));
    const snapshotFriendly = canvas
      || url.searchParams.get("snapshotBuild") === "1"
      || url.searchParams.get("fastBundle") === "1"
      || url.searchParams.get("shell") === "1";
    return { canvas, limit, snapshotFriendly };
  } catch {
    return { canvas: false, limit: 3000, snapshotFriendly: false };
  }
}

function schemaVersionAtLeast(actual, required) {
  const actualText = String(actual || "").trim();
  const requiredText = String(required || "").trim();
  if (!actualText || !requiredText) return false;
  if (actualText === requiredText) return true;
  const actualBase = actualText.replace(/-v\d+$/i, "");
  const requiredBase = requiredText.replace(/-v\d+$/i, "");
  const actualVersion = Number(actualText.match(/-v(\d+)$/i)?.[1] || 0);
  const requiredVersion = Number(requiredText.match(/-v(\d+)$/i)?.[1] || 0);
  return actualBase === requiredBase && actualVersion >= requiredVersion;
}

function isSingleWarrantVolumeRow(row) {
  const warrantCode = String(row?.warrantCode || "").trim();
  const underlyingCode = String(row?.underlyingCode || row?.code || "").trim();
  return /^\d{5,6}$/.test(warrantCode)
    && /^\d{4}$/.test(underlyingCode)
    && warrantCode !== underlyingCode
    && Boolean(String(row?.warrantName || "").trim())
    && cleanNumber(row?.thirtyMinuteVolume) > 0
    && cleanNumber(row?.floatingUnits) > 0
    && cleanNumber(row?.volumeMultiple) > 0;
}

function isUnderlyingWarrantVolumeRow(row) {
  const underlyingCode = String(row?.underlyingCode || row?.code || "").trim();
  return /^\d{4}$/.test(underlyingCode)
    && Boolean(String(row?.underlyingName || row?.name || "").trim())
    && cleanNumber(row?.thirtyMinuteVolume || row?.callVolume || row?.volume) > 0
    && cleanNumber(row?.floatingUnits || row?.callCount || row?.breadth) > 0
    && cleanNumber(row?.volumeMultiple || row?.warrantHeatScore || row?.score) > 0;
}

function validateDataContract(payload) {
  const issues = [];
  if (!schemaVersionAtLeast(payload?.schemaVersion, REQUIRED_SCHEMA_VERSION)) {
    issues.push(`schema_version_below_required:${payload?.schemaVersion || "missing"}`);
  }
  const volumeMatches = Array.isArray(payload?.volumeMatches) ? payload.volumeMatches : [];
  if (!volumeMatches.length) {
    issues.push("volume_matches_empty");
  }
  const invalidVolumeRows = volumeMatches
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => !isSingleWarrantVolumeRow(row) && !isUnderlyingWarrantVolumeRow(row))
    .slice(0, 5);
  if (invalidVolumeRows.length) {
    issues.push(`volume_matches_contract_invalid:${invalidVolumeRows.map(({ index, row }) => `${index}:${row?.warrantCode || row?.code || "missing"}`).join(",")}`);
  }
  return {
    ok: issues.length === 0,
    requiredSchemaVersion: REQUIRED_SCHEMA_VERSION,
    schemaVersion: payload?.schemaVersion || "",
    volumeMatchesContractOk: invalidVolumeRows.length === 0 && volumeMatches.length > 0,
    checkedVolumeRows: volumeMatches.length,
    issues,
  };
}

function completeRunGateIssues(run, rows) {
  const issues = [];
  const rowCount = Array.isArray(rows) ? rows.length : 0;
  if (!run?.run_id) issues.push("run_id_missing");
  if (run?.status !== undefined && String(run.status) !== "complete") issues.push(`status_not_complete:${run.status}`);
  if (run?.complete !== undefined && run.complete !== true) issues.push("complete_not_true");

  const expectedTotal = run?.expected_total === undefined ? null : cleanNumber(run.expected_total);
  const scannedCount = run?.scanned_count === undefined ? null : cleanNumber(run.scanned_count);
  const resultCount = run?.result_count === undefined ? null : cleanNumber(run.result_count);
  if (expectedTotal !== null && expectedTotal <= 0) issues.push(`expected_total_invalid:${expectedTotal}`);
  if (scannedCount !== null && scannedCount <= 0) issues.push(`scanned_count_invalid:${scannedCount}`);
  if (expectedTotal !== null && scannedCount !== null && expectedTotal !== scannedCount) {
    issues.push(`expected_scanned_mismatch:${expectedTotal}/${scannedCount}`);
  }
  if (resultCount !== null && resultCount <= 0) issues.push(`result_count_invalid:${resultCount}`);
  if (resultCount !== null && rowCount !== resultCount) issues.push(`result_count_readback_mismatch:${resultCount}/${rowCount}`);
  if (rowCount <= 0) issues.push("readback_rows_empty");
  return issues;
}

function normalizeRow(row) {
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  return {
    ...payload,
    code: String(payload.code || row.underlying_code || row.code || "").trim(),
    name: String(payload.name || row.underlying_name || row.name || "").trim(),
    underlyingCode: String(payload.underlyingCode || row.underlying_code || payload.code || "").trim(),
    underlyingName: String(payload.underlyingName || row.underlying_name || payload.name || "").trim(),
    close: cleanNumber(payload.close || payload.displayClose || payload.underlyingClose || row.close),
    percent: cleanNumber(payload.percent ?? payload.displayPercent ?? payload.underlyingPercent ?? row.change_percent),
    value: cleanNumber(payload.value || payload.callValue || row.trade_value),
    finalScore: cleanNumber(payload.finalScore || payload.score || row.score),
    score: cleanNumber(payload.score || payload.finalScore || row.score),
    reason: String(payload.reason || row.reason || "").trim(),
  };
}

function buildPayload(rows, run, options = {}) {
  const byType = (type) => rows
    .filter((row) => String(row.result_type || "match") === type)
    .sort((a, b) => cleanNumber(a.rank) - cleanNumber(b.rank) || String(a.code).localeCompare(String(b.code)))
    .map(normalizeRow);
  const matches = byType("match");
  const volumeMatches = byType("volume");
  const singleSignals = byType("single");
  const outputMatches = options.canvas ? matches.slice(0, options.limit || 80) : matches;
  const outputVolumeMatches = options.canvas ? volumeMatches.slice(0, options.limit || 80) : volumeMatches;
  const outputSingleSignals = options.canvas ? singleSignals.slice(0, options.limit || 80) : singleSignals;
  const scanDate = compactDateKey(run?.scan_date || rows[0]?.scan_date || "");
  const usedDate = compactDateKey(run?.payload?.usedDate || run?.payload?.tradeDate || scanDate);
  const sourceDate = compactDateKey(run?.payload?.sourceDate || run?.payload?.tradeDate || scanDate || usedDate);
  const runId = String(run?.run_id || rows[0]?.run_id || "");
  return {
    ok: true,
    source: "supabase:warrant_flow_scan_results",
    cacheSource: "supabase-api",
    runId,
    updatedAt: String(run?.finished_at || rows[0]?.updated_at || new Date().toISOString()),
    usedDate,
    tradeDate: compactDateKey(run?.payload?.tradeDate || scanDate),
    sourceDate,
    complete: true,
    qualityStatus: String(run?.quality_status || rows[0]?.quality_status || "complete"),
    schemaVersion: String(run?.schema_version || rows[0]?.schema_version || ""),
    dataContractSource: String(run?.data_contract_source || rows[0]?.data_contract_source || "warrant-flow-cache"),
    count: matches.length,
    returnedCount: outputMatches.length,
    matchesTotal: matches.length,
    canvas: Boolean(options.canvas),
    rows: outputMatches,
    matches: outputMatches,
    volumeCount: volumeMatches.length,
    volumeMatchesTotal: volumeMatches.length,
    volumeMatches: outputVolumeMatches,
    singleSignalCount: singleSignals.length,
    singleSignalsTotal: singleSignals.length,
    singleSignals: outputSingleSignals,
    transport: {
      source: "supabase",
      supabaseHost: safeHost(activeSupabaseUrl),
      table: TABLE,
      latestRunView: LATEST_RUN_VIEW,
      gate: "run_id",
      runId,
      via: "api/warrant-flow-latest",
      fetchedAt: new Date().toISOString(),
    },
  };
}

async function fetchLatestCompleteRun() {
  const rows = await fetchRowsFrom(
    LATEST_RUN_VIEW,
    [
      "select=*",
      "strategy=eq.warrant_flow",
      "status=eq.complete",
      "complete=eq.true",
      "result_count=gt.0",
      "order=finished_at.desc",
      "limit=1",
    ].join("&")
  );
  return rows[0]?.run_id ? rows[0] : null;
}

async function fetchRecentCompleteRunsFromResults(limit = 6000) {
  const byRun = new Map();
  let beforeUpdatedAt = "";
  for (let page = 0; page < 8 && byRun.size < limit; page += 1) {
    const query = [
      "select=run_id,scan_date,complete,quality_status,schema_version,data_contract_source,generated_at,updated_at",
      "strategy=eq.warrant_flow",
      "complete=eq.true",
      "order=updated_at.desc",
      "limit=1000",
    ];
    if (beforeUpdatedAt) query.push(`updated_at=lt.${encodeURIComponent(beforeUpdatedAt)}`);
    const rows = await fetchRowsFrom(TABLE, query.join("&"));
    if (!rows.length) break;
    for (const row of rows) {
      const runId = String(row?.run_id || "");
      if (!runId || byRun.has(runId)) continue;
      byRun.set(runId, {
        run_id: runId,
        scan_date: row.scan_date,
        finished_at: row.generated_at || row.updated_at,
        quality_status: row.quality_status,
        schema_version: row.schema_version,
        data_contract_source: row.data_contract_source,
        complete: row.complete,
      });
    }
    beforeUpdatedAt = String(rows[rows.length - 1]?.updated_at || "");
    if (rows.length < 1000 || !beforeUpdatedAt) break;
  }
  return Array.from(byRun.values());
}

async function fetchRecentCompleteRuns(limit = 24) {
  return fetchRowsFrom(
    LATEST_RUN_VIEW,
    [
      "select=*",
      "strategy=eq.warrant_flow",
      "status=eq.complete",
      "complete=eq.true",
      "order=finished_at.desc",
      `limit=${limit}`,
    ].join("&")
  );
}

async function fetchRowsForRun(run, limit = 3000) {
  if (!run?.run_id) return [];
  const safeLimit = Math.max(1, Math.min(3000, cleanNumber(limit) || 3000));
  return fetchRowsFrom(
    TABLE,
    [
      "select=run_id,scan_date,result_type,code,name,underlying_code,underlying_name,close,change_percent,trade_value,score,rank,reason,payload,complete,quality_status,schema_version,data_contract_source,generated_at,updated_at",
      "strategy=eq.warrant_flow",
      `run_id=eq.${encodeURIComponent(run.run_id)}`,
      "order=result_type.asc,rank.asc",
      `limit=${safeLimit}`,
    ].join("&")
  );
}

async function fetchLatestCompleteRows(options = {}) {
  const runs = await fetchRecentCompleteRuns();
  const skippedInvalidRuns = [];
  for (const run of runs) {
    if (run.result_count !== undefined && cleanNumber(run.result_count) <= 0) continue;
    const rows = await fetchRowsForRun(run, 3000);
    if (!rows.length) continue;
    const payload = buildPayload(rows, run);
    const gateIssues = completeRunGateIssues(run, rows);
    if (gateIssues.length) {
      skippedInvalidRuns.push({
        runId: String(run.run_id || ""),
        finishedAt: String(run.finished_at || ""),
        issues: gateIssues,
      });
      continue;
    }
    if (options.snapshotFriendly) return { rows, run, skippedInvalidRuns };
    const dataContract = validateDataContract(payload);
    if (dataContract.ok) return { rows, run, skippedInvalidRuns };
    skippedInvalidRuns.push({
      runId: String(run.run_id || ""),
      finishedAt: String(run.finished_at || ""),
      issues: dataContract.issues,
    });
  }
  const run = await fetchLatestCompleteRun();
  if (!run?.run_id) return { rows: [], run: runs[0] || null, skippedInvalidRuns };
  const rows = await fetchRowsForRun(run, 3000);
  const payload = buildPayload(rows, run);
  const gateIssues = completeRunGateIssues(run, rows);
  if (gateIssues.length) {
    skippedInvalidRuns.push({
      runId: String(run.run_id || ""),
      finishedAt: String(run.finished_at || ""),
      issues: gateIssues,
    });
    return { rows: [], run, skippedInvalidRuns };
  }
  if (options.snapshotFriendly && rows.length) return { rows, run, skippedInvalidRuns };
  const dataContract = validateDataContract(payload);
  if (rows.length && dataContract.ok) return { rows, run, skippedInvalidRuns };
  if (rows.length) {
    skippedInvalidRuns.push({
      runId: String(run.run_id || ""),
      finishedAt: String(run.finished_at || ""),
      issues: dataContract.issues,
    });
  }
  return { rows: [], run, skippedInvalidRuns };
}

function buildMarketSession(tradingDay, payload) {
  const today = taipeiTodayKey();
  const marketDataDate = compactDateKey(payload?.sourceDate || payload?.usedDate || payload?.tradeDate || "");
  const closed = tradingDay ? !tradingDay.isTradingDay : false;
  return {
    today,
    taipeiDate: isoDateKey(today),
    marketDataDate,
    marketDataIsoDate: isoDateKey(marketDataDate),
    hasTodayMarketData: Boolean(marketDataDate && marketDataDate === today),
    closed,
    reason: tradingDay?.reason || (closed ? "non-trading-day" : "regular_trading_day"),
    source: tradingDay?.source || "twse-trading-day",
  };
}

function withMarketSession(payload, marketSession) {
  const closed = marketSession?.closed === true;
  return {
    ...payload,
    reason: closed ? "non-trading-day-cache" : "run_id",
    marketSession,
    transport: {
      ...(payload.transport || {}),
      gate: closed ? "non-trading-day-cache" : payload.transport?.gate || "run_id",
      fetchedAt: new Date().toISOString(),
    },
  };
}

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");

  if (request.method !== "GET") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  const cached = await readEndpointFromDesktopSnapshot(request, {
    timeoutMs: 700,
    via: "api/warrant-flow-latest",
  });
  if (cached) {
    setDesktopSnapshotCache(response);
    sendJson(request, response, cached, "warrant-flow");
    return;
  }

  let tradingDay = null;
  try {
    tradingDay = await isTwseTradingDay(new Date(), { stateDir: TWSE_STATE_DIR });
  } catch (error) {
    tradingDay = {
      isTradingDay: true,
      reason: "trading_day_check_failed",
      source: "twse-trading-day",
      error: error?.message || String(error),
    };
  }

  const options = readRequestOptions(request);
  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      if (options.snapshotFriendly) {
        response.status(200).json(emptySnapshotPayload("supabase_not_configured", tradingDay, options));
        return;
      }
      response.status(503).json(apiOnlyError("supabase_not_configured", tradingDay));
      return;
    }
    const sourceErrors = [];
    let latest = { rows: [], run: null, skippedInvalidRuns: [] };
    activeSupabaseUrl = SUPABASE_URL;
    try {
      latest = await fetchLatestCompleteRows(options);
      if (!latest.rows.length) sourceErrors.push(`${safeHost(SUPABASE_URL)}:empty`);
    } catch (error) {
      sourceErrors.push(`${safeHost(SUPABASE_URL)}:${error?.message || String(error)}`);
    }
    if (!latest.rows.length) {
      if (options.snapshotFriendly) {
        response.status(200).json(emptySnapshotPayload(sourceErrors.join(" | ") || "warrant_flow_scan_results_latest_empty", tradingDay, options));
        return;
      }
      response.status(404).json(apiOnlyError(sourceErrors.join(" | ") || "warrant_flow_scan_results_latest_empty", tradingDay));
      return;
    }
    const fullPayload = buildPayload(latest.rows, latest.run);
    const payload = buildPayload(latest.rows, latest.run, options);
    if (latest.skippedInvalidRuns?.length) {
      payload.transport = {
        ...(payload.transport || {}),
        gate: "contract_valid_run",
        skippedInvalidRuns: latest.skippedInvalidRuns,
      };
    }
    const dataContract = options.snapshotFriendly
      ? {
          ok: true,
          partial: false,
          skipped: true,
          reason: "snapshot-friendly-full-run-validated",
          requiredSchemaVersion: REQUIRED_SCHEMA_VERSION,
          schemaVersion: payload.schemaVersion || "",
          readbackCount: fullPayload.count + fullPayload.volumeCount + fullPayload.singleSignalCount,
          returnedCount: payload.returnedCount,
        }
      : validateDataContract(fullPayload);
    payload.dataContract = dataContract;
    if (!dataContract.ok) {
      const errorPayload = apiOnlyError("warrant_flow_contract_invalid", tradingDay);
      response.status(503).json({
        ...errorPayload,
        error: "warrant_flow_contract_invalid",
        detail: dataContract.issues.join("; "),
        runId: payload.runId,
        usedDate: payload.usedDate,
        sourceDate: payload.sourceDate,
        updatedAt: payload.updatedAt,
        schemaVersion: payload.schemaVersion,
        dataContract,
        issues: dataContract.issues,
      });
      return;
    }
    setDesktopSnapshotCache(response);
    sendJson(request, response, withMarketSession(payload, buildMarketSession(tradingDay, payload)), "warrant-flow");
  } catch (error) {
    if (options.snapshotFriendly) {
      response.status(200).json(emptySnapshotPayload(error?.message || String(error), tradingDay, options));
      return;
    }
    response.status(503).json(apiOnlyError(error?.message || String(error), tradingDay));
  }
};
