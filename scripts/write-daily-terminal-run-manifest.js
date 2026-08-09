const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { normalizeStrategyScanReceipt } = require("../lib/strategy-scan-receipt-contract");
const { loadActiveModuleRegistry } = require("../lib/terminal-active-module-registry");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.resolve(process.argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length) || "outputs/daily-terminal-run");
const EXPECTED_DATE_ARG = process.argv.find((arg) => arg.startsWith("--expected-date="))?.slice("--expected-date=".length) || "";
const EXPECTED_DATE_EXPLICIT = Boolean(EXPECTED_DATE_ARG);
let EXPECTED_DATE = (EXPECTED_DATE_ARG || taipeiDateKey()).replace(/\D/g, "").slice(0, 8);
const REQUESTED_DATE = EXPECTED_DATE;
const SKIP_RUN = process.argv.includes("--from-existing");
const REQUIRE_FORMAL_NOW = process.argv.includes("--require-formal-now");
const ALLOW_NON_GREEN_EXIT_ZERO = process.argv.includes("--allow-non-green-exit-zero");
const SCORECARD_CANDIDATE_FILE = process.argv.find((arg) => arg.startsWith("--scorecard-candidate-file="))?.slice("--scorecard-candidate-file=".length) || "";
const DAILY_RUN_ID_ARG = process.argv.find((arg) => arg.startsWith("--daily-run-id="))?.slice("--daily-run-id=".length) || "";
const SCORECARD_PUBLISH_MODE = Boolean(SCORECARD_CANDIDATE_FILE);
const ACTIVE_MODULE_REGISTRY = loadActiveModuleRegistry();
const STRATEGY_DUE_TIMES = Object.fromEntries(
  ACTIVE_MODULE_REGISTRY.active.map((row) => [row.key, row.dueTime])
);

function taipeiDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date).replace(/\D/g, "");
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function resolveRootDailyRunId(expectedDate) {
  const explicit = String(DAILY_RUN_ID_ARG || process.env.FUMAN_DAILY_RUN_ID || "").trim();
  if (explicit) return explicit;
  const auditRoots = [
    path.join(ROOT, "outputs", "terminal-final-audit"),
    path.join(ROOT, "outputs", "terminal-autonomous-completion-audit"),
  ];
  for (const auditRoot of auditRoots) {
    const dateRunId = readJson(path.join(auditRoot, expectedDate, "daily-run-id.json"), null);
    if (dateRunId?.daily_run_id || dateRunId?.dailyRunId) return String(dateRunId.daily_run_id || dateRunId.dailyRunId).trim();
    const latestAudit = readJson(path.join(auditRoot, "terminal-unattended-final-audit.json"), null);
    const latestDate = String(latestAudit?.trade_date || latestAudit?.tradeDate || "").replace(/\D/g, "").slice(0, 8);
    if (latestDate === expectedDate && (latestAudit?.daily_run_id || latestAudit?.dailyRunId)) {
      return String(latestAudit.daily_run_id || latestAudit.dailyRunId).trim();
    }
  }
  return "";
}

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";

function warmupEvidenceForDate(expectedDate) {
  const file = path.join(RUNTIME_DIR, "state", "daytrade-unattended-final-verdict.json");
  const verdict = readJson(file, {});
  const verdictDate = compactDate(verdict.trade_date || verdict.tradeDate || "");
  const phaseResults = verdict.phase_results && typeof verdict.phase_results === "object"
    ? verdict.phase_results
    : {};
  const naturalByPhase = verdict.natural_schedule_evidence_by_phase && typeof verdict.natural_schedule_evidence_by_phase === "object"
    ? verdict.natural_schedule_evidence_by_phase
    : {};
  const phase = (key) => phaseResults[key] || {};
  const phaseEvidence = {
    "0700": phase("0700"),
    "0845": phase("0845"),
    "0900": phase("0900"),
  };
  const naturalEvidence = Object.fromEntries(Object.entries(phaseEvidence).map(([key, value]) => [
    key,
    value.natural_schedule_evidence === true || naturalByPhase[key] === true,
  ]));
  const phaseGreen = Object.values(phaseEvidence).every((value) => value.pass === true);
  const naturalAll = Object.values(naturalEvidence).every(Boolean);
  const dateAligned = verdictDate === String(expectedDate || "");
  const finalNaturalSuccess = verdict.unattended_yes === "YES"
    && naturalAll
    && phaseGreen
    && dateAligned;
  return {
    file,
    exists: Boolean(verdict && Object.keys(verdict).length),
    tradeDate: verdictDate,
    dateAligned,
    phaseEvidence,
    naturalScheduleEvidenceByPhase: naturalEvidence,
    naturalSuccess: finalNaturalSuccess,
    selfHealRecovered: verdict.self_heal_recovered === true || verdict.selfHealRecovered === true,
    preservePreviousGood: verdict.preserve_previous_good === true || verdict.preservePreviousGood === true,
    finalDecision: finalNaturalSuccess ? 'UNATTENDED_YES' : (verdict.preserve_previous_good === true || verdict.preservePreviousGood === true ? 'PRESERVE_PREVIOUS_GOOD' : (verdict.self_heal_recovered === true || verdict.selfHealRecovered === true ? 'RECOVERED_NOT_NATURAL' : 'FAIL_CLOSED')),
    failedChecks: Array.isArray(verdict.failed_checks) ? verdict.failed_checks : [],
    policyDecision: String(verdict.policy_decision || verdict.ops_policy?.policy_decision || ""),
    runId: String(verdict.run_id || verdict.runId || ""),
    verdict,
  };
}


let SCORECARD_CANDIDATE_CACHE = null;
function scorecardCandidatePayload() {
  if (!SCORECARD_CANDIDATE_FILE) return {};
  if (SCORECARD_CANDIDATE_CACHE !== null) return SCORECARD_CANDIDATE_CACHE;
  const candidatePath = path.isAbsolute(SCORECARD_CANDIDATE_FILE)
    ? SCORECARD_CANDIDATE_FILE
    : path.resolve(ROOT, SCORECARD_CANDIDATE_FILE);
  SCORECARD_CANDIDATE_CACHE = readJson(candidatePath, {});
  return SCORECARD_CANDIDATE_CACHE;
}

function scorecardCandidateForKey(key) {
  const payload = scorecardCandidatePayload();
  const reports = Array.isArray(payload?.sourceReports) ? payload.sourceReports : [];
  const row = reports.find((item) => String(item?.key || "") === String(key || ""));
  if (!row) return {};
  const status = Number(row.statusCode || row.status || 200);
  const count = numeric(row.emittedRows ?? row.count ?? row.resultCount ?? row.returnedCount);
  return {
    status,
    ok: row.ok !== false && status < 400,
    runId: String(row.runId || ""),
    count,
    returnedCount: count,
    readbackCount: count,
    date: String(row.date || row.tradeDate || row.sourceDate || ""),
    reason: String(row.reason || ""),
    rowSuppressionReason: String(row.rowSuppressionReason || ""),
    rowSuppressionBlockers: Array.isArray(row.rowSuppressionBlockers) ? row.rowSuppressionBlockers.map(String) : [],
    evidenceStatus: String(row.evidenceStatus || ""),
    publishAllowed: row.publishAllowed === true,
    preservePreviousGood: row.preservePreviousGood === true,
    fallbackUsed: row.fallbackUsed === true,
    cacheSource: "scorecard-candidate-source",
    transportSource: "pre-publish-scorecard-candidate",
  };
}

