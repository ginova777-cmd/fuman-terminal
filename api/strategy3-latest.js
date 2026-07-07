const fs = require("fs");
const path = require("path");
const { readEndpointFromDesktopSnapshot } = require("../lib/desktop-route-snapshot-cache");
const { auditRunTimeSourceSnapshot, runTimeSourceSnapshotResponseFields, wrapJsonRunTimeSourceEvidence } = require("../lib/run-time-source-snapshot-contract");
const { terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");
const { readSnapshot } = require("../lib/supabase-snapshots");

function readSecretText(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = terminalSupabaseUrl({ runtimeDir: RUNTIME_DIR });
const SUPABASE_KEY = terminalSupabaseKey({ runtimeDir: RUNTIME_DIR });

const TABLE = process.env.STRATEGY3_SUPABASE_RESULTS_TABLE || "strategy3_scan_results";
const LATEST_RUN_VIEW = process.env.STRATEGY3_SUPABASE_LATEST_RUN_VIEW || "v_strategy3_latest_complete_run";
const SNAPSHOT_KEY = process.env.STRATEGY3_SUPABASE_SNAPSHOT_KEY || "strategy3_latest";
const DESKTOP_SNAPSHOT_READ_TIMEOUT_MS = Number(process.env.STRATEGY3_DESKTOP_ROUTE_SNAPSHOT_READ_TIMEOUT_MS || process.env.FUMAN_STRATEGY3_DESKTOP_ROUTE_SNAPSHOT_READ_TIMEOUT_MS || 2500);
const STRATEGY3_INTRADAY_STATUS_SOURCE = process.env.STRATEGY3_SUPABASE_1M_STATUS_VIEW || "v_strategy2_intraday_ready";
const FORMAL_SOURCE_CHAIN = `fugle_quotes_latest+${STRATEGY3_INTRADAY_STATUS_SOURCE}+stock_daily_volume`;
const STRATEGY3_PREWATER_RESPONSE_FIELDS = [
  "source_snapshot_captured_at",
  "source_status_at_run",
  "quote_coverage_at_run",
  "intraday_1m_readiness_at_run",
  "ma_readiness_at_run",
  "preopen_futopt_daily_readiness_at_run",
  "run_quality_at_publish",
  "fallbackUsed",
  "fallbackScope",
  "fallbackAllowed",
  "fallbackDetails",
  "fallbackContract",
  "degradedBlocksLatest",
  "preservePreviousGood",
  "writeBudget",
  "retentionOk",
  "evidenceStatus",
  "unattendedStatus",
  "requiredFields",
  "blankCounts",
  "sampleMissingRows",
  "blockedReason",
  "scanner_block_reason",
];

function apiOnlyError(reason = "") {
  return {
    ok: false,
    status: "critical",
    sourceStatus: "critical",
    dataContractSource: FORMAL_SOURCE_CHAIN,
    error: "strategy3_api_only_unavailable",
    detail: reason,
    sourceCoverage: {
      source: FORMAL_SOURCE_CHAIN,
      fresh_quote_coverage_120s: 0,
      freshQuoteCoverage120s: 0,
      today_1m_symbols: 0,
      today1mSymbols: 0,
      ready_ge_35: 0,
      readyGe35: 0,
      latest_candle_time: "",
      latestCandleTime: "",
      intraday_1m_stale_seconds: null,
      intraday1mStaleSeconds: null,
      preopenCoverage: null,
      dailyVolumeFreshness: "",
    },
    staleSeconds: null,
    latestRunId: "",
    fallbackUsed: false,
    fallbackScope: [],
    fallbackDetails: [],
    writeBudget: {
      ok: false,
      status: "blocked",
      mode: "complete-run-preserve-on-degraded",
      latestOverwriteBlockedOnDegraded: true,
      reason,
    },
    retentionOk: false,
    issues: [reason || "strategy3 api unavailable"].filter(Boolean),
    warnings: [],
    cacheSource: "none",
    matches: [],
    transport: {
      source: "supabase",
      latestRunView: LATEST_RUN_VIEW,
      gate: "run_id",
      via: "api/strategy3-latest",
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

function secondsSince(value) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.round((Date.now() - parsed) / 1000));
}

function parseRequestOptions(request) {
  try {
    const url = new URL(request.url || "", "http://localhost");
    const query = request.query && typeof request.query === "object" ? request.query : {};
    const param = (key) => url.searchParams.get(key) ?? query[key];
    const canvas = param("canvas") === "1" || param("compact") === "1" || param("shell") === "1";
    const live = param("live") === "1";
    const verify = param("verify") === "1";
    const noSnapshot = param("noSnapshot") === "1" || live || verify;
    const limit = Math.max(1, Math.min(canvas ? 120 : 2000, cleanNumber(param("limit")) || (canvas ? 60 : 2000)));
    return { canvas, limit, live, verify, noSnapshot };
  } catch {
    return { canvas: false, limit: 2000, live: false, verify: false, noSnapshot: false };
  }
}

function normalizeSignals(value) {
  return Array.isArray(value) ? value : [];
}

function normalizePayload(row) {
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  const signals = normalizeSignals(payload.matches || payload.signals || row.signals);
  const rawName = String(payload.rawName || payload.name || row.name || row.code || "").trim();
  const tvOk = Boolean(payload.tvOk || payload.tvFlame || payload.tvOvernightEntry?.ok);
  const displayName = String(payload.displayName || (tvOk && rawName ? `${rawName} 🔥` : rawName)).trim();
  const runId = String(payload.runId || payload.run_id || row.runId || row.run_id || "").trim();
  const updatedAt = String(payload.updatedAt || payload.updated_at || row.updatedAt || row.updated_at || row.generated_at || "").trim();
  const source = String(payload.source || row.source || payload.quoteSource || row.quote_source || "strategy3_scan_results").trim();
  return {
    ...payload,
    code: String(payload.code || row.code || "").trim(),
    runId,
    rawName,
    displayName,
    tvOk,
    tvFlame: tvOk,
    name: displayName || rawName,
    close: cleanNumber(payload.close || payload.price || row.close || row.price),
    price: cleanNumber(payload.price || payload.close || row.price || row.close),
    percent: cleanNumber(payload.percent ?? payload.changePercent ?? row.change_percent),
    tradeVolume: cleanNumber(payload.tradeVolume || payload.volume || row.trade_volume || row.volume),
    volume: cleanNumber(payload.volume || payload.tradeVolume || row.volume || row.trade_volume),
    value: cleanNumber(payload.value || payload.tradeValue || row.trade_value),
    tradeValue: cleanNumber(payload.tradeValue || payload.value || row.trade_value),
    score: cleanNumber(payload.score || payload.overnightScore || row.score),
    overnightScore: cleanNumber(payload.overnightScore || payload.score || row.score),
    matches: signals,
    source,
    updatedAt,
    reason: String(payload.tvOvernightEntry?.reason || payload.reason || row.reason || signals.map((signal) => signal.reason).filter(Boolean).join("；")).trim(),
  };
}

function normalizeSnapshotRows(payload) {
  return Array.isArray(payload?.matches) ? payload.matches
    : Array.isArray(payload?.rows) ? payload.rows
      : [];
}

function strategy3TvOk(row) {
  const payload = row?.payload && typeof row.payload === "object" ? row.payload : row;
  return Boolean(payload?.tvOk || payload?.tvFlame || payload?.tvOvernightEntry?.ok);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function findSourceCheck(sourceDriftHealth, source) {
  return asArray(sourceDriftHealth?.checks).find((item) => item?.source === source) || {};
}

function firstNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = cleanNumber(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function metricFromMessage(message, key) {
  const escaped = String(key || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(message || "").match(new RegExp(`(?:^|[;\\s])${escaped}=([^;\\s]+)`, "i"));
  return match ? match[1] : "";
}

function ratio(numerator, denominator) {
  const a = cleanNumber(numerator);
  const b = cleanNumber(denominator);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return null;
  return Number((a / b).toFixed(4));
}

function rowPayload(row) {
  return row?.payload && typeof row.payload === "object" ? row.payload : row || {};
}

function tvDiagnosticFallback(row) {
  const payload = rowPayload(row);
  const entry = payload.tvOvernightEntry && typeof payload.tvOvernightEntry === "object" ? payload.tvOvernightEntry : {};
  const breakdown = payload.tvBreakdown && typeof payload.tvBreakdown === "object" ? payload.tvBreakdown : {};
  const fallbackFrom = String(
    payload.candleFallbackFrom
    || payload.tvCandleFallbackFrom
    || entry.candleFallbackFrom
    || breakdown.candleFallbackFrom
    || ""
  ).trim();
  if (!fallbackFrom) return null;
  return {
    symbol: String(payload.code || payload.symbol || row?.code || row?.symbol || "").trim(),
    name: String(payload.rawName || payload.name || payload.displayName || row?.name || "").replace(/🔥/g, "").trim(),
    scope: "tv_candle_diagnostic",
    fallbackFrom,
    fallbackSource: String(entry.candleSource || breakdown.candleSource || payload.tvCandleSource || payload.candleSource || "").trim(),
    fallbackReason: String(payload.candleFallbackReason || payload.tvCandleFallbackReason || entry.candleFallbackReason || breakdown.candleFallbackReason || "").trim(),
    fallbackError: String(payload.candleFallbackError || payload.tvCandleFallbackError || entry.candleFallbackError || breakdown.candleFallbackError || "").trim(),
    allowed: true,
    formalSource: false,
    purpose: "TV candle diagnostic quality rescue; publish gate remains formal Supabase source-chain",
  };
}

function tvDiagnosticFallbackDetails(rows) {
  return asArray(rows).map(tvDiagnosticFallback).filter(Boolean);
}

function hasTvDiagnosticFallback(rows) {
  return tvDiagnosticFallbackDetails(rows).length > 0;
}

function hasSourceFallback(sourceWarnings) {
  return asArray(sourceWarnings).some((warning) => {
    const text = String(warning || "");
    return /fallback/i.test(text) && !/tv.*candle.*diagnostic|tv.*diagnostic|candle.*diagnostic/i.test(text);
  });
}

function liveProbeIssues(probe) {
  const issues = [];
  const sourceStatus = String(probe?.sourceStatus?.status || "").toLowerCase();
  const scannerStatus = String(probe?.scannerHealth?.status || "").toLowerCase();
  if (sourceStatus && !["ok", "ready"].includes(sourceStatus)) {
    issues.push(`source_status=${sourceStatus}${probe?.sourceStatus?.message ? `: ${probe.sourceStatus.message}` : ""}`);
  }
  if (scannerStatus && scannerStatus !== "ready") {
    issues.push(`scanner_resource_health=${scannerStatus}${probe?.scannerHealth?.reason ? `: ${probe.scannerHealth.reason}` : ""}`);
  }
  for (const issue of asArray(probe?.issues)) issues.push(issue);
  return issues;
}

function buildUnattendedContract(payload, context = {}) {
  const sourceHealth = payload?.sourceHealth && typeof payload.sourceHealth === "object" ? payload.sourceHealth : {};
  const sourceDriftHealth = payload?.sourceDriftHealth && typeof payload.sourceDriftHealth === "object" ? payload.sourceDriftHealth : {};
  const scanCoverage = payload?.scanCoverage && typeof payload.scanCoverage === "object" ? payload.scanCoverage : {};
  const sourceWarnings = asArray(payload?.sourceWarnings);
  const rows = normalizeSnapshotRows(payload);
  const liveProbe = context.liveProbe || null;
  const sourceStatusPayload = liveProbe?.sourceStatus?.payload && typeof liveProbe.sourceStatus.payload === "object" ? liveProbe.sourceStatus.payload : {};
  const sourceStatusMessage = String(liveProbe?.sourceStatus?.message || "");
  const quoteCheck = findSourceCheck(sourceDriftHealth, "fugle_quotes_latest");
  const intradayCheck = findSourceCheck(sourceDriftHealth, STRATEGY3_INTRADAY_STATUS_SOURCE);
  const dailyVolumeCheck = findSourceCheck(sourceDriftHealth, "stock_daily_volume");
  const freshQuoteCoverage120s = firstNumber(
    sourceStatusPayload.fresh_quote_coverage_120s,
    sourceStatusPayload.eligible_quote_coverage,
    sourceStatusPayload.coverage_120s,
    sourceStatusPayload.coverage120s,
    ratio(sourceStatusPayload.fresh_quotes, sourceStatusPayload.active_symbols),
    ratio(sourceStatusPayload.fresh_quote_count_120s, sourceStatusPayload.active_symbols)
  );
  const freshQuotes = firstNumber(
    sourceStatusPayload.fresh_quotes,
    sourceStatusPayload.fresh_quote_count_120s,
    sourceStatusPayload.freshQuoteCount120s
  );
  const activeSymbols = firstNumber(
    sourceStatusPayload.active_symbols,
    sourceStatusPayload.activeSymbols,
    sourceStatusPayload.eligible_quote_rows,
    sourceStatusPayload.quote_count
  );
  const today1mSymbols = firstNumber(
    sourceStatusPayload.today_1m_symbols,
    sourceStatusPayload.intraday_1m_symbols_today,
    sourceStatusPayload.today1mSymbols
  );
  const readyGe35 = firstNumber(
    sourceStatusPayload.ready_ge_35,
    sourceStatusPayload.ready_ge_35_symbols,
    sourceStatusPayload.readyGe35
  );
  const readyMa20 = firstNumber(
    sourceStatusPayload.ready_ma20_continuous,
    sourceStatusPayload.ready_ma20_continuous_symbols,
    sourceStatusPayload.readyMa20Continuous
  );
  const readyMa35 = firstNumber(
    sourceStatusPayload.ready_ma35_continuous,
    sourceStatusPayload.ready_ma35_continuous_symbols,
    sourceStatusPayload.readyMa35Continuous,
    readyGe35
  );
  const latestCandleTime = sourceStatusPayload.latest_candle_time
    || sourceStatusPayload.latest_candle_time_taipei
    || sourceStatusPayload.intraday_1m_latest_candle_time
    || sourceHealth.latestCandleTime
    || "";
  const staleSeconds = firstNumber(
    sourceStatusPayload.intraday_1m_stale_seconds,
    sourceStatusPayload.stale_seconds,
    latestCandleTime ? secondsSince(latestCandleTime) : null
  );
  const tvFallbackDetails = tvDiagnosticFallbackDetails(rows);
  const tvDiagnosticFallbackUsed = tvFallbackDetails.length > 0;
  const sourceFallbackUsed = hasSourceFallback(sourceWarnings);
  const fallbackUsed = sourceFallbackUsed || tvDiagnosticFallbackUsed;
  const sourceUniverseCount = cleanNumber(sourceHealth.stockUniverseCount || scanCoverage.sourceUniverseCount || payload.total);
  const preopenRows = firstNumber(
    sourceStatusPayload.preopen_rows,
    sourceStatusPayload.preopenSymbols,
    sourceStatusPayload.preopen_symbols,
    metricFromMessage(sourceStatusMessage, "preopen")
  );
  const preopenExpected = firstNumber(
    sourceStatusPayload.preopen_expected_symbols,
    sourceStatusPayload.preopenExpected,
    sourceStatusPayload.eligible_quote_rows,
    metricFromMessage(sourceStatusMessage, "eligible_quote_rows"),
    sourceUniverseCount
  );
  const preopenCoverage = firstNumber(
    sourceStatusPayload.preopen_coverage,
    sourceStatusPayload.preopen_hot_coverage,
    ratio(preopenRows, preopenExpected)
  );
  const issues = [
    ...asArray(sourceHealth.issues),
    ...(sourceDriftHealth.status && sourceDriftHealth.status !== "ready" ? [`sourceDriftHealth=${sourceDriftHealth.status}: ${sourceDriftHealth.reason || ""}`.trim()] : []),
    ...liveProbeIssues(liveProbe),
  ].filter(Boolean);
  const warnings = [
    ...sourceWarnings,
    ...asArray(sourceHealth.warnings),
    ...(tvDiagnosticFallbackUsed ? ["TV candle diagnostic fallback used; publish gate remains formal Supabase source-chain"] : []),
  ].filter(Boolean);
  const liveSourceStatus = String(liveProbe?.sourceStatus?.status || "").toLowerCase();
  const scannerStatus = String(liveProbe?.scannerHealth?.status || "").toLowerCase();
  const hardSourceStatus = ["critical", "failed", "error"].includes(liveSourceStatus)
    || ["failed", "not_ready"].includes(scannerStatus);
  const degradedSourceStatus = liveSourceStatus === "degraded"
    || scannerStatus === "stale"
    || scannerStatus === "degraded"
    || sourceFallbackUsed
    || issues.length > 0;
  const status = hardSourceStatus
    ? "critical"
    : degradedSourceStatus
      ? "degraded"
      : "ready";
  return {
    status,
    sourceStatus: status,
    dataContractSource: FORMAL_SOURCE_CHAIN,
    sourceCoverage: {
      source: FORMAL_SOURCE_CHAIN,
      fresh_quote_coverage_120s: freshQuoteCoverage120s,
      freshQuoteCoverage120s,
      fresh_quotes: freshQuotes,
      freshQuotes,
      active_symbols: activeSymbols,
      activeSymbols,
      quote_age_seconds: firstNumber(sourceStatusPayload.quote_age_seconds, sourceStatusPayload.quoteAgeSeconds, sourceStatusPayload.stale_seconds),
      quoteAgeSeconds: firstNumber(sourceStatusPayload.quote_age_seconds, sourceStatusPayload.quoteAgeSeconds, sourceStatusPayload.stale_seconds),
      today_1m_symbols: today1mSymbols,
      today1mSymbols,
      ready_ge_35: readyGe35,
      readyGe35,
      ready_ma20_continuous: readyMa20,
      ready_ma20_continuous_symbols: readyMa20,
      ready_ma35_continuous: readyMa35,
      ready_ma35_continuous_symbols: readyMa35,
      latest_candle_time: latestCandleTime,
      latestCandleTime,
      intraday_1m_stale_seconds: staleSeconds,
      intraday1mStaleSeconds: staleSeconds,
      preopenCoverage,
      preopenRows,
      preopenExpected,
      dailyVolumeFreshness: dailyVolumeCheck.latestDate || "",
      quoteRows: cleanNumber(quoteCheck.rowCount),
      quoteMinRequired: cleanNumber(quoteCheck.minRequired),
      intradayStatusRows: cleanNumber(intradayCheck.rowCount),
      intradayStatusMinRequired: cleanNumber(intradayCheck.minRequired),
      dailyVolumeRows: cleanNumber(dailyVolumeCheck.rowCount),
      dailyVolumeMinRequired: cleanNumber(dailyVolumeCheck.minRequired),
      sessionReadyCount: cleanNumber(sourceHealth.intraday1mReadyCount || scanCoverage.sessionReadyCandidates),
      sourceUniverseCount,
      fieldGateCandidates: cleanNumber(scanCoverage.fieldGateCandidates || payload.count),
    },
    staleSeconds,
    latestRunId: String(payload.runId || context.latestRunId || ""),
    fallbackUsed,
    diagnosticFallbackUsed: tvDiagnosticFallbackUsed,
    diagnosticFallbackScope: tvDiagnosticFallbackUsed ? ["tv_candle_diagnostic"] : [],
    diagnosticFallbackDetails: tvFallbackDetails.slice(0, 20),
    fallbackScope: [
      sourceFallbackUsed ? "source" : "",
      tvDiagnosticFallbackUsed ? "tv_candle_diagnostic" : "",
    ].filter(Boolean),
    fallbackDetails: [
      ...(sourceFallbackUsed ? [{
        scope: "source",
        fallbackFrom: FORMAL_SOURCE_CHAIN,
        fallbackSource: "sourceWarnings",
        fallbackReason: sourceWarnings.filter((warning) => /fallback/i.test(String(warning || ""))).join("; "),
        allowed: false,
        formalSource: true,
        purpose: "source fallback would block publish",
      }] : []),
      ...tvFallbackDetails.slice(0, 20),
    ],
    fallbackContract: {
      tv_candle_diagnostic: {
        allowed: true,
        formalSource: false,
        publishGateSource: FORMAL_SOURCE_CHAIN,
        purpose: "TV candle diagnostic quality rescue only",
      },
      source: {
        allowed: false,
        formalSource: true,
        publishGateSource: FORMAL_SOURCE_CHAIN,
        purpose: "formal source fallback is not allowed for publish",
      },
    },
    writeBudget: {
      ok: status === "ready",
      status: status === "ready" ? "protected" : "blocked",
      mode: "complete-run-preserve-on-degraded",
      latestOverwriteBlockedOnDegraded: status !== "ready",
      reason: status === "ready" ? "" : issues.join("; ") || `source status ${status}`,
    },
    retentionOk: Boolean(payload.complete !== false && (payload.runId || context.latestRunId)),
    issues,
    warnings,
  };
}

function attachStrategy3UnattendedContract(payload, context = {}) {
  if (!payload || typeof payload !== "object") return payload;
  const contract = buildUnattendedContract(payload, context);
  const sourceFallbackBlocked = Array.isArray(contract.fallbackScope) && contract.fallbackScope.includes("source");
  const currentSourceReady = contract.status === "ready" && !sourceFallbackBlocked;
  const runQuality = payload.run_quality_at_publish && typeof payload.run_quality_at_publish === "object"
    ? payload.run_quality_at_publish
    : {};
  const sourceStatusAtRun = payload.source_status_at_run && typeof payload.source_status_at_run === "object"
    ? payload.source_status_at_run
    : {};
  const sourceAtRunReady = String(sourceStatusAtRun.status || "").toLowerCase() === "ready"
    && sourceStatusAtRun.ok !== false
    && !sourceFallbackBlocked;
  const publishEvidenceAtRunReady = runQuality.publishAllowed === true
    && sourceAtRunReady
    && payload.fallbackUsed !== true
    && !(Array.isArray(payload.fallbackScope) && payload.fallbackScope.includes("source"));
  const sourceCoverage = {
    ...(contract.sourceCoverage || {}),
    ok: currentSourceReady,
    ready: currentSourceReady,
    status: currentSourceReady ? "ready" : contract.status,
    currentLiveStatus: contract.status,
    currentLiveReason: contract.status === "ready" ? "" : contract.issues?.join("; ") || "",
  };
  const fallbackScope = Array.isArray(contract.fallbackScope) ? contract.fallbackScope : [];
  const fallbackAllowed = fallbackScope.every((scope) => contract.fallbackContract?.[scope]?.allowed === true);
  const snapshotAudit = auditRunTimeSourceSnapshot(payload);
  const sourceEvidenceIssues = Array.isArray(snapshotAudit.issues) ? snapshotAudit.issues : [];
  const sourceEvidenceMissingFields = Array.isArray(snapshotAudit.missingFields) ? snapshotAudit.missingFields : [];
  const sourceEvidenceStatus = snapshotAudit.ok && fallbackAllowed && (publishEvidenceAtRunReady || currentSourceReady) ? "complete" : "insufficient";
  const resultCount = cleanNumber(payload.count ?? runQuality.resultCount);
  const emptyResultApproved = resultCount === 0 && payload.emptyCompleteReleaseOwnerApproved === true;
  const emptyResultBlocksLatest = resultCount === 0 && !emptyResultApproved;
  const emptyResultIssue = emptyResultBlocksLatest
    ? "empty_result_requires_release_owner_approval"
    : "";
  const contractIssues = [
    ...(Array.isArray(contract.issues) ? contract.issues : []),
    ...sourceEvidenceIssues,
    emptyResultIssue,
  ].filter(Boolean);
  const apiPublishAllowed = snapshotAudit.ok
    && (publishEvidenceAtRunReady || currentSourceReady)
    && fallbackAllowed
    && runQuality.publishAllowed !== false
    && !emptyResultBlocksLatest;
  const apiPreservePreviousGood = apiPublishAllowed
    ? runQuality.preservePreviousGood === true
    : true;
  const blockedReason = apiPublishAllowed ? "" : contractIssues.join("; ") || "strategy3 source evidence incomplete";
  const runQualityAtPublish = {
    ...runQuality,
    publishAllowed: apiPublishAllowed,
    latestOverwriteAllowed: apiPublishAllowed
      ? runQuality.latestOverwriteAllowed !== false
      : false,
    degradedBlocksLatest: !apiPublishAllowed || runQuality.degradedBlocksLatest === true,
    preservePreviousGood: apiPreservePreviousGood,
    fallbackUsed: contract.fallbackUsed,
    fallbackScope,
    fallbackAllowed,
    fallbackDetails: contract.fallbackDetails,
    fallbackContract: contract.fallbackContract,
    evidenceStatus: sourceEvidenceStatus,
    unattendedStatus: apiPublishAllowed ? "YES" : "NO",
    blockedReason,
    scanner_block_reason: blockedReason,
    writeBudget: contract.writeBudget,
    retentionOk: contract.retentionOk,
  };
  const existingSnapshotFields = snapshotAudit.ok ? runTimeSourceSnapshotResponseFields(payload) : {};
  const payloadWithContract = {
    ...payload,
    ...contract,
    sourceCoverage,
    sourceEvidenceStatus,
    sourceEvidenceMissingFields,
    sourceEvidenceIssues,
    evidenceStatus: sourceEvidenceStatus,
    unattendedStatus: apiPublishAllowed ? "YES" : "NO",
    publishAllowed: apiPublishAllowed,
    latestOverwriteAllowed: runQualityAtPublish.latestOverwriteAllowed,
    degradedBlocksLatest: !apiPublishAllowed,
    preservePreviousGood: apiPreservePreviousGood,
    fallbackAllowed,
    run_quality_at_publish: runQualityAtPublish,
    blockedReason,
    scanner_block_reason: blockedReason,
    issues: contractIssues,
    sourceHealth: payload.sourceHealth || null,
  };
  return {
    ...existingSnapshotFields,
    ...payloadWithContract,
  };
}

function normalizeStrategy3ApiContract(payload, context = {}) {
  if (!payload || typeof payload !== "object") return payload;
  const rows = normalizeSnapshotRows(payload);
  const tvPassCount = Object.prototype.hasOwnProperty.call(payload, "tvPassCount")
    ? cleanNumber(payload.tvPassCount)
    : cleanNumber(payload.selfTest?.tvPassCount || payload.publishedSelfTest?.tvPassCount)
      || rows.filter(strategy3TvOk).length;
  return attachStrategy3UnattendedContract({
    ...payload,
    tvPassCount,
  }, context);
}

function normalizeSourceHealth(value) {
  const sourceHealth = value && typeof value === "object" ? { ...value } : null;
  if (!sourceHealth) return null;
  const issueCount = Array.isArray(sourceHealth.issues) ? sourceHealth.issues.length : 0;
  const warningCount = cleanNumber(sourceHealth.warningCount);
  const warningLimit = cleanNumber(sourceHealth.warningLimit) || 3;
  const status = String(sourceHealth.status || "");
  if (status === "degraded" && issueCount === 0 && warningCount <= warningLimit) {
    sourceHealth.status = "ok";
    sourceHealth.normalizedFrom = "degraded";
    sourceHealth.normalizedReason = "non-blocking warnings under limit";
  }
  return sourceHealth;
}

async function fetchStrategy3LiveHealthProbe() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const [scannerResult, sourceStatusResult] = await Promise.allSettled([
    fetchRowsFrom("v_scanner_resource_health", [
      "select=strategy,status,latest_date,row_count,reason,suggested_scanner_behavior,updated_at",
      "strategy=eq.Strategy3",
      "limit=1",
    ].join("&")),
    fetchRowsFrom("source_status", [
      "select=source_name,status,updated_at,stale_seconds,message,payload",
      "source_name=eq.fugle_shared_source",
      "limit=1",
    ].join("&")),
  ]);
  const issues = [];
  if (scannerResult.status === "rejected") issues.push(`v_scanner_resource_health read failed: ${scannerResult.reason?.message || scannerResult.reason}`);
  if (sourceStatusResult.status === "rejected") issues.push(`source_status read failed: ${sourceStatusResult.reason?.message || sourceStatusResult.reason}`);
  return {
    scannerHealth: scannerResult.status === "fulfilled" ? scannerResult.value?.[0] || null : null,
    sourceStatus: sourceStatusResult.status === "fulfilled" ? sourceStatusResult.value?.[0] || null : null,
    issues,
  };
}

function buildPayload(rows, run, options = {}) {
  const first = rows[0] || {};
  const matches = rows
    .slice()
    .sort((a, b) => cleanNumber(a.rank) - cleanNumber(b.rank) || String(a.code).localeCompare(String(b.code)))
    .map(normalizePayload);
  const scanDate = String(first.scan_date || run?.scan_date || "").replace(/-/g, "");
  const sourceHealth = normalizeSourceHealth(run?.payload?.sourceHealth);
  const qualityStatus = sourceHealth?.status || String(first.quality_status || run?.quality_status || "");
  const resultCount = cleanNumber(run?.result_count || run?.payload?.count);
  const displayMode = String(run?.payload?.displayMode || first.payload?.displayMode || "").trim();
  const noMatchReason = String(run?.payload?.noMatchReason || first.payload?.noMatchReason || "").trim();
  return attachStrategy3UnattendedContract({
    ok: true,
    source: "supabase:strategy3_scan_results",
    cacheSource: "supabase-api",
    ...runTimeSourceSnapshotResponseFields(run?.payload || {}),
    runId: String(first.run_id || run?.run_id || ""),
    generatedAt: String(first.generated_at || run?.generated_at || run?.finished_at || first.updated_at || new Date().toISOString()),
    updatedAt: String(run?.finished_at || first.updated_at || new Date().toISOString()),
    usedDate: scanDate,
    complete: true,
    canvas: Boolean(options.canvas),
    qualityStatus,
    tvPassCount: cleanNumber(run?.payload?.tvPassCount) || matches.filter(strategy3TvOk).length,
    count: Math.max(matches.length, resultCount),
    returnedCount: matches.length,
    total: Math.max(matches.length, cleanNumber(run?.expected_total || run?.scanned_count)),
    sourceHealth,
    sourceCoverage: run?.payload?.sourceCoverage || null,
    sourceDriftHealth: run?.payload?.sourceDriftHealth || null,
    scanCoverage: run?.payload?.scanCoverage || null,
    selfTest: run?.payload?.selfTest || null,
    publishedSelfTest: run?.payload?.publishedSelfTest || null,
    displayMode,
    noMatchReason,
    matches,
    transport: {
      source: "supabase",
      table: TABLE,
      latestRunView: LATEST_RUN_VIEW,
      gate: "run_id",
      runId: String(first.run_id || run?.run_id || ""),
      via: "api/strategy3-latest",
      fetchedAt: new Date().toISOString(),
    },
  }, { liveProbe: options.liveProbe, latestRunId: String(first.run_id || run?.run_id || "") });
}

function buildSnapshotPayload(snapshot, options = {}) {
  const sourcePayload = snapshot?.payload && typeof snapshot.payload === "object" ? snapshot.payload : null;
  if (!sourcePayload) return null;
  const rows = normalizeSnapshotRows(sourcePayload);
  const snapshotRunId = String(sourcePayload.runId || snapshot.snapshotId || "").trim();
  const snapshotUpdatedAt = String(sourcePayload.updatedAt || snapshot.updatedAt || new Date().toISOString());
  const matches = rows
    .slice(0, options.limit || rows.length)
    .map((row, index) => normalizePayload({
      ...row,
      rank: row.rank || index + 1,
      runId: row.runId || row.run_id || snapshotRunId,
      updatedAt: row.updatedAt || row.updated_at || snapshotUpdatedAt,
      source: row.source || sourcePayload.source || "strategy3_scan_results",
      payload: {
        ...row,
        runId: row.runId || row.run_id || snapshotRunId,
        updatedAt: row.updatedAt || row.updated_at || snapshotUpdatedAt,
        source: row.source || sourcePayload.source || "strategy3_scan_results",
      },
    }));
  const count = Math.max(cleanNumber(sourcePayload.count), rows.length);
  const total = Math.max(cleanNumber(sourcePayload.total), count);
  return attachStrategy3UnattendedContract({
    ...sourcePayload,
    ...runTimeSourceSnapshotResponseFields(sourcePayload),
    ok: sourcePayload.ok !== false,
    source: sourcePayload.source || "strategy3_scan_results",
    cacheSource: "supabase-snapshot",
    runId: snapshotRunId,
    updatedAt: snapshotUpdatedAt,
    generatedAt: String(sourcePayload.generatedAt || sourcePayload.updatedAt || snapshot.updatedAt || new Date().toISOString()),
    usedDate: String(sourcePayload.usedDate || snapshot.tradeDate || "").replace(/\D/g, ""),
    complete: sourcePayload.complete !== false,
    canvas: Boolean(options.canvas),
    qualityStatus: sourcePayload.qualityStatus || sourcePayload.sourceHealth?.status || "",
    tvPassCount: cleanNumber(sourcePayload.tvPassCount) || cleanNumber(sourcePayload.selfTest?.tvPassCount || sourcePayload.publishedSelfTest?.tvPassCount) || rows.filter(strategy3TvOk).length,
    count,
    returnedCount: matches.length,
    total,
    matches,
    rows: matches,
    transport: {
      ...(sourcePayload.transport || {}),
      source: "supabase-snapshot",
      snapshotKey: SNAPSHOT_KEY,
      snapshotId: snapshot.snapshotId || "",
      runId: snapshotRunId,
      gate: "latest-snapshot",
      via: "api/strategy3-latest",
      fetchedAt: new Date().toISOString(),
    },
  }, { liveProbe: options.liveProbe, latestRunId: snapshotRunId });
}

async function readLatestSnapshot(options) {
  const snapshot = await readSnapshot(SNAPSHOT_KEY, {
    allowLatestFallback: true,
    timeoutMs: Number(process.env.STRATEGY3_SNAPSHOT_READ_TIMEOUT_MS || 1600),
  });
  return buildSnapshotPayload(snapshot, options);
}

async function fetchLatestCompleteRun() {
  const rows = await fetchRowsFrom(
    LATEST_RUN_VIEW,
    [
      "select=*",
      "strategy=eq.strategy3",
      "status=eq.complete",
      "complete=eq.true",
      "limit=1",
    ].join("&")
  );
  const row = rows[0];
  return row?.run_id ? row : null;
}

async function fetchLatestCompleteRows(limit = 2000) {
  const run = await fetchLatestCompleteRun();
  if (!run?.run_id) return { rows: [], run: null };
  const rows = await fetchRowsFrom(
    TABLE,
    [
      "select=run_id,scan_date,code,name,price,close,change_percent,volume,trade_volume,trade_value,score,rank,reason,signals,payload,complete,quality_status,generated_at,updated_at",
      "strategy=eq.strategy3",
      `run_id=eq.${encodeURIComponent(run.run_id)}`,
      "order=rank.asc",
      `limit=${Math.max(1, Math.min(2000, cleanNumber(limit) || 2000))}`,
    ].join("&")
  );
  return { rows, run };
}

async function handler(request, response) {
  wrapJsonRunTimeSourceEvidence(response, {
    strategy: "strategy3",
    endpoint: "api/strategy3-latest",
    evidenceStatusOnQualityFail: "insufficient",
  });
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");

  if (request.method !== "GET") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  const options = parseRequestOptions(request);
  const liveProbe = await fetchStrategy3LiveHealthProbe().catch((error) => ({ issues: [`strategy3 live health probe failed: ${error?.message || String(error)}`] }));
  if (!options.noSnapshot) {
    const cached = await readEndpointFromDesktopSnapshot(request, {
      timeoutMs: DESKTOP_SNAPSHOT_READ_TIMEOUT_MS,
      via: "api/strategy3-latest",
    });
    if (cached) {
      setDesktopSnapshotCache(response);
      response.status(200).json(normalizeStrategy3ApiContract(cached, { liveProbe }));
      return;
    }
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      response.status(503).json(apiOnlyError("supabase_not_configured"));
      return;
    }
    if (!options.noSnapshot) {
      const snapshot = await readLatestSnapshot({ ...options, liveProbe });
      if (snapshot) {
        setDesktopSnapshotCache(response);
        response.status(200).json(normalizeStrategy3ApiContract(snapshot, { liveProbe }));
        return;
      }
    }
    const latest = await fetchLatestCompleteRows(options.limit);
    if (!latest.rows.length && !latest.run?.run_id) {
      response.status(404).json(apiOnlyError("strategy3_scan_results_latest_empty"));
      return;
    }
    setDesktopSnapshotCache(response);
    response.status(200).json(buildPayload(latest.rows, latest.run, { ...options, liveProbe }));
  } catch (error) {
    response.status(503).json(apiOnlyError(error?.message || String(error)));
  }
}

module.exports = handler;
module.exports.normalizeStrategy3ApiContract = normalizeStrategy3ApiContract;
