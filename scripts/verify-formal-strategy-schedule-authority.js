"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const FORMAL_ROOT = "C:\\fuman-release-owner\\fuman-terminal";
const expected = [
  ["Fuman Terminal Autonomous Root Monitor", "run-terminal-master-control.ps1", ["06:05", "07:08", "08:00", "08:20", "08:36", "12:20", "13:15", "16:10", "17:00", "21:40", "22:00", "23:10"]],
  ["Fuman Daytrade Source Writer 0600-1330", "Run-DaytradeSourceWriter.ps1", ["06:00"], { allowRuntimeAction: true }],
  ["Fuman Fugle Daytrade WebSocket Collector 0600-1330", "Run-DaytradeWebSocketCollector.ps1", ["06:00"]],
  ["Fuman Daytrade Source Gate 0700", "Run-DaytradeUnattendedGate.ps1", ["07:00"], { allowRuntimeAction: true }],
  ["Fuman Opening Report 0820 Preflight", "run-opening-report-0820-preflight.js", ["08:20"]],
  ["Fuman Opening Report 0830 Telegram", "run-opening-report-0830-production-wrapper.ps1", ["08:30"]],
  ["Fuman Strategy2 Unified 0845-1210", "ops\\run-strategy2-v3-unified.ps1", ["08:45"]],
  ["Fuman Mother Pool Telegram 0900-1230", "run-daytrade-intraday-burst-telegram.ps1", ["09:00"]],
  ["Fuman Strategy3 V2 First Attempt 1255", "run-strategy3-v2-1255-first-attempt.ps1", ["12:55"]],
  ["Fuman Strategy3 V2 Complete Scan 1300", "run-strategy3-v2-complete-scan.ps1", ["13:00"]],
  ["Fuman Strategy3 V2 Daily Closure Verify 1315", "verify-strategy3-v2-daily-unattended-closure.js", ["13:15"]],
  ["Fuman Strategy4 Source Prewarm 1535", "run-strategy4-source-prewarm.ps1", ["15:35"]],
  ["Fuman Strategy4 Cache 1600", "run-strategy4.ps1", ["16:00"]],
  ["Fuman Chip Source Sync 2005", "run-chip-source-sync.ps1", ["20:05"]],
  ["Fuman Strategy5 Cache 2100", "run-strategy5.ps1", ["21:00"]],
  ["Fuman 買賣超 Cache 2100", "run-institution.ps1", ["21:00"]],
  ["Fuman Institution Battle Verify 2110", "run-institution-battle-verify.ps1", ["21:10"]],
  ["Fuman 買賣超 Watchdog 2115", "run-flow-watchdog.ps1", ["21:15"]],
  ["Fuman Strategy5 Watchdog 2130", "run-strategy5-watchdog.ps1", ["21:30"]],
];

