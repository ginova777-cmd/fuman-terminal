"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { isTwseTradingDay } = require("./twse-trading-day");

const ROOT = path.basename(__dirname).toLowerCase() === "scripts" ? path.resolve(__dirname, "..") : path.resolve(__dirname, "..", "..");
const RUNTIME = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const STATUS = path.join(RUNTIME, "status");
const DAY_MS = 24 * 60 * 60 * 1000;

const TASKS = [
  { name: "Fuman API-Only Retired Artifact Cleanup 1535", script: "run-api-only-retired-cleanup.ps1", time: "17:10" },
  { name: "Fuman Supabase Vercel History Cleanup 1545", script: "run-history-retention-cleanup.ps1", time: "17:40" },
  { name: "Fuman Global Cost Janitor Scorecard 1555", script: "run-global-cost-janitor-scorecard.ps1", time: "18:10" },
  { name: "Fuman Daytrade Intraday Retention 1605", script: "run-daytrade-intraday-retention.ps1", time: "18:40" },
  { name: "Fuman Daily Retention Maintenance 1625", script: "run-daily-retention-maintenance.ps1", time: "19:10" },
];

function taipeiParts(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return { id: `${get("year")}${get("month")}${get("day")}`, iso: `${get("year")}-${get("month")}-${get("day")}` };
}
function readJson(file) {
  try { return { file, value: JSON.parse(fs.readFileSync(file, "utf8")) }; }
  catch (error) { return { file, error: error.message, value: null }; }
}
function run(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: "utf8", shell: false, maxBuffer: 32 * 1024 * 1024, timeout: 120000, env: process.env });
  return { ok: result.status === 0, status: result.status, stdout: String(result.stdout || "").trim(), stderr: String(result.stderr || "").trim(), error: result.error?.message || null };
}
function parseJson(text) {
  try { return JSON.parse(text); }
  catch {
    const start = text.indexOf("{"); const end = text.lastIndexOf("}");
    try { return start >= 0 && end > start ? JSON.parse(text.slice(start, end + 1)) : null; } catch { return null; }
  }
}
function scheduledTasks() {
  const names = JSON.stringify(TASKS.map((task) => task.name));
  const command = [
    `$names = '${names}' | ConvertFrom-Json`,
    "$rows = foreach ($name in $names) {",
    "  $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue",
    "  if ($null -eq $task) { [pscustomobject]@{ name=$name; missing=$true }; continue }",
    "  $info = Get-ScheduledTaskInfo -TaskName $name",
    "  [pscustomobject]@{ name=$name; missing=$false; state=[string]$task.State; lastResult=[int]$info.LastTaskResult; lastRun=$info.LastRunTime.ToString('o'); nextRun=$info.NextRunTime.ToString('o'); enabled=[bool]$task.Settings.Enabled; triggerTimes=@($task.Triggers | ForEach-Object { ([datetime]$_.StartBoundary).ToString('HH:mm') }); logonType=[string]$task.Principal.LogonType; runLevel=[string]$task.Principal.RunLevel; startWhenAvailable=[bool]$task.Settings.StartWhenAvailable; multipleInstances=[string]$task.Settings.MultipleInstances; executionTimeLimit=[string]$task.Settings.ExecutionTimeLimit; restartCount=[int]$task.Settings.RestartCount; action=(($task.Actions | ForEach-Object { ([string]$_.Execute) + ' ' + ([string]$_.Arguments) }) -join ' | '); batteryStartBlocked=[bool]$task.Settings.DisallowStartIfOnBatteries; batteryStop=[bool]$task.Settings.StopIfGoingOnBatteries }",
    "}", "$rows | ConvertTo-Json -Compress",
  ].join("; ");
  const result = run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command]);
  const rows = parseJson(result.stdout);
  return { ...result, rows: Array.isArray(rows) ? rows : rows ? [rows] : [] };
}
function receiptCheck(name, expectedContract, file, options = {}) {
  const receipt = readJson(file); const payload = receipt.value;
  const checkedAt = payload?.checkedAt || payload?.finishedAt;
  const checked = checkedAt ? Date.parse(checkedAt) : NaN;
  const current = Number.isFinite(checked) && checked <= Date.now() && taipeiParts(new Date(checked)).iso === taipeiParts().iso;
  const identityOk = options.source ? payload?.source === options.source : payload?.contract === expectedContract;
  const appliedOk = options.readOnly || (options.legacyDryRun ? payload?.dryRun === false : payload?.applied === true);
  const sectionsOk = !options.history || (payload?.supabase?.ok === true && payload?.supabase?.skipped !== true && payload?.vercel?.ok === true && payload?.vercel?.skipped !== true);
  return { name, ok: payload?.ok === true && appliedOk && identityOk && sectionsOk && current, file, exists: !!payload, contract: payload?.contract || null, applied: payload?.applied === true, checkedAt: checkedAt || null, current, reasonCode: payload?.reasonCode || null, readError: receipt.error || null };
}
async function main() {
  const date = taipeiParts(); const issues = []; const warnings = [];
  const maintenanceArg = process.argv.find(x=>x.startsWith('--maintenance-authorization='));
  const maintenanceContext = require('./cleanup-maintenance-context');
  const maintenance = maintenanceArg ? maintenanceContext.authorization(maintenanceArg.slice('--maintenance-authorization='.length)) : null;
  const execution = maintenance ? maintenanceContext.verifyJournal(maintenance) : null;
  const tradingDay = await isTwseTradingDay(new Date(`${date.iso}T04:00:00.000Z`), { stateDir: path.join(RUNTIME, "state") });
  if (!tradingDay.isTradingDay && !maintenance) {
    const payload = {
      ok: true,
      status: "skipped",
      complete: false,
      exitCode: 0,
      unattendedReady: false,
      checkedAt: new Date().toISOString(),
      tradeDate: date.iso,
      contract: "daily-retention-maintenance-v1",
      marketOpen: false,
      cleanupApplyAllowed: false,
      formalCleanupSkipped: true,
      preservePreviousGood: true,
      latestPointerUpdated: false,
      issues: [],
      warnings: [],
      reasonCode: "market_calendar_non_trading_day",
      closedReason: tradingDay.reason || "market_closed",
      allowedAction: "skip_apply_cleanup_read_only_health_only",
    };
    const output = path.join(STATUS, `daily-retention-maintenance-verifier-${date.id}.json`);
    fs.mkdirSync(STATUS, { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`);
    payload.receiptFile = output;
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  const tasks = scheduledTasks();
  if (!tasks.ok) issues.push("scheduled_task_query_failed");
  const schedule = TASKS.map((expected) => {
    const row = tasks.rows.find((item) => item.name === expected.name);
    const valid = !!row && !row.missing && ["Ready", "Running"].includes(row.state) && row.enabled === true && row.action.includes(path.join(ROOT, expected.script)) && row.triggerTimes?.includes(expected.time) && row.logonType === "S4U" && row.runLevel === "Highest" && row.startWhenAvailable === true && row.multipleInstances === "IgnoreNew" && row.executionTimeLimit === "PT20M" && row.restartCount === 0 && !row.batteryStartBlocked && !row.batteryStop;
    if (!valid) issues.push(`task_invalid:${expected.name}`);
    const naturalRunConfirmed = Number(row?.lastResult) === 0 && Number.isFinite(Date.parse(row?.lastRun)) && taipeiParts(new Date(row.lastRun)).iso === date.iso;
    if (valid && !naturalRunConfirmed && !maintenance) warnings.push(`task_pending_first_natural_run:${expected.name}`);
    return { ...expected, ...row, valid, naturalRunConfirmed };
  });
  const receipts = [
    receiptCheck("stage1_retired_artifacts", "", path.join(STATUS,"api-only-retired-cleanup-status.json"), {source:"api-only-retired-artifact-cleanup",legacyDryRun:true}),
    receiptCheck("stage2_history", "", path.join(STATUS,"supabase-vercel-history-cleanup-status.json"), {source:"supabase-vercel-history-cleanup",history:true}),
    receiptCheck("stage3_cost_janitor", "global-cost-janitor-scorecard-v1", path.join(STATUS,"global-cost-janitor-scorecard.json"), {readOnly:true}),
    receiptCheck("formal_intraday_1m", "daytrade-intraday-retention-15d-v1", path.join(STATUS, `daytrade-intraday-retention-${date.id}.json`)),
    receiptCheck("runtime_artifacts", "runtime-retention-v1", path.join(STATUS, `runtime-retention-${date.id}.json`)),
    receiptCheck("daytrade_stale_priority_cache", "daytrade-stale-priority-cache-cleanup-v1", path.join(STATUS, `daytrade-stale-priority-cache-cleanup-${date.id}.json`)),
    receiptCheck("source_observability", "source-observability-retention-15d-v1", path.join(STATUS, `source-observability-retention-${date.id}.json`)),
  ];
  const cost = readJson(path.join(RUNTIME,"state/vercel-cost-health-status.json")).value;
  const currentMinutes = Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date()).split(':').reduce((n,v,i)=>n+Number(v)*(i===0?60:1),0));
  if (!maintenance && currentMinutes < 21*60+15) warnings.push('cost_health_today_not_due');
  else if (cost?.ok !== true || !Number.isFinite(Date.parse(cost?.checkedAt)) || taipeiParts(new Date(cost.checkedAt)).iso !== date.iso || (cost.issues || []).length) issues.push('cost_health_today_not_complete');
  for (const receipt of receipts) if (!receipt.ok) issues.push(`receipt_invalid:${receipt.name}`);
  const liveChecks = {
    intraday: run(process.execPath, ["--use-system-ca", "scripts/verify-daytrade-intraday-retention.js"]),
    sourceObservability: run(process.execPath, ["--use-system-ca", "scripts/verify-source-observability-retention.js"]),
  };
  if (maintenance) liveChecks.remainingCleanup = run(process.execPath, ['--use-system-ca','scripts/verify-cleanup-maintenance-readback.js']);
  for (const [name, result] of Object.entries(liveChecks)) if (!result.ok) issues.push(`live_verifier_failed:${name}`);
  const complete = issues.length === 0 && warnings.length === 0;
  const payload = {
    ok: issues.length === 0,
    status: complete ? "complete" : (issues.length ? "failed" : "degraded"),
    complete,
    exitCode: issues.length === 0 ? 0 : 1,
    unattendedReady: complete && !maintenance,
    executionMode: maintenance ? "authorized_maintenance" : "scheduled_workday",
    maintenanceRunId: maintenance?.runId || null,
    executionJournal: maintenance?.journalFile || null,
    protectedFileReadback: execution?.protection || null,
    checkedAt: new Date().toISOString(), tradeDate: date.iso, contract: "daily-retention-maintenance-v1", schedule, receipts,
    liveChecks: Object.fromEntries(Object.entries(liveChecks).map(([name, result]) => [name, { ok: result.ok, status: result.status, output: result.stdout.slice(0, 2000), error: result.stderr.slice(0, 500) || result.error }])),
    protected: ["daily OHLCV and daily volume", "Strategy3 and Strategy4 canonical results", "/88, desktop, mobile, and latest scorecard", "latest 15 days of formal evidence", "production-health.jsonl", "formal candidates"],
    issues, warnings, reasonCode: issues[0] || warnings[0] || "ok",
    allowedAction: issues.length ? "fail_closed_investigate" : (warnings.length ? "wait_for_next_natural_schedule_then_reverify" : (maintenance ? "authorized_maintenance_complete" : "daily_retention_unattended_yes")),
  };
  const output = path.join(STATUS, maintenance ? `cleanup-maintenance-complete-${maintenance.runId}.json` : `daily-retention-maintenance-verifier-${date.id}.json`);
  fs.mkdirSync(STATUS, { recursive: true }); fs.writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`);
  payload.receiptFile = output; console.log(JSON.stringify(payload, null, 2));
  if (!payload.ok) process.exitCode = 1;
}
main().catch((error) => {
  console.error(JSON.stringify({ ok: false, contract: "daily-retention-maintenance-v1", error: error?.message || String(error) }, null, 2));
  process.exitCode = 1;
});

