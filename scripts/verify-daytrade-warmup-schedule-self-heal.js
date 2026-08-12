"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = process.env.FUMAN_ROOT || path.resolve(__dirname, "..");
const CONTRACT_PATH = path.join(ROOT, "ops", "daytrade-warmup-schedule-self-heal-contract.json");
const REGISTRY_PATH = path.join(ROOT, "scripts", "fuman-schedule-registry.json");
const PACKAGE_PATH = path.join(ROOT, "package.json");
const LIVE = process.argv.includes("--live");
const CONTRACT = "daytrade-warmup-schedule-self-heal-contract-v1";
const REQUIRED_INVARIANTS = [
  "natural_gate_tasks_exist_and_are_readonly",
  "market_calendar_precedes_warmup_and_closed_market_preserves_previous_good",
  "predictive_preflight_uses_websocket_transport_and_fail_closed_exit",
  "predictive_preflight_task_exists_at_0830",
  "warmup_run_id_is_filesystem_safe",
  "final_verdict_task_exists_at_0912",
  "final_verdict_runs_root_apply_after_original_verdict",
  "writer_and_watchdog_rewater_tasks_exist",
  "allowed_results_do_not_hide_missing_natural_evidence",
  "warmup_root_and_self_heal_scripts_are_wired",
  "membership_ui_88_desktop_mobile_are_excluded_from_warmup_gate",
  "self_heal_can_rewater_but_cannot_backfill_natural_schedule_evidence",
  "rewater_actions_must_be_idempotent",
  "rewater_must_be_followed_by_verification",
  "self_heal_apply_failure_keeps_unattended_no",
  "success_requires_rewater_verification_not_action_exit_only",
  "warmup_tasks_run_on_battery_power",
  "preflight_failure_evidence_is_immutable_and_reason_preserving",
  "source_control_tasks_require_s4u_highest",
];
const SELF_HEAL_RUNNER_PATH = path.join(ROOT, "scripts", "run-daytrade-warmup-self-heal.js");


function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function hasAll(haystack, needles) {
  const text = String(haystack || "");
  return needles.every((needle) => text.includes(needle));
}

function asTaskName(name) {
  return String(name || "").replace(/^\\+/, "");
}

function findRegistryTask(registry, name) {
  const target = asTaskName(name);
  return (registry.tasks || []).find((task) => asTaskName(task.displayName) === target || asTaskName(task.taskName) === target) || null;
}

function includesAllValues(actual, expected) {
  const set = new Set((actual || []).map((value) => Number(value)));
  return (expected || []).every((value) => set.has(Number(value)));
}

function checkTask({ contractTask, registry, issues, role }) {
  const name = contractTask.name;
  const task = findRegistryTask(registry, name);
  if (!task) {
    issues.push(`${role}:${name}:missing_registry_task`);
    return;
  }
  if (task.expectedState !== "Ready") issues.push(`${role}:${name}:expectedState_not_Ready:${task.expectedState || "missing"}`);
  if (task.time !== contractTask.time) issues.push(`${role}:${name}:time:${task.time || "missing"}:expected_${contractTask.time}`);
  const expectedTriggers = contractTask.expectedTriggers || [];
  for (const trigger of expectedTriggers) {
    if (!Array.isArray(task.expectedTriggers) || !task.expectedTriggers.includes(trigger)) issues.push(`${role}:${name}:missing_trigger:${trigger}`);
  }
  const activeTasks = registry.policy && Array.isArray(registry.policy.activeTasks) ? registry.policy.activeTasks : [];
  if (!activeTasks.includes(name)) issues.push(`${role}:${name}:missing_active_task_policy`);
  const allowed = registry.policy && registry.policy.allowedResults ? registry.policy.allowedResults[name] : null;
  if (!includesAllValues(allowed, contractTask.allowedResults || [])) issues.push(`${role}:${name}:allowed_results_mismatch`);
}

