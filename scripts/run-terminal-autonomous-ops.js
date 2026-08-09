const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { acquire: acquireOrchestratorLock, CONTRACT: ORCHESTRATOR_LOCK_CONTRACT } = require("../lib/terminal-orchestrator-lock");

const ROOT = process.env.FUMAN_TERMINAL_ROOT || "C:\\fuman-terminal";
const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const APPLY_SCANNERS = argv.includes("--apply-scanners");
const APPLY_SOURCE = argv.includes("--apply-source");
const PUBLISH = argv.includes("--publish");
const SELF_TEST = argv.includes("--self-test");
const EXPECTED_DATE = (argv.find((arg) => arg.startsWith("--expected-date=")) || "").slice(16).replace(/\D/g, "").slice(0, 8);
const OUT_DIR = path.resolve(ROOT, "outputs", "autonomous-ops");
const MASTER_CONTROLLER_STAGE_ORDER = [
  "market_calendar",
  "active_module_registry",
  "single_daily_orchestrator_lock",
  "predictive_preflight",
  "fugle_websocket_source",
  "full_ordinary_stock_universe",
  "intraday_1m_seed_and_websocket_increment",
  "technical_and_volume_indicators",
  "strategy_and_chip_latest_receipts",
  "mother_pool_300_600",
  "priority_top40",
  "priority_refresh_and_mother_rotation",
  "natural_0700_0845_0900_evidence",
  "water_root_and_formal_entry_gate",
  "strategy_scan_state_machine",
  "idempotent_scanners_and_module_states",
  "self_heal_job_queue_and_rewater_verification",
  "publish_transaction_guard_and_daily_manifest",
  "canary_publish",
  "runid_closure_and_display_closure",
  "freshness_watchdog_and_final_scan",
  "auto_roll_forward_control_plane_autonomous_policy_final_audit",
];


function readJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function runNpm(script, extra = [], label = script) {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(command, ["run", script, ...(extra.length ? ["--", ...extra] : [])], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env },
    shell: process.platform === "win32" && /\.cmd$/i.test(command),
    timeout: Number(process.env.FUMAN_AUTONOMOUS_STAGE_TIMEOUT_MS || 120000),
    maxBuffer: 8 * 1024 * 1024,
  });
  return {
    label,
    command: [command, "run", script, ...extra].join(" "),
    exitCode: result.status ?? 1,
    ok: result.status === 0,
    stdout: String(result.stdout || "").slice(-5000),
    stderr: `${String(result.stderr || "")} ${result.error?.message || ""}`.trim().slice(-5000),
  };
}

function runStage(stages, script, extra = [], label = script, options = {}) {
  const result = runNpm(script, extra, label);
  stages.push({ ...result, required: options.required !== false, continueOnFailure: options.continueOnFailure === true });
  return result;
}

function runSingleMasterScheduleGate() {
  const verifier = path.join(ROOT, "scripts", "verify-terminal-autonomous-schedule-contract.js");
  const result = spawnSync(process.execPath, [verifier, "--require-live"], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env },
    timeout: 30000,
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  });
  let parsed = null;
  try { parsed = JSON.parse(String(result.stdout || "").trim()); } catch { parsed = null; }
  const issues = Array.isArray(parsed?.issues) ? parsed.issues : [];
  return {
    label: "single_master_schedule_gate",
    command: process.execPath + " " + verifier + " --require-live",
    exitCode: result.status ?? 1,
    ok: result.status === 0 && parsed?.ok === true,
    required: true,
    continueOnFailure: true,
    issues,
    competingTasks: parsed?.competingTasks || [],
    stdout: String(result.stdout || "").slice(-2000),
    stderr: String(result.stderr || "").slice(-2000),
  };
}
function compactDate(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function taipeiDateKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()).replace(/\D/g, "");
}

