const { withEntitlementRequired } = require("../lib/server-entitlement-guard");
const { buildMarketCalendarContract, installMarketCalendarResponse } = require("../lib/market-calendar-contract");
const fs = require("fs");
const path = require("path");
const { isTwseTradingDay } = require("../scripts/twse-trading-day");
const { sendJson } = require("./_http-cache");
const { readEndpointFromDesktopSnapshot } = require("../lib/desktop-route-snapshot-cache");
const { buildRunTimeSourceSnapshotFields, runTimeSourceSnapshotResponseFields, wrapJsonRunTimeSourceEvidence } = require("../lib/run-time-source-snapshot-contract");
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
const WARRANT_FLOW_REQUIRED_FIELDS = ["warrantCode", "underlyingCode", "warrantName", "underlyingName", "finalScore"];

const WARRANT_FLOW_BUSINESS_BLANK_KEYS = [
  "underlyingCode", "underlyingName", "warrantCode", "warrantName", "finalScore", "score", "reason",
  "actionLabel", "signalGrade", "stockRisk", "callValue", "putValue", "callPutRatio", "warrantHeatScore",
  "stockSetupScore", "branchPowerScore", "branchStatus", "volumeMultiple", "thirtyMinuteVolume",
  "floatingUnits", "quoteSource", "source_snapshot_captured_at", "fallbackUsed",
];

function releaseWarrantWindowOpen() {
  return false;
}

function normalizeReleaseSingleSignal(row = {}) {
  return {
    ...row,
    underlyingCode: String(row.underlyingCode || row.code || "").trim(),
    underlyingName: String(row.underlyingName || row.name || "").trim(),
    code: String(row.code || row.underlyingCode || "").trim(),
    name: String(row.name || row.underlyingName || "").trim(),
    moneynessPercent: row.moneynessPercent ?? row.moneynessPct ?? row.moneyness,
    minDaysToExpiry: row.minDaysToExpiry ?? row.daysToExpiry,
    finalScore: row.finalScore ?? row.score,
    sourceTradeDate: compactDateKey(row.sourceTradeDate || row.tradeDate),
    quoteDate: compactDateKey(row.quoteDate || row.tradeDate),
  };
}

function readReleaseWarrantSummaryPayload() {
  return null;
}

function buildBlockedRunTimeSourceFields(reason = "warrant_flow_latest_blocked") {
  return buildRunTimeSourceSnapshotFields({
    strategy: "warrant-flow",
    sourceStatus: { status: "blocked", ok: false, reason },
    quoteCoverage: { status: "unknown", ok: false, reason },
    intraday1mReadiness: { status: "unknown", ok: false, reason },
    maReadiness: { status: "unknown", ok: false, reason },
    preopenFutoptDailyReadiness: { status: "blocked", ok: false, reason },
    publishAllowed: false,
    degradedBlocksLatest: true,
    preservePreviousGood: true,
    fallbackUsed: false,
    fallbackScope: [],
    fallbackAllowed: true,
    fallbackDetails: [],
    writeBudget: {
      ok: false,
      status: "blocked",
      allowLatestWrite: false,
      allowCompleteRunWrite: false,
      preservePreviousCompleteRun: true,
      reason,
    },
    retentionOk: false,
    qualityStatus: "blocked",
  });
}

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
    ...buildBlockedRunTimeSourceFields(reason || "warrant_flow_api_only_unavailable"),
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
    ok: false,
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
    ...buildBlockedRunTimeSourceFields(reason),
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

