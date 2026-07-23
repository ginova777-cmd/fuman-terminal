"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = process.env.FUMAN_ROOT || path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const STATE_DIR = path.join(RUNTIME_DIR, "state");
const OUT_DIR = path.join(STATE_DIR, "daytrade-warmup-self-heal");
const RECEIPT_DIR = path.join(OUT_DIR, "receipts");
const PROD_OUT_DIR = process.env.DAYTRADE_UNATTENDED_OUTPUT_DIR || "C:/Users/ginov/Documents/Codex/buy-sell-autonomy-main/outputs";
const APPLY = process.argv.includes("--apply");
const SELF_TEST = process.argv.includes("--self-test");
const NO_TASKS = process.argv.includes("--no-tasks");
const SOURCE_NAME = "fugle_daytrade_source";
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
const schtasksBin = process.platform === "win32" ? "schtasks.exe" : "schtasks";

const CONTRACT = {
  contract: "daytrade-warmup-self-heal-runner-v1",
  dreamStackSlice: [
    "Reason Code Classifier",
    "Self-Heal Job Queue",
    "Idempotent Rewater Runner",
    "Re-Water Verification",
    "Formal Entry Gate",
  ],
  invariants: [
    "every_failure_code_maps_to_action_or_stop_policy",
    "every_action_has_idempotency_key",
    "every_apply_action_writes_receipt",
    "rewater_actions_must_be_idempotent",
    "task_missed_never_backfills_natural_evidence",
    "membership_ui_88_desktop_mobile_are_excluded_from_warmup_gate",
    "rewater_must_be_followed_by_verification",
    "success_requires_rewater_verification_not_action_exit_only",
    "self_heal_apply_failure_keeps_unattended_no",
  ],
};

const ACTION_MATRIX = {
  TASK_MISSED_0700: ["TASK_DIAGNOSTIC_ONLY"],
  TASK_MISSED_0845: ["TASK_DIAGNOSTIC_ONLY"],
  TASK_MISSED_0900: ["TASK_DIAGNOSTIC_ONLY"],
  MISSING_NATURAL_SCHEDULE_EVIDENCE: ["TASK_DIAGNOSTIC_ONLY"],
  MANUAL_VERIFICATION_ONLY: ["STOP_PROTECT_NATURAL_EVIDENCE_REQUIRED"],
  TRADE_DATE_MISMATCH: ["STOP_PROTECT_NATURAL_EVIDENCE_REQUIRED"],
  PRIORITY_POOL_NOT_40: ["START_DAYTRADE_WRITER_TASK", "START_DAYTRADE_WATCHDOG_TASK", "RUN_DAYTRADE_SOURCE_WRITER_ONCE", "VERIFY_REWATER"],
  PRIORITY_COVERAGE_LT_095: ["START_DAYTRADE_WRITER_TASK", "START_DAYTRADE_WATCHDOG_TASK", "RUN_DAYTRADE_SOURCE_WRITER_ONCE", "VERIFY_REWATER"],
  QUOTE_STALE: ["START_DAYTRADE_WRITER_TASK", "START_DAYTRADE_WATCHDOG_TASK", "RUN_DAYTRADE_SOURCE_WRITER_ONCE", "VERIFY_REWATER"],
  SCANNER_OPENING_FALSE: ["START_DAYTRADE_WRITER_TASK", "RUN_DAYTRADE_SOURCE_WRITER_ONCE", "VERIFY_REWATER"],
  FORMAL_VERDICT_NO: ["RUN_DAYTRADE_SOURCE_CONTRACT_VERIFY", "VERIFY_REWATER"],
  GATE_NOT_A: ["RUN_DAYTRADE_SOURCE_CONTRACT_VERIFY", "VERIFY_REWATER"],
  INTRADAY_1M_NOT_FRESH: ["START_DAYTRADE_WRITER_TASK", "RUN_DAYTRADE_SOURCE_WRITER_ONCE", "VERIFY_REWATER"],
  DAILY_VOLUME_NOT_READY: ["RUN_DAYTRADE_SOURCE_WRITER_ONCE", "VERIFY_REWATER"],
  FUTOPT_TXF_NOT_READY: ["START_DAYTRADE_WRITER_TASK", "START_DAYTRADE_WATCHDOG_TASK", "RUN_FUGLE_WEBSOCKET_VERIFY", "VERIFY_REWATER"],
  WEBSOCKET_DISCONNECTED: ["START_DAYTRADE_WRITER_TASK", "START_DAYTRADE_WATCHDOG_TASK", "RUN_FUGLE_WEBSOCKET_VERIFY", "VERIFY_REWATER"],
  WEBSOCKET_NOT_FORMAL_READY: ["START_DAYTRADE_WRITER_TASK", "START_DAYTRADE_WATCHDOG_TASK", "RUN_FUGLE_WEBSOCKET_VERIFY", "VERIFY_REWATER"],
  SUPABASE_TIMEOUT: ["RUN_SUPABASE_LIGHT_PROBE", "RUN_DAYTRADE_SOURCE_CONTRACT_VERIFY", "VERIFY_REWATER"],
  SOURCE_STATUS_NOT_OK: ["START_DAYTRADE_WRITER_TASK", "RUN_DAYTRADE_SOURCE_CONTRACT_VERIFY", "VERIFY_REWATER"],
  MISSING_OR_INVALID_ARTIFACT: ["TASK_DIAGNOSTIC_ONLY"],
  ISSUES_NOT_EMPTY: ["RUN_DAYTRADE_SOURCE_CONTRACT_VERIFY", "VERIFY_REWATER"],
};

