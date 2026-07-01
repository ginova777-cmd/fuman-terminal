"use strict";

const REQUIRED_RUN_TIME_SOURCE_SNAPSHOT_FIELDS = [
  "source_snapshot_captured_at",
  "source_status_at_run",
  "quote_coverage_at_run",
  "intraday_1m_readiness_at_run",
  "ma_readiness_at_run",
  "preopen_futopt_daily_readiness_at_run",
  "run_quality_at_publish",
];

const WRAPPED_RESPONSE = Symbol.for("fuman.runTimeSourceEvidenceWrapped");

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanNumber(value, fallback = null) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(String(value).replace(/[,+%]/g, "").trim());
  return Number.isFinite(number) ? number : fallback;
}

function boolValue(value, fallback = false) {
  if (value === true || value === false) return value;
  if (value === null || value === undefined || value === "") return fallback;
  return /^(1|true|yes|ok|ready|fresh|complete|allow|allowed)$/i.test(String(value).trim());
}

function firstNonBlank(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && !value.trim()) continue;
    return value;
  }
  return "";
}

function objectOrNull(value) {
  return isObject(value) ? value : null;
}

function normalizeStatus(value, fallback = "unknown") {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return fallback;
  if (["ok", "ready", "fresh", "complete", "allow", "allowed"].includes(text)) return "ready";
  if (["blocked", "failed", "error", "critical", "not_ready", "stale", "degraded", "partial"].includes(text)) return text;
  return text;
}

function normalizeResource(value, fallbackStatus = "not_applicable", reason = "") {
  if (isObject(value)) {
    const status = normalizeStatus(value.status || value.coverageStatus || value.coverage_status || value.sourceStatus || value.qualityStatus, "");
    return {
      status: status || (value.ok === true || value.ready === true ? "ready" : fallbackStatus),
      ok: value.ok === true || value.ready === true || status === "ready",
      reason: value.reason || value.message || reason || "",
      ...value,
    };
  }
  if (value === true || value === false) {
    return { status: value ? "ready" : "not_ready", ok: value, reason };
  }
  if (value || value === 0) {
    const status = normalizeStatus(value, fallbackStatus);
    return { status, ok: status === "ready", reason };
  }
  return { status: fallbackStatus, ok: fallbackStatus === "not_applicable", reason };
}

function snapshotCandidateRoots(payload) {
  const runPayload = objectOrNull(payload?.run?.payload);
  const roots = [
    payload,
    payload?.runTimeSourceSnapshot,
    payload?.run_time_source_snapshot,
    payload?.sourceSnapshotAtRun,
    payload?.source_snapshot_at_run,
    payload?.source_snapshot,
    payload?.runSourceSnapshot,
    payload?.publishGate?.runTimeSourceSnapshot,
    payload?.publishGate?.sourceSnapshot,
    payload?.run_quality_at_publish?.sourceSnapshot,
    payload?.runQualityAtPublish?.sourceSnapshot,
    runPayload,
    runPayload?.runTimeSourceSnapshot,
    runPayload?.run_time_source_snapshot,
    runPayload?.sourceSnapshotAtRun,
    runPayload?.source_snapshot_at_run,
    runPayload?.source_snapshot,
    runPayload?.runSourceSnapshot,
  ];
  return roots.filter(isObject);
}

function normalizeSnapshot(candidate) {
  if (!isObject(candidate)) return null;
  const quality = firstNonBlank(
    candidate.run_quality_at_publish,
    candidate.runQualityAtPublish,
    candidate.qualityAtPublish,
    candidate.publishQuality
  );
  return {
    source_snapshot_captured_at: firstNonBlank(
      candidate.source_snapshot_captured_at,
      candidate.sourceSnapshotCapturedAt,
      candidate.snapshotCapturedAt,
      candidate.capturedAt,
      candidate.checkedAt
    ),
    source_status_at_run: firstNonBlank(
      candidate.source_status_at_run,
      candidate.sourceStatusAtRun,
      candidate.sourceStatus,
      candidate.source_status
    ),
    quote_coverage_at_run: firstNonBlank(
      candidate.quote_coverage_at_run,
      candidate.quoteCoverageAtRun,
      candidate.quoteCoverage,
      candidate.sourceCoverage?.quoteCoverage,
      candidate.sourceCoverage
    ),
    intraday_1m_readiness_at_run: firstNonBlank(
      candidate.intraday_1m_readiness_at_run,
      candidate.intraday1mReadinessAtRun,
      candidate.intraday1mReadiness,
      candidate.intraday_1m_readiness,
      candidate.resourceReadiness?.intraday1m
    ),
    ma_readiness_at_run: firstNonBlank(
      candidate.ma_readiness_at_run,
      candidate.maReadinessAtRun,
      candidate.maReadiness,
      candidate.ma_readiness
    ),
    preopen_futopt_daily_readiness_at_run: firstNonBlank(
      candidate.preopen_futopt_daily_readiness_at_run,
      candidate.preopenFutoptDailyReadinessAtRun,
      candidate.preopenFutoptDailyReadiness,
      candidate.preopen_futopt_daily_readiness
    ),
    run_quality_at_publish: isObject(quality) ? quality : null,
  };
}

function hasValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function extractRunTimeSourceSnapshot(payload) {
  for (const root of snapshotCandidateRoots(payload)) {
    const snapshot = normalizeSnapshot(root);
    if (!snapshot) continue;
    if (REQUIRED_RUN_TIME_SOURCE_SNAPSHOT_FIELDS.some((field) => hasValue(snapshot[field]))) return snapshot;
  }
  return null;
}

function auditRunTimeSourceSnapshot(payload) {
  const snapshot = extractRunTimeSourceSnapshot(payload);
  const missingFields = REQUIRED_RUN_TIME_SOURCE_SNAPSHOT_FIELDS.filter((field) => !hasValue(snapshot?.[field]));
  return {
    ok: missingFields.length === 0,
    status: missingFields.length === 0 ? "complete" : "insufficient",
    missingFields,
    snapshot: snapshot || null,
  };
}

function fallbackDisclosure(payload = {}, quality = {}) {
  const fallbackUsed = boolValue(firstNonBlank(payload.fallbackUsed, payload.fallback_used, payload.fallback?.used, quality.fallbackUsed), false);
  const fallbackScope = Array.isArray(payload.fallbackScope) ? payload.fallbackScope
    : Array.isArray(payload.fallback_scope) ? payload.fallback_scope
      : Array.isArray(quality.fallbackScope) ? quality.fallbackScope
        : [];
  const fallbackDetails = Array.isArray(payload.fallbackDetails) ? payload.fallbackDetails
    : Array.isArray(payload.fallback_details) ? payload.fallback_details
      : Array.isArray(quality.fallbackDetails) ? quality.fallbackDetails
        : [];
  const fallbackAllowed = boolValue(firstNonBlank(payload.fallbackAllowed, payload.fallback_allowed, quality.fallbackAllowed), fallbackUsed === false);
  return { fallbackUsed, fallbackScope, fallbackAllowed, fallbackDetails };
}

