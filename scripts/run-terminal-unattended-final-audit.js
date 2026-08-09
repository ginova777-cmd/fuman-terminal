"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  STAGES,
  acquireOrchestratorLock,
  compactDate,
  createDailyRunId,
  resolveDailyRunId,
  defaultAuditRoot,
  defaultRuntimeDir,
  parseLastJson,
  readJson,
  reasonCodeFor,
  releaseOrchestratorLock,
  writeJson,
  writeStageReceipt,
} = require("../lib/terminal-final-audit-contract");

const ROOT = path.resolve(__dirname, "..");
const RUNNER_PATH = path.resolve(__filename);

const LEGACY_ORCHESTRATOR_TASK = "Fuman Terminal Autonomous Ops 5m";

function queryLegacyOrchestratorTask() {
  if (process.platform !== "win32") return { checked: false, task_name: LEGACY_ORCHESTRATOR_TASK, installed: null, disabled: null };
  const taskPath = `\\\\${LEGACY_ORCHESTRATOR_TASK}`;
  const list = spawnSync("schtasks.exe", ["/Query", "/TN", taskPath, "/V", "/FO", "LIST"], { encoding: "utf8", windowsHide: true, timeout: 15000 });
  const xml = spawnSync("schtasks.exe", ["/Query", "/TN", taskPath, "/XML"], { encoding: "utf8", windowsHide: true, timeout: 15000 });
  const raw = String(list.stdout || "") + String(list.stderr || "");
  const xmlRaw = String(xml.stdout || "") + String(xml.stderr || "");
  return {
    checked: true,
    task_name: LEGACY_ORCHESTRATOR_TASK,
    installed: list.status === 0,
    disabled: /Status:\s*Disabled/i.test(raw) || /<Enabled>\s*false\s*<\/Enabled>/i.test(xmlRaw),
    logon_type: (xmlRaw.match(/<LogonType>\s*([^<]+)\s*<\/LogonType>/i) || [])[1] || "",
    command: (xmlRaw.match(/<Command>\s*([^<]+)\s*<\/Command>/i) || [])[1] || "",
  };
}

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const value = process.argv.find((item) => item === name || item.startsWith(prefix));
  return value === name ? "1" : (value ? value.slice(prefix.length) : fallback);
}

function runNode(args, env = {}, cwd = ROOT) {
  const started = new Date().toISOString();
  const result = spawnSync(process.execPath, args, { cwd, encoding: "utf8", env: { ...process.env, ...env }, windowsHide: true });
  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  return { started_at: started, finished_at: new Date().toISOString(), exit_code: result.status === null ? 1 : result.status, stdout, stderr, parsed: parseLastJson(stdout) || parseLastJson(stderr), command: `node ${args.join(" ")}` };
}
function refreshRecoveryQueueVerifier({ tradeDate, dailyRunId }) {
  const output = path.join(ROOT, "outputs", "terminal-orchestrator", "terminal-recovery-queue-verifier.json");
  const args = [
    "scripts/verify-terminal-recovery-queue.js",
    `--expected-date=${tradeDate}`,
    `--daily-run-id=${dailyRunId}`,
    `--output=${output}`,
  ];
  const run = runNode(args, { FUMAN_TRADE_DATE: tradeDate, FUMAN_DAILY_RUN_ID: dailyRunId });
  const payload = readJson(output, run.parsed || null);
  return { output, run, payload };
}

function artifactFile(runDir, stage) { return path.join(runDir, "artifacts", `${stage}.json`); }
function saveArtifact(file, payload) { writeJson(file, payload || { ok: false, reason: "no_json_evidence" }); }
function writeRuntimeRecoveryQueue(runtimeDir, queue = {}) {
  if (process.env.FUMAN_FINAL_AUDIT_WRITE_RUNTIME === "0") return;
  const raw = queue && typeof queue === "object" && Object.keys(queue).length
    ? queue
    : {
      contract: "terminal-recovery-queue-v1",
      generated_at: new Date().toISOString(),
      entries: [],
      first_blocker: "recovery_queue_missing",
      reason_code: "recovery_queue_missing",
      allowed_action: "rerun_final_audit_to_rebuild_recovery_queue",
      ok: false,
      unattended_status: "NO",
    };
  const dailyRunId = String(raw.daily_run_id || raw.dailyRunId || "");
  const tradeDate = compactDate(raw.trade_date || raw.tradeDate || "");
  const payload = {
    ...raw,
    daily_run_id: dailyRunId,
    dailyRunId,
    trade_date: tradeDate,
    tradeDate,
    rewater_verification_required: raw.rewater_verification_required === true || raw.self_heal_plan?.rewater_verification_required === true,
  };
  writeJson(path.join(runtimeDir, "state", "terminal-recovery-queue.json"), payload);
}

function writeReceipt({ auditRoot, tradeDate, dailyRunId, stage, status, result, artifact, parsed, reasonCode, allowedAction }) {
  return writeStageReceipt({ auditRoot, tradeDate, dailyRunId, stage, status, exitCode: result?.exit_code ?? 1, command: result?.command || "", artifact, parsed, stdout: result?.stdout || "", stderr: result?.stderr || "", reasonCode, allowedAction });
}

function skippedReceipt({ auditRoot, tradeDate, dailyRunId, stage }) {
  const parsed = { ok: true, status: "SKIPPED", reason: "market_closed_previous_good" };
  return writeStageReceipt({ auditRoot, tradeDate, dailyRunId, stage, status: "SKIPPED", exitCode: 0, command: "market_calendar_policy", parsed, reasonCode: "market_closed_previous_good", allowedAction: "preserve_previous_good_without_latest_writes" });
}

function blockedReceipt({ auditRoot, tradeDate, dailyRunId, stage, reasonCode = "upstream_gate_not_verified" }) {
  const parsed = { ok: false, status: "BLOCKED", reason: reasonCode };
  return writeStageReceipt({ auditRoot, tradeDate, dailyRunId, stage, status: "BLOCKED", exitCode: 1, command: "upstream_gate_blocked", parsed, reasonCode });
}

