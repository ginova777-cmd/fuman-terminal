"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const FORMAL_ROOT = "C:\\fuman-release-owner\\fuman-terminal";
const RUNTIME_ROOT = process.env.FUMAN_RUNTIME_ROOT || "C:\\fuman-runtime";
const TASK_NAME = "Fuman Daytrade Source Writer 0600-1330";
const issues = [];

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { issues.push(`json_unreadable:${file}:${error.code || error.message}`); return {}; }
}

function hash(file) {
  try { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
  catch (error) { issues.push(`file_unreadable:${file}:${error.code || error.message}`); return ""; }
}

function readTask() {
  const command = `$t=Get-ScheduledTask -TaskName '${TASK_NAME}' -ErrorAction Stop;$a=$t.Actions|Select-Object -First 1;[pscustomobject]@{state=[string]$t.State;execute=[string]$a.Execute;arguments=[string]$a.Arguments;workingDirectory=[string]$a.WorkingDirectory}|ConvertTo-Json -Compress`;
  const result = spawnSync("C:\\Program Files\\PowerShell\\7\\pwsh.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8", windowsHide: true, timeout: 15000 });
  if (result.status !== 0) { issues.push("writer_task_query_failed"); return {}; }
  try { return JSON.parse(String(result.stdout || "{}").trim()); }
  catch { issues.push("writer_task_query_invalid_json"); return {}; }
}

const pinFile = path.join(RUNTIME_ROOT, "config", "daytrade-source-release-root.json");
const formalWrapper = path.join(FORMAL_ROOT, "ops", "public-slot", "Run-DaytradeSourceWriter.ps1");
const runtimeWrapper = path.join(RUNTIME_ROOT, "ops", "Run-DaytradeSourceWriter.ps1");
const pin = readJson(pinFile);
const task = readTask();
const action = `${task.execute || ""} ${task.arguments || ""}`;
const formalPinnedWrapper = path.join(FORMAL_ROOT, "ops", "public-slot", "Run-DaytradeSourceWriterPinned.ps1");
const runtimePinnedWrapper = path.join(RUNTIME_ROOT, "ops", "Run-DaytradeSourceWriterPinned.ps1");
const usesPinnedWrapper = action.toLowerCase().includes(runtimePinnedWrapper.toLowerCase());
const effectiveFormalWrapper = usesPinnedWrapper ? formalPinnedWrapper : formalWrapper;
const effectiveRuntimeWrapper = usesPinnedWrapper ? runtimePinnedWrapper : runtimeWrapper;
const formalHash = hash(effectiveFormalWrapper);
const runtimeHash = hash(effectiveRuntimeWrapper);
const pinnedText = usesPinnedWrapper ? fs.readFileSync(formalPinnedWrapper, "utf8") : "";

if (String(pin.fuman_root || "").toLowerCase() !== FORMAL_ROOT.toLowerCase()) issues.push(`release_pin_root_drift:${pin.fuman_root || "missing"}`);
const pinnedAuthority = usesPinnedWrapper && pinnedText.includes(`$ApprovedRoot = "${FORMAL_ROOT}"`) && pinnedText.includes("-FumanRoot $ApprovedRoot");
if (!pinnedAuthority && String(task.workingDirectory || "").toLowerCase() !== FORMAL_ROOT.toLowerCase()) issues.push(`writer_task_working_directory_drift:${task.workingDirectory || "missing"}`);
if (!pinnedAuthority && !action.toLowerCase().includes(`-fumanroot "${FORMAL_ROOT}"`.toLowerCase())) issues.push("writer_task_fuman_root_argument_drift");
if (!usesPinnedWrapper && !action.toLowerCase().includes(runtimeWrapper.toLowerCase())) issues.push("writer_task_runtime_wrapper_mismatch");
if (!["ready", "running", "queued"].includes(String(task.state || "").toLowerCase())) issues.push(`writer_task_not_active:${task.state || "missing"}`);
if (formalHash && runtimeHash && formalHash !== runtimeHash) issues.push("formal_runtime_writer_wrapper_hash_mismatch");

const report = {
  ok: issues.length === 0,
  contract: "daytrade-writer-root-authority-v1",
  checkedAt: new Date().toISOString(),
  readOnly: true,
  formalRoot: FORMAL_ROOT,
  runtimeRoot: RUNTIME_ROOT,
  pinRoot: pin.fuman_root || null,
  task,
  effectiveAuthority: { usesPinnedWrapper, pinnedAuthority, formalWrapper: effectiveFormalWrapper, runtimeWrapper: effectiveRuntimeWrapper },
  wrapperHashes: { formal: formalHash, runtime: runtimeHash, equal: Boolean(formalHash && formalHash === runtimeHash) },
  issues,
};
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);
