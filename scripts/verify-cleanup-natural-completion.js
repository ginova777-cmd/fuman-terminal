"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const RUNTIME = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const STATUS = path.join(RUNTIME, "status");
const stageArg = process.argv.find((arg) => arg.startsWith("--stage="));
const waitArg = process.argv.find((arg) => arg.startsWith("--wait-ms="));
const stage = Number(stageArg?.split("=")[1]);

function taipeiParts(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return { iso: `${get("year")}-${get("month")}-${get("day")}`, id: `${get("year")}${get("month")}${get("day")}` };
}
const today = taipeiParts();
const stages = {
  1: { task: "Fuman API-Only Retired Artifact Cleanup 1535", action: "run-api-only-retired-cleanup.ps1", receipt: path.join(STATUS, "api-only-retired-cleanup-status.json"), timeFields: ["finishedAt", "checkedAt"], waitMs: 240000 },
  2: { task: "Fuman Supabase Vercel History Cleanup 1545", action: "run-history-retention-cleanup.ps1", receipt: path.join(STATUS, "supabase-vercel-history-cleanup-status.json"), timeFields: ["checkedAt", "finishedAt"], waitMs: 900000 },
  3: { task: "Fuman Global Cost Janitor Scorecard 1555", action: "run-global-cost-janitor-scorecard.ps1", receipt: path.join(STATUS, "global-cost-janitor-scorecard.json"), timeFields: ["checkedAt"], waitMs: 300000 },
  4: { task: "Fuman Daytrade Intraday Retention 1605", action: "run-daytrade-intraday-retention.ps1", receipt: path.join(STATUS, `daytrade-intraday-retention-${today.id}.json`), timeFields: ["checkedAt"], waitMs: 1200000 },
  5: { task: "Fuman Daily Retention Maintenance 1625", action: "run-daily-retention-maintenance.ps1", receipt: path.join(STATUS, `daily-retention-maintenance-verifier-${today.id}.json`), timeFields: ["checkedAt"], waitMs: 1200000 },
};

function readJson(file) {
  try { return { value: JSON.parse(fs.readFileSync(file, "utf8")), error: null }; }
  catch (error) { return { value: null, error: error.message }; }
}
function queryTask(spec) {
  const escaped = spec.task.replace(/'/g, "''");
  const command = `$t=Get-ScheduledTask -TaskName '${escaped}' -ErrorAction SilentlyContinue;if($null -eq $t){'{\"missing\":true}';exit};$i=Get-ScheduledTaskInfo -TaskName '${escaped}';[ordered]@{missing=$false;state=[string]$t.State;lastResult=[int]$i.LastTaskResult;lastRun=$i.LastRunTime.ToString('o');action=(($t.Actions|ForEach-Object{([string]$_.Execute)+' '+([string]$_.Arguments)})-join ' | ')}|ConvertTo-Json -Compress`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], { encoding: "utf8", windowsHide: true, timeout: 20000 });
  try { return { ...JSON.parse(String(result.stdout || "").trim()), queryExit: result.status, queryError: String(result.stderr || "").trim() || result.error?.message || null }; }
  catch { return { missing: true, queryExit: result.status, queryError: String(result.stderr || result.stdout || "").trim() || result.error?.message || "task_query_parse_failed" }; }
}
function sameTaipeiDay(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) && taipeiParts(new Date(parsed)).iso === today.iso && parsed <= Date.now() + 60000;
}
function inspect(spec) {
  const task = queryTask(spec);
  const read = readJson(spec.receipt);
  const timestampField = spec.timeFields.find((field) => read.value?.[field]);
  const timestamp = timestampField ? read.value[timestampField] : null;
  const taskToday = sameTaipeiDay(task.lastRun);
  const receiptToday = sameTaipeiDay(timestamp);
  const taskComplete = !task.missing && taskToday && task.state !== "Running" && Number(task.lastResult) === 0 && String(task.action || "").includes(spec.action);
  return { ok: taskComplete && receiptToday, taskComplete, taskToday, receiptToday, task, receipt: read.value, receiptError: read.error, timestampField, timestamp };
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function main() {
  const spec = stages[stage];
  if (!spec) { console.error(JSON.stringify({ ok: false, stage, issues: ["unsupported_cleanup_stage"] }, null, 2)); process.exitCode = 2; return; }
  const waitMs = Math.max(0, Number(waitArg?.split("=")[1] ?? spec.waitMs) || 0);
  const deadline = Date.now() + waitMs;
  let state = inspect(spec);
  while (!state.ok && Date.now() < deadline) {
    await sleep(Math.min(5000, Math.max(1, deadline - Date.now())));
    state = inspect(spec);
  }
  const issues = [];
  if (state.task.missing) issues.push("cleanup_task_missing");
  else {
    if (!String(state.task.action || "").includes(spec.action)) issues.push("cleanup_task_action_mismatch");
    if (!state.taskToday) issues.push("cleanup_task_not_run_today");
    if (state.task.state === "Running") issues.push("cleanup_task_still_running");
    if (state.taskToday && state.task.state !== "Running" && Number(state.task.lastResult) !== 0) issues.push("cleanup_task_result_nonzero");
  }
  if (!state.receiptToday) issues.push("cleanup_receipt_not_today");
  const result = {
    contract: "cleanup-natural-completion-verifier-v1", ok: issues.length === 0,
    checkedAt: new Date().toISOString(), tradeDate: today.iso, stage, taskName: spec.task,
    expectedAction: spec.action, waitedUpToMs: waitMs, task: state.task,
    receiptFile: spec.receipt, receiptTimestampField: state.timestampField || null, receiptTimestamp: state.timestamp,
    receiptSummary: state.receipt ? { ok: state.receipt.ok === true, status: state.receipt.status || null, applied: state.receipt.applied === true, contract: state.receipt.contract || null, reasonCode: state.receipt.reasonCode || null } : null,
    receiptReadError: state.receiptError, issues,
    actionsByVerifier: { taskStarted: false, cleanupExecuted: false, mutationExecuted: false, strategyExecuted: false, scannerExecuted: false, runIdGenerated: false },
    reasonCode: issues[0] || "ok",
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
main().catch((error) => { console.error(JSON.stringify({ ok: false, error: error.message }, null, 2)); process.exitCode = 1; });