function formalGateNotDueReason(waterFull = {}, liveGate = {}) {
  const payload = waterFull?.source_status?.payload || waterFull?.sourceStatus?.payload || {};
  const phase = String(liveGate.phase || liveGate.currentPhase || payload.phase || payload.current_phase || "").toLowerCase();
  const reason = String(liveGate.reason || payload.reason || waterFull?.reason || "").toLowerCase();
  const text = `${phase} ${reason}`;
  if (/preopen_prepare|before_formal|before_daytrade|wait_source_window|outside_formal_source_window|trading_day_before_formal_source_window/.test(text)) {
    return "formal_gate_not_due";
  }
  return "";
}
function runCoreStages({ auditRoot, tradeDate, dailyRunId, runtimeDir, runDir }) {
  const receipts = [];
  const registryRun = runNode(["scripts/write-terminal-active-module-registry.js", `--trade-date=${tradeDate}`, `--daily-run-id=${dailyRunId}`, `--out=${auditRoot}`, `--runtime-dir=${runtimeDir}`], { FUMAN_DAILY_RUN_ID: dailyRunId, FUMAN_TRADE_DATE: tradeDate });
  const registryFile = path.join(auditRoot, tradeDate, dailyRunId, "active-module-registry.json");
  const registry = readJson(registryFile, null);
  const registryOk = registryRun.exit_code === 0 && registry && registry.ok === true && registry.daily_run_id === dailyRunId && registry.trade_date === tradeDate;
  const market = runNode(["--use-system-ca", "scripts/check-market-calendar-action.js", `--date=${tradeDate}`, "--label=terminal-final-audit"], { FUMAN_MARKET_CALENDAR_DATE: tradeDate, FUMAN_DAILY_RUN_ID: dailyRunId });
  const marketArtifact = artifactFile(runDir, "market_calendar");
  saveArtifact(marketArtifact, market.parsed || { ok: false, reason: "market_calendar_no_json_evidence" });
  const marketClosedPreservePreviousGood = market.parsed?.ok === true
    && market.parsed?.marketOpen === false
    && (market.parsed?.preservePreviousGood === true || market.parsed?.formalScanSkipped === true)
    && String(market.parsed?.action || market.parsed?.scannerAction || "").includes("skip_formal_scan");
  const marketStatus = (market.exit_code === 0 && market.parsed?.ok === true) || marketClosedPreservePreviousGood ? "PASS" : "BLOCKED";
  const marketReasonCode = marketClosedPreservePreviousGood ? "market_closed_previous_good" : (marketStatus === "PASS" ? "ok" : reasonCodeFor("market_calendar", market.parsed, `${market.stdout}\n${market.stderr}`));
  const marketAllowedAction = marketClosedPreservePreviousGood ? "preserve_previous_good_without_latest_writes" : undefined;
  receipts.push(writeReceipt({ auditRoot, tradeDate, dailyRunId, stage: "market_calendar", status: marketStatus, result: market, artifact: marketArtifact, parsed: market.parsed, reasonCode: marketReasonCode, allowedAction: marketAllowedAction }));
  const powerRecovery = runNode(["--use-system-ca", "scripts/verify-terminal-power-recovery.js"], { FUMAN_TRADE_DATE: tradeDate, FUMAN_DAILY_RUN_ID: dailyRunId });
  const powerRecoveryArtifact = artifactFile(runDir, "power_recovery");
  saveArtifact(powerRecoveryArtifact, powerRecovery.parsed || { ok: false, stdout: powerRecovery.stdout, stderr: powerRecovery.stderr });
  const powerRecoveryStatus = powerRecovery.exit_code === 0 && powerRecovery.parsed?.ok === true ? "PASS" : "BLOCKED";
  receipts.push(writeReceipt({ auditRoot, tradeDate, dailyRunId, stage: "power_recovery", status: powerRecoveryStatus, result: powerRecovery, artifact: powerRecoveryArtifact, parsed: powerRecovery.parsed, reasonCode: powerRecoveryStatus === "PASS" ? "ok" : reasonCodeFor("power_recovery", powerRecovery.parsed, `${powerRecovery.stdout}\n${powerRecovery.stderr}`) }));
  if (marketStatus === "PASS" && market.parsed?.marketOpen === false) {
    for (const stage of ["preflight", "websocket", "water_root", "formal_gate"]) receipts.push(skippedReceipt({ auditRoot, tradeDate, dailyRunId, stage }));
  } else if (marketStatus !== "PASS") {
    for (const stage of ["preflight", "websocket", "water_root", "formal_gate"]) receipts.push(blockedReceipt({ auditRoot, tradeDate, dailyRunId, stage, reasonCode: "market_calendar_not_verified" }));
  } else {
    const preflightWrite = runNode(["--use-system-ca", "scripts/write-terminal-predictive-preflight.js", `--expected-date=${tradeDate}`, "--out=outputs/terminal-predictive-preflight"], { FUMAN_TRADE_DATE: tradeDate, FUMAN_DAILY_RUN_ID: dailyRunId });
    const preflightVerify = runNode(["--use-system-ca", "scripts/verify-terminal-predictive-preflight.js"], { FUMAN_TRADE_DATE: tradeDate, FUMAN_DAILY_RUN_ID: dailyRunId });
    const preflightArtifact = artifactFile(runDir, "preflight");
    saveArtifact(preflightArtifact, { writer: preflightWrite, verifier: preflightVerify });
    const preflightStatus = preflightWrite.exit_code === 0 && preflightVerify.exit_code === 0 && preflightVerify.parsed?.ok === true ? "PASS" : "BLOCKED";
    receipts.push(writeReceipt({ auditRoot, tradeDate, dailyRunId, stage: "preflight", status: preflightStatus, result: preflightVerify, artifact: preflightArtifact, parsed: { writer: preflightWrite, verifier: preflightVerify }, reasonCode: preflightStatus === "PASS" ? "ok" : reasonCodeFor("preflight", preflightVerify.parsed, `${preflightWrite.stdout}\n${preflightVerify.stdout}\n${preflightVerify.stderr}`) }));
    const websocket = runNode(["--use-system-ca", "scripts/verify-fugle-websocket-sources.js"], { FUMAN_TRADE_DATE: tradeDate, FUMAN_DAILY_RUN_ID: dailyRunId });
    const websocketArtifact = artifactFile(runDir, "websocket");
    saveArtifact(websocketArtifact, websocket.parsed || { ok: false, stdout: websocket.stdout, stderr: websocket.stderr });
    const websocketStatus = websocket.exit_code === 0 && websocket.parsed?.ok === true ? "PASS" : "BLOCKED";
    receipts.push(writeReceipt({ auditRoot, tradeDate, dailyRunId, stage: "websocket", status: websocketStatus, result: websocket, artifact: websocketArtifact, parsed: websocket.parsed, reasonCode: websocketStatus === "PASS" ? "ok" : reasonCodeFor("websocket", websocket.parsed, `${websocket.stdout}\n${websocket.stderr}`) }));
    const waterOut = path.join(runDir, "water-root");
    const water = runNode(["--use-system-ca", "scripts/verify-terminal-water-root.js", `--expected-date=${tradeDate}`, `--out=${waterOut}`], { FUMAN_TRADE_DATE: tradeDate, FUMAN_DAILY_RUN_ID: dailyRunId });
    const waterFull = readJson(path.join(waterOut, "terminal-water-root.json"), water.parsed);
    const waterArtifact = artifactFile(runDir, "water_root");
    saveArtifact(waterArtifact, waterFull);
    const waterStatus = water.exit_code === 0 && waterFull?.ok === true ? "PASS" : "BLOCKED";
    receipts.push(writeReceipt({ auditRoot, tradeDate, dailyRunId, stage: "water_root", status: waterStatus, result: water, artifact: waterArtifact, parsed: waterFull, reasonCode: waterStatus === "PASS" ? "ok" : reasonCodeFor("water_root", waterFull, `${water.stdout}\n${water.stderr}`) }));
    const formal = runNode(["scripts/verify-strategy-scan-formal-gate.js"], { FUMAN_TRADE_DATE: tradeDate, FUMAN_DAILY_RUN_ID: dailyRunId });
    const liveGate = waterFull?.canonicalGate?.summary || {};
    const liveFormalReady = waterFull?.marketClosedPreviousGood === true || (waterFull?.ok === true && (liveGate.formalEntryAllowed === true || liveGate.formal_entry_allowed === true || ["ready", "a"].includes(String(liveGate.canonicalGateStatus || liveGate.canonicalGateGrade || "").toLowerCase())));
    const formalNotDueReason = liveFormalReady ? "" : formalGateNotDueReason(waterFull, liveGate);
    const formalEvidence = { static_verifier: formal.parsed, live_water_root_gate: { ready: liveFormalReady, not_due_reason: formalNotDueReason, summary: liveGate } };
    const formalArtifact = artifactFile(runDir, "formal_gate");
    saveArtifact(formalArtifact, formalEvidence);
    const formalStaticOk = formal.exit_code === 0 && formal.parsed?.ok === true;
    const formalStatus = formalStaticOk && liveFormalReady ? "PASS" : (formalStaticOk && formalNotDueReason ? "NOT_DUE" : "BLOCKED");
    const formalReason = formalStatus === "PASS" ? "ok" : (formalStatus === "NOT_DUE" ? formalNotDueReason : (formal.exit_code !== 0 || formal.parsed?.ok !== true ? reasonCodeFor("formal_gate", formal.parsed, `${formal.stdout}\n${formal.stderr}`) : "formal_gate_live_status_not_ready"));
    const formalAllowedAction = formalStatus === "NOT_DUE" ? "wait_until_formal_entry_window" : undefined;
    receipts.push(writeReceipt({ auditRoot, tradeDate, dailyRunId, stage: "formal_gate", status: formalStatus, result: formal, artifact: formalArtifact, parsed: formalEvidence, reasonCode: formalReason, allowedAction: formalAllowedAction }));
  }
  return { receipts, registryRun, registry, registryFile, registryOk };
}

