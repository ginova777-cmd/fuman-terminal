const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { classifyReason } = require("../lib/terminal-reason-code-classifier");
const { visibleCredentialState } = require("../lib/protected-readback-credential");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.resolve(process.argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length) || "outputs/terminal-roll-forward");
const RECEIPT_DIR = path.join(OUT_DIR, "receipts");
const PROTECTED_READBACK_CREDENTIAL_FILE = path.join(ROOT, "outputs", "protected-readback-credential", "protected-readback-credential.json");
const WATER_ROOT_FILE = path.join(ROOT, "outputs", "terminal-water-root", "terminal-water-root.json");
const IDEMPOTENCY_CONTRACT = {
  contract: "terminal-idempotent-runner-v1",
  invariants: [
    "every_job_has_idempotency_key",
    "every_job_has_receipt_file",
    "auth_jobs_never_auto_execute",
    "scanner_jobs_require_water_root_and_apply_scanners",
    "scanner_jobs_require_current_water_root_ok",
    "scanner_jobs_require_policy_formal_scan_allowed",
    "completed_action_receipts_skip_reexecution",
    "publish_jobs_require_manifest_canary_gate",
    "deferred_publish_jobs_never_auto_execute",
  ],
};
const APPLY = process.argv.includes("--apply");
const APPLY_SCANNERS = process.argv.includes("--apply-scanners");
const SELF_TEST = process.argv.includes("--self-test");
const ALLOW_DEGRADED_PUBLISH = process.argv.includes("--allow-degraded-publish");
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";


function compactReasonClassification(input = {}) {
  const classification = classifyReason(input);
  const codes = Array.isArray(classification.codes) ? classification.codes : [];
  return {
    reasonCodes: codes.map((row) => row.code).filter(Boolean),
    primaryReasonCode: classification.primaryCode || codes[0]?.code || "",
    reasonActions: [...new Set(codes.map((row) => row.action).filter(Boolean))],
    reasonLayers: [...new Set(codes.map((row) => row.layer).filter(Boolean))],
    reasonSeverity: codes.some((row) => row.severity === "critical") ? "critical" : codes[0]?.severity || "",
    reasonUnknown: classification.unknown === true,
  };
}

function buildReasonCodeSummary(actions = []) {
  return {
    contract: "terminal-roll-forward-reason-code-summary-v1",
    ok: actions.every((row) => row.reasonUnknown !== true),
    actions: actions.length,
    unknownActions: actions.filter((row) => row.reasonUnknown === true).length,
    criticalActions: actions.filter((row) => row.reasonSeverity === "critical").length,
    codes: [...new Set(actions.flatMap((row) => row.reasonCodes || []))].sort(),
  };
}
function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function runCommand(step) {
  const command = String(step.command || "");
  const result = spawnSync(command, step.args || [], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env },
    shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(command),
  });
  return {
    label: step.label,
    command: printable(step),
    exitCode: result.status ?? 1,
    ok: result.status === 0,
    stdout: String(result.stdout || "").slice(-3000),
    stderr: String(result.stderr || "").slice(-3000),
  };
}

function printable(step) {
  return [step.command, ...(step.args || [])].join(" ");
}

