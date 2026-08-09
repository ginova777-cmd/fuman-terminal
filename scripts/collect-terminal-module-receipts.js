"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { STAGES, compactDate, defaultAuditRoot, defaultRuntimeDir, parseLastJson, readJson, receiptDir, writeJson } = require("../lib/terminal-final-audit-contract");
const { FULL_MODULES, moduleReceiptFile, moduleReceiptDir, moduleSourceFile, normalizeModuleReceipt, isModuleDue } = require("../lib/terminal-full-module-contract");

const ROOT = path.resolve(__dirname, "..");

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const value = process.argv.find((item) => item === name || item.startsWith(prefix));
  return value === name ? "1" : (value ? value.slice(prefix.length) : fallback);
}

function readSource(file) {
  if (!file || !fs.existsSync(file)) return null;
  return readJson(file, null);
}


function isoDate(compact) {
  const value = compactDate(compact);
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function taipeiCompactDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}${values.month}${values.day}`;
}

function receiptClockForTradeDate(tradeDate, explicitNow = "") {
  if (explicitNow) return new Date(explicitNow);
  const dateKey = compactDate(tradeDate);
  const today = taipeiCompactDate(new Date());
  if (dateKey && today && dateKey < today) {
    return new Date(`${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}T23:59:59+08:00`);
  }
  return new Date();
}

function readNaturalEvidenceSource(runtimeDir, tradeDate) {
  const dateKey = compactDate(tradeDate);
  const phases = ["0705", "0847", "0912"];
  const checkpointFiles = Object.fromEntries(phases.map((phase) => [
    phase,
    path.join(runtimeDir, "state", `daytrade-warmup-checkpoint-${dateKey}-${phase}.json`),
  ]));
  const checkpoints = {};
  const missing = [];
  const failures = [];
  for (const phase of phases) {
    const receipt = readSource(checkpointFiles[phase]);
    if (!receipt) {
      missing.push(phase);
      failures.push(`missing_checkpoint:${phase}`);
      continue;
    }
    checkpoints[phase] = receipt;
    const checkpointDate = String(receipt.tradeDate || receipt.trade_date || "").replace(/\D/g, "");
    if (checkpointDate && checkpointDate !== dateKey) failures.push(`checkpoint_trade_date_mismatch:${phase}`);
    if (Array.isArray(receipt.failures)) failures.push(...receipt.failures.map((item) => `${phase}:${item}`));
  }
  const watchdog = readSource(path.join(runtimeDir, "state", "daytrade-unattended-gate-watchdog.json"));
  const naturalScheduleEvidence = ["0705", "0847"].every((phase) => checkpoints[phase]?.naturalScheduleEvidence === true);
  const formalWarmupPass = checkpoints["0705"]?.formalWarmupPass === true
    && checkpoints["0847"]?.formalWarmupPass === true
    && checkpoints["0912"]?.ok === true;
  const naturalWarmupOk = formalWarmupPass
    && checkpoints["0705"]?.naturalSuccess === true
    && checkpoints["0847"]?.naturalSuccess === true;
  return {
    contract: "terminal-natural-evidence-source-v1",
    ok: naturalWarmupOk,
    complete: naturalWarmupOk,
    status: naturalWarmupOk ? "complete" : "blocked",
    trade_date: isoDate(dateKey),
    run_id: `natural-evidence-${dateKey}`,
    natural_schedule_evidence: naturalScheduleEvidence,
    natural_warmup_ok: naturalWarmupOk,
    formal_warmup_pass: formalWarmupPass,
    missing_checkpoints: missing,
    failures,
    checkpoint_files: checkpointFiles,
    checkpoints,
    watchdog: watchdog ? {
      ok: watchdog.ok === true,
      gate_grade: watchdog.gate_grade || "",
      gate_status: watchdog.gate_status || "",
      gate_reason: watchdog.gate_reason || "",
      formal_entry_speed_verdict: watchdog.formal_entry_speed_verdict || "",
      formal_entry_allowed: watchdog.formal_entry_allowed === true,
      failed_checks: Array.isArray(watchdog.failed_checks) ? watchdog.failed_checks : [],
      metrics: watchdog.metrics || null,
    } : null,
  };
}
function runReadOnlyCommand(module, context = {}) {
  if (!module.command) return { source: null, sourceFile: "", commandResult: null };
  const startedAt = new Date().toISOString();
  const env = {
    ...process.env,
    ...(context.tradeDate ? { FUMAN_TRADE_DATE: context.tradeDate } : {}),
    ...(context.dailyRunId ? { FUMAN_DAILY_RUN_ID: context.dailyRunId } : {}),
  };
  const commandArgs = (module.command.args || []).map((arg) => String(arg).replaceAll("{tradeDate}", context.tradeDate || "").replaceAll("{dailyRunId}", context.dailyRunId || "").replaceAll("{auditRoot}", context.auditRoot || "").replaceAll("{runtimeDir}", context.runtimeDir || ""));
  const commandCwd = String(module.command.cwd || ROOT).replaceAll("{auditRoot}", context.auditRoot || "").replaceAll("{runtimeDir}", context.runtimeDir || "");
  const result = spawnSync(module.command.executable === "node" ? process.execPath : module.command.executable, commandArgs, {
    cwd: commandCwd,
    encoding: "utf8",
    windowsHide: true,
    env,
  });
  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  const exitCode = result.status === null ? 1 : result.status;
  const parsed = parseLastJson(stdout) || parseLastJson(stderr);
  const source = parsed ? {
    ...parsed,
    verifier_exit_code: exitCode,
    verifier: parsed.verifier || module.verifier || "",
  } : {
    contract: "terminal-contract-verifier-receipt-v1",
    ok: false,
    status: "BLOCKED",
    verifier_exit_code: exitCode,
    verifier: module.verifier || "",
  };
  return {
    source,
    sourceFile: "command:" + module.command.executable + " " + commandArgs.join(" "),
    commandResult: {
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      exit_code: exitCode,
      stdout_tail: stdout.slice(-4000),
      stderr_tail: stderr.slice(-4000),
      context: { trade_date: context.tradeDate || "", daily_run_id: context.dailyRunId || "" },
    },
  };
}

function runWarmupSelfHealPlan({ runtimeDir, tradeDate, dailyRunId, auditRoot }) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(process.execPath, ["--use-system-ca", "scripts/run-daytrade-warmup-self-heal.js"], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    env: {
      ...process.env,
      FUMAN_TRADE_DATE: tradeDate || "",
      FUMAN_DAILY_RUN_ID: dailyRunId || "",
      FUMAN_AUDIT_ROOT: auditRoot || "",
      FUMAN_RUNTIME_DIR: runtimeDir || "",
    },
  });
  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  const planFile = path.join(runtimeDir, "state", "daytrade-warmup-self-heal", "daytrade-warmup-self-heal-plan.json");
  const plan = readSource(planFile) || parseLastJson(stdout) || parseLastJson(stderr) || null;
  const planOk = plan?.ok === true || plan?.decision?.ok === true;
  const jobs = Array.isArray(plan?.jobs) ? plan.jobs : [];
  const executableJobs = jobs.filter((job) => job?.executable === true);
  return {
    contract: "terminal-recovery-self-heal-plan-evidence-v1",
    command: "node --use-system-ca scripts/run-daytrade-warmup-self-heal.js",
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    exit_code: result.status === null ? 1 : result.status,
    plan_file: planFile,
    ok: result.status === 0 && planOk,
    dry_run: true,
    apply_allowed: plan?.decision?.applyAllowed === true,
    executable_job_count: executableJobs.length,
    job_count: jobs.length,
    self_heal_counts_as_unattended_yes: false,
    rewater_verification_required: true,
    plan,
    stdout_tail: stdout.slice(-2000),
    stderr_tail: stderr.slice(-2000),
  };
}

function recoveryNeedsWarmupSelfHeal(entries) {
  const warmupReasons = new Set([
    "water_root_not_ready",
    "websocket_source_not_ready",
    "formal_gate_not_ready",
    "formal_gate_live_status_not_ready",
  ]);
  return Array.isArray(entries) && entries.some((entry) => {
    const key = String(entry?.key || "");
    const reason = String(entry?.reason_code || "");
    return key === "natural_evidence"
      || key === "water_root"
      || key === "websocket"
      || key === "formal_gate"
      || reason.startsWith("natural_warmup_")
      || warmupReasons.has(reason);
  });
}
function main() {
  const tradeDate = compactDate(argValue("--trade-date", process.env.FUMAN_TRADE_DATE || ""));
  const dailyRunId = argValue("--daily-run-id", process.env.FUMAN_DAILY_RUN_ID || "");
  const auditRoot = path.resolve(argValue("--out", defaultAuditRoot(ROOT)));
  const runtimeDir = argValue("--runtime-dir", defaultRuntimeDir());
  const now = receiptClockForTradeDate(tradeDate, argValue("--now", process.env.FUMAN_RECEIPT_NOW || ""));
  const downstreamModules = FULL_MODULES.filter((module) => !STAGES.some((stage) => stage.key === module.key));
  const results = [];
  fs.mkdirSync(moduleReceiptDir(auditRoot, tradeDate, dailyRunId), { recursive: true });
  const resourceChainModules = downstreamModules.filter((module) => module.adapter === "resource_chain");
  const resourceChainDir = path.join(auditRoot, compactDate(tradeDate), String(dailyRunId), "artifacts", "resource-chain");
  let resourceChainSource = null;
  let resourceChainSourceFile = "";
  let resourceChainCommandResult = null;
  if (resourceChainModules.some((module) => isModuleDue(module, now))) {
    const startedAt = new Date().toISOString();
    const command = spawnSync(process.execPath, ["--use-system-ca", "scripts/verify-terminal-resource-chain.js", "--expected-date=" + tradeDate, "--out=" + resourceChainDir], {
      cwd: ROOT,
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, FUMAN_TRADE_DATE: tradeDate, FUMAN_DAILY_RUN_ID: dailyRunId },
    });
    resourceChainSourceFile = "command:node --use-system-ca scripts/verify-terminal-resource-chain.js --expected-date=" + tradeDate + " --out=" + resourceChainDir;
    resourceChainCommandResult = {
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      exit_code: command.status === null ? 1 : command.status,
      stdout_tail: String(command.stdout || "").slice(-4000),
      stderr_tail: String(command.stderr || "").slice(-4000),
    };
    resourceChainSource = readSource(path.join(resourceChainDir, "terminal-resource-chain-audit.json"))
      || parseLastJson(String(command.stdout || ""))
      || parseLastJson(String(command.stderr || ""));
  }
  for (const module of downstreamModules.filter((item) => item.key !== "recovery_queue")) {
    let sourceFile = moduleSourceFile({ module, runtimeDir, auditRoot, tradeDate, dailyRunId });
    let source = readSource(sourceFile);
    let commandResult = null;
    if (module.key === "natural_evidence") {
      source = readNaturalEvidenceSource(runtimeDir, tradeDate);
      sourceFile = "generated:natural-evidence-checkpoints";
    }
    if (!source && module.adapter === "resource_chain" && resourceChainSource) {
      source = { ...resourceChainSource, resource_key: module.resourceKey || "" };
      sourceFile = resourceChainSourceFile;
      commandResult = resourceChainCommandResult;
    }
    if (module.command && (module.adapter === "contract_verification_command" || ["mother_pool", "top40"].includes(module.key)) && isModuleDue(module, now)) {
      const command = runReadOnlyCommand(module, { tradeDate, dailyRunId, auditRoot, runtimeDir });
      source = command.source;
      sourceFile = command.sourceFile;
      commandResult = command.commandResult;
    } else if (!source && ["verification_command", "power_recovery"].includes(module.adapter) && isModuleDue(module, now)) {
      const command = runReadOnlyCommand(module, { tradeDate, dailyRunId, auditRoot, runtimeDir });
      source = command.source;
      sourceFile = command.sourceFile;
      commandResult = command.commandResult;
    }
    const receipt = normalizeModuleReceipt({ module, source, sourceFile, tradeDate, dailyRunId, now, commandResult });
    const file = moduleReceiptFile(auditRoot, tradeDate, dailyRunId, module.key);
    writeJson(file, receipt);
    results.push({ key: module.key, required: module.required !== false, receipt_required: module.receipt_required !== false, file, status: receipt.status, complete: receipt.complete, receipt_present: receipt.receipt_present, reason_code: receipt.reason_code, allowed_action: receipt.allowed_action, source_file: receipt.source_file });
  }
  const recoveryModule = downstreamModules.find((module) => module.key === "recovery_queue");
  const recoveryQueueFile = path.join(auditRoot, tradeDate, dailyRunId, "recovery-queue.json");
  if (recoveryModule) {
    const preliminaryMissing = results.filter((row) => row.required !== false && row.receipt_present !== true).map((row) => row.key);
    const preliminaryFailed = results.filter((row) => row.required !== false && row.receipt_present === true && !["PASS", "SKIPPED"].includes(row.status)).map((row) => ({ key: row.key, status: row.status, reason_code: row.reason_code, allowed_action: row.allowed_action }));
    const preliminaryCoreRecovery = [];
    for (const stage of STAGES) {
      const file = path.join(receiptDir(auditRoot, tradeDate, dailyRunId), stage.key + ".json");
      const receipt = readJson(file, null);
      if (!receipt || receipt.complete !== true || !["PASS", "SKIPPED"].includes(receipt.status)) preliminaryCoreRecovery.push({ key: stage.key, status: receipt?.status || "MISSING", reason_code: receipt?.reason_code || "stage_receipt_missing", allowed_action: receipt?.allowed_action || "produce_required_stage_receipt_before_claiming_completion" });
    }
    const preliminaryEntries = [...preliminaryCoreRecovery, ...preliminaryFailed.filter((row) => row.status !== "NOT_DUE"), ...preliminaryMissing.map((key) => ({ key, status: "MISSING", reason_code: "module_receipt_missing", allowed_action: "produce_required_module_receipt_before_claiming_completion" }))];
    writeJson(recoveryQueueFile, { contract: "terminal-recovery-queue-v1", generated_at: new Date().toISOString(), daily_run_id: dailyRunId, trade_date: tradeDate, entries: preliminaryEntries, first_blocker: preliminaryEntries[0]?.key || "", reason_code: preliminaryEntries[0]?.reason_code || "ok", allowed_action: preliminaryEntries[0]?.allowed_action || "none", ok: preliminaryEntries.length === 0, unattended_status: preliminaryEntries.length === 0 ? "YES" : "NO" });
    let recoverySourceFile = moduleSourceFile({ module: recoveryModule, runtimeDir, auditRoot, tradeDate, dailyRunId });
    let recoverySource = readSource(recoverySourceFile);
    let recoveryCommandResult = null;
    if (isModuleDue(recoveryModule, now)) {
      const command = runReadOnlyCommand(recoveryModule, { tradeDate, dailyRunId, auditRoot, runtimeDir });
      recoverySource = command.source;
      recoverySourceFile = command.sourceFile;
      recoveryCommandResult = command.commandResult;
    }
    const recoveryReceipt = normalizeModuleReceipt({ module: recoveryModule, source: recoverySource, sourceFile: recoverySourceFile, tradeDate, dailyRunId, now, commandResult: recoveryCommandResult });
    const recoveryFile = moduleReceiptFile(auditRoot, tradeDate, dailyRunId, recoveryModule.key);
    writeJson(recoveryFile, recoveryReceipt);
    results.push({ key: recoveryModule.key, required: recoveryModule.required !== false, receipt_required: recoveryModule.receipt_required !== false, file: recoveryFile, status: recoveryReceipt.status, complete: recoveryReceipt.complete, receipt_present: recoveryReceipt.receipt_present, reason_code: recoveryReceipt.reason_code, allowed_action: recoveryReceipt.allowed_action, source_file: recoveryReceipt.source_file });
  }
  const baseMissing = results.filter((row) => row.required !== false && row.receipt_present !== true).map((row) => row.key);
  const baseFailed = results.filter((row) => row.required !== false && row.receipt_present === true && !["PASS", "SKIPPED"].includes(row.status)).map((row) => ({ key: row.key, status: row.status, reason_code: row.reason_code, allowed_action: row.allowed_action }));
  const coreRecovery = [];
  for (const stage of STAGES) {
    const file = path.join(receiptDir(auditRoot, tradeDate, dailyRunId), stage.key + ".json");
    const receipt = readJson(file, null);
    if (!receipt || receipt.complete !== true || !["PASS", "SKIPPED"].includes(receipt.status)) coreRecovery.push({ key: stage.key, status: receipt?.status || "MISSING", reason_code: receipt?.reason_code || "stage_receipt_missing", allowed_action: receipt?.allowed_action || "produce_required_stage_receipt_before_claiming_completion" });
  }
  const recoveryEntries = [...coreRecovery, ...baseFailed.filter((row) => row.status !== "NOT_DUE"), ...baseMissing.map((key) => ({ key, status: "MISSING", reason_code: "module_receipt_missing", allowed_action: "produce_required_module_receipt_before_claiming_completion" }))];
  const recoverySelfHealPlan = recoveryNeedsWarmupSelfHeal(recoveryEntries)
    ? runWarmupSelfHealPlan({ runtimeDir, tradeDate, dailyRunId, auditRoot })
    : null;
  const recoveryQueue = { contract: "terminal-recovery-queue-v1", generated_at: new Date().toISOString(), daily_run_id: dailyRunId, trade_date: tradeDate, entries: recoveryEntries, first_blocker: recoveryEntries[0]?.key || "", reason_code: recoveryEntries[0]?.reason_code || "ok", allowed_action: recoveryEntries[0]?.allowed_action || "none", ok: recoveryEntries.length === 0, unattended_status: recoveryEntries.length === 0 ? "YES" : "NO", self_heal_plan: recoverySelfHealPlan };

  writeJson(recoveryQueueFile, recoveryQueue);
  if (recoveryModule) {
    const recoveryOpen = Array.isArray(recoveryQueue.entries) && recoveryQueue.entries.length > 0;
    const finalRecoveryReceipt = {
      contract: "terminal-module-receipt-v1",
      module: recoveryModule.key,
      label: recoveryModule.label,
      daily_run_id: dailyRunId,
      trade_date: compactDate(tradeDate),
      source_file: recoveryQueueFile,
      source_present: true,
      source_run_id: dailyRunId,
      source_trade_date: compactDate(tradeDate),
      checked_at: new Date().toISOString(),
      command_result: null,
      status: recoveryOpen ? "BLOCKED" : "PASS",
      complete: !recoveryOpen,
      receipt_present: true,
      exit_code: recoveryOpen ? 1 : 0,
      reason_code: recoveryOpen ? (recoveryQueue.reason_code || "recovery_queue_open") : "ok",
      allowed_action: recoveryOpen ? (recoveryQueue.allowed_action || recoveryModule.allowedAction) : "none",
      issues: recoveryOpen ? ["recovery_queue_has_open_entries"] : [],
      evidence: recoveryQueue,
    };
    const recoveryFile = moduleReceiptFile(auditRoot, tradeDate, dailyRunId, recoveryModule.key);
    writeJson(recoveryFile, finalRecoveryReceipt);
    const recoveryResult = { key: recoveryModule.key, required: recoveryModule.required !== false, receipt_required: recoveryModule.receipt_required !== false, file: recoveryFile, status: finalRecoveryReceipt.status, complete: finalRecoveryReceipt.complete, receipt_present: finalRecoveryReceipt.receipt_present, reason_code: finalRecoveryReceipt.reason_code, allowed_action: finalRecoveryReceipt.allowed_action, source_file: finalRecoveryReceipt.source_file };
    const recoveryIndex = results.findIndex((row) => row.key === recoveryModule.key);
    if (recoveryIndex >= 0) results[recoveryIndex] = recoveryResult;
    else results.push(recoveryResult);
  }
  const missing = results.filter((row) => row.required !== false && row.receipt_present !== true).map((row) => row.key);
  const failed = results.filter((row) => row.required !== false && row.receipt_present === true && !["PASS", "SKIPPED"].includes(row.status)).map((row) => ({ key: row.key, status: row.status, reason_code: row.reason_code, allowed_action: row.allowed_action }));
  const notDue = results.filter((row) => row.required !== false && row.status === "NOT_DUE").map((row) => row.key);
  const first = failed[0] || null;
  const payload = {
    contract: "terminal-module-receipt-collection-v1",
    generated_at: new Date().toISOString(),
    daily_run_id: dailyRunId,
    trade_date: tradeDate,
    required_modules: downstreamModules.filter((module) => module.required !== false).map((module) => module.key),
    deferred_modules: downstreamModules.filter((module) => module.required === false).map((module) => module.key),
    receipts: results,
    missing_module_receipts: missing,
    failed_modules: failed,
    not_due_modules: notDue,
    recovery_queue_file: recoveryQueueFile,
    recovery_queue: recoveryQueue,
    first_blocker: first?.key || missing[0] || "",
    reason_code: first?.reason_code || (missing.length ? "module_receipt_missing" : (notDue.length ? "module_not_due" : "ok")),
    allowed_action: first?.allowed_action || (missing.length ? "produce_required_module_receipt_before_claiming_completion" : (notDue.length ? "wait_until_all_required_modules_are_due" : "none")),
    ok: missing.length === 0 && failed.length === 0,
  };
  const summaryFile = path.join(moduleReceiptDir(auditRoot, tradeDate, dailyRunId), "collection.json");
  writeJson(summaryFile, payload);
  if (process.env.FUMAN_FINAL_AUDIT_WRITE_RUNTIME !== "0") writeJson(path.join(runtimeDir, "state", "terminal-module-receipt-collection.json"), payload);
  console.log(JSON.stringify({ ok: payload.ok, daily_run_id: dailyRunId, trade_date: tradeDate, missing_module_receipts: missing, failed_modules: failed, not_due_modules: notDue, first_blocker: payload.first_blocker, reason_code: payload.reason_code, output: summaryFile }, null, 2));
  if (!payload.ok) process.exitCode = 1;
}

main();










