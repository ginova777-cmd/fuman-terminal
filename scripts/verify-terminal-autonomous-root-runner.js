"use strict";

const fs = require("fs");
const path = require("path");

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

async function main() {
  await fs.promises.mkdir(OUT_DIR, { recursive: true });
  const issues = [];
  const runner = readText("run-terminal-autonomous-root.ps1");
  const installer = readText("scripts/install-terminal-autonomous-root-task.ps1");
  const pkg = readJson("package.json", { scripts: {} });
  const registry = readJson("scripts/fuman-schedule-registry.json", {});

  const runnerMarkers = [
    "terminal-autonomous-root-runner-v1",
    "ops:predictive-preflight",
    "verify:terminal-water-root",
    "manifest:daily-terminal-run",
    "orchestrator:state:from-existing",
    "policy:autonomous-ops",
    "rollforward:terminal:apply",
    "rollforward:terminal:apply-scanners",
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
  ];
  for (const marker of runnerMarkers) requireMarker(issues, "run-terminal-autonomous-root.ps1", runner, marker);

  const installerMarkers = [
    "Fuman Terminal Autonomous Root Monitor",
    "Register-ScheduledTask",
    "08:55",
    "09:10",
    "09:40",
    "13:35",
    "14:10",
    "16:10",
    "21:35",
    "22:00",
    "-ApplyScanners",
  ];
  for (const marker of installerMarkers) requireMarker(issues, "scripts/install-terminal-autonomous-root-task.ps1", installer, marker);

  const scripts = pkg.scripts || {};
  for (const name of ["ops:autonomous-root", "ops:autonomous-root:apply-scanners", "install:terminal-autonomous-root-task", "ops:autonomous-root:contract"]) {
    if (!scripts[name]) addIssue(issues, `package_script_missing:${name}`);
  }
  if (!String(scripts["verify:terminal-unattended-root"] || "").includes("ops:autonomous-root:contract")) {
    addIssue(issues, "unattended_root_missing_autonomous_root_contract");
  }

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

  const payload = {
    ok: issues.length === 0,
    contract: "terminal-autonomous-root-runner-contract-v1",
    checkedAt: new Date().toISOString(),
    runnerExists: Boolean(runner),
    installerExists: Boolean(installer),
    packageScripts: {
      opsAutonomousRoot: scripts["ops:autonomous-root"] || "",
      opsAutonomousRootApplyScanners: scripts["ops:autonomous-root:apply-scanners"] || "",
      installTask: scripts["install:terminal-autonomous-root-task"] || "",
    },
    scheduleRegistry: {
      activeTask: activeTasks.includes("Fuman Terminal Autonomous Root Monitor"),
      allowedResults: allowed,
    },
    guarantees: [
      "autonomous root is callable as a first-class npm script",
      "Windows task wakes the full root chain after strategy due windows",
      "runner executes preflight, water root, daily manifest, state machine, policy, job queue roll-forward, and readback-only closure",
      "failure writes a receipt and attempts workflow alert",
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

