#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const ROOT = path.resolve(__dirname, "..");
const RUNTIME = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const COLLECTOR_TASK = "Fuman Fugle Daytrade WebSocket Collector 0600-1330";
const WRITER_TASK = "Fuman Daytrade Source Writer 0600-1330";
const phase = (process.argv.find((arg) => arg.startsWith("--phase=")) || "--phase=closure").split("=")[1];
const issues = [];
const dateKey = (value) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
const today = dateKey(new Date());
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); } catch { return null; } };
const ageSeconds = (value) => { const n = Date.parse(String(value || "")); return Number.isFinite(n) ? Math.max(0, Math.floor((Date.now() - n) / 1000)) : 999999; };
const authority = readJson(path.join(ROOT, "data", "contracts", "release_root_authority_v1.json")) || {};
const productionRoot = String(authority.productionRoot || "");

function queryTask(name) {
  const escaped = name.replace(/'/g, "''");
  const command = `$t=Get-ScheduledTask -TaskName '${escaped}' -ErrorAction Stop; $i=Get-ScheduledTaskInfo -TaskName '${escaped}' -ErrorAction Stop; $a=$t.Actions|Select-Object -First 1; [ordered]@{count=@($t).Count;state=[string]$t.State;execute=[string]$a.Execute;arguments=[string]$a.Arguments;workingDirectory=[string]$a.WorkingDirectory;lastRunTime=$i.LastRunTime.ToString('o');lastResult=[int64]$i.LastTaskResult}|ConvertTo-Json -Compress`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], { encoding: "utf8", windowsHide: true, timeout: 15000 });
  if (result.status !== 0) return { error: String(result.stderr || result.stdout || "task_query_failed").trim() };
  try { return JSON.parse(String(result.stdout || "").trim()); } catch { return { error: "task_query_invalid_json" }; }
}

function queryActiveWriterOwners() {
  const command = `$rows=@(Get-ScheduledTask | Where-Object { [string]$_.State -ne 'Disabled' -and (($_.Actions | ForEach-Object { [string]$_.Execute+' '+[string]$_.Arguments }) -join ' ') -match 'Run-DaytradeSourceWriter(?:Pinned)?\\.ps1' } | ForEach-Object { [ordered]@{name=$_.TaskName;state=[string]$_.State} });[ordered]@{count=$rows.Count;rows=$rows}|ConvertTo-Json -Compress -Depth 5`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], { encoding: "utf8", windowsHide: true, timeout: 20000 });
  if (result.status !== 0) return { error: String(result.stderr || result.stdout || "writer_owner_query_failed").trim() };
  try { return JSON.parse(String(result.stdout || "").trim()); } catch { return { error: "writer_owner_query_invalid_json" }; }
}

let collectorTask = null;
let writerTask = null;
for (let attempt = 0; attempt < 16; attempt += 1) {
  collectorTask = queryTask(COLLECTOR_TASK);
  writerTask = queryTask(WRITER_TASK);
  const collectorStarted = String(collectorTask?.state) === "Running" || String(collectorTask?.lastRunTime || "").slice(0, 10) === today;
  const writerStarted = String(writerTask?.state) === "Running" || String(writerTask?.lastRunTime || "").slice(0, 10) === today;
  if (collectorStarted && writerStarted) break;
  if (attempt < 15) sleep(2000);
}

const writerOwners = queryActiveWriterOwners();
if (collectorTask?.error) issues.push(collectorTask.error);
if (Number(collectorTask?.count) !== 1) issues.push(`collector_task_not_unique:${collectorTask?.count ?? "missing"}`);
if (!/Run-DaytradeWebSocketCollector\.ps1/i.test(`${collectorTask?.execute || ""} ${collectorTask?.arguments || ""}`)) issues.push("collector_action_not_authoritative");
if (productionRoot && !`${collectorTask?.arguments || ""} ${collectorTask?.workingDirectory || ""}`.toLowerCase().includes(productionRoot.toLowerCase())) issues.push("collector_production_root_mismatch");
if (String(collectorTask?.state) !== "Running" && String(collectorTask?.lastRunTime || "").slice(0, 10) !== today) issues.push(`collector_not_naturally_started_today:${String(collectorTask?.lastRunTime || "").slice(0, 10) || "missing"}`);

if (writerTask?.error) issues.push(writerTask.error);
if (Number(writerTask?.count) !== 1) issues.push(`writer_task_not_unique:${writerTask?.count ?? "missing"}`);
if (!/Run-DaytradeSourceWriterPinned\.ps1/i.test(`${writerTask?.execute || ""} ${writerTask?.arguments || ""}`)) issues.push("writer_action_not_authoritative");
if (productionRoot && !`${writerTask?.arguments || ""} ${writerTask?.workingDirectory || ""}`.toLowerCase().includes(productionRoot.toLowerCase())) issues.push("writer_production_root_mismatch");
if (String(writerTask?.state) !== "Running" && String(writerTask?.lastRunTime || "").slice(0, 10) !== today) issues.push(`writer_not_naturally_started_today:${String(writerTask?.lastRunTime || "").slice(0, 10) || "missing"}`);
if (writerOwners?.error) issues.push(writerOwners.error);
if (Number(writerOwners?.count) !== 1 || writerOwners?.rows?.[0]?.name !== WRITER_TASK) issues.push(`writer_active_owner_not_unique:${writerOwners?.count ?? "missing"}`);

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

const result = {
  ok: issues.length === 0,
  contract: "fuman-daytrade-fugle-source-startup-v2",
  phase,
  tradeDate: today,
  readOnly: true,
  startsTask: false,
  retriesTask: false,
  productionRoot,
  collectorTask,
  writerTask,
  activeWriterOwners: writerOwners,
  statusFile,
  status: status ? { ok: status.ok === true, updatedAt: status.updatedAt || "", ageSeconds: ageSeconds(status.updatedAt), websocketConnected: status.websocketConnected === true, websocketAuthenticated: status.websocketAuthenticated === true, mode: status.mode || "", primarySource: status.primarySource || "", restDisabled: status.restDisabled === true, streamingChannels: status.streamingChannels || [] } : null,
  failed_checks: issues,
  first_blocker: issues[0] || null,
};
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.ok ? 0 : 1;