function scorecardCandidateSourceBlocker(candidate = {}) {
  const blockers = Array.isArray(candidate.rowSuppressionBlockers) ? candidate.rowSuppressionBlockers : [];
  const reason = String(candidate.reason || candidate.rowSuppressionReason || "").trim();
  const evidenceStatus = String(candidate.evidenceStatus || "").trim();
  const text = [reason, evidenceStatus, ...blockers].join(" ").toLowerCase();
  const sourceLike = /source_quality_fail|source_coverage_not_ok|evidence_source_quality_fail|source_core_ok_false|latest_candle_time|ready_ge_35|ready_ma20|ready_ma20_continuous|source_status|fresh_quote_coverage|intraday_1m|1m/.test(text);
  if (candidate.ok === false && sourceLike) {
    return `source_quality_fail:${reason || blockers.join("|") || evidenceStatus || "scorecard_candidate_not_publishable"}`;
  }
  return "";
}
function taipeiMinuteOfDay(date = new Date()) {
  if (Number.isFinite(MOCK_TAIPEI_MINUTE)) return MOCK_TAIPEI_MINUTE;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return Number(parts.hour || 0) * 60 + Number(parts.minute || 0);
}

function minuteFromClock(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function scheduleStatusForKey(key, currentMinute = taipeiMinuteOfDay()) {
  const dueTime = STRATEGY_DUE_TIMES[key] || "00:00";
  const dueMinute = minuteFromClock(dueTime);
  const currentMinute = taipeiMinuteOfDay();
  const today = taipeiDateKey();
  const expectedIsFuture = EXPECTED_DATE > today;
  const expectedIsToday = EXPECTED_DATE === today;
  const pendingNotDue = dueMinute !== null && (expectedIsFuture || (expectedIsToday && currentMinute < dueMinute));
  return {
    dueTime,
    currentMinute,
    dueMinute,
    pendingNotDue,
    status: pendingNotDue ? "PENDING_NOT_DUE" : "DUE",
  };
}
function selfTestScheduleTransitions() {
  const cases = [
    { key: "strategy2", before: "08:59", at: "09:00" },
    { key: "strategy3", before: "13:04", at: "13:05" },
    { key: "strategy4", before: "15:59", at: "16:00" },
    { key: "warrant", before: "20:29", at: "20:30" },
    { key: "strategy5", before: "20:59", at: "21:00" },
    { key: "institution", before: "20:59", at: "21:00" },
    { key: "cb", before: "21:24", at: "21:25" },
  ];
  const rows = cases.map((item) => {
    const before = scheduleStatusForKey(item.key, minuteFromClock(item.before));
    const at = scheduleStatusForKey(item.key, minuteFromClock(item.at));
    return {
      key: item.key,
      dueTime: STRATEGY_DUE_TIMES[item.key],
      beforeMinute: item.before,
      atMinute: item.at,
      beforeStatus: before.status,
      atStatus: at.status,
      beforePendingNotDue: before.pendingNotDue,
      atPendingNotDue: at.pendingNotDue,
      ok: before.pendingNotDue === true && at.pendingNotDue === false && at.status === "DUE",
    };
  });
  const ok = rows.every((row) => row.ok === true);
  return {
    ok,
    contract: "daily-terminal-run-schedule-transition-self-test-v1",
    checkedAt: new Date().toISOString(),
    rule: "pending_not_due_before_due_time_and_due_at_exact_due_minute",
    activeDueTimes: STRATEGY_DUE_TIMES,
    rows,
    issues: rows.filter((row) => row.ok !== true).map((row) => `schedule_transition_failed:${row.key}:${row.beforeStatus}->${row.atStatus}`),
  };
}
function runDateFromId(value) {
  const match = String(value || "").match(/(?:^|[-_])(\d{8})(?:[-_]|$)/);
  return match ? match[1] : "";
}

function runTimeSecondsFromId(value) {
  const match = String(value || "").match(/-(\d{6})$/);
  if (!match) return 0;
  const text = match[1];
  const hour = Number(text.slice(0, 2));
  const minute = Number(text.slice(2, 4));
  const second = Number(text.slice(4, 6));
  if (![hour, minute, second].every(Number.isFinite)) return 0;
  return hour * 3600 + minute * 60 + second;
}

function numeric(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function surfaceFallback(surface = {}) {
  return surface.fallback === true
    || surface.fallbackUsed === true
    || surface.preservePreviousGood === true
    || surface.snapshotFallback === true
    || String(surface.cacheSource || surface.transportSource || surface.error || "").toLowerCase().includes("fallback");
}

function scorecardDeferredForStrategy2Intraday(rowKey, latestSurfaceRunId, scorecard = {}) {
  if (process.env.FUMAN_ALLOW_INTRADAY_SCORECARD_DEFER === "0") return false;
  if (rowKey !== "strategy2") return false;
  const latestDate = runDateFromId(latestSurfaceRunId) || EXPECTED_DATE;
  if (latestDate !== EXPECTED_DATE) return false;
  if (EXPECTED_DATE !== taipeiDateKey()) return false;
  const nowMinute = taipeiMinuteOfDay();
  const deferUntil = minuteFromClock(process.env.FUMAN_SCORECARD_INTRADAY_DEFER_UNTIL || "14:30") ?? (14 * 60 + 30);
  if (nowMinute >= deferUntil) return false;
  if (scorecard.status >= 500 || scorecard.ok === false) return false;
  return true;
}

function strategy2RollingRunIdsAllowed(key, uniqueRunIds, surfaces = []) {
  if (process.env.FUMAN_ALLOW_STRATEGY2_ROLLING_RUNID_DRIFT === "0") return false;
  if (key !== "strategy2") return false;
  const ids = [...new Set((uniqueRunIds || []).filter(Boolean))];
  if (ids.length <= 1) return true;
  const dates = ids.map(runDateFromId);
  if (dates.some((date) => date !== EXPECTED_DATE)) return false;
  const seconds = ids.map(runTimeSecondsFromId).filter(Boolean);
  if (seconds.length !== ids.length) return false;
  const maxDriftSeconds = Number(process.env.FUMAN_STRATEGY2_ROLLING_RUNID_MAX_DRIFT_SECONDS || 600);
  if (Math.max(...seconds) - Math.min(...seconds) > maxDriftSeconds) return false;
  let countBearingSurfaces = 0;
  for (const surface of surfaces.filter((item) => item && item.runId)) {
    if (surfaceFallback(surface)) return false;
    if (surface.status && Number(surface.status) >= 500) return false;
    if (surface.ok === false) return false;
    const count = numeric(surface.count || surface.returnedCount || surface.matches || surface.resultCount);
    if (count > 0) countBearingSurfaces += 1;
  }
  return countBearingSurfaces >= 3;
}

function compactDate(value) {
  const text = String(value || "");
  if (!text) return "";
  const direct = text.replace(/\D/g, "");
  return direct.length >= 8 ? direct.slice(0, 8) : "";
}

function runNode(args, label) {
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env },
    timeout: Number(process.env.FUMAN_MANIFEST_CHILD_TIMEOUT_MS || 150000),
    killSignal: "SIGTERM",
  });
  const timedOut = result.error?.code === "ETIMEDOUT";
  return {
    label,
    command: `node ${args.join(" ")}`,
    exitCode: timedOut ? 124 : (result.status ?? 1),
    stdout: String(result.stdout || "").slice(-4000),
    stderr: String(result.stderr || result.error?.message || "").slice(-4000),
    timedOut,
    ok: !timedOut && result.status === 0,
  };
}

function firstPresent(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim()) return value;
  }
  return "";
}

function bool(value) {
  return value === true;
}