function taipeiParts(date = new Date()) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date).map((part) => [part.type, part.value]));
}

function taipeiTradeDate(date = new Date()) {
  const p = taipeiParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

function ymd(date) {
  return String(date || "").replace(/\D/g, "").slice(0, 8);
}

function argValue(name, fallback = "") {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || fallback;
}

function readJson(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return { ...fallback, __read_error: error.message, __file: file };
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function safeId(value) {
  return String(value || "unknown").replace(/[^A-Za-z0-9._:-]+/g, "_").slice(0, 180);
}

function command(label, command, args = [], options = {}) {
  return { label, command, args, ...options };
}

function npmRun(script, extraArgs = []) {
  return command(`npm:${script}`, npmBin, ["run", script, ...extraArgs]);
}

function taskRun(taskName) {
  return command(`task:${taskName.replace(/^\\/, "")}`, schtasksBin, ["/Run", "/TN", taskName], { taskName });
}

function actionCommand(action) {
  switch (action) {
    case "START_DAYTRADE_WRITER_TASK":
      return taskRun("\\Fuman Daytrade Source Writer 0600-1330");
    case "START_DAYTRADE_WATCHDOG_TASK":
      return taskRun("\\Fuman Fugle Daytrade Watchdog Every Minute");
    case "RUN_DAYTRADE_SOURCE_WRITER_ONCE":
      return command("daytrade-source:writer-once", "node", ["--use-system-ca", "scripts/run-daytrade-source-writer.js", "--apply", "--once", "--max-seconds=25"], { writesSource: true });
    case "RUN_DAYTRADE_SOURCE_CONTRACT_VERIFY":
      return npmRun("verify:daytrade-source-contract-alignment");
    case "RUN_FUGLE_WEBSOCKET_VERIFY":
      return npmRun("verify:fugle-websocket-sources");
    case "RUN_SUPABASE_LIGHT_PROBE":
      return npmRun("supabase:probe:light");
    case "VERIFY_REWATER":
      return null;
    case "TASK_DIAGNOSTIC_ONLY":
      return command("task-diagnostic:daytrade-warmup", schtasksBin, ["/Query", "/TN", "\\Fuman Daytrade Source Writer 0600-1330", "/FO", "LIST", "/V"], { diagnosticOnly: true });
    case "STOP_PROTECT_NATURAL_EVIDENCE_REQUIRED":
      return null;
    default:
      return null;
  }
}

function printable(step) {
  return [step.command, ...(step.args || [])].join(" ");
}

function normalizeFailureCodes(summary = {}) {
  const codes = [];
  if (Array.isArray(summary.failure_codes)) codes.push(...summary.failure_codes);
  if (Array.isArray(summary.incident_reason_codes)) codes.push(...summary.incident_reason_codes);
  const checks = Array.isArray(summary.failed_checks) ? summary.failed_checks : [];
  for (const check of checks) {
    const text = String(check || "").toLowerCase();
    if (text.includes("task_missed:0700")) codes.push("TASK_MISSED_0700");
    if (text.includes("task_missed:0845")) codes.push("TASK_MISSED_0845");
    if (text.includes("task_missed:0900")) codes.push("TASK_MISSED_0900");
    if (text.includes("prioritypoolsymbols") || text.includes("priority_pool_symbols")) codes.push("PRIORITY_POOL_NOT_40");
    if (text.includes("priorityfreshquotecoverage120s") || text.includes("priority_fresh_quote_coverage_120s")) codes.push("PRIORITY_COVERAGE_LT_095");
    if (text.includes("quoteageseconds") || text.includes("quote_age_seconds")) codes.push("QUOTE_STALE");
    if (text.includes("intraday_1m") || text.includes("today_1m")) codes.push("INTRADAY_1M_NOT_FRESH");
    if (text.includes("daily_volume_status")) codes.push("DAILY_VOLUME_NOT_READY");
    if (text.includes("scanner_can_run_opening") || text.includes("scannerCanRunOpening")) codes.push("SCANNER_OPENING_FALSE");
    if (text.includes("formalentryspeedverdict") || text.includes("formal_entry_speed_verdict")) codes.push("FORMAL_VERDICT_NO");
    if (text.includes("gategrade") || text.includes("gate_grade")) codes.push("GATE_NOT_A");
    if (text.includes("natural_schedule_evidence")) codes.push("MISSING_NATURAL_SCHEDULE_EVIDENCE");
    if (text.includes("manual_verification_only")) codes.push("MANUAL_VERIFICATION_ONLY");
    if (text.includes("timeout")) codes.push("SUPABASE_TIMEOUT");
  }
  return [...new Set(codes.map((code) => String(code || "").trim()).filter(Boolean).map((code) => /^TRADE_DATE_\d{4}_\d{2}_\d{2}$/.test(code) ? "TRADE_DATE_MISMATCH" : code))];
}

function defaultSummaryFile(tradeDate) {
  return path.join(PROD_OUT_DIR, `daytrade-warmup-unattended-summary-${ymd(tradeDate)}.json`);
}

function latestSummary(tradeDate) {
  const explicit = argValue("summary");
  if (explicit) return readJson(explicit, {});
  const file = defaultSummaryFile(tradeDate);
  const row = readJson(file, {});
  if (!row.__read_error) return row;
  return readJson(path.join(STATE_DIR, "daytrade-unattended-final-verdict.json"), row);
}

function needsStopOnly(actions) {
  return actions.includes("STOP_PROTECT_NATURAL_EVIDENCE_REQUIRED");
}

function planActions(summary, tradeDate) {
  const failureCodes = normalizeFailureCodes(summary);
  const jobs = [];
  const unknownCodes = [];
  for (const code of failureCodes) {
    const actions = ACTION_MATRIX[code];
    if (!actions) {
      unknownCodes.push(code);
      continue;
    }
    const commands = actions.map(actionCommand).filter(Boolean);
    const stopOnly = needsStopOnly(actions);
    const naturalOnly = actions.includes("TASK_DIAGNOSTIC_ONLY") || stopOnly;
    const idempotencyKey = safeId([tradeDate, code, actions.join("+"), summary.run_id || "no-run"].join(":"));
    jobs.push({
      code,
      actions,
      state: stopOnly ? "STOP_PROTECT" : naturalOnly ? "DIAGNOSTIC_ONLY" : "READY_TO_REWATER",
      executable: !stopOnly && commands.length > 0,
      natural_evidence_backfill_allowed: false,
      self_heal_counts_as_unattended_yes: false,
      idempotencyKey,
      receiptFile: path.join(RECEIPT_DIR, `${idempotencyKey}.json`),
      commands,
    });
  }
  return { failureCodes, jobs, unknownCodes };
}

function readReceipt(job) {
  const receipt = readJson(job.receiptFile, null);
  if (!receipt || receipt.contract !== "daytrade-warmup-self-heal-action-receipt-v1") return null;
  if (receipt.idempotencyKey !== job.idempotencyKey) return null;
  return receipt;
}

function completedReceipt(job) {
  const receipt = readReceipt(job);
  return receipt && receipt.ok === true && receipt.status === "complete" ? receipt : null;
}

function runStep(step) {
  const result = spawnSync(step.command, step.args || [], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env },
    windowsHide: true,
    timeout: step.command === schtasksBin ? 20000 : 60000,
  });
  return {
    label: step.label,
    command: printable(step),
    exitCode: result.status ?? 1,
    ok: result.status === 0 || (step.command === schtasksBin && [0, 267009, 2147946720].includes(Number(result.status))),
    stdout: String(result.stdout || "").slice(-2500),
    stderr: String(result.stderr || "").slice(-2500),
  };
}