function npmRun(script, extraArgs = []) {
  return {
    command: npmBin,
    args: ["run", script, ...extraArgs],
    label: `npm:${script}`,
  };
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function protectedReadbackCredentialArmed() {
  try {
    const state = visibleCredentialState();
    if (state.tokenArmed === true) return true;
    if (state.emailArmed === true && state.passwordArmed === true) return true;
  } catch {
    // Fall back to the verifier artifact below.
  }
  const credential = readJson(PROTECTED_READBACK_CREDENTIAL_FILE, {});
  return credential?.ok === true && credential?.armed === true;
}

function waterRootFormalEntryAllowed(waterRoot = {}) {
  const canonical = waterRoot.canonicalGate || {};
  const sourcePayload = waterRoot.sourceStatus?.row?.payload || waterRoot.sourceStatus?.payload || {};
  const sourceRow = waterRoot.sourceStatus?.row || waterRoot.sourceStatus || {};
  return canonical.formalEntryAllowed === true
    || canonical.formal_entry_allowed === true
    || sourcePayload.formal_entry_allowed === true
    || sourceRow.formalEntryAllowed === true
    || sourceRow.formal_entry_allowed === true;
}

function scannerWaterRootGate(waterRoot = null) {
  const artifact = waterRoot || readJson(WATER_ROOT_FILE, null);
  if (!artifact) {
    return { ok: false, guard: "water_root_artifact_missing_scanner_blocked", reason: "water_root_artifact_missing" };
  }
  if (artifact.ok !== true) {
    return { ok: false, guard: "water_root_not_ok_scanner_blocked", reason: artifact.reason || artifact.status || "water_root_not_ok" };
  }
  if (!waterRootFormalEntryAllowed(artifact)) {
    return { ok: false, guard: "formal_entry_not_allowed_by_water_root", reason: artifact.reason || artifact.status || "formal_entry_not_allowed" };
  }
  return { ok: true, guard: "water_root_ok_formal_entry_allowed", reason: "ok" };
}
function requiresProtectedReadbackCredential(action = {}) {
  const codes = Array.isArray(action.reasonCodes) ? action.reasonCodes : [];
  const text = `${action.blocker || ""} ${action.nextAction || ""} ${(action.notes || []).join(" ")}`.toLowerCase();
  return codes.includes("AUTH_PROTECTED_READBACK_NOT_ARMED")
    || text.includes("protected_surface_needs_authenticated_readback_token")
    || text.includes("authenticated_readback")
    || text.includes("membership");
}

function safeId(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 180);
}

function actionIdempotencyKey(job = {}, key = "unknown", state = "PENDING") {
  return safeId(job.idempotencyKey || [currentTradeDate(), key, state, job.blocker || "none"].join(":"));
}

function receiptFileFor(action = {}) {
  return path.join(RECEIPT_DIR, `${safeId(action.idempotencyKey || action.key || action.label)}.json`);
}

function readActionReceipt(action = {}) {
  if (!action.receiptFile) return null;
  const receipt = readJson(action.receiptFile, null);
  if (!receipt || receipt.contract !== "terminal-auto-roll-forward-action-receipt-v1") return null;
  if (receipt.idempotencyKey !== action.idempotencyKey) return null;
  return receipt;
}

function completedReceipt(action = {}) {
  const receipt = readActionReceipt(action);
  return receipt?.ok === true && receipt?.status === "complete" ? receipt : null;
}

