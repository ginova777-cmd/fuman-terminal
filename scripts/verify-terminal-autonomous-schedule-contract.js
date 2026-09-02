"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const installerFile = path.join(ROOT, "scripts", "install-terminal-autonomous-root-task.ps1");
const registryFile = path.join(ROOT, "scripts", "fuman-schedule-registry.json");
const taskName = "Fuman Terminal Autonomous Root Monitor";
const legacyTaskName = "Fuman Terminal Autonomous Ops 5m";
const REQUIRE_LIVE = process.argv.includes("--require-live");
const issues = [];
const expectedCheckpoints = ["06:00","06:05","07:00","07:08","08:00","08:20","08:29","08:30","08:35","08:36","08:45","09:00","12:30","12:40","12:50","12:55","13:00","13:15","13:30","15:35","16:00","17:00","17:10","17:40","18:10","18:40","19:10","20:05","21:00","21:10","21:15","21:40","22:00","23:10"];

function read(file) {
  try { return fs.readFileSync(file, "utf8"); } catch { return ""; }
}

const controllerFile = path.join(ROOT, "run-terminal-autonomous-root.ps1");
const controller = read(controllerFile);
if (!controller) issues.push("autonomous_controller_missing");
for (const marker of [
  "terminal-autonomous-root-runner-v1",
  "Acquire-OrchestratorLock",
  "final-audit:terminal",
  "RequireProtectedReadback",
]) {
  if (!controller.includes(marker)) issues.push("controller_missing:" + marker);
}
const installer = read(installerFile);
if (!installer) issues.push("autonomous_schedule_installer_missing");
for (const marker of [
  "run-terminal-master-control.ps1",
  "Fuman Terminal Autonomous Root Monitor",
  "06:05",
  "07:08",
  "08:00",
  "08:20",
  "08:36",
  "12:40",
  "13:15",
  "17:00",
  "21:40",
  "22:00",
  "23:10",
  "MultipleInstances Queue",
  "StartWhenAvailable",
  "-WakeToRun",
  "LogonType S4U",
  "Register-ScheduledTask",
  "-Weekly",
  "Monday,Tuesday,Wednesday,Thursday,Friday",
]) {
  if (!installer.includes(marker)) issues.push(`installer_missing:${marker}`);
}

let registry = null;
try { registry = JSON.parse(read(registryFile)); } catch { issues.push("schedule_registry_invalid_json"); }
const activeTasks = new Set(registry?.policy?.activeTasks || []);
const task = (registry?.tasks || []).find((row) => row?.displayName === taskName || row?.taskName === `\\${taskName}`);
if (!activeTasks.has(taskName)) issues.push("schedule_registry_missing_active_task");
if (!task) issues.push("schedule_registry_missing_task_definition");
if (task && task.expectedState && task.expectedState !== "Ready") issues.push("schedule_registry_task_not_ready");

function readLiveTask() {
  const command = `$task=Get-ScheduledTask -TaskName '${taskName}' -ErrorAction SilentlyContinue; if(-not $task){[pscustomobject]@{exists=$false}|ConvertTo-Json -Compress; exit 0}; $action=$task.Actions|Select-Object -First 1; $info=Get-ScheduledTaskInfo -TaskName '${taskName}' -ErrorAction SilentlyContinue; $state=switch([int]$task.State){0{'Unknown'}1{'Disabled'}2{'Queued'}3{'Ready'}4{'Running'}default{[string]$task.State}}; $triggers=@($task.Triggers|ForEach-Object {[pscustomobject]@{start=[string]$_.StartBoundary;repetitionInterval=[string]$_.Repetition.Interval;repetitionDuration=[string]$_.Repetition.Duration;daysOfWeek=[string]$_.DaysOfWeek;weeksInterval=[string]$_.WeeksInterval}}); [pscustomobject]@{exists=$true;state=$state;execute=[string]$action.Execute;arguments=[string]$action.Arguments;multipleInstances=[string]$task.Settings.MultipleInstances;startWhenAvailable=[bool]$task.Settings.StartWhenAvailable;wakeToRun=[bool]$task.Settings.WakeToRun;lastTaskResult=[long]$info.LastTaskResult;triggers=$triggers}|ConvertTo-Json -Depth 5 -Compress`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command], {
    encoding: "utf8",
    timeout: 10000,
    windowsHide: true,
  });
  try {
    return JSON.parse(String(result.stdout || "").trim());
  } catch {
    return { exists: false, error: String(result.stderr || result.error?.message || "live_task_query_failed").trim() };
  }
}

