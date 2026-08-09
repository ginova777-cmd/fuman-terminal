"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const TRADE_DATE = String(process.env.FUMAN_TRADE_DATE || "").match(/20\d{6}/)?.[0] || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date()).replace(/-/g, "");
const DAILY_RUN_ID = String(process.env.FUMAN_DAILY_RUN_ID || "power-recovery");
const TASK_NAME = process.env.FUMAN_AUTONOMOUS_ROOT_TASK_NAME || "Fuman Terminal Autonomous Root Monitor";
const FINAL_AUDIT_TASK_NAME = process.env.FUMAN_FINAL_AUDIT_TASK_NAME || "Fuman Terminal Full Unattended Final Audit";
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const OUT_DIR = path.join(ROOT, "outputs", "terminal-power-recovery");
const OUT_FILE = path.join(OUT_DIR, "terminal-power-recovery.json");
const LOCK_FILE = path.join(RUNTIME_DIR, "state", "terminal-daily-orchestrator.lock");
const REGISTRATION_RECEIPT_FILE = path.join(RUNTIME_DIR, "state", "power-recovery-task-registration.json");

function runPowerShell(script) {
  const candidates = ["powershell.exe", "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"];
  const executable = candidates.find((candidate) => candidate === "powershell.exe" || fs.existsSync(candidate));
  if (!executable) return { ok: false, error: "powershell_not_found" };
  const result = spawnSync(executable, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], { encoding: "utf8", windowsHide: true });
  return { ok: result.status === 0, exit_code: result.status === null ? 1 : result.status, stdout: String(result.stdout || ""), stderr: String(result.stderr || "") };
}

function parseLastJson(text) {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try { return JSON.parse(lines[i]); } catch (_) { /* keep scanning */ }
  }
  return null;
}

function taskStatus(taskName = TASK_NAME) {
  const escaped = taskName.replace(/'/g, "''");
  const script = `$t=Get-ScheduledTask -TaskName '${escaped}' -ErrorAction SilentlyContinue; if($null -eq $t){ @{exists=$false} | ConvertTo-Json -Compress; exit 0 }; $i=Get-ScheduledTaskInfo -TaskName '${escaped}' -ErrorAction SilentlyContinue; $p=$t.Principal; $a=@($t.Actions)[0]; @{exists=$true;state=[string]$t.State;enabled=([string]$t.State -ne 'Disabled');lastRun=([string]$i.LastRunTime);nextRun=([string]$i.NextRunTime);lastResult=[int64]$i.LastTaskResult;logonType=[string]$p.LogonType;runLevel=[string]$p.RunLevel;startWhenAvailable=[bool]$t.Settings.StartWhenAvailable;multipleInstances=[string]$t.Settings.MultipleInstances;executionTimeLimit=[string]$t.Settings.ExecutionTimeLimit;triggerCount=@($t.Triggers).Count;execute=[string]$a.Execute;arguments=[string]$a.Arguments} | ConvertTo-Json -Compress`;
  const result = runPowerShell(script);
  return parseLastJson(result.stdout) || { exists: false, probe_error: result.stderr || "task_query_failed" };
}

function powerEvents() {
  const script = "$events=@(Get-WinEvent -FilterHashtable @{LogName='System'; Id=41,6008} -MaxEvents 20 -ErrorAction SilentlyContinue | ForEach-Object { @{id=$_.Id; time=$_.TimeCreated.ToString('o'); provider=$_.ProviderName} }); @{events=$events} | ConvertTo-Json -Compress -Depth 4";
  const result = runPowerShell(script);
  return parseLastJson(result.stdout) || { events: [], probe_error: result.stderr || "event_query_failed" };
}

function bootStatus() {
  const script = "@{boot=(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString('o'); now=(Get-Date).ToUniversalTime().ToString('o')} | ConvertTo-Json -Compress";
  const result = runPowerShell(script);
  return parseLastJson(result.stdout) || {};
}

function expectedLockHolder(pid) {
  if (process.platform !== "win32") return { expected: true, image: "", reason: "non_windows_process_probe" };
  const probe = spawnSync("tasklist.exe", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true, timeout: 5000 });
  const raw = String(probe.stdout || "") + String(probe.stderr || "");
  const row = raw.split(/\r?\n/).find((line) => line.includes(`"${pid}"`)) || "";
  const image = (row.match(/^"([^"]+)"/) || [])[1] || "";
  return { expected: /^node(\.exe)?$/i.test(image), image, reason: image ? "process_image_checked" : "pid_not_found" };
}

function lockStatus() {
  if (!fs.existsSync(LOCK_FILE)) return { exists: false, safe: true, staleLockHandled: true };
  let payload = null;
  try { payload = JSON.parse(fs.readFileSync(LOCK_FILE, "utf8")); } catch (_) { return { exists: true, safe: false, staleLockHandled: false, reason: "lock_json_invalid" }; }
  const pid = Number(payload?.pid || 0);
  let running = false;
  let holder = { expected: false, image: "", reason: "missing_pid" };
  if (pid > 0) {
    const probe = spawnSync("tasklist.exe", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true });
    running = String(probe.stdout || "").includes(`"${pid}"`);
    holder = expectedLockHolder(pid);
  }
  const safe = running && holder.expected === true;
  return { exists: true, safe, staleLockHandled: safe, pid, holder, daily_run_id: payload?.daily_run_id || "" };
}

