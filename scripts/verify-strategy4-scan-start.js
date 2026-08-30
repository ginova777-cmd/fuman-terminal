"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const TASK_NAME = "Fuman Strategy4 Cache 1600";
const PWSH = "C:/Program Files/PowerShell/7/pwsh.exe";

function taipeiClock() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", weekday: "short",
  }).formatToParts(new Date()).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return { ...parts, tradeDate: `${parts.year}-${parts.month}-${parts.day}`, compactDate: `${parts.year}${parts.month}${parts.day}`, minuteOfDay: Number(parts.hour) * 60 + Number(parts.minute) };
}
function queryTasks() {
  const command = `$primary=Get-ScheduledTask -TaskName '${TASK_NAME}' -ErrorAction SilentlyContinue;$rows=@(Get-ScheduledTask|ForEach-Object{$a=$_.Actions|Select-Object -First 1;$i=Get-ScheduledTaskInfo -TaskName $_.TaskName -TaskPath $_.TaskPath -ErrorAction SilentlyContinue;[pscustomobject]@{name=[string]$_.TaskName;state=[string]$_.State;execute=[string]$a.Execute;arguments=[string]$a.Arguments;workingDirectory=[string]$a.WorkingDirectory;lastRunTime=if($i){$i.LastRunTime.ToString('o')}else{''};lastResult=if($i){[int64]$i.LastTaskResult}else{-1}}});[pscustomobject]@{rows=$rows}|ConvertTo-Json -Depth 5 -Compress`;
  const child = spawnSync(PWSH, ["-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8", windowsHide: true, timeout: 20000 });
  if (child.status !== 0) return { error: String(child.stderr || child.stdout || "task_query_failed").trim(), rows: [] };
  try {
    const parsed = JSON.parse(String(child.stdout || "{}").trim());
    return { rows: Array.isArray(parsed.rows) ? parsed.rows : parsed.rows ? [parsed.rows] : [] };
  } catch { return { error: "task_query_invalid_json", rows: [] }; }
}
function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
function taskEvidence(clock) {
  const queried = queryTasks();
  const primary = queried.rows.find((row) => row.name === TASK_NAME) || null;
  const action = `${primary?.execute || ""} ${primary?.arguments || ""} ${primary?.workingDirectory || ""}`;
  const lastRun = Date.parse(String(primary?.lastRunTime || ""));
  const lastRunParts = Number.isFinite(lastRun) ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(lastRun)) : "";
  const startedTodayAt1600 = lastRunParts.startsWith(clock.tradeDate) && /16:00$/.test(lastRunParts);
  const active = ["Running", "Queued"].includes(String(primary?.state || ""));
  const actionOk = /run-strategy4\.ps1/i.test(action) && action.toLowerCase().includes(ROOT.toLowerCase());
  const conflicts = queried.rows.filter((row) => {
    if (row.name === TASK_NAME || !["Ready", "Running", "Queued"].includes(String(row.state || ""))) return false;
    const text = `${row.execute || ""} ${row.arguments || ""}`;
    return /run-strategy4\.ps1|scan-strategy4-cache\.js/i.test(text);
  });
  return { queried, primary, action, startedTodayAt1600, active, actionOk, conflicts };
}

const clock = taipeiClock();
const tradingDay = !["Sat", "Sun"].includes(clock.weekday);
const due = tradingDay && clock.minuteOfDay >= 960 && clock.minuteOfDay <= 1020;
let evidence = taskEvidence(clock);
if (due) {
  for (let attempt = 1; attempt < 10 && !(evidence.active || evidence.startedTodayAt1600); attempt += 1) {
    sleep(2000);
    evidence = taskEvidence(clock);
  }
}
const issues = [];
if (evidence.queried.error) issues.push(evidence.queried.error);
if (!evidence.primary) issues.push("strategy4_primary_task_missing");
if (evidence.primary && !evidence.actionOk) issues.push("strategy4_primary_task_action_drift");
if (evidence.conflicts.length) issues.push("strategy4_duplicate_scanner_task_active");
if (due && !(evidence.active || evidence.startedTodayAt1600)) issues.push("strategy4_original_1600_task_not_started");
const ok = issues.length === 0;
const payload = {
  ok,
  status: ok ? "PASS" : "FAIL_CLOSED",
  contract: "strategy4-scan-start-readonly-v1",
  checkedAt: new Date().toISOString(),
  tradeDate: clock.tradeDate,
  due,
  readOnly: true,
  strategyStartedByVerifier: false,
  scanStartedByVerifier: false,
  runIdGeneratedByVerifier: false,
  task: evidence.primary ? { name: evidence.primary.name, state: evidence.primary.state, lastRunTime: evidence.primary.lastRunTime, lastResult: evidence.primary.lastResult, actionOk: evidence.actionOk } : null,
  startedTodayAt1600: evidence.startedTodayAt1600,
  activeOriginalTask: evidence.active,
  duplicateScannerTasks: evidence.conflicts.map((row) => ({ name: row.name, state: row.state })),
  firstBlocker: issues[0] || null,
  issues,
};
const outDir = path.join(RUNTIME_DIR, "data", "scan-receipts");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, `strategy4-scan-start-${clock.compactDate}.json`), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(JSON.stringify(payload, null, 2));
process.exitCode = ok ? 0 : 1;
