const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { buildMarketCalendarContract } = require("../lib/market-calendar-contract");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.resolve(process.argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length) || "outputs/terminal-orchestrator");
const EXPECTED_DATE_ARG = process.argv.find((arg) => arg.startsWith("--expected-date="))?.slice("--expected-date=".length) || "";
const EXPECTED_DATE_EXPLICIT = Boolean(EXPECTED_DATE_ARG);
let EXPECTED_DATE = EXPECTED_DATE_ARG.replace(/\D/g, "").slice(0, 8);
let EFFECTIVE_VALIDATION_DATE = "";
const FROM_EXISTING = process.argv.includes("--from-existing");
const SELF_TEST = process.argv.includes("--self-test");
const LIFECYCLE_STATES = ["PENDING", "PENDING_NOT_DUE", "PUBLISH_DEFERRED_MANIFEST_PENDING", "WATER_OK", "RUNNING", "SCANNED", "PUBLISHED", "DISPLAY_VERIFIED", "CLOSED"];
const FAILURE_STATES = ["BLOCKED_SOURCE", "BLOCKED_AUTH", "FAILED_SCAN", "FAILED_PUBLISH", "FAILED_DISPLAY", "DEGRADED_PREVIOUS_GOOD", "BLOCKED_RUNID_MISMATCH", "BLOCKED_DATE_MISMATCH"];
const STATE_MACHINE_CONTRACT = {
  contract: "terminal-state-machine-v1",
  lifecycle: LIFECYCLE_STATES,
  failureStates: FAILURE_STATES,
  terminalStates: ["CLOSED", "PENDING_NOT_DUE", "PUBLISH_DEFERRED_MANIFEST_PENDING", "DEGRADED_PREVIOUS_GOOD", "BLOCKED_SOURCE", "BLOCKED_AUTH", "BLOCKED_RUNID_MISMATCH", "BLOCKED_DATE_MISMATCH", "FAILED_SCAN", "FAILED_PUBLISH", "FAILED_DISPLAY"],
  invariants: [
    "water_root_must_pass_before_scanner_publish",
    "scanner_receipt_runid_must_equal_supabase_latest_pointer",
    "production_api_desktop_mobile_88_must_share_runid",
    "fallback_or_previous_good_cannot_publish_today_success",
    "every_non_closed_non_pending_module_must_have_a_queue_job",
    "closed_requires_date_evidence_publish_and_issue_free_row",
    "auth_blocker_requires_manual_service_token_repair",
    "market_closed_skips_formal_scan_and_preserves_previous_good",
    "market_calendar_target_date_is_authoritative_over_previous_manifest",
  ],
};

function taipeiDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date).replace(/\D/g, "");
}

function dateFromExpectedDateForCalendar(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 8);
  if (digits.length !== 8) return null;
  return new Date(`${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}T10:00:00+08:00`);
}
function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function manifestPathForExpectedDate(expectedDate = "") {
  const dateKey = String(expectedDate || "").replace(/\D/g, "").slice(0, 8);
  const datedPath = dateKey
    ? path.join(ROOT, "outputs", "daily-terminal-run", `daily-terminal-run-${dateKey}.json`)
    : "";
  if (dateKey && fs.existsSync(datedPath)) return datedPath;
  return path.join(ROOT, "outputs", "daily-terminal-run", "daily-terminal-run-latest.json");
}

function runNode(args, label) {
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env },
  });
  return {
    label,
    command: `node ${args.join(" ")}`,
    exitCode: result.status ?? 1,
    ok: result.status === 0,
    stdout: String(result.stdout || "").slice(-3000),
    stderr: String(result.stderr || "").slice(-3000),
  };
}

function issueText(row = {}) {
  return Array.isArray(row.issues) ? row.issues.join(" | ").toLowerCase() : "";
}

function has(text, ...needles) {
  return needles.some((needle) => text.includes(needle));
}

function normalizedDate(value) {
  const date = String(value || "").replace(/\D/g, "").slice(0, 8);
  return /^\d{8}$/.test(date) ? date : "";
}

function firstNormalizedDate(...values) {
  for (const value of values) {
    const date = normalizedDate(value);
    if (date) return date;
  }
  return "";
}

function displayTradeDateFrom(marketCalendar = null, manifest = {}, fallback = "") {
  return firstNormalizedDate(
    marketCalendar?.displayTradeDate,
    marketCalendar?.lastCompleteTradeDate,
    marketCalendar?.lastTradingDate,
    marketCalendar?.lastOpenTradeDate,
    manifest.displayTradeDate,
    manifest.lastCompleteTradeDate,
    fallback
  );
}

function manifestDisplayHoldMode(manifest = {}, marketCalendar = null, expectedDate = "", displayTradeDate = "") {
  const expected = normalizedDate(expectedDate);
  const display = normalizedDate(displayTradeDate);
  if (!expected || !display || expected === display) return false;
  const text = [
    manifest.blocker,
    manifest.reason,
    manifest.status,
    manifest.unattendedStatus,
    manifest.waterRoot?.reason,
    manifest.waterRoot?.status,
    manifest.waterRoot?.sourceStatus?.status,
    manifest.waterRoot?.sourceStatus?.message,
    marketCalendar?.marketStatus,
    marketCalendar?.skipReason,
    marketCalendar?.reason,
    marketCalendar?.phase,
  ].filter(Boolean).join(" | ").toLowerCase();
  const modules = Array.isArray(manifest.modules) ? manifest.modules : [];
  const hasPendingNotDue = modules.some((row) => row.pendingNotDue === true
    || (Array.isArray(row.issues) && row.issues.some((issue) => /^pending_not_due(?::|$)/i.test(String(issue).trim()))));
  return Boolean(
    manifest.previousGoodHold === true
    || manifest.waterRoot?.previousGoodHold === true
    || marketCalendar?.marketOpen === false
    || marketCalendar?.tradingDayOpen === false
    || hasPendingNotDue
    || /previous_good|wait_source_window|before_formal_source_window|market_closed|holiday|not_due|pending_not_due|off-session|after_daytrade_window/.test(text)
  );
}
function closureBlockerText(row = {}) {
  const issues = Array.isArray(row.issues) ? row.issues : [];
  return [...issues, row.blocker, row.reason, row.sourceStatus?.reason, row.scorecard88Protection?.reason]
    .filter(Boolean).join(" | ").toLowerCase();
}

