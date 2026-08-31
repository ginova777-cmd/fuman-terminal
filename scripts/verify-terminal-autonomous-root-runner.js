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
  const strategy3ClosureVerifier = readText("scripts/verify-strategy3-v2-full-closure.js");
  const strategy3Scanner = readText("scripts/run-strategy3-v2-complete-scan.js");
  const mobileFragmentPublisher = readText("scripts/publish-mobile-fragment-snapshots.js");
  const strategy4Scanner = readText("scripts/scan-strategy4-cache.js");
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
  const masterCheckpointMarkers = [
    "$checkpointContracts", "$checkpointContract", "$checkpointVerifierChecks",
    "$checkpointVerifierFailure", "checkpoint_specific_verifier_blocked",
    "strategyExecutionAllowed = $false", "scannerApplyAllowed = $false",
    "sourceRecoveryCheckpoints", "Start-ScheduledTask", "limitedSelfHealActions",
    "recheckedAfterSelfHeal", "dueCheckpointIds", "recoveryPolicy",
    "deploymentAllowed = $false", "killedProcess = $false",
    "PASS", "SELF_HEALED_PASS", "FAIL_CLOSED", "BLOCKED",
    "Get-FumanTaskStartGuard", "scheduled_task_not_unique",
    "original_task_already_ran_today_no_second_writer_run", "writer_self_heal_refused",
    "canonicalEvidence", "tradeDate = $canonicalEvidence.tradeDate",
    "runId = $canonicalEvidence.runId", "keyCounts = [ordered]@{",
    "surfaceConsistency = $canonicalEvidence.surfaceConsistency", "canonicalEvidenceSource",
    "master_controller_already_running", 'status = "BLOCKED"',
    "check-strategy2-trading-day.js", "quiet_non_trading_day_skip", "market_calendar_unavailable_fail_closed",
    "$processedCheckpointIds = @()", "$earliestUnprocessedDue",
    "$dailyCheckpointCoverageFailure", "daily_checkpoint_receipts_missing", "dailyCheckpointCoverage",
    "function Send-FumanMasterAlert", 'Send-FumanMasterAlert -Status "BLOCKED"', "market_calendar_unavailable_fail_closed", "master_controller_exception",
    "$daytradeWriterVerifierInCheckpoint", "$writerCheckpointCheck",
    'owner="EXTERNAL_OWNER"', 'disposition="SKIPPED_BY_THIS_CONTROLLER"', 'disposition="READ_ONLY_BRIDGE"',
    '"20:05" = @{ name="chip_source_sync"', 'start_missed_original_chip_source_sync_once', 'today_or_immutable_receipt_exists',
    '"21:15" = @{ name="institution_watchdog"', 'verify-institution-watchdog-2115.js',
  ];
  for (const marker of masterCheckpointMarkers) {
    requireMarker(issues, "run-terminal-master-control.ps1", masterRunner, marker);
  }
  const checkpointIds = ["06:00","06:05","07:00","07:08","08:00","08:20","08:29","08:30","08:35","08:36","08:45","09:00","12:30","12:40","12:50","12:55","13:00","13:15","13:30","15:35","16:00","17:00","17:10","17:40","18:10","18:40","19:10","20:05","21:00","21:10","21:15","21:40","22:00","23:10"];
  for (const checkpointId of checkpointIds) {
    requireMarker(issues, "run-terminal-master-control.ps1", masterRunner, `"${checkpointId}" = @{`);
  }
  const masterVerifierFiles = [...new Set([...masterRunner.matchAll(/verify-[A-Za-z0-9-]+\.js/g)].map((match) => match[0]))];
  for (const verifierFile of masterVerifierFiles) {
    if (!fs.existsSync(path.join(ROOT, "scripts", verifierFile))) addIssue(issues, `master_checkpoint_verifier_file_missing:${verifierFile}`);
  }
  const countMarker = (text, marker) => text.split(marker).length - 1;
  if (countMarker(masterRunner, "$processedCheckpointIds = @()") !== 1) addIssue(issues, "master_checkpoint_ledger_must_be_declared_once");
  if (countMarker(masterRunner, "function Send-FumanMasterAlert") !== 1) addIssue(issues, "master_alert_function_must_be_declared_once");
  if ((masterRunner.match(/^param\(/gm) || []).length !== 1) addIssue(issues, "master_runner_top_param_must_be_declared_once");
  for (const marker of [
    'if ($apiScorecardRequired)',
    'verify-cleanup-stage-receipt.js',
    '--stage=$(if ($checkpointId',
    'verify-strategy4-prewarm-receipt.js',
    'verify-cleanup-natural-completion.js',
    'verify-evening-natural-task-start.js',
  ]) requireMarker(issues, "run-terminal-master-control.ps1", masterRunner, marker);
  if (!masterRunner.includes('$verifierExit = $null')) addIssue(issues, "api_scorecard_must_default_to_not_run_outside_fixed_slots");
  if (/repair_nonformal_cache_or_telegram_outbox|redeliver_single_missing_surface_with_original_run_id_and_hash/.test(masterRunner)) addIssue(issues, "master_recovery_policy_claims_unimplemented_actions");
  if (/Stop-ScheduledTask|schtasks\s+\/End|Stop-Process|taskkill/i.test(masterRunner)) addIssue(issues, "master_checkpoint_contract_contains_forbidden_stop_or_kill_action");
  if (/run-strategy|scan-strategy|deploy-production/.test(masterRunner)) addIssue(issues, "master_checkpoint_contract_contains_forbidden_strategy_or_deploy_entrypoint");
  const nonTradingBranch = masterRunner.match(/if \(\$nonTradingDay\) \{([\s\S]*?)\n\s*\}/)?.[1] || "";
  if (!/quiet_non_trading_day_skip/.test(nonTradingBranch) || !/exit 0/.test(nonTradingBranch)) addIssue(issues, "non_trading_day_must_quietly_exit");
  if (/Set-Content|Copy-Item|Send-FumanMasterAlert|Start-ScheduledTask/.test(nonTradingBranch)) addIssue(issues, "non_trading_day_must_not_write_alert_or_start_task");
  if (/runNode\(\s*["']scan["']/.test(strategy3ClosureVerifier)) {
    addIssue(issues, "strategy3_closure_verifier_must_not_execute_scanner");
  }
  if (/runNode\(\s*["']line/.test(strategy3ClosureVerifier)) {
    addIssue(issues, "strategy3_closure_verifier_must_not_generate_line_card");
  }
  for (const marker of ["strategy3-v2-complete-scan-diagnostic-", "generated_run_id_noncanonical", "apply ? scanReceiptPath(compactDate) : diagnosticReceiptPath"]) {
    requireMarker(issues, "scripts/run-strategy3-v2-complete-scan.js", strategy3Scanner, marker);
  }
  for (const marker of ['arg.startsWith("--tabs=")', "for (const tab of tabs)", "requestedTabs: tabs"]) {
    requireMarker(issues, "scripts/publish-mobile-fragment-snapshots.js", mobileFragmentPublisher, marker);
  }
  if (/for \(const tab of TABS\)/.test(mobileFragmentPublisher)) addIssue(issues, "mobile_fragment_publisher_ignores_requested_tab_scope");
  for (const marker of ['enforcement: "diagnostic-only"', 'reason: "strategy4-full-scan-must-not-drop-symbols-by-avg5"', "const REQUIRE_QUOTE_LIQUIDITY_PREFILTER = false", "filtered: []"]) {
    requireMarker(issues, "scripts/scan-strategy4-cache.js", strategy4Scanner, marker);
  }
  if (/STRATEGY4_REQUIRE_QUOTE_LIQUIDITY_PREFILTER\s*===\s*["']1["']/.test(strategy4Scanner)) addIssue(issues, "strategy4_formal_scanner_must_not_enable_quote_liquidity_prefilter");
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
    "17:00",
    "21:40",
    "22:00",
    "23:10",
    "New-FumanPrincipal",
    "LogonType S4U",
    "InteractiveFallback",
  ];
  for (const marker of installerMarkers) requireMarker(issues, "scripts/install-terminal-autonomous-root-task.ps1", installer, marker);
  const checkpointContract = ["06:00","06:05","07:00","07:08","08:00","08:20","08:29","08:30","08:35","08:36","08:45","09:00","12:30","12:40","12:50","12:55","13:00","13:15","13:30","15:35","16:00","17:00","17:10","17:40","18:10","18:40","19:10","20:05","21:00","21:10","21:15","21:40","22:00","23:10"];
  for (const checkpoint of checkpointContract) {
    requireMarker(issues, "scripts/install-terminal-autonomous-root-task.ps1", installer, `"${checkpoint}"`);
  }

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

  const ledgerFixture = JSON.parse(readText("scripts/fixtures/root-controller-ledger-stale-trade-date.json"));
  const fixtureProcessed = ledgerFixture.controllerRunDate === "2026-08-31" ? [ledgerFixture.checkpointId] : [];
  const fixtureDue = ["12:30", "12:40"];
  const fixtureNext = fixtureDue.find((checkpoint) => !fixtureProcessed.includes(checkpoint));
  const ledgerDateIsolationOk = fixtureNext === ledgerFixture.expectedNextCheckpointAt1240
    && masterRunner.includes("$priorControllerRunDate")
    && masterRunner.includes("$prior.controllerRunDate")
    && masterRunner.includes("controllerRunDate = $controllerRunDate")
    && !masterRunner.includes("$priorDate = if ($prior.tradeDate)");
  if (!ledgerDateIsolationOk) addIssue(issues, "controller_ledger_must_ignore_strategy_trade_date", { fixtureNext });

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
    ledgerDateIsolation: { ok: ledgerDateIsolationOk, fixture: ledgerFixture, computedNextCheckpoint: fixtureNext },
    guarantees: [
      "one master-control wrapper is the only scheduled and npm controller entrypoint",
      "Windows task wakes the same read-only verifier at each due checkpoint",
      "08:00-08:36 are external-owner checkpoints; only 08:35 validates the frozen bridge read-only",
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
