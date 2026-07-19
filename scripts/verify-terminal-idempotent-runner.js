"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const ROLL_FORWARD_FILE = path.join(ROOT, "outputs", "terminal-roll-forward", "terminal-auto-roll-forward.json");
const ORCHESTRATOR_FILE = path.join(ROOT, "outputs", "terminal-orchestrator", "terminal-orchestrator-state.json");

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function assert(condition, issue, details, issues) {
  if (!condition) issues.push({ issue, details });
}

function verifyCurrent(issues) {
  const rollForward = readJson(ROLL_FORWARD_FILE, {});
  const orchestrator = readJson(ORCHESTRATOR_FILE, {});
  const actions = Array.isArray(rollForward.actions) ? rollForward.actions : [];
  const jobs = Array.isArray(orchestrator.jobQueue) ? orchestrator.jobQueue : [];

  assert(rollForward.contract === "terminal-auto-roll-forward-v1", "roll_forward_contract_mismatch", { contract: rollForward.contract }, issues);
  assert(rollForward.idempotencyContract?.contract === "terminal-idempotent-runner-v1", "idempotency_contract_missing", { idempotencyContract: rollForward.idempotencyContract }, issues);
  assert(Array.isArray(rollForward.idempotencyContract?.invariants) && rollForward.idempotencyContract.invariants.includes("every_job_has_idempotency_key"), "idempotency_invariants_missing", { idempotencyContract: rollForward.idempotencyContract }, issues);

  for (const action of actions) {
    assert(Boolean(action.idempotencyKey), "action_missing_idempotency_key", action, issues);
    assert(Boolean(action.receiptFile), "action_missing_receipt_file", action, issues);
    if (String(action.state || "").includes("AUTH")) {
      assert(action.executable !== true, "auth_action_must_not_execute", action, issues);
    }
    if (String(action.state || "").includes("SCAN")) {
      assert(["scanner_requires_apply_scanners", "scanner_apply_enabled", "formal_scan_not_allowed_by_policy"].includes(action.executionGuard), "scanner_action_guard_invalid", action, issues);
      assert(action.commands.some((cmd) => String(cmd.label || "").includes("terminal-water-root")), "scanner_action_missing_water_root_precheck", action, issues);
      if (action.executionGuard === "formal_scan_not_allowed_by_policy") {
        assert(action.executable !== true, "scanner_policy_block_must_not_execute", action, issues);
      }
    }
    if (String(action.state || "").includes("PUBLISH")) {
      assert(action.commands.some((cmd) => String(cmd.label || "").includes("daily-terminal-run")), "publish_action_missing_manifest_refresh", action, issues);
    }
  }

  for (const job of jobs) {
    assert(Boolean(job.idempotencyKey), "job_queue_missing_idempotency_key", job, issues);
    assert(job.retryPolicy && Number.isFinite(Number(job.retryPolicy.maxAttempts)), "job_queue_missing_retry_policy", job, issues);
  }
}

function verifySynthetic(issues) {
  const synthetic = [
    { state: "BLOCKED_AUTH", executable: false, idempotencyKey: "20260717:strategy4:auth", receiptFile: "r.json" },
    { state: "FAILED_SCAN", executable: false, executionGuard: "scanner_requires_apply_scanners", idempotencyKey: "20260717:strategy3:scan", receiptFile: "r.json", commands: [{ label: "npm:verify:terminal-water-root" }] },
    { state: "FAILED_PUBLISH", executable: false, idempotencyKey: "20260717:scorecard:publish", receiptFile: "r.json", commands: [{ label: "npm:manifest:daily-terminal-run" }] },
  ];
  for (const action of synthetic) {
    assert(Boolean(action.idempotencyKey), "synthetic_missing_idempotency_key", action, issues);
    assert(Boolean(action.receiptFile), "synthetic_missing_receipt_file", action, issues);
  }
  assert(synthetic[0].executable === false, "synthetic_auth_executable", synthetic[0], issues);
  assert(synthetic[1].commands.some((cmd) => cmd.label.includes("terminal-water-root")), "synthetic_scan_missing_water_root", synthetic[1], issues);
  assert(synthetic[2].commands.some((cmd) => cmd.label.includes("daily-terminal-run")), "synthetic_publish_missing_manifest", synthetic[2], issues);
}

function main() {
  const issues = [];
  verifyCurrent(issues);
  verifySynthetic(issues);
  const ok = issues.length === 0;
  console.log(JSON.stringify({ ok, contract: "terminal-idempotent-runner-verifier-v1", issues }, null, 2));
  if (!ok) process.exit(1);
}

main();
