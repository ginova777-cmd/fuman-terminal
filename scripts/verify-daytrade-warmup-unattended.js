"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");
const { isTwseTradingDay } = require("./twse-trading-day");

const ROOT = process.env.FUMAN_ROOT || "C:/fuman-terminal";
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const OUT_DIR = path.join(RUNTIME_DIR, "state");
const PROD_OUT_DIR = process.env.DAYTRADE_UNATTENDED_OUTPUT_DIR || "C:/Users/ginov/Documents/Codex/buy-sell-autonomy-main/outputs";
const SOURCE_NAME = "fugle_daytrade_source";
const PHASES = ["0700", "0845", "0900"];
const PHASE_DUE_MINUTES = { "0700": 7 * 60, "0845": 8 * 60 + 45, "0900": 9 * 60 };
const PRIORITY_LIMIT = 40;
const MIN_PRIORITY_COVERAGE = 0.95;
const WRITER_BUILD = "daytrade-warmup-unattended-hard-gate-20260720-03";

function taipeiDateParts(date = new Date()) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date).map((part) => [part.type, part.value]));
}

function taipeiTradeDate(date = new Date()) {
  const parts = taipeiDateParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function compactTradeDate(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function taipeiMinuteOfDay(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return num(parts.hour) * 60 + num(parts.minute);
}

function phaseNotDueYet(phase, tradeDate, now = new Date()) {
  if (compactTradeDate(tradeDate) !== compactTradeDate(taipeiTradeDate(now))) return false;
  const dueMinute = PHASE_DUE_MINUTES[phase];
  return Number.isFinite(dueMinute) && taipeiMinuteOfDay(now) < dueMinute;
}

function argValue(name, fallback = "") {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function readJson(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return { ...fallback, __read_error: error.message };
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function hasAny(row, names) {
  return names.some((name) => Object.prototype.hasOwnProperty.call(row, name) && row[name] !== null && row[name] !== undefined);
}

function valueOf(row, ...names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(row, name) && row[name] !== null && row[name] !== undefined) return row[name];
  }
  return undefined;
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function bool(value) {
  return value === true || String(value).toLowerCase() === "true";
}

function issuesOf(row) {
  const issues = valueOf(row, "issues", "failed_checks");
  return Array.isArray(issues) ? issues : [];
}

function currentCommitSha() {
  const envSha = process.env.FUMAN_RELEASE_SHA || process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || process.env.COMMIT_SHA;
  if (envSha) return envSha;
  try {
    const result = spawnSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8", timeout: 5000, windowsHide: true });
    const sha = String(result.stdout || "").trim();
    if (result.status === 0 && sha) return sha;
  } catch {}
  return "unknown";
}

function writerFingerprint(row = {}) {
  return {
    writer_build: valueOf(row, "writer_build") || WRITER_BUILD,
    commit_sha: valueOf(row, "commit_sha") || currentCommitSha(),
    hostname: valueOf(row, "hostname") || os.hostname(),
    pid: valueOf(row, "pid") || process.pid,
  };
}

function failureCode(failure) {
  const text = String(failure || "");
  if (text.startsWith("task_missed:")) return `TASK_MISSED_${text.split(":")[1] || "UNKNOWN"}`.toUpperCase();
  if (text.includes("natural_schedule_evidence")) return "MISSING_NATURAL_SCHEDULE_EVIDENCE";
  if (text.includes("manual_verification_only")) return "MANUAL_VERIFICATION_ONLY";
  if (text.includes("priorityPoolSymbols") || text.includes("priority_pool_symbols")) return "PRIORITY_POOL_NOT_40";
  if (text.includes("priorityFreshQuoteCoverage120s") || text.includes("priority_fresh_quote_coverage_120s") || text.includes("fresh_quotes_120s_or_priority_ready")) return "PRIORITY_COVERAGE_LT_095";
  if (text.includes("scannerCanRunOpening") || text.includes("scanner_can_run_opening")) return "SCANNER_OPENING_FALSE";
  if (text.includes("formalEntrySpeedVerdict") || text.includes("formal_entry_speed_verdict")) return "FORMAL_VERDICT_NO";
  if (text.includes("quoteAgeSeconds") || text.includes("quote_age_seconds")) return "QUOTE_STALE";
  if (text.includes("intraday_1m") || text.includes("today_1m")) return "INTRADAY_1M_NOT_FRESH";
  if (text.includes("daily_volume_status")) return "DAILY_VOLUME_NOT_READY";
  if (text.includes("issues:") || text.includes("failed_checks")) return "ISSUES_NOT_EMPTY";
  if (text.includes("GateGrade") || text.includes("gate_grade")) return "GATE_NOT_A";
  if (text.includes("missing_or_invalid_artifact")) return "MISSING_OR_INVALID_ARTIFACT";
  return text.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase() || "UNKNOWN_FAILURE";
}

function previousCalendarTradeDate(tradeDate) {
  const ms = Date.parse(`${tradeDate}T00:00:00+08:00`);
  if (!Number.isFinite(ms)) return "";
  const parts = taipeiDateParts(new Date(ms - 24 * 60 * 60 * 1000));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function previousUnattendedYes(tradeDate) {
  const previousDate = previousCalendarTradeDate(tradeDate);
  if (!previousDate) return "UNKNOWN";
  const file = path.join(PROD_OUT_DIR, `daytrade-warmup-unattended-summary-${previousDate.replace(/-/g, "")}.json`);
  const row = readJson(file, {});
  return row.unattended_yes || row.unattendedYes || "UNKNOWN";
}


function nextTaipeiRunAt(hour, minute) {
  const now = new Date();
  const parts = taipeiDateParts(now);
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const candidate = new Date(`${today}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+08:00`);
  if (candidate.getTime() > now.getTime()) return candidate.toISOString();
  return new Date(candidate.getTime() + 24 * 60 * 60 * 1000).toISOString();
}

function phaseArtifact(expectedTradeDate, phase) {
  const compact = compactTradeDate(expectedTradeDate);
  const datedFile = path.join(PROD_OUT_DIR, `daytrade-unattended-gate-${phase}-${compact}.json`);
  const datedRow = readJson(datedFile, { phase });
  if (!datedRow.__read_error) return { file: datedFile, row: datedRow };
  const legacyFile = path.join(PROD_OUT_DIR, `daytrade-unattended-gate-${phase}.json`);
  const legacyRow = readJson(legacyFile, { phase });
  if (!legacyRow.__read_error && compactTradeDate(valueOf(legacyRow, "trade_date", "tradeDate")) === compact) return { file: legacyFile, row: legacyRow };
  const staleDate = compactTradeDate(valueOf(legacyRow, "trade_date", "tradeDate"));
  return { file: datedFile, row: { phase, __read_error: staleDate ? "stale_artifact_trade_date:" + staleDate + ";expected:" + compact : "missing_artifact_expected:" + datedFile } };
}
function buildOpsPolicy({ yes, formalEntryAllowed = false, failedPhase, failureCodes, previousUnattendedYes, selfHeal, selfHealRecovered, pendingPhase = [] }) {
  const uniqueCodes = [...new Set(failureCodes || [])];
  const firstCode = uniqueCodes[0] || null;
  const pending = pendingPhase.length > 0;
  const taskMissed = uniqueCodes.some((code) => String(code).startsWith("TASK_MISSED_"));
  const sourceNotReady = uniqueCodes.some((code) => [
    "PRIORITY_POOL_NOT_40",
    "PRIORITY_COVERAGE_LT_095",
    "QUOTE_STALE",
    "INTRADAY_1M_NOT_FRESH",
    "DAILY_VOLUME_NOT_READY",
    "SCANNER_OPENING_FALSE",
    "FORMAL_VERDICT_NO",
  ].includes(code));
  const rewateredFormal = !yes && formalEntryAllowed;
  const incidentStatus = yes ? "NONE" : (pending ? "PENDING" : (rewateredFormal ? "RECOVERED_NOT_UNATTENDED" : "OPEN"));
  const policyDecision = yes
    ? "ALLOW_FORMAL_SCAN"
    : (rewateredFormal ? "ALLOW_FORMAL_SCAN_REWATERED_NOT_UNATTENDED" : (pending ? "WAIT_FOR_NATURAL_EVIDENCE" : "FAIL_CLOSED_PRESERVE_PREVIOUS_GOOD"));
  const selfHealAction = yes
    ? "NO_ACTION"
    : (rewateredFormal
      ? "REWATER_VERIFIED_WAIT_NATURAL_EVIDENCE"
      : (pending ? "WAIT_FOR_NEXT_NATURAL_PHASE" : (taskMissed ? "QUEUE_TASK_MISSED_DIAGNOSTIC_ONLY_DO_NOT_BACKFILL_NATURAL" : "QUEUE_SOURCE_RECHECK_DO_NOT_BACKFILL_NATURAL")));
  return {
    policy_decision: policyDecision,
    scanner_action: formalEntryAllowed ? "ALLOW_SCANNER_OPENING" : "BLOCK_SCANNER_OPENING",
    publish_action: yes ? "ALLOW_TODAY_FORMAL_PUBLISH" : "PREVIOUS_GOOD_ONLY",
    latest_action: yes ? "ALLOW_LATEST_UPDATE" : "BLOCK_LATEST_UPDATE",
    incident_status: incidentStatus,
    incident_severity: yes || pending || rewateredFormal ? "NONE" : (taskMissed ? "CRITICAL" : "HIGH"),
    incident_reason_code: firstCode,
    incident_reason_codes: uniqueCodes,
    first_failed_phase: failedPhase[0] || null,
    pending_phase: pendingPhase,
    first_pending_phase: pendingPhase[0] || null,
    self_heal_action: selfHealAction,
    self_heal_does_not_count_as_natural: true,
    self_heal_recovered: Boolean(selfHealRecovered),
    next_retry_at: yes ? null : (pending ? nextTaipeiRunAt(Math.floor(PHASE_DUE_MINUTES[pendingPhase[0]] / 60), PHASE_DUE_MINUTES[pendingPhase[0]] % 60) : nextTaipeiRunAt(7, 0)),
    next_retry_policy: yes ? "NONE" : (pending ? "wait for next scheduled natural phase; do not backfill with manual evidence" : "next natural 0700/0845/0900 evidence required; manual retry cannot set unattended YES"),
    owner_message: yes
      ? "當沖暖機三段自然 evidence 全綠，可宣告 unattended YES。"
      : (rewateredFormal
        ? "水源已補水並通過 re-water verification，可進正式掃描；但未補回自然 evidence，仍不可宣告 unattended YES。"
        : (pending ? `當沖暖機等待自然排程：${pendingPhase[0]} 尚未到，不宣告 YES，也不開 incident。` : `當沖暖機 fail-closed：${failedPhase[0] || "unknown"} failed, code=${firstCode || "UNKNOWN"}；preserve previous good, do not enter formal scan.`)),
    previous_unattended_yes: previousUnattendedYes,
    auto_recovered: previousUnattendedYes === "NO" && yes,
    regressed_today: previousUnattendedYes === "YES" && !yes && !pending,
    source_not_ready: sourceNotReady,
    task_missed: taskMissed,
  };
}
function normalizedEvidence(phase, row) {
  return {
    phase,
    checked_at: valueOf(row, "checked_at", "checkedAt"),
    trade_date: valueOf(row, "trade_date", "tradeDate"),
    naturalScheduleEvidence: bool(valueOf(row, "natural_schedule_evidence")) || bool(row.schedule_evidence && row.schedule_evidence.natural_schedule_evidence),
    manualVerificationOnly: bool(valueOf(row, "manual_verification_only")) || bool(row.schedule_evidence && row.schedule_evidence.manual_verification_only),
    daytradeGateGrade: valueOf(row, "daytradeGateGrade", "gate_grade"),
    priorityGateGrade: valueOf(row, "priorityGateGrade", "priority_gate_grade", "gate_grade"),
    priorityPoolSymbols: valueOf(row, "priorityPoolSymbols", "priority_pool_symbols"),
    priorityFreshQuoteCoverage120s: valueOf(row, "priorityFreshQuoteCoverage120s", "priority_fresh_quote_coverage_120s"),
    priorityFreshQuotes120s: valueOf(row, "priorityFreshQuotes120s", "priority_fresh_quotes_120s", "priority_fresh_120s", "fresh_quotes_120s"),
    quoteAgeSeconds: valueOf(row, "quoteAgeSeconds", "quote_age_seconds"),
    scannerCanRunOpening: bool(valueOf(row, "scannerCanRunOpening", "scanner_can_run_opening")),
    formalEntrySpeedVerdict: valueOf(row, "formalEntrySpeedVerdict", "formal_entry_speed_verdict"),
    readyMa20Continuous: valueOf(row, "readyMa20Continuous", "ready_ma20", "ready_ma20_continuous_symbols"),
    readyMa35Continuous: valueOf(row, "readyMa35Continuous", "ready_ma35", "ready_ma35_continuous_symbols"),
    issues: issuesOf(row),
    selfHeal: bool(row.retry_result && row.retry_result.attempted) || num(row.self_heal_count) > 0,
    selfHealRecovered: bool(row.retry_result && row.retry_result.recovered),
    preservePreviousGood: row.preserve_previous_good !== false,
    ...writerFingerprint(row),
  };
}

function phaseFailures(phase, row, tradeDate) {
  const failures = [];
  const evidence = normalizedEvidence(phase, row);
  if (row.__read_error) failures.push(`task_missed:${phase}`);
  if (row.__read_error) failures.push(`missing_or_invalid_artifact:${row.__read_error}`);
  if (evidence.trade_date !== tradeDate) failures.push(`trade_date:${evidence.trade_date || "missing"}`);
  if (!evidence.naturalScheduleEvidence) failures.push("natural_schedule_evidence_missing_or_false");
  if (evidence.manualVerificationOnly) failures.push("manual_verification_only_true");
  if (!hasAny(row, ["daytradeGateGrade", "gate_grade"])) failures.push("daytradeGateGrade_missing");
  if (evidence.daytradeGateGrade !== "A") failures.push(`daytradeGateGrade:${evidence.daytradeGateGrade || "missing"}`);
  if (!hasAny(row, ["priorityGateGrade", "priority_gate_grade", "gate_grade"])) failures.push("priorityGateGrade_missing");
  if (evidence.priorityGateGrade !== "A") failures.push(`priorityGateGrade:${evidence.priorityGateGrade || "missing"}`);
  if (!hasAny(row, ["priorityPoolSymbols", "priority_pool_symbols"])) failures.push("priorityPoolSymbols_missing");
  if (num(evidence.priorityPoolSymbols, -1) !== PRIORITY_LIMIT) failures.push(`priorityPoolSymbols:${evidence.priorityPoolSymbols ?? "missing"}_not_${PRIORITY_LIMIT}`);
  if (!hasAny(row, ["priorityFreshQuoteCoverage120s", "priority_fresh_quote_coverage_120s"])) failures.push("priorityFreshQuoteCoverage120s_missing");
  if (num(evidence.priorityFreshQuoteCoverage120s, -1) < MIN_PRIORITY_COVERAGE) failures.push(`priorityFreshQuoteCoverage120s:${evidence.priorityFreshQuoteCoverage120s ?? "missing"}_lt_${MIN_PRIORITY_COVERAGE}`);
  if (!hasAny(row, ["priorityFreshQuotes120s", "priority_fresh_quotes_120s", "priority_fresh_120s", "fresh_quotes_120s"])) failures.push("priorityFreshQuotes120s_missing");
  if (!hasAny(row, ["quoteAgeSeconds", "quote_age_seconds"])) failures.push("quoteAgeSeconds_missing");
  if (num(evidence.quoteAgeSeconds, 999999) > 90) failures.push("quoteAgeSeconds_gt_90");
  if (!hasAny(row, ["scannerCanRunOpening", "scanner_can_run_opening"])) failures.push("scannerCanRunOpening_missing");
  if (!evidence.scannerCanRunOpening) failures.push("scannerCanRunOpening_false");
  if (!hasAny(row, ["formalEntrySpeedVerdict", "formal_entry_speed_verdict"])) failures.push("formalEntrySpeedVerdict_missing");
  if (evidence.formalEntrySpeedVerdict !== "YES") failures.push(`formalEntrySpeedVerdict:${evidence.formalEntrySpeedVerdict || "missing"}`);
  if (!hasAny(row, ["readyMa20Continuous", "ready_ma20", "ready_ma20_continuous_symbols"])) failures.push("readyMa20Continuous_missing");
  if (!hasAny(row, ["readyMa35Continuous", "ready_ma35", "ready_ma35_continuous_symbols"])) failures.push("readyMa35Continuous_missing");
  if (!Array.isArray(valueOf(row, "issues", "failed_checks"))) failures.push("issues_missing");
  if (evidence.issues.length > 0) failures.push(`issues:${evidence.issues.join(";")}`);
  if (row.active_429_cooldown === true) failures.push("active_429_cooldown_true");
  if (phase === "0900") {
    if (num(row.intraday_1m_stale_seconds, 999999) > 120) failures.push("intraday_1m_stale_seconds_gt_120");
    if (num(row.today_1m_symbols) <= 0) failures.push("today_1m_symbols_lte_0");
    if (row.daily_volume_status !== "ready") failures.push("daily_volume_status_not_ready");
  }
  return { evidence, failures, failure_codes: [...new Set(failures.map(failureCode))] };
}


function secondsSince(value) {
  const ms = Date.parse(value || "");
  if (!Number.isFinite(ms)) return 999999;
  return Math.max(0, Math.floor((Date.now() - ms) / 1000));
}

function readWaterRootRecovery(expectedTradeDate, failedChecks = [], pendingPhase = []) {
  const waterFile = path.join(ROOT, "outputs", "terminal-water-root", "terminal-water-root.json");
  const water = readJson(waterFile, {});
  const checkedAgeSeconds = secondsSince(water.checkedAt);
  const sourceProbe = water.sourceStatus || {};
  const sourceRow = sourceProbe.row || sourceProbe;
  const payload = sourceRow.payload || sourceProbe.payload || {};
  const summary = sourceProbe.summary || {};
  const waterDate = compactTradeDate(water.expectedDate || water.displayTradeDate || water.marketCalendar?.row?.displayTradeDate || water.marketCalendar?.row?.marketDate);
  const expected = compactTradeDate(expectedTradeDate);
  const status = String(water.status || "").toLowerCase();
  const sourceStatus = String(sourceRow.status || sourceProbe.source_status || "").toLowerCase();
  const canonicalRow = water.canonicalGate?.row || {};
  const canonicalSummary = water.canonicalGate?.summary || {};
  const hasCanonicalBoolean = (key, summaryKey) => typeof canonicalRow[key] === "boolean" || typeof canonicalSummary[summaryKey] === "boolean";
  const gate = String(
    canonicalRow.canonical_gate_grade
      || canonicalRow.gate_grade
      || canonicalRow.gate
      || canonicalSummary.canonicalGateGrade
      || water.gate
      || summary.canonicalGateGrade
      || payload.daytrade_gate_grade
      || payload.unattended_gate_grade
      || "",
  ).toUpperCase();
  const formalEntryAllowed = hasCanonicalBoolean("formal_entry_allowed", "formalEntryAllowed")
    ? (typeof canonicalRow.formal_entry_allowed === "boolean" ? canonicalRow.formal_entry_allowed : canonicalSummary.formalEntryAllowed)
    : (water.formalEntryAllowed === true || summary.formalEntryAllowed === true || payload.formal_entry_allowed === true || payload.canonical_formal_entry_allowed === true);
  const scannerCanRunOpening = hasCanonicalBoolean("scanner_can_run_opening", "scannerCanRunOpening")
    ? (typeof canonicalRow.scanner_can_run_opening === "boolean" ? canonicalRow.scanner_can_run_opening : canonicalSummary.scannerCanRunOpening)
    : (water.scannerCanRunOpening === true || summary.scannerCanRunOpening === true || payload.scanner_can_run_opening === true);
  const priorityCoverage = num(water.priorityFreshQuoteCoverage120s ?? summary.priorityFreshQuoteCoverage120s ?? payload.priority_fresh_quote_coverage_120s, -1);
  const quoteAgeSeconds = num(water.quoteAgeSeconds ?? summary.quoteAgeSeconds ?? payload.quote_age_seconds, 999999);
  const intraday1mStaleSeconds = num(water.intraday1mStaleSeconds ?? water.effectiveSource?.intraday1mStaleSeconds ?? payload.intraday_1m_stale_seconds, 999999);
  const recoverableFailure = failedChecks.some((check) => /(priorityFreshQuoteCoverage120s|priority_fresh_quote_coverage_120s|scannerCanRunOpening|scanner_can_run_opening|formalEntrySpeedVerdict|formal_entry_speed_verdict|GateGrade|gate_grade|quoteAgeSeconds|intraday_1m)/.test(String(check || "")));
  const ok = failedChecks.length > 0
    && pendingPhase.length === 0
    && water.ok === true
    && status === "ready"
    && (sourceStatus === "ok" || sourceStatus === "ready" || sourceStatus === "")
    && gate === "A"
    && formalEntryAllowed
    && scannerCanRunOpening
    && priorityCoverage >= MIN_PRIORITY_COVERAGE
    && quoteAgeSeconds <= 90
    && intraday1mStaleSeconds <= 120
    && waterDate === expected
    && checkedAgeSeconds <= 15 * 60
    && recoverableFailure;
  return {
    contract: "daytrade-warmup-rewater-recovery-v1",
    ok,
    source: waterFile,
    reason: ok ? "water_root_ready_after_rewater" : "water_root_not_sufficient_for_recovery",
    checkedAgeSeconds,
    expectedDate: expected,
    waterDate,
    waterOk: water.ok === true,
    waterStatus: water.status || "",
    sourceStatus,
    gate,
    formalEntryAllowed,
    scannerCanRunOpening,
    priorityCoverage,
    quoteAgeSeconds,
    intraday1mStaleSeconds,
    recoverableFailure,
  };
}

function writeBlockedReceipt(verdict) {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const receipt = {
    receipt_type: "daytrade_final_verdict_blocked_receipt",
    source_name: SOURCE_NAME,
    trade_date: verdict.trade_date,
    checked_at: verdict.checked_at,
    run_id: verdict.run_id,
    unattended_yes: "NO",
    formal_entry_speed_verdict: "NO",
    formal_entry_allowed: false,
    latest_update_allowed: false,
    preserve_previous_good: true,
    no_empty_latest: true,
    no_latest_pointer_update: true,
    failed_phase: verdict.failed_phase,
    failed_checks: verdict.failed_checks,
    failure_codes: verdict.failure_codes,
    first_failed_phase: verdict.first_failed_phase,
    ...writerFingerprint(),
  };
  const files = [
    path.join(OUT_DIR, `daytrade-final-verdict-blocked-${verdict.trade_date.replace(/-/g, "")}-${stamp}.json`),
    path.join(PROD_OUT_DIR, `daytrade-final-verdict-blocked-${verdict.trade_date.replace(/-/g, "")}-${stamp}.json`),
  ];
  for (const file of files) writeJson(file, receipt);
  return files;
}

function buildSummary(expectedTradeDate, runId) {
  const artifacts = Object.fromEntries(PHASES.map((phase) => {
    return [phase, phaseArtifact(expectedTradeDate, phase)];
  }));
  const phaseReports = {};
  const failedPhase = [];
  const pendingPhase = [];
  const failedChecks = [];
  const failureCodes = [];
  for (const phase of PHASES) {
    if (phaseNotDueYet(phase, expectedTradeDate)) {
      const evidence = normalizedEvidence(phase, artifacts[phase].row);
      pendingPhase.push(phase);
      phaseReports[phase] = {
        pass: false,
        pending: true,
        pending_reason: `phase_not_due_until_${phase}`,
        failures: [],
        failure_codes: [],
        natural_schedule_evidence: false,
        evidence,
        artifact: artifacts[phase].file,
      };
      continue;
    }
    const report = phaseFailures(phase, artifacts[phase].row, expectedTradeDate);
    phaseReports[phase] = {
      pass: report.failures.length === 0,
      failures: report.failures,
      failure_codes: report.failure_codes,
      natural_schedule_evidence: report.evidence.naturalScheduleEvidence,
      evidence: report.evidence,
      artifact: artifacts[phase].file,
    };
    if (report.failures.length > 0) {
      failedPhase.push(phase);
      failedChecks.push(...report.failures.map((failure) => `${phase}:${failure}`));
      failureCodes.push(...report.failure_codes);
    }
  }
  const naturalYes = failedChecks.length === 0 && pendingPhase.length === 0;
  const rewaterRecovery = naturalYes ? { ok: false, reason: "not_needed" } : readWaterRootRecovery(expectedTradeDate, failedChecks, pendingPhase);
  const formalEntryAllowed = naturalYes || rewaterRecovery.ok === true;
  const yes = naturalYes;
  const effectiveFailedPhase = failedPhase;
  const effectiveFailedChecks = failedChecks;
  const effectiveFailureCodes = failureCodes;
  const previous_unattended_yes = previousUnattendedYes(expectedTradeDate);
  const uniqueFailureCodes = [...new Set(failureCodes)];
  const opsPolicy = buildOpsPolicy({
    yes,
    formalEntryAllowed,
    failedPhase,
    failureCodes: uniqueFailureCodes,
    previousUnattendedYes: previous_unattended_yes,
    selfHeal: Object.values(phaseReports).some((report) => report.evidence.selfHeal),
    selfHealRecovered: Object.values(phaseReports).some((report) => report.evidence.selfHealRecovered),
    pendingPhase,
  });
  const summary = {
    summary_type: "daytrade_warmup_unattended_summary_v1",
    ok: yes,
    unattended_yes: yes ? "YES" : "NO",
    manual_verification_pass_only: !yes && Object.values(phaseReports).some((report) => report.evidence.manualVerificationOnly),
    source_name: SOURCE_NAME,
    checked_at: new Date().toISOString(),
    trade_date: expectedTradeDate,
    run_id: runId,
    phases_required: PHASES,
    phase_results: phaseReports,
    natural_schedule_evidence_by_phase: Object.fromEntries(Object.entries(phaseReports).map(([phase, report]) => [phase, report.natural_schedule_evidence === true])),
    "0700": phaseReports["0700"].pending ? "PENDING" : (phaseReports["0700"].pass ? "PASS" : (rewaterRecovery.ok ? "RECOVERED" : "FAIL")),
    "0845": phaseReports["0845"].pending ? "PENDING" : (phaseReports["0845"].pass ? "PASS" : (rewaterRecovery.ok ? "RECOVERED" : "FAIL")),
    "0900": phaseReports["0900"].pending ? "PENDING" : (phaseReports["0900"].pass ? "PASS" : (rewaterRecovery.ok ? "RECOVERED" : "FAIL")),
    failed_phase: effectiveFailedPhase,
    original_failed_phase: failedPhase,
    first_failed_phase: failedPhase[0] || null,
    pending_phase: pendingPhase,
    first_pending_phase: pendingPhase[0] || null,
    failed_checks: effectiveFailedChecks,
    original_failed_checks: failedChecks,
    failure_reasons: effectiveFailedChecks,
    original_failure_reasons: failedChecks,
    failure_codes: effectiveFailureCodes.length ? [...new Set(effectiveFailureCodes)] : uniqueFailureCodes,
    original_failure_codes: uniqueFailureCodes,
    self_heal: Object.values(phaseReports).some((report) => report.evidence.selfHeal),
    self_heal_recovered: rewaterRecovery.ok === true || Object.values(phaseReports).some((report) => report.evidence.selfHealRecovered),
    natural_warmup_ok: naturalYes,
    rewater_recovery: rewaterRecovery,
    preserve_previous_good: !yes,
    previous_unattended_yes,
    regressed_today: previous_unattended_yes === "YES" && !yes && pendingPhase.length === 0,
    auto_recovered: previous_unattended_yes === "NO" && yes,
    ops_policy: opsPolicy,
    policy_decision: opsPolicy.policy_decision,
    incident_status: opsPolicy.incident_status,
    incident_reason_codes: opsPolicy.incident_reason_codes,
    next_retry_at: opsPolicy.next_retry_at,
    owner_message: opsPolicy.owner_message,
    formal_entry_allowed: formalEntryAllowed,
    formal_entry_speed_verdict: formalEntryAllowed ? "YES" : "NO",
    latest_update_allowed: yes,
    blocked_receipt_required: !yes && pendingPhase.length === 0,
    rule: "Unattended YES requires natural scheduled 0700/0845/0900 evidence, priorityPoolSymbols=40, priorityFreshQuoteCoverage120s>=0.95, scannerCanRunOpening=true, formalEntrySpeedVerdict=YES, issues=[]. Manual verifier PASS cannot backfill unattended YES.",
    excluded_from_daytrade_warmup_gate: ["membership", "terminal_ui", "/88", "desktop", "mobile", "futopt_txf_global_gate"],
    artifact_paths: {
      "0700": artifacts["0700"].file,
      "0845": artifacts["0845"].file,
      "0900": artifacts["0900"].file,
      summary_runtime: path.join(OUT_DIR, `daytrade-warmup-unattended-summary-${expectedTradeDate.replace(/-/g, "")}.json`),
      summary_production: path.join(PROD_OUT_DIR, `daytrade-warmup-unattended-summary-${expectedTradeDate.replace(/-/g, "")}.json`),
      final_runtime: path.join(OUT_DIR, "daytrade-unattended-final-verdict.json"),
      final_production: path.join(PROD_OUT_DIR, "daytrade-unattended-final-verdict.json"),
    },
    ...writerFingerprint(),
  };
  return summary;
}


function buildMarketClosedSummary(expectedTradeDate, runId, marketCalendar) {
  const artifactPaths = Object.fromEntries(PHASES.map((phase) => [phase, phaseArtifact(expectedTradeDate, phase).file]));
  const phaseResults = Object.fromEntries(PHASES.map((phase) => [phase, {
    pass: false,
    pending: true,
    pending_reason: "market_closed",
    failures: [],
    failure_codes: [],
    natural_schedule_evidence: false,
    evidence: normalizedEvidence(phase, { phase }),
    artifact: artifactPaths[phase],
  }]));
  const previous_unattended_yes = previousUnattendedYes(expectedTradeDate);
  const nextRetryAt = nextTaipeiRunAt(7, 0);
  const policy = {
    policy_decision: "MARKET_CLOSED_PRESERVE_PREVIOUS_GOOD",
    scanner_action: "BLOCK_SCANNER_OPENING",
    publish_action: "PREVIOUS_GOOD_ONLY",
    latest_action: "BLOCK_LATEST_UPDATE",
    incident_status: "NONE",
    incident_severity: "NONE",
    incident_reason_code: "MARKET_CLOSED",
    incident_reason_codes: ["MARKET_CLOSED"],
    first_failed_phase: null,
    pending_phase: PHASES,
    first_pending_phase: PHASES[0],
    self_heal_action: "WAIT_FOR_NEXT_TRADING_DAY",
    self_heal_does_not_count_as_natural: true,
    self_heal_recovered: false,
    next_retry_at: nextRetryAt,
    next_retry_policy: "wait for next trading day natural 0700/0845/0900 evidence; do not rewater on a closed market",
    owner_message: "今日休市：不啟動當沖正式暖機、不補水、不進正式掃描；保留 previous good，下一交易日重新產生自然 evidence。",
    previous_unattended_yes,
    auto_recovered: false,
    regressed_today: false,
    source_not_ready: false,
    task_missed: false,
  };
  return {
    summary_type: "daytrade_warmup_unattended_summary_v1",
    ok: false,
    unattended_yes: "NO",
    manual_verification_pass_only: false,
    source_name: SOURCE_NAME,
    checked_at: new Date().toISOString(),
    trade_date: expectedTradeDate,
    run_id: runId,
    market_closed: true,
    market_calendar: marketCalendar,
    phases_required: PHASES,
    phase_results: phaseResults,
    natural_schedule_evidence_by_phase: Object.fromEntries(PHASES.map((phase) => [phase, false])),
    "0700": "PENDING",
    "0845": "PENDING",
    "0900": "PENDING",
    failed_phase: [],
    original_failed_phase: [],
    first_failed_phase: null,
    pending_phase: PHASES,
    first_pending_phase: PHASES[0],
    failed_checks: [],
    original_failed_checks: [],
    failure_reasons: [],
    original_failure_reasons: [],
    failure_codes: [],
    original_failure_codes: [],
    self_heal: false,
    self_heal_recovered: false,
    natural_warmup_ok: false,
    rewater_recovery: { ok: false, reason: "market_closed" },
    preserve_previous_good: true,
    previous_unattended_yes,
    regressed_today: false,
    auto_recovered: false,
    ops_policy: policy,
    policy_decision: policy.policy_decision,
    incident_status: policy.incident_status,
    incident_reason_codes: policy.incident_reason_codes,
    next_retry_at: policy.next_retry_at,
    owner_message: policy.owner_message,
    formal_entry_allowed: false,
    formal_entry_speed_verdict: "NO",
    latest_update_allowed: false,
    blocked_receipt_required: false,
    rule: "Closed market never produces unattended YES and never triggers rewater; next trading day must produce natural 0700/0845/0900 evidence.",
    excluded_from_daytrade_warmup_gate: ["membership", "terminal_ui", "/88", "desktop", "mobile", "futopt_txf_global_gate"],
    artifact_paths: {
      ...artifactPaths,
      summary_runtime: path.join(OUT_DIR, `daytrade-warmup-unattended-summary-${expectedTradeDate.replace(/-/g, "")}.json`),
      summary_production: path.join(PROD_OUT_DIR, `daytrade-warmup-unattended-summary-${expectedTradeDate.replace(/-/g, "")}.json`),
      final_runtime: path.join(OUT_DIR, "daytrade-unattended-final-verdict.json"),
      final_production: path.join(PROD_OUT_DIR, "daytrade-unattended-final-verdict.json"),
    },
    ...writerFingerprint(),
  };
}
async function main() {
  const expectedTradeDate = argValue("expected-date", argValue("trade-date", taipeiTradeDate())).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");
  const runId = `fugle_daytrade_source-warmup-unattended-verify-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${process.pid}`;
  const calendar = await isTwseTradingDay(new Date(), { stateDir: path.join(RUNTIME_DIR, "state") });
  const today = taipeiTradeDate();
  const summary = calendar.isTradingDay === false && expectedTradeDate === today
    ? buildMarketClosedSummary(expectedTradeDate, runId, calendar)
    : buildSummary(expectedTradeDate, runId);
  const files = [summary.artifact_paths.summary_runtime, summary.artifact_paths.summary_production];
  if (summary.artifact_paths.final_runtime) files.push(summary.artifact_paths.final_runtime, summary.artifact_paths.final_production);
  if (!summary.ok && summary.blocked_receipt_required) summary.blocked_receipt_paths = writeBlockedReceipt(summary);
  for (const file of files) writeJson(file, summary);
  console.log(JSON.stringify({ ok: summary.ok, unattended_yes: summary.unattended_yes, market_closed: summary.market_closed === true, natural_warmup_ok: summary.natural_warmup_ok === true, formal_entry_allowed: summary.formal_entry_allowed === true, policy_decision: summary.policy_decision, first_failed_phase: summary.first_failed_phase, first_pending_phase: summary.first_pending_phase, failure_codes: summary.failure_codes, incident_status: summary.incident_status, next_retry_at: summary.next_retry_at, summary: summary.artifact_paths.summary_runtime }, null, 2));
  process.exitCode = summary.ok ? 0 : 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error?.stack || error?.message || String(error) }, null, 2));
  process.exitCode = 1;
});