function hasClosureBlocker(row = {}) {
  const text = closureBlockerText(row);
  return has(text, "fallback", "previous_good", "preserve", "mismatch", "not_complete", "not complete", "insufficient", "degraded", "blocked", "unauthorized", "401", "stale", "not_ready", "not ready", "publish_not_allowed", "publish not allowed", "missing", "scorecard", "source_report", "latest pointer", "runid", "trade_date", "source_date");
}

function isModuleGreen(row = {}) {
  if (row.ok !== true || row.complete !== true || row.fallback === true || row.rawFallback === true) return false;
  if (row.evidenceStatus && row.evidenceStatus !== "complete") return false;
  if (row.publishAllowed === false) return false;
  const expected = normalizedDate(EFFECTIVE_VALIDATION_DATE || EXPECTED_DATE);
  if (expected && normalizedDate(row.tradeDate) !== expected) return false;
  if (expected && normalizedDate(row.sourceDate) !== expected) return false;
  return !hasClosureBlocker(row);
}

function runIdMismatch(row = {}) {
  const runIds = row.runIds || {};
  const entries = Object.entries(runIds)
    .filter(([, value]) => typeof value === 'string' && value.trim())
    .map(([surface, value]) => [surface, value.trim()]);
  const distinct = new Set(entries.map(([, value]) => value));
  if (entries.length < 2 || distinct.size < 2) return null;
  return { entries, values: [...distinct] };
}

function isMarketClosedPreviousGood(manifest = {}, marketCalendar = null) {
  const reason = String(manifest.waterRoot?.reason || manifest.blocker || "").toLowerCase();
  const sourceStatus = String(manifest.waterRoot?.sourceStatus?.status || "").toLowerCase();
  const message = String(manifest.waterRoot?.sourceStatus?.message || "").toLowerCase();
  const status = String(manifest.waterRoot?.status || manifest.unattendedStatus || "").toLowerCase();
  const marketStatus = String(marketCalendar?.marketStatus || marketCalendar?.skipReason || "").toLowerCase();
  const calendarClosed = marketCalendar?.marketOpen === false
    || marketCalendar?.tradingDayOpen === false
    || marketStatus.includes("market_closed")
    || marketStatus.includes("closed");
  const previousGoodText = manifest.previousGoodHold === true
    || manifest.waterRoot?.previousGoodHold === true
    || status.includes("previous_good")
    || status.includes("wait_source_window")
    || reason.includes("previous_good")
    || reason.includes("wait_source_window");
  const offSessionStopped = sourceStatus === "stopped" || reason.includes("stopped") || message.includes("off-session");
  return Boolean(calendarClosed && (previousGoodText || offSessionStopped));
}

function taipeiMinuteOfDayAt(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value || 0);
  return hour * 60 + minute;
}

function pendingNotDueIsFuture(row = {}) {
  const expected = normalizedDate(EXPECTED_DATE);
  const today = taipeiDateKey(new Date());
  if (expected && today && expected < today) return false;
  const text = [...(Array.isArray(row.issues) ? row.issues : []), row.blocker, row.reason].filter(Boolean).join(' | ');
  const match = text.match(/pending_not_due[^0-9]*(\d{1,2}):(\d{2})/i);
  if (!match) return row.pendingNotDue === true;
  const dueMinute = Number(match[1]) * 60 + Number(match[2]);
  const now = row.__classificationNow instanceof Date ? row.__classificationNow : new Date();
  return taipeiMinuteOfDayAt(now) < dueMinute;
}
function firstBlockingIssue(row = {}, pattern = null, fallback = "") {
  const issues = Array.isArray(row.issues) ? row.issues.map(String) : [];
  const nonPending = issues.filter((issue) => !/^pending_not_due(?::|$)/i.test(issue.trim()));
  if (pattern) return nonPending.find((issue) => pattern.test(issue)) || nonPending[0] || fallback || issues[0] || "";
  return nonPending[0] || fallback || issues[0] || "";
}
function dateMismatchBlocker(row = {}, options = {}) {
  const expected = normalizedDate(EFFECTIVE_VALIDATION_DATE || EXPECTED_DATE);
  if (!expected) return "";
  const blockers = [];
  const rowTradeDate = normalizedDate(row.tradeDate);
  const rowSourceDate = normalizedDate(row.sourceDate);
  const rawDateMismatchAllowed = options.pendingDueIsFuture !== true;
  if (rawDateMismatchAllowed && rowTradeDate && rowTradeDate !== expected) blockers.push(`tradeDate ${rowTradeDate} != ${expected}`);
  if (rawDateMismatchAllowed && rowSourceDate && rowSourceDate !== expected) blockers.push(`sourceDate ${rowSourceDate} != ${expected}`);
  const issues = Array.isArray(row.issues) ? row.issues.map(String) : [];
  for (const issue of issues) {
    if (/scanner receipt date \d{8} != expected \d{8}/i.test(issue)
      || /Supabase latest date \d{8} != expected \d{8}/i.test(issue)
      || /manifest_tradeDate_mismatch/i.test(issue)
      || /manifest_sourceDate_mismatch/i.test(issue)) {
      blockers.push(issue);
    }
  }
  return blockers.length ? `scanner_date_mismatch:${blockers.join('; ')}` : "";
}
function repairTradeDateFromText(text = "") {
  const value = String(text || "");
  const expectedMatch = value.match(/\bexpected\s+(\d{8})\b/i);
  if (expectedMatch) return normalizedDate(expectedMatch[1]);
  const mismatchMatch = value.match(/(?:tradeDate|sourceDate|manifest_tradeDate_mismatch|manifest_sourceDate_mismatch)[^0-9]*(\d{8})\s*!=\s*(\d{8})/i);
  if (mismatchMatch) return normalizedDate(mismatchMatch[2]);
  return "";
}

function runIdDate(value = "") {
  const match = String(value || "").match(/\b(20\d{6})\b/);
  return match ? normalizedDate(match[1]) : "";
}

function repairTradeDateFromRunIds(row = {}) {
  const runIds = row.runIds || {};
  const preferred = ["supabase", "productionApi", "scanner", "desktop", "mobile"];
  for (const key of preferred) {
    const date = runIdDate(runIds[key]);
    if (date) return date;
  }
  return runIdDate(row.runId);
}
function repairTradeDateForRow(row = {}, classification = {}) {
  return firstNormalizedDate(
    classification.repairTradeDate,
    repairTradeDateFromText(classification.blocker),
    repairTradeDateFromText([...(Array.isArray(row.issues) ? row.issues : []), row.blocker, row.reason].filter(Boolean).join(" | ")),
    repairTradeDateFromRunIds(row),
    EFFECTIVE_VALIDATION_DATE,
    EXPECTED_DATE
  );
}