function promoteSupabaseCompleteRunReceipt({ key, receipt = {}, supabase = {}, api = {}, terminal = {}, desktop = {}, mobile = {}, scorecard = {} }) {
  if (receipt.complete === true && receipt.status === "complete") return receipt;
  const runId = String(supabase.runId || "").trim();
  if (!runId || runDateFromId(runId) !== EXPECTED_DATE) return receipt;
  const surfaces = [api, terminal, desktop, mobile, scorecard].filter((surface) => surface && surface.runId);
  if (surfaces.length < 4) return receipt;
  if (!surfaces.every((surface) => String(surface.runId || "") === runId)) return receipt;
  if (surfaces.some((surface) => surfaceFallback(surface) || surface.ok === false || Number(surface.status || 200) >= 500)) return receipt;
  const evidenceStatus = firstPresent(supabase.evidenceStatus, supabase.row?.payload?.evidenceStatus, api.evidenceStatus, terminal.evidenceStatus, desktop.evidenceStatus, scorecard.evidenceStatus);
  const publishAllowed = supabase.publishAllowed === true
    || supabase.row?.payload?.publishAllowed === true
    || supabase.row?.payload?.run_quality_at_publish?.publishAllowed === true
    || api.publishAllowed === true
    || terminal.publishAllowed === true
    || desktop.publishAllowed === true
    || scorecard.publishAllowed === true;
  const complete = supabase.complete === true || supabase.row?.complete === true || supabase.row?.payload?.run_quality_at_publish?.qualityStatus === "complete";
  const qualityStatus = firstPresent(supabase.qualityStatus, supabase.row?.quality_status, supabase.row?.payload?.qualityStatus, api.qualityStatus, terminal.qualityStatus, desktop.qualityStatus);
  const resultCount = numeric(firstPresent(supabase.count, supabase.resultCount, supabase.row?.result_count, supabase.row?.payload?.resultCount, api.resultCount, terminal.resultCount, desktop.resultCount));
  const scannedCount = numeric(firstPresent(supabase.scannedCount, supabase.row?.scanned_count, supabase.row?.payload?.scannedCount));
  const expectedTotal = numeric(firstPresent(supabase.expectedTotal, supabase.row?.expected_total, supabase.row?.payload?.expectedTotal));
  if (complete !== true || evidenceStatus !== "complete" || publishAllowed !== true || qualityStatus !== "complete" || resultCount < 0) return receipt;
  return {
    ...receipt,
    status: "complete",
    complete: true,
    evidenceStatus: "complete",
    publishAllowed: true,
    preservePreviousGood: false,
    fallback: false,
    runId,
    matches: resultCount,
    scanned: scannedCount,
    total: expectedTotal,
    qualityStatus: "complete",
    promotedFromSupabaseLatestCompleteRun: true,
    blockedReceiptIgnored: receipt.status === "blocked" || receipt.complete === false,
    sourceReceiptStatus: receipt.status || "",
    sourceReceiptRunId: receipt.runId || "",
    sourceReceiptFile: receipt.file || "",
    promotionReason: `${key || "module"}_latest_complete_run_all_surfaces_aligned`,
  };
}
function addUniqueIssue(issues, issue) {
  const value = String(issue || "").trim();
  if (value && !issues.includes(value)) issues.push(value);
}

function addPriorityIssue(issues, issue) {
  const value = String(issue || "").trim();
  if (!value) return;
  const index = issues.indexOf(value);
  if (index >= 0) issues.splice(index, 1);
  issues.unshift(value);
}

function isMembershipGateSurface(surface = {}) {
  const bits = [
    surface.error,
    surface.reason,
    surface.cacheSource,
    surface.transportSource,
    surface.key,
    surface.strategy,
    surface.evidenceStatus,
  ].map((value) => String(value || "").toLowerCase()).join(" ");
  return surface.membershipProtected === true
    || Number(surface.status) === 401
    || bits.includes("membership-required")
    || bits.includes("membership_required")
    || bits.includes("membership-gate")
    || bits.includes("protected-display-layer");
}

function liveResourceChainAuditForKey(key) {
  const audit = readJson(path.join(ROOT, "outputs", "terminal-resource-chain-audit", "terminal-resource-chain-audit.json"), {});
  const auditDate = compactDate(audit.expectedDate);
  if (auditDate !== EXPECTED_DATE) {
    return { ok: false, authenticated: false, reason: "audit_date_mismatch:" + (auditDate || "missing") + "!=" + EXPECTED_DATE };
  }
  const auth = audit.protectedReadbackAuth || {};
  const authenticated = auth.enabled === true && auth.attempted === true && Number(auth.status) === 200;
  const row = Array.isArray(audit.results)
    ? audit.results.find((item) => String(item?.key || "") === String(key || ""))
    : null;
  if (!row) {
    return { ok: false, authenticated, reason: "missing_strategy_result" };
  }
  const expectedRunId = firstPresent(
    row.supabase?.runId,
    row.latest?.runId,
    row.live?.runId,
    row.receipt?.runId,
  );
  const scorecardRunId = firstPresent(
    row.scorecard?.runId,
    row.scorecard?.rowRunId,
    row.scorecard?.sourceReportRunId,
  );
  const issues = Array.isArray(row.issues) ? row.issues.map((item) => String(item || "")) : [];
  const strategy2IntradayScorecardDeferred = Boolean(
    key === "strategy2"
    && row.ok === true
    && issues.length === 0
    && (runDateFromId(expectedRunId) || EXPECTED_DATE) === EXPECTED_DATE
    && EXPECTED_DATE === taipeiDateKey()
    && taipeiMinuteOfDay() < (minuteFromClock(process.env.FUMAN_SCORECARD_INTRADAY_DEFER_UNTIL || "14:30") ?? 870)
  );
  const ok = authenticated
    && row.ok === true
    && Boolean(expectedRunId)
    && (
      (Boolean(scorecardRunId) && scorecardRunId === expectedRunId)
      || strategy2IntradayScorecardDeferred
    );
  return {
    ok,
    authenticated,
    expectedRunId,
    scorecardRunId,
    scorecardDeferred: strategy2IntradayScorecardDeferred,
    issues,
    reason: ok ? "" : (issues[0] || (authenticated ? "resource_chain_not_closed" : "authenticated_readback_not_verified")),
  };
}

function marketClosedForManifest() {
  const water = readJson(path.join(ROOT, "outputs", "terminal-water-root", "terminal-water-root.json"), {});
  const row = water.marketCalendar?.row || {};
  const requestedDate = compactDate(row.requestedDate || row.marketDate || water.expectedDate || water.requestedDate);
  if (requestedDate !== EXPECTED_DATE) return false;
  const marketStatus = String(row.marketStatus || water.marketStatus || "").toLowerCase();
  return row.marketOpen === false
    || row.finalMarketOpen === false
    || row.tradingDayOpen === false
    || marketStatus === "closed";
}

