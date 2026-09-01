#!/usr/bin/env node
"use strict";
const { spawnSync } = require("child_process");
const TASK = "Fuman Daytrade Source Gate 0700";
const issues = [];
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function queryTask() {
  const command = `$t=Get-ScheduledTask -TaskName '${TASK}' -ErrorAction Stop; $i=Get-ScheduledTaskInfo -TaskName '${TASK}' -ErrorAction Stop; $a=$t.Actions|Select-Object -First 1; [ordered]@{count=@($t).Count;state=[string]$t.State;execute=[string]$a.Execute;arguments=[string]$a.Arguments;lastRunTime=$i.LastRunTime.ToString('o');lastResult=[int64]$i.LastTaskResult}|ConvertTo-Json -Compress`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], { encoding: "utf8", windowsHide: true, timeout: 15000 });
  if (result.status !== 0) return { error: String(result.stderr || result.stdout || "task_query_failed").trim() };
  try { return JSON.parse(String(result.stdout || "").trim()); } catch { return { error: "task_query_invalid_json" }; }
}
let task = null;
for (let attempt=0; attempt<16; attempt+=1) {
  task=queryTask();
  const runDate=String(task?.lastRunTime||"").slice(0,10);
  if(String(task?.state)==="Running"||runDate===today) break;
  if(attempt<15) sleep(2000);
}
if(task?.error) issues.push(task.error);
if(Number(task?.count)!==1) issues.push(`warmup_task_not_unique:${task?.count??"missing"}`);
const action=`${task?.execute||""} ${task?.arguments||""}`;
if(!/Run-DaytradeUnattendedGate\.ps1/i.test(action)||!/-Phase\s+0700/i.test(action)) issues.push("warmup_task_action_not_authoritative_0700");
const runDate=String(task?.lastRunTime||"").slice(0,10);
if(String(task?.state)!=="Running"&&runDate!==today) issues.push(`warmup_task_not_naturally_started_today:${runDate||"missing"}`);
const result={ok:issues.length===0,contract:"fuman-daytrade-mother-pool-warmup-start-v1",tradeDate:today,readOnly:true,startsTask:false,retriesTask:false,formalPublishAllowed:false,task,failed_checks:issues,first_blocker:issues[0]||null};
console.log(JSON.stringify(result,null,2));
process.exitCode=result.ok?0:1;