async function writeActionReceipt(action = {}, status = "complete", results = [], extra = {}) {
  if (!action.receiptFile) return null;
  const payload = {
    contract: "terminal-auto-roll-forward-action-receipt-v1",
    checkedAt: new Date().toISOString(),
    key: action.key || "",
    label: action.label || action.key || "",
    state: action.state || "",
    executionGuard: action.executionGuard || "",
    idempotencyKey: action.idempotencyKey || "",
    status,
    ok: status === "complete",
    skipped: extra.skipped === true,
    blocker: action.blocker || "",
    commands: action.commands.map(printable),
    results,
    ...extra,
  };
  await fs.promises.mkdir(path.dirname(action.receiptFile), { recursive: true });
  await fs.promises.writeFile(action.receiptFile, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return payload;
}

function normalizeJobs(orchestrator = {}, queue = []) {
  if (Array.isArray(queue) && queue.length) return queue;
  if (Array.isArray(orchestrator.jobQueue)) return orchestrator.jobQueue;
  return [];
}

function planForJob(job = {}, policy = {}, options = {}) {
  const state = String(job.state || "PENDING");
  const key = String(job.key || "unknown");
  const policyDecision = policy.decision || {};
  const base = {
    key,
    label: job.label || key,
    state,
    priority: Number(job.priority ?? 80),
    blocker: job.blocker || "",
    nextAction: job.nextAction || "",
    executable: false,
    executionGuard: "not_classified",
    commands: [],
    notes: [],
    idempotencyKey: actionIdempotencyKey(job, key, state),
    receiptFile: "",
    receiptRequired: true,
    ...compactReasonClassification({ key, label: job.label || key, state, blocker: job.blocker || "", nextAction: job.nextAction || "" }),
  };
  base.receiptFile = receiptFileFor(base);

  if (state.includes("AUTH")) {
    base.executionGuard = "blocked_auth_requires_service_token_repair";
    base.notes.push("Auth failures are never auto-executed; membership display auth must not be confused with backend service token auth.");
    return base;
  }

  if (state.includes("SOURCE")) {
    base.executable = true;
    base.executionGuard = "source_check_only_no_scanner_publish";
    base.commands.push(npmRun("verify:terminal-water-root"));
    base.notes.push("Source recovery only rechecks root water; scanner/publish waits for water root PASS.");
    return base;
  }

  if (state.includes("SCAN")) {
    const formalScanAllowed = policyDecision.formalScanAllowed === true || policy.actionMatrix?.formalScan?.allowed === true;
    const scannerApply = options.applyScanners === true || APPLY_SCANNERS;
    const waterGate = scannerWaterRootGate(options.waterRoot || null);
    base.commands.push(npmRun("verify:terminal-water-root"));
    if (!waterGate.ok) {
      base.executionGuard = waterGate.guard;
      base.executable = false;
      base.notes.push(`Scanner reruns are blocked until current Water Root PASS and formal entry is allowed: ${waterGate.reason}`);
      return base;
    }
    if (!formalScanAllowed) {
      base.executionGuard = "formal_scan_not_allowed_by_policy";
      base.executable = false;
      base.notes.push("Scanner reruns are blocked unless Autonomous Ops Policy explicitly allows formalScan.");
      return base;
    }
    base.executionGuard = scannerApply ? "scanner_apply_enabled" : "scanner_requires_apply_scanners";
    base.executable = scannerApply;
    const scannerCommand = scannerStepForKey(key, job.command);
    if (scannerCommand) base.commands.push(scannerCommand);
    base.notes.push("Scanner reruns are idempotent-only, require current Water Root PASS, formal entry allowed, --apply --apply-scanners, and policy formalScanAllowed=true.");
    return base;
  }

  if (state === "PUBLISH_DEFERRED_MANIFEST_PENDING") {
    base.executionGuard = "manifest_pending_publish_deferred";
    base.executable = false;
    base.commands.push(npmRun("manifest:daily-terminal-run"));
    base.commands.push(npmRun("verify:daily-terminal-run-manifest"));
    base.notes.push("Scorecard publish waits until every due module reaches full Manifest green; no publish is executed while later modules are pending/not-due.");
    return base;
  }

  if (state.includes("PUBLISH")) {
    const publishAllowed = policyDecision.scorecardPublishAllowed === true || ALLOW_DEGRADED_PUBLISH;
    base.executable = publishAllowed;
    base.executionGuard = publishAllowed ? "manifest_gated_publish" : "manifest_not_green_publish_blocked";
    base.commands.push(npmRun("manifest:daily-terminal-run"));
    base.commands.push(npmRun("verify:daily-terminal-run-manifest"));
    if (publishAllowed) base.commands.push(npmRun("scorecard:publish"));
    base.notes.push("Scorecard publish is manifest-gated; previous good preserve is not a successful new publish.");
    return base;
  }

  if (state.includes("DISPLAY") || state.includes("DEGRADED") || state.includes("PREVIOUS")) {
    if (requiresProtectedReadbackCredential(base) && !protectedReadbackCredentialArmed()) {
      base.executable = false;
      base.executionGuard = "protected_readback_credential_not_armed";
      base.commands.push(npmRun("verify:protected-readback-credential"));
      base.notes.push("Protected display readback cannot auto-execute until the member readback credential is armed; this is a manual secret repair, not a scanner retry.");
      return base;
    }
    base.executable = true;
    base.executionGuard = "display_snapshot_readback_only";
    base.commands.push(npmRun("snapshot:desktop"));
    base.commands.push(npmRun("verify:terminal-resource-chain:unattended", ["--", `--expected-date=${currentTradeDate()}`]));
    base.notes.push("Display repair rebuilds terminal snapshots and verifies desktop/mobile/88 runId closure.");
    return base;
  }

  base.executionGuard = "unhandled_state_plan_only";
  base.notes.push("Unknown state is planned only until a safe executor mapping exists.");
  return base;
}

function scannerStepForKey(key, fallbackCommand = "") {
  const map = {
    strategy2: npmRun("verify:strategy2-e2e-closure"),
    strategy3: npmRun("verify:daytrade-strategy3-closure-live"),
    strategy5: npmRun("verify:strategy5-e2e-closure"),
    institution: npmRun("verify:institution-e2e-closure"),
    cb: npmRun("verify:cb-live-readback"),
    warrant: npmRun("verify:warrant-live-closure"),
  };
  if (map[key]) return map[key];
  if (key === "strategy4") {
    return {
      command: process.platform === "win32" ? "pwsh.exe" : "pwsh",
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ".\\run-strategy4.ps1"],
      label: "scanner:strategy4",
    };
  }
  if (String(fallbackCommand).startsWith("npm run verify:")) {
    const parts = fallbackCommand.split(/\s+/).filter(Boolean);
    return { command: npmBin, args: parts.slice(1), label: `scanner:${key}:fallback` };
  }
  return null;
}

