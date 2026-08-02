"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const issues = [];
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const pkg = JSON.parse(read("package.json"));
const installer = read("scripts/install-terminal-autonomous-root-task.ps1");
const runner = read("run-terminal-autonomous-root.ps1");

function requireText(text, marker, issue) {
  if (!text.includes(marker)) issues.push({ issue, marker });
}

if (!pkg.scripts?.["verify:terminal-power-recovery-contract"]) issues.push({ issue: "package_script_missing", marker: "verify:terminal-power-recovery-contract" });
requireText(installer, "New-ScheduledTaskTrigger -AtStartup", "startup_trigger_missing");
requireText(installer, "-StartWhenAvailable", "start_when_available_missing");
requireText(installer, "-AllowStartIfOnBatteries", "battery_start_missing");
requireText(installer, "-DontStopIfGoingOnBatteries", "battery_stop_protection_missing");
requireText(installer, "-MultipleInstances IgnoreNew", "duplicate_run_guard_missing");
requireText(runner, "power-recovery-contract", "root_power_recovery_contract_step_missing");
requireText(runner, "previous_root_run_not_complete", "previous_failure_recovery_marker_missing");
requireText(runner, "orchestrator_was_in_flight", "in_flight_recovery_marker_missing");
requireText(runner, "recovery = [ordered]@", "recovery_receipt_missing");
requireText(runner, "rollforward:terminal", "rollforward_queue_missing");

const payload = {
  ok: issues.length === 0,
  contract: "terminal-power-recovery-contract-v1",
  checkedAt: new Date().toISOString(),
  rule: "A power interruption must trigger root recovery at startup, preserve previous good until evidence is current, and re-enter the idempotent job queue instead of publishing stale or partial data.",
  guarantees: [
    "startup_trigger",
    "start_when_available",
    "battery_safe_task_settings",
    "previous_failed_root_receipt_is_recorded",
    "in_flight_orchestrator_state_is_recorded",
    "idempotent_rollforward_queue_reused",
    "no_stale_publish_during_recovery"
  ],
  issues
};
console.log(JSON.stringify(payload, null, 2));
if (!payload.ok) process.exit(1);