function loadState() {
  const manifest = readJson(path.join(ROOT, "outputs", "daily-terminal-run", "daily-terminal-run-latest.json"), {});
  const waterRoot = readJson(path.join(ROOT, "outputs", "terminal-water-root", "terminal-water-root.json"), {});
  const orchestrator = readJson(path.join(ROOT, "outputs", "terminal-orchestrator", "terminal-orchestrator-state.json"), {});
  const policy = readJson(path.join(ROOT, "outputs", "autonomous-ops-policy", "autonomous-ops-policy.json"), {});
  const controlPlane = readJson(path.join(ROOT, "outputs", "terminal-control-plane", "terminal-control-plane.json"), {});
  return { manifest, waterRoot, orchestrator, policy, controlPlane };
}

function isMarketClosedState(value) {
  const row = value?.marketCalendar?.row || value?.marketCalendar || value?.row?.marketCalendar || {};
  return row.marketOpen === false && (row.marketStatus === "closed" || row.tradingDayOpen === false || value?.status === "market_closed");
}

function markMarketClosedStages(stages) {
  const controlled = new Set(["predictive_preflight","predictive_preflight_contract","active_module_registry","formal_entry_gate_contract","water_root","self_heal_source_dry_run","daily_manifest","state_machine_from_manifest","autonomous_ops_policy","control_plane_after_closure"]);
  for (const stage of stages) {
    if (controlled.has(stage.label) && stage.ok !== true) {
      stage.required = false;
      stage.controlledStop = "market_closed";
    }
  }
}
function decisionSummary(state) {
  const policyDecision = state.policy?.decision || {};
  const controlDecision = state.controlPlane?.decision || {};
  const decision = controlDecision.state
    ? { ...policyDecision, ...controlDecision }
    : policyDecision;
  const manifest = state.manifest || {};
  const closure = state.controlPlane?.closure || state.controlPlane?.runIdClosure || {};
  return {
    opsState: controlDecision.state || decision.opsState || decision.state || "UNKNOWN",
    unattendedStatus: decision.unattendedStatus || state.orchestrator?.unattendedStatus || "NO",
    waterRootOk: state.waterRoot?.ok === true || manifest.waterRoot?.ok === true,
    manifestOk: manifest.ok === true,
    formalScanAllowed: decision.formalScanAllowed === true,
    scorecardPublishAllowed: decision.scorecardPublishAllowed === true,
    runIdClosureOk: closure.ok === true,
    blocker: decision.reason || state.orchestrator?.blocker || manifest.blocker || "",
  };
}

