"use strict";

const { execFileSync } = require("child_process");

const TASK_NAME = process.env.FUMAN_AUTONOMOUS_TASK_NAME || "\\Fuman Terminal Autonomous Root Monitor";
const EXPECTED_ROOT = String(process.env.FUMAN_AUTONOMOUS_PROJECT_ROOT || "").trim().toLowerCase();

function query(args) {
  try {
    return { ok: true, text: execFileSync("schtasks.exe", args, { encoding: "utf8" }) };
  } catch (error) {
    return { ok: false, text: String(error.stdout || error.message || "") };
  }
}

function field(text, name) {
  const line = String(text || "").split(/\r?\n/).find((item) => item.trimStart().toLowerCase().startsWith(`${name.toLowerCase()}:`));
  return line ? line.slice(line.indexOf(":") + 1).trim() : "";
}

function hasEnabledState(value) {
  return /^(ready|running|enabled|已啟用|執行中)$/i.test(String(value || "").trim());
}

function main() {
  const checkedAt = new Date().toISOString();
  const list = query(["/Query", "/TN", TASK_NAME, "/V", "/FO", "LIST"]);
  const xml = query(["/Query", "/TN", TASK_NAME, "/XML"]);
  const taskToRun = field(list.text, "Task To Run");
  const startIn = field(list.text, "Start In");
  const status = field(list.text, "Status");
  const scheduledTaskState = field(list.text, "Scheduled Task State");
  const nextRun = field(list.text, "Next Run Time");
  const lastResult = field(list.text, "Last Result");
  const logonMode = field(list.text, "Logon Mode");
  const issues = [];
  if (!list.ok || !taskToRun) issues.push("task_missing_or_unreadable");
  if (!hasEnabledState(status) && !hasEnabledState(scheduledTaskState)) issues.push("task_disabled");
  if (!nextRun || ["n/a", "na", "n\\\\a"].includes(String(nextRun).trim().toLowerCase())) issues.push("next_run_missing");
  if (lastResult && !/^0(?:x0+)?$/i.test(lastResult)) issues.push(`last_result_nonzero:${lastResult}`);
  if (!/run-terminal-autonomous-root\.ps1/i.test(taskToRun)) issues.push("task_runner_not_autonomous_root");
  if (EXPECTED_ROOT && !taskToRun.toLowerCase().includes(EXPECTED_ROOT.replace(/[\\/]+$/, ""))) issues.push("task_project_root_mismatch");
  if (!xml.ok || !/<BootTrigger[ >]/i.test(xml.text)) issues.push("startup_trigger_missing");
  if (/interactive only/i.test(logonMode)) issues.push("interactive_only_task");
  const report = {
    contract: "terminal-autonomous-task-live-v1",
    checkedAt,
    taskName: TASK_NAME,
    task: { status, scheduledTaskState, nextRun, lastResult, logonMode, taskToRun, startIn, startupTrigger: /<BootTrigger[ >]/i.test(xml.text) },
    rule: "The autonomous root must be enabled, scheduled, successful, boot-recoverable, and independent of an interactive desktop session.",
    ok: issues.length === 0,
    issues,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

main();
