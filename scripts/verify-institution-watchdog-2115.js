#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const runtime = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const taskName = "Fuman 買賣超 Watchdog 2115";
const issues = [];
const dateKey = (value) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
const today = dateKey(new Date());
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };
let task = null;
try {
  const script = `$t=Get-ScheduledTask -TaskName '${taskName}' -ErrorAction Stop; $i=Get-ScheduledTaskInfo -TaskName '${taskName}' -ErrorAction Stop; [pscustomobject]@{count=@($t).Count;state=[string]$t.State;execute=$t.Actions[0].Execute;arguments=$t.Actions[0].Arguments;lastRunTime=$i.LastRunTime.ToString('o');lastTaskResult=$i.LastTaskResult}|ConvertTo-Json -Compress`;
  task = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8", windowsHide: true }));
} catch (error) { issues.push(`watchdog_task_query_failed:${error.message}`); }
if (task) {
  if (Number(task.count) !== 1) issues.push(`watchdog_task_not_unique:${task.count}`);
  if (!/run-flow-watchdog\.ps1/i.test(`${task.execute} ${task.arguments}`)) issues.push("watchdog_action_not_authoritative");
  const runDate = String(task.lastRunTime || "").slice(0, 10);
  if (runDate !== today && String(task.state) !== "Running") issues.push(`watchdog_not_started_today:${runDate || "missing"}`);
}
const health = readJson(path.join(runtime, "state", "flow-health-latest.json"))?.institution || null;
const healthDate = health?.updatedAt ? dateKey(new Date(health.updatedAt)) : "";
const running = String(task?.state || "") === "Running";
if (!running && healthDate !== today) issues.push(`institution_watchdog_health_not_today:${healthDate || "missing"}`);
if (!running && !["ok", "watchdog_failed"].includes(String(health?.status || ""))) issues.push(`institution_watchdog_health_status_invalid:${health?.status || "missing"}`);
if (!running && String(health?.status || "") === "watchdog_failed") issues.push("immutable_failure_receipt_present_no_retry_allowed");
const result = { ok: issues.length === 0, contract: "fuman-institution-watchdog-2115-readonly-v1", tradeDate: today, task, institutionHealth: health, retryAllowed: false, guards: { existingRunIdBlocksRetry: true, runningTaskBlocksRetry: true, immutableFailureReceiptBlocksRetry: true }, failed_checks: issues, first_blocker: issues[0] || null };
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.ok ? 0 : 1;