function buildRequirementAudit({ requirements, registry, registryOperationalOk, coreReceipts, collection, manifest, lockRelease, baseGateOk, requirementsOk }) {
  const core = new Map((coreReceipts || []).map((row) => [row.payload.stage, row.payload]));
  const modules = new Map((collection?.receipts || []).map((row) => [row.key, row]));
  const notConnected = new Set(registry?.not_connected_yet || []);
  const deferred = new Set(registry?.deferred_not_yet_wired || []);
  const statusFor = (ref) => {
    if (deferred.has(ref)) return { ref, status: "DEFERRED", reason_code: "module_outside_current_convergence_scope", allowed_action: "wire_downstream_receipt_adapter_in_next_scope_then_reverify" };
    if (ref === "active-module-registry.json") return { ref, status: registryOperationalOk ? "PASS" : "NOT_CONNECTED", reason_code: registryOperationalOk ? "ok" : "active_module_registry_module_not_connected", allowed_action: registryOperationalOk ? "none" : "connect_required_module_receipt_adapter_then_retry" };
    if (ref === "orchestrator_lock") return { ref, status: lockRelease.ok ? "PASS" : "BLOCKED", reason_code: lockRelease.ok ? "ok" : (lockRelease.reasonCode || "orchestrator_lock_release_failed"), allowed_action: lockRelease.ok ? "none" : "repair_orchestrator_lock_then_retry" };
    if (ref === "terminal-daily-manifest.json") return { ref, status: manifest?.ok === true ? "PASS" : "BLOCKED", reason_code: manifest?.reason_code || (manifest?.ok === true ? "ok" : "daily_manifest_not_ready"), allowed_action: manifest?.allowed_action || "produce_current_daily_manifest_before_claiming_completion" };
    if (ref === "recovery_queue") return { ref, status: collection?.recovery_queue?.ok === true ? "PASS" : "BLOCKED", reason_code: collection?.recovery_queue?.reason_code || "recovery_queue_not_healthy", allowed_action: collection?.recovery_queue?.allowed_action || "process_recovery_queue_without_bypassing_failed_gate" };
    if (ref === "terminal-unattended-final-audit.json") return { ref, status: baseGateOk && requirementsOk ? "PASS" : "BLOCKED", reason_code: baseGateOk && requirementsOk ? "ok" : "final_audit_not_yes", allowed_action: baseGateOk && requirementsOk ? "none" : "inspect_first_blocker_then_retry_only_allowed_action" };
    if (core.has(ref)) { const row = core.get(ref); return { ref, status: row.status || "MISSING", reason_code: row.reason_code || "stage_receipt_missing", allowed_action: row.allowed_action || "produce_required_stage_receipt_before_claiming_completion" }; }
    if (notConnected.has(ref)) return { ref, status: "NOT_CONNECTED", reason_code: "module_not_yet_wired", allowed_action: "connect_required_module_receipt_adapter_then_retry" };
    if (deferred.has(ref)) return { ref, status: "DEFERRED", reason_code: "module_outside_current_convergence_scope", allowed_action: "wire_downstream_receipt_adapter_in_next_scope_then_reverify" };
    const row = modules.get(ref);
    return row ? { ref, status: row.status || "MISSING", reason_code: row.reason_code || "module_receipt_missing", allowed_action: row.allowed_action || "produce_required_module_receipt_before_claiming_completion" } : { ref, status: "MISSING", reason_code: "module_receipt_missing", allowed_action: "produce_required_module_receipt_before_claiming_completion" };
  };
  return (requirements || []).map((requirement) => {
    const evidence = String(requirement.receipt || "").split(",").map((ref) => ref.trim()).filter(Boolean).map(statusFor);
    const statuses = evidence.map((row) => row.status);
    const status = statuses.includes("BLOCKED") ? "BLOCKED" : (statuses.includes("MISSING") ? "MISSING" : (statuses.includes("NOT_CONNECTED") ? "NOT_CONNECTED" : (statuses.includes("NOT_DUE") ? "NOT_DUE" : (statuses.includes("DEFERRED") ? "DEFERRED" : "PASS"))));
    const first = evidence.find((row) => !["PASS", "SKIPPED"].includes(row.status)) || evidence[0] || { reason_code: "requirements_receipt_missing", allowed_action: "produce_required_receipt_before_claiming_completion" };
    return { key: requirement.key, order: requirement.order, required: requirement.required !== false, receipt: requirement.receipt, verifier: requirement.verifier, status, reason_code: first.reason_code, allowed_action: first.allowed_action, evidence };
  });
}
function isNotDueFailure(row) {
  return row && (row.status === "NOT_DUE" || row.reason_code === "module_not_due");
}

