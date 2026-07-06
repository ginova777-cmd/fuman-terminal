const {
  auditRunTimeSourceSnapshot,
  auditRunTimeSourceSnapshotQuality,
} = require("../lib/run-time-source-snapshot-contract");

const REQUIRED_PREWATER_PAYLOAD_FIELDS = [
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

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function verifyStrategy3PrewaterPayload(payload = {}, options = {}) {
  const issues = [];
  const expectBlocked = options.expectBlocked === true;
  const requireSnapshot = options.requireSnapshot !== false;
  const requireTopLevelContract = options.requireTopLevelContract !== false;
  const label = options.label || "payload";
  const quality = payload.run_quality_at_publish || {};
  const sourceStatus = payload.source_status_at_run || {};
  const sourceReady = sourceStatus.ok === true
    && /ready|ok|complete/i.test(String(sourceStatus.status || "ready"))
    && !/degraded|timeout|stale|fail|critical/i.test(String(sourceStatus.status || ""));
  const publishAllowed = quality.publishAllowed === true
    || payload.publishAllowed === true
    || payload.latestOverwriteAllowed === true;
  const fallbackUsed = payload.fallbackUsed === true || quality.fallbackUsed === true;
  const fallbackScope = asArray(payload.fallbackScope).length ? asArray(payload.fallbackScope) : asArray(quality.fallbackScope);
  const fallbackDetails = asArray(payload.fallbackDetails).length ? asArray(payload.fallbackDetails) : asArray(quality.fallbackDetails);
  const fallbackAllowed = payload.fallbackAllowed ?? quality.fallbackAllowed;
  const fallbackContract = payload.fallbackContract || quality.fallbackContract;
  const count = Number(payload.count ?? quality.resultCount ?? 0);
  const scanCoverage = payload.scanCoverage && typeof payload.scanCoverage === "object" ? payload.scanCoverage : {};
  const explicitEmptyComplete = count === 0
    && sourceReady
    && scanCoverage.completeScan === true
    && Number(scanCoverage.scannedCount || quality.scannedCount || 0) > 0
    && Number(scanCoverage.scannedCount || quality.scannedCount || 0) === Number(payload.total || quality.expectedTotal || 0)
    && Number(quality.resultCount ?? count) === 0
    && Number(quality.readbackCount ?? payload.readbackCount ?? 0) === 0
    && String(payload.noMatchReason || "").trim() !== "";

  if (requireTopLevelContract) {
    for (const field of REQUIRED_PREWATER_PAYLOAD_FIELDS) {
      if (!hasOwn(payload, field)) issues.push(`missing_${field}`);
    }
  }

  if (requireSnapshot) {
    const audit = expectBlocked
      ? auditRunTimeSourceSnapshot(payload)
      : auditRunTimeSourceSnapshotQuality(payload);
    if (!audit.ok) {
      if (expectBlocked && Array.isArray(audit.missingFields)) {
        issues.push(...audit.missingFields.map((field) => `snapshot:missing_${field}`));
      } else {
        issues.push(...audit.issues.map((issue) => `snapshot:${issue}`));
      }
    }
    if (!payload.source_snapshot_captured_at) issues.push("missing_source_snapshot_captured_at");
    if (!payload.source_status_at_run) issues.push("missing_source_status_at_run");
    if (!payload.quote_coverage_at_run) issues.push("missing_quote_coverage_at_run");
    if (!payload.intraday_1m_readiness_at_run) issues.push("missing_intraday_1m_readiness_at_run");
    if (!payload.ma_readiness_at_run) issues.push("missing_ma_readiness_at_run");
    if (!payload.preopen_futopt_daily_readiness_at_run) issues.push("missing_preopen_futopt_daily_readiness_at_run");
    if (!payload.run_quality_at_publish) issues.push("missing_run_quality_at_publish");
  }

  if (!payload.evidenceStatus) issues.push("missing_evidenceStatus");
  if (!payload.unattendedStatus) issues.push("missing_unattendedStatus");
  if (!payload.writeBudget && !quality.writeBudget) issues.push("missing_writeBudget");
  if (!Object.prototype.hasOwnProperty.call(payload, "retentionOk") && !Object.prototype.hasOwnProperty.call(quality, "retentionOk")) issues.push("missing_retentionOk");
  if (!Object.prototype.hasOwnProperty.call(payload, "degradedBlocksLatest") && !Object.prototype.hasOwnProperty.call(quality, "degradedBlocksLatest")) issues.push("missing_degradedBlocksLatest");
  if (!Object.prototype.hasOwnProperty.call(payload, "preservePreviousGood") && !Object.prototype.hasOwnProperty.call(quality, "preservePreviousGood")) issues.push("missing_preservePreviousGood");

  if (fallbackUsed) {
    if (!fallbackScope.length) issues.push("fallback_without_scope");
    if (!fallbackDetails.length) issues.push("fallback_without_details");
    if (!fallbackContract) issues.push("fallback_without_contract");
    if (fallbackAllowed !== true) issues.push("fallback_used_but_not_allowed");
    if (fallbackScope.includes("source")) issues.push("formal_source_fallback_not_allowed");
  }
  if (payload.hiddenFallback === true && !fallbackUsed) issues.push("hidden_fallback_not_disclosed");
  if (!sourceReady && publishAllowed) issues.push("source_not_ready_but_latest_allowed");
  if (count === 0 && publishAllowed && payload.preservePreviousGood !== true && quality.preservePreviousGood !== true && !explicitEmptyComplete) {
    issues.push("empty_result_overwrites_previous_good");
  }
  if (expectBlocked) {
    if (publishAllowed) issues.push("blocked_payload_allows_latest");
    if (payload.degradedBlocksLatest !== true && quality.degradedBlocksLatest !== true) issues.push("blocked_payload_missing_degradedBlocksLatest");
    if (payload.preservePreviousGood !== true && quality.preservePreviousGood !== true) issues.push("blocked_payload_does_not_preserve_previous_good");
    if (payload.unattendedStatus === "YES") issues.push("blocked_payload_fake_yes");
    if (!payload.blockedReason && !payload.scanner_block_reason && !quality.blockedReason && !quality.scanner_block_reason) {
      issues.push("blocked_payload_missing_reason");
    }
  }
  return {
    ok: issues.length === 0,
    label,
    expectBlocked,
    latestBlocked: !publishAllowed,
    preservePreviousGood: payload.preservePreviousGood === true || quality.preservePreviousGood === true,
    evidenceStatus: payload.evidenceStatus || "",
    unattendedStatus: payload.unattendedStatus || "",
    issues,
  };
}

function clonePayload(value) {
  return JSON.parse(JSON.stringify(value));
}

function mutateStrategy3PrewaterPayload(payload, name) {
  const next = clonePayload(payload);
  if (name === "delete-source-snapshot") delete next.source_snapshot_captured_at;
  if (name === "missing-evidenceStatus") {
    delete next.evidenceStatus;
    if (next.run_quality_at_publish) delete next.run_quality_at_publish.evidenceStatus;
  }
  if (name === "fake-yes") {
    next.source_status_at_run = { ok: false, status: "failed" };
    next.evidenceStatus = "complete";
    next.unattendedStatus = "YES";
    next.publishAllowed = true;
    if (next.run_quality_at_publish) next.run_quality_at_publish.publishAllowed = true;
  }
  if (name === "blocked-latest-allowed") {
    next.source_status_at_run = { ok: false, status: "failed" };
    next.latestOverwriteAllowed = true;
    next.publishAllowed = true;
    if (next.run_quality_at_publish) next.run_quality_at_publish.publishAllowed = true;
  }
  if (name === "preserve-false") {
    next.source_status_at_run = { ok: false, status: "failed" };
    next.preservePreviousGood = false;
    if (next.run_quality_at_publish) next.run_quality_at_publish.preservePreviousGood = false;
  }
  if (name === "fallback-hidden") {
    next.hiddenFallback = true;
    next.fallbackUsed = false;
    next.fallbackScope = [];
    next.fallbackDetails = [];
    if (next.run_quality_at_publish) {
      next.run_quality_at_publish.fallbackUsed = false;
      next.run_quality_at_publish.fallbackScope = [];
      next.run_quality_at_publish.fallbackDetails = [];
    }
  }
  if (name === "empty-result") {
    next.count = 0;
    next.publishAllowed = true;
    next.preservePreviousGood = false;
    if (next.run_quality_at_publish) {
      next.run_quality_at_publish.resultCount = 0;
      next.run_quality_at_publish.publishAllowed = true;
      next.run_quality_at_publish.preservePreviousGood = false;
    }
  }
  if (name === "display-only-fallback") {
    next.fallbackUsed = true;
    next.fallbackScope = ["display"];
    next.fallbackAllowed = false;
    next.fallbackDetails = [{ scope: "display", allowed: false, formalSource: false }];
    next.fallbackContract = { display: { allowed: false, formalSource: false } };
  }
  return next;
}

module.exports = {
  REQUIRED_PREWATER_PAYLOAD_FIELDS,
  mutateStrategy3PrewaterPayload,
  verifyStrategy3PrewaterPayload,
};
