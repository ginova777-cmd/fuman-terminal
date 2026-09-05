"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const FORMAL_ROOT = "C:\\fuman-release-owner\\fuman-terminal";
const FORMAL_ROOT_PATTERN = /^C:\\fuman-release-owner\\fuman-terminal(?:-release-\d{8}-git)?$/i;
function isFormalRoot(value) { return FORMAL_ROOT_PATTERN.test(String(value || "").trim()); }
function actionUsesFormalRoot(value) { return /C:\\fuman-release-owner\\fuman-terminal(?:-release-\d{8}-git)?(?:\\|\b)/i.test(String(value || "")); }
const expected = [
  ["Fuman Terminal Autonomous Root Monitor", "run-terminal-master-control.ps1", ["06:00", "06:05", "07:00", "07:08", "08:20", "08:29", "08:30", "08:35", "08:36", "08:40", "08:45", "08:50", "08:55", "09:00", "12:30", "12:40", "12:50", "12:55", "13:00", "13:15", "13:30", "15:35", "16:00", "17:00", "17:10", "17:40", "18:10", "18:40", "19:10", "20:05", "21:00", "21:10", "21:15", "21:40", "22:00", "23:10"]],
  ["Fuman Daytrade Source Writer 0600-1330", "Run-DaytradeSourceWriter", ["06:00"], { allowRuntimeAction: true }],
  ["Fuman Fugle Daytrade WebSocket Collector 0600-1330", "Run-DaytradeWebSocketCollector.ps1", ["06:00"]],
  ["Fuman Daytrade Source Gate 0700", "Run-DaytradeUnattendedGate.ps1", ["07:00"], { allowRuntimeAction: true }],
  ["Fuman Opening Report 0820 Preflight", "run-opening-report-0820-preflight.js", ["08:20"]],
  ["Fuman Morning Report 0830 Complete", "run-opening-report-0830-production-wrapper.ps1", ["08:30"]],
  ["Fuman Opening Limit Order Morning Readonly 0840", "ops\\Run-OpeningLimitOrderMorningReadonly.ps1", ["08:40"]],
  ["Fuman Daytrade Futopt Collector Recovery 0835", "Ensure-DaytradeFutoptCollector0835.ps1", ["08:35"], { allowRuntimeAction: true }],
  ["Fuman Daytrade Futopt Preopen Evidence 0845", "Run-DaytradeFutoptPreopenEvidence.ps1", ["08:45"], { allowRuntimeAction: true }],
  ["Fuman Daytrade Futopt Preopen Evidence 0850", "Run-DaytradeFutoptPreopenEvidence.ps1", ["08:50"], { allowRuntimeAction: true }],
  ["Fuman Daytrade Near-One Natural Source", "run-daytrade-near-one-source.js", ["08:45", "08:46", "08:47", "08:48", "08:49", "08:50", "08:51", "08:52", "08:53", "08:54", "08:55", "08:56", "08:57", "08:58", "08:59"], { requireS4U: true }],
  ["Fuman Strategy2 Unified 0845-1230", "ops\\run-strategy2-v3-unified.ps1", ["08:45"]],
  ["Fuman Mother Pool Telegram 0900-1230", "run-daytrade-intraday-burst-telegram.ps1", ["09:00"]],
  ["Fuman Strategy3 V2 Readiness Guard 1230", "run-strategy3-v2-readiness-guard.ps1", ["12:30"]],
  ["Fuman Strategy3 V2 Readiness Guard 1250", "run-strategy3-v2-readiness-guard.ps1", ["12:50"]],
  ["Fuman Strategy3 V2 First Attempt 1255", "run-strategy3-v2-1255-first-attempt.ps1", ["12:55"]],
  ["Fuman Strategy3 V2 Complete Scan 1300", "run-strategy3-v2-complete-scan.ps1", ["13:00"]],
  ["Fuman Strategy3 V2 Daily Closure Verify 1310", "verify-strategy3-v2-daily-unattended-closure.js", ["13:10"]],
  ["Fuman Strategy4 Source Prewarm 1535", "run-strategy4-source-prewarm.ps1", ["15:35"]],
  ["Fuman Strategy4 Cache 1600", "run-strategy4.ps1", ["16:00"]],
  ["Fuman Chip Source Sync 2005", "run-chip-source-sync.ps1", ["20:05"]],
  ["Fuman Strategy5 Cache 2100", "run-strategy5-complete.ps1", ["21:00"]],
  ["Fuman 買賣超 Cache 2100", "run-institution.ps1", ["21:00"]],
  ["Fuman Buy Sell Complete 2110", "run-buy-sell-complete.ps1", ["21:10"]],
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
  const command = "$rows=Get-ScheduledTask | ForEach-Object {$a=$_.Actions|Select-Object -First 1;$i=Get-ScheduledTaskInfo -TaskName $_.TaskName -TaskPath $_.TaskPath -ErrorAction SilentlyContinue;$triggers=@($_.Triggers|ForEach-Object{[pscustomobject]@{startBoundary=[string]$_.StartBoundary;interval=[string]$_.Repetition.Interval;duration=[string]$_.Repetition.Duration}});[pscustomobject]@{name=[string]$_.TaskName;path=[string]$_.TaskPath;state=[string]$_.State;execute=[string]$a.Execute;arguments=[string]$a.Arguments;workingDirectory=[string]$a.WorkingDirectory;logonType=[string]$_.Principal.LogonType;runLevel=[string]$_.Principal.RunLevel;lastResult=[long]$i.LastTaskResult;triggers=$triggers}}; @($rows)|ConvertTo-Json -Depth 6 -Compress";
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
  const actionRootOk = actionUsesFormalRoot(action) || (options.allowRuntimeAction === true && action.toLowerCase().includes("c:\\fuman-runtime\\ops"));
  const workingDirectory = String(task?.workingDirectory || "").trim();
  const rootOk = actionRootOk && (!workingDirectory || isFormalRoot(workingDirectory));
  const markerOk = action.toLowerCase().includes(marker.toLowerCase());
  const actualTimes = triggerTimes(task);
  const timeOk = JSON.stringify(actualTimes) === JSON.stringify([...expectedTimes].sort());
  if (!task) issues.push(`formal_task_missing:${name}`);
  else if (!active) issues.push(`formal_task_not_active:${name}:${task.state || "unknown"}`);
  if (task && !rootOk) issues.push(`formal_task_root_drift:${name}`);
  if (task && !markerOk) issues.push(`formal_task_runner_mismatch:${name}`);
  if (task && !timeOk) issues.push(`formal_task_time_drift:${name}:expected=${expectedTimes.join(",")}:actual=${actualTimes.join(",") || "missing"}`);
  const logonOk = options.allowInteractive === true || String(task?.logonType || "").toLowerCase() === "s4u";
  if (task && !logonOk) issues.push(`formal_task_logon_drift:${name}:expected=S4U:actual=${task.logonType || "missing"}`);
  evidence.push({ name, state: task?.state || "missing", rootOk, markerOk, timeOk, logonOk, logonType: task?.logonType || "", expectedTimes, actualTimes, lastResult: task?.lastResult ?? null });
}