function isPendingNotDueManifest(manifest) {
  const failedModules = Array.isArray(manifest?.failed_modules) ? manifest.failed_modules : [];
  return Boolean(
    manifest?.pending_not_due === true
    || (
      manifest?.ok !== true
      && (manifest?.missing_receipts || []).length === 0
      && (manifest?.failed_stages || []).length === 0
      && (manifest?.missing_module_receipts || []).length === 0
      && failedModules.length > 0
      && failedModules.every(isNotDueFailure)
    )
  );
}
function compactDateStrict(value) {
  const date = String(value || "").replace(/\D/g, "").slice(0, 8);
  return /^\d{8}$/.test(date) ? date : "";
}

function closureEvidenceForTradeDate(tradeDate, dailyRunId = "") {
  const expected = compactDateStrict(tradeDate);
  const manifestFile = path.join(ROOT, "outputs", "daily-terminal-run", `daily-terminal-run-${expected}.json`);
  const manifestLatestFile = path.join(ROOT, "outputs", "daily-terminal-run", "daily-terminal-run-latest.json");
  const controlFile = path.join(ROOT, "outputs", "terminal-control-plane", "terminal-control-plane.json");
  const canaryFile = path.join(ROOT, "outputs", "terminal-canary-publish", "terminal-canary-publish.json");
  const runIdClosureFile = path.join(ROOT, "outputs", "terminal-runid-closure-contract", "terminal-runid-closure-contract.json");
  const resourceChainFile = path.join(ROOT, "outputs", "terminal-resource-chain-audit", "terminal-resource-chain-audit.json");
  const manifest = readJson(manifestFile, readJson(manifestLatestFile, {}));
  const control = readJson(controlFile, {});
  const canary = readJson(canaryFile, {});
  const runIdClosure = readJson(runIdClosureFile, {});
  const resourceChain = readJson(resourceChainFile, {});
  const manifestDate = compactDateStrict(manifest.tradeDate || manifest.trade_date || manifest.latestDate || manifest.marketDate);
  const controlDate = compactDateStrict(control.tradeDate || control.trade_date);
  const canaryDate = compactDateStrict(canary.tradeDate || canary.trade_date || canary.latestDate);
  const runIdClosureDate = compactDateStrict(runIdClosure.tradeDate || runIdClosure.trade_date || runIdClosure.expectedDate);
  const resourceChainDate = compactDateStrict(resourceChain.expectedDate || resourceChain.tradeDate || resourceChain.trade_date || resourceChain.latestDate);
  const manifestModules = Array.isArray(manifest.modules) ? manifest.modules : [];
  const closureModules = Array.isArray(runIdClosure.manifest?.modules) ? runIdClosure.manifest.modules : (Array.isArray(runIdClosure.modules) ? runIdClosure.modules : []);
  const resourceRows = Array.isArray(resourceChain.rows) ? resourceChain.rows : (Array.isArray(runIdClosure.resourceChain?.rows) ? runIdClosure.resourceChain.rows : []);
  const sameDailyRun = !dailyRunId || !manifest.daily_run_id || String(manifest.daily_run_id) === String(dailyRunId);
  const checks = [
    { key: "manifest_ok", ok: manifest.ok === true && manifest.unattendedStatus === "YES" && manifestDate === expected && sameDailyRun && manifestModules.length >= 7 && manifestModules.every((row) => row?.ok === true && row?.fallback !== true && row?.rawFallback !== true) },
    { key: "control_plane_closed", ok: (control.ok === true || control.decision?.state === "UNATTENDED_YES" || control.masterController?.decision?.state === "UNATTENDED_YES") && (control.unattendedStatus === "YES" || control.decision?.unattendedStatus === "YES" || control.masterController?.decision?.unattendedStatus === "YES") && controlDate === expected && (!dailyRunId || !control.daily_run_id || String(control.daily_run_id) === String(dailyRunId)) && control.runIdClosure?.ok === true && control.dailyManifest?.ok === true && control.canaryPublish?.ok === true },
    { key: "canary_ready", ok: canary.ok === true && canary.scorecardPublishAllowed === true && (!canaryDate || canaryDate === expected) },
    { key: "runid_closure_ok", ok: runIdClosure.ok === true && (!runIdClosureDate || runIdClosureDate === expected) && closureModules.length >= 7 && closureModules.every((row) => row?.ok === true) },
    { key: "resource_chain_ok", ok: resourceChain.ok === true && (!resourceChainDate || resourceChainDate === expected) && resourceRows.length >= 7 && resourceRows.every((row) => row?.ok === true) },
  ];
  const failed = checks.filter((row) => !row.ok).map((row) => row.key);
  return {
    contract: "terminal-final-audit-closure-evidence-v1",
    ok: failed.length === 0,
    trade_date: expected,
    daily_run_id: dailyRunId,
    failed_checks: failed,
    files: { manifestFile, manifestLatestFile, controlFile, canaryFile, runIdClosureFile, resourceChainFile },
    summary: {
      manifestDate,
      controlDate,
      canaryDate,
      runIdClosureDate,
      resourceChainDate,
      moduleCount: manifestModules.length,
      closureModuleCount: closureModules.length,
      resourceRows: resourceRows.length,
    },
  };
}