function attachRunTimeSourceEvidence(payload, options = {}) {
  if (!isObject(payload)) return payload;
  const audit = auditRunTimeSourceSnapshot(payload);
  const existingQuality = isObject(audit.snapshot?.run_quality_at_publish)
    ? audit.snapshot.run_quality_at_publish
    : isObject(payload.run_quality_at_publish)
      ? payload.run_quality_at_publish
      : {};
  const fallback = fallbackDisclosure(payload, existingQuality);
  const insufficientQuality = {
    ...existingQuality,
    publishAllowed: false,
    degradedBlocksLatest: true,
    preservePreviousGood: true,
    fallbackUsed: fallback.fallbackUsed,
    fallbackScope: fallback.fallbackScope,
    fallbackAllowed: fallback.fallbackAllowed,
    fallbackDetails: fallback.fallbackDetails,
    reason: "run_time_source_snapshot_missing_or_incomplete",
  };
  const sourceEvidenceIssues = audit.ok
    ? []
    : [`run_time_source_snapshot_insufficient:${audit.missingFields.join(",")}`];
  const snapshot = audit.snapshot || {
    source_snapshot_captured_at: "",
    source_status_at_run: null,
    quote_coverage_at_run: null,
    intraday_1m_readiness_at_run: null,
    ma_readiness_at_run: null,
    preopen_futopt_daily_readiness_at_run: null,
    run_quality_at_publish: insufficientQuality,
  };
  const quality = audit.ok ? {
    ...existingQuality,
    fallbackUsed: fallback.fallbackUsed,
    fallbackScope: fallback.fallbackScope,
    fallbackAllowed: fallback.fallbackAllowed,
    fallbackDetails: fallback.fallbackDetails,
  } : insufficientQuality;
  const unattendedStatus = audit.ok
    && quality.publishAllowed !== false
    && !(quality.fallbackUsed === true && quality.fallbackAllowed !== true)
    ? "YES"
    : "NO";
  return {
    ...payload,
    runTimeSourceSnapshot: {
      ...snapshot,
      run_quality_at_publish: quality,
    },
    source_snapshot_captured_at: snapshot.source_snapshot_captured_at || "",
    source_status_at_run: snapshot.source_status_at_run || null,
    quote_coverage_at_run: snapshot.quote_coverage_at_run || null,
    intraday_1m_readiness_at_run: snapshot.intraday_1m_readiness_at_run || null,
    ma_readiness_at_run: snapshot.ma_readiness_at_run || null,
    preopen_futopt_daily_readiness_at_run: snapshot.preopen_futopt_daily_readiness_at_run || null,
    run_quality_at_publish: quality,
    evidenceStatus: audit.status,
    sourceEvidenceStatus: audit.status,
    sourceEvidenceRequiredFields: REQUIRED_RUN_TIME_SOURCE_SNAPSHOT_FIELDS,
    sourceEvidenceMissingFields: audit.missingFields,
    sourceEvidenceIssues,
    unattendedStatus,
    unattended: {
      ...(isObject(payload.unattended) ? payload.unattended : {}),
      status: unattendedStatus,
      evidenceStatus: audit.status,
      reason: audit.ok ? "run_time_source_snapshot_complete" : "run_time_source_snapshot_missing_or_incomplete",
    },
    publishAllowed: audit.ok ? payload.publishAllowed : false,
    degradedBlocksLatest: audit.ok ? payload.degradedBlocksLatest : true,
    preservePreviousGood: audit.ok ? payload.preservePreviousGood : true,
    mustPreserveLatest: audit.ok ? payload.mustPreserveLatest : true,
    issues: [
      ...(Array.isArray(payload.issues) ? payload.issues : []),
      ...sourceEvidenceIssues,
    ],
  };
}

function wrapJsonRunTimeSourceEvidence(response, options = {}) {
  if (!response || response[WRAPPED_RESPONSE] || typeof response.json !== "function") return response;
  const originalJson = response.json.bind(response);
  response.json = (payload) => originalJson(attachRunTimeSourceEvidence(payload, options));
  response[WRAPPED_RESPONSE] = true;
  return response;
}

function buildQuoteCoverage(payload = {}) {
  const coverage = objectOrNull(payload.sourceCoverage) || objectOrNull(payload.source_coverage) || {};
  const realtime = objectOrNull(payload.realtime) || {};
  return normalizeResource({
    status: coverage.status || coverage.quoteStatus || realtime.sourceStatus || payload.quoteStatus,
    ok: coverage.ok ?? coverage.ready ?? realtime.entrySourceHealthy,
    fresh_quote_coverage_120s: cleanNumber(coverage.fresh_quote_coverage_120s ?? coverage.freshQuoteCoverage120s ?? realtime.coverage),
    quote_age_seconds: cleanNumber(coverage.quote_age_seconds ?? coverage.quoteAgeSeconds ?? realtime.quoteAgeSeconds),
    expected: cleanNumber(coverage.expectedUniverse ?? coverage.active_symbols ?? payload.expectedTotal ?? payload.total),
    ready: cleanNumber(coverage.fresh_quotes_120s ?? coverage.readyQuotes),
    checkedAt: coverage.checkedAt || payload.updatedAt || payload.generatedAt || "",
  }, "not_applicable", "quote not required or not reported for this strategy");
}