for (const task of tasks) {
  if (!/^Fuman\b/i.test(task.name || "")) continue;
  if (!["Ready", "Running", "Queued"].includes(String(task.state || ""))) continue;
  const action = `${task.execute || ""} ${task.arguments || ""} ${task.workingDirectory || ""}`;
  const productionMirrorArgumentOnly = task.name === "Fuman Vercel Cost Health Monitor 2115"
    && /-ProductionMirrorRoot\s+"C:\\fuman-terminal"/i.test(action)
    && actionUsesFormalRoot(action)
    && isFormalRoot(task.workingDirectory);
  if ((/C:\\fuman-terminal(?:\\|\b)/i.test(action) && !productionMirrorArgumentOnly) || /\\work\\/i.test(action)) issues.push(`active_fuman_task_uses_noncanonical_root:${task.name}`);
  if (/\bCB\b|warrant|權證/i.test(task.name || "")) issues.push(`retired_strategy_task_active:${task.name}`);
}

for (const name of ["Fuman Strategy2 V3 Water Gate 0845", "Fuman Strategy2 V2 Unattended", "Fuman Strategy2 V2 Recovery", "Fuman Opening Report 0830 Telegram", "Fuman Opening Report 0830 Line", "Fuman Opening Report 0830 LINE Bridge", "Fuman Opening Limit Order Morning Readonly 0845", "Fuman Opening Limit Order 0900 Readonly Verify"]) {
  const task = tasks.find((row) => row.name === name && ["Ready", "Running", "Queued"].includes(String(row.state || "")));
  if (task) issues.push(`retired_formal_task_active:${name}`);
}

const root = path.resolve(__dirname, "..");
const strategy2Runner = fs.readFileSync(path.join(root, "ops", "run-strategy2-v3-unified.ps1"), "utf8");
const strategy2Live = fs.readFileSync(path.join(root, "scripts", "run-strategy2-v3-live-scan.js"), "utf8");
const strategy2Water = fs.readFileSync(path.join(root, "scripts", "run-strategy2-v3-water-scan.js"), "utf8");
const strategy2Installer = fs.readFileSync(path.join(root, "scripts", "install-strategy2-v3-unified-task.ps1"), "utf8");
const strategy2TimelineChecks = {
  preflightAt0845Only: strategy2Runner.includes("08:45 is a single water preflight"),
  scanStartsAt0900: strategy2Runner.includes("$scanStart = (Get-Date).Date.AddHours(9)"),
  finalizeAt1230: strategy2Runner.includes("$finalizeAt = (Get-Date).Date.AddHours(12).AddMinutes(30)"),
  runner1230Deadline: strategy2Runner.includes("AddMinutes(30)"),
  liveWindowEnds1230: strategy2Live.includes("clock.minuteOfDay <= (12 * 60 + 30)"),
  waterWindowEnds1230: strategy2Water.includes("clock.minuteOfDay <= (12 * 60 + 30)"),
  noSleepPastFinalize: strategy2Runner.includes("$remainingSeconds") && strategy2Runner.includes("[Math]::Min(60, $remainingSeconds)"),
  installerUsesCanonical1230Name: strategy2Installer.includes('[string]$TaskName = "Fuman Strategy2 Unified 0845-1230"'),
  installerRetiresLegacy1210Name: strategy2Installer.includes('"Fuman Strategy2 Unified 0845-1210"'),
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
