"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "outputs", "terminal-autonomous-root-runner-contract");

function readText(file) {
  try {
    return fs.readFileSync(path.join(ROOT, file), "utf8");
  } catch {
    return "";
  }
}

function readJson(file, fallback = {}) {
  try {
    return JSON.parse(readText(file));
  } catch {
    return fallback;
  }
}

function addIssue(issues, issue, details = {}) {
  issues.push({ issue, details });
}

function requireMarker(issues, file, text, marker) {
  if (!text.includes(marker)) addIssue(issues, `missing_marker:${file}:${marker}`, { file, marker });
}
function queryWindowsTask(taskName) {
  if (process.platform !== "win32") {
    return {
      checked: false,
      reason: "non_windows_platform",
      installed: null,
      raw: "",
    };
  }
  const result = spawnSync("schtasks.exe", ["/Query", "/TN", `\\${taskName}`, "/V", "/FO", "LIST"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 15000,
  });
  const xmlResult = spawnSync("schtasks.exe", ["/Query", "/TN", `\\${taskName}`, "/XML"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 15000,
  });
  const raw = `${result.stdout || ""}${result.stderr || ""}`;
  const xmlRaw = `${xmlResult.stdout || ""}${xmlResult.stderr || ""}`;
  const actionText = `${raw}\n${xmlRaw}`;
  return {
    checked: true,
    installed: result.status === 0,
    exitCode: result.status,
    raw,
    xmlRaw,
    disabled: /Status:\s*Disabled/i.test(raw) || /<Enabled>\s*false\s*<\/Enabled>/i.test(xmlRaw),
    hasApplyScanners: actionText.includes("-ApplyScanners"),
    hasRequireProtectedReadback: actionText.includes("-RequireProtectedReadback"),
    hasS4U: /<LogonType>\s*S4U\s*<\/LogonType>/i.test(xmlRaw) || /Logon Mode:\s*S4U/i.test(raw),
    hasInteractiveOnly: /<LogonType>\s*InteractiveToken\s*<\/LogonType>/i.test(xmlRaw) || /Logon Mode:\s*Interactive only/i.test(raw),
    hasRunner: actionText.includes("run-terminal-master-control.ps1"),
  };
}

