"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const OUT_DIR = path.resolve(process.argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length) || "outputs/terminal-power-recovery");
const TRADE_DATE = String(process.argv.find((arg) => arg.startsWith("--trade-date="))?.slice("--trade-date=".length) || process.env.FUMAN_TRADE_DATE || "").replace(/\D/g, "").slice(0, 8);
const TASK_NAME = process.env.FUMAN_AUTONOMOUS_ROOT_TASK || "Fuman Terminal Autonomous Root Monitor";

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function parseTaskList(text) {
  const row = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (match) row[match[1].trim().toLowerCase()] = match[2].trim();
  }
  return row;
}

function xmlValue(xml, tag) {
  const match = String(xml || "").match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? match[1].trim() : "";
}

function queryTask(name) {
  const list = spawnSync("schtasks", ["/Query", "/TN", `\\${name}`, "/V", "/FO", "LIST"], {
    encoding: "utf8",
    windowsHide: true,
  });
  const xml = spawnSync("schtasks", ["/Query", "/TN", `\\${name}`, "/XML"], {
    encoding: "utf8",
    windowsHide: true,
  });
  const stdout = String(list.stdout || "");
  const stderr = `${list.stderr || ""}${xml.stderr || ""}`;
  const row = parseTaskList(stdout);
  const xmlText = String(xml.stdout || "");
  const enabledText = xmlValue(xmlText, "Enabled");
  const startWhenAvailableText = xmlValue(xmlText, "StartWhenAvailable");
  const enabled = enabledText ? enabledText.toLowerCase() !== "false" : !String(stdout).toLowerCase().includes("disabled");
  return {
    name,
    ok: list.status === 0 || xml.status === 0,
    exitCode: list.status === 0 || xml.status === 0 ? 0 : (list.status === null ? 1 : list.status),
    state: enabled ? "Enabled" : "Disabled",
    enabled,
    startWhenAvailable: startWhenAvailableText ? startWhenAvailableText.toLowerCase() === "true" : null,
    lastRunTime: row["last run time"] || "",
    lastResult: row["last result"] || "",
    nextRunTime: row["next run time"] || "",
    taskToRun: row["task to run"] || "",
    stdoutTail: stdout.slice(-1200),
    stderrTail: String(stderr).slice(-1200),
  };
}

function dateMs(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : null;
}

function fileMtime(file) {
  try {
    return fs.statSync(file).mtime.toISOString();
  } catch {
    return "";
  }
}

function main() {
  const checkedAt = new Date();
  const bootTime = new Date(Date.now() - Math.round(os.uptime() * 1000));
  const lockFile = path.join(RUNTIME_DIR, "state", "terminal-daily-orchestrator.lock");
  const finalAuditFile = path.join(RUNTIME_DIR, "state", "unattended-final-audit.json");
  const lock = readJson(lockFile, null);
  const task = queryTask(TASK_NAME);
  const issues = [];
  const warnings = [];
  const bootMs = bootTime.getTime();
  const lockAcquiredMs = dateMs(lock?.acquired_at);
  const auditMtime = fileMtime(finalAuditFile);
  const auditMtimeMs = dateMs(auditMtime);

  if (!task.ok) issues.push("autonomous_root_task_not_queryable");
  if (task.ok && task.enabled === false) issues.push("autonomous_root_task_not_enabled");
  if (task.ok && task.startWhenAvailable === false) warnings.push("autonomous_root_task_start_when_available_false");
  if (lock && lockAcquiredMs && lockAcquiredMs < bootMs) issues.push("orchestrator_lock_before_last_boot");
  if (!auditMtime) warnings.push("runtime_final_audit_receipt_missing");
  if (auditMtimeMs && auditMtimeMs < bootMs) warnings.push("runtime_final_audit_before_last_boot");

  const payload = {
    contract: "terminal-power-recovery-check-v1",
    checked_at: checkedAt.toISOString(),
    trade_date: TRADE_DATE,
    host: os.hostname(),
    runtime_dir: RUNTIME_DIR,
    boot: {
      boot_time: bootTime.toISOString(),
      uptime_seconds: Math.round(os.uptime()),
      checked_after_boot_seconds: Math.max(0, Math.round((checkedAt.getTime() - bootMs) / 1000)),
    },
    task,
    orchestrator_lock: {
      file: lockFile,
      exists: Boolean(lock),
      acquired_at: lock?.acquired_at || "",
      before_last_boot: Boolean(lock && lockAcquiredMs && lockAcquiredMs < bootMs),
    },
    runtime_final_audit: {
      file: finalAuditFile,
      exists: Boolean(auditMtime),
      updated_at: auditMtime,
      after_last_boot: Boolean(auditMtimeMs && auditMtimeMs >= bootMs),
    },
    status: issues.length ? "blocked" : "ready",
    ok: issues.length === 0,
    issues,
    warnings,
    reason: issues[0] || "power_recovery_ready",
    allowed_action: issues.length
      ? "end_stale_orchestrator_lock_and_rerun_terminal_autonomous_root"
      : "none",
  };

  const jsonFile = path.join(OUT_DIR, "terminal-power-recovery.json");
  writeJson(jsonFile, payload);
  console.log(JSON.stringify({ ok: payload.ok, status: payload.status, reason: payload.reason, bootTime: payload.boot.boot_time, taskState: task.state, lastResult: task.lastResult, output: jsonFile }, null, 2));
  if (!payload.ok) process.exitCode = 1;
}

main();