function nonBlank(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function firstNonBlank(...values) {
  for (const value of values) {
    if (nonBlank(value)) return value;
  }
  return "";
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
    const displayRead = url.searchParams.get("compact") === "1"
      || url.searchParams.get("top") === "1";
    const limit = Math.max(1, Math.min(canvas ? 120 : 3000, cleanNumber(url.searchParams.get("limit")) || (canvas ? 80 : 3000)));
    const forceLive = url.searchParams.get("live") === "1"
      || url.searchParams.get("scorecardSource") === "1";
    const snapshotFriendly = !forceLive && (canvas
      || displayRead
      || url.searchParams.get("snapshotBuild") === "1"
      || url.searchParams.get("fastBundle") === "1"
      || url.searchParams.get("shell") === "1");
    return { canvas, limit, snapshotFriendly, forceLive };
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

function warrantRowsForCompleteness(payload) {
  return [
    ...(Array.isArray(payload?.matches) ? payload.matches.map((row) => ({ row, type: "match" })) : []),
    ...(Array.isArray(payload?.rows) ? payload.rows.map((row) => ({ row, type: "match" })) : []),
    ...(Array.isArray(payload?.volumeMatches) ? payload.volumeMatches.map((row) => ({ row, type: "volume" })) : []),
    ...(Array.isArray(payload?.singleSignals) ? payload.singleSignals.map((row) => ({ row, type: "single" })) : []),
  ].filter((entry, index, entries) => {
    if (!entry?.row || typeof entry.row !== "object") return false;
    return entries.findIndex((candidate) => candidate.row === entry.row) === index;
  });
}

function rowHasAny(row, fields) {
  return fields.some((field) => nonBlank(row?.[field]));
}

function buildWarrantFieldCompleteness(payload) {
  const entries = warrantRowsForCompleteness(payload);
  const blankCounts = Object.fromEntries(WARRANT_FLOW_BUSINESS_BLANK_KEYS.map((key) => [key, 0]));
  const sampleMissingRows = [];
  entries.forEach(({ row, type }, index) => {
    const missing = [];
    const commonChecks = {
      underlyingCode: /^\d{4}$/.test(String(row.underlyingCode || row.code || "")),
      underlyingName: nonBlank(row.underlyingName || row.name),
      score: cleanNumber(row.score || row.finalScore || row.warrantHeatScore || row.volumeMultiple) > 0,
      reason: nonBlank(row.reason),
      actionLabel: nonBlank(row.actionLabel) || nonBlank(row.reason),
      signalGrade: /^[ABC]$/.test(String(row.signalGrade || "").trim()) || /^[ABC]/.test(String(row.reason || "").trim()) || type !== "match",
      stockRisk: nonBlank(row.stockRisk) || nonBlank(row.reason) || type !== "match",
      quoteSource: nonBlank(row.quoteSource) || (Array.isArray(row.topWarrants) && row.topWarrants.some((item) => nonBlank(item.quoteSource))),
    };
    const warrantChecks = {
      warrantCode: rowHasAny(row, ["warrantCode"]) || (Array.isArray(row.topWarrants) && row.topWarrants.some((item) => /^\d{5,6}$/.test(String(item.code || "")))),
      warrantName: rowHasAny(row, ["warrantName"]) || (Array.isArray(row.topWarrants) && row.topWarrants.some((item) => nonBlank(item.name))),
    };
    const checks = {
      ...commonChecks,
      ...warrantChecks,
      finalScore: cleanNumber(row.finalScore) > 0,
      callValue: cleanNumber(row.callValue || row.value) > 0,
      putValue: row.putValue !== undefined && cleanNumber(row.putValue) >= 0,
      callPutRatio: cleanNumber(row.callPutRatio || row.volumeMultiple || row.warrantHeatScore || row.score) > 0,
      warrantHeatScore: cleanNumber(row.warrantHeatScore || row.score || row.finalScore) > 0,
      stockSetupScore: cleanNumber(row.stockSetupScore || row.score || row.finalScore) > 0,
      branchPowerScore: row.branchPowerScore !== undefined ? cleanNumber(row.branchPowerScore) >= 0 : true,
      branchStatus: nonBlank(row.branchStatus) || row.branchPowerScore === undefined,
      volumeMultiple: row.volumeMultiple === undefined || cleanNumber(row.volumeMultiple) > 0,
      thirtyMinuteVolume: row.thirtyMinuteVolume === undefined || cleanNumber(row.thirtyMinuteVolume) > 0,
      floatingUnits: row.floatingUnits === undefined || cleanNumber(row.floatingUnits) > 0,
    };
    if (type === "volume") {
      delete checks.finalScore;
      delete checks.putValue;
      checks.volumeMultiple = cleanNumber(row.volumeMultiple || row.callPutRatio || row.warrantHeatScore || row.score) > 0;
      checks.callValue = cleanNumber(row.callValue || row.value || row.tradeValue) > 0;
    }
    if (type === "single") {
      delete checks.finalScore;
      delete checks.putValue;
      delete checks.callValue;
      delete checks.callPutRatio;
      checks.warrantHeatScore = cleanNumber(row.warrantHeatScore || row.score || row.volumeMultiple) > 0;
    }
    for (const [key, ok] of Object.entries(checks)) {
      if (!ok) {
        blankCounts[key] += 1;
        missing.push(key);
      }
    }
    if (missing.length && sampleMissingRows.length < 10) {
      sampleMissingRows.push({
        index,
        code: String(row?.warrantCode || row?.code || row?.underlyingCode || "").trim(),
        name: String(row?.warrantName || row?.name || row?.underlyingName || "").trim(),
        missing,
      });
    }
  });
  if (!nonBlank(payload.source_snapshot_captured_at)) blankCounts.source_snapshot_captured_at += 1;
  if (!Object.prototype.hasOwnProperty.call(payload, "fallbackUsed")) blankCounts.fallbackUsed += 1;
  return {
    requiredFields: WARRANT_FLOW_REQUIRED_FIELDS,
    blankCounts,
    sampleMissingRows,
  };
}

function buildWarrantDisclosureFields(payload, options = {}) {
  const runQuality = payload?.run_quality_at_publish && typeof payload.run_quality_at_publish === "object"
    ? payload.run_quality_at_publish
    : {};
  const fallbackUsed = payload?.fallbackUsed === true || runQuality.fallbackUsed === true;
  const fallbackScope = Array.isArray(payload?.fallbackScope)
    ? payload.fallbackScope
    : Array.isArray(runQuality.fallbackScope) ? runQuality.fallbackScope : [];
  const fallbackDetails = Array.isArray(payload?.fallbackDetails)
    ? payload.fallbackDetails
    : Array.isArray(runQuality.fallbackDetails) ? runQuality.fallbackDetails : [];
  const fallbackAllowed = payload?.fallbackAllowed !== undefined
    ? payload.fallbackAllowed === true
    : runQuality.fallbackAllowed !== undefined ? runQuality.fallbackAllowed === true : fallbackUsed === false;
  const publishAllowed = payload?.publishAllowed === true || payload?.writeBudget?.allowLatestWrite === true || runQuality.publishAllowed === true;
  const writeBudget = payload?.writeBudget && typeof payload.writeBudget === "object"
    ? payload.writeBudget
    : runQuality.writeBudget && typeof runQuality.writeBudget === "object"
      ? runQuality.writeBudget
      : {
          ok: publishAllowed,
          status: publishAllowed ? "allow" : "blocked",
          allowLatestWrite: publishAllowed,
          allowCompleteRunWrite: publishAllowed,
          preservePreviousCompleteRun: !publishAllowed,
          reason: publishAllowed ? "warrant flow latest payload is publishable" : "warrant flow must preserve previous complete run",
        };
  const retentionOk = payload?.retentionOk !== undefined ? payload.retentionOk === true : publishAllowed;
  const blockReason = firstNonBlank(
    payload?.blockedReason,
    payload?.scanner_block_reason,
    options.reason,
    payload?.detail,
    payload?.reason,
    payload?.error,
    publishAllowed ? "" : "warrant_flow_latest_blocked"
  );
  return {
    ...buildWarrantFieldCompleteness(payload),
    fallbackUsed,
    fallbackScope,
    fallbackAllowed,
    fallbackDetails,
    fallbackContract: {
      contract: "fallback-disclosure-v1",
      disclosed: true,
      allowedForLatest: fallbackUsed === false && publishAllowed,
      fallbackAllowed,
      fallbackScope,
    },
    degradedBlocksLatest: payload?.degradedBlocksLatest !== undefined ? payload.degradedBlocksLatest === true : !publishAllowed,
    preservePreviousGood: payload?.preservePreviousGood !== undefined ? payload.preservePreviousGood === true : !publishAllowed,
    writeBudget,
    retentionOk,
    blockedReason: publishAllowed ? "" : String(blockReason || "warrant_flow_latest_blocked"),
    scanner_block_reason: publishAllowed ? "" : String(blockReason || "warrant_flow_latest_blocked"),
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

function normalizeRow(row, context = {}) {
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  const marketDate = compactDateKey(context.sourceDate || context.usedDate || row.scan_date || "");
  const underlyingQuoteDate = compactDateKey(payload.underlyingQuoteDate || payload.underlyingTradeDate || payload.quoteDate || "");
  const underlyingQuoteDateOk = !marketDate || !underlyingQuoteDate || underlyingQuoteDate === marketDate;
  const explicitUnderlyingClose = cleanNumber(
    payload.underlyingClose
    ?? payload.underlyingPrice
    ?? payload.stockClose
    ?? payload.stockPrice
    ?? payload.underlyingLastPrice
    ?? row.underlying_close
    ?? row.underlying_price
  );
  const explicitWarrantPrice = cleanNumber(
    payload.warrantPrice
    ?? payload.warrantClose
    ?? payload.warrantLastPrice
    ?? payload.warrant_close
    ?? payload.warrant_price
    ?? payload.price
  );
  const safeUnderlyingClose = underlyingQuoteDateOk && explicitUnderlyingClose > 0
    ? explicitUnderlyingClose
    : null;
  return {
    ...payload,
    code: String(payload.code || row.underlying_code || row.code || "").trim(),
    name: String(payload.name || row.underlying_name || row.name || "").trim(),
    underlyingCode: String(payload.underlyingCode || row.underlying_code || payload.code || "").trim(),
    underlyingName: String(payload.underlyingName || row.underlying_name || payload.name || "").trim(),
    close: safeUnderlyingClose,
    displayClose: safeUnderlyingClose,
    stockClose: safeUnderlyingClose,
    stockPrice: safeUnderlyingClose,
    underlyingClose: safeUnderlyingClose,
    underlyingPrice: safeUnderlyingClose,
    warrantPrice: explicitWarrantPrice > 0 ? explicitWarrantPrice : null,
    warrantClose: explicitWarrantPrice > 0 ? explicitWarrantPrice : null,
    warrantPriceIntegrity: explicitWarrantPrice > 0 ? "explicit_warrant_price" : "missing_explicit_warrant_price",
    underlyingPriceIntegrity: safeUnderlyingClose ? "same_trade_date_underlying_price" : "blocked_or_missing_underlying_price",
    percent: cleanNumber(payload.percent ?? payload.displayPercent ?? payload.underlyingPercent ?? row.change_percent),
    value: cleanNumber(payload.value || payload.callValue || row.trade_value),
    finalScore: cleanNumber(payload.finalScore || payload.score || row.score),
    score: cleanNumber(payload.score || payload.finalScore || row.score),
    reason: String(payload.reason || row.reason || "").trim(),
    quoteDate: marketDate || compactDateKey(payload.quoteDate || row.scan_date || ""),
    sourceTradeDate: marketDate || "",
    underlyingQuoteDate,
    underlyingQuoteDateOk,
    quoteIntegrity: underlyingQuoteDateOk ? "same_trade_date_or_missing" : "blocked_stale_underlying_quote",
  };
}

function buildPayload(rows, run, options = {}) {
  const scanDate = compactDateKey(run?.scan_date || rows[0]?.scan_date || "");
  const apiTradeDate = compactDateKey(run?.finished_at || run?.updated_at || rows[0]?.updated_at || scanDate);
  const usedDate = compactDateKey(run?.payload?.usedDate || run?.payload?.tradeDate || scanDate);
  const sourceDate = compactDateKey(run?.payload?.sourceDate || run?.payload?.tradeDate || scanDate || usedDate);
  const byType = (type) => rows
    .filter((row) => String(row.result_type || "match") === type)
    .sort((a, b) => cleanNumber(a.rank) - cleanNumber(b.rank) || String(a.code).localeCompare(String(b.code)))
    .map((row) => normalizeRow(row, { sourceDate, usedDate }))
    .filter((row) => row.underlyingQuoteDateOk !== false);
  const matches = byType("match");
  const volumeMatches = byType("volume");
  const singleSignals = byType("single");
  const outputMatches = options.canvas ? matches.slice(0, options.limit || 80) : matches;
  const outputVolumeMatches = options.canvas ? volumeMatches.slice(0, options.limit || 80) : volumeMatches;
  const outputSingleSignals = options.canvas ? singleSignals.slice(0, options.limit || 80) : singleSignals;
  const runId = String(run?.run_id || rows[0]?.run_id || "");
  const qualityStatus = String(run?.quality_status || rows[0]?.quality_status || "complete");
  const runReady = Boolean(runId && run?.complete === true && qualityStatus === "complete" && rows.length > 0);
  const sourceCoverage = {
    ok: runReady,
    ready: runReady,
    status: runReady ? "ready" : "degraded",
    reason: runReady ? "warrant_flow_complete_run_ready" : "warrant_flow_complete_run_not_ready",
    tradeDate: apiTradeDate,
    scanDate,
    usedDate,
    sourceDate,
    rowCount: rows.length,
    resultCount: cleanNumber(run?.result_count || rows.length),
    checkedAt: String(run?.finished_at || rows[0]?.updated_at || new Date().toISOString()),
  };
  return {
    ok: true,
    source: "supabase:warrant_flow_scan_results",
    cacheSource: "supabase-api",
    ...runTimeSourceSnapshotResponseFields(run?.payload || {}),
    runId,
    updatedAt: String(run?.finished_at || rows[0]?.updated_at || new Date().toISOString()),
    usedDate,
    tradeDate: apiTradeDate,
    scanDate,
    sourceDate,
    complete: true,
    qualityStatus,
    schemaVersion: String(run?.schema_version || rows[0]?.schema_version || ""),
    dataContractSource: String(run?.data_contract_source || rows[0]?.data_contract_source || "warrant-flow-cache"),
    sourceCoverage,
    expectedTotal: cleanNumber(run?.expected_total || rows.length),
    scannedCount: cleanNumber(run?.scanned_count || rows.length),
    resultCount: rows.length,
    readbackCount: rows.length,
    fallbackUsed: false,
    fallbackAllowed: true,
    fallbackScope: [],
    fallbackDetails: [],
    writeBudget: {
      ok: runReady,
      status: runReady ? "allow" : "blocked",
      allowLatestWrite: runReady,
      allowCompleteRunWrite: runReady,
      preservePreviousCompleteRun: !runReady,
      reason: runReady ? "warrant flow latest complete run is publishable" : "warrant flow must preserve previous complete run",
    },
    retentionOk: runReady,
    publishAllowed: runReady,
    degradedBlocksLatest: !runReady,
    preservePreviousGood: !runReady,
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

function warrantPayloadMarketDate(payload) {
  return compactDateKey(payload?.marketSession?.marketDataDate || payload?.sourceDate || payload?.usedDate || payload?.tradeDate || "");
}

function attachWarrantSelfCheck(payload, options = {}) {
  const dataContractOk = payload?.dataContract?.ok === true || payload?.dataContract?.skipped === true;
  const sourceOk = payload?.source === "supabase:warrant_flow_scan_results"
    && ["supabase-api", "supabase:desktop_route_snapshot"].includes(String(payload?.cacheSource || ""));
  const marketDate = warrantPayloadMarketDate(payload);
  const updatedAtOk = Number.isFinite(Date.parse(String(payload?.updatedAt || "")));
  const qualityStatus = String(payload?.qualityStatus || "");
  const issues = [];
  if (!sourceOk) issues.push("official_source_not_confirmed");
  if (!payload?.runId) issues.push("run_id_missing");
  if (!marketDate) issues.push("market_date_missing");
  if (!updatedAtOk) issues.push("updated_at_invalid");
  if (!qualityStatus) issues.push("quality_status_missing");
  if (!dataContractOk) issues.push("data_contract_not_ok");
  if (payload?.snapshotStale === true) issues.push("desktop_snapshot_stale");
  const status = options.status || (payload?.ok === false ? "blocked" : payload?.snapshotStale === true ? "stale" : issues.length ? "degraded" : "ready");
  const disclosureFields = buildWarrantDisclosureFields(payload, {
    reason: options.reason || payload?.detail || payload?.reason || (issues.length ? issues.join(";") : ""),
  });
  const normalizedRunQuality = {
    ...(payload?.run_quality_at_publish && typeof payload.run_quality_at_publish === "object" ? payload.run_quality_at_publish : {}),
    ...disclosureFields,
  };
  const runTimeSourceSnapshot = payload?.runTimeSourceSnapshot && typeof payload.runTimeSourceSnapshot === "object"
    ? { ...payload.runTimeSourceSnapshot, run_quality_at_publish: normalizedRunQuality }
    : payload?.run_time_source_snapshot && typeof payload.run_time_source_snapshot === "object"
      ? { ...payload.run_time_source_snapshot, run_quality_at_publish: normalizedRunQuality }
      : null;
  return {
    ...payload,
    ...disclosureFields,
    run_quality_at_publish: normalizedRunQuality,
    ...(runTimeSourceSnapshot ? {
      runTimeSourceSnapshot,
      run_time_source_snapshot: runTimeSourceSnapshot,
    } : {}),
    selfCheck: {
      strategy: "warrant-flow",
      contract: "api-self-check-v1",
      checkedAt: new Date().toISOString(),
      status,
      reason: options.reason || payload?.detail || payload?.reason || (issues.length ? issues.join(";") : "ready"),
      officialSource: "Supabase complete-run: warrant_flow_scan_runs + warrant_flow_scan_results",
      sourceOk,
      cacheSource: payload?.cacheSource || "",
      runId: payload?.runId || "",
      marketDate,
      updatedAt: payload?.updatedAt || "",
      qualityStatus,
      freshness: {
        runId: payload?.runId || "",
        marketDate,
        updatedAt: payload?.updatedAt || "",
        sourceDate: payload?.sourceDate || "",
        usedDate: payload?.usedDate || "",
      },
      dataContract: {
        ok: dataContractOk,
        schemaVersion: payload?.schemaVersion || "",
        requiredSchemaVersion: REQUIRED_SCHEMA_VERSION,
        issues: payload?.dataContract?.issues || payload?.issues || [],
      },
      transport: payload?.transport || null,
      issues,
    },
  };
}

function withMarketSession(payload, marketSession) {
  const closed = marketSession?.closed === true;
  return attachWarrantSelfCheck({
    ...payload,
    reason: closed ? "non-trading-day-cache" : "run_id",
    marketSession,
    transport: {
      ...(payload.transport || {}),
      gate: closed ? "non-trading-day-cache" : payload.transport?.gate || "run_id",
      fetchedAt: new Date().toISOString(),
    },
  });
}

async function handler(request, response) {
  const marketCalendar = await buildMarketCalendarContract().catch(() => null);
  installMarketCalendarResponse(response, marketCalendar);
  wrapJsonRunTimeSourceEvidence(response, { strategy: "warrant-flow", endpoint: "api/warrant-flow-latest" });
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");

  if (request.method !== "GET") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  const options = readRequestOptions(request);

  const cached = options.forceLive ? null : await readEndpointFromDesktopSnapshot(request, {
    timeoutMs: 700,
    via: "api/warrant-flow-latest",
  });
  if (cached) {
    setDesktopSnapshotCache(response);
    sendJson(request, response, attachWarrantSelfCheck(cached, { status: cached.snapshotStale ? "stale" : "ready", reason: cached.snapshotStale ? "desktop_snapshot_stale" : "desktop_snapshot_self_checked" }), "warrant-flow");
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

  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      if (options.snapshotFriendly) {
        response.status(200).json(attachWarrantSelfCheck(emptySnapshotPayload("supabase_not_configured", tradingDay, options), { status: "degraded" }));
        return;
      }
      response.status(503).json(attachWarrantSelfCheck(apiOnlyError("supabase_not_configured", tradingDay), { status: "blocked" }));
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
      const releasePayload = readReleaseWarrantSummaryPayload(options, sourceErrors.join(" | ") || "warrant_flow_scan_results_latest_empty");
      if (releasePayload) {
        setDesktopSnapshotCache(response);
        sendJson(request, response, withMarketSession(releasePayload, buildMarketSession(tradingDay, releasePayload)), "warrant-flow");
        return;
      }
      if (options.snapshotFriendly) {
        response.status(200).json(attachWarrantSelfCheck(emptySnapshotPayload(sourceErrors.join(" | ") || "warrant_flow_scan_results_latest_empty", tradingDay, options), { status: "degraded" }));
        return;
      }
      response.status(404).json(attachWarrantSelfCheck(apiOnlyError(sourceErrors.join(" | ") || "warrant_flow_scan_results_latest_empty", tradingDay), { status: "blocked" }));
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
      response.status(503).json(attachWarrantSelfCheck({
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
      }, { status: "blocked", reason: "warrant_flow_contract_invalid" }));
      return;
    }
    setDesktopSnapshotCache(response);
    sendJson(request, response, withMarketSession(payload, buildMarketSession(tradingDay, payload)), "warrant-flow");
  } catch (error) {
    if (options.snapshotFriendly) {
      response.status(200).json(attachWarrantSelfCheck(emptySnapshotPayload(error?.message || String(error), tradingDay, options), { status: "degraded" }));
      return;
    }
    response.status(503).json(attachWarrantSelfCheck(apiOnlyError(error?.message || String(error), tradingDay), { status: "blocked" }));
  }
}

module.exports = withEntitlementRequired(handler, "warrant-flow");
module.exports._prewater = {
  apiOnlyError,
  attachWarrantSelfCheck,
  buildPayload,
  completeRunGateIssues,
  emptySnapshotPayload,
  readRequestOptions,
  validateDataContract,
};

