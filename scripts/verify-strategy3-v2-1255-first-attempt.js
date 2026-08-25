"use strict";

// Read-only guard for Strategy3 V2's 12:55 diagnostic attempt.
// The attempt is intentionally never eligible to apply, publish, or overwrite 13:00.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { ROOT, RUNTIME_DIR, taipeiDate, readJson, scanReceiptPath } = require("./strategy3-v2-contract");

const tradeDate = process.argv.find((arg) => arg.startsWith("--trade-date="))?.slice("--trade-date=".length) || taipeiDate();
const compactDate = tradeDate.replace(/\D/g, "");
const issues = [];

function add(condition, code, details = {}) {
  if (!condition) issues.push({ code, ...details });
}

function getTask() {
  try {
    const output = execFileSync("schtasks.exe", ["/Query", "/TN", "Fuman Strategy3 V2 First Attempt 1255", "/XML"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15000,
    });
    return output;
  } catch (error) {
    return "";
  }
}

const runnerPath = path.join(ROOT, "run-strategy3-v2-1255-first-attempt.ps1");
const scannerPath = path.join(ROOT, "scripts", "run-strategy3-v2-complete-scan.js");
const attemptPath = path.join(RUNTIME_DIR, "data", "scan-receipts", `strategy3-v2-first-attempt-1255-${compactDate}.json`);
const scanAttemptPath = path.join(RUNTIME_DIR, "data", "scan-receipts", `strategy3-v2-complete-scan-attempt-1255-${compactDate}.json`);
const canonicalScanPath = scanReceiptPath(compactDate);
const runnerText = fs.existsSync(runnerPath) ? fs.readFileSync(runnerPath, "utf8") : "";
const scannerText = fs.existsSync(scannerPath) ? fs.readFileSync(scannerPath, "utf8") : "";
const taskXml = getTask();
const attempt = readJson(attemptPath, {});
const scanAttempt = readJson(scanAttemptPath, {});

add(fs.existsSync(runnerPath), "strategy3_v2_1255_runner_missing", { runnerPath });
add(fs.existsSync(scannerPath), "strategy3_v2_1255_scanner_missing", { scannerPath });
add(runnerText.includes("--attempt-phase=1255"), "strategy3_v2_1255_runner_argument_missing");
add(runnerText.includes("formal_allowed = $false"), "strategy3_v2_1255_runner_formal_guard_missing");
add(runnerText.includes("publish_allowed = $false"), "strategy3_v2_1255_runner_publish_guard_missing");
add(runnerText.includes("line_push_allowed = $false"), "strategy3_v2_1255_runner_line_guard_missing");
add(runnerText.includes("strategy3-v2-complete-scan-attempt-1255-"), "strategy3_v2_1255_receipt_isolation_missing");
add(scannerText.includes('attemptPhase === "1255"'), "strategy3_v2_1255_scanner_phase_guard_missing");
add(scannerText.includes("PREOPEN_ATTEMPT_FAIL_CLOSED"), "strategy3_v2_1255_fail_closed_status_missing");
add(scannerText.includes("strategy3_v2_1255_preopen_attempt_requires_1300_retry"), "strategy3_v2_1255_retry_reason_missing");
add(scannerText.includes("retry_strategy3_v2_complete_scan_at_1300_only"), "strategy3_v2_1255_retry_action_missing");
add(taskXml.includes("Fuman Strategy3 V2 First Attempt 1255"), "strategy3_v2_1255_task_missing");
add(taskXml.includes("12:55:00"), "strategy3_v2_1255_task_time_mismatch");
add(taskXml.includes("S4U"), "strategy3_v2_1255_task_not_s4u");
add(taskXml.includes("HighestAvailable"), "strategy3_v2_1255_task_not_highest");
add(taskXml.includes("run-strategy3-v2-1255-first-attempt.ps1"), "strategy3_v2_1255_task_action_mismatch");

const receiptPresent = fs.existsSync(attemptPath);
if (receiptPresent) {
  add(attempt.contract === "strategy3-v2-1255-first-attempt-wrapper-v1", "strategy3_v2_1255_contract_mismatch", { value: attempt.contract });
  add(attempt.trade_date === tradeDate, "strategy3_v2_1255_trade_date_mismatch", { value: attempt.trade_date });
  add(attempt.attempt_phase === "1255", "strategy3_v2_1255_attempt_phase_mismatch", { value: attempt.attempt_phase });
  add(attempt.formal_allowed === false, "strategy3_v2_1255_formal_allowed_true");
  add(attempt.publish_allowed === false, "strategy3_v2_1255_publish_allowed_true");
  add(attempt.line_push_allowed === false, "strategy3_v2_1255_line_push_allowed_true");
  add(attempt.retry_task === "Fuman Strategy3 V2 Complete Scan 1300", "strategy3_v2_1255_retry_task_mismatch", { value: attempt.retry_task });
  add(attempt.retry_time === "13:00 Asia/Taipei", "strategy3_v2_1255_retry_time_mismatch", { value: attempt.retry_time });
  add(attempt.scan_receipt === scanAttemptPath, "strategy3_v2_1255_scan_receipt_not_isolated", { value: attempt.scan_receipt });
}

if (fs.existsSync(scanAttemptPath)) {
  add(scanAttempt.trade_date === tradeDate, "strategy3_v2_1255_scan_trade_date_mismatch", { value: scanAttempt.trade_date });
  add(scanAttempt.attempt_phase === "1255", "strategy3_v2_1255_scan_phase_mismatch", { value: scanAttempt.attempt_phase });
  add(scanAttempt.status === "PREOPEN_ATTEMPT_FAIL_CLOSED", "strategy3_v2_1255_scan_not_fail_closed", { value: scanAttempt.status });
  add(scanAttempt.formal_allowed === false, "strategy3_v2_1255_scan_formal_allowed_true");
  add(scanAttempt.publish_allowed === false, "strategy3_v2_1255_scan_publish_allowed_true");
  add(scanAttempt.line_allowed === false, "strategy3_v2_1255_scan_line_allowed_true");
  add(scanAttempt.allowed_action === "retry_strategy3_v2_complete_scan_at_1300_only", "strategy3_v2_1255_scan_retry_action_mismatch", { value: scanAttempt.allowed_action });
}

const payload = {
  ok: issues.length === 0,
  contract: "strategy3_v2_1255_first_attempt_verifier_v1",
  trade_date: tradeDate,
  checked_at: new Date().toISOString(),
  read_only: true,
  task: "Fuman Strategy3 V2 First Attempt 1255",
  required_schedule: "12:55 Asia/Taipei",
  guards: {
    first_attempt_formal_allowed: false,
    first_attempt_publish_allowed: false,
    first_attempt_line_push_allowed: false,
    canonical_1300_receipt: canonicalScanPath,
    isolated_1255_scan_receipt: scanAttemptPath,
  },
  receipts: {
    wrapper: { path: attemptPath, present: receiptPresent, status: attempt.status || null },
    scan_attempt: { path: scanAttemptPath, present: fs.existsSync(scanAttemptPath), status: scanAttempt.status || null },
  },
  failed_checks: issues.map((issue) => issue.code),
  first_blocker: issues[0]?.code || null,
  issues,
};

console.log(JSON.stringify(payload, null, 2));
process.exitCode = payload.ok ? 0 : 1;