function queryScheduledTask(name) {
  const ps = process.env.PWSH || "C:/Program Files/PowerShell/7/pwsh.exe";
  const command = [
    "$ErrorActionPreference = 'Stop'",
    `$task = Get-ScheduledTask -TaskName '${name.replace(/'/g, "''")}'`,
    `$info = Get-ScheduledTaskInfo -TaskName '${name.replace(/'/g, "''")}'`,
    "$actions = @($task.Actions | ForEach-Object { [pscustomobject]@{ Execute = $_.Execute; Arguments = $_.Arguments } })",
    "[pscustomobject]@{ TaskName = $task.TaskName; TaskPath = $task.TaskPath; State = $task.State.ToString(); LastTaskResult = $info.LastTaskResult; LastRunTime = $info.LastRunTime; NextRunTime = $info.NextRunTime; DisallowStartIfOnBatteries = $task.Settings.DisallowStartIfOnBatteries; StopIfGoingOnBatteries = $task.Settings.StopIfGoingOnBatteries; Principal = [pscustomobject]@{ UserId = $task.Principal.UserId; LogonType = $task.Principal.LogonType.ToString(); RunLevel = $task.Principal.RunLevel.ToString() }; Actions = $actions } | ConvertTo-Json -Depth 8 -Compress",
  ].join("; ");
  const result = spawnSync(ps, ["-NoProfile", "-Command", command], {
    encoding: "utf8",
    timeout: 10000,
    windowsHide: true,
  });
  if (result.status !== 0) {
    return { status: result.status, error: String(result.stderr || result.stdout || "").trim() };
  }
  try {
    return { status: 0, task: JSON.parse(String(result.stdout || "{}").trim()) };
  } catch (error) {
    return { status: 2, error: `json_parse_failed:${error.message}:${String(result.stdout || "").slice(0, 200)}` };
  }
}

function checkLiveTask({ contractTask, issues, role }) {
  if (!LIVE) return;
  const live = queryScheduledTask(contractTask.name);
  if (live.status !== 0) {
    issues.push(`${role}:${contractTask.name}:scheduled_task_query_failed:${live.status}:${live.error || ""}`);
    return;
  }
  const task = live.task || {};
  const allowedLiveStates = role === "rewater" ? new Set(["Ready", "Running"]) : new Set(["Ready"]);
  if (!allowedLiveStates.has(String(task.State || ""))) {
    issues.push(`${role}:${contractTask.name}:live_state_not_ready:${task.State || "missing"}`);
  }
  const allowedResults = new Set((contractTask.allowedResults || []).map((value) => Number(value)));
  if (allowedResults.size > 0 && !allowedResults.has(Number(task.LastTaskResult))) {
    issues.push(`${role}:${contractTask.name}:live_last_result_not_allowed:${task.LastTaskResult}`);
  }
  if (task.DisallowStartIfOnBatteries !== false) issues.push(`${role}:${contractTask.name}:live_disallow_start_on_battery`);
  if (task.StopIfGoingOnBatteries !== false) issues.push(`${role}:${contractTask.name}:live_stop_on_battery`);
  if (String(task.Principal?.LogonType || "") !== "S4U") issues.push(`${role}:${contractTask.name}:live_logon_type_not_s4u:${task.Principal?.LogonType || "missing"}`);
  if (String(task.Principal?.RunLevel || "") !== "Highest") issues.push(`${role}:${contractTask.name}:live_run_level_not_highest:${task.Principal?.RunLevel || "missing"}`);
  const actions = Array.isArray(task.Actions) ? task.Actions : (task.Actions ? [task.Actions] : []);
  const actionText = actions.map((action) => `${action.Execute || ""} ${action.Arguments || ""}`).join("\n");
  for (const needle of contractTask.expectedCommandContains || []) {
    if (!actionText.includes(needle)) issues.push(`${role}:${contractTask.name}:live_command_missing:${needle}`);
  }
}

