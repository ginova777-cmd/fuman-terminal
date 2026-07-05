const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";

const DAYTRADE_CONFIG = path.join(RUNTIME_DIR, "config", "daytrade-source-speed.json");
const SHARED_CONFIG = path.join(RUNTIME_DIR, "config", "public-slot-shared-source.json");
const RECOVERY_LOCK = path.join(RUNTIME_DIR, "locks", "supabase-conservative-recovery-mode.json");
const OUT_DIR = path.join(RUNTIME_DIR, "reports");
const OUT_FILE = path.join(OUT_DIR, "supabase-conservative-recovery-check.json");

const HEAVY_TASKS = [
  "\\Fuman API Unattended Patrol",
  "\\Fuman API Unattended Scorecard",
  "\\FumanTerminalProductionHealthMonitor",
  "\\Fuman Freshness Gate Fast 0845-1645",
  "\\Fuman Terminal Local Freshness Verify 0830-2230",
  "\\Fuman CB Battle Verify 2150",
  "\\Fuman Daily Battle Verify 2155",
  "\\Fuman Warrant Battle Verify 2055",
];

const PRESERVED_TASKS = [
  "\\Fuman Daytrade Source Writer 0600-1330",
  "\\Fuman Daytrade Source Preflight 0830",
  "\\Fuman Daytrade Source Gate 0845",
  "\\Fuman Daytrade Source Gate 0900",
  "\\Fuman Daytrade Source Gate 0910",
  "\\Fuman Daytrade Source Gate 0935",
  "\\Fuman Daytrade Source Final Verdict 0912",
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function addIssue(issues, condition, code, details = {}) {
  if (!condition) issues.push({ code, ...details });
}

function taskState(taskName) {
  const cleanName = String(taskName || "").replace(/^\\+/, "");
  const ps = [
    "$ErrorActionPreference='Stop';",
    `$name=${JSON.stringify(cleanName)};`,
    "$task=Get-ScheduledTask -TaskName $name;",
    "$info=Get-ScheduledTaskInfo -TaskName $name;",
    "[ordered]@{",
    "TaskName=$task.TaskName;",
    "State=($task.State | Out-String).Trim();",
    "NextRunTime=if($info.NextRunTime){$info.NextRunTime.ToString('o')}else{''};",
    "LastRunTime=if($info.LastRunTime){$info.LastRunTime.ToString('o')}else{''};",
    "LastTaskResult=$info.LastTaskResult",
    "} | ConvertTo-Json -Compress",
  ].join(" ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    return { taskName, exists: false, status: "missing", raw: result.stderr || result.stdout || "" };
  }
  const parsed = JSON.parse(result.stdout || "{}");
  return {
    taskName,
    exists: true,
    status: parsed.State || "",
    scheduledTaskState: parsed.State || "",
    nextRunTime: parsed.NextRunTime || "",
    lastRunTime: parsed.LastRunTime || "",
    lastResult: String(parsed.LastTaskResult ?? ""),
  };
}

function main() {
  const issues = [];
  const daytrade = readJson(DAYTRADE_CONFIG);
  const shared = readJson(SHARED_CONFIG);
  const lock = readJson(RECOVERY_LOCK);

  addIssue(issues, daytrade.enabled === true, "daytrade_writer_not_enabled", { value: daytrade.enabled });
  addIssue(issues, daytrade.sourceName === "fugle_daytrade_source", "daytrade_source_name_wrong", { value: daytrade.sourceName });
  addIssue(issues, Number(daytrade.collector?.quoteBatchSize) <= 40, "daytrade_quote_batch_too_high", { value: daytrade.collector?.quoteBatchSize });
  addIssue(issues, Number(daytrade.collector?.quoteConcurrency) <= 1, "daytrade_quote_concurrency_too_high", { value: daytrade.collector?.quoteConcurrency });
  addIssue(issues, Number(daytrade.collector?.targetBatchIntervalSeconds) >= 5, "daytrade_batch_interval_too_fast", { value: daytrade.collector?.targetBatchIntervalSeconds });
  addIssue(issues, Number(daytrade.openingBoost?.quoteBatchSize) <= 120, "daytrade_opening_boost_batch_too_high", { value: daytrade.openingBoost?.quoteBatchSize });
  addIssue(issues, Number(daytrade.openingBoost?.quoteConcurrency) <= 2, "daytrade_opening_boost_concurrency_too_high", { value: daytrade.openingBoost?.quoteConcurrency });
  addIssue(issues, Number(daytrade.collector?.cooldownInitialSeconds) >= 180, "daytrade_cooldown_initial_too_low", { value: daytrade.collector?.cooldownInitialSeconds });
  addIssue(issues, Number(daytrade.collector?.cooldownMaxSeconds) >= 1800, "daytrade_cooldown_max_too_low", { value: daytrade.collector?.cooldownMaxSeconds });

  addIssue(issues, Number(shared.restQuoteBatchSize) <= 10, "shared_rest_quote_batch_too_high", { value: shared.restQuoteBatchSize });
  addIssue(issues, Number(shared.restQuoteEverySeconds) >= 20, "shared_rest_quote_every_too_fast", { value: shared.restQuoteEverySeconds });
  addIssue(issues, Number(shared.restQuoteDelayMilliseconds) >= 2000, "shared_rest_quote_delay_too_low", { value: shared.restQuoteDelayMilliseconds });
  addIssue(issues, Number(shared.fugleCollectorBatchSize) <= 20, "shared_collector_batch_too_high", { value: shared.fugleCollectorBatchSize });
  addIssue(issues, Number(shared.fugleCollectorConcurrency) <= 1, "shared_collector_concurrency_too_high", { value: shared.fugleCollectorConcurrency });
  addIssue(issues, Number(shared.fugleCollectorRequestDelayMilliseconds) >= 4000, "shared_collector_delay_too_low", { value: shared.fugleCollectorRequestDelayMilliseconds });
  addIssue(issues, Number(shared.direct1mBatchSize) <= 2, "shared_direct_1m_batch_too_high", { value: shared.direct1mBatchSize });
  addIssue(issues, Number(shared.direct1mEverySeconds) >= 60, "shared_direct_1m_every_too_fast", { value: shared.direct1mEverySeconds });

  addIssue(issues, lock.status === "active", "recovery_lock_not_active", { value: lock.status });
  addIssue(issues, lock.code === "supabase_conservative_recovery_mode", "recovery_lock_code_wrong", { value: lock.code });

  const heavyTasks = HEAVY_TASKS.map(taskState);
  const preservedTasks = PRESERVED_TASKS.map(taskState);

  for (const task of heavyTasks) {
    addIssue(
      issues,
      task.exists && task.status.toLowerCase() === "disabled" && task.scheduledTaskState.toLowerCase() === "disabled",
      "heavy_task_not_disabled",
      task,
    );
  }

  for (const task of preservedTasks) {
    addIssue(
      issues,
      task.exists && task.status.toLowerCase() === "ready",
      "preserved_daytrade_task_not_ready",
      task,
    );
  }

  const report = {
    ok: issues.length === 0,
    status: issues.length === 0 ? "ready_for_conservative_recovery" : "not_ready",
    checkedAt: new Date().toISOString(),
    contract: "supabase-conservative-recovery-v1",
    daytradeSpeed: {
      quoteBatchSize: daytrade.collector?.quoteBatchSize,
      quoteConcurrency: daytrade.collector?.quoteConcurrency,
      targetBatchIntervalSeconds: daytrade.collector?.targetBatchIntervalSeconds,
      openingBoostBatchSize: daytrade.openingBoost?.quoteBatchSize,
      openingBoostConcurrency: daytrade.openingBoost?.quoteConcurrency,
    },
    sharedSourceSpeed: {
      restQuoteBatchSize: shared.restQuoteBatchSize,
      restQuoteEverySeconds: shared.restQuoteEverySeconds,
      restQuoteDelayMilliseconds: shared.restQuoteDelayMilliseconds,
      fugleCollectorBatchSize: shared.fugleCollectorBatchSize,
      fugleCollectorConcurrency: shared.fugleCollectorConcurrency,
      fugleCollectorRequestDelayMilliseconds: shared.fugleCollectorRequestDelayMilliseconds,
      direct1mBatchSize: shared.direct1mBatchSize,
      direct1mEverySeconds: shared.direct1mEverySeconds,
    },
    recoveryLock: {
      status: lock.status,
      code: lock.code,
      createdAt: lock.createdAt,
      allowed: lock.allowed,
      blocked: lock.blocked,
    },
    heavyTasks,
    preservedTasks,
    issues,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ...report, reportFile: OUT_FILE }, null, 2));
  if (!report.ok) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    status: "error",
    error: error?.stack || error?.message || String(error),
  }, null, 2));
  process.exitCode = 1;
}