async function main() {
  await fs.promises.mkdir(OUT_DIR, { recursive: true });
  const issues = [];
  const runner = readText("run-terminal-autonomous-root.ps1");
  const masterRunner = readText("run-terminal-master-control.ps1");
  const installer = readText("scripts/install-terminal-autonomous-root-task.ps1");
  const pkg = readJson("package.json", { scripts: {} });
  const registry = readJson("scripts/fuman-schedule-registry.json", {});

  if (runner.includes("``r``n")) addIssue(issues, "runner_contains_literal_backtick_newline_escape", { file: "run-terminal-autonomous-root.ps1" });
  const runnerMarkers = [
    "terminal-autonomous-root-runner-v1",
    "ops:predictive-preflight",
    "verify:terminal-water-root",
    "manifest:daily-terminal-run",
    "orchestrator:state:from-existing",
    "policy:autonomous-ops",
    "rollforward:terminal",
    "verify:terminal-canary-publish:live",
    "verify:terminal-control-plane:from-existing",
    "verify:terminal-resource-chain:unattended",
    "verify:terminal-runid-closure",
    "verify:terminal-ops-production-live",
    "ops:production-unattended-readiness-report:fresh",
    "send-workflow-alert.js",
    "terminal-autonomous-root-latest.json",
    "IDLE_NO_RETRY_NEEDED",
    "toleratedExitCode",
    "Acquire-OrchestratorLock",
    "Release-OrchestratorLock",
    "terminal-daily-orchestrator.lock",
    "FUMAN_ORCHESTRATOR_LOCK_OWNER",
    "FUMAN_DAILY_RUN_ID",
  ];
  for (const marker of runnerMarkers) requireMarker(issues, "run-terminal-autonomous-root.ps1", runner, marker);
  for (const marker of [
    "fuman-master-checkpoint-runner-v1",
    "verify-api-unattended-scorecard.js",
    'strategyExecutionAllowed = $false',
    'scannerApplyAllowed = $false',
    'deploymentAllowed = $false',
    'killedProcess = $false',
    '23:10',
    '"Full"',
    '"Checkpoint"',
  ]) requireMarker(issues, "run-terminal-master-control.ps1", masterRunner, marker);
  if (!/formalScanSkipped\s+-ne\s+\$true/.test(runner) || !/scannerAction\s+-ne\s+["']skip_formal_scan["']/.test(runner)) addIssue(issues, "root_scanner_date_gate_must_block_formal_scan_skipped");

  const installerMarkers = [
    "Fuman Terminal Autonomous Root Monitor",
    "run-terminal-master-control.ps1",
    "Register-ScheduledTask",
    "06:05",
    "07:08",
    "08:00",
    "08:20",
    "08:36",
    "12:40",
    "13:15",
    "16:10",
    "17:00",
    "21:40",
    "22:00",
    "23:10",
    "New-FumanPrincipal",
    "LogonType S4U",
    "InteractiveFallback",
  ];
  for (const marker of installerMarkers) requireMarker(issues, "scripts/install-terminal-autonomous-root-task.ps1", installer, marker);

  const scripts = pkg.scripts || {};
  const invokedScripts = [...runner.matchAll(/Invoke-NpmStep\s+"[^"]+"\s+"([^"]+)"/g)].map((match) => match[1]);
  for (const name of [...new Set(invokedScripts)]) {
    if (!scripts[name]) addIssue(issues, "package_script_missing_runner_step:" + name, { name });
  }
  for (const name of ["ops:autonomous-root", "install:terminal-autonomous-root-task", "ops:autonomous-root:contract"]) {
    if (!scripts[name]) addIssue(issues, `package_script_missing:${name}`);
  }
  if (!String(scripts["ops:autonomous-root"] || "").includes("run-terminal-master-control.ps1")) {
    addIssue(issues, "package_autonomous_root_must_use_single_master_wrapper");
  }
  if (!String(scripts["verify:terminal-unattended-root"] || "").includes("ops:autonomous-root:contract")) {
    addIssue(issues, "unattended_root_missing_autonomous_root_contract");
  }

  const windowsTask = queryWindowsTask("Fuman Terminal Autonomous Root Monitor");
  const finalAuditTask = queryWindowsTask("Fuman Terminal Full Unattended Final Audit");
  const legacyConflictTask = queryWindowsTask("Fuman Terminal Autonomous Ops 5m");
  const activeTasks = registry.policy?.activeTasks || [];
  const allowed = registry.policy?.allowedResults?.["Fuman Terminal Autonomous Root Monitor"] || [];
  const taskRows = registry.tasks || [];
  if (!activeTasks.includes("Fuman Terminal Autonomous Root Monitor")) addIssue(issues, "schedule_registry_missing_autonomous_root_active_task");
  for (const code of [0, 267009, 267011]) {
    if (!allowed.includes(code)) addIssue(issues, `schedule_registry_autonomous_root_allowed_result_missing:${code}`, { allowed });
  }
  if (!taskRows.some((row) => String(row.taskName || row.displayName || "").includes("Fuman Terminal Autonomous Root Monitor"))) {
    addIssue(issues, "schedule_registry_missing_autonomous_root_task_row");
  }
  if (legacyConflictTask.checked && legacyConflictTask.installed && !legacyConflictTask.disabled) addIssue(issues, "windows_task_legacy_autonomous_ops_conflict", { raw: legacyConflictTask.raw.slice(0, 1200), xml: legacyConflictTask.xmlRaw.slice(0, 1200) });

  if (finalAuditTask.checked) {
    if (finalAuditTask.installed) addIssue(issues, "windows_task_duplicate_full_unattended_final_audit_must_be_absent", { raw: finalAuditTask.raw.slice(0, 1200), xml: finalAuditTask.xmlRaw.slice(0, 1200) });
  }
  if (windowsTask.checked) {
    if (!windowsTask.installed) addIssue(issues, "windows_task_missing_autonomous_root_monitor", { exitCode: windowsTask.exitCode, raw: windowsTask.raw.slice(0, 1200) });
    if (windowsTask.installed && windowsTask.disabled) addIssue(issues, "windows_task_disabled_autonomous_root_monitor", { raw: windowsTask.raw.slice(0, 1200) });
    if (windowsTask.installed && !windowsTask.hasRunner) addIssue(issues, "windows_task_missing_autonomous_root_runner", { raw: windowsTask.raw.slice(0, 1200) });
    if (windowsTask.installed && windowsTask.hasApplyScanners) addIssue(issues, "windows_task_must_be_read_only_no_apply_scanners", { raw: windowsTask.raw.slice(0, 1200) });
    if (windowsTask.installed && !windowsTask.hasRequireProtectedReadback) addIssue(issues, "windows_task_missing_protected_readback_flag", { raw: windowsTask.raw.slice(0, 1200) });
    if (windowsTask.installed && !windowsTask.hasS4U) addIssue(issues, "windows_task_not_s4u_unattended", { raw: windowsTask.raw.slice(0, 1200), xml: windowsTask.xmlRaw.slice(0, 1200) });
  }

  const payload = {
    ok: issues.length === 0,
    contract: "terminal-autonomous-root-runner-contract-v1",
    checkedAt: new Date().toISOString(),
    runnerExists: Boolean(runner),
    installerExists: Boolean(installer),
    packageScripts: {
      opsAutonomousRoot: scripts["ops:autonomous-root"] || "",
      controllerMode: "read_only_master_verifier_only",
      installTask: scripts["install:terminal-autonomous-root-task"] || "",
    },
    scheduleRegistry: {
      activeTask: activeTasks.includes("Fuman Terminal Autonomous Root Monitor"),
      allowedResults: allowed,
    },
    windowsTask: {
      checked: windowsTask.checked,
      installed: windowsTask.installed,
      disabled: windowsTask.disabled,
      hasRunner: windowsTask.hasRunner,
      readOnlyNoApplyScanners: windowsTask.hasApplyScanners !== true,
      hasRequireProtectedReadback: windowsTask.hasRequireProtectedReadback,
      hasS4U: windowsTask.hasS4U,
      hasInteractiveOnly: windowsTask.hasInteractiveOnly,
      exitCode: windowsTask.exitCode,
    },
    finalAuditTask: {
      checked: finalAuditTask.checked,
      installed: finalAuditTask.installed,
      requiredState: "absent_single_master_owns_2310",
      exitCode: finalAuditTask.exitCode,
    },
    legacyConflictTask: {
      checked: legacyConflictTask.checked,
      installed: legacyConflictTask.installed,
      disabled: legacyConflictTask.disabled,
      exitCode: legacyConflictTask.exitCode,
    },
    guarantees: [
      "one master-control wrapper is the only scheduled and npm controller entrypoint",
      "Windows task wakes the same read-only verifier at each due checkpoint",
      "08:00 and 08:20 are separated checkpoints; 08:36 is a lightweight delivery closure",
      "23:10 performs the full-day read-only audit through the same verifier",
      "the wrapper forbids strategy execution, scanner apply, deployment, and process killing",
    ],
    issues,
  };
  await fs.promises.writeFile(path.join(OUT_DIR, "terminal-autonomous-root-runner-contract.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(payload, null, 2));
  if (!payload.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[terminal-autonomous-root-runner-contract] failed: ${error.stack || error.message || error}`);
  process.exit(1);
});

