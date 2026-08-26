"use strict";

const { spawnSync } = require("child_process");

const FORMAL_ROOT = "C:\\fuman-release-owner\\fuman-terminal";
const expected = [
  ["Fuman Terminal Autonomous Root Monitor", "run-terminal-master-control.ps1"],
  ["Fuman Strategy2 Unified 0845-1230", "ops\\run-strategy2-v3-unified.ps1"],
  ["Fuman Mother Pool Telegram 0900-1230", "run-daytrade-intraday-burst-telegram.ps1"],
  ["Fuman Strategy3 V2 First Attempt 1255", "run-strategy3-v2-1255-first-attempt.ps1"],
  ["Fuman Strategy3 V2 Complete Scan 1300", "run-strategy3-v2-complete-scan.ps1"],
  ["Fuman Strategy3 V2 Daily Closure Verify 1315", "verify-strategy3-v2-daily-unattended-closure.js"],
  ["Fuman Strategy4 Source Prewarm 1535", "run-strategy4-source-prewarm.ps1"],
  ["Fuman Strategy4 Cache 1600", "run-strategy4.ps1"],
  ["Fuman Chip Source Sync 2005", "run-chip-source-sync.ps1"],
  ["Fuman Strategy5 Cache 2100", "run-strategy5.ps1"],
  ["Fuman 買賣超 Cache 2100", "run-institution.ps1"],
  ["Fuman Institution Battle Verify 2110", "run-institution-battle-verify.ps1"],
  ["Fuman 買賣超 Watchdog 2115", "run-flow-watchdog.ps1"],
  ["Fuman Strategy5 Watchdog 2130", "run-strategy5-watchdog.ps1"],
];

function powershellJson(command) {
  const result = spawnSync("C:\\Program Files\\PowerShell\\7\\pwsh.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command], {
    encoding: "utf8",
    timeout: 20000,
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(String(result.stderr || result.stdout || "schedule_query_failed").trim());
  const text = String(result.stdout || "").trim();
  return text ? JSON.parse(text) : [];
}

function rows() {
  const command = "$rows=Get-ScheduledTask | ForEach-Object {$a=$_.Actions|Select-Object -First 1;$i=Get-ScheduledTaskInfo -TaskName $_.TaskName -TaskPath $_.TaskPath -ErrorAction SilentlyContinue;[pscustomobject]@{name=[string]$_.TaskName;path=[string]$_.TaskPath;state=[string]$_.State;execute=[string]$a.Execute;arguments=[string]$a.Arguments;workingDirectory=[string]$a.WorkingDirectory;lastResult=[long]$i.LastTaskResult}}; @($rows)|ConvertTo-Json -Depth 4 -Compress";
  const parsed = powershellJson(command);
  return Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
}

const tasks = rows();
const issues = [];
const evidence = [];
for (const [name, marker] of expected) {
  const task = tasks.find((row) => row.name === name) || tasks.find((row) => `${row?.execute || ""} ${row?.arguments || ""}`.toLowerCase().includes(marker.toLowerCase()));
  const action = `${task?.execute || ""} ${task?.arguments || ""}`;
  const active = task && ["Ready", "Running", "Queued"].includes(String(task.state || ""));
  const rootOk = action.toLowerCase().includes(FORMAL_ROOT.toLowerCase()) && String(task?.workingDirectory || "").toLowerCase() === FORMAL_ROOT.toLowerCase();
  const markerOk = action.toLowerCase().includes(marker.toLowerCase());
  if (!task) issues.push(`formal_task_missing:${name}`);
  else if (!active) issues.push(`formal_task_not_active:${name}:${task.state || "unknown"}`);
  if (task && !rootOk) issues.push(`formal_task_root_drift:${name}`);
  if (task && !markerOk) issues.push(`formal_task_runner_mismatch:${name}`);
  evidence.push({ name, state: task?.state || "missing", rootOk, markerOk, lastResult: task?.lastResult ?? null });
}

for (const task of tasks) {
  if (!/^Fuman\b/i.test(task.name || "")) continue;
  if (!["Ready", "Running", "Queued"].includes(String(task.state || ""))) continue;
  const action = `${task.execute || ""} ${task.arguments || ""} ${task.workingDirectory || ""}`;
  if (/C:\\fuman-terminal(?:\\|\b)/i.test(action) || /\\work\\/i.test(action)) issues.push(`active_fuman_task_uses_noncanonical_root:${task.name}`);
  if (/\bCB\b|warrant|權證/i.test(task.name || "")) issues.push(`retired_strategy_task_active:${task.name}`);
}

for (const name of ["Fuman Strategy2 V3 Water Gate 0845", "Fuman Strategy2 V2 Unattended", "Fuman Strategy2 V2 Recovery"]) {
  const task = tasks.find((row) => row.name === name && ["Ready", "Running", "Queued"].includes(String(row.state || "")));
  if (task) issues.push(`retired_strategy2_task_active:${name}`);
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