function main() {
  const task = taskStatus();
  const finalAuditTask = taskStatus(FINAL_AUDIT_TASK_NAME);
  const legacyTask = taskStatus("Fuman Terminal Autonomous Ops 5m");
  const boot = bootStatus();
  const events = powerEvents();
  const lock = lockStatus();
  const registrationReceipt = fs.existsSync(REGISTRATION_RECEIPT_FILE) ? (() => { try { return JSON.parse(fs.readFileSync(REGISTRATION_RECEIPT_FILE, "utf8")); } catch (_) { return { ok: false, failures: ["registration_receipt_invalid"] }; } })() : null;
  const registrationReceiptAuthoritative = registrationReceipt?.ok === true;
  const registrationReceiptIgnoredReason = registrationReceipt && registrationReceipt.ok !== true ? "live_task_readback_is_authoritative_after_existing_task_verified" : "";
  const taskRegistered = task.exists === true && task.enabled === true;
  const legacyTaskConflict = legacyTask.exists === true && legacyTask.enabled === true;
  const unattendedPrincipalReady = String(task.logonType || "").toLowerCase() === "s4u" && String(task.runLevel || "").toLowerCase() === "highest";
  const startWhenAvailableReady = task.startWhenAvailable === true;
  const multipleInstancesReady = String(task.multipleInstances || "").toLowerCase() === "ignorenew";
  const rootActionReady = /run-terminal-autonomous-root\.ps1/i.test(`${task.execute || ""} ${task.arguments || ""}`);
  const rootApplyScannersReady = /\s-ApplyScanners(\s|$)/i.test(` ${task.arguments || ""} `);
  const rootProtectedReadbackReady = /\s-RequireProtectedReadback(\s|$)/i.test(` ${task.arguments || ""} `);
  const triggerCountReady = Number(task.triggerCount || 0) >= 8;
  const postBootRecoveryVerified = taskRegistered && Boolean(boot.boot) && Boolean(task.lastRun) && Date.parse(task.lastRun) >= Date.parse(boot.boot);
  const lockSafe = lock.safe === true;
  const staleLockHandled = lock.staleLockHandled === true;
  const eventRows = Array.isArray(events.events) ? events.events : (events.events ? [events.events] : []);
  const powerRecoveryOk = taskRegistered && unattendedPrincipalReady && startWhenAvailableReady && multipleInstancesReady && rootActionReady && rootApplyScannersReady && rootProtectedReadbackReady && triggerCountReady && postBootRecoveryVerified && lockSafe && staleLockHandled && !legacyTaskConflict;
  const payload = {
    contract: "terminal-power-recovery-receipt-v1",
    ok: powerRecoveryOk,
    status: powerRecoveryOk ? "PASS" : "BLOCKED",
    complete: powerRecoveryOk,
    power_checked: true,
    trade_date: TRADE_DATE,
    daily_run_id: DAILY_RUN_ID,
    task_name: TASK_NAME,
    final_audit_task_name: FINAL_AUDIT_TASK_NAME,
    registration_receipt_file: REGISTRATION_RECEIPT_FILE,
    registration_receipt: registrationReceipt,
    registrationReceiptAuthoritative,
    registrationReceiptIgnoredReason,
    taskRegistered,
    startWhenAvailableReady,
    multipleInstancesReady,
    rootActionReady,
    rootApplyScannersReady,
    rootProtectedReadbackReady,
    triggerCountReady,
    postBootRecoveryVerified,
    lockSafe,
    staleLockHandled,
    systemBootAt: boot.boot || "",
    unexpectedShutdownEvent: eventRows.length > 0,
    recoveryActions: legacyTaskConflict ? ["disable_legacy_autonomous_ops_task_then_retry"] : (postBootRecoveryVerified ? ["autonomous_root_task_presence_verified", "post_boot_root_task_run_verified"] : (taskRegistered ? (unattendedPrincipalReady ? ["run_or_wait_for_autonomous_root_monitor_after_last_boot"] : ["re_register_autonomous_root_task_with_s4u_highest"]) : ["register_autonomous_root_monitor_task"])),
    task,
    final_audit_task: finalAuditTask,
    legacy_task: legacyTask,
    legacy_task_conflict: legacyTaskConflict,
    power_events: eventRows,
    lock,
    checked_at: new Date().toISOString(),
    failures: [
      ...(taskRegistered ? [] : ["autonomous_root_monitor_task_missing_or_disabled"]),
      ...(unattendedPrincipalReady ? [] : ["autonomous_root_monitor_task_not_s4u_highest"]),
      ...(startWhenAvailableReady ? [] : ["autonomous_root_monitor_task_not_start_when_available"]),
      ...(multipleInstancesReady ? [] : ["autonomous_root_monitor_task_not_ignore_new"]),
      ...(rootActionReady ? [] : ["autonomous_root_monitor_task_action_not_root_runner"]),
      ...(rootApplyScannersReady ? [] : ["autonomous_root_monitor_task_missing_apply_scanners"]),
      ...(rootProtectedReadbackReady ? [] : ["autonomous_root_monitor_task_missing_protected_readback"]),
      ...(triggerCountReady ? [] : ["autonomous_root_monitor_task_trigger_count_low"]),
      ...(postBootRecoveryVerified ? [] : ["autonomous_root_monitor_has_not_run_after_last_boot"]),
      ...(lockSafe ? [] : ["orchestrator_lock_not_safe"]),
      ...(staleLockHandled ? [] : ["stale_or_invalid_lock_requires_owner_recovery"]),
      ...(legacyTaskConflict ? ["legacy_autonomous_ops_task_enabled"] : []),
    ],
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify(payload, null, 2));
  if (!payload.ok) process.exitCode = 1;
}

main();