const live = REQUIRE_LIVE ? readLiveTask() : { required: false, attempted: false };
if (REQUIRE_LIVE) {
  if (live.exists !== true) issues.push("live_task_missing");
  if (live.exists === true && !["Ready", "Running"].includes(String(live.state || ""))) issues.push(`live_task_state_invalid:${live.state || "missing"}`);
  if (live.exists === true && !/run-terminal-master-control\.ps1/i.test(String(live.arguments || ""))) issues.push("live_task_runner_mismatch");
  if (live.exists === true && /-ApplyScanners/i.test(String(live.arguments || ""))) issues.push("live_task_must_be_read_only_no_apply_scanners");
  if (live.exists === true && !/-RequireProtectedReadback/i.test(String(live.arguments || ""))) issues.push("live_task_protected_readback_argument_missing");
  if (live.exists === true && String(live.multipleInstances || "") !== "Queue") issues.push(`live_task_multiple_instances_not_queue:${live.multipleInstances || "missing"}`);
  if (live.exists === true && live.startWhenAvailable !== true) issues.push("live_task_start_when_available_false");
  if (live.exists === true && live.wakeToRun !== true) issues.push("live_task_wake_to_run_false");
  if (live.exists === true) {
    const triggers = Array.isArray(live.triggers) ? live.triggers : [];
    const liveTimes = new Set(triggers.map((row) => String(row.start || "").match(/T(\d{2}:\d{2})/)?.[1]).filter(Boolean));
    const missingCheckpoints = expectedCheckpoints.filter((time) => !liveTimes.has(time));
    const unexpectedCheckpoints = [...liveTimes].filter((time) => !expectedCheckpoints.includes(time));
    if (missingCheckpoints.length > 0) issues.push(`live_task_expected_root_checkpoints_missing:${missingCheckpoints.join(",")}`);
    if (unexpectedCheckpoints.length > 0) issues.push(`live_task_unexpected_root_checkpoints_present:${unexpectedCheckpoints.join(",")}`);
    const expectedWeekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
    for (const row of triggers) {
      const days = String(row.daysOfWeek || "");
      const missingDays = expectedWeekdays.filter((day) => !days.includes(day));
      const windowsWeekdayMask = Number(days) === 62;
      const namedWeekdaysOnly = missingDays.length === 0 && !/Saturday|Sunday/i.test(days);
      if (!windowsWeekdayMask && !namedWeekdaysOnly) issues.push(`live_task_trigger_not_weekdays_only:${String(row.start || "missing")}:${days || "missing"}`);
    }
  }
}

function readCompetingTasks() {
  const command = "$items=Get-ScheduledTask | Where-Object { $_.TaskName -ne 'Fuman Terminal Autonomous Root Monitor' -and ($_.TaskName -eq 'Fuman Terminal Autonomous Ops 5m' -or $_.TaskName -match 'Autonomous Root|terminal-autonomous-root') -and [string]$_.State -in @('Ready','Running','Queued') } | ForEach-Object { $a=$_.Actions|Select-Object -First 1; [pscustomobject]@{taskName=[string]$_.TaskName;state=[string]$_.State;execute=[string]$a.Execute;arguments=[string]$a.Arguments} }; @($items) | ConvertTo-Json -Depth 5 -Compress";
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command], { encoding: "utf8", timeout: 10000, windowsHide: true });
  try {
    const parsed = JSON.parse(String(result.stdout || "").trim());
    return Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
  } catch {
    return [];
  }
}

const competingTasks = readCompetingTasks();
if (competingTasks.length > 0) issues.push("competing_autonomous_root_task_active");
const result = {
  ok: issues.length === 0,
  contract: "terminal-autonomous-schedule-contract-v1",
  taskName,
  legacyTaskName,
  installer: installerFile,
  registry: registryFile,
  competingTasks,
  issues,
};
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
