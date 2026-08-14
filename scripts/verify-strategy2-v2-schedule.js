"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const ACTIVE_TASK = "Fuman Strategy2 V2 Unattended";
const EXPECTED_START = "08:45";
const LEGACY_TASKS = [
  { name: "Fuman Strategy2 Live V2", requireDisabled: true },
  { name: "Fuman Strategy2 Intraday Scan", requireDisabled: true },
  { name: "Fuman Strategy2 LINE Start 0900", noOpScript: "run-strategy2-line.ps1" },
  { name: "Fuman Strategy2 LINE Stop 1330", noOpScript: "stop-strategy2-line.ps1" },
  { name: "Fuman Strategy2 Supabase Coverage 0800", requireDisabled: true },
  { name: "Fuman Strategy2 E2E Closure Readback", requireDisabled: true },
];

function runTaskQuery(name, xml) {
  const args = ["/Query", "/TN", "\\" + name];
  if (xml) args.push("/XML");
  else args.push("/FO", "LIST", "/V");
  const result = spawnSync("schtasks.exe", args, { encoding: "utf8" });
  return { ok: result.status === 0, exitCode: result.status, stdout: String(result.stdout || ""), stderr: String(result.stderr || "") };
}

function listField(text, label) {
  const prefix = label + ":";
  for (const line of String(text || "").replace(/\r/g, "").split("\n")) {
    if (line.trimStart().startsWith(prefix)) return line.trimStart().slice(prefix.length).trim();
  }
  return "";
}

function taskState(name) {
  const xml = runTaskQuery(name, true);
  const list = runTaskQuery(name, false);
  const text = xml.stdout + "\n" + list.stdout;
  return {
    exists: xml.ok || list.ok,
    disabled: /<Enabled>false<\/Enabled>/i.test(text) || /Status:\s+Disabled/i.test(text),
    xml: xml.stdout,
    list: list.stdout,
    lastRunTime: listField(list.stdout, "Last Run Time"),
    lastResult: listField(list.stdout, "Last Result"),
    detail: (xml.stderr || list.stderr || "").trim(),
  };
}

function legacyNoOp(scriptName) {
  const file = path.join(ROOT, scriptName);
  if (!fs.existsSync(file)) return false;
  const text = fs.readFileSync(file, "utf8");
  const executable = text.split(/\r?\n/).filter((line) => !line.trim().startsWith("#")).join("\n");
  return text.includes("strategy2-v2-retired-legacy-task.log")
    && /\bexit\s+0\b/i.test(executable)
    && !/Invoke-WebRequest|Invoke-RestMethod|supabase|strategy2\.json|send-strategy-line/i.test(executable.replace(/strategy2-v2-retired-legacy-task\.log/g, ""));
}

const active = taskState(ACTIVE_TASK);
const activeActionOk = active.exists && /powershell(?:\.exe)?/i.test(active.xml) && /run-strategy2-live-v2\.ps1/i.test(active.xml) && !active.disabled;
const expectedTrigger = /<StartBoundary>[^<]*T08:45:00(?:[+.-][^<]*)?<\/StartBoundary>/i.test(active.xml);
const interactiveOnly = /<LogonType>InteractiveToken<\/LogonType>/i.test(active.xml);
const batteryBlocked = /<DisallowStartIfOnBatteries>true<\/DisallowStartIfOnBatteries>/i.test(active.xml);
const taskLaunchObserved = Boolean(active.lastRunTime) && !/1999[\/.-]11[\/.-]30/.test(active.lastRunTime) && String(active.lastResult).trim() === "0";

const legacy = LEGACY_TASKS.map((entry) => {
  const state = taskState(entry.name);
  const guardedNoOp = entry.noOpScript ? legacyNoOp(entry.noOpScript) : false;
  const isolated = !state.exists || state.disabled || guardedNoOp;
  return { task: entry.name, exists: state.exists, disabled: state.disabled, guardedNoOp, isolated, detail: state.detail || undefined };
});

const dataPathIsolated = activeActionOk && legacy.every((entry) => entry.isolated);
const scheduleWiringReady = dataPathIsolated && expectedTrigger && !interactiveOnly && !batteryBlocked && taskLaunchObserved;
const issues = [];
if (!activeActionOk) issues.push("strategy2_v2_authoritative_task_missing_or_wrong_action");
if (!expectedTrigger) issues.push("strategy2_v2_trigger_not_0845");
if (!taskLaunchObserved) issues.push("strategy2_v2_task_has_no_successful_launch_evidence");
for (const entry of legacy) if (!entry.isolated) issues.push("legacy_task_can_still_write:" + entry.task);
if (interactiveOnly) issues.push("windows_task_interactive_token_only");
if (batteryBlocked) issues.push("windows_task_disallow_start_on_battery");

const report = {
  ok: scheduleWiringReady,
  status: scheduleWiringReady ? "READY_FOR_UNATTENDED" : dataPathIsolated ? "DATA_PATH_ISOLATED_BUT_SCHEDULE_START_EVIDENCE_MISSING" : "STRATEGY2_V2_ISOLATION_FAILED",
  checkedAt: new Date().toISOString(),
  authoritativeTask: ACTIVE_TASK,
  expectedStart: EXPECTED_START,
  activeActionOk,
  expectedTrigger,
  dataPathIsolated,
  unattendedReady: scheduleWiringReady,
  taskLaunchEvidence: {
    observed: taskLaunchObserved,
    lastRunTime: active.lastRunTime || null,
    lastResult: active.lastResult || null,
    scope: "scheduler-start-only; formal data closure is verified separately",
  },
  windows: { interactiveOnly, batteryBlocked },
  legacy,
  issues,
};
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
