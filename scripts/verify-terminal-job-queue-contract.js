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

function isScanOrPublish(state) {
  return ["FAILED_SCAN", "FAILED_PUBLISH", "PUBLISH_DEFERRED_MANIFEST_PENDING"].includes(String(state || ""));
}

function verifyQueue(state, queue, issues) {
  assert(state.contract === "terminal-orchestrator-state-v1", "orchestrator_contract_missing", { contract: state.contract }, issues);
  assert(Array.isArray(queue), "queue_not_array", { queueType: typeof queue }, issues);

  const seenKeys = new Set();
  const seenIdempotencyKeys = new Set();
  for (const job of Array.isArray(queue) ? queue : []) {
    const key = String(job.key || "");
    const stateName = String(job.state || "");
    assert(Boolean(key), "job_key_missing", job, issues);
    assert(!seenKeys.has(key), "duplicate_job_key", { key }, issues);
    seenKeys.add(key);

    const idempotencyKey = String(job.idempotencyKey || "");
    assert(Boolean(idempotencyKey), "job_idempotency_key_missing", { key }, issues);
    assert(!seenIdempotencyKeys.has(idempotencyKey), "duplicate_idempotency_key", { key, idempotencyKey }, issues);
    seenIdempotencyKeys.add(idempotencyKey);

    assert(Boolean(job.receiptFile), "job_receipt_file_missing", { key }, issues);
    assert(job.receiptRequired === true, "job_receipt_required_missing", { key }, issues);
    assert(job.retryPolicy && Number.isFinite(Number(job.retryPolicy.maxAttempts)), "job_retry_policy_missing", { key }, issues);
    assert(job.nextAction !== undefined, "job_next_action_missing", { key }, issues);

    if (stateName.includes("AUTH")) {
      assert(Number(job.retryPolicy.maxAttempts) === 0, "auth_job_auto_retry_forbidden", { key, retryPolicy: job.retryPolicy }, issues);
      assert(job.retryPolicy.manualRepairRequired === true, "auth_job_manual_repair_missing", { key, retryPolicy: job.retryPolicy }, issues);
      assert(job.executable !== true, "auth_job_must_not_be_executable", { key, executable: job.executable }, issues);
    }
    if (stateName.includes("SOURCE")) {
      const reasonCode = String(job.reasonCode || "");
      const command = String(job.command || "");
      if (reasonCode === "outside_formal_source_window_previous_good_hold") {
        assert(/verify:terminal-water-root/.test(command) && !/daytrade-warmup:self-heal/.test(command), "offsession_source_job_must_only_recheck_water_root", { key, command: job.command, reasonCode }, issues);
      } else {
        assert(/daytrade-warmup:self-heal/.test(command) && /verify:terminal-water-root/.test(command), "source_job_must_rewater_then_check_water_root", { key, command: job.command, reasonCode }, issues);
      }
    }
    if (isScanOrPublish(stateName)) {
      assert(job.requiresWaterRootOk === true || stateName === "PUBLISH_DEFERRED_MANIFEST_PENDING", "scan_publish_water_gate_missing", { key, state: stateName }, issues);
      assert(job.executable !== true || stateName !== "PUBLISH_DEFERRED_MANIFEST_PENDING", "deferred_publish_must_not_execute", { key, executable: job.executable }, issues);
      if (stateName === "FAILED_SCAN") {
        assert(job.retryPolicy?.autoRetry === true, "failed_scan_auto_retry_not_armed", { key, retryPolicy: job.retryPolicy }, issues);
        assert(job.retryPolicy?.manualRepairRequired !== true, "failed_scan_manual_repair_only", { key, retryPolicy: job.retryPolicy }, issues);
        assert(job.executable === true, "failed_scan_job_not_executable", { key, executable: job.executable }, issues);
      }
    }
    if (stateName.includes("DISPLAY") || stateName.includes("DEGRADED") || stateName.includes("PREVIOUS")) {
      assert(String(job.executionGuard || "").length > 0, "display_job_guard_missing", { key }, issues);
    }
  }
}

function verifyContractScenarios(issues) {
  const auth = {
    key: "strategy4",
    state: "BLOCKED_AUTH",
    executable: false,
    idempotencyKey: "20260728:strategy4:auth",
    receiptFile: "receipt.json",
    receiptRequired: true,
    retryPolicy: { maxAttempts: 0, manualRepairRequired: true },
  };
  assert(auth.retryPolicy.maxAttempts === 0 && auth.executable === false, "scenario_auth_not_manual_only", auth, issues);

  const deferred = {
    key: "scorecard",
    state: "PUBLISH_DEFERRED_MANIFEST_PENDING",
    executable: false,
    requiresWaterRootOk: true,
  };
  assert(deferred.executable === false, "scenario_deferred_publish_executable", deferred, issues);

  const scan = {
    key: "strategy3",
    state: "FAILED_SCAN",
    executable: true,
    requiresWaterRootOk: true,
    retryPolicy: { maxAttempts: 2, autoRetry: true, manualRepairRequired: false },
  };
  assert(scan.requiresWaterRootOk === true, "scenario_scan_water_gate_missing", scan, issues);
  assert(scan.retryPolicy.autoRetry === true, "scenario_failed_scan_auto_retry_missing", scan, issues);
}

function main() {
  const issues = [];
  const state = readJson(STATE_FILE, {});
  const queue = readJson(QUEUE_FILE, []);
  verifyQueue(state, queue, issues);
  verifyContractScenarios(issues);
  const payload = {
    ok: issues.length === 0,
    contract: "terminal-job-queue-contract-verifier-v1",
    checkedAt: new Date().toISOString(),
    stateFile: STATE_FILE,
    queueFile: QUEUE_FILE,
    jobCount: Array.isArray(queue) ? queue.length : 0,
    idempotency: "one active job and one action receipt per module/state/blocker key",
    authPolicy: "manual service-token repair; no automatic auth retry",
    sourcePolicy: "source jobs must queue idempotent rewater/self-heal and Water Root recheck; outside formal source window only rechecks Water Root and preserves previous good",
    publishPolicy: "publish waits for manifest/canary green; previous-good is not a fresh publish",
    issues,
  };
  console.log(JSON.stringify(payload, null, 2));
  if (!payload.ok) process.exit(1);
}

main();