function writeReceipt(job, status, results, extra = {}) {
  const payload = {
    contract: "daytrade-warmup-self-heal-action-receipt-v1",
    checkedAt: new Date().toISOString(),
    sourceName: SOURCE_NAME,
    code: job.code,
    actions: job.actions,
    idempotencyKey: job.idempotencyKey,
    status,
    ok: status === "complete",
    natural_evidence_backfill_allowed: false,
    self_heal_counts_as_unattended_yes: false,
    commands: job.commands.map(printable),
    results,
    ...extra,
  };
  writeJson(job.receiptFile, payload);
  return payload;
}

function rewaterVerificationCommands() {
  return [
    npmRun("verify:daytrade-source-contract-alignment"),
    npmRun("verify:fugle-websocket-sources"),
  ];
}

function buildPlan(summary, tradeDate) {
  const plannedActions = planActions(summary, tradeDate);
  const pendingNotDue = summary.status === "PENDING_NOT_DUE" || normalizeFailureCodes(summary).includes("PENDING_NOT_DUE");
  const failureCodes = pendingNotDue ? [] : plannedActions.failureCodes;
  const jobs = pendingNotDue ? [] : plannedActions.jobs;
  const unknownCodes = pendingNotDue ? [] : plannedActions.unknownCodes;
  const okBefore = summary.unattended_yes === "YES" || summary.ok === true || pendingNotDue;
  const planned = {
    ...CONTRACT,
    checkedAt: new Date().toISOString(),
    mode: APPLY ? "apply" : "dry-run",
    sourceName: SOURCE_NAME,
    tradeDate,
    inputSummary: summary.artifact_paths?.summary_production || defaultSummaryFile(tradeDate),
    inputRunId: summary.run_id || null,
    warmupStatusBefore: okBefore ? "A_OR_YES" : "NO_OR_NOT_READY",
    failureCodes,
    unknownCodes,
    jobs,
    rewaterVerification: rewaterVerificationCommands(),
    decision: {
      ok: pendingNotDue || okBefore || (unknownCodes.length === 0 && jobs.length > 0),
      state: pendingNotDue ? "WAITING_FOR_NATURAL_PHASE" : okBefore ? "NO_REWATER_NEEDED" : unknownCodes.length ? "UNKNOWN_REASON_CODE_BLOCKED" : jobs.length ? "SELF_HEAL_PLANNED" : "NO_FAILURE_CODES_FOUND",
      applyAllowed: !okBefore && unknownCodes.length === 0 && jobs.some((job) => job.executable),
      reason: pendingNotDue ? "next warmup phase is not due yet" : okBefore ? "warmup already yes" : unknownCodes.length ? `unknown reason code: ${unknownCodes.join(",")}` : jobs.length ? "reason codes mapped to self-heal actions" : "warmup not ready but no failure code was emitted; reason classifier must be fixed",
    },
    exclusions: ["membership", "terminal_ui", "/88", "desktop", "mobile"],
  };
  return planned;
}