function classifyModule(row = {}, manifest = {}, marketCalendar = null) {
  const text = issueText(row);
  const sourceFreshnessRequired = marketCalendar?.sourceFreshnessRequired !== false;
  const waterBlocked = sourceFreshnessRequired && manifest.waterRoot?.ok === false && !isMarketClosedPreviousGood(manifest, marketCalendar);
  const runIds = row.runIds || {};
  const layer = [];
  let state = "PENDING";
  let blocker = "";
  const marketClosedHold = isMarketClosedPreviousGood(manifest, marketCalendar);

  if (marketClosedHold) {
    return {
      state: "CLOSED",
      layer: ["closed", "market_calendar", "previous_good_hold"],
      blocker: "",
      nextAction: "none",
      retryable: false,
      priority: 90,
    };
  }

  const pendingDueIsFuture = pendingNotDueIsFuture(row);
  const dateBlocker = dateMismatchBlocker(row, { pendingDueIsFuture });
  if (dateBlocker) {
    return {
      state: "FAILED_SCAN",
      layer: ["scanner", "date_gate"],
      blocker: dateBlocker,
      nextAction: nextActionForState("FAILED_SCAN", row),
      retryable: true,
      priority: priorityForState("FAILED_SCAN"),
      repairTradeDate: repairTradeDateFromText(dateBlocker) || normalizedDate(EFFECTIVE_VALIDATION_DATE || EXPECTED_DATE),
    };
  }

  const pendingOnly = pendingDueIsFuture && (row.issues || []).every((issue) => /^pending_not_due(?::|$)/i.test(String(issue).trim()));
  const nonPendingIssues = (row.issues || []).filter((issue) => !/^pending_not_due(?::|$)/i.test(String(issue).trim()));
  const pendingHasNoOtherBlocker = has(text, "pending_not_due") && !hasClosureBlocker({ ...row, issues: nonPendingIssues });
  if (pendingDueIsFuture && (pendingOnly || pendingHasNoOtherBlocker)) {
    return {
      state: "PENDING_NOT_DUE",
      layer: ["schedule"],
      blocker: row.issues?.[0] || "pending_not_due",
      nextAction: "wait_until_strategy_due_time",
      retryable: true,
      priority: 85,
    };
  }


  const structuralRunIdMismatch = runIdMismatch(row);
  if (structuralRunIdMismatch) {
    const details = structuralRunIdMismatch.entries
      .map(([surface, value]) => surface + '=' + value)
      .join(',');
    return {
      state: 'BLOCKED_RUNID_MISMATCH',
      layer: ['display', 'runid_closure'],
      blocker: 'runid_mismatch:' + details,
      nextAction: nextActionForState('BLOCKED_RUNID_MISMATCH', row),
      retryable: true,
      priority: priorityForState('BLOCKED_RUNID_MISMATCH'),
    };
  }

  if (isModuleGreen(row)) {
    return {
      state: "CLOSED",
      layer: ["closed"],
      blocker: "",
      nextAction: "none",
      retryable: false,
      priority: 90,
    };
  }

  if (has(text, "authenticated readback", "membership", "token not armed")) {
    state = "FAILED_DISPLAY";
    layer.push("display", "auth_readback");
    blocker = "protected_surface_needs_authenticated_readback_token";
  } else if (has(text, "401", "unauthorized")) {
    state = "BLOCKED_AUTH";
    layer.push("auth");
    blocker = "backend_service_token_missing_or_invalid";
  } else if (has(text, "scanner receipt", "scanner_not_complete", "failed exit", "tradedate_mismatch", "sourcedate_mismatch", "date mismatch")) {
    state = "FAILED_SCAN";
    layer.push("scanner");
    blocker = firstBlockingIssue(row, /tradedate_mismatch|sourcedate_mismatch|date mismatch|scanner/i, "scanner_not_complete");
  } else if (has(text, "raw_fallback", "evidence_not_complete", "publish_not_allowed", "preserve_previous_good")) {
    state = "FAILED_SCAN";
    layer.push("scanner", "evidence", "publish");
    blocker = firstBlockingIssue(row, /raw_fallback|evidence_not_complete|publish_not_allowed|preserve_previous_good/i, "scanner_evidence_not_publishable");
  } else if (has(text, "manifest_runid_mismatch", "runid_mismatch", "runid mismatch", "row/sourcereport runid != latest pointer")) {
    state = "BLOCKED_RUNID_MISMATCH";
    layer.push("display", "runid_closure");
    blocker = firstBlockingIssue(row, /manifest_runid_mismatch|runid_mismatch|runid mismatch|row\/sourceReport runId != latest pointer/i, "runid_closure_mismatch");
  } else if (has(text, "scorecard", "publish")) {
    state = "FAILED_PUBLISH";
    layer.push("publish", "scorecard88");
    blocker = firstBlockingIssue(row, null, "scorecard_publish_not_closed");
  } else if (waterBlocked || has(text, "source", "water", "not_ready", "stale", "coverage")) {
    state = "BLOCKED_SOURCE";
    layer.push("source");
    blocker = manifest.waterRoot?.reason || firstBlockingIssue(row, null, "source_not_ready");
  } else if (row.fallback === true || has(text, "fallback", "previous", "old", "mismatch")) {
    state = "DEGRADED_PREVIOUS_GOOD";
    layer.push("display", "previous_good");
    blocker = firstBlockingIssue(row, null, "previous_good_or_fallback");
  } else {
    state = "FAILED_DISPLAY";
    layer.push("display");
    blocker = firstBlockingIssue(row, null, "terminal_display_not_closed");
  }
  const missingRunId = !row.runId || !runIds.scanner || !runIds.productionApi || !runIds.desktop || !runIds.mobile || !runIds.scorecard88;
  if (missingRunId && !layer.includes("display")) layer.push("display");

  return {
    state,
    layer: [...new Set(layer)],
    blocker,
    nextAction: nextActionForState(state, row),
    retryable: state !== "BLOCKED_AUTH" || has(text, "authenticated readback"),
    priority: priorityForState(state),
  };
}

function priorityForState(state) {
  return {
    BLOCKED_AUTH: 10,
    BLOCKED_SOURCE: 20,
    FAILED_SCAN: 30,
    BLOCKED_RUNID_MISMATCH: 35,
    BLOCKED_DATE_MISMATCH: 36,
    FAILED_PUBLISH: 40,
    PUBLISH_DEFERRED_MANIFEST_PENDING: 84,
    DEGRADED_PREVIOUS_GOOD: 50,
    FAILED_DISPLAY: 60,
    PENDING_NOT_DUE: 85,
    PENDING: 70,
    CLOSED: 90,
  }[state] || 80;
}

