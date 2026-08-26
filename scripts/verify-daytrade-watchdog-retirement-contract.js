"use strict";

const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const TASK = "Fuman Fugle Daytrade Watchdog Every Minute";
const files = ["ops/public-slot/install-daytrade-source-control-tasks.ps1", "scripts/run-daytrade-warmup-self-heal.js", "scripts/run-terminal-self-heal-job-queue.js", "scripts/verify-fugle-websocket-sources.js"];
const registry = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "fuman-schedule-registry.json"), "utf8"));
const checks = {
  retired_installer_absent: !fs.existsSync(path.join(ROOT, "ops", "public-slot", "install-daytrade-unattended-watchdog-task.ps1")),
  legacy_contract_absent: !fs.existsSync(path.join(ROOT, "ops", "daytrade-warmup-schedule-self-heal-contract.json")),
  repository_wiring_absent: files.every((relative) => !fs.readFileSync(path.join(ROOT, relative), "utf8").includes(TASK)),
  registry_active_task_absent: !(registry.policy && Array.isArray(registry.policy.activeTasks) && registry.policy.activeTasks.includes(TASK)),
  registry_task_definition_absent: !(registry.tasks || []).some((item) => item.displayName === TASK || item.taskName === "\\" + TASK),
  registry_allowed_results_absent: !(registry.policy && registry.policy.allowedResults && Object.prototype.hasOwnProperty.call(registry.policy.allowedResults, TASK)),
};
const failed_checks = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
console.log(JSON.stringify({ ok: failed_checks.length === 0, contract: "daytrade_watchdog_retirement_contract_v1", checked_at: new Date().toISOString(), task: TASK, checks, failed_checks, first_blocker: failed_checks[0] || null, read_only: true }, null, 2));
process.exitCode = failed_checks.length ? 1 : 0;