function powershellJson(command) {
  const utf8Command = "$OutputEncoding=[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);" + command;
  const result = spawnSync("C:\\Program Files\\PowerShell\\7\\pwsh.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", utf8Command], {
    encoding: "utf8",
    timeout: 20000,
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(String(result.stderr || result.stdout || "schedule_query_failed").trim());
  const text = String(result.stdout || "").trim();
  return text ? JSON.parse(text) : [];
}

function rows() {
  const command = "$rows=Get-ScheduledTask | ForEach-Object {$a=$_.Actions|Select-Object -First 1;$i=Get-ScheduledTaskInfo -TaskName $_.TaskName -TaskPath $_.TaskPath -ErrorAction SilentlyContinue;$triggers=@($_.Triggers|ForEach-Object{[pscustomobject]@{startBoundary=[string]$_.StartBoundary;interval=[string]$_.Repetition.Interval;duration=[string]$_.Repetition.Duration}});[pscustomobject]@{name=[string]$_.TaskName;path=[string]$_.TaskPath;state=[string]$_.State;execute=[string]$a.Execute;arguments=[string]$a.Arguments;workingDirectory=[string]$a.WorkingDirectory;lastResult=[long]$i.LastTaskResult;triggers=$triggers}}; @($rows)|ConvertTo-Json -Depth 6 -Compress";
  const parsed = powershellJson(command);
  return Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
}

const tasks = rows();
const issues = [];
const evidence = [];
function triggerTimes(task) {
  return [...new Set((Array.isArray(task?.triggers) ? task.triggers : task?.triggers ? [task.triggers] : [])
    .map((trigger) => /T(\d{2}:\d{2})/.exec(String(trigger?.startBoundary || ""))?.[1])
    .filter(Boolean))].sort();
}
for (const [name, marker, expectedTimes, options = {}] of expected) {
  const task = tasks.find((row) => row.name === name) || tasks.find((row) => `${row?.execute || ""} ${row?.arguments || ""}`.toLowerCase().includes(marker.toLowerCase()));
  if (task && task.name !== name) issues.push(`formal_task_name_drift:${name}:${task.name}`);
  const action = `${task?.execute || ""} ${task?.arguments || ""}`;
  const active = task && ["Ready", "Running", "Queued"].includes(String(task.state || ""));
  const actionRootOk = action.toLowerCase().includes(FORMAL_ROOT.toLowerCase()) || (options.allowRuntimeAction === true && action.toLowerCase().includes("c:\\fuman-runtime\\ops"));
  const rootOk = actionRootOk && String(task?.workingDirectory || "").toLowerCase() === FORMAL_ROOT.toLowerCase();
  const markerOk = action.toLowerCase().includes(marker.toLowerCase());
  const actualTimes = triggerTimes(task);
  const timeOk = JSON.stringify(actualTimes) === JSON.stringify([...expectedTimes].sort());
  if (!task) issues.push(`formal_task_missing:${name}`);
  else if (!active) issues.push(`formal_task_not_active:${name}:${task.state || "unknown"}`);
  if (task && !rootOk) issues.push(`formal_task_root_drift:${name}`);
  if (task && !markerOk) issues.push(`formal_task_runner_mismatch:${name}`);
  if (task && !timeOk) issues.push(`formal_task_time_drift:${name}:expected=${expectedTimes.join(",")}:actual=${actualTimes.join(",") || "missing"}`);
  evidence.push({ name, state: task?.state || "missing", rootOk, markerOk, timeOk, expectedTimes, actualTimes, lastResult: task?.lastResult ?? null });
}

for (const task of tasks) {
  if (!/^Fuman\b/i.test(task.name || "")) continue;
  if (!["Ready", "Running", "Queued"].includes(String(task.state || ""))) continue;
  const action = `${task.execute || ""} ${task.arguments || ""} ${task.workingDirectory || ""}`;
  if (/C:\\fuman-terminal(?:\\|\b)/i.test(action) || /\\work\\/i.test(action)) issues.push(`active_fuman_task_uses_noncanonical_root:${task.name}`);
  if (/\bCB\b|warrant|權證/i.test(task.name || "")) issues.push(`retired_strategy_task_active:${task.name}`);
}

for (const name of ["Fuman Strategy2 Unified 0845-1230", "Fuman Strategy2 V3 Water Gate 0845", "Fuman Strategy2 V2 Unattended", "Fuman Strategy2 V2 Recovery", "Fuman Opening Report 0830 LINE", "Fuman Opening Report 0830 Line", "Fuman Opening Report 0830 LINE Bridge", "Fuman Opening Limit Order Morning Readonly 0840"]) {
  const task = tasks.find((row) => row.name === name && ["Ready", "Running", "Queued"].includes(String(row.state || "")));
  if (task) issues.push(`retired_formal_task_active:${name}`);
}

const root = path.resolve(__dirname, "..");
const strategy2Runner = fs.readFileSync(path.join(root, "ops", "run-strategy2-v3-unified.ps1"), "utf8");
const strategy2Live = fs.readFileSync(path.join(root, "scripts", "run-strategy2-v3-live-scan.js"), "utf8");
const strategy2Water = fs.readFileSync(path.join(root, "scripts", "run-strategy2-v3-water-scan.js"), "utf8");
const strategy2TimelineChecks = {
  preflightAt0845Only: strategy2Runner.includes("08:45 is a single water preflight"),
  scanStartsAt0900: strategy2Runner.includes("$scanStart = (Get-Date).Date.AddHours(9)"),
  finalizeAt1210: strategy2Runner.includes("$finalizeAt = (Get-Date).Date.AddHours(12).AddMinutes(10)"),
  noRunner1230Deadline: !strategy2Runner.includes("AddMinutes(30)"),
  liveWindowEnds1210: strategy2Live.includes("clock.minuteOfDay <= (12 * 60 + 10)"),
  waterWindowEnds1210: strategy2Water.includes("clock.minuteOfDay <= (12 * 60 + 10)"),
  noSleepPastFinalize: strategy2Runner.includes("$remainingSeconds") && strategy2Runner.includes("[Math]::Min(60, $remainingSeconds)"),
};
for (const [check, ok] of Object.entries(strategy2TimelineChecks)) {
  if (!ok) issues.push(`strategy2_timeline_drift:${check}`);
}
const report = {
  ok: issues.length === 0,
  contract: "fuman-formal-strategy-schedule-authority-v1",
  checkedAt: new Date().toISOString(),
  formalRoot: FORMAL_ROOT,
  expectedTaskCount: expected.length,
  evidence,
  issues,
  readOnly: true,
};
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);