function selfTest() {
  const issues = [];
  if (ROOT.length < 5 || !ROOT.toLowerCase().includes("fuman-terminal")) issues.push("root_not_target_repo");
  const requiredStages = ["market_calendar", "predictive_preflight", "water_root", "daily_manifest", "runid_closure"];
  if (requiredStages.length !== 5) issues.push("stage_contract_invalid");
  if (typeof runNpm !== "function" || typeof loadState !== "function") issues.push("controller_functions_missing");
  if (ORCHESTRATOR_LOCK_CONTRACT !== "terminal-orchestrator-lock-v1" || typeof acquireOrchestratorLock !== "function") issues.push("orchestrator_lock_contract_missing");

  return { ok: issues.length === 0, contract: "terminal-autonomous-ops-controller-v1", issues };
}
async function main() {
  if (SELF_TEST) {
    const result = selfTest();
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exit(1);
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const tradeDate = EXPECTED_DATE || taipeiDateKey();
  const stages = [];
  const mode = APPLY ? (APPLY_SCANNERS ? "apply_scanners" : "apply_safe_jobs") : "dry_run";
  const lock = acquireOrchestratorLock({ expectedDate: tradeDate, mode });
  if (!lock.ok) {
    const skipped = {
      contract: "terminal-autonomous-ops-controller-v1",
      checkedAt: new Date().toISOString(),
      mode,
      tradeDate,
      ok: true,
      skipped: true,
      unattendedStatus: "NO",
      stopReason: "ORCHESTRATOR_LOCK_HELD",
      lock: { contract: lock.contract, status: lock.status, lockFile: lock.lockFile, owner: lock.owner || null },
    };
    writeJson(path.join(OUT_DIR, "terminal-autonomous-ops-latest.json"), skipped);
    console.log(JSON.stringify(skipped, null, 2));
    return;
  }
  const heartbeat = setInterval(() => lock.renew(), 60 * 1000);
  heartbeat.unref?.();
  let lockReleased = false;
  function releaseActiveLock() {
    clearInterval(heartbeat);
    if (lockReleased) return;
    lockReleased = true;
    lock.release();
  }
  process.once("exit", releaseActiveLock);
  process.once("SIGINT", () => { releaseActiveLock(); process.exit(130); });
  process.once("SIGTERM", () => { releaseActiveLock(); process.exit(143); });
  let stopReason = "";

  // The single-master gate must run before any source, scanner, or publish action.
  const singleMasterGate = runSingleMasterScheduleGate();
  stages.push(singleMasterGate);
  if (!singleMasterGate.ok) stopReason = "single_master_schedule_gate_failed";
  // 1. Market calendar and predictive preflight must precede every scanner.
  runStage(stages, "ops:predictive-preflight", [], "predictive_preflight", { continueOnFailure: true });
  runStage(stages, "verify:terminal-predictive-preflight", [], "predictive_preflight_contract");
  runStage(stages, "verify:terminal-active-module-registry", [], "active_module_registry");
  const sourceBoundary = runStage(stages, "verify:daytrade-source-boundary", [], "daytrade_source_boundary");
  if (!sourceBoundary.ok) stopReason = "daytrade_source_boundary_contract_failed";
  const formalGateContract = runStage(stages, "verify:terminal-formal-entry-gate", ["--expected-date=" + tradeDate], "formal_entry_gate_contract");
  if (!formalGateContract.ok) stopReason = stopReason || "formal_entry_gate_contract_failed";

  // 2. The root water check is authoritative. A failing root blocks scanners.
  let water = runStage(stages, "verify:terminal-water-root", ["--expected-date=" + tradeDate], "water_root");
  const preflightState = readJson(path.join(ROOT, "outputs", "terminal-predictive-preflight", "terminal-predictive-preflight.json"), {});
  const waterState = readJson(path.join(ROOT, "outputs", "terminal-water-root", "terminal-water-root.json"), {});
  const marketClosedToday = tradeDate === taipeiDateKey() && (isMarketClosedState(preflightState) || isMarketClosedState(waterState));
  if (marketClosedToday) {
    stopReason = "market_closed_preserve_previous_good";
    stages.push({ label: "warmup_skipped_market_closed", command: "not-run", exitCode: 0, ok: true, required: false, reason: "market_closed" });
  } else if (!water.ok && APPLY_SOURCE) {
    runStage(stages, "daytrade-warmup:self-heal:apply", [], "self_heal_source_apply", { continueOnFailure: true });
    water = runStage(stages, "verify:terminal-water-root", ["--expected-date=" + tradeDate], "water_root_after_self_heal");
  } else if (!water.ok) {
    runStage(stages, "daytrade-warmup:self-heal", [], "self_heal_source_dry_run", { continueOnFailure: true });
  }
  if (!marketClosedToday && !water.ok && !APPLY_SOURCE) stopReason = "source_root_not_ready_apply_source_not_enabled";
  if (!marketClosedToday && !water.ok && APPLY_SOURCE && !stages.find((stage) => stage.label === "water_root_after_self_heal")?.ok) {
    stopReason = "source_root_not_ready_after_self_heal";
  }
  // 3. Rebuild the manifest and state machine from the authoritative receipts.
  runStage(stages, "manifest:daily-terminal-run", [`--expected-date=${tradeDate}`], "daily_manifest", { continueOnFailure: true });
  runStage(stages, "orchestrator:state:from-existing", [], "state_machine_from_manifest", { continueOnFailure: true });
  runStage(stages, "policy:autonomous-ops", [], "autonomous_ops_policy", { continueOnFailure: true });
  if (marketClosedToday) markMarketClosedStages(stages);

  // 4. The queue is the only recovery path. Dry-run never executes scanners.
  const rollforwardScript = APPLY_SCANNERS ? "rollforward:terminal:apply-scanners" : (APPLY ? "rollforward:terminal:apply" : "rollforward:terminal");
  const rollforwardArgs = ["--expected-date=" + tradeDate];
  if (!marketClosedToday && !stopReason && sourceBoundary.ok && formalGateContract.ok) {
    runStage(stages, rollforwardScript, rollforwardArgs, "job_queue_" + mode, { continueOnFailure: true });
  } else if (!APPLY && sourceBoundary.ok) {
    runStage(stages, "rollforward:terminal", rollforwardArgs, "job_queue_dry_run_blocked_context", { continueOnFailure: true, required: false });
  } else {
    stages.push({ label: "job_queue_skipped", command: "not-run", exitCode: 0, ok: true, required: false, reason: marketClosedToday ? "market_closed" : (sourceBoundary.ok ? stopReason : "daytrade_source_boundary_contract_failed") });
  }
  // 5. Re-read manifest/policy after any recovery action. Publish is opt-in and guarded.
  if (APPLY) {
  runStage(stages, "manifest:daily-terminal-run", [`--expected-date=${tradeDate}`], "daily_manifest_after_recovery", { continueOnFailure: true, required: !marketClosedToday });
    runStage(stages, "orchestrator:state:from-existing", [], "state_machine_after_recovery", { continueOnFailure: true, required: !marketClosedToday });
    runStage(stages, "policy:autonomous-ops", [], "autonomous_ops_policy_after_recovery", { continueOnFailure: true });
  }

  const afterRecovery = loadState();
  const summary = decisionSummary(afterRecovery);
  if (PUBLISH && !marketClosedToday && stopReason) {
    stages.push({ label: "canary_scorecard_publish", command: "blocked_by_master_controller", exitCode: 1, ok: false, required: true, reason: stopReason });
  } else if (PUBLISH && marketClosedToday) {
    stages.push({ label: "canary_scorecard_publish", command: "not-run", exitCode: 0, ok: true, required: false, reason: "market_closed_preserve_previous_good" });
  } else if (PUBLISH && summary.scorecardPublishAllowed && summary.manifestOk) {
    runStage(stages, "scorecard:publish", [], "canary_scorecard_publish", { continueOnFailure: true });
  } else if (PUBLISH) {
    stages.push({ label: "canary_scorecard_publish", command: "blocked_by_manifest_policy", exitCode: 1, ok: false, required: true, reason: summary.blocker || "manifest_not_green" });
    stopReason = stopReason || "manifest_publish_gate_not_green";
  }

  // 6. Closure readback is read-only and runs on every open-market controller pass.
  // Dry-run must still catch stale /88 rows; it never writes or publishes.
  if (!marketClosedToday) {
    runStage(stages, "verify:terminal-resource-chain:unattended", ["--expected-date=" + tradeDate], "terminal_resource_chain_closure", { continueOnFailure: true });
    runStage(stages, "verify:terminal-runid-closure", [], "runid_closure", { continueOnFailure: true });
  } else {
    stages.push({ label: "terminal_resource_chain_closure_skipped", command: "not-run", exitCode: 0, ok: true, required: false, reason: "market_closed" });
    stages.push({ label: "runid_closure_skipped", command: "not-run", exitCode: 0, ok: true, required: false, reason: "market_closed" });
  }
  if (!marketClosedToday) {
    runStage(stages, "manifest:daily-terminal-run", ["--expected-date=" + tradeDate, "--from-existing"], "daily_manifest_after_live_closure", { continueOnFailure: true });
    runStage(stages, "orchestrator:state:from-existing", [], "state_machine_after_live_closure", { continueOnFailure: true });
    runStage(stages, "policy:autonomous-ops", [], "autonomous_ops_policy_after_live_closure", { continueOnFailure: true });
  }
  // Rebuild the control plane and final audit after every recovery/closure pass.
  runStage(stages, "control:terminal", ["--require-unattended", "--from-existing"], "control_plane_after_closure", { continueOnFailure: true, required: !marketClosedToday });
  runStage(stages, "ops:status:export", [], "ops_status_after_closure", { continueOnFailure: true });
  runStage(stages, "verify:terminal-autonomous-completion-audit", [], "unattended_final_audit", { continueOnFailure: true });
  runStage(stages, "verify:daytrade-warmup-nine-day", [], "nine_day_warmup_tracking_audit", { continueOnFailure: true, required: false });
  const finalState = loadState();
  const finalSummary = decisionSummary(finalState);
  const requiredFailures = stages.filter((stage) => stage.required && stage.ok !== true);
  const businessOk = requiredFailures.length === 0 && (!PUBLISH || finalSummary.scorecardPublishAllowed);
  const executionOk = requiredFailures.length === 0
    && (marketClosedToday || !PUBLISH || finalSummary.scorecardPublishAllowed);
  const payload = {
    contract: "terminal-autonomous-ops-controller-v1",
    checkedAt: new Date().toISOString(),
    mode,
    publishRequested: PUBLISH,
    applySource: APPLY_SOURCE,
    tradeDate,
    stageOrder: MASTER_CONTROLLER_STAGE_ORDER,
    masterController: {
      contract: "terminal-master-controller-v1",
      entrypoint: "scripts/run-terminal-autonomous-ops.js",
      decisionSource: "scripts/write-terminal-control-plane.js",
      authority: "single_decision_source_fail_closed",
      lockContract: ORCHESTRATOR_LOCK_CONTRACT,
      strictUnattended: true,
      decision: {
        state: finalSummary.opsState,
        unattendedStatus: finalSummary.unattendedStatus,
        reason: finalSummary.blocker,
      },
    },
    stages,
    state: finalSummary,
    stopReason,
    requiredFailureCount: requiredFailures.length,
    unattendedStatus: finalSummary.unattendedStatus === "YES" && requiredFailures.length === 0 ? "YES" : finalSummary.unattendedStatus,
    ok: businessOk,
    executionOk,
    evidence: {
      manifestFile: path.join(ROOT, "outputs", "daily-terminal-run", "daily-terminal-run-latest.json"),
      orchestratorFile: path.join(ROOT, "outputs", "terminal-orchestrator", "terminal-orchestrator-state.json"),
      policyFile: path.join(ROOT, "outputs", "autonomous-ops-policy", "autonomous-ops-policy.json"),
      waterRootFile: path.join(ROOT, "outputs", "terminal-water-root", "terminal-water-root.json"),
    },
  };
  const out = path.join(OUT_DIR, "terminal-autonomous-ops-latest.json");
  writeJson(out, payload);
  const lines = [
    "# Terminal Autonomous Ops Controller",
    "",
    `- checkedAt: ${payload.checkedAt}`,
    `- tradeDate: ${tradeDate}`,
    `- mode: ${mode}`,
    `- ok: ${payload.ok}`,
    `- executionOk: ${payload.executionOk}`,
    `- unattendedStatus: ${payload.unattendedStatus}`,
    `- opsState: ${finalSummary.opsState}`,
    `- blocker: ${finalSummary.blocker || "--"}`,
    `- requiredFailureCount: ${requiredFailures.length}`,
    "",
    "| stage | exit | ok | required |",
    "|---|---:|---:|---:|",
    ...stages.map((stage) => `| ${stage.label} | ${stage.exitCode} | ${stage.ok} | ${stage.required !== false} |`),
  ];
  fs.writeFileSync(path.join(OUT_DIR, "terminal-autonomous-ops-latest.md"), `${lines.join("\\n")}\n`, "utf8");
  console.log(JSON.stringify({ ok: payload.ok, executionOk: payload.executionOk, mode, tradeDate, unattendedStatus: payload.unattendedStatus, opsState: finalSummary.opsState, blocker: finalSummary.blocker, output: out, requiredFailureCount: requiredFailures.length }, null, 2));
  releaseActiveLock();
  if (!payload.executionOk) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[terminal-autonomous-ops] failed: ${error.stack || error.message || error}`);
  process.exit(1);
});