function writeOutputs(plan, executed = [], verificationResults = []) {
  const payload = { ...plan, executed, verificationResults };
  writeJson(path.join(OUT_DIR, "daytrade-warmup-self-heal-plan.json"), payload);
  writeJson(path.join(PROD_OUT_DIR, "daytrade-warmup-self-heal-plan.json"), payload);
  return payload;
}

function selfTest() {
  const fake = {
    ok: false,
    unattended_yes: "NO",
    trade_date: "2026-07-21",
    run_id: "self-test-run",
    failure_codes: ["PRIORITY_COVERAGE_LT_095", "INTRADAY_1M_NOT_FRESH", "TASK_MISSED_0845", "MANUAL_VERIFICATION_ONLY", "TRADE_DATE_2026_07_20"],
  };
  const plan = buildPlan(fake, "2026-07-21");
  const issues = [];
  for (const invariant of CONTRACT.invariants) {
    if (!plan.invariants.includes(invariant)) issues.push(`missing invariant ${invariant}`);
  }
  if (!plan.jobs.find((job) => job.code === "PRIORITY_COVERAGE_LT_095" && job.actions.includes("RUN_DAYTRADE_SOURCE_WRITER_ONCE"))) issues.push("priority coverage does not map to rewater writer");
  if (!plan.jobs.find((job) => job.code === "TASK_MISSED_0845" && job.natural_evidence_backfill_allowed === false)) issues.push("task missed allows natural evidence backfill");
  if (!plan.jobs.find((job) => job.code === "MANUAL_VERIFICATION_ONLY" && job.state === "STOP_PROTECT")) issues.push("manual verification only is not stop-protect");
  if (!plan.jobs.find((job) => job.code === "TRADE_DATE_MISMATCH" && job.state === "STOP_PROTECT" && job.natural_evidence_backfill_allowed === false)) issues.push("trade date mismatch is not stop-protect natural evidence wait");
  if (!plan.rewaterVerification.some((step) => step.label.includes("daytrade-source-contract-alignment"))) issues.push("missing source contract rewater verification");
  if (!plan.rewaterVerification.some((step) => step.label.includes("fugle-websocket-sources"))) issues.push("missing websocket rewater verification");
  return { ok: issues.length === 0, issues, samplePlan: plan };
}

