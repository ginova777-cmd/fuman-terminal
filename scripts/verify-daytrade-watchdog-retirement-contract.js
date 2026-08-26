"use strict";

const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const DAYTRADE_TASK = "Fuman Fugle Daytrade Watchdog Every Minute";
const SHARED_TASK = "Fuman Public Slot Shared Source Watchdog";
const RETIRED_TASKS = [DAYTRADE_TASK, SHARED_TASK];
const registry = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "fuman-schedule-registry.json"), "utf8"));
const contains = (relative, value) => fs.readFileSync(path.join(ROOT, relative), "utf8").includes(value);
const isRegistered = (task) => (registry.tasks || []).some((item) => item.displayName === task || String(item.taskName || "").replace(/^\\+/, "") === task);
const isActive = (task) => Boolean(registry.policy && Array.isArray(registry.policy.activeTasks) && registry.policy.activeTasks.includes(task));
const hasAllowedResult = (task) => Boolean(registry.policy && registry.policy.allowedResults && Object.prototype.hasOwnProperty.call(registry.policy.allowedResults, task));
const checks = {
  daytrade_retired_installer_absent: !fs.existsSync(path.join(ROOT, "ops", "public-slot", "install-daytrade-unattended-watchdog-task.ps1")),
  daytrade_legacy_contract_absent: !fs.existsSync(path.join(ROOT, "ops", "daytrade-warmup-schedule-self-heal-contract.json")),
  daytrade_repository_wiring_absent: ["ops/public-slot/install-daytrade-source-control-tasks.ps1", "scripts/run-daytrade-warmup-self-heal.js", "scripts/run-terminal-self-heal-job-queue.js"].every((relative) => !contains(relative, DAYTRADE_TASK)),
  shared_source_verifier_dependency_absent: !contains("scripts/verify-fugle-websocket-sources.js", SHARED_TASK),
  registry_active_tasks_absent: RETIRED_TASKS.every((task) => !isActive(task)),
  registry_task_definitions_absent: RETIRED_TASKS.every((task) => !isRegistered(task)),
  registry_allowed_results_absent: RETIRED_TASKS.every((task) => !hasAllowedResult(task)),
};
const failed_checks = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
console.log(JSON.stringify({ ok: failed_checks.length === 0, contract: "daytrade_watchdog_retirement_contract_v2", checked_at: new Date().toISOString(), retired_tasks: RETIRED_TASKS, checks, failed_checks, first_blocker: failed_checks[0] || null, read_only: true }, null, 2));
process.exitCode = failed_checks.length ? 1 : 0;