function isPreviousGoodHoldWaterRoot(water = {}) {
  const bits = [
    water.status,
    water.reason,
    water.marketCalendar?.row?.displayMode,
    water.marketCalendar?.row?.skipReason,
    water.marketCalendar?.row?.reason,
    water.sourceStatus?.summary?.status,
    water.sourceStatus?.summary?.message,
  ].map((value) => String(value || "").toLowerCase()).join(" ");
  return water.preservePreviousGood === true
    || water.formalScanSkipped === true
    || water.marketCalendar?.row?.preservePreviousGood === true
    || bits.includes("previous_good")
    || bits.includes("wait_source_window")
    || bits.includes("skip_formal_scan")
    || bits.includes("market_closed");
}
function isSoftWaterRootIssue(water = {}) {
  const row = water.marketCalendar?.row || {};
  const bits = [
    water.status,
    water.reason,
    row.marketStatus,
    row.skipReason,
    row.displayMode,
    row.evidenceStatus,
    row.unattendedStatus,
    water.canonicalGate?.summary?.phase,
  ].map((value) => String(value || "").toLowerCase()).join(" ");
  return water.ok !== true
    && row.sourceFreshnessRequired === false
    && (row.formalSourceWindowOpen === false || row.formalScanSkipped === true)
    && (bits.includes("after_formal_source_window")
      || bits.includes("after_daytrade_window")
      || bits.includes("wait_source_window")
      || bits.includes("previous_good"));
}


