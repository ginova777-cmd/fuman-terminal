const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.resolve(process.argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length) || "outputs/terminal-roll-forward");
const RECEIPT_DIR = path.join(OUT_DIR, "receipts");
const IDEMPOTENCY_CONTRACT = {
  contract: "terminal-idempotent-runner-v1",
  invariants: [
    "every_job_has_idempotency_key",
    "every_job_has_receipt_file",
    "auth_jobs_never_auto_execute",
    "scanner_jobs_require_water_root_and_apply_scanners",
    "publish_jobs_require_manifest_canary_gate",
  ],
};
const APPLY = process.argv.includes("--apply");
const APPLY_SCANNERS = process.argv.includes("--apply-scanners");
const SELF_TEST = process.argv.includes("--self-test");
const ALLOW_DEGRADED_PUBLISH = process.argv.includes("--allow-degraded-publish");
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function runCommand(step) {
  const result = spawnSync(step.command, step.args || [], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env },
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

function safeId(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9._:-]+/g, "_").slice(0, 180);
}

function actionIdempotencyKey(job = {}, key = "unknown", state = "PENDING") {
  return safeId(job.idempotencyKey || [currentTradeDate(), key, state, job.blocker || "none"].join(":"));
}

function receiptFileFor(action = {}) {
  return path.join(RECEIPT_DIR, `${safeId(action.idempotencyKey || action.key || action.label)}.json`);
}

function normalizeJobs(orchestrator = {}, queue = []) {
  if (Array.isArray(queue) && queue.length) return queue;
  if (Array.isArray(orchestrator.jobQueue)) return orchestrator.jobQueue;
  return [];
}

function planForJob(job = {}, policy = {}) {
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
    base.executionGuard = APPLY_SCANNERS ? "scanner_apply_enabled" : "scanner_requires_apply_scanners";
    base.executable = APPLY_SCANNERS;
    base.commands.push(npmRun("verify:terminal-water-root"));
    const scannerCommand = scannerStepForKey(key, job.command);
    if (scannerCommand) base.commands.push(scannerCommand);
    base.notes.push("Scanner reruns are idempotent-only and require --apply --apply-scanners.");
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
  const auth = actions.find((action) => action.state.includes("AUTH"));
  if (auth) {
    return {
      ok: false,
      state: "BLOCKED_AUTH_MANUAL_REPAIR_REQUIRED",
      reason: auth.blocker || "auth_blocker",
      applyAllowed: false,
    };
  }
  const unhandled = actions.find((action) => !action.executable);
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
  const policy = { decision: { autoRecoveryAllowed: true, scorecardPublishAllowed: false } };
  const cases = [
    { name: "auth-block", job: { key: "strategy4", state: "BLOCKED_AUTH", blocker: "401" }, expectedExecutable: false, expectedGuard: "blocked_auth" },
    { name: "source-check", job: { key: "strategy2", state: "BLOCKED_SOURCE" }, expectedExecutable: true, expectedGuard: "source_check" },
    { name: "scan-dry", job: { key: "strategy3", state: "FAILED_SCAN" }, expectedExecutable: APPLY_SCANNERS, expectedGuard: APPLY_SCANNERS ? "scanner_apply" : "scanner_requires" },
    { name: "display", job: { key: "strategy5", state: "FAILED_DISPLAY" }, expectedExecutable: true, expectedGuard: "display_snapshot" },
    { name: "publish-blocked", job: { key: "scorecard", state: "FAILED_PUBLISH" }, expectedExecutable: false, expectedGuard: "manifest_not_green" },
  ];
  const failures = [];
  for (const item of cases) {
    const action = planForJob(item.job, policy);
    if (action.executable !== item.expectedExecutable) failures.push(`${item.name}: executable ${action.executable} != ${item.expectedExecutable}`);
    if (!action.executionGuard.includes(item.expectedGuard)) failures.push(`${item.name}: guard ${action.executionGuard} missing ${item.expectedGuard}`);
  }
  return { ok: failures.length === 0, failures };
}

async function main() {
  if (SELF_TEST) {
    const result = selfTest();
    if (!result.ok) {
      console.error(JSON.stringify(result, null, 2));
      process.exit(1);
    }
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
      for (const command of action.commands) {
        const result = { ...runCommand(command), key: action.key, idempotencyKey: action.idempotencyKey, receiptFile: action.receiptFile };
        executed.push(result);
        if (!result.ok) {
          await writeOutputs(plan, executed);
          console.error(`[auto-roll-forward] command failed: ${result.command}`);
          process.exit(1);
        }
      }
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