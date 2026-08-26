"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

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
  const result = spawnSync(command, args, { cwd: ROOT, encoding: "utf8", shell: false, timeout: 120000, env: process.env });
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
    "  [pscustomobject]@{ name=$name; missing=$false; state=[string]$task.State; lastResult=[int]$info.LastTaskResult; lastRun=[string]$info.LastRunTime; nextRun=[string]$info.NextRunTime; action=(($task.Actions | ForEach-Object { ([string]$_.Execute) + ' ' + ([string]$_.Arguments) }) -join ' | '); batteryStartBlocked=[bool]$task.Settings.DisallowStartIfOnBatteries; batteryStop=[bool]$task.Settings.StopIfGoingOnBatteries }",
    "}", "$rows | ConvertTo-Json -Compress",
  ].join("; ");
  const result = run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command]);
  const rows = parseJson(result.stdout);
  return { ...result, rows: Array.isArray(rows) ? rows : rows ? [rows] : [] };
}
function receiptCheck(name, expectedContract, file) {
  const receipt = readJson(file); const payload = receipt.value;
  const checked = payload?.checkedAt ? Date.parse(payload.checkedAt) : NaN;
  const current = Number.isFinite(checked) && Date.now() - checked < DAY_MS;
  return { name, ok: payload?.ok === true && payload?.applied === true && payload?.contract === expectedContract && current, file, exists: !!payload, contract: payload?.contract || null, applied: payload?.applied === true, checkedAt: payload?.checkedAt || null, current, reasonCode: payload?.reasonCode || null, readError: receipt.error || null };
}
function main() {
  const date = taipeiParts(); const issues = []; const warnings = [];
  const tasks = scheduledTasks();
  if (!tasks.ok) issues.push("scheduled_task_query_failed");
  const schedule = TASKS.map((expected) => {
    const row = tasks.rows.find((item) => item.name === expected.name);
    const valid = !!row && !row.missing && ["Ready", "Running"].includes(row.state) && row.action.includes(expected.script) && !row.batteryStartBlocked && !row.batteryStop;
    if (!valid) issues.push(`task_invalid:${expected.name}`);
    const naturalRunConfirmed = Number(row?.lastResult) === 0 && !String(row?.lastRun || "").startsWith("1999-");
    if (valid && !naturalRunConfirmed) warnings.push(`task_pending_first_natural_run:${expected.name}`);
    return { ...expected, ...row, valid, naturalRunConfirmed };
  });
  const receipts = [
    receiptCheck("formal_intraday_1m", "daytrade-intraday-retention-15d-v1", path.join(STATUS, `daytrade-intraday-retention-${date.id}.json`)),
    receiptCheck("runtime_artifacts", "runtime-retention-v1", path.join(STATUS, `runtime-retention-${date.id}.json`)),
    receiptCheck("daytrade_stale_priority_cache", "daytrade-stale-priority-cache-cleanup-v1", path.join(STATUS, `daytrade-stale-priority-cache-cleanup-${date.id}.json`)),
    receiptCheck("source_observability", "source-observability-retention-15d-v1", path.join(STATUS, `source-observability-retention-${date.id}.json`)),
  ];
  for (const receipt of receipts) if (!receipt.ok) issues.push(`receipt_invalid:${receipt.name}`);
  const liveChecks = {
    intraday: run(process.execPath, ["--use-system-ca", "scripts/verify-daytrade-intraday-retention.js"]),
    sourceObservability: run(process.execPath, ["--use-system-ca", "scripts/verify-source-observability-retention.js"]),
  };
  for (const [name, result] of Object.entries(liveChecks)) if (!result.ok) issues.push(`live_verifier_failed:${name}`);
  const payload = {
    ok: issues.length === 0, unattendedReady: issues.length === 0 && !warnings.length,
    checkedAt: new Date().toISOString(), tradeDate: date.iso, contract: "daily-retention-maintenance-v1", schedule, receipts,
    liveChecks: Object.fromEntries(Object.entries(liveChecks).map(([name, result]) => [name, { ok: result.ok, status: result.status, output: result.stdout.slice(0, 2000), error: result.stderr.slice(0, 500) || result.error }])),
    protected: ["daily OHLCV and daily volume", "Strategy3 and Strategy4 canonical results", "/88, desktop, mobile, and latest scorecard", "latest 15 days of formal evidence", "production-health.jsonl", "formal candidates"],
    issues, warnings, reasonCode: issues[0] || warnings[0] || "ok",
    allowedAction: issues.length ? "fail_closed_investigate" : (warnings.length ? "wait_for_next_natural_schedule_then_reverify" : "daily_retention_unattended_yes"),
  };
  const output = path.join(STATUS, `daily-retention-maintenance-verifier-${date.id}.json`);
  fs.mkdirSync(STATUS, { recursive: true }); fs.writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`);
  payload.receiptFile = output; console.log(JSON.stringify(payload, null, 2));
  if (!payload.ok) process.exitCode = 1;
}
main();