function resolveExpectedDateFromWater(water = {}, fallbackDate = EXPECTED_DATE) {
  const targetDate = compactDate(
    water.expectedDate
    || water.scannerTargetDate
    || water.scannerTargetTradeDate
    || water.marketCalendar?.row?.scannerTargetDate
    || water.marketCalendar?.row?.targetTradeDate
  );
  const displayTradeDate = compactDate(water.marketCalendar?.row?.displayTradeDate || water.displayTradeDate || "");
  const marketOpen = water.marketCalendar?.row?.marketOpen === true
    || water.marketCalendar?.row?.tradingDayOpen === true
    || water.marketCalendar?.marketOpen === true
    || water.marketCalendar?.tradingDayOpen === true;
  const marketClosedPreviousGood = water.marketCalendar?.row?.marketOpen === false
    || water.marketCalendar?.row?.finalMarketOpen === false
    || water.marketCalendar?.row?.preservePreviousGood === true
    || /market_closed|previous_good/.test(String(water.marketCalendar?.row?.displayMode || water.reason || "").toLowerCase());
  const waterReady = water.ok === true && /ready|ok/.test(String(water.status || "").toLowerCase());
  if (targetDate) return targetDate;
  if (displayTradeDate && !REQUIRE_FORMAL_NOW) return displayTradeDate;
  return compactDate(fallbackDate || taipeiDateKey());
}
function moduleRow(row = {}) {
  const scheduleStatus = scheduleStatusForKey(row.key);
  let receipt = normalizeStrategyScanReceipt(row.receipt || {}, { key: row.key, strategy: row.key }) || {};
  const supabase = row.supabase || {};
  const supabaseDate = firstPresent(runDateFromId(supabase.runId), compactDate(supabase.tradeDate || supabase.date || supabase.updatedAt));
  const api = row.live || {};
  const terminal = row.terminalApi || {};
  const desktop = row.desktopSnapshot || {};
  const mobile = row.mobileFragment || {};
  let scorecard = row.scorecard || {};
  receipt = promoteSupabaseCompleteRunReceipt({ key: row.key, receipt, supabase, api, terminal, desktop, mobile, scorecard });
  const runId = firstPresent(api.runId, terminal.runId, supabase.runId, receipt.runId, desktop.runId, mobile.runId, scorecard.runId);
  const tradeDate = firstPresent(
    runDateFromId(runId),
    runDateFromId(receipt.runId),
    runDateFromId(supabase.runId),
    compactDate(api.tradeDate || api.date),
    compactDate(terminal.tradeDate || terminal.date),
    compactDate(supabase.tradeDate || supabase.date || supabase.updatedAt),
  );
  const sourceDate = firstPresent(
    compactDate(api.sourceDate || api.marketDate || api.tradeDate || api.date),
    compactDate(terminal.sourceDate || terminal.marketDate || terminal.tradeDate || terminal.date),
    compactDate(supabase.sourceDate || supabase.marketDate || supabase.tradeDate || supabase.date),
    tradeDate,
  );
  let issues = Array.isArray(row.issues) ? [...row.issues] : [];
  const candidateScorecard = scorecardCandidateForKey(row.key);
  const candidateSourceBlocker = scorecardCandidateSourceBlocker(candidateScorecard);
  if (candidateSourceBlocker) addPriorityIssue(issues, candidateSourceBlocker);
  const candidateRunId = candidateScorecard.runId || "";
  const candidateDate = firstPresent(
    runDateFromId(candidateRunId),
    compactDate(candidateScorecard.date || candidateScorecard.tradeDate || candidateScorecard.updatedAt),
  );
  const latestSurfaceRunId = firstPresent(supabase.runId, api.runId, terminal.runId, desktop.runId, receipt.runId, mobile.runId, runId);
  const manifestMarketClosedForCandidate = marketClosedForManifest();
  const expectedCandidateDate = manifestMarketClosedForCandidate
    ? (runDateFromId(latestSurfaceRunId) || candidateDate || EXPECTED_DATE)
    : EXPECTED_DATE;
  const scorecardCandidateCoversLatest = Boolean(
    candidateRunId
      && latestSurfaceRunId
      && candidateRunId === latestSurfaceRunId
      && candidateDate === expectedCandidateDate
      && candidateScorecard.ok !== false
  );
  if (scorecardCandidateCoversLatest) {
    scorecard = { ...scorecard, ...candidateScorecard, prePublishCandidate: true };
    issues = issues.filter((issue) => {
      const text = String(issue || "");
      return !text.startsWith("scorecard /88 row/sourceReport runId != latest pointer")
        && !text.startsWith("scorecard /88 row/sourceReport missing runId")
        && !text.startsWith("scorecard /88 row/sourceReport missing for")
        && !text.startsWith("scorecard88_live_readback_failed:")
        && !text.startsWith("scorecard candidate source_quality_fail")
        && !/authenticated_readback_not_verified|authenticated readback not verified/i.test(text);
    });
  } else if (scorecardDeferredForStrategy2Intraday(row.key, latestSurfaceRunId, scorecard)) {
    scorecard = {
      ...scorecard,
      runId: "",
      intradayDeferred: true,
      deferredReason: "strategy2_live_scorecard_publish_deferred_until_afternoon",
    };
    issues = issues.filter((issue) => !/^scorecard \/88 row\/sourceReport (?:runId != latest pointer|missing runId|missing for)/.test(String(issue || "")));
  }
  const protectedReadbackBlocked = isMembershipGateSurface(api)
    || isMembershipGateSurface(terminal)
    || isMembershipGateSurface(mobile)
    || isMembershipGateSurface(scorecard)
    || issues.some((issue) => /authenticated readback|required|membership/i.test(String(issue || "")));
  const nonReceiptRunIds = [supabase.runId, api.runId, terminal.runId, desktop.runId, mobile.runId, scorecard.runId].filter(Boolean);
  const uniqueNonReceiptRunIds = [...new Set(nonReceiptRunIds)];
  const rawFallback = scorecardCandidateCoversLatest
    ? false
    : (bool(receipt.fallback)
      || receipt.preservePreviousGood === true
      || api.fallbackUsed === true
      || terminal.fallbackUsed === true
      || desktop.fallbackUsed === true
      || scorecard.fallbackUsed === true
      || String(api.cacheSource || terminal.cacheSource || desktop.cacheSource || scorecard.cacheSource || "").includes("fallback"));
  const fallback = protectedReadbackBlocked && desktop.runId && desktop.count > 0
    ? false
    : rawFallback;
  const effectiveEvidenceStatus = scorecardCandidateCoversLatest && scorecard.evidenceStatus
    ? scorecard.evidenceStatus
    : firstPresent(receipt.evidenceStatus, api.evidenceStatus, terminal.evidenceStatus, desktop.evidenceStatus, scorecard.evidenceStatus, "");
  const effectivePublishAllowed = receipt.publishAllowed === true || api.publishAllowed === true || terminal.publishAllowed === true || desktop.publishAllowed === true || scorecard.publishAllowed === true;
  const rawPreservePreviousGood = receipt.preservePreviousGood === true || api.preservePreviousGood === true || terminal.preservePreviousGood === true || desktop.preservePreviousGood === true;
  const formalCompleteSurfaceAligned = Boolean(
    effectivePublishAllowed === true
    && effectiveEvidenceStatus === "complete"
    && fallback !== true
    && runId
    && runDateFromId(runId) === EXPECTED_DATE
    && tradeDate === EXPECTED_DATE
    && sourceDate === EXPECTED_DATE
    && [receipt.runId, supabase.runId, api.runId, terminal.runId, desktop.runId, mobile.runId, scorecard.runId]
      .filter(Boolean)
      .every((value) => value === runId)
  );
  const preservePreviousGood = rawPreservePreviousGood === true && formalCompleteSurfaceAligned !== true;
  let complete = receipt.complete === true
    && receipt.status === "complete"
    && receipt.evidenceStatus === "complete"
    && effectivePublishAllowed === true
    && preservePreviousGood !== true
    && !fallback
    && (row.ok === true || scorecardCandidateCoversLatest === true)
    && runId
    && tradeDate === EXPECTED_DATE
    && sourceDate === EXPECTED_DATE;
  const runIds = {
    scanner: receipt.runId || "",
    supabase: supabase.runId || "",
    productionApi: api.runId || terminal.runId || "",
    desktop: desktop.runId || terminal.runId || "",
    mobile: mobile.runId || "",
    scorecard88: scorecard.runId || "",
    sourceReports: scorecard.runId || "",
  };
  const runIdValues = Object.values(runIds).filter(Boolean);
  const uniqueRunIds = [...new Set(runIdValues)];
  const runIdSurfaces = [
    { ...receipt, runId: runIds.scanner, count: receipt.matches, ok: receipt.complete === true && receipt.status === "complete" },
    { ...supabase, runId: runIds.supabase, count: supabase.count, ok: supabase.ok !== false },
    { ...api, runId: api.runId, count: api.count || api.returnedCount, ok: api.ok !== false },
    { ...terminal, runId: terminal.runId, count: terminal.count || terminal.returnedCount, ok: terminal.ok !== false },
    { ...desktop, runId: desktop.runId, count: desktop.count || desktop.returnedCount, ok: desktop.ok !== false },
    { ...mobile, runId: mobile.runId, count: mobile.count || mobile.returnedCount, ok: mobile.ok !== false },
    { ...scorecard, runId: scorecard.runId, count: scorecard.count || scorecard.returnedCount, ok: scorecard.ok !== false },
    { ...scorecard, runId: runIds.sourceReports, count: scorecard.count || scorecard.returnedCount, ok: scorecard.ok !== false, surface: "sourceReports" },
  ];
  const rollingRunIdDriftAllowed = strategy2RollingRunIdsAllowed(row.key, uniqueRunIds, runIdSurfaces);
  const marketClosed = marketClosedForManifest();
  const pendingNotDue = marketClosed ? false : scheduleStatus.pendingNotDue === true;
  const strategy2LiveRollingAllowed = Boolean(row.key === "strategy2" && !pendingNotDue && !marketClosed && rollingRunIdDriftAllowed === true);
  if (strategy2LiveRollingAllowed) {
    issues = issues.filter((issue) => {
      const text = String(issue || "");
      return !/scanner receipt runId != Supabase latest/i.test(text)
        && !/live API != (?:desktop artifact|mobile fragment) runId/i.test(text)
        && !/^manifest_runId_mismatch:/i.test(text);
    });
  }
  if (!pendingNotDue && !marketClosed && uniqueRunIds.length > 1 && !rollingRunIdDriftAllowed) addUniqueIssue(issues, `manifest_runId_mismatch:${uniqueRunIds.join(",")}`);
  if (!pendingNotDue && !marketClosed && !runId) addUniqueIssue(issues, "manifest_missing_runId");
  if (!pendingNotDue && !marketClosed && tradeDate !== EXPECTED_DATE) addUniqueIssue(issues, `manifest_tradeDate_mismatch:${tradeDate || "missing"}!=${EXPECTED_DATE}`);
  if (!pendingNotDue && !marketClosed && sourceDate !== EXPECTED_DATE) addUniqueIssue(issues, `manifest_sourceDate_mismatch:${sourceDate || "missing"}!=${EXPECTED_DATE}`);
  if (!pendingNotDue && !marketClosed && fallback) addUniqueIssue(issues, "manifest_fallback_true");
  if (!pendingNotDue && !marketClosed && rawFallback) addUniqueIssue(issues, "manifest_raw_fallback_true");
  if (!pendingNotDue && !marketClosed && (receipt.status !== "complete" || receipt.complete !== true)) addUniqueIssue(issues, `manifest_scanner_not_complete:${receipt.status || "missing"}`);
  if (!pendingNotDue && !marketClosed && effectiveEvidenceStatus !== "complete") addUniqueIssue(issues, `manifest_evidence_not_complete:${effectiveEvidenceStatus || "missing"}`);
  if (!pendingNotDue && !marketClosed && effectivePublishAllowed !== true) addUniqueIssue(issues, "manifest_publish_not_allowed");
  if (!pendingNotDue && !marketClosed && preservePreviousGood === true) addUniqueIssue(issues, "manifest_preserve_previous_good_true");
  const liveClosure = liveResourceChainAuditForKey(row.key);
  let scorecard88LiveReadbackOk = false;
  let scorecard88Protection = scorecard.membershipProtected
    ? "membership-protected"
    : scorecard.runId
      ? "readback"
      : "not-read";
  if (pendingNotDue) {
    scorecard88Protection = scorecard.runId ? "pending-not-due" : "pending-not-due-not-read";
  } else if (marketClosed) {
    scorecard88Protection = scorecard.runId ? "market-closed-previous-good" : "market-closed-not-run";
  } else if (scorecardCandidateCoversLatest) {
    scorecard88LiveReadbackOk = true;
    scorecard88Protection = "pre-publish-scorecard-candidate-ready";
  } else {
    scorecard88LiveReadbackOk = liveClosure.ok === true;
    scorecard88Protection = scorecard88LiveReadbackOk
      ? "authenticated-live-readback"
      : (liveClosure.authenticated ? "authenticated-live-readback-failed" : "authenticated-live-readback-not-verified");
    if (!scorecard88LiveReadbackOk) {
      addUniqueIssue(issues, "scorecard88_live_readback_failed:" + (liveClosure.reason || "not_verified"));
    }
  }
  complete = complete && marketClosed !== true && scorecard88LiveReadbackOk === true;
  if (strategy2LiveRollingAllowed) {
    const latestRollingRunId = firstPresent(supabase.runId, api.runId, terminal.runId, desktop.runId, mobile.runId, runId);
    const strategy2LiveRollingComplete = Boolean(
      receipt.complete === true
      && receipt.status === "complete"
      && effectiveEvidenceStatus === "complete"
      && effectivePublishAllowed === true
      && fallback !== true
      && rawFallback !== true
      && preservePreviousGood !== true
      && latestRollingRunId
      && runDateFromId(latestRollingRunId) === EXPECTED_DATE
      && tradeDate === EXPECTED_DATE
      && sourceDate === EXPECTED_DATE
      && scorecard88LiveReadbackOk === true
    );
    if (strategy2LiveRollingComplete) complete = true;
  }
  const resolvedResultCount = Number(protectedReadbackBlocked
    ? firstPresent(desktop.count, desktop.returnedCount, supabase.count, receipt.matches, api.count, terminal.count, 0)
    : firstPresent(api.count, terminal.count, desktop.count, supabase.count, receipt.matches, 0)) || 0;
  const todayAuthoritative = Boolean(
    complete === true
    && runId
    && runDateFromId(runId) === EXPECTED_DATE
    && tradeDate === EXPECTED_DATE
    && sourceDate === EXPECTED_DATE
    && fallback !== true
    && rawFallback !== true
    && preservePreviousGood !== true
    && scorecard88LiveReadbackOk === true
  );
  const formalDisplayAllowed = todayAuthoritative === true;
  const displayMode = pendingNotDue
    ? "PENDING_NOT_DUE"
    : todayAuthoritative
      ? (resolvedResultCount === 0 ? "TODAY_ZERO_RESULT_COMPLETE" : "TODAY_COMPLETE")
      : (preservePreviousGood || fallback || rawFallback || marketClosed
        ? "PREVIOUS_GOOD_DEGRADED"
        : (protectedReadbackBlocked ? "PROTECTED_READBACK_BLOCKED" : "BLOCKED_NOT_AUTHORITATIVE"));
  const displayBlockReason = formalDisplayAllowed
    ? ""
    : (pendingNotDue
      ? `pending_not_due:${scheduleStatus.dueTime}`
      : (issues[0] || (marketClosed ? "market_closed_previous_good_not_today_success" : "today_authoritative_false")));
  if (!pendingNotDue && !marketClosed && formalDisplayAllowed !== true) addUniqueIssue(issues, `formal_display_blocked:${displayBlockReason}`);
  const moduleStatus = pendingNotDue
    ? "pending"
    : todayAuthoritative
      ? (resolvedResultCount === 0 ? "0-result" : "complete")
      : (preservePreviousGood || fallback || rawFallback || marketClosed ? "degraded" : (resolvedResultCount === 0 ? "empty" : "blocked"));
  return {
    key: row.key,
    label: row.label,
    runId,
    tradeDate,
    sourceDate,
    complete,
    fallback,
    rawFallback,
    evidenceStatus: effectiveEvidenceStatus,
    publishAllowed: effectivePublishAllowed,
    resultCount: resolvedResultCount,
    moduleStatus,
    todayAuthoritative,
    formalDisplayAllowed,
    displayMode,
    displayBlockReason,
    readbackCount: Number(protectedReadbackBlocked
      ? firstPresent(desktop.readbackCount, desktop.returnedCount, desktop.count, terminal.readbackCount, api.readbackCount, 0)
      : firstPresent(api.readbackCount, terminal.readbackCount, desktop.readbackCount, 0)) || 0,
    runIds,
    scorecard88Protection,
    scorecard88LiveReadbackOk,
    protectedReadbackBlocked,
    scheduleStatus,
    pendingNotDue,
    status: pendingNotDue ? "PENDING_NOT_DUE" : (marketClosed ? "MARKET_CLOSED_PREVIOUS_GOOD_HOLD" : ((issues.length === 0 && complete) ? "CLOSED" : "BLOCKED")),
    ok: (pendingNotDue || marketClosed) ? true : (issues.length === 0 && complete),
    issues: pendingNotDue ? [`pending_not_due:${scheduleStatus.dueTime}`] : (marketClosed ? ["market_closed_previous_good_hold"] : issues),
  };
}