function layerRows({ coreReceipts = [], requirementsAudit = [], moduleReceipts = [], closureEvidence = {} } = {}) {
  const rows = [];
  for (const row of coreReceipts || []) {
    const payload = row.payload || {};
    rows.push({ layer: payload.stage || "core_stage", status: payload.status || "", ok: ["PASS", "SKIPPED"].includes(payload.status), evidence: row.file || "", reason_code: payload.reason_code || "" });
  }
  for (const row of requirementsAudit || []) {
    rows.push({ layer: row.key || row.receipt || "requirement", status: row.status || "", ok: ["PASS", "SKIPPED"].includes(row.status), evidence: row.receipt || "", reason_code: row.reason_code || "" });
  }
  for (const row of moduleReceipts || []) {
    rows.push({ layer: row.key || "module", status: row.status || (row.ok ? "PASS" : "BLOCKED"), ok: row.ok === true || row.complete === true, evidence: row.file || row.source || "", reason_code: row.reason_code || row.issue || "" });
  }
  if (closureEvidence?.ok === true) {
    rows.push({ layer: "closure_evidence", status: "PASS", ok: true, evidence: "manifest+control+canary+runid_closure+resource_chain", reason_code: "closed_manifest_resource_chain_runid_verified" });
  }
  return rows;
}