function main() {
  if (SELF_TEST) {
    const result = selfTest();
    console.log(JSON.stringify({ ok: result.ok, contract: "daytrade-warmup-self-heal-self-test-v1", issues: result.issues }, null, 2));
    if (!result.ok) process.exit(1);
    return;
  }

  const tradeDate = argValue("expected-date", argValue("trade-date", taipeiTradeDate())).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");
  const summary = latestSummary(tradeDate);
  const plan = buildPlan(summary, tradeDate);
  const executed = [];
  const verificationResults = [];

  if (APPLY) {
    if (!plan.decision.applyAllowed) {
      const output = writeOutputs(plan, executed, verificationResults);
      console.error(JSON.stringify({ ok: false, state: plan.decision.state, reason: plan.decision.reason, output: path.join(OUT_DIR, "daytrade-warmup-self-heal-plan.json") }, null, 2));
      process.exit(1);
    }
    for (const job of plan.jobs.filter((item) => item.executable)) {
      const previous = completedReceipt(job);
      if (previous) {
        executed.push({ label: `idempotent-skip:${job.code}`, ok: true, skipped: true, receiptFile: job.receiptFile, idempotencyKey: job.idempotencyKey });
        continue;
      }
      const jobResults = [];
      for (const step of job.commands) {
        if (NO_TASKS && step.command === schtasksBin) {
          const skipped = { label: step.label, command: printable(step), exitCode: 0, ok: true, skipped: true, reason: "--no-tasks" };
          jobResults.push(skipped);
          executed.push(skipped);
          continue;
        }
        const result = runStep(step);
        jobResults.push(result);
        executed.push({ ...result, code: job.code, idempotencyKey: job.idempotencyKey, receiptFile: job.receiptFile });
        if (!result.ok) {
          writeReceipt(job, "failed", jobResults, { failedCommand: result.command });
          writeOutputs(plan, executed, verificationResults);
          console.error(JSON.stringify({ ok: false, failedJob: job.code, failedCommand: result.command, receiptFile: job.receiptFile }, null, 2));
          process.exit(1);
        }
      }
      writeReceipt(job, "complete", jobResults);
    }
    for (const step of plan.rewaterVerification) {
      const result = runStep(step);
      verificationResults.push(result);
      if (!result.ok) break;
    }
  }

  const output = writeOutputs(plan, executed, verificationResults);
  const verificationOk = !APPLY || (verificationResults.length === plan.rewaterVerification.length && verificationResults.every((item) => item.ok));
  console.log(JSON.stringify({
    ok: plan.decision.ok && verificationOk,
    mode: plan.mode,
    state: plan.decision.state,
    reason: plan.decision.reason,
    jobs: plan.jobs.length,
    failureCodes: plan.failureCodes,
    unknownCodes: plan.unknownCodes,
    applyAllowed: plan.decision.applyAllowed,
    verificationOk,
    output: path.join(OUT_DIR, "daytrade-warmup-self-heal-plan.json"),
  }, null, 2));
  if (!plan.decision.ok || (APPLY && !verificationOk)) process.exit(1);
}

main();


