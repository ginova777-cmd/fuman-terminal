"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const STATE_FILE = path.join(ROOT, "outputs", "terminal-orchestrator", "terminal-orchestrator-state.json");
const QUEUE_FILE = path.join(ROOT, "outputs", "terminal-orchestrator", "terminal-job-queue.json");

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

function verifyCurrentArtifact(issues) {
  const state = readJson(STATE_FILE, {});
  const queue = readJson(QUEUE_FILE, []);
  const contract = state.stateMachineContract || {};
  const lifecycle = Array.isArray(contract.lifecycle) ? contract.lifecycle : [];
  const failureStates = Array.isArray(contract.failureStates) ? contract.failureStates : [];
  const allowedStates = new Set([...lifecycle, ...failureStates]);

  assert(state.contract === "terminal-orchestrator-state-v1", "orchestrator_contract_mismatch", { contract: state.contract }, issues);
  assert(contract.contract === "terminal-state-machine-v1", "state_machine_contract_missing", { contract }, issues);
  for (const required of ["PENDING", "WATER_OK", "RUNNING", "SCANNED", "PUBLISHED", "DISPLAY_VERIFIED", "CLOSED"]) {
    assert(lifecycle.includes(required), `lifecycle_missing_${required}`, { lifecycle }, issues);
  }
  for (const required of ["BLOCKED_SOURCE", "BLOCKED_AUTH", "FAILED_SCAN", "FAILED_PUBLISH", "FAILED_DISPLAY", "DEGRADED_PREVIOUS_GOOD"]) {
    assert(failureStates.includes(required), `failure_state_missing_${required}`, { failureStates }, issues);
  }
  assert((contract.invariants || []).includes("fallback_or_previous_good_cannot_publish_today_success"), "fallback_invariant_missing", { invariants: contract.invariants }, issues);
  assert((contract.invariants || []).includes("auth_blocker_requires_manual_service_token_repair"), "auth_invariant_missing", { invariants: contract.invariants }, issues);

  const modules = Array.isArray(state.modules) ? state.modules : [];
  assert(modules.length >= 7, "module_states_missing", { modules: modules.length }, issues);
  for (const row of modules) {
    assert(allowedStates.has(row.lifecycleStage), "module_lifecycle_stage_invalid", { key: row.key, lifecycleStage: row.lifecycleStage }, issues);
    assert(row.state === "CLOSED" ? row.lifecycleStage === "CLOSED" : true, "closed_module_not_closed_lifecycle", { key: row.key, state: row.state, lifecycleStage: row.lifecycleStage }, issues);
  }

  assert(Array.isArray(queue), "queue_not_array", { queue }, issues);
  for (const job of queue) {
    assert(Boolean(job.idempotencyKey), "job_missing_idempotency_key", job, issues);
    assert(job.retryPolicy && Number.isFinite(Number(job.retryPolicy.maxAttempts)), "job_missing_retry_policy", job, issues);
    if (String(job.state || "").includes("AUTH")) {
      assert(job.retryPolicy.maxAttempts === 0 && job.retryPolicy.manualRepairRequired === true, "auth_job_must_not_auto_retry", job, issues);
    }
    if (String(job.state || "").includes("SOURCE")) {
      const reasonCode = String(job.reasonCode || "");
      const command = String(job.command || "");
      if (reasonCode === "outside_formal_source_window_previous_good_hold") {
        assert(/verify:terminal-water-root/.test(command) && !/daytrade-warmup:self-heal/.test(command), "offsession_source_job_must_only_recheck_water_root", job, issues);
      } else if (reasonCode === "natural_warmup_websocket_not_ready") {
        assert(/daytrade-warmup:self-heal/.test(command) && /verify:fugle-websocket-sources/.test(command) && /verify:terminal-water-root/.test(command) && /verify:terminal-final-audit/.test(command), "natural_source_job_must_self_heal_websocket_and_final_audit", job, issues);
      } else {
        assert(/daytrade-warmup:self-heal/.test(command) && /verify:terminal-water-root/.test(command), "source_job_must_rewater_then_check_water_root", job, issues);
      }
    }
    if (["FAILED_SCAN", "FAILED_PUBLISH"].includes(job.state)) {
      assert(job.requiresWaterRootOk === true, "scan_publish_job_requires_water_root", job, issues);
    }
  }
}

function verifySyntheticJobs(issues) {
  const synthetic = [
    { key: "s1", state: "BLOCKED_AUTH", retryPolicy: { maxAttempts: 0, manualRepairRequired: true }, idempotencyKey: "20260717:s1:auth", command: "manual" },
    { key: "s2", state: "BLOCKED_SOURCE", retryPolicy: { maxAttempts: 12, manualRepairRequired: false }, idempotencyKey: "20260717:s2:source", reasonCode: "source_water_root_not_ready", command: "npm run daytrade-warmup:self-heal && npm run verify:terminal-water-root" },
    { key: "s3", state: "FAILED_SCAN", retryPolicy: { maxAttempts: 2, manualRepairRequired: false }, idempotencyKey: "20260717:s3:scan", command: "scanner", requiresWaterRootOk: true },
  ];
  assert(synthetic[0].retryPolicy.maxAttempts === 0, "synthetic_auth_retry_not_zero", synthetic[0], issues);
  assert(/daytrade-warmup:self-heal/.test(synthetic[1].command) && /verify:terminal-water-root/.test(synthetic[1].command), "synthetic_source_command_not_rewater_then_water_root", synthetic[1], issues);
  assert(synthetic[2].requiresWaterRootOk === true, "synthetic_scan_missing_water_gate", synthetic[2], issues);
}

function main() {
  const issues = [];
  verifyCurrentArtifact(issues);
  verifySyntheticJobs(issues);
  const ok = issues.length === 0;
  console.log(JSON.stringify({ ok, contract: "terminal-state-machine-contract-verifier-v1", issues }, null, 2));
  if (!ok) process.exit(1);
}

main();
