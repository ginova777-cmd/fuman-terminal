"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "outputs", "backend-service-token-schedule-contract");
const PACKAGE_FILE = path.join(ROOT, "package.json");

const REQUIRED_ACTIVE_TASKS = [
  "Fuman Scorecard Daily Automation 1400",
  "Fuman Strategy4 Cache 1600",
  "Fuman Strategy5 Cache 2100",
  "Fuman API Unattended Scorecard",
  "Fuman Public Slot Shared Source Watchdog",
  "Fuman Terminal Autonomous Root Monitor",
];

const SERVICE_KEY_MARKERS = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "FUMAN_SUPABASE_SERVICE_ROLE_KEY",
  "FUMAN_TERMINAL_SUPABASE_SERVICE_ROLE_KEY",
];

function readText(file) {
  try {
    return fs.readFileSync(path.join(ROOT, file), "utf8");
  } catch {
    return "";
  }
}

function readJson(file, fallback = {}) {
  try {
    const target = path.isAbsolute(file) ? file : path.join(ROOT, file);
    return JSON.parse(fs.readFileSync(target, "utf8"));
  } catch {
    return fallback;
  }
}

function hasAny(text, markers) {
  return markers.some((marker) => text.includes(marker));
}

function addIssue(issues, issue, details = {}) {
  issues.push({ issue, details });
}

function requireText(issues, file, text, marker, issue) {
  if (!text.includes(marker)) addIssue(issues, issue || `missing_marker:${file}:${marker}`, { file, marker });
}