function markdown(manifest) {
  const lines = [];
  lines.push("# Daily Terminal Run Manifest");
  lines.push("");
  lines.push(`- checkedAt: ${manifest.checkedAt}`);
  lines.push(`- tradeDate: ${manifest.tradeDate}`);
  lines.push(`- unattendedStatus: ${manifest.unattendedStatus}`);
  lines.push(`- ok: ${manifest.ok}`);
  lines.push(`- blocker: ${manifest.blocker || "--"}`);
  lines.push(`- finalDecision: ${manifest.finalDecision || "--"}`);
  lines.push(`- natural0700 / natural0845 / natural0900: ${manifest.natural0700} / ${manifest.natural0845} / ${manifest.natural0900}`);
  lines.push(`- selfHealRecovered / preservePreviousGood: ${manifest.selfHealRecovered} / ${manifest.preservePreviousGood}`);
  lines.push("");
  lines.push("| module | moduleStatus | displayMode | formalDisplayAllowed | runId | tradeDate | sourceDate | complete | fallback | resultCount | API/Desktop/Mobile/88 | issues |");
  lines.push("|---|---|---|---:|---|---|---|---:|---:|---:|---|---|");
  for (const row of manifest.modules) {
    lines.push(`| ${row.label || row.key} | ${row.moduleStatus || "blocked"} | ${row.displayMode || "--"} | ${row.formalDisplayAllowed === true} | ${row.runId || "--"} | ${row.tradeDate || "--"} | ${row.sourceDate || "--"} | ${row.complete} | ${row.fallback} | ${row.resultCount} | api=${row.runIds.productionApi || "--"}<br>desktop=${row.runIds.desktop || "--"}<br>mobile=${row.runIds.mobile || "--"}<br>/88=${row.runIds.scorecard88 || row.scorecard88Protection || "--"}<br>sourceReports=${row.runIds.sourceReports || "--"} | ${row.issues.join("<br>") || "OK"} |`);
  }
  return lines.join("\\n");
}

