"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const ROOT = process.env.FUMAN_ROOT || "C:/fuman-terminal";
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const OUT_DIR = path.join(RUNTIME_DIR, "state");
const PROD_OUT_DIR = process.env.DAYTRADE_UNATTENDED_OUTPUT_DIR || "C:/Users/ginov/Documents/Codex/buy-sell-autonomy-main/outputs";
const SOURCE_NAME = "fugle_daytrade_source";
const PHASES = ["0700", "0845", "0900"];
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
    const file = path.join(PROD_OUT_DIR, `daytrade-unattended-gate-${phase}.json`);
    return [phase, { file, row: readJson(file, { phase }) }];
  }));
  const phaseReports = {};
  const failedPhase = [];
  const failedChecks = [];
  const failureCodes = [];
  for (const phase of PHASES) {
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
  const yes = failedChecks.length === 0;
  const previous_unattended_yes = previousUnattendedYes(expectedTradeDate);
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
    "0700": phaseReports["0700"].pass ? "PASS" : "FAIL",
    "0845": phaseReports["0845"].pass ? "PASS" : "FAIL",
    "0900": phaseReports["0900"].pass ? "PASS" : "FAIL",
    failed_phase: failedPhase,
    first_failed_phase: failedPhase[0] || null,
    failed_checks: failedChecks,
    failure_reasons: failedChecks,
    failure_codes: [...new Set(failureCodes)],
    self_heal: Object.values(phaseReports).some((report) => report.evidence.selfHeal),
    self_heal_recovered: Object.values(phaseReports).some((report) => report.evidence.selfHealRecovered),
    preserve_previous_good: !yes,
    previous_unattended_yes,
    regressed_today: previous_unattended_yes === "YES" && !yes,
    formal_entry_allowed: yes,
    formal_entry_speed_verdict: yes ? "YES" : "NO",
    latest_update_allowed: yes,
    blocked_receipt_required: !yes,
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

function main() {
  const expectedTradeDate = argValue("expected-date", argValue("trade-date", taipeiTradeDate())).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");
  const runId = `fugle_daytrade_source-warmup-unattended-verify-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${process.pid}`;
  const summary = buildSummary(expectedTradeDate, runId);
  const files = [summary.artifact_paths.summary_runtime, summary.artifact_paths.summary_production];
  if (summary.artifact_paths.final_runtime) files.push(summary.artifact_paths.final_runtime, summary.artifact_paths.final_production);
  if (!summary.ok) summary.blocked_receipt_paths = writeBlockedReceipt(summary);
  for (const file of files) writeJson(file, summary);
  console.log(JSON.stringify({ ok: summary.ok, unattended_yes: summary.unattended_yes, first_failed_phase: summary.first_failed_phase, failure_codes: summary.failure_codes, summary: summary.artifact_paths.summary_runtime }, null, 2));
  process.exitCode = summary.ok ? 0 : 1;
}

main();