function verifyScannerServiceKeys(issues) {
  const files = [
    "scripts/scan-strategy3-cache.js",
    "scripts/scan-strategy4-cache.js",
    "scripts/scan-strategy5-cache.js",
    "scripts/scan-institution-cache.js",
    "scripts/generate-cb-detect.js",
    "scripts/scan-warrant-flow-cache.js",
    "scripts/publish-strategy2-complete-run.js",
  ];
  const rows = [];
  for (const file of files) {
    const text = readText(file);
    const ok = hasAny(text, SERVICE_KEY_MARKERS) && /Authorization:\s*`Bearer\s+\$\{[^}]+\}`|Authorization:\s*["']Bearer/.test(text);
    if (!text) addIssue(issues, `scanner_file_missing:${file}`, { file });
    if (text && !hasAny(text, SERVICE_KEY_MARKERS)) addIssue(issues, `scanner_missing_service_role_key:${file}`, { file });
    if (text && !ok) addIssue(issues, `scanner_missing_service_authorization_header:${file}`, { file });
    rows.push({ file, ok });
  }
  return rows;
}

function verifyScheduleRegistry(issues) {
  const registry = readJson(path.join(ROOT, "scripts", "fuman-schedule-registry.json"), {});
  const activeTasks = registry.policy?.activeTasks || [];
  const allowedResults = registry.policy?.allowedResults || {};
  for (const task of REQUIRED_ACTIVE_TASKS) {
    if (!activeTasks.includes(task)) addIssue(issues, `schedule_active_task_missing:${task}`, { task });
  }
  for (const task of ["Fuman Scorecard Daily Automation 1400", "Fuman Public Slot Shared Source Watchdog", "Fuman Terminal Autonomous Root Monitor"]) {
    const allowed = allowedResults[task] || [];
    if (!allowed.includes(0)) addIssue(issues, `schedule_allowed_result_missing_zero:${task}`, { task, allowed });
    if (!allowed.includes(267009)) addIssue(issues, `schedule_allowed_result_missing_running_267009:${task}`, { task, allowed });
  }
  return {
    activeTaskCount: activeTasks.length,
    requiredActiveTasks: REQUIRED_ACTIVE_TASKS,
  };
}

function verifyScorecardRunner(issues) {
  const wrapper = readText("run-scorecard-daily-automation-wrapper.ps1");
  const runner = readText("run-scorecard-daily-automation.ps1");
  requireText(issues, "run-scorecard-daily-automation-wrapper.ps1", wrapper, "FUMAN_SCORECARD_RUNNING_TASK", "scorecard_wrapper_missing_running_task_marker");
  requireText(issues, "run-scorecard-daily-automation-wrapper.ps1", wrapper, "supabase-incident-guard.js", "scorecard_wrapper_missing_supabase_incident_guard");
  requireText(issues, "run-scorecard-daily-automation.ps1", runner, "FUMAN_TEST_MEMBER_ACCESS_TOKEN", "scorecard_runner_missing_member_token_split");
  requireText(issues, "run-scorecard-daily-automation.ps1", runner, "$EffectiveNoLiveVerify", "scorecard_runner_missing_no_live_verify_mode");
  requireText(issues, "run-scorecard-daily-automation.ps1", runner, "--no-live", "scorecard_runner_missing_no_live_flag");
  requireText(issues, "run-scorecard-daily-automation.ps1", runner, "guard-daily-manifest-before-scorecard-publish.js", "scorecard_runner_missing_manifest_publish_guard");
  return {
    wrapperHasRunningTaskMarker: wrapper.includes("FUMAN_SCORECARD_RUNNING_TASK"),
    noLiveVerifyWhenNoMemberToken: runner.includes("$EffectiveNoLiveVerify"),
  };
}

function verifyStrategyWrappers(issues) {
  const strategy4 = readText("run-strategy4.ps1");
  const strategy5 = readText("run-strategy5.ps1");

  requireText(issues, "run-strategy4.ps1", strategy4, "scorecard sync non-blocking failure", "strategy4_scorecard_sync_must_be_non_blocking");
  requireText(issues, "run-strategy4.ps1", strategy4, "daily manifest will queue scorecard publish repair", "strategy4_missing_manifest_repair_queue_marker");

  requireText(issues, "run-strategy5.ps1", strategy5, "legacy-entrypoint-guard.ps1", "strategy5_missing_legacy_entrypoint_guard");
  requireText(issues, "run-strategy5.ps1", strategy5, "Invoke-Strategy5InlineTerminalVerify", "strategy5_missing_inline_terminal_verify");
  requireText(issues, "run-strategy5.ps1", strategy5, "verify:strategy5-88-data-chain", "strategy5_missing_88_data_chain_verify");
  requireText(issues, "run-strategy5.ps1", strategy5, "source gate blocked new publish; preserving latest complete run", "strategy5_missing_source_gate_preserve_previous_good");

  if (/https:\/\/fuman-terminal\.vercel\.app\/api\/scorecard\?live=1/.test(strategy5)) {
    addIssue(issues, "strategy5_contains_direct_unauth_scorecard_live_readback", {
      file: "run-strategy5.ps1",
      remediation: "use internal/sourceReports verifier or member token aware display readback; unauth 401 must not fail scanner compute",
    });
  }

  return {
    strategy4ScorecardSyncNonBlocking: strategy4.includes("scorecard sync non-blocking failure"),
    strategy5HasInlineTerminalVerify: strategy5.includes("Invoke-Strategy5InlineTerminalVerify"),
  };
}

function verifyMembershipLayering(issues) {
  const entitlement = readText("lib/server-entitlement-guard.js");
  const helper = readText("scripts/e2e-membership-closure-utils.js");
  const resourceChain = readText("scripts/verify-terminal-resource-chain.js");
  const opsLive = readText("scripts/verify-terminal-ops-production-live.js");
  const rollForward = readText("scripts/run-terminal-auto-roll-forward.js");
  const orchestrator = readText("scripts/write-terminal-orchestrator-state.js");

  requireText(issues, "lib/server-entitlement-guard.js", entitlement, "fumanInternalVerify === true", "entitlement_guard_missing_internal_verify_bypass");
  requireText(issues, "scripts/e2e-membership-closure-utils.js", helper, "callInternalApi", "membership_helper_missing_internal_call");
  requireText(issues, "scripts/e2e-membership-closure-utils.js", helper, "fumanInternalVerify: true", "membership_helper_missing_internal_verify");
  requireText(issues, "scripts/verify-terminal-resource-chain.js", resourceChain, "protectedReadbackAuth", "resource_chain_missing_protected_readback_split");
  requireText(issues, "scripts/verify-terminal-resource-chain.js", resourceChain, "membershipProtectedSummary", "resource_chain_missing_membership_protected_summary");
  requireText(issues, "scripts/verify-terminal-ops-production-live.js", opsLive, "direct_protected_endpoint_not_membership_required", "ops_live_missing_membership_required_assertion");
  requireText(issues, "scripts/run-terminal-auto-roll-forward.js", rollForward, "Auth failures are never auto-executed", "rollforward_missing_auth_manual_repair_rule");
  requireText(issues, "scripts/write-terminal-orchestrator-state.js", orchestrator, "BLOCKED_AUTH", "orchestrator_missing_blocked_auth_state");
  requireText(issues, "scripts/write-terminal-orchestrator-state.js", orchestrator, "verify service token env", "orchestrator_missing_service_token_repair_action");

  return {
    internalVerifyBypass: entitlement.includes("fumanInternalVerify === true"),
    resourceChainMemberReadbackSplit: resourceChain.includes("protectedReadbackAuth"),
    blockedAuthManualRepair: rollForward.includes("Auth failures are never auto-executed"),
  };
}

function verifyAutonomousRootRunner(issues) {
  const runner = readText("run-terminal-autonomous-root.ps1");
  const installer = readText("scripts/install-terminal-autonomous-root-task.ps1");
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
    "IDLE_NO_RETRY_NEEDED",
  ];
  for (const marker of runnerMarkers) {
    requireText(issues, "run-terminal-autonomous-root.ps1", runner, marker, `autonomous_root_runner_missing_marker:${marker}`);
  }
  const installerMarkers = ["Fuman Terminal Autonomous Root Monitor", "Register-ScheduledTask", "08:55", "22:00", "-ApplyScanners"];
  for (const marker of installerMarkers) {
    requireText(issues, "scripts/install-terminal-autonomous-root-task.ps1", installer, marker, `autonomous_root_installer_missing_marker:${marker}`);
  }
  return {
    runnerExists: Boolean(runner),
    installerExists: Boolean(installer),
    hasApplyScanners: runner.includes("rollforward:terminal:apply-scanners"),
    hasFailureAlert: runner.includes("send-workflow-alert.js"),
    installerRegistersTask: installer.includes("Register-ScheduledTask"),
  };
}

