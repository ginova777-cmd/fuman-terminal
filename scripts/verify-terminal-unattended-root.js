const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "outputs", "terminal-unattended-root");
const OUT_FILE = path.join(OUT_DIR, "terminal-unattended-root-report.json");

const STEPS = [
  "verify:terminal-power-recovery-contract",
  "verify:terminal-autonomous-task-live",
  "ops:predictive-preflight",
  "verify:terminal-predictive-preflight",
  "verify:fugle-websocket-sources",
  "verify:terminal-water-root",
  "verify:terminal-water-root-contract",
  "verify:terminal-live-scope",
  "verify:terminal-unattended-root-policy",
  "verify:daytrade-warmup-root",
  "daytrade-warmup:root",
  "verify:strategy-scan-formal-gate",
  "verify:terminal-auto-roll-forward",
  "verify:terminal-job-queue-contract",
  "verify:terminal-idempotent-runner",
  "verify:strategy-scan-receipt-contract",
  "ops:autonomous-root:contract",
  "verify:daily-manifest-schedule-transition",
  "manifest:daily-terminal-run",
  "orchestrator:state:from-existing",
  "verify:terminal-orchestrator-self-test",
  "verify:terminal-state-machine-contract",
  "verify:terminal-reason-code-classifier",
  "policy:autonomous-ops",
  "rollforward:terminal",
  "verify:terminal-canary-publish:live",
  "verify:terminal-canary-publish",
  "verify:terminal-control-plane:from-existing",
  "verify:terminal-resource-chain:unattended",
  "verify:market-calendar-display-date-gate",
  "verify:terminal-display-correctness",
  "verify:terminal-surface-monitor",
  "verify:terminal-runid-closure",
  "verify:manifest-publish-wiring",
  "verify:backend-auth-isolation",
  "verify:backend-service-token-schedule",
  "verify:autonomous-ops-action-matrix",
  "ops:notification:plan",
  "verify:autonomous-ops-notification-policy",
  "ops:status:export",
  "verify:terminal-ops-status-api",
  "verify:terminal-autonomous-completion-audit",
  "verify:protected-readback-credential-contract",
  "verify:protected-readback-credential",
  "verify:terminal-ops-production-live:authenticated",
  "ops:production-unattended-readiness-report:authenticated",
  "verify:production-unattended-readiness-report",
];

function tailText(value, max = 5000) {
  const text = String(value || "");
  return text.length > max ? text.slice(-max) : text;
}

function runStep(script) {
  const startedAt = new Date();
  const command = process.platform === "win32" ? "cmd.exe" : "npm";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", "npm", "run", script]
    : ["run", script];
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
    timeout: 180000,
  });
  const finishedAt = new Date();
  const signal = result.signal || "";
  const exitCode = typeof result.status === "number" ? result.status : signal ? 124 : 1;
  return {
    script,
    ok: exitCode === 0,
    exitCode,
    signal,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    stdoutTail: tailText(result.stdout),
    stderrTail: tailText(result.stderr),
    error: result.error ? String(result.error.message || result.error) : "",
  };
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const startedAt = new Date();
  const steps = [];
  for (const script of STEPS) {
    steps.push(runStep(script));
  }
  const failed = steps.filter((step) => !step.ok);
  const report = {
    ok: failed.length === 0,
    contract: "terminal-unattended-root-collector-v1",
    checkedAt: new Date().toISOString(),
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    mode: "collect_all_steps_no_fail_fast",
    rule: "Every root step is executed and recorded; unattended YES is allowed only when every step exits 0.",
    stepCount: steps.length,
    failedCount: failed.length,
    failedScripts: failed.map((step) => ({
      script: step.script,
      exitCode: step.exitCode,
      signal: step.signal,
      error: step.error,
      stdoutTail: step.stdoutTail,
      stderrTail: step.stderrTail,
    })),
    steps,
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    ok: report.ok,
    contract: report.contract,
    stepCount: report.stepCount,
    failedCount: report.failedCount,
    failedScripts: failed.map((step) => `${step.script}:${step.exitCode}`),
    output: OUT_FILE,
  }, null, 2));
  process.exit(report.ok ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = { STEPS };