function nextActionForState(state, row = {}) {
  if (state === "BLOCKED_AUTH") return "fix_service_token_or_authenticated_readback_then_rerun_module";
  if (state === "BLOCKED_SOURCE") return "wait_or_fix_water_root_then_rerun_only_affected_module";
  if (state === "FAILED_SCAN") return "rerun_strategy_scanner_after_water_ok";
  if (state === "FAILED_PUBLISH") return "rerun_scorecard_source_sync_and_manifest_publish_gate";
  if (state === "BLOCKED_RUNID_MISMATCH") return "refresh_terminal_snapshot_bundle_mobile_88_readback";
  if (state === "BLOCKED_DATE_MISMATCH") return "rerun_strategy_scanner_after_date_gate_fix";
  if (state === "PUBLISH_DEFERRED_MANIFEST_PENDING") return "wait_for_manifest_full_green_then_scorecard_publish";
  if (state === "DEGRADED_PREVIOUS_GOOD") return "rebuild_today_snapshot_and_verify_no_old_runid";
  if (state === "FAILED_DISPLAY") return "refresh_terminal_snapshot_bundle_mobile_88_readback";
  return "none";
}

function lifecycleStageForRow(row = {}, classification = {}, manifest = {}, marketCalendar = null) {
  if (classification.state === "CLOSED") return "CLOSED";
  if (classification.state === "PENDING_NOT_DUE" || classification.state === "PUBLISH_DEFERRED_MANIFEST_PENDING") return classification.state;
  if (classification.state) return classification.state;
  const runIds = row.runIds || {};
  const waterClosed = isMarketClosedPreviousGood(manifest, marketCalendar);
  if (row.ok === true && row.complete === true && row.fallback !== true) return "CLOSED";
  if (runIds.desktop || runIds.mobile || runIds.scorecard88) return "DISPLAY_VERIFIED";
  if (runIds.productionApi || runIds.supabase || row.publishAllowed === true) return "PUBLISHED";
  if (runIds.scanner || row.runId) return "SCANNED";
  if (manifest.waterRoot?.ok === true || waterClosed) return "WATER_OK";
  return "PENDING";
}

function retryPolicyForState(state) {
  const policies = {
    BLOCKED_AUTH: { maxAttempts: 0, backoffSeconds: 0, fuseAfterAttempts: 0, autoRetry: false, manualRepairRequired: true },
    BLOCKED_SOURCE: { maxAttempts: 12, backoffSeconds: 60, fuseAfterAttempts: 12, autoRetry: true, manualRepairRequired: false },
    FAILED_SCAN: { maxAttempts: 2, backoffSeconds: 180, fuseAfterAttempts: 2, autoRetry: false, manualRepairRequired: false },
    FAILED_PUBLISH: { maxAttempts: 2, backoffSeconds: 120, fuseAfterAttempts: 2, autoRetry: true, manualRepairRequired: false },
    BLOCKED_RUNID_MISMATCH: { maxAttempts: 3, backoffSeconds: 60, fuseAfterAttempts: 3, autoRetry: true, manualRepairRequired: false },
    BLOCKED_DATE_MISMATCH: { maxAttempts: 2, backoffSeconds: 180, fuseAfterAttempts: 2, autoRetry: false, manualRepairRequired: false },
    DEGRADED_PREVIOUS_GOOD: { maxAttempts: 3, backoffSeconds: 60, fuseAfterAttempts: 3, autoRetry: true, manualRepairRequired: false },
    FAILED_DISPLAY: { maxAttempts: 3, backoffSeconds: 60, fuseAfterAttempts: 3, autoRetry: true, manualRepairRequired: false },
  };
  return policies[state] || { maxAttempts: 1, backoffSeconds: 120, fuseAfterAttempts: 1, autoRetry: false, manualRepairRequired: false };
}

function idempotencyKeyFor(row = {}, classification = {}) {
  const repairTradeDate = repairTradeDateForRow(row, classification);
  const raw = [repairTradeDate || EXPECTED_DATE || "latest", row.key || "unknown", classification.state || "PENDING", classification.blocker || "none"].join(":");
  return raw.replace(/[^a-zA-Z0-9:_-]+/g, "_").slice(0, 180);
}
function executionGuardForRow(row = {}, classification = {}) {
  const state = String(classification.state || "");
  if (state.includes("DISPLAY") || state.includes("DEGRADED") || state.includes("PREVIOUS") || state.includes("RUNID_MISMATCH")) {
    return "after command, re-run daily manifest and verify productionApi/desktop/mobile/scorecard88 runIds are same latest runId; reject old runId, fallback, previous-good, missing runId, or membership-only 401 as success";
  }
  return "";
}
function jobForRow(row, classification) {
  if (classification.state === "CLOSED" || classification.state === "PENDING_NOT_DUE" || classification.state === "PUBLISH_DEFERRED_MANIFEST_PENDING") return null;
  const command = commandFor(row.key, classification.state);
  const repairTradeDate = repairTradeDateForRow(row, classification);
  const idempotencyKey = idempotencyKeyFor(row, classification);
  const receiptFile = path.join(OUT_DIR, "receipts", idempotencyKey.replace(/[^a-zA-Z0-9_.-]+/g, "_") + ".json");
  const retryPolicy = retryPolicyForState(classification.state);
  const jobId = [repairTradeDate || EXPECTED_DATE || "latest", row.key || "unknown"].join(":");
  return {
    jobId,
    module: row.key || "unknown",
    key: row.key,
    label: row.label || row.key,
    state: classification.state,
    layer: classification.layer,
    priority: classification.priority,
    retryable: classification.retryable,
    blocker: classification.blocker,
    nextAction: classification.nextAction,
    command,
    idempotencyKey,
    receiptFile,
    receiptRequired: true,
    retryPolicy,
    reasonCode: classification.blocker || classification.state || "UNKNOWN",
    attempts: 0,
    maxAttempts: Number(retryPolicy.maxAttempts ?? 3),
    timeout: ["FAILED_SCAN", "BLOCKED_SOURCE"].includes(classification.state) ? 240000 : 60000,
    nextRetryAt: null,
    terminalReason: null,
    deadLetter: false,
    selfHealEvidence: [],
    requiresWaterRootOk: ["FAILED_SCAN", "FAILED_PUBLISH", "DEGRADED_PREVIOUS_GOOD", "FAILED_DISPLAY"].includes(classification.state),
    expectedDate: EXPECTED_DATE,
    repairTradeDate,
    runId: row.runId || "",
    runIds: row.runIds || {},
    issues: row.issues || [],
    executionGuard: executionGuardForRow(row, classification),
  };
}

function rootWaterJobForManifest(manifest = {}, marketCalendar = null) {
  if (manifest.waterRoot?.ok !== false) return null;
  if (isMarketClosedPreviousGood(manifest, marketCalendar)) return null;
  const blocker = manifest.waterRoot?.reason || manifest.blocker || "water_root_not_ready";
  const classification = {
    state: "BLOCKED_SOURCE",
    layer: ["source", "water_root"],
    priority: 10,
    retryable: true,
    blocker,
    nextAction: "rewater_then_reverify_water_root",
  };
  const row = {
    key: "water-root",
    label: "Water Root",
    runId: "",
    runIds: {},
    issues: [blocker],
  };
  const idempotencyKey = idempotencyKeyFor(row, classification);
  const receiptFile = path.join(OUT_DIR, "receipts", idempotencyKey.replace(/[^a-zA-Z0-9_.-]+/g, "_") + ".json");
  const retryPolicy = retryPolicyForState(classification.state);
  const jobId = [EXPECTED_DATE || "latest", row.key].join(":");
  return {
    jobId,
    module: row.key,
    key: row.key,
    label: row.label,
    state: classification.state,
    layer: classification.layer,
    priority: classification.priority,
    retryable: classification.retryable,
    blocker: classification.blocker,
    nextAction: classification.nextAction,
    command: commandFor(row.key, classification.state),
    idempotencyKey,
    receiptFile,
    receiptRequired: true,
    retryPolicy,
    reasonCode: classification.blocker || classification.state || "SOURCE_NOT_READY",
    attempts: 0,
    maxAttempts: Number(retryPolicy.maxAttempts ?? 3),
    timeout: 240000,
    nextRetryAt: null,
    terminalReason: null,
    deadLetter: false,
    selfHealEvidence: [],
    requiresWaterRootOk: false,
    expectedDate: EXPECTED_DATE,
    runId: "",
    runIds: {},
    issues: row.issues,
  };
}

function commandFor(key, state) {
  if (state === "BLOCKED_AUTH") return "verify service token env, then rerun scanner/readback with machine token";
  if (state === "BLOCKED_SOURCE") return "npm run daytrade-warmup:self-heal && npm run verify:terminal-water-root";
  if (state === "FAILED_PUBLISH") return "npm run manifest:daily-terminal-run && npm run scorecard:publish";
  if (state === "BLOCKED_RUNID_MISMATCH") return "npm run scorecard:terminal-source && npm run manifest:daily-terminal-run -- --from-existing --scorecard-candidate-file=C:\\fuman-runtime\\data\\scorecard-terminal-current.json && npm run snapshot:desktop && npm run verify:terminal-resource-chain:unattended";
  if (state === "FAILED_DISPLAY") return "npm run verify:terminal-resource-chain:unattended";
  const map = {
    strategy2: `npm run verify:strategy2-e2e-closure -- --expected-date=${EXPECTED_DATE}`,
    strategy3: "npm run verify:daytrade-strategy3-closure-live",
    strategy4: "pwsh -NoProfile -ExecutionPolicy Bypass -File .\\run-strategy4.ps1",
    strategy5: "pwsh -NoProfile -ExecutionPolicy Bypass -File .\\run-strategy5.ps1",
    institution: "npm run verify:institution-live-closure",
    cb: "npm run verify:cb-live-readback",
    warrant: "npm run verify:warrant-live-closure",
  };
  return map[key] || "rerun module scanner and terminal readback";
}

function overallState(manifest, moduleStates, marketCalendar = null, manifestDateMatchesExpected = true) {
  if (manifestDateMatchesExpected === false) return "BLOCKED_DATE_MISMATCH";
  if (manifest.ok === true && moduleStates.every((row) => row.state === "CLOSED")) return "CLOSED";
  const sourceFreshnessRequired = marketCalendar?.sourceFreshnessRequired !== false;
  if ((sourceFreshnessRequired && manifest.waterRoot?.ok === false && !isMarketClosedPreviousGood(manifest, marketCalendar)) || moduleStates.some((row) => row.state === "BLOCKED_SOURCE")) return "BLOCKED_SOURCE";
  if (moduleStates.some((row) => row.state === "BLOCKED_AUTH")) return "BLOCKED_AUTH";
  if (moduleStates.some((row) => row.state === "BLOCKED_RUNID_MISMATCH")) return "BLOCKED_RUNID_MISMATCH";
  if (moduleStates.some((row) => row.state === "BLOCKED_DATE_MISMATCH")) return "BLOCKED_DATE_MISMATCH";
  if (moduleStates.some((row) => row.state === "FAILED_SCAN")) return "FAILED_SCAN";
  if (moduleStates.some((row) => row.state === "BLOCKED_RUNID_MISMATCH")) return "BLOCKED_RUNID_MISMATCH";
  if (moduleStates.some((row) => row.state === "BLOCKED_DATE_MISMATCH")) return "BLOCKED_DATE_MISMATCH";
  if (moduleStates.some((row) => row.state === "FAILED_PUBLISH")) return "FAILED_PUBLISH";
  if (moduleStates.some((row) => row.state === "FAILED_DISPLAY")) return "FAILED_DISPLAY";
  if (moduleStates.some((row) => row.state === "DEGRADED_PREVIOUS_GOOD")) return "DEGRADED_PREVIOUS_GOOD";
  if (moduleStates.some((row) => row.state === "PENDING_NOT_DUE" || row.state === "PUBLISH_DEFERRED_MANIFEST_PENDING")) return "PENDING_NOT_DUE";
  return "DEGRADED_PREVIOUS_GOOD";
}