function verifyPackageWiring(issues) {
  const pkg = readJson(PACKAGE_FILE, { scripts: {} });
  const scripts = pkg.scripts || {};
  if (!String(scripts["verify:backend-auth-isolation"] || "").includes("verify-backend-auth-isolation.js")) {
    addIssue(issues, "package_missing_verify_backend_auth_isolation");
  }
  if (!String(scripts["verify:backend-service-token-schedule"] || "").includes("verify-backend-service-token-schedule-contract.js")) {
    addIssue(issues, "package_missing_verify_backend_service_token_schedule");
  }
  const root = String(scripts["verify:terminal-unattended-root"] || "");
  if (!String(scripts["ops:autonomous-root"] || "").includes("run-terminal-autonomous-root.ps1")) addIssue(issues, "package_missing_ops_autonomous_root");
  if (!String(scripts["ops:autonomous-root:apply-scanners"] || "").includes("-ApplyScanners")) addIssue(issues, "package_missing_ops_autonomous_root_apply_scanners");
  if (!String(scripts["install:terminal-autonomous-root-task"] || "").includes("install-terminal-autonomous-root-task.ps1")) addIssue(issues, "package_missing_install_terminal_autonomous_root_task");
  for (const required of ["verify:backend-auth-isolation", "verify:backend-service-token-schedule", "verify:terminal-runid-closure"]) {
    if (!root.includes(required)) addIssue(issues, `terminal_unattended_root_missing:${required}`, { root });
  }
  return {
    hasBackendAuthIsolation: Boolean(scripts["verify:backend-auth-isolation"]),
    hasBackendServiceTokenSchedule: Boolean(scripts["verify:backend-service-token-schedule"]),
    rootIncludesBackendServiceTokenSchedule: root.includes("verify:backend-service-token-schedule"),
    hasAutonomousRootRunner: Boolean(scripts["ops:autonomous-root"]),
  };
}

async function main() {
  await fs.promises.mkdir(OUT_DIR, { recursive: true });
  const issues = [];
  const payload = {
    ok: false,
    contract: "backend-service-token-schedule-contract-v1",
    checkedAt: new Date().toISOString(),
    scheduleRegistry: verifyScheduleRegistry(issues),
    scannerServiceKeys: verifyScannerServiceKeys(issues),
    scorecardRunner: verifyScorecardRunner(issues),
    strategyWrappers: verifyStrategyWrappers(issues),
    membershipLayering: verifyMembershipLayering(issues),
    autonomousRootRunner: verifyAutonomousRootRunner(issues),
    packageWiring: verifyPackageWiring(issues),
    guarantees: [
      "backend scanner/publisher uses service role or internal verified API, not member browser session",
      "membership_required 401 protects display only and is not scanner compute failure",
      "scorecard publish is daily-manifest gated and can run without member live readback",
      "BLOCKED_AUTH jobs require service token repair and are never auto-executed as fake success",
      "schedule running result 0x41301 is classified separately from failed scanner output",
      "autonomous root monitor runs deterministic root steps once, then readback-only closure after due windows",
    ],
    issues,
  };
  payload.ok = issues.length === 0;
  await fs.promises.writeFile(path.join(OUT_DIR, "backend-service-token-schedule-contract.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(payload, null, 2));
  if (!payload.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[backend-service-token-schedule-contract] failed: ${error.stack || error.message || error}`);
  process.exit(1);
});
