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
    "[pscustomobject]@{ TaskName = $task.TaskName; TaskPath = $task.TaskPath; State = $task.State.ToString(); LastTaskResult = $info.LastTaskResult; LastRunTime = $info.LastRunTime; NextRunTime = $info.NextRunTime; Actions = $actions } | ConvertTo-Json -Depth 8 -Compress",
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
  if (task.State !== "Ready") issues.push(`${role}:${contractTask.name}:live_state_not_ready:${task.State || "missing"}`);
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