function buildIntradayReadiness(payload = {}) {
  const coverage = objectOrNull(payload.sourceCoverage) || objectOrNull(payload.source_coverage) || {};
  const sourceHealth = objectOrNull(payload.sourceHealth) || {};
  return normalizeResource({
    status: coverage.intraday_1m_status || coverage.intraday1mStatus || sourceHealth.status,
    ok: coverage.intraday_1m_ok ?? coverage.intraday1mOk,
    today_1m_symbols: cleanNumber(coverage.today_1m_symbols ?? coverage.today1mSymbols),
    ready_ge_35: cleanNumber(coverage.ready_ge_35 ?? coverage.readyGe35 ?? sourceHealth.intraday1mReadyCount),
    latest_candle_time: coverage.latest_candle_time || coverage.latestCandleTime || sourceHealth.latestCandleTime || "",
    intraday_1m_stale_seconds: cleanNumber(coverage.intraday_1m_stale_seconds ?? coverage.intraday1mStaleSeconds),
    sessionWindow: sourceHealth.sessionWindow || payload.historyWindow?.start && payload.historyWindow?.end ? `${payload.historyWindow.start}-${payload.historyWindow.end}` : "",
  }, "not_applicable", "intraday 1m not required or not reported for this strategy");
}

function buildMaReadiness(payload = {}) {
  const coverage = objectOrNull(payload.sourceCoverage) || objectOrNull(payload.source_coverage) || {};
  const sourceHealth = objectOrNull(payload.sourceHealth) || {};
  return normalizeResource({
    status: coverage.ma_status || coverage.maStatus || coverage.intraday_1m_status || sourceHealth.status,
    ok: coverage.ready_ma35_continuous === true || coverage.readyGe35 > 0 || coverage.ready_ge_35 > 0 || sourceHealth.intraday1mReadyCount > 0,
    ready_ma20_continuous: cleanNumber(coverage.ready_ma20_continuous_symbols ?? coverage.ready_ma20_continuous),
    ready_ma35_continuous: cleanNumber(coverage.ready_ma35_continuous_symbols ?? coverage.ready_ma35_continuous ?? coverage.ready_ge_35),
    ready_macd_continuous: cleanNumber(coverage.ready_macd_continuous_symbols ?? coverage.ready_macd_continuous),
    minCandles: cleanNumber(sourceHealth.minIntraday1mCandles),
  }, "not_applicable", "MA readiness not required or not reported for this strategy");
}

function buildPreopenFutoptDailyReadiness(payload = {}) {
  const coverage = objectOrNull(payload.sourceCoverage) || objectOrNull(payload.source_coverage) || {};
  const readiness = objectOrNull(payload.resourceReadiness) || objectOrNull(payload.readiness) || {};
  return normalizeResource({
    status: readiness.status || coverage.preopenStatus || coverage.dailyVolumeStatus || coverage.status,
    ok: readiness.ready ?? coverage.preopenOk ?? coverage.dailyVolumeOk,
    preopen: readiness.preopenHot || readiness.preopen || {
      expected: cleanNumber(coverage.preopenExpected),
      ready: cleanNumber(coverage.preopenRows),
      coverage: cleanNumber(coverage.preopenCoverage),
    },
    futopt: readiness.futopt || {
      expected: cleanNumber(coverage.futoptExpected),
      ready: cleanNumber(coverage.futoptReady),
    },
    dailyVolume: readiness.dailyVolume || {
      ready: cleanNumber(coverage.dailyVolumeReady),
      freshness: coverage.dailyVolumeFreshness || "",
    },
  }, "not_applicable", "preopen/futopt/daily readiness not required or not reported for this strategy");
}