function failurePayload({ auditRoot, tradeDate, dailyRunId, startedAt, lock, firstBlocker, reasonCode, allowedAction, error = "" }) {
  const requirementsMatrixFile = path.join(ROOT, "docs", "terminal-unattended-requirements.json");
  const requirementsMatrix = readJson(requirementsMatrixFile, null);
  const runDir = path.join(auditRoot, tradeDate, dailyRunId);
  const payload = {
    contract: "terminal-unattended-final-audit-v2",

    runner_path: RUNNER_PATH,

    source_root: ROOT,

    runner_identity: { canonical: true, path: RUNNER_PATH, source_root: ROOT },

    single_orchestrator: { contract: "terminal-single-daily-orchestrator-v1", legacy_task: null },

    generated_at: new Date().toISOString(),
    started_at: startedAt,
    daily_run_id: dailyRunId,
    trade_date: tradeDate,
    scope: "full_unattended_final_audit",
    registry: { file: path.join(runDir, "active-module-registry.json"), ok: false, structural_ok: false, not_connected_yet: [], exit_code: 1, module_count: 0 },
    orchestrator_lock: { acquired: lock?.ok === true, released: false, file: lock?.file || "", release: lock },
    module_collection: { file: path.join(runDir, "module-receipts", "collection.json"), ok: false, first_blocker: firstBlocker, reason_code: reasonCode, allowed_action: allowedAction },
    recovery_queue: { file: path.join(runDir, "recovery-queue.json"), ok: false, first_blocker: firstBlocker, reason_code: reasonCode, allowed_action: allowedAction },
    requirements_matrix: { file: requirementsMatrixFile, ok: requirementsMatrix?.contract === "terminal-unattended-requirements-v1", audit_ok: false, contract: requirementsMatrix?.contract || "" },
    requirements_audit: [],
    manifest: { file: path.join(runDir, "terminal-daily-manifest.json"), ok: false, first_blocker: firstBlocker, reason_code: reasonCode, allowed_action: allowedAction },
    receipts: [],
    missing_receipts: STAGES.map((stage) => stage.key),
    failed_stages: [],
    module_receipts: [],
    missing_module_receipts: [],
    failed_modules: [],
    decision: "NO",
    unattended_status: "NO",
    first_blocker: firstBlocker,
    reason_code: reasonCode,
    allowed_action: allowedAction,
    ok: false,
  };
  if (error) payload.error = error;
  return payload;
}
function main() {
  const tradeDate = compactDate(argValue("--trade-date", process.env.FUMAN_TRADE_DATE || ""));
  const auditRoot = path.resolve(argValue("--out", defaultAuditRoot(ROOT)));
  const dailyRunId = argValue("--daily-run-id", process.env.FUMAN_DAILY_RUN_ID || resolveDailyRunId({ auditRoot, tradeDate }));
  const runtimeDir = argValue("--runtime-dir", defaultRuntimeDir());
  const lockOwnerToken = process.env.FUMAN_ORCHESTRATOR_LOCK_OWNER || "";
  const runDir = path.join(auditRoot, tradeDate, dailyRunId);
  fs.mkdirSync(path.join(runDir, "artifacts"), { recursive: true });
  const startedAt = new Date().toISOString();
  const lock = acquireOrchestratorLock({ dailyRunId, tradeDate, runtimeDir, ownerToken: lockOwnerToken });
  const legacyTask = queryLegacyOrchestratorTask();
  if (!lock.ok) {
    const payload = failurePayload({ auditRoot, tradeDate, dailyRunId, startedAt, lock, firstBlocker: "orchestrator_lock", reasonCode: lock.reasonCode || "orchestrator_lock_not_acquired", allowedAction: "wait_for_active_orchestrator_to_finish_then_retry" });
    const contentionRoot = path.join(auditRoot, "lock-contention", tradeDate, dailyRunId);
    const file = path.join(contentionRoot, "terminal-unattended-final-audit.json");
    fs.mkdirSync(contentionRoot, { recursive: true });
    payload.contention_artifact = true;
    payload.authoritative_latest_untouched = true;
    writeJson(file, payload);
    console.log(JSON.stringify({ ok: false, decision: "NO", first_blocker: payload.first_blocker, reason_code: payload.reason_code, output: file, authoritative_latest_untouched: true }, null, 2));
    process.exitCode = 1;
    return;
  }
  writeJson(path.join(auditRoot, tradeDate, "daily-run-id.json"), { contract: "terminal-daily-run-id-v1", trade_date: tradeDate, daily_run_id: dailyRunId, updated_at: new Date().toISOString() });
  if (legacyTask.checked && legacyTask.installed && !legacyTask.disabled) {
    const release = releaseOrchestratorLock(lock);
    const payload = failurePayload({ auditRoot, tradeDate, dailyRunId, startedAt, lock, firstBlocker: "legacy_orchestrator_conflict", reasonCode: "legacy_orchestrator_conflict", allowedAction: "disable_legacy_orchestrator_task_then_retry" });
    payload.single_orchestrator = { contract: "terminal-single-daily-orchestrator-v1", legacy_task: legacyTask };
    payload.orchestrator_lock = { acquired: lock.ok === true, released: release.released === true, file: lock.file || "", release };
    writeJson(path.join(runDir, "terminal-unattended-final-audit.json"), payload);
    writeJson(path.join(auditRoot, "terminal-unattended-final-audit.json"), payload);
    if (process.env.FUMAN_FINAL_AUDIT_WRITE_RUNTIME !== "0") writeJson(path.join(runtimeDir, "state", "unattended-final-audit.json"), payload);
  writeRuntimeRecoveryQueue(runtimeDir, { contract: "terminal-recovery-queue-v1", generated_at: new Date().toISOString(), daily_run_id: dailyRunId, trade_date: tradeDate, entries: [{ key: firstBlocker, status: "BLOCKED", reason_code: reasonCode, allowed_action: allowedAction }], first_blocker: firstBlocker, reason_code: reasonCode, allowed_action: allowedAction, ok: false, unattended_status: "NO" });
    console.error(JSON.stringify({ ok: false, decision: "NO", daily_run_id: dailyRunId, first_blocker: payload.first_blocker, reason_code: payload.reason_code, allowed_action: payload.allowed_action, output: path.join(auditRoot, "terminal-unattended-final-audit.json") }, null, 2));
    process.exitCode = 1;
    return;
  }
  try {
    const core = runCoreStages({ auditRoot, tradeDate, dailyRunId, runtimeDir, runDir });
    const collectionRun = runNode(["scripts/collect-terminal-module-receipts.js", `--trade-date=${tradeDate}`, `--daily-run-id=${dailyRunId}`, `--out=${auditRoot}`, `--runtime-dir=${runtimeDir}`], { FUMAN_TRADE_DATE: tradeDate, FUMAN_DAILY_RUN_ID: dailyRunId });
    const collectionFile = path.join(auditRoot, tradeDate, dailyRunId, "module-receipts", "collection.json");
    const collection = readJson(collectionFile, collectionRun.parsed || {});
    const recoveryQueueRefresh = refreshRecoveryQueueVerifier({ tradeDate, dailyRunId });
    const recoveryQueueVerifierFile = recoveryQueueRefresh.output;
    const recoveryQueueVerifier = recoveryQueueRefresh.payload || null;
    const recoveryQueueVerifierFresh = recoveryQueueVerifier?.contract === "terminal-recovery-queue-verifier-v1"
      && recoveryQueueVerifier.trade_date === tradeDate
      && (!dailyRunId || recoveryQueueVerifier.daily_run_id === dailyRunId);
    const manifestRun = runNode(["scripts/write-terminal-daily-manifest.js", `--trade-date=${tradeDate}`, `--daily-run-id=${dailyRunId}`, `--out=${auditRoot}`, `--runtime-dir=${runtimeDir}`, `--registry=${core.registryFile}`], { FUMAN_TRADE_DATE: tradeDate, FUMAN_DAILY_RUN_ID: dailyRunId });
    const manifestFile = path.join(auditRoot, tradeDate, dailyRunId, "terminal-daily-manifest.json");
    const manifest = readJson(manifestFile, manifestRun.parsed || {});
    const runtimeManifestFile = path.join(runtimeDir, "state", "terminal-daily-manifest.json");
    const runtimeManifest = readJson(runtimeManifestFile, null);
    const runtimeManifestOk = runtimeManifest?.contract === "terminal-daily-manifest-v2"
      && runtimeManifest.daily_run_id === dailyRunId
      && runtimeManifest.trade_date === tradeDate
      && runtimeManifest.runtime_file === runtimeManifestFile
      && runtimeManifest.ok === (manifest.ok === true);
    const requirementsMatrixFile = path.join(ROOT, "docs", "terminal-unattended-requirements.json");
    const requirementsMatrix = readJson(requirementsMatrixFile, null);
    const requirementsOk = requirementsMatrix?.contract === "terminal-unattended-requirements-v1" && requirementsMatrix?.generated_for === "full_unattended_final_audit" && Array.isArray(requirementsMatrix?.requirements);
    const registryOperationalOk = core.registryOk && !(core.registry?.not_connected_yet || []).length;
    const lockRelease = releaseOrchestratorLock(lock);
    const baseGateOk = registryOperationalOk && manifest.ok === true && runtimeManifestOk && lockRelease.ok === true;
    const closureEvidence = closureEvidenceForTradeDate(tradeDate, dailyRunId);
    let requirementsAudit = buildRequirementAudit({ requirements: requirementsMatrix?.requirements || [], registry: core.registry, registryOperationalOk, coreReceipts: core.receipts, collection, manifest, lockRelease, baseGateOk, requirementsOk });
    if (closureEvidence.ok === true) {
      const closureEligibleRequirementKeys = new Set([
        "manifest",
        "canary_publish",
        "runid_closure",
        "api",
        "desktop",
        "mobile",
        "route_88",
        "scorecard",
        "source_reports",
        "control_plane",
        "unattended_yes_no_final_audit",
      ]);
      requirementsAudit = requirementsAudit.map((row) => {
        if (["PASS", "SKIPPED"].includes(row.status)) return row;
        if (!closureEligibleRequirementKeys.has(row.key)) return row;
        return {
          ...row,
          original_status: row.status,
          original_reason_code: row.reason_code,
          original_allowed_action: row.allowed_action,
          status: "PASS",
          reason_code: "closed_manifest_resource_chain_runid_verified",
          allowed_action: "none",
          closure_override: true,
        };
      });
    }
    const marketClosedPreviousGoodHold = (core.receipts || []).some((row) => row?.payload?.stage === "market_calendar"
      && row?.payload?.status === "PASS"
      && row?.payload?.reason_code === "market_closed_previous_good");
    if (marketClosedPreviousGoodHold) {
      requirementsAudit = requirementsAudit.map((row) => {
        if (["PASS", "SKIPPED"].includes(row.status)) return row;
        return {
          ...row,
          original_status: row.status,
          original_reason_code: row.reason_code,
          original_allowed_action: row.allowed_action,
          status: "SKIPPED",
          reason_code: "market_closed_previous_good",
          allowed_action: "preserve_previous_good_without_latest_writes",
          market_closed_previous_good_hold: true,
        };
      });
    }
    const requirementsAuditOk = requirementsAudit.filter((row) => row.required).every((row) => ["PASS", "SKIPPED"].includes(row.status));
    const effectiveCollectionOk = marketClosedPreviousGoodHold || collection.ok === true || closureEvidence.ok === true;
    const pendingNotDue = Boolean(!marketClosedPreviousGoodHold && !closureEvidence.ok && registryOperationalOk && runtimeManifestOk && lockRelease.ok === true && requirementsOk && isPendingNotDueManifest(manifest));
    const finalOk = Boolean((marketClosedPreviousGoodHold || baseGateOk || closureEvidence.ok === true) && requirementsOk && requirementsAuditOk && registryOperationalOk && runtimeManifestOk && lockRelease.ok === true);
    const finalDecision = marketClosedPreviousGoodHold ? "PREVIOUS_GOOD_HOLD" : (finalOk ? "YES" : (pendingNotDue ? "PENDING_NOT_DUE" : "NO"));
    const finalBlocker = marketClosedPreviousGoodHold ? "market_closed_previous_good" : (finalOk ? "" : (!core.registryOk ? "active_module_registry" : (!requirementsOk ? "requirements_matrix" : (manifest.ok !== true ? (manifest.first_blocker || collection.first_blocker || "daily_manifest_not_ready") : (!runtimeManifestOk ? "daily_manifest_runtime_not_written_or_identity_mismatch" : (collection.first_blocker || (!registryOperationalOk ? "module_not_yet_wired" : (lockRelease.ok ? "" : "orchestrator_lock_release"))))))));
    const finalReasonCode = marketClosedPreviousGoodHold ? "market_closed_previous_good" : (finalOk ? "ok" : (!core.registryOk ? "active_module_registry_not_written_or_identity_mismatch" : (!requirementsOk ? "requirements_matrix_missing_or_invalid" : (manifest.ok !== true ? (manifest.reason_code || collection.reason_code || "daily_manifest_not_ready") : (!runtimeManifestOk ? "daily_manifest_runtime_not_written_or_identity_mismatch" : (collection.reason_code || (!registryOperationalOk ? "active_module_registry_module_not_connected" : (lockRelease.ok ? "ok" : lockRelease.reasonCode || "orchestrator_lock_release_failed"))))))));
    const finalAllowedAction = marketClosedPreviousGoodHold ? "preserve_previous_good_without_latest_writes" : (finalOk ? "none" : (!core.registryOk ? "repair_active_module_registry_writer_then_retry" : (!requirementsOk ? "repair_requirements_matrix_then_retry" : (manifest.ok !== true ? (manifest.allowed_action || collection.allowed_action || "produce_current_daily_manifest_before_claiming_completion") : (!runtimeManifestOk ? "repair_runtime_manifest_writer_then_retry" : (collection.allowed_action || (!registryOperationalOk ? "connect_required_module_receipt_adapter_then_retry" : (lockRelease.ok ? "none" : "repair_orchestrator_lock_then_retry"))))))));
    const powerRecoveryStageReceipt = (core.receipts || []).find((row) => row?.payload?.stage === "power_recovery") || null;
    const powerRecoveryEvidence = powerRecoveryStageReceipt?.payload?.evidence || {};
    const powerRecoverySummary = {
      file: powerRecoveryStageReceipt?.file || "",
      artifact: powerRecoveryStageReceipt?.payload?.artifact || "",
      status: powerRecoveryStageReceipt?.payload?.status || "MISSING",
      complete: powerRecoveryStageReceipt?.payload?.complete === true,
      ok: powerRecoveryEvidence?.ok === true,
      task_name: powerRecoveryEvidence?.task_name || "",
      task_registered: powerRecoveryEvidence?.taskRegistered === true,
      start_when_available_ready: powerRecoveryEvidence?.startWhenAvailableReady === true,
      post_boot_recovery_verified: powerRecoveryEvidence?.postBootRecoveryVerified === true,
      lock_safe: powerRecoveryEvidence?.lockSafe === true,
      stale_lock_handled: powerRecoveryEvidence?.staleLockHandled === true,
      unexpected_shutdown_event: powerRecoveryEvidence?.unexpectedShutdownEvent === true,
      checked_at: powerRecoveryEvidence?.checked_at || powerRecoveryEvidence?.checkedAt || "",
      failures: powerRecoveryEvidence?.failures || [],
    };
    const finalPayload = {
      contract: "terminal-unattended-final-audit-v2",

      runner_path: RUNNER_PATH,

      source_root: ROOT,

      runner_identity: { canonical: true, path: RUNNER_PATH, source_root: ROOT },

    single_orchestrator: { contract: "terminal-single-daily-orchestrator-v1", legacy_task: legacyTask },

      generated_at: new Date().toISOString(),
      started_at: startedAt,
      daily_run_id: dailyRunId,
      trade_date: tradeDate,
      scope: "full_unattended_final_audit",
      registry: { file: core.registryFile, ok: registryOperationalOk, structural_ok: core.registryOk, not_connected_yet: core.registry?.not_connected_yet || [], deferred_not_yet_wired: core.registry?.deferred_not_yet_wired || [], exit_code: core.registryRun.exit_code, module_count: core.registry?.modules?.length || 0 },
      orchestrator_lock: { acquired: true, released: lockRelease.released === true, file: lock.file, release: lockRelease },
      power_recovery: powerRecoverySummary,
      module_collection: { file: collectionFile, ok: effectiveCollectionOk, original_ok: collection.ok === true, closure_override: closureEvidence.ok === true && collection.ok !== true, first_blocker: closureEvidence.ok === true ? "" : (collection.first_blocker || ""), reason_code: closureEvidence.ok === true ? "ok" : (collection.reason_code || ""), allowed_action: closureEvidence.ok === true ? "none" : (collection.allowed_action || "") },
      recovery_queue: { file: collection.recovery_queue_file || "", ok: collection.recovery_queue?.ok === true, first_blocker: collection.recovery_queue?.first_blocker || "", reason_code: collection.recovery_queue?.reason_code || "", allowed_action: collection.recovery_queue?.allowed_action || "" },
      recovery_queue_verifier: {
        file: recoveryQueueVerifierFile,
        refreshed: true,
        refresh_exit_code: recoveryQueueRefresh.run.exit_code,
        refresh_command: recoveryQueueRefresh.run.command,
        refresh_started_at: recoveryQueueRefresh.run.started_at,
        refresh_finished_at: recoveryQueueRefresh.run.finished_at,
        fresh: recoveryQueueVerifierFresh,
        ok: recoveryQueueVerifierFresh && recoveryQueueVerifier?.ok === true,
        status: recoveryQueueVerifierFresh ? (recoveryQueueVerifier.status || "") : "STALE_OR_MISSING",
        issues: recoveryQueueVerifierFresh ? (recoveryQueueVerifier.issues || []) : ["recovery_queue_verifier_stale_or_missing"],
        receipt_summary: recoveryQueueVerifierFresh ? (recoveryQueueVerifier.receipt_summary || []) : [],
      },
      requirements_matrix: { file: requirementsMatrixFile, ok: requirementsOk, audit_ok: requirementsAuditOk, contract: requirementsMatrix?.contract || "" },
      requirements_audit: requirementsAudit,
      closure_evidence: closureEvidence,
      layers: layerRows({ coreReceipts: core.receipts, requirementsAudit, moduleReceipts: manifest.module_receipts || [], closureEvidence }),
      manifest: { file: manifestFile, runtime_file: runtimeManifestFile, ok: manifest.ok === true, runtime_ok: runtimeManifestOk, first_blocker: manifest.first_blocker || "", reason_code: manifest.reason_code || "", allowed_action: manifest.allowed_action || "" },
      receipt_summary_contract: "terminal-final-audit-receipt-summary-v1",
      receipts: (core.receipts || []).map((row) => ({
        stage: row.payload.stage,
        label: row.payload.label || "",
        file: row.file,
        receipt_present: row.payload.receipt_present === true,
        receipt_exists: row.file ? fs.existsSync(row.file) : false,
        artifact: row.payload.artifact || "",
        daily_run_id: row.payload.daily_run_id || "",
        trade_date: row.payload.trade_date || "",
        status: row.payload.status,
        complete: row.payload.complete,
        exit_code: row.payload.exit_code,
        checked_at: row.payload.checked_at || "",
        reason_code: row.payload.reason_code,
        allowed_action: row.payload.allowed_action,
      })),
      missing_receipts: marketClosedPreviousGoodHold ? [] : (manifest.missing_receipts || []),
      failed_stages: marketClosedPreviousGoodHold ? [] : (manifest.failed_stages || []),
      module_receipts: manifest.module_receipts || [],
      missing_module_receipts: marketClosedPreviousGoodHold ? [] : (manifest.missing_module_receipts || []),
      failed_modules: marketClosedPreviousGoodHold ? [] : (manifest.failed_modules || []),
      decision: finalDecision,
      unattended_status: marketClosedPreviousGoodHold ? "PREVIOUS_GOOD_HOLD" : (finalOk ? "YES" : "NO"),
      first_blocker: finalBlocker,
      reason_code: finalReasonCode,
      allowed_action: finalAllowedAction,
      pending_not_due: pendingNotDue,
      ok: finalOk,
    };
    const latest = path.join(auditRoot, "terminal-unattended-final-audit.json");
    writeJson(path.join(runDir, "terminal-unattended-final-audit.json"), finalPayload);
    writeJson(latest, finalPayload);
    if (process.env.FUMAN_FINAL_AUDIT_WRITE_RUNTIME !== "0") writeJson(path.join(runtimeDir, "state", "unattended-final-audit.json"), finalPayload);
    writeRuntimeRecoveryQueue(runtimeDir, collection.recovery_queue || {});
    console.log(JSON.stringify({ ok: finalPayload.ok, decision: finalPayload.decision, pending_not_due: finalPayload.pending_not_due, daily_run_id: dailyRunId, trade_date: tradeDate, first_blocker: finalPayload.first_blocker, reason_code: finalPayload.reason_code, allowed_action: finalPayload.allowed_action, module_count: finalPayload.module_receipts.length, output: latest }, null, 2));
    if (!finalPayload.ok || (!marketClosedPreviousGoodHold && manifestRun.exit_code !== 0) || (!marketClosedPreviousGoodHold && !closureEvidence.ok && collectionRun.exit_code !== 0)) process.exitCode = 1;
  } catch (error) {
    const release = releaseOrchestratorLock(lock);
    const payload = failurePayload({ auditRoot, tradeDate, dailyRunId, startedAt, lock, firstBlocker: "final_audit_exception", reasonCode: "final_audit_exception", allowedAction: "inspect_final_audit_error_then_retry", error: String(error.stack || error.message || error) }); payload.execution_aborted = true; payload.orchestrator_lock = { acquired: lock?.ok === true, released: release?.released === true, file: lock?.file || "", release }; payload.lock_release = release;
    writeJson(path.join(runDir, "terminal-unattended-final-audit.json"), payload); writeJson(path.join(auditRoot, "terminal-unattended-final-audit.json"), payload); writeRuntimeRecoveryQueue(runtimeDir, { contract: "terminal-recovery-queue-v1", generated_at: new Date().toISOString(), daily_run_id: dailyRunId, trade_date: tradeDate, entries: [{ key: payload.first_blocker, status: "BLOCKED", reason_code: payload.reason_code, allowed_action: payload.allowed_action }], first_blocker: payload.first_blocker, reason_code: payload.reason_code, allowed_action: payload.allowed_action, ok: false, unattended_status: "NO" });
    console.error(JSON.stringify(payload, null, 2));
    process.exitCode = 1;
  }
}

main();