function selfTest() {
  if (!EXPECTED_DATE) EXPECTED_DATE = "20260730";
  const closedMarket = { marketOpen: false };
  const waterBlockedManifest = { waterRoot: { ok: false, reason: "source_root_not_ready" } };
  const cases = [
    {
      name: "closed_module_has_no_job",
      row: { key: "strategy2", label: "Strategy2", ok: true, complete: true, fallback: false, tradeDate: "20260730", sourceDate: "20260730", runId: "strategy2-20260730-good", runIds: { scanner: "x", productionApi: "x", desktop: "x", mobile: "x", scorecard88: "x" }, issues: [] },
      manifest: { waterRoot: { ok: true } },
      expectedState: "CLOSED",
      expectedJob: false,
    },
    {
      name: "display_hold_previous_day_complete_stays_closed",
      expectedDate: "20260731",
      effectiveValidationDate: "20260730",
      row: { key: "strategy4", label: "Strategy4", ok: true, complete: true, fallback: false, tradeDate: "20260730", sourceDate: "20260730", runId: "strategy4-20260730-good", runIds: { scanner: "x", productionApi: "x", desktop: "x", mobile: "x", scorecard88: "x" }, issues: [] },
      manifest: { waterRoot: { ok: true } },
      expectedState: "CLOSED",
      expectedJob: false,
    },
    {
      name: "pending_not_due_has_no_job",
      row: { key: "strategy5", label: "Strategy5", ok: false, complete: false, pendingNotDue: true, issues: ["pending_not_due:strategy5@21:00"], __classificationNow: new Date("2099-01-02T20:00:00+08:00") },
      manifest: { waterRoot: { ok: true } },
      expectedDate: "20990102",
      expectedState: "PENDING_NOT_DUE",
      expectedJob: false,
    },
    {
      name: "pending_not_due_with_missing_runid_creates_repair_job",
      row: { key: "strategy5", label: "Strategy5", ok: false, complete: false, fallback: true, pendingNotDue: true, issues: ["pending_not_due:21:00", "manifest_missing_runId"] },
      manifest: { waterRoot: { ok: true } },
      expectedState: "DEGRADED_PREVIOUS_GOOD",
      expectedJob: true,
      expectedBlocker: "manifest_missing_runId",
    },    {
      name: "auth_401_becomes_manual_job",
      row: { key: "strategy4", label: "Strategy4", ok: false, complete: false, issues: ["401 Unauthorized while syncing scorecard"] },
      manifest: { waterRoot: { ok: true } },
      expectedState: "BLOCKED_AUTH",
      expectedJob: true,
      expectedRetry: { maxAttempts: 0, manualRepairRequired: true },
    },
    {
      name: "source_not_ready_becomes_water_recheck_only",
      row: { key: "strategy2", label: "Strategy2", ok: false, complete: false, issues: ["source not_ready coverage low"] },
      manifest: waterBlockedManifest,
      expectedState: "BLOCKED_SOURCE",
      expectedJob: true,
      expectedCommand: "npm run daytrade-warmup:self-heal && npm run verify:terminal-water-root",
    },
    {
      name: "scanner_failure_requires_water_root",
      row: { key: "strategy3", label: "Strategy3", ok: false, complete: false, issues: ["scanner receipt failed exit=1"] },
      manifest: { waterRoot: { ok: true } },
      expectedState: "FAILED_SCAN",
      expectedJob: true,
      requiresWaterRootOk: true,
    },
    {
      name: "due_stale_runid_creates_scanner_job",
      row: { key: "strategy3", label: "Strategy3", ok: false, complete: false, runId: "strategy3-20260716-old", issues: ["manifest_tradeDate_mismatch:20260716!=20260723"] },
      manifest: { waterRoot: { ok: true } },
      expectedState: "FAILED_SCAN",
      expectedJob: true,
      requiresWaterRootOk: true,
    },
    {
      name: "scorecard_missing_becomes_publish_job",
      row: { key: "warrant", label: "Warrant", ok: false, complete: false, issues: ["scorecard sourceReport missing row"] },
      manifest: { waterRoot: { ok: true } },
      expectedState: "FAILED_PUBLISH",
      expectedJob: true,
      requiresWaterRootOk: true,
    },
    {
      name: "pending_not_due_with_stale_scanner_date_creates_scan_job",
      row: {
        key: "strategy2",
        label: "Strategy2",
        ok: false,
        complete: false,
        pendingNotDue: true,
        runId: "strategy2-20260727-old",
        tradeDate: "20260727",
        sourceDate: "20260727",
        runIds: {
          scanner: "strategy2-20260727-old",
          supabase: "strategy2-20260727-old",
          productionApi: "strategy2-20260727-old",
          desktop: "strategy2-20260727-old",
          mobile: "strategy2-20260727-old",
          scorecard88: "strategy2-20260724-old"
        },
        issues: ["pending_not_due:09:00", "unattended: scanner receipt date 20260727 != expected 20260730", "scorecard /88 row/sourceReport runId != latest pointer"]
      },
      manifest: { waterRoot: { ok: true } },
      expectedState: "FAILED_SCAN",
      expectedJob: true,
      requiresWaterRootOk: true,
    },
    {
      name: "scorecard_mismatch_becomes_runid_closure_job_even_when_manifest_pending",
      row: { key: "strategy2", label: "Strategy2", ok: false, complete: false, issues: ["scorecard /88 row/sourceReport runId != latest pointer"] },
      manifest: { waterRoot: { ok: true }, modules: [{ key: "strategy4", pendingNotDue: true }] },
      expectedState: "BLOCKED_RUNID_MISMATCH",
      expectedJob: true,
      expectedCommand: "npm run scorecard:terminal-source && npm run manifest:daily-terminal-run -- --from-existing --scorecard-candidate-file=C:\\fuman-runtime\\data\\scorecard-terminal-current.json && npm run snapshot:desktop && npm run verify:terminal-resource-chain:unattended",
      requiresWaterRootOk: false,
    },
    {
      name: "runid_mismatch_becomes_display_closure_job",
      row: { key: "institution", label: "Institution", ok: false, complete: false, runId: "institution-20260721-old", issues: ["scorecard /88 row/sourceReport runId != latest pointer"] },
      manifest: { waterRoot: { ok: true } },
      expectedState: "BLOCKED_RUNID_MISMATCH",
      expectedJob: true,
      expectedCommand: "npm run scorecard:terminal-source && npm run manifest:daily-terminal-run -- --from-existing --scorecard-candidate-file=C:\\fuman-runtime\\data\\scorecard-terminal-current.json && npm run snapshot:desktop && npm run verify:terminal-resource-chain:unattended",
      requiresWaterRootOk: false,
    },
    {
      name: "structural_runid_mismatch_becomes_display_closure_job",
      row: {
        key: "strategy2",
        label: "Strategy2",
        ok: false,
        complete: false,
        runId: "strategy2-20260727-new",
        runIds: {
          scanner: "strategy2-20260727-new",
          productionApi: "strategy2-20260727-new",
          desktop: "strategy2-20260724-old",
          mobile: "strategy2-20260727-new",
          scorecard88: "strategy2-20260724-old"
        },
        issues: []
      },
      manifest: { waterRoot: { ok: true } },
      expectedState: "BLOCKED_RUNID_MISMATCH",
      expectedJob: true,
      expectedCommand: "npm run scorecard:terminal-source && npm run manifest:daily-terminal-run -- --from-existing --scorecard-candidate-file=C:\\fuman-runtime\\data\\scorecard-terminal-current.json && npm run snapshot:desktop && npm run verify:terminal-resource-chain:unattended",
      requiresWaterRootOk: false,
    },
    {
      name: "due_previous_day_run_becomes_scan_job_before_display_repair",
      row: {
        key: "strategy2",
        label: "Strategy2",
        ok: false,
        complete: false,
        runId: "strategy2-20260727-old",
        tradeDate: "20260727",
        sourceDate: "20260727",
        runIds: {
          scanner: "strategy2-20260727-old",
          productionApi: "strategy2-20260727-old",
          desktop: "strategy2-20260724-old",
          mobile: "strategy2-20260727-old",
          scorecard88: "strategy2-20260724-old"
        },
        issues: ["scorecard /88 row/sourceReport runId != latest pointer"]
      },
      manifest: { waterRoot: { ok: true } },
      expectedState: "FAILED_SCAN",
      expectedJob: true,
      requiresWaterRootOk: true,
    },
    {
      name: "display_auth_readback_not_backend_auth",
      row: { key: "cb", label: "CB", ok: false, complete: false, issues: ["authenticated readback token not armed"] },
      manifest: { waterRoot: { ok: true } },
      expectedState: "FAILED_DISPLAY",
      expectedJob: true,
    },
    {
      name: "fallback_previous_good_is_degraded_job",
      row: { key: "strategy5", label: "Strategy5", ok: false, complete: true, fallback: true, issues: ["previous good fallback used"] },
      manifest: { waterRoot: { ok: true } },
      expectedState: "DEGRADED_PREVIOUS_GOOD",
      expectedJob: true,
    },
    {
      name: "market_closed_previous_good_does_not_become_source_block",
      row: { key: "institution", label: "Institution", ok: true, complete: true, fallback: false, runId: "institution-20260717-good", issues: [] },
      manifest: { previousGoodHold: true, waterRoot: { ok: false, reason: "market_closed_previous_good", sourceStatus: { status: "stopped", message: "off-session" } } },
      marketCalendar: closedMarket,
      expectedState: "CLOSED",
      expectedJob: false,
    },
  ];
  const failures = [];
  const results = cases.map((item) => {
    const previousExpectedDate = EXPECTED_DATE;
    const previousEffectiveValidationDate = EFFECTIVE_VALIDATION_DATE;
    if (item.expectedDate) EXPECTED_DATE = item.expectedDate;
    if (Object.prototype.hasOwnProperty.call(item, "effectiveValidationDate")) EFFECTIVE_VALIDATION_DATE = item.effectiveValidationDate;
    const classification = classifyModule(item.row, item.manifest || {}, item.marketCalendar || null);
    const lifecycleStage = lifecycleStageForRow(item.row, classification, item.manifest || {}, item.marketCalendar || null);
    const stateRow = { ...item.row, ...classification, lifecycleStage };
    const job = jobForRow(stateRow, stateRow);
    EXPECTED_DATE = previousExpectedDate;
    EFFECTIVE_VALIDATION_DATE = previousEffectiveValidationDate;
    if (classification.state !== item.expectedState) failures.push(`${item.name}: state ${classification.state} != ${item.expectedState}`);
    if (Boolean(job) !== item.expectedJob) failures.push(`${item.name}: job ${Boolean(job)} != ${item.expectedJob}`);
    if (item.expectedRetry && job) {
      for (const [key, value] of Object.entries(item.expectedRetry)) {
        if (job.retryPolicy?.[key] !== value) failures.push(`${item.name}: retryPolicy.${key} ${job.retryPolicy?.[key]} != ${value}`);
      }
    }
    if (item.expectedCommand && job?.command !== item.expectedCommand) failures.push(`${item.name}: command ${job?.command} != ${item.expectedCommand}`);
    if (item.requiresWaterRootOk !== undefined && job?.requiresWaterRootOk !== item.requiresWaterRootOk) failures.push(`${item.name}: requiresWaterRootOk ${job?.requiresWaterRootOk} != ${item.requiresWaterRootOk}`);
    if (job) {
      for (const field of ["jobId", "module", "reasonCode", "attempts", "maxAttempts", "timeout", "nextRetryAt", "terminalReason", "deadLetter", "selfHealEvidence"]) {
        if (!(field in job)) failures.push(item.name + ": job ledger missing " + field);
      }
      if (job.maxAttempts !== Number(job.retryPolicy?.maxAttempts ?? 3)) failures.push(item.name + ": maxAttempts does not match retryPolicy");
    }
    return {
      name: item.name,
      state: classification.state,
      lifecycleStage,
      jobState: job?.state || "none",
      command: job?.command || "",
      retryPolicy: job?.retryPolicy || null,
      blocker: job?.blocker || classification.blocker || "",
    };
  });
  return { ok: failures.length === 0, contract: "terminal-orchestrator-state-self-test-v1", caseCount: cases.length, failures, results };
}
function markdown(state) {
  const lines = [];
  lines.push("# Terminal Orchestrator State");
  lines.push("");
  lines.push(`- checkedAt: ${state.checkedAt}`);
  lines.push(`- tradeDate: ${state.tradeDate}`);
  lines.push(`- overallState: ${state.overallState}`);
  lines.push(`- unattendedStatus: ${state.unattendedStatus}`);
  lines.push(`- blocker: ${state.blocker || "--"}`);
  lines.push("");
  lines.push("## Module State");
  lines.push("| module | state | layer | runId | next action | blocker | issues |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const row of state.modules) {
    lines.push(`| ${row.label} | ${row.state} | ${row.layer.join(", ") || "--"} | ${row.runId || "--"} | ${row.nextAction} | ${row.blocker || "--"} | ${(row.issues || []).join("<br>") || "--"} |`);
  }
  lines.push("");
  lines.push("## Job Queue");
  lines.push("| priority | module | state | command | blocker |");
  lines.push("|---:|---|---|---|---|");
  for (const job of state.jobQueue) {
    lines.push(`| ${job.priority} | ${job.label} | ${job.state} | ${job.command} | ${job.blocker} |`);
  }
  return lines.join("\n");
}