function buildRunQualityAtPublish({
  payload = {},
  runId = "",
  expectedTotal = null,
  scannedCount = null,
  resultCount = null,
  readbackCount = null,
  publishAllowed = null,
  degradedBlocksLatest = null,
  preservePreviousGood = null,
  writeBudget = null,
  retentionOk = null,
  qualityStatus = "",
  fallbackUsed = null,
  fallbackScope = null,
  fallbackAllowed = null,
  fallbackDetails = null,
} = {}) {
  const fallback = fallbackDisclosure({
    ...payload,
    ...(fallbackUsed !== null ? { fallbackUsed } : {}),
    ...(Array.isArray(fallbackScope) ? { fallbackScope } : {}),
    ...(Array.isArray(fallbackDetails) ? { fallbackDetails } : {}),
    ...(fallbackAllowed !== null ? { fallbackAllowed } : {}),
  });
  const sourceCoverage = objectOrNull(payload.sourceCoverage) || {};
  const status = normalizeStatus(qualityStatus || payload.qualityStatus || payload.status || sourceCoverage.status, "ready");
  const allowed = publishAllowed === null
    ? status === "ready" || status === "complete" || status === "ok"
    : Boolean(publishAllowed);
  return {
    runId: runId || payload.runId || payload.transport?.runId || "",
    status,
    publishAllowed: allowed,
    degradedBlocksLatest: degradedBlocksLatest === null ? !allowed : Boolean(degradedBlocksLatest),
    preservePreviousGood: preservePreviousGood === null ? !allowed : Boolean(preservePreviousGood),
    fallbackUsed: fallback.fallbackUsed,
    fallbackScope: fallback.fallbackScope,
    fallbackAllowed: fallback.fallbackAllowed,
    fallbackDetails: fallback.fallbackDetails,
    expectedTotal: cleanNumber(expectedTotal ?? payload.expectedTotal ?? payload.total),
    scannedCount: cleanNumber(scannedCount ?? payload.scannedCount ?? payload.scanned),
    resultCount: cleanNumber(resultCount ?? payload.resultCount ?? payload.count),
    readbackCount: cleanNumber(readbackCount ?? payload.resultReadbackCount ?? payload.readbackCount),
    writeBudget: writeBudget || payload.writeBudget || null,
    retentionOk: retentionOk ?? payload.retentionOk ?? null,
    qualityStatus: qualityStatus || payload.qualityStatus || "",
  };
}

function buildRunTimeSourceSnapshotFields(options = {}) {
  const payload = isObject(options.payload) ? options.payload : {};
  const capturedAt = options.capturedAt || new Date().toISOString();
  const sourceStatus = normalizeResource(
    firstNonBlank(options.sourceStatus, payload.sourceStatus, payload.source_status, payload.sourceHealth),
    "not_applicable",
    "source status not required or not reported for this strategy"
  );
  const quoteCoverage = normalizeResource(options.quoteCoverage || buildQuoteCoverage(payload));
  const intradayReadiness = normalizeResource(options.intraday1mReadiness || buildIntradayReadiness(payload));
  const maReadiness = normalizeResource(options.maReadiness || buildMaReadiness(payload));
  const preopenFutoptDaily = normalizeResource(options.preopenFutoptDailyReadiness || buildPreopenFutoptDailyReadiness(payload));
  const runQuality = buildRunQualityAtPublish({ ...options, payload });
  const snapshot = {
    contract: "run-time-source-snapshot-v1",
    strategy: options.strategy || payload.strategy || "",
    runId: options.runId || payload.runId || payload.transport?.runId || "",
    run_started_at: options.startedAt || payload.startedAt || "",
    run_finished_at: options.finishedAt || payload.finishedAt || payload.updatedAt || payload.generatedAt || "",
    source_snapshot_captured_at: capturedAt,
    source_status_at_run: sourceStatus,
    quote_coverage_at_run: quoteCoverage,
    intraday_1m_readiness_at_run: intradayReadiness,
    ma_readiness_at_run: maReadiness,
    preopen_futopt_daily_readiness_at_run: preopenFutoptDaily,
    run_quality_at_publish: runQuality,
  };
  return {
    runTimeSourceSnapshot: snapshot,
    run_time_source_snapshot: snapshot,
    source_snapshot_captured_at: snapshot.source_snapshot_captured_at,
    source_status_at_run: snapshot.source_status_at_run,
    quote_coverage_at_run: snapshot.quote_coverage_at_run,
    intraday_1m_readiness_at_run: snapshot.intraday_1m_readiness_at_run,
    ma_readiness_at_run: snapshot.ma_readiness_at_run,
    preopen_futopt_daily_readiness_at_run: snapshot.preopen_futopt_daily_readiness_at_run,
    run_quality_at_publish: snapshot.run_quality_at_publish,
  };
}

module.exports = {
  REQUIRED_RUN_TIME_SOURCE_SNAPSHOT_FIELDS,
  attachRunTimeSourceEvidence,
  auditRunTimeSourceSnapshot,
  buildRunTimeSourceSnapshotFields,
  extractRunTimeSourceSnapshot,
  wrapJsonRunTimeSourceEvidence,
};