async function main() {
  if (SELF_TEST_SCHEDULE) {
    const payload = selfTestScheduleTransitions();
    console.log(JSON.stringify(payload, null, 2));
    if (!payload.ok) process.exitCode = 1;
    return;
  }
  await fs.promises.mkdir(OUT_DIR, { recursive: true });
  const commands = [];
  if (!SKIP_RUN) {
    const waterArgs = [
      "--use-system-ca",
      "scripts/verify-terminal-water-root.js",
      `--expected-date=${EXPECTED_DATE}`,
      "--out=outputs/terminal-water-root",
    ];
    if (REQUIRE_FORMAL_NOW) waterArgs.push("--require-formal-now");
    commands.push(runNode(waterArgs, "terminal-water-root"));
    const waterAfterRoot = readJson(path.join(ROOT, "outputs", "terminal-water-root", "terminal-water-root.json"), {});
    if (!EXPECTED_DATE_EXPLICIT) EXPECTED_DATE = resolveExpectedDateFromWater(waterAfterRoot, EXPECTED_DATE);
    // A closed market only holds the last good result. Do not spend the
    // manifest stage on authenticated/live closure queries off-session.
    const marketClosedBeforeChain = marketClosedForManifest();
    if (marketClosedBeforeChain) {
      commands.push({
        label: "terminal-resource-chain:unattended",
        command: "not-run",
        exitCode: 0,
        ok: true,
        required: false,
        skipped: true,
        reason: "market_closed_previous_good",
      });
    } else {
      commands.push(runNode([
        "--use-system-ca",
        "scripts/verify-terminal-resource-chain.js",
        "--require-unattended",
        `--expected-date=${EXPECTED_DATE}`,
        "--out=outputs/terminal-resource-chain-audit",
      ], "terminal-resource-chain:unattended"));
    }
  }

  const water = readJson(path.join(ROOT, "outputs", "terminal-water-root", "terminal-water-root.json"), {});
  if (!EXPECTED_DATE_EXPLICIT) EXPECTED_DATE = resolveExpectedDateFromWater(water, EXPECTED_DATE);
  const marketClosed = water.marketCalendar?.row?.marketOpen === false
    || water.marketCalendar?.row?.finalMarketOpen === false
    || water.marketCalendar?.row?.tradingDayOpen === false
    || marketClosedForManifest();
  const chainAuditFile = path.join(ROOT, "outputs", "terminal-resource-chain-audit", "terminal-resource-chain-audit.json");
  const chain = readJson(chainAuditFile, {});
  if (SKIP_RUN) {
    const chainAuth = chain.protectedReadbackAuth || {};
    const chainReadbackOk = chain.ok === true
      && compactDate(chain.expectedDate) === EXPECTED_DATE
      && chainAuth.enabled === true
      && chainAuth.attempted === true
      && Number(chainAuth.status) === 200;
    commands.push(marketClosed ? {
      label: "terminal-resource-chain:unattended",
      command: "read_existing_authenticated_audit_skipped",
      exitCode: 0,
      ok: true,
      required: false,
      skipped: true,
      reason: "market_closed_previous_good",
      source: "market_closed_policy",
      expectedDate: EXPECTED_DATE,
    } : {
      label: "terminal-resource-chain:unattended",
      command: "read_existing_authenticated_audit",
      exitCode: chainReadbackOk ? 0 : 1,
      ok: chainReadbackOk,
      source: "existing_authenticated_resource_chain_audit",
      expectedDate: compactDate(chain.expectedDate),
      protectedReadbackAuth: {
        enabled: chainAuth.enabled === true,
        attempted: chainAuth.attempted === true,
        status: Number(chainAuth.status || 0),
      },
    });
  }
  const resourceChainModuleKeys = new Set(ACTIVE_MODULE_REGISTRY.active
    .filter((row) => ["strategy", "chip"].includes(String(row.class || "")))
    .map((row) => row.key));
  const activeModuleKeys = new Set(ACTIVE_MODULE_REGISTRY.active.map((row) => row.key));
  let modules = Array.isArray(chain.results)
    ? chain.results.filter((row) => resourceChainModuleKeys.has(row.key)).map(moduleRow)
    : [];
  const chainAuditExists = fs.existsSync(chainAuditFile);
  const chainAuditMaterialized = Array.isArray(chain.results);
  const resourceChainModulesMaterialized = chainAuditMaterialized && modules.length > 0;
  if (!marketClosed && modules.length === 0 && resourceChainModuleKeys.size > 0) {
    const missingReason = chainAuditExists && !chainAuditMaterialized
      ? "resource_chain_audit_unreadable_or_invalid_json"
      : "resource_chain_missing_module_result";
    modules = ACTIVE_MODULE_REGISTRY.active
      .filter((row) => resourceChainModuleKeys.has(row.key))
      .map((row) => {
        const scheduleStatus = scheduleStatusForKey(row.key);
        return {
          key: row.key,
          label: row.label || row.key,
          runId: "",
          tradeDate: "",
          sourceDate: "",
          complete: false,
          fallback: false,
          rawFallback: false,
          evidenceStatus: "insufficient",
          publishAllowed: false,
          resultCount: 0,
          moduleStatus: "blocked",
          todayAuthoritative: false,
          formalDisplayAllowed: false,
          displayMode: "BLOCKED_NOT_AUTHORITATIVE",
          displayBlockReason: missingReason,
          readbackCount: 0,
          runIds: {},
          scorecard88Protection: "not-read",
          scorecard88LiveReadbackOk: false,
          protectedReadbackBlocked: false,
          scheduleStatus,
          pendingNotDue: false,
          status: "BLOCKED",
          ok: false,
          issues: [missingReason],
        };
      });
  }
  const warmupEvidence = warmupEvidenceForDate(EXPECTED_DATE);


  const modulesAllTodayAuthoritative = modules.length > 0 && modules.every((row) => row.todayAuthoritative === true || row.pendingNotDue === true);
  const warmupFailureChecks = [];
  if (!marketClosed && !modulesAllTodayAuthoritative) {
    if (!warmupEvidence.exists) warmupFailureChecks.push("warmup_final_verdict_missing");
    if (!warmupEvidence.dateAligned) warmupFailureChecks.push(`warmup_tradeDate_mismatch:${warmupEvidence.tradeDate || "missing"}!=${EXPECTED_DATE}`);
    for (const phase of ["0700", "0845", "0900"]) {
      if (warmupEvidence.naturalScheduleEvidenceByPhase[phase] !== true) warmupFailureChecks.push(`warmup_${phase}_natural_evidence_missing`);
      if (warmupEvidence.phaseEvidence[phase]?.pass !== true) warmupFailureChecks.push(`warmup_${phase}_not_green`);
    }
  }
  const issues = [];
  if (!marketClosed && !resourceChainModulesMaterialized && resourceChainModuleKeys.size > 0) issues.push("manifest_module_registry_not_materialized");
  for (const check of warmupFailureChecks) issues.push(check);
  if (!marketClosed && !modulesAllTodayAuthoritative) {
    for (const check of warmupEvidence.failedChecks) addUniqueIssue(issues, `warmup:${check}`);
  }
  for (const key of resourceChainModuleKeys) {
    if (!modules.some((row) => row.key === key)) issues.push(`active_module_missing_from_resource_chain:${key}`);
  }
  const softWaterRootIssue = isSoftWaterRootIssue(water);
  const waterRootIssue = !water.ok ? `water_root:${water.reason || "not_ready"}` : "";
  if (waterRootIssue && !softWaterRootIssue) issues.push(waterRootIssue);
  for (const command of commands.filter((item) => !item.ok)) issues.push(`${command.label}_exit_${command.exitCode}`);
  for (const row of modules.filter((item) => !item.ok)) issues.push(`${row.key}:${row.issues[0] || "not_ok"}`);
  if (!marketClosed && !chain.ok) issues.push("terminal_resource_chain_unattended_failed");
  const scorecardPrepublishCovered = SCORECARD_PUBLISH_MODE
    && modules.length > 0
    && modules.every((row) => row.ok === true || row.pendingNotDue === true);
  if (scorecardPrepublishCovered) {
    for (let index = issues.length - 1; index >= 0; index -= 1) {
      if (/^(terminal-resource-chain:unattended_exit_\d+|terminal_resource_chain_unattended_failed)$/.test(String(issues[index] || ""))) {
        issues.splice(index, 1);
      }
    }
  }
  const pendingModules = modules.filter((item) => item.pendingNotDue === true);
  const allModulesTodayClosed = modules.length > 0 && modules.every((row) => row.todayAuthoritative === true || row.pendingNotDue === true);
  const previousGoodHold = issues.length === 0 && pendingModules.length === 0 && isPreviousGoodHoldWaterRoot(water) && !allModulesTodayClosed;
  const waitingSourceWindow = issues.length === 0 && pendingModules.length > 0;
  const manifestCheckedAt = new Date().toISOString();
  const manifestRunId = `daily-terminal-manifest-${EXPECTED_DATE}-${manifestCheckedAt.replace(/\D/g, '').slice(0, 14)}`;
  const rootDailyRunId = resolveRootDailyRunId(EXPECTED_DATE) || manifestRunId;
  const sourceStatus = water.sourceStatus?.summary || null;
  const canonicalGate = water.canonicalGate?.summary || null;
  const preservePreviousGood = previousGoodHold || modules.some((row) => row.preservePreviousGood === true || row.fallback === true) || (warmupEvidence.preservePreviousGood === true && !allModulesTodayClosed);
  const moduleClosureComplete = issues.length === 0 && pendingModules.length === 0 && !previousGoodHold && allModulesTodayClosed;
  const naturalSuccess = issues.length === 0 && pendingModules.length === 0 && !previousGoodHold && warmupEvidence.naturalSuccess === true;
  const closureComplete = naturalSuccess || moduleClosureComplete;
  const selfHealModules = modules
    .filter((row) => row.selfHealRecovered === true || row.selfHeal === true || row.receipt?.selfHealRecovered === true)
    .map((row) => ({ key: row.key, runId: row.runId || '', selfHealRecovered: true }));
  const selfHealRecovered = selfHealModules.length > 0 || water.sourceStatus?.summary?.selfHealRecovered === true;
  const releaseShaResult = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  const releaseSha = String(process.env.FUMAN_RELEASE_SHA || process.env.VERCEL_GIT_COMMIT_SHA || (releaseShaResult.status === 0 ? releaseShaResult.stdout : '')).trim();
  const releaseStatusResult = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
  const releaseWorktreeClean = releaseStatusResult.status === 0 && !String(releaseStatusResult.stdout || '').trim();
  const deployId = String(process.env.FUMAN_DEPLOY_ID || process.env.VERCEL_DEPLOYMENT_ID || '').trim();
  const manifest = {
    contract: "daily-terminal-run-manifest-v1",
    checkedAt: manifestCheckedAt,
    phase: marketClosed ? 'market_closed' : String(canonicalGate?.phase || sourceStatus?.phase || 'terminal_run'),
    runId: manifestRunId,
    daily_run_id: rootDailyRunId,
    manifestRunId,
    runIdScope: 'manifest_artifact_identity; dailyRunId is the root orchestrator identity; moduleRunIds are authoritative for closure',
    moduleRunIds: Object.fromEntries(modules.map((row) => [row.key, row.runId || ''])),
    moduleRegistryContract: ACTIVE_MODULE_REGISTRY.contract,
    moduleRegistryVersion: ACTIVE_MODULE_REGISTRY.version,
    activeModules: ACTIVE_MODULE_REGISTRY.active.map((row) => row.key),
    resourceChainModules: [...resourceChainModuleKeys],
    retiredModules: ACTIVE_MODULE_REGISTRY.retired.map((row) => row.key),
    dailyRunId: rootDailyRunId,
    sourceStatus,
    sourceGrade: String(canonicalGate?.canonicalGateGrade || sourceStatus?.daytradeGateGrade || sourceStatus?.status || ''),
    gateGrade: String(canonicalGate?.canonicalGateGrade || sourceStatus?.daytradeGateGrade || ''),
    failedChecks: issues,
    moduleStatuses: Object.fromEntries(modules.map((row) => [row.key, row.moduleStatus || 'blocked'])),
    selfHealEvidence: { recovered: selfHealRecovered, modules: selfHealModules },
    natural0700: warmupEvidence.naturalScheduleEvidenceByPhase['0700'] === true && warmupEvidence.phaseEvidence['0700']?.pass === true,
    natural0845: warmupEvidence.naturalScheduleEvidenceByPhase['0845'] === true && warmupEvidence.phaseEvidence['0845']?.pass === true,
    natural0900: warmupEvidence.naturalScheduleEvidenceByPhase['0900'] === true && warmupEvidence.phaseEvidence['0900']?.pass === true,
    naturalScheduleEvidenceByPhase: warmupEvidence.naturalScheduleEvidenceByPhase,
    warmupFinalDecision: warmupEvidence.finalDecision,
    warmupEvidenceFile: warmupEvidence.file,
    finalDecision: naturalSuccess ? 'UNATTENDED_YES' : (moduleClosureComplete ? 'RECOVERED_CLOSURE_COMPLETE_NOT_NATURAL' : (waitingSourceWindow ? 'WAITING_SOURCE_WINDOW' : (preservePreviousGood ? 'PRESERVE_PREVIOUS_GOOD' : (selfHealRecovered ? 'RECOVERED_NOT_NATURAL' : 'FAIL_CLOSED')))),
    publishDecision: closureComplete ? 'ALLOW_TODAY_FORMAL_PUBLISH' : (preservePreviousGood ? 'PRESERVE_PREVIOUS_GOOD' : 'BLOCK_LATEST'),
    closureStatus: closureComplete ? 'CLOSED' : (waitingSourceWindow ? 'PENDING_NOT_DUE' : (preservePreviousGood ? 'PREVIOUS_GOOD_HOLD' : 'BLOCKED')),
    naturalSuccess,
    selfHealRecovered,
    preservePreviousGood,
    releaseSha,
    deployId,
    verifierVersion: 'daily-terminal-run-manifest-v1',
    releaseWorktreeClean,
    requestedDate: REQUESTED_DATE,
    tradeDate: EXPECTED_DATE,
    warmupEvidence: {
      tradeDate: warmupEvidence.tradeDate,
      dateAligned: warmupEvidence.dateAligned,
      naturalScheduleEvidenceByPhase: warmupEvidence.naturalScheduleEvidenceByPhase,
      naturalSuccess: warmupEvidence.naturalSuccess,
      selfHealRecovered: warmupEvidence.selfHealRecovered,
      preservePreviousGood: warmupEvidence.preservePreviousGood,
      finalDecision: warmupEvidence.finalDecision,
      policyDecision: warmupEvidence.policyDecision,
      runId: warmupEvidence.runId,
      failedChecks: warmupEvidence.failedChecks,
      file: warmupEvidence.file,
    },
    waterRoot: {
      ok: water.ok === true,
      status: water.status || "",
      reason: water.reason || "",
      sourceStatus: water.sourceStatus?.summary || null,
      canonicalGate: water.canonicalGate?.summary || null,
      previousGoodHold,
      softIssueIgnored: softWaterRootIssue ? waterRootIssue : "",
    },
    commands,
    modules,
    pendingModules: pendingModules.map((row) => ({ key: row.key, dueTime: row.scheduleStatus?.dueTime || "", runId: row.runId || "" })),
    ok: issues.length === 0,
    previousGoodHold,
    freshUnattended: naturalSuccess,
    unattendedStatus: naturalSuccess ? 'YES' : (moduleClosureComplete ? 'RECOVERED_NOT_NATURAL' : (waitingSourceWindow ? 'WAITING_SOURCE_WINDOW' : (preservePreviousGood ? 'PREVIOUS_GOOD_HOLD' : 'NO'))),
    blocker: issues[0] || (pendingModules.length ? `pending_not_due:${pendingModules.map((row) => `${row.key}@${row.scheduleStatus?.dueTime || ""}`).join(",")}` : ""),
    issues,
  };
  const dateFile = path.join(OUT_DIR, `daily-terminal-run-${EXPECTED_DATE}.json`);
  const latestFile = path.join(OUT_DIR, "daily-terminal-run-latest.json");
  const mdFile = path.join(OUT_DIR, `daily-terminal-run-${EXPECTED_DATE}.md`);
  await fs.promises.writeFile(dateFile, JSON.stringify(manifest, null, 2));
  await fs.promises.writeFile(latestFile, JSON.stringify(manifest, null, 2));
  await fs.promises.writeFile(mdFile, markdown(manifest));
  console.log(JSON.stringify({
    ok: manifest.ok,
    unattendedStatus: manifest.unattendedStatus,
    tradeDate: manifest.tradeDate,
    blocker: manifest.blocker,
    modules: manifest.modules.map((row) => ({ key: row.key, ok: row.ok, runId: row.runId, issue: row.issues[0] || "" })),
    output: latestFile,
  }, null, 2));
  if (issues.length > 0 && !ALLOW_NON_GREEN_EXIT_ZERO) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[daily-terminal-run-manifest] failed: ${error.stack || error.message || error}`);
  process.exit(1);
});