async function main() {
  if (SELF_TEST) {
    const result = selfTest();
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exit(1);
    return;
  }
  await fs.promises.mkdir(OUT_DIR, { recursive: true });
  const marketCalendar = await buildMarketCalendarContract({ now: dateFromExpectedDateForCalendar(EXPECTED_DATE) || new Date() }).catch(() => null);
  if (!EXPECTED_DATE) {
    const calendarExpected = String(
      marketCalendar?.marketOpen === false
        ? (marketCalendar?.marketDate || marketCalendar?.requestedDate || taipeiDateKey() || marketCalendar?.displayTradeDate)
        : (marketCalendar?.marketDate || marketCalendar?.requestedDate || marketCalendar?.displayTradeDate || taipeiDateKey())
    ).replace(/\D/g, "").slice(0, 8);
    EXPECTED_DATE = calendarExpected || taipeiDateKey();
  }
  const commands = [];
  if (!FROM_EXISTING) {
    commands.push(runNode(["--use-system-ca", "scripts/write-daily-terminal-run-manifest.js", `--expected-date=${EXPECTED_DATE}`], "daily-terminal-run-manifest"));
  }
  const manifestPath = manifestPathForExpectedDate(EXPECTED_DATE_EXPLICIT ? EXPECTED_DATE : "");
  const manifest = readJson(manifestPath, {});
  const manifestTradeDate = String(manifest.tradeDate || manifest.expectedDate || "").replace(/\D/g, "").slice(0, 8);
  const displayTradeDate = displayTradeDateFrom(marketCalendar, manifest, EXPECTED_DATE);
  const manifestDateMatchesExpected = !manifestTradeDate || manifestTradeDate === EXPECTED_DATE;
  const manifestDateMatchesDisplay = !manifestTradeDate || (!!displayTradeDate && manifestTradeDate === displayTradeDate);
  const manifestDisplayHold = manifestDisplayHoldMode(manifest, marketCalendar, EXPECTED_DATE, displayTradeDate);
  const manifestDateAccepted = manifestDateMatchesExpected || (manifestDisplayHold && manifestDateMatchesDisplay);
  EFFECTIVE_VALIDATION_DATE = manifestDateAccepted && manifestDateMatchesDisplay ? displayTradeDate : EXPECTED_DATE;
  const modules = Array.isArray(manifest.modules) ? manifest.modules : [];
  const moduleStates = modules.map((row) => {
    const normalizedRow = { ...row };
    const classification = classifyModule(normalizedRow, manifest, marketCalendar);
    return {
      ...normalizedRow,
      ...classification,
      lifecycleStage: lifecycleStageForRow(normalizedRow, classification, manifest, marketCalendar),
    };
  });
  const marketClosedHold = isMarketClosedPreviousGood(manifest, marketCalendar);
  const rootWaterJob = rootWaterJobForManifest(manifest, marketCalendar);
  const jobQueue = [rootWaterJob, ...moduleStates.map((row) => jobForRow(row, row))]
    .filter(Boolean)
    .sort((a, b) => a.priority - b.priority || String(a.key).localeCompare(String(b.key)));
  const pendingModules = moduleStates.filter((row) => row.state === "PENDING_NOT_DUE" || row.state === "PUBLISH_DEFERRED_MANIFEST_PENDING");
  const actionableModules = moduleStates.filter((row) => row.state !== "CLOSED" && !pendingModules.includes(row));
  const queuedKeys = new Set(jobQueue.map((job) => job.key));
  const missingJobModules = actionableModules.filter((row) => !queuedKeys.has(row.key)).map((row) => row.key);
  const queueCoverage = {
    ok: missingJobModules.length === 0,
    moduleCount: moduleStates.length,
    actionableModuleCount: actionableModules.length,
    pendingNotDueModuleCount: pendingModules.length,
    queuedModuleCount: queuedKeys.size,
    missingJobModules,
  };
  const hasPendingNotDue = jobQueue.length === 0 && moduleStates.some((row) => row.state === "PENDING_NOT_DUE" || row.state === "PUBLISH_DEFERRED_MANIFEST_PENDING");
  const state = {
    contract: "terminal-orchestrator-state-v1",
    checkedAt: new Date().toISOString(),
    tradeDate: EXPECTED_DATE,
    manifestTradeDate,
    manifestDateMatchesExpected,
    manifestDateMatchesDisplay,
    manifestDisplayHold,
    manifestDateAccepted,
    displayTradeDate,
    effectiveValidationDate: EFFECTIVE_VALIDATION_DATE,
    manifestPath,
    manifestOk: manifest.ok === true,
    waterRoot: manifest.waterRoot || null,
    commands,
    marketCalendar,
    stateMachineContract: STATE_MACHINE_CONTRACT,
    marketClosedPreviousGood: marketClosedHold,
    overallState: overallState(manifest, moduleStates, marketCalendar, manifestDateAccepted),
    unattendedStatus: manifest.ok === true && manifestDateAccepted && jobQueue.length === 0 ? (marketClosedHold ? "PREVIOUS_GOOD_HOLD" : "YES") : "NO",
    blocker: hasPendingNotDue
      ? (manifest.blocker || jobQueue[0]?.blocker || "pending_not_due")
      : (!manifestDateAccepted
        ? "manifest_tradeDate_mismatch:" + (manifestTradeDate || "missing") + "!=" + EXPECTED_DATE + "; displayTradeDate=" + (displayTradeDate || "missing")
        : (marketClosedHold ? (jobQueue[0]?.blocker || "market_closed_previous_good") : (jobQueue[0]?.blocker || manifest.blocker || ""))),
    modules: moduleStates,
    jobQueue,
    queueCoverage,
  };
  const stateFile = path.join(OUT_DIR, "terminal-orchestrator-state.json");
  const queueFile = path.join(OUT_DIR, "terminal-job-queue.json");
  const mdFile = path.join(OUT_DIR, "terminal-orchestrator-state.md");
  await fs.promises.writeFile(stateFile, JSON.stringify(state, null, 2));
  await fs.promises.writeFile(queueFile, JSON.stringify(jobQueue, null, 2));
  await fs.promises.writeFile(mdFile, markdown(state));
  const operationallyValid = queueCoverage.ok && manifestDateAccepted && (state.unattendedStatus === "YES" || state.unattendedStatus === "PREVIOUS_GOOD_HOLD" || (state.overallState === "PENDING_NOT_DUE" && jobQueue.length === 0));
  console.log(JSON.stringify({
    ok: operationallyValid,
    unattendedStatus: state.unattendedStatus,
    overallState: state.overallState,
    tradeDate: state.tradeDate,
    blocker: state.blocker,
    jobs: jobQueue.map((job) => ({ key: job.key, state: job.state, action: job.nextAction })),
    output: stateFile,
    queue: queueFile,
  }, null, 2));
  if (!operationallyValid) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[terminal-orchestrator-state] failed: ${error.stack || error.message || error}`);
  process.exit(1);
});