function main() {
  const contract = readJson(CONTRACT_PATH);
  const registry = readJson(REGISTRY_PATH);
  const pkg = readJson(PACKAGE_PATH);
  const issues = [];

  if (contract.contract !== CONTRACT) issues.push(`contract_mismatch:${contract.contract || "missing"}`);
  for (const invariant of contract.invariants || []) {
    if (!invariant || typeof invariant !== "string") issues.push("invalid_invariant_entry");
  }
  for (const invariant of REQUIRED_INVARIANTS) {
    if (!(contract.invariants || []).includes(invariant)) issues.push(`contract_invariant_missing:${invariant}`);
  }

  const selfHealText = fs.existsSync(SELF_HEAL_RUNNER_PATH) ? fs.readFileSync(SELF_HEAL_RUNNER_PATH, "utf8") : "";
  if (!selfHealText) issues.push("self_heal_runner_missing");
  if (!selfHealText.includes("function rewaterVerificationCommands")) issues.push("self_heal_runner_missing_rewater_verification_commands");
  if (!selfHealText.includes("verify:daytrade-source-contract-alignment")) issues.push("self_heal_runner_missing_source_contract_verification");
  if (!selfHealText.includes("verify:fugle-websocket-sources")) issues.push("self_heal_runner_missing_websocket_verification");
  if (!selfHealText.includes("completedReceipt(job)")) issues.push("self_heal_runner_missing_idempotent_receipt_skip");
  if (!selfHealText.includes("verificationOk")) issues.push("self_heal_runner_missing_verification_ok_gate");
  if (!selfHealText.includes("self_heal_counts_as_unattended_yes: false")) issues.push("self_heal_runner_may_fake_unattended_yes");
  const naturalGateRuntimePath = "C:/fuman-runtime/ops/Run-DaytradeUnattendedGate.ps1";
  const naturalGateRuntimeText = fs.existsSync(naturalGateRuntimePath) ? fs.readFileSync(naturalGateRuntimePath, "utf8") : "";
  const naturalGateRuntimeImplPath = "C:/fuman-runtime/ops/daytrade-unattended-gate-runtime.js";
  const naturalGateRuntimeImplText = fs.existsSync(naturalGateRuntimeImplPath) ? fs.readFileSync(naturalGateRuntimeImplPath, "utf8") : "";
  if (!naturalGateRuntimeText.includes("check-market-calendar-action.js")) issues.push("natural_gate_missing_market_calendar_guard");
  if (!naturalGateRuntimeText.includes("market_closed")) issues.push("natural_gate_missing_market_closed_branch");
  if (!naturalGateRuntimeText.includes("preserve previous good")) issues.push("natural_gate_missing_previous_good_protection");
  for (const needle of [
    "function writePhaseArtifacts(phase, output)",
    "-evidence-${evidenceDate}-${stamp}-${process.pid}.json",
    "const existingNatural =",
    "manual_or_recovery",
    "natural_schedule",
  ]) {
    if (!naturalGateRuntimeImplText.includes(needle)) {
      issues.push(`natural_gate_missing_immutable_evidence_guard:${needle}`);
    }
  }
  const predictivePreflightRuntimePath = "C:/fuman-runtime/ops/daytrade-preflight-0830.js";
  const predictivePreflightWrapperPath = "C:/fuman-runtime/ops/Run-DaytradePreflight0830.ps1";
  const predictivePreflightText = fs.existsSync(predictivePreflightRuntimePath) ? fs.readFileSync(predictivePreflightRuntimePath, "utf8") : "";
  const predictivePreflightWrapperText = fs.existsSync(predictivePreflightWrapperPath) ? fs.readFileSync(predictivePreflightWrapperPath, "utf8") : "";
  if (!predictivePreflightText) issues.push("predictive_preflight_runtime_missing");
  for (const needle of ["websocketTransportReady", "websocket_formal_ready", "connectionTimeoutMillis", "query_timeout", "process.exitCode = output.ok ? 0 : 1"]) {
    if (!predictivePreflightText.includes(needle)) issues.push(`predictive_preflight_runtime_missing:${needle}`);
  }
  if (!predictivePreflightWrapperText) issues.push("predictive_preflight_wrapper_missing");
  for (const needle of [
    "daytrade-preflight-0830-evidence-",
    "$preflightPayload = $stdoutText | ConvertFrom-Json",
    "$rawFailedChecks = @($preflightPayload.failed_checks",
    "preflight_payload = $preflightPayload",
    "$artifact | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $runEvidence",
  ]) {
    if (!predictivePreflightWrapperText.includes(needle)) {
      issues.push(`predictive_preflight_wrapper_missing_failure_evidence_guard:${needle}`);
    }
  }
  for (const needle of ["Write-GuardArtifact", "market_closed_previous_good", "daytrade-preflight-0830.json"]) {
    if (!predictivePreflightWrapperText.includes(needle)) issues.push(`predictive_preflight_wrapper_missing:${needle}`);
  }
  if (!selfHealText.includes("if (summary.market_closed === true)")) issues.push("self_heal_runner_missing_market_closed_protection");
  if (!selfHealText.includes("market closed; no rewater and no formal entry")) issues.push("self_heal_runner_market_closed_may_rewater");

  const unattendedPath = path.join(ROOT, "scripts", "verify-daytrade-warmup-unattended.js");
  const rootPath = path.join(ROOT, "scripts", "verify-daytrade-warmup-root.js");
  const unattendedText = fs.existsSync(unattendedPath) ? fs.readFileSync(unattendedPath, "utf8") : "";
  const unattendedRunIdNeedles = [
    "replace(/^(\\d{4})(\\d{2})(\\d{2})$/",
    "replace(/\\D/g, \"\")",
  ];
  for (const needle of unattendedRunIdNeedles) {
    if (!unattendedText.includes(needle)) issues.push(`warmup_run_id_regression_missing:${needle}`);
  }
  const rootText = fs.existsSync(rootPath) ? fs.readFileSync(rootPath, "utf8") : "";
  const unattendedRegressionNeedles = [
    "const naturalYes = failedChecks.length === 0 && pendingPhase.length === 0;",
    "const formalEntryAllowed = naturalYes || rewaterRecovery.ok === true;",
    "unattended_yes: yes ? \"YES\" : \"NO\"",
    "formal_entry_allowed: formalEntryAllowed",
    "const { isTwseTradingDay } = require(\"./twse-trading-day\");",
    "function buildMarketClosedSummary(",
    "MARKET_CLOSED_PRESERVE_PREVIOUS_GOOD",
  ];
  for (const needle of unattendedRegressionNeedles) {
    if (!unattendedText.includes(needle)) issues.push(`unattended_regression_missing:${needle}`);
  }
  const rootRegressionNeedles = [
    "const marketClosed = finalPayload.market_closed === true || selfHealPayload.market_closed === true;",
    "const ok = unattendedYes || marketClosed;",
    "WARMUP_MARKET_CLOSED_PRESERVE_PREVIOUS_GOOD",
    "const ok = unattendedYes || marketClosed;",
    "contract: \"daytrade-warmup-root-with-self-heal-v2\"",
    "market-closed policy may pass without formal entry, but only natural 0700/0845/0900 evidence can set unattended_yes=YES",
  ];
  for (const needle of rootRegressionNeedles) {
    if (!rootText.includes(needle)) issues.push(`root_regression_missing:${needle}`);
  }

  const predictivePreflightTask = contract.predictivePreflightTask;
  if (!predictivePreflightTask) {
    issues.push("predictive_preflight_task_contract_missing");
  } else {
    checkTask({ contractTask: predictivePreflightTask, registry, issues, role: "predictive_preflight" });
    checkLiveTask({ contractTask: predictivePreflightTask, issues, role: "predictive_preflight" });
    const preflightRuntime = predictivePreflightTask.runtimeScript;
    if (!preflightRuntime || !fs.existsSync(preflightRuntime)) {
      issues.push(`predictive_preflight_runtime_script_missing:${preflightRuntime || "missing"}`);
    } else {
      const preflightRuntimeText = fs.readFileSync(preflightRuntime, "utf8");
      if (!hasAll(preflightRuntimeText, predictivePreflightTask.runtimeMustContain || [])) {
        issues.push("predictive_preflight_runtime_contract_missing");
      }
    }
  }
  for (const task of contract.naturalEvidenceTasks || []) {
    checkTask({ contractTask: task, registry, issues, role: "natural_evidence" });
    checkLiveTask({ contractTask: task, issues, role: "natural_evidence" });
  }
  checkTask({ contractTask: contract.finalVerdictTask, registry, issues, role: "final_verdict" });
  checkLiveTask({ contractTask: contract.finalVerdictTask, issues, role: "final_verdict" });
  for (const task of contract.rewaterTasks || []) {
    checkTask({ contractTask: task, registry, issues, role: "rewater" });
    checkLiveTask({ contractTask: task, issues, role: "rewater" });
  }

  const scripts = pkg.scripts || {};
  for (const scriptName of contract.requiredPackageScripts || []) {
    if (!scripts[scriptName]) issues.push(`package_script_missing:${scriptName}`);
  }
  if (!scripts["verify:terminal-unattended-root"] || !scripts["verify:terminal-unattended-root"].includes("verify:daytrade-warmup-root")) {
    issues.push("terminal_unattended_root_missing_verify_daytrade_warmup_root");
  }
  if (!scripts["verify:daytrade-warmup-root"] || !scripts["verify:daytrade-warmup-root"].includes("verify:daytrade-warmup-schedule-self-heal")) {
    issues.push("verify_daytrade_warmup_root_missing_schedule_self_heal_verifier");
  }

  const runtimeScript = contract.finalVerdictTask && contract.finalVerdictTask.runtimeScript;
  if (runtimeScript) {
    if (!fs.existsSync(runtimeScript)) {
      issues.push(`runtime_script_missing:${runtimeScript}`);
    } else {
      const runtimeText = fs.readFileSync(runtimeScript, "utf8");
      if (!hasAll(runtimeText, contract.finalVerdictTask.runtimeMustContain || [])) {
        issues.push("final_verdict_runtime_missing_root_apply_wiring");
      }
    }
  }

  const excluded = new Set(contract.excludedFromWarmupGate || []);
  for (const item of ["membership", "terminal_ui", "/88", "desktop", "mobile"]) {
    if (!excluded.has(item)) issues.push(`warmup_exclusion_missing:${item}`);
  }

  const payload = {
    ok: issues.length === 0,
    contract: CONTRACT,
    live: LIVE,
    checked_at: new Date().toISOString(),
    schedule_registry: REGISTRY_PATH,
    contract_path: CONTRACT_PATH,
    final_verdict_runtime: runtimeScript || null,
    self_heal_runner: SELF_HEAL_RUNNER_PATH,
    natural_gate_runtime: naturalGateRuntimePath,
    predictive_preflight_runtime: predictivePreflightRuntimePath,
    predictive_preflight_wrapper: predictivePreflightWrapperPath,
    predictive_preflight_task: predictivePreflightTask ? predictivePreflightTask.name : null,
    natural_evidence_tasks: (contract.naturalEvidenceTasks || []).map((task) => task.name),
    rewater_tasks: (contract.rewaterTasks || []).map((task) => task.name),
    final_verdict_task: contract.finalVerdictTask ? contract.finalVerdictTask.name : null,
    excluded_from_warmup_gate: contract.excludedFromWarmupGate || [],
    invariants: contract.invariants || [],
    issues,
  };
  console.log(JSON.stringify(payload, null, 2));
  process.exitCode = payload.ok ? 0 : 1;
}

main();