function currentTradeDate() {
  const manifest = readJson(path.join(ROOT, "outputs", "daily-terminal-run", "daily-terminal-run-latest.json"), {});
  return String(manifest.tradeDate || "").replace(/\D/g, "").slice(0, 8) || "latest";
}

function buildSafeRecoveryPreview(jobs = [], policy = {}) {
  const actions = jobs.map((job) => planForJob(job, policy, { applyScanners: true }));
  const blocked = actions.filter((action) => !action.executable && action.state !== "CLOSED");
  const executable = actions.filter((action) => action.executable);
  const decision = decide(actions, policy);
  return {
    contract: "terminal-safe-recovery-preview-v1",
    ok: decision.ok === true,
    state: decision.state || "",
    reason: decision.reason || "",
    executableJobs: executable.length,
    blockedJobs: blocked.length,
    executableKeys: executable.map((row) => row.key),
    blockedKeys: blocked.map((row) => row.key),
    commandHint: executable.length ? "node --use-system-ca scripts/run-terminal-auto-roll-forward.js --apply --apply-scanners" : "",
    reasonCodeSummary: buildReasonCodeSummary(actions),
  };
}
function buildPlan({ orchestrator, policy, queue }) {
  const jobs = normalizeJobs(orchestrator, queue).sort((a, b) => Number(a.priority ?? 80) - Number(b.priority ?? 80));
  const actions = jobs.map((job) => planForJob(job, policy));
  const blocked = actions.filter((action) => !action.executable && action.state !== "CLOSED");
  const executable = actions.filter((action) => action.executable);
  return {
    contract: "terminal-auto-roll-forward-v1",
    checkedAt: new Date().toISOString(),
    mode: APPLY ? "apply" : "dry-run",
    applyScanners: APPLY_SCANNERS,
    tradeDate: currentTradeDate(),
    policyState: policy.decision?.opsState || "",
    autoRecoveryAllowed: policy.decision?.autoRecoveryAllowed === true,
    jobs: jobs.length,
    executableJobs: executable.length,
    blockedJobs: blocked.length,
    actions,
    idempotencyContract: IDEMPOTENCY_CONTRACT,
    reasonCodeSummary: buildReasonCodeSummary(actions),
    safeRecoveryPreview: buildSafeRecoveryPreview(jobs, policy),
    decision: decide(actions, policy),
  };
}

function decide(actions, policy) {
  if (!actions.length) {
    return {
      ok: true,
      state: "IDLE_NO_RETRY_NEEDED",
      reason: "job_queue_empty",
      applyAllowed: false,
    };
  }
  if (policy.decision?.autoRecoveryAllowed !== true) {
    return {
      ok: false,
      state: "AUTO_RECOVERY_DISABLED",
      reason: policy.decision?.reason || "policy_disallows_auto_recovery",
      applyAllowed: false,
    };
  }

  const executable = actions.filter((action) => action.executable === true);
  const blocked = actions.filter((action) => action.executable !== true && action.state !== "CLOSED");
  const authBlocked = blocked.filter((action) => action.state.includes("AUTH") || requiresProtectedReadbackCredential(action));
  const nonAuthBlocked = blocked.filter((action) => !authBlocked.includes(action));

  if (executable.length && authBlocked.length) {
    return {
      ok: true,
      state: APPLY ? "PARTIAL_AUTO_ROLL_FORWARD_APPLY_ARMED_WITH_AUTH_BLOCKERS" : "PARTIAL_AUTO_ROLL_FORWARD_DRY_RUN_READY_WITH_AUTH_BLOCKERS",
      reason: "safe_jobs_ready_auth_jobs_manual",
      applyAllowed: true,
      partial: true,
      executableJobs: executable.length,
      blockedJobs: blocked.length,
    };
  }
  if (executable.length && nonAuthBlocked.length) {
    return {
      ok: true,
      state: APPLY ? "PARTIAL_AUTO_ROLL_FORWARD_APPLY_ARMED_WITH_BLOCKERS" : "PARTIAL_AUTO_ROLL_FORWARD_DRY_RUN_READY_WITH_BLOCKERS",
      reason: `safe_jobs_ready_blocked:${nonAuthBlocked[0].key}:${nonAuthBlocked[0].executionGuard}`,
      applyAllowed: true,
      partial: true,
      executableJobs: executable.length,
      blockedJobs: blocked.length,
    };
  }
  const auth = authBlocked[0];
  if (auth) {
    return {
      ok: false,
      state: "BLOCKED_AUTH_MANUAL_REPAIR_REQUIRED",
      reason: auth.blocker || "auth_blocker",
      applyAllowed: false,
    };
  }
  const unhandled = nonAuthBlocked[0];
  if (unhandled) {
    return {
      ok: false,
      state: "PLAN_HAS_NON_EXECUTABLE_JOB",
      reason: `${unhandled.key}:${unhandled.executionGuard}`,
      applyAllowed: false,
    };
  }
  return {
    ok: true,
    state: APPLY ? "AUTO_ROLL_FORWARD_APPLY_ARMED" : "AUTO_ROLL_FORWARD_DRY_RUN_READY",
    reason: APPLY ? "executing_safe_recovery_commands" : "dry_run_plan_only",
    applyAllowed: true,
  };
}
async function writeOutputs(plan, executed = []) {
  await fs.promises.mkdir(OUT_DIR, { recursive: true });
  await fs.promises.mkdir(RECEIPT_DIR, { recursive: true });
  const payload = { ...plan, executed };
  const jsonFile = path.join(OUT_DIR, "terminal-auto-roll-forward.json");
  const mdFile = path.join(OUT_DIR, "terminal-auto-roll-forward.md");
  await fs.promises.writeFile(jsonFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.promises.writeFile(mdFile, markdown(payload), "utf8");
  return { jsonFile, mdFile };
}

function markdown(plan) {
  const lines = [];
  lines.push("# Terminal Auto Roll Forward");
  lines.push("");
  lines.push(`- checkedAt: ${plan.checkedAt}`);
  lines.push(`- tradeDate: ${plan.tradeDate}`);
  lines.push(`- mode: ${plan.mode}`);
  lines.push(`- decision: ${plan.decision.state}`);
  lines.push(`- reason: ${plan.decision.reason}`);
  lines.push("");
  lines.push("## Actions");
  lines.push("| priority | module | state | executable | guard | idempotencyKey | receipt | commands | blocker |");
  lines.push("|---:|---|---|---:|---|---|---|---|---|");
  for (const action of plan.actions) {
    lines.push(`| ${action.priority} | ${action.label} | ${action.state} | ${action.executable} | ${action.executionGuard} | ${action.idempotencyKey || "--"} | ${action.receiptFile || "--"} | ${action.commands.map(printable).join("<br>") || "--"} | ${action.blocker || "--"} |`);
  }
  lines.push("");
  lines.push("## Executed");
  lines.push("| command | exitCode | ok |");
  lines.push("|---|---:|---:|");
  for (const result of plan.executed || []) {
    lines.push(`| ${result.command} | ${result.exitCode} | ${result.ok} |`);
  }
  return `${lines.join("\n")}\n`;
}

function selfTest() {
  const policy = { decision: { autoRecoveryAllowed: true, scorecardPublishAllowed: false, formalScanAllowed: true } };
  const waterOkFixture = { ok: true, canonicalGate: { formalEntryAllowed: true } };
  const waterBlockedFixture = { ok: false, status: "blocked", reason: "canonical_gate_not_A:D" };
  const waterFormalEntryBlockedFixture = { ok: true, canonicalGate: { formalEntryAllowed: false }, reason: "formal_entry_allowed_false" };
  const cases = [
    { name: "auth-block", job: { key: "strategy4", state: "BLOCKED_AUTH", blocker: "401" }, expectedExecutable: false, expectedGuard: "blocked_auth" },
    { name: "source-check", job: { key: "strategy2", state: "BLOCKED_SOURCE" }, expectedExecutable: true, expectedGuard: "source_check" },
    { name: "scan-dry", job: { key: "strategy3", state: "FAILED_SCAN" }, options: { waterRoot: waterOkFixture }, expectedExecutable: APPLY_SCANNERS, expectedGuard: APPLY_SCANNERS ? "scanner_apply" : "scanner_requires" },
    { name: "scan-water-block", job: { key: "strategy3", state: "FAILED_SCAN" }, options: { waterRoot: waterBlockedFixture, applyScanners: true }, expectedExecutable: false, expectedGuard: "water_root_not_ok_scanner_blocked" },
    { name: "scan-formal-entry-block", job: { key: "strategy3", state: "FAILED_SCAN" }, options: { waterRoot: waterFormalEntryBlockedFixture, applyScanners: true }, expectedExecutable: false, expectedGuard: "formal_entry_not_allowed_by_water_root" },
    { name: "scan-policy-block", policy: { decision: { autoRecoveryAllowed: true, scorecardPublishAllowed: false, formalScanAllowed: false } }, job: { key: "strategy3", state: "FAILED_SCAN" }, options: { waterRoot: waterOkFixture, applyScanners: true }, expectedExecutable: false, expectedGuard: "formal_scan_not_allowed" },
    { name: "display", job: { key: "strategy5", state: "FAILED_DISPLAY" }, expectedExecutable: true, expectedGuard: "display_snapshot" },
    { name: "display-auth-unarmed", job: { key: "strategy2", state: "FAILED_DISPLAY", blocker: "protected_surface_needs_authenticated_readback_token", nextAction: "refresh_terminal_snapshot_bundle_mobile_88_readback" }, expectedExecutable: protectedReadbackCredentialArmed(), expectedGuard: protectedReadbackCredentialArmed() ? "display_snapshot" : "protected_readback_credential_not_armed" },
    { name: "publish-blocked", job: { key: "scorecard", state: "FAILED_PUBLISH" }, expectedExecutable: false, expectedGuard: "manifest_not_green" },
    { name: "publish-deferred", job: { key: "scorecard", state: "PUBLISH_DEFERRED_MANIFEST_PENDING" }, expectedExecutable: false, expectedGuard: "manifest_pending_publish_deferred" },
  ];
  const failures = [];
  for (const item of cases) {
    const action = planForJob(item.job, item.policy || policy, item.options || {});
    if (action.executable !== item.expectedExecutable) failures.push(`${item.name}: executable ${action.executable} != ${item.expectedExecutable}`);
    if (!action.executionGuard.includes(item.expectedGuard)) failures.push(`${item.name}: guard ${action.executionGuard} missing ${item.expectedGuard}`);
    if (!Array.isArray(action.reasonCodes) || action.reasonCodes.length === 0 || action.reasonUnknown === true) failures.push(`${item.name}: reason codes missing or unknown`);
  }
  const partialDecision = decide([
    { key: "strategy4", state: "FAILED_SCAN", executable: true, blocker: "manifest_raw_fallback_true", executionGuard: "scanner_apply_enabled" },
    { key: "strategy2", state: "FAILED_DISPLAY", executable: false, blocker: "protected_surface_needs_authenticated_readback_token", executionGuard: "protected_readback_credential_not_armed", reasonCodes: ["AUTH_PROTECTED_READBACK_NOT_ARMED"] },
  ], policy);
  if (partialDecision.ok !== true || !String(partialDecision.state || "").includes("PARTIAL_AUTO_ROLL_FORWARD")) {
    failures.push(`partial decision did not allow safe recovery beside auth blocker: ${partialDecision.state}`);
  }
  const authOnlyDecision = decide([
    { key: "strategy2", state: "FAILED_DISPLAY", executable: false, blocker: "protected_surface_needs_authenticated_readback_token", executionGuard: "protected_readback_credential_not_armed", reasonCodes: ["AUTH_PROTECTED_READBACK_NOT_ARMED"] },
  ], policy);
  if (authOnlyDecision.ok !== false || authOnlyDecision.state !== "BLOCKED_AUTH_MANUAL_REPAIR_REQUIRED") {
    failures.push(`auth-only decision did not fail closed: ${authOnlyDecision.state}`);
  }
  const fakeAction = {
    key: "self-test",
    label: "self-test",
    state: "FAILED_DISPLAY",
    executionGuard: "display_snapshot_readback_only",
    commands: [],
    idempotencyKey: "self-test-key",
    receiptFile: path.join(OUT_DIR, "self-test-receipt.json"),
  };
  const fakeReceipt = {
    contract: "terminal-auto-roll-forward-action-receipt-v1",
    idempotencyKey: "self-test-key",
    ok: true,
    status: "complete",
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(fakeAction.receiptFile, JSON.stringify(fakeReceipt) + "\n", "utf8");
  if (!completedReceipt(fakeAction)) failures.push("completedReceipt did not accept matching complete receipt");
  fs.rmSync(fakeAction.receiptFile, { force: true });
  return { ok: failures.length === 0, failures };
}

async function main() {
  if (SELF_TEST) {
    const result = selfTest();
    console.log(JSON.stringify({
      ok: result.ok,
      contract: "terminal-auto-roll-forward-self-test-v1",
      failures: result.failures,
    }, null, 2));
    if (!result.ok) process.exit(1);
    return;
  }
  const orchestrator = readJson(path.join(ROOT, "outputs", "terminal-orchestrator", "terminal-orchestrator-state.json"), {});
  const queue = readJson(path.join(ROOT, "outputs", "terminal-orchestrator", "terminal-job-queue.json"), []);
  const policy = readJson(path.join(ROOT, "outputs", "autonomous-ops-policy", "autonomous-ops-policy.json"), {});
  const plan = buildPlan({ orchestrator, policy, queue });
  const executed = [];

  if (APPLY) {
    if (!plan.decision.applyAllowed) {
      await writeOutputs(plan, executed);
      console.error(`[auto-roll-forward] apply blocked: ${plan.decision.state}: ${plan.decision.reason}`);
      process.exit(1);
    }
    for (const action of plan.actions.filter((item) => item.executable)) {
      const previousReceipt = completedReceipt(action);
      if (previousReceipt) {
        executed.push({
          label: `idempotent-skip:${action.key}`,
          command: "receipt-skip",
          exitCode: 0,
          ok: true,
          skipped: true,
          key: action.key,
          idempotencyKey: action.idempotencyKey,
          receiptFile: action.receiptFile,
          previousCheckedAt: previousReceipt.checkedAt || "",
        });
        continue;
      }
      const actionResults = [];
      for (const command of action.commands) {
        const result = { ...runCommand(command), key: action.key, idempotencyKey: action.idempotencyKey, receiptFile: action.receiptFile };
        actionResults.push(result);
        executed.push(result);
        if (!result.ok) {
          await writeActionReceipt(action, "failed", actionResults, { failedCommand: result.command });
          await writeOutputs(plan, executed);
          console.error(`[auto-roll-forward] command failed: ${result.command}`);
          process.exit(1);
        }
      }
      await writeActionReceipt(action, "complete", actionResults);
    }
  }

  const files = await writeOutputs(plan, executed);
  console.log(JSON.stringify({
    ok: plan.decision.ok,
    mode: plan.mode,
    state: plan.decision.state,
    reason: plan.decision.reason,
    jobs: plan.jobs,
    executableJobs: plan.executableJobs,
    blockedJobs: plan.blockedJobs,
    output: files.jsonFile,
  }, null, 2));
  if (!plan.decision.ok && !APPLY) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[auto-roll-forward] failed: ${error.stack || error.message || error}`);
  process.exit(1);
});
