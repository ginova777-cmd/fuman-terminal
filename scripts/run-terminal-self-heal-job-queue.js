"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const STATE_DIR = path.join(RUNTIME_DIR, "state");
const INPUT = process.argv.find((arg) => arg.startsWith("--queue="))?.slice("--queue=".length)
  || path.join(STATE_DIR, "terminal-self-heal-job-queue.json");
const OUT_DIR = path.join(ROOT, "outputs", "terminal-self-heal");
const OUT_FILE = path.join(OUT_DIR, "terminal-self-heal-execution.json");
const RUNTIME_OUT_FILE = path.join(STATE_DIR, "terminal-self-heal-execution.json");
const APPLY = process.argv.includes("--apply");
const MAX_JOBS = Number(process.argv.find((arg) => arg.startsWith("--max-jobs="))?.slice("--max-jobs=".length) || 1);

const CONTRACT = "terminal-self-heal-executor-v1";

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return fallback ?? { __read_error: error.message, __file: file };
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function run(command, args = [], options = {}) {
  const startedAt = new Date();
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    timeout: options.timeoutMs || 120000,
    env: { ...process.env, ...(options.env || {}) },
  });
  const finishedAt = new Date();
  return {
    command: [command, ...args].join(" "),
    exitCode: typeof result.status === "number" ? result.status : 1,
    signal: result.signal || "",
    error: result.error ? String(result.error.message || result.error) : "",
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationSeconds: Math.round((finishedAt - startedAt) / 100) / 10,
    stdoutTail: String(result.stdout || "").slice(-3000),
    stderrTail: String(result.stderr || "").slice(-3000),
  };
}

function taskRun(taskName) {
  return run("schtasks.exe", ["/Run", "/TN", taskName], { timeoutMs: 30000 });
}

function npmRun(script) {
  if (process.platform === "win32") {
    return run("cmd.exe", ["/d", "/s", "/c", `npm run ${script}`], { timeoutMs: 180000 });
  }
  return run("npm", ["run", script], { timeoutMs: 180000 });
}

function actionPlan(job) {
  switch (job.action) {
    case "restart_stock_fugle_websocket_collector":
      return [
        { kind: "task", name: "\\Fuman Fugle Daytrade Watchdog Every Minute" },
        { kind: "task", name: "\\Fuman Daytrade Source Writer 0600-1330" },
        { kind: "verify", script: "verify:fugle-websocket-sources", toleratedExitCodes: [1] },
      ];
    case "restart_futopt_fugle_websocket_collector":
      return [
        { kind: "task", name: "\\Fuman Fugle Daytrade Watchdog Every Minute" },
        { kind: "verify", script: "verify:fugle-websocket-sources", toleratedExitCodes: [1] },
      ];
    case "rebuild_today_mother_pool_and_priority_top40":
      return [
        { kind: "npm", script: "daytrade-warmup:self-heal:apply", toleratedExitCodes: [1] },
        { kind: "verify", script: "verify:terminal-water-root", toleratedExitCodes: [1] },
      ];
    case "wait_or_fix_water_root_then_rerun_formal_gate":
      return [
        { kind: "verify", script: "verify:terminal-water-root", toleratedExitCodes: [1] },
        { kind: "verify", script: "verify:strategy-scan-formal-gate", toleratedExitCodes: [1] },
      ];
    default:
      return [];
  }
}

function executeStep(step) {
  if (step.kind === "task") return { ...taskRun(step.name), kind: step.kind, target: step.name };
  if (step.kind === "npm" || step.kind === "verify") return { ...npmRun(step.script), kind: step.kind, target: step.script };
  return { kind: step.kind || "unknown", target: "", exitCode: 1, error: "unknown_step_kind" };
}

function main() {
  const queue = readJson(INPUT, null);
  const issues = [];
  if (!queue || queue.contract !== "terminal-self-heal-job-queue-v1") {
    issues.push({ code: "self_heal_queue_missing_or_invalid", file: INPUT });
  }
  const jobs = Array.isArray(queue?.jobs) ? queue.jobs : [];
  const eligible = jobs
    .filter((job) => String(job.status || "").toUpperCase() === "QUEUED")
    .filter((job) => actionPlan(job).length > 0)
    .slice(0, Math.max(1, Number.isFinite(MAX_JOBS) ? MAX_JOBS : 1));

  const executed = [];
  for (const job of eligible) {
    const plan = actionPlan(job);
    const row = {
      ...job,
      executorStatus: APPLY ? "RUNNING" : "DRY_RUN",
      plannedSteps: plan,
      steps: [],
    };
    if (APPLY) {
      for (const step of plan) {
        const result = executeStep(step);
        row.steps.push(result);
        const tolerated = Array.isArray(step.toleratedExitCodes) && step.toleratedExitCodes.includes(result.exitCode);
        if (result.exitCode !== 0 && !tolerated) break;
      }
      row.executorStatus = row.steps.every((step, index) => {
        const planStep = plan[index] || {};
        return step.exitCode === 0 || (Array.isArray(planStep.toleratedExitCodes) && planStep.toleratedExitCodes.includes(step.exitCode));
      }) ? "APPLIED_VERIFY_MAY_STILL_BLOCK" : "FAILED";
    }
    executed.push(row);
  }

  const payload = {
    contract: CONTRACT,
    checkedAt: new Date().toISOString(),
    ok: issues.length === 0 && (eligible.length > 0 || jobs.length === 0),
    apply: APPLY,
    queueFile: INPUT,
    daily_run_id: queue?.daily_run_id || "",
    trade_date: queue?.trade_date || "",
    mode: "safe_idempotent_source_recovery_only",
    publishedLatest: false,
    strategyScannerRun: false,
    jobsTotal: jobs.length,
    jobsEligible: eligible.length,
    jobsExecuted: executed.length,
    issues,
    executed,
  };
  writeJson(OUT_FILE, payload);
  try {
    writeJson(RUNTIME_OUT_FILE, payload);
  } catch {}
  console.log(JSON.stringify(payload, null, 2));
  if (!payload.ok) process.exitCode = 1;
}

main();
