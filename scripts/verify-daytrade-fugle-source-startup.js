#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const ROOT = path.resolve(__dirname, "..");
const RUNTIME = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const TASK = "Fuman Fugle Daytrade WebSocket Collector 0600-1330";
const phase = (process.argv.find((arg) => arg.startsWith("--phase=")) || "--phase=closure").split("=")[1];
const issues = [];
const dateKey = (value) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
const today = dateKey(new Date());
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); } catch { return null; } };
const ageSeconds = (value) => { const n = Date.parse(String(value || "")); return Number.isFinite(n) ? Math.max(0, Math.floor((Date.now() - n) / 1000)) : 999999; };

function queryTask() {
  const command = `$t=Get-ScheduledTask -TaskName '${TASK}' -ErrorAction Stop; $i=Get-ScheduledTaskInfo -TaskName '${TASK}' -ErrorAction Stop; $a=$t.Actions|Select-Object -First 1; [ordered]@{count=@($t).Count;state=[string]$t.State;execute=[string]$a.Execute;arguments=[string]$a.Arguments;lastRunTime=$i.LastRunTime.ToString('o');lastResult=[int64]$i.LastTaskResult}|ConvertTo-Json -Compress`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], { encoding: "utf8", windowsHide: true, timeout: 15000 });
  if (result.status !== 0) return { error: String(result.stderr || result.stdout || "task_query_failed").trim() };
  try { return JSON.parse(String(result.stdout || "").trim()); } catch { return { error: "task_query_invalid_json" }; }
}

let task = null;
for (let attempt = 0; attempt < 16; attempt += 1) {
  task = queryTask();
  const runDate = String(task?.lastRunTime || "").slice(0, 10);
  if (String(task?.state) === "Running" || runDate === today) break;
  if (attempt < 15) sleep(2000);
}
if (task?.error) issues.push(task.error);
if (Number(task?.count) !== 1) issues.push(`collector_task_not_unique:${task?.count ?? "missing"}`);
if (!/Run-DaytradeWebSocketCollector\.ps1/i.test(`${task?.execute || ""} ${task?.arguments || ""}`)) issues.push("collector_action_not_authoritative");
const runDate = String(task?.lastRunTime || "").slice(0, 10);
if (String(task?.state) !== "Running" && runDate !== today) issues.push(`collector_not_naturally_started_today:${runDate || "missing"}`);

const statusFile = path.join(RUNTIME, "state", "fugle-daytrade-websocket-status-v2.json");
const status = readJson(statusFile);
if (phase === "closure") {
  if (!status) issues.push("v2_status_missing");
  if (status?.ok !== true) issues.push("v2_status_not_ok");
  if (status?.websocketConnected !== true) issues.push("v2_websocket_not_connected");
  if (status?.websocketAuthenticated !== true) issues.push("v2_websocket_not_authenticated");
  if (String(status?.mode || "") !== "streaming") issues.push("v2_websocket_not_streaming");
  if (String(status?.primarySource || "").toLowerCase() !== "fugle-websocket") issues.push("v2_primary_source_not_fugle_websocket");
  if (status?.restDisabled !== true) issues.push("v2_rest_not_disabled");
  const channels = Array.isArray(status?.streamingChannels) ? status.streamingChannels : [];
  for (const channel of ["trades", "aggregates", "candles"]) if (!channels.includes(channel)) issues.push(`v2_missing_channel_${channel}`);
  if (ageSeconds(status?.updatedAt) > 180) issues.push(`v2_status_stale:${ageSeconds(status?.updatedAt)}`);
}
const result = { ok: issues.length === 0, contract: "fuman-daytrade-fugle-source-startup-v1", phase, tradeDate: today, readOnly: true, startsTask: false, retriesTask: false, task, statusFile, status: status ? { ok: status.ok === true, updatedAt: status.updatedAt || "", ageSeconds: ageSeconds(status.updatedAt), websocketConnected: status.websocketConnected === true, websocketAuthenticated: status.websocketAuthenticated === true, mode: status.mode || "", primarySource: status.primarySource || "", restDisabled: status.restDisabled === true, streamingChannels: status.streamingChannels || [] } : null, failed_checks: issues, first_blocker: issues[0] || null };
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.ok ? 0 : 1;