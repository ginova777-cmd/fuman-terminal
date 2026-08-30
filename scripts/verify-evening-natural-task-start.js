"use strict";

const { spawnSync } = require("child_process");

const phaseArg = process.argv.find((arg) => arg.startsWith("--phase="));
const waitArg = process.argv.find((arg) => arg.startsWith("--wait-ms="));
const phase = phaseArg?.split("=")[1] || "";
const waitMs = Math.max(0, Number(waitArg?.split("=")[1] ?? 18000) || 0);
const phases = {
  chains: {
    checkpoint: "21:00",
    tasks: [
      { name: "Fuman Strategy5 Cache 2100", runner: "run-strategy5.ps1" },
      { name: "Fuman 買賣超 Cache 2100", runner: "run-institution.ps1" },
    ],
  },
  battle: {
    checkpoint: "21:10",
    tasks: [{ name: "Fuman Institution Battle Verify 2110", runner: "run-institution-battle-verify.ps1" }],
  },
};

function taipeiParts(value = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const parts = formatter.formatToParts(value);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}
function queryTasks() {
  const command = "$OutputEncoding=[Console]::OutputEncoding=[Text.UTF8Encoding]::new();$rows=foreach($t in Get-ScheduledTask){$i=Get-ScheduledTaskInfo -TaskName $t.TaskName -TaskPath $t.TaskPath -ErrorAction SilentlyContinue;[ordered]@{name=$t.TaskName;path=$t.TaskPath;state=[string]$t.State;lastResult=if($i){[long]$i.LastTaskResult}else{$null};lastRun=if($i -and $i.LastRunTime.Year -gt 2000){$i.LastRunTime.ToString('o')}else{''};action=(($t.Actions|ForEach-Object{([string]$_.Execute)+' '+([string]$_.Arguments)})-join ' | ')}};$rows|ConvertTo-Json -Compress -Depth 4";
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], { encoding: "utf8", windowsHide: true, timeout: 25000 });
  try {
    const value = JSON.parse(String(result.stdout || "[]").trim() || "[]");
    return { ok: result.status === 0, rows: Array.isArray(value) ? value : [value], error: String(result.stderr || "").trim() || result.error?.message || null };
  } catch (error) {
    return { ok: false, rows: [], error: error.message };
  }
}
function inspect(spec) {
  const query = queryTasks();
  const issues = [];
  if (!query.ok) issues.push("scheduled_task_query_failed");
  const tasks = spec.tasks.map((expected) => {
    const row = query.rows.find((item) => item.name === expected.name) || query.rows.find((item) => String(item.action || "").includes(expected.runner));
    const lastRunParts = row?.lastRun ? taipeiParts(new Date(row.lastRun)) : { date: "", time: "" };
    const today = taipeiParts();
    const ranToday = lastRunParts.date === today.date;
    const startedOnOrAfterCheckpoint = ranToday && lastRunParts.time >= spec.checkpoint;
    const actionOk = String(row?.action || "").includes(expected.runner);
    const stateOk = ["Ready", "Running"].includes(String(row?.state || ""));
    const duplicates = query.rows.filter((item) => item.state !== "Disabled" && String(item.action || "").includes(expected.runner));
    const unique = duplicates.length === 1 && duplicates[0].name === expected.name;
    const ok = Boolean(row) && stateOk && actionOk && startedOnOrAfterCheckpoint && unique;
    if (!row) issues.push(`evening_task_missing:${expected.name}`);
    else {
      if (!stateOk) issues.push(`evening_task_state_invalid:${expected.name}`);
      if (!actionOk) issues.push(`evening_task_action_mismatch:${expected.name}`);
      if (!startedOnOrAfterCheckpoint) issues.push(`evening_task_not_naturally_started_today:${expected.name}`);
      if (!unique) issues.push(`evening_task_runner_not_unique:${expected.runner}`);
    }
    return { ...expected, resolvedTaskName: row?.name || null, installed: Boolean(row), state: row?.state || null, lastRun: row?.lastRun || null, lastResult: row?.lastResult ?? null, ranToday, startedOnOrAfterCheckpoint, actionOk, stateOk, unique, duplicateNames: duplicates.map((item) => item.name), ok };
  });
  return { query, tasks, issues };
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function main() {
  const spec = phases[phase];
  if (!spec) { console.error(JSON.stringify({ ok: false, phase, issues: ["unsupported_evening_start_phase"] }, null, 2)); process.exitCode = 2; return; }
  const deadline = Date.now() + waitMs;
  let state = inspect(spec);
  while (state.issues.length && Date.now() < deadline) {
    await sleep(Math.min(3000, Math.max(1, deadline - Date.now())));
    state = inspect(spec);
  }
  const result = {
    contract: "evening-natural-task-start-verifier-v1", ok: state.issues.length === 0,
    checkedAt: new Date().toISOString(), tradeDate: taipeiParts().date, phase, checkpoint: spec.checkpoint,
    waitedUpToMs: waitMs, tasks: state.tasks, taskQueryError: state.query.error, issues: state.issues,
    actionsByVerifier: { taskStarted: false, strategyExecuted: false, scannerExecuted: false, runIdGenerated: false, dataMutated: false },
    reasonCode: state.issues[0] || "ok",
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
main().catch((error) => { console.error(JSON.stringify({ ok: false, error: error.message }, null, 2)); process.exitCode = 1; });
