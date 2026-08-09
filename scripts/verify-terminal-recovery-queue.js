"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function argValue(name, fallback = "") {
  const prefix = name + "=";
  const value = process.argv.find((item) => item === name || item.startsWith(prefix));
  return value === name ? "1" : (value ? value.slice(prefix.length) : fallback);
}

function compactDate(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function readJson(file) {
  try {
    return { value: JSON.parse(fs.readFileSync(file, "utf8")), error: "" };
  } catch (error) {
    return { value: null, error: String(error.message || error) };
  }
}

function isDeferredNextTradingDayJob(job = {}) {
  return String(job.state || "") === "NEXT_TRADING_DAY_REPAIR_DEFERRED"
    || String(job.deferredUntil || job.retryPolicy?.deferredUntil || "") === "next_trading_day_market_open"
    || String(job.nextAction || "").includes("defer_until_next_trading_day");
}
function receiptSummary(job) {
  const receiptFile = job?.receiptFile ? path.resolve(ROOT, String(job.receiptFile)) : "";
  if (!receiptFile) {
    return {
      receiptFile,
      receiptExists: false,
      receiptStatus: "missing_receipt_file_path",
      receiptOk: false,
      receiptRequired: job?.receiptRequired === true,
    };
  }

  const loaded = readJson(receiptFile);
  const receipt = loaded.value;
  if (!receipt) {
    return {
      receiptFile,
      receiptExists: fs.existsSync(receiptFile),
      receiptStatus: "missing_or_unreadable",
      receiptOk: false,
      receiptRequired: job?.receiptRequired === true,
      receiptError: loaded.error,
    };
  }

  const commandResults = Array.isArray(receipt.commandResults) ? receipt.commandResults : (Array.isArray(receipt.results) ? receipt.results : []);
  return {
    receiptFile,
    receiptExists: true,
    receiptContract: receipt.contract || "",
    receiptStatus: receipt.status || "",
    receiptOk: receipt.ok === true,
    receiptCheckedAt: receipt.checkedAt || receipt.checked_at || "",
    receiptTerminalReason: receipt.terminalReason || "",
    receiptNextRetryAt: receipt.nextRetryAt || "",
    receiptDeadLetter: receipt.deadLetter === true,
    receiptRequired: job?.receiptRequired === true,
    receiptCommandCount: commandResults.length,
    receiptFailedCommands: commandResults
      .filter((item) => item && item.ok === false)
      .map((item) => ({
        command: item.command || "",
        exitCode: item.exitCode,
      })),
  };
}

function enrichJobQueue(jobQueue) {
  if (!Array.isArray(jobQueue)) return null;
  return jobQueue.map((job) => ({
    ...job,
    receipt: receiptSummary(job),
  }));
}

function main() {
  const requestedDate = argValue("--trade-date", argValue("--expected-date", process.env.FUMAN_TRADE_DATE || ""));
  const tradeDate = compactDate(requestedDate);
  let dailyRunId = argValue("--daily-run-id", process.env.FUMAN_DAILY_RUN_ID || "");
  const stateFile = path.resolve(argValue("--state", process.env.FUMAN_ORCHESTRATOR_STATE_FILE || path.join(ROOT, "outputs", "terminal-orchestrator", "terminal-orchestrator-state.json")));
  const queueFile = path.resolve(argValue("--queue", process.env.FUMAN_ORCHESTRATOR_QUEUE_FILE || path.join(ROOT, "outputs", "terminal-orchestrator", "terminal-job-queue.json")));
  const stateLoaded = readJson(stateFile);
  const queueLoaded = readJson(queueFile);
  const state = stateLoaded.value;
  const queue = queueLoaded.value;
  if (!dailyRunId && state) dailyRunId = String(state.daily_run_id || state.dailyRunId || "");

  const issues = [];
  if (!state) issues.push(stateLoaded.error ? "orchestrator_state_unreadable" : "orchestrator_state_missing");
  if (state && state.contract !== "terminal-orchestrator-state-v1") issues.push("orchestrator_state_contract_invalid");
  if (state && tradeDate && compactDate(state.tradeDate) !== tradeDate) issues.push("orchestrator_state_trade_date_mismatch");
  if (state && dailyRunId && String(state.daily_run_id || state.dailyRunId || "") !== dailyRunId) issues.push("orchestrator_state_daily_run_id_mismatch");

  if (queue && queue.contract === "terminal-recovery-queue-v1") {
    if (tradeDate && compactDate(queue.trade_date) !== tradeDate) issues.push("recovery_queue_trade_date_mismatch");
    if (dailyRunId && String(queue.daily_run_id || "") !== dailyRunId) issues.push("recovery_queue_daily_run_id_mismatch");
    if (queue.ok !== true || !Array.isArray(queue.entries) || queue.entries.length > 0) issues.push("recovery_queue_has_pending_entries");
  }

  if (state && state.manifestDateAccepted !== true) issues.push("orchestrator_manifest_date_not_accepted");
  if (state && state.queueCoverage?.ok !== true) issues.push("recovery_queue_coverage_not_ok");
  if (state && !Array.isArray(state.jobQueue)) issues.push("recovery_queue_job_queue_missing");

  const enrichedJobQueue = enrichJobQueue(state?.jobQueue);
  const pendingJobs = Array.isArray(enrichedJobQueue) ? enrichedJobQueue : [];
  const deferredNextTradingDayJobs = pendingJobs.filter(isDeferredNextTradingDayJob);
  const activePendingJobs = pendingJobs.filter((job) => !isDeferredNextTradingDayJob(job));
  if (activePendingJobs.length > 0) issues.push("recovery_queue_has_pending_jobs");
  if (activePendingJobs.some((job) => job.receipt?.receiptExists && job.receipt?.receiptOk === false)) {
    issues.push("recovery_queue_has_failed_receipts");
  }
  if (activePendingJobs.some((job) => job.receipt?.receiptRequired && !job.receipt?.receiptExists)) {
    issues.push("recovery_queue_missing_required_receipts");
  }
  if (deferredNextTradingDayJobs.some((job) => job.receipt?.receiptRequired && !job.receipt?.receiptExists)) {
    issues.push("recovery_queue_missing_required_deferred_receipts");
  }
  if (deferredNextTradingDayJobs.some((job) => job.receipt?.receiptExists && job.receipt?.receiptOk !== true)) {
    issues.push("recovery_queue_has_failed_deferred_receipts");
  }
  if (deferredNextTradingDayJobs.some((job) => {
    if (!job.receipt?.receiptExists || job.receipt?.receiptOk !== true) return false;
    return !["deferred", "complete", "blocked"].includes(String(job.receipt.receiptStatus || ""));
  })) {
    issues.push("recovery_queue_deferred_receipt_status_invalid");
  }

  if (queue !== null && queue.contract !== "terminal-recovery-queue-v1" && !Array.isArray(queue) && !(queue && Array.isArray(queue.jobs))) {
    issues.push("recovery_queue_file_invalid");
  }

  const ok = issues.length === 0;
  const payload = {
    contract: "terminal-recovery-queue-verifier-v1",
    ok,
    status: ok ? "PASS" : "BLOCKED",
    checkedAt: new Date().toISOString(),
    trade_date: tradeDate || compactDate(state?.tradeDate),
    daily_run_id: dailyRunId,
    state_file: stateFile,
    queue_file: queueFile,
    source_exists: Boolean(state),
    orchestrator_state_contract: state?.contract || "",
    overall_state: state?.overallState || "",
    unattended_status: state?.unattendedStatus || "",
    queue_coverage: state?.queueCoverage || null,
    job_queue: enrichedJobQueue,
    active_pending_jobs: activePendingJobs,
    deferred_next_trading_day_jobs: deferredNextTradingDayJobs,
    active_pending_jobs: activePendingJobs,
    deferred_next_trading_day_jobs: deferredNextTradingDayJobs,
    receipt_summary: pendingJobs.map((job) => ({
      jobId: job.jobId,
      module: job.module,
      state: job.state,
      reasonCode: job.reasonCode,
      receipt: job.receipt,
    })),
    queue_file_value: queue,
    issues,
  };

  const outputFile = path.resolve(argValue("--output", process.env.FUMAN_RECOVERY_QUEUE_VERIFIER_OUTPUT || path.join(ROOT, "outputs", "terminal-orchestrator", "terminal-recovery-queue-verifier.json")));
  payload.output = outputFile;
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(payload, null, 2));
  if (!ok) process.exitCode = 1;
}

main();







