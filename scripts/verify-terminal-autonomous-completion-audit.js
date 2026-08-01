"use strict";

const fs = require("fs");
const { spawnSync } = require("child_process");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const OUT_DIR = path.join(ROOT, "outputs", "terminal-autonomous-completion-audit");
const { loadActiveModuleRegistry } = require("../lib/terminal-active-module-registry");
const ACTIVE_MODULE_REGISTRY = loadActiveModuleRegistry();
const REQUIRED_ACTIVE_MODULES = ACTIVE_MODULE_REGISTRY.active.map((row) => row.key);
const SCHEDULE_VERIFIER = path.join(ROOT, "scripts", "verify-terminal-autonomous-schedule-contract.js");

const FILES = {
  predictivePreflight: path.join(ROOT, "outputs", "terminal-predictive-preflight", "terminal-predictive-preflight.json"),
  fugleWebSocket: path.join(RUNTIME_DIR, "reports", "fugle-websocket-source-readiness.json"),
  warmupFinal: path.join(RUNTIME_DIR, "state", "daytrade-unattended-final-verdict.json"),
  warmupSelfHeal: path.join(RUNTIME_DIR, "state", "daytrade-warmup-self-heal", "daytrade-warmup-self-heal-plan.json"),
  waterRoot: path.join(ROOT, "outputs", "terminal-water-root", "terminal-water-root.json"),
  orchestrator: path.join(ROOT, "outputs", "terminal-orchestrator", "terminal-orchestrator-state.json"),
  rollForward: path.join(ROOT, "outputs", "terminal-roll-forward", "terminal-auto-roll-forward.json"),
  manifest: path.join(ROOT, "outputs", "daily-terminal-run", "daily-terminal-run-latest.json"),
  canary: path.join(ROOT, "outputs", "terminal-canary-publish", "terminal-canary-publish.json"),
  controlPlane: path.join(ROOT, "outputs", "terminal-control-plane", "terminal-control-plane.json"),
  policy: path.join(ROOT, "outputs", "autonomous-ops-policy", "autonomous-ops-policy.json"),
  notificationPlan: path.join(ROOT, "outputs", "autonomous-ops-notification", "autonomous-ops-notification-plan.json"),
  opsStatus: path.join(ROOT, "data", "terminal-ops-status-latest.json"),
  reasonCodeClassifier: path.join(ROOT, "outputs", "terminal-reason-code-classifier", "terminal-reason-code-classifier.json"),
  protectedReadbackCredential: path.join(ROOT, "outputs", "protected-readback-credential", "protected-readback-credential.json"),
};

const REQUIRED_SCRIPTS = [
  "ops:predictive-preflight",
  "verify:terminal-predictive-preflight",
  "verify:fugle-websocket-sources",
  "verify:terminal-water-root",
  "verify:terminal-water-root-contract",
  "verify:daytrade-warmup-unattended",
  "verify:daytrade-warmup-root",
  "verify:daytrade-warmup-nine-day",
  "daytrade-warmup:root",
  "daytrade-warmup:self-heal",
  "verify:daytrade-warmup-self-heal",
  "verify:daytrade-warmup-schedule-self-heal",
  "verify:strategy-scan-formal-gate",
  "orchestrator:state",
  "orchestrator:state:from-existing",
  "verify:terminal-state-machine-contract",
  "verify:terminal-reason-code-classifier",
  "verify:terminal-auto-roll-forward",
  "verify:terminal-autonomous-schedule",
  "verify:terminal-autonomous-schedule:live",
  "verify:terminal-active-module-registry",
  "verify:terminal-idempotent-runner",
  "verify:strategy-scan-receipt-contract",
  "manifest:daily-terminal-run",
  "verify:daily-terminal-run-manifest",
  "verify:terminal-canary-publish",
  "verify:manifest-publish-wiring",
  "verify:backend-auth-isolation",
  "verify:backend-service-token-schedule",
  "verify:terminal-resource-chain:unattended",
  "verify:terminal-runid-closure",
  "control:terminal",
  "verify:terminal-control-plane",
  "verify:terminal-control-plane:from-existing",
  "policy:autonomous-ops",
  "verify:autonomous-ops-action-matrix",
  "ops:notification:plan",
  "verify:autonomous-ops-notification-policy",
  "ops:status:export",
  "verify:terminal-ops-status-api",
  "verify:terminal-autonomous-completion-audit",
  "verify:protected-readback-credential-contract",
  "verify:protected-readback-credential",
  "ops:production-unattended-readiness-report",
  "verify:production-unattended-readiness-report",
];

const DREAM_LAYERS = [
  "Market Calendar",
  "Predictive Preflight",
  "Fugle WebSocket Source Layer",
  "Water Root",
  "Warmup Phase State Machine",
  "0700 / 0845 / 0900 Natural Evidence",
  "Reason Code Classifier",
  "Self-Heal Job Queue",
  "Idempotent Rewater Runner",
  "Re-Water Verification",
  "Formal Entry Gate",
  "Strategy Scan State Machine",
  "Idempotent Scanners",
  "Daily Manifest",
  "Canary Publish",
  "RunId Closure",
  "Scorecard / Desktop / Mobile / 88 Closure",
  "Auto Roll Forward",
  "Control Plane",
  "Autonomous Ops Policy",
  "Unattended YES / NO Final Audit",
];

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function readPackage() {
  return readJson(path.join(ROOT, "package.json"), { scripts: {} });
}

function compactDate(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function taipeiDateKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${values.year || ""}${values.month || ""}${values.day || ""}`;
}

function marketCalendarRow(artifacts = {}) {
  return artifacts?.waterRoot?.marketCalendar?.row
    || artifacts?.predictivePreflight?.marketCalendar?.row
    || null;
}

function lower(value) {
  return String(value || "").toLowerCase();
}

function assert(condition, issues, issue, details = {}) {
  if (!condition) issues.push({ issue, details });
}

function acceptableCompletionStatus(value, closed) {
  if (value === "YES") return true;
  return closed === true && value === "PREVIOUS_GOOD_HOLD";
}

function manifestPreviousGoodHoldClosure(manifest = {}, modules = []) {
  if (manifest?.unattendedStatus !== "PREVIOUS_GOOD_HOLD") return false;
  if (manifest?.ok !== true || !modules.length) return false;
  return modules.every((row) => row?.ok === true
    && row?.complete === true
    && row?.fallback !== true
    && row?.rawFallback !== true
    && Boolean(row?.runId)
    && row?.tradeDate === manifest.tradeDate
    && row?.sourceDate === manifest.tradeDate);
}

function closedDaySafeHoldManifest(manifest = {}, closed = false) {
  if (closed !== true) return false;
  const safeBits = [
    manifest?.phase,
    manifest?.unattendedStatus,
    manifest?.finalDecision,
    manifest?.publishDecision,
    manifest?.closureStatus,
  ].map((value) => String(value || "").toLowerCase());
  return safeBits.includes("market_closed")
    && manifest?.unattendedStatus === "PREVIOUS_GOOD_HOLD"
    && manifest?.finalDecision === "PRESERVE_PREVIOUS_GOOD"
    && manifest?.publishDecision === "PRESERVE_PREVIOUS_GOOD"
    && manifest?.closureStatus === "PREVIOUS_GOOD_HOLD"
    && manifest?.preservePreviousGood === true
    && manifest?.naturalSuccess === false
    && manifest?.selfHealRecovered === false
    && manifest?.sourceGrade !== "A"
    && manifest?.gateGrade !== "A";
}
function protectedReadbackDisplayOnlyBlocker({ protectedReadbackCredential = {}, opsStatus = {} } = {}) {
  if (protectedReadbackCredential?.ok === true) return false;
  return opsStatus?.ok === true
    && opsStatus?.unattendedStatus === "YES"
    && Array.isArray(opsStatus?.protectedReadbackDisplayBlockers)
    && opsStatus.protectedReadbackDisplayBlockers.length > 0;
}

function fileEvidence(name, file, expectedContract, payload, issues) {
  const exists = fs.existsSync(file);
  assert(exists, issues, `${name}_artifact_missing`, { file });
  if (!exists) return { name, ok: false, file, contract: "missing", summary: "artifact missing" };
  if (expectedContract) {
    assert(payload?.contract === expectedContract, issues, `${name}_contract_mismatch`, {
      expectedContract,
      actual: payload?.contract,
      file,
    });
  }
  return {
    name,
    ok: expectedContract ? payload?.contract === expectedContract : payload !== null,
    file,
    contract: payload?.contract || "",
    summary: summarizeArtifact(name, payload),
  };
}

function summarizeArtifact(name, payload = {}) {
  if (!payload || typeof payload !== "object") return "not-json";
  if (name === "predictivePreflight") return `state=${payload.state || "--"}; action=${payload.action || "--"}; scannerTargetDate=${payload.scannerTargetDate || "--"}; preservePreviousGood=${payload.preservePreviousGood}`;
  if (name === "fugleWebSocket") return `ok=${payload.ok}; status=${payload.status || "--"}; stock=${payload.stock?.connected}/${payload.stock?.authenticated}; futopt=${payload.futopt?.connected}/${payload.futopt?.authenticated}`;
  if (name === "warmupFinal") return `yes=${payload.unattended_yes || payload.unattendedYes || "--"}; failedPhase=${payload.failed_phase || payload.failedPhase || "--"}; selfHeal=${payload.self_heal_action || payload.selfHealAction || "--"}`;
  if (name === "warmupSelfHeal") return `state=${payload.decision?.state || "--"}; mode=${payload.mode || "--"}; jobs=${Array.isArray(payload.jobs) ? payload.jobs.length : 0}`;
  if (name === "waterRoot") return `ok=${payload.ok}; status=${payload.status || payload.waterStatus || payload.reason || "--"}; reason=${payload.reason || "--"}`;
  if (name === "orchestrator") return `overallState=${payload.overallState || "--"}; modules=${Array.isArray(payload.modules) ? payload.modules.length : 0}; jobs=${Array.isArray(payload.jobQueue) ? payload.jobQueue.length : 0}`;
  if (name === "rollForward") return `mode=${payload.mode || "--"}; jobs=${payload.jobs}; decision=${payload.decision?.state || "--"}`;
  if (name === "manifest") return `tradeDate=${payload.tradeDate || "--"}; ok=${payload.ok}; unattended=${payload.unattendedStatus}; modules=${Array.isArray(payload.modules) ? payload.modules.length : 0}`;
  if (name === "canary") return `status=${payload.status || "--"}; scorecardPublishAllowed=${payload.scorecardPublishAllowed}; marketClosedPreviousGood=${payload.marketClosedPreviousGood}`;
  if (name === "controlPlane") return `state=${payload.decision?.state || "--"}; unattended=${payload.decision?.unattendedStatus || "--"}; tradeDate=${payload.tradeDate || "--"}`;
  if (name === "policy") return `opsState=${payload.decision?.opsState || "--"}; unattended=${payload.decision?.unattendedStatus || "--"}; action=${payload.decision?.action || "--"}`;
  if (name === "notificationPlan") return `required=${payload.notification?.required}; sendAllowed=${payload.notification?.sendAllowed}; kind=${payload.notification?.kind || "--"}`;
  if (name === "opsStatus") return `state=${payload.state || "--"}; unattended=${payload.unattendedStatus || "--"}; modules=${Array.isArray(payload.modules) ? payload.modules.length : 0}`;
  if (name === "reasonCodeClassifier") {
    const codes = Array.isArray(payload.summary?.codes) ? payload.summary.codes : Object.keys(payload.summary?.codes || {});
    return `ok=${payload.ok}; entries=${payload.summary?.entries ?? (Array.isArray(payload.entries) ? payload.entries.length : "")}; unknownEntries=${payload.summary?.unknownEntries ?? payload.unknownEntries ?? ""}; codes=${codes.length}`;
  }
  if (name === "protectedReadbackCredential") return `ok=${payload.ok}; armed=${payload.armed}; source=${payload.source || "--"}; failures=${Array.isArray(payload.failures) ? payload.failures.join(",") : "--"}`;
  return `contract=${payload.contract || "--"}`;
}

function marketClosedMode({ predictivePreflight, policy, manifest, controlPlane, waterRoot, expectedDate = "" } = {}) {
  const calendar = marketCalendarRow({ predictivePreflight, waterRoot });
  const calendarDate = compactDate(calendar?.marketDate || calendar?.requestedDate || calendar?.displayTradeDate);
  const targetDate = compactDate(expectedDate || calendarDate || taipeiDateKey());
  if (calendar) {
    if (calendarDate && targetDate && calendarDate !== targetDate) return false;
    if (calendar.finalMarketOpen === true || calendar.tradingDayOpen === true || calendar.marketOpen === true || lower(calendar.marketStatus) === "open") return false;
    if (calendar.finalMarketOpen === false || calendar.tradingDayOpen === false || calendar.marketOpen === false || lower(calendar.marketStatus) === "closed") return true;
    return false;
  }
  const bits = [
    predictivePreflight?.state,
    predictivePreflight?.action,
    predictivePreflight?.reason,
    policy?.decision?.opsState,
    manifest?.waterRoot?.status,
    manifest?.waterRoot?.reason,
    manifest?.blocker,
    waterRoot?.status,
    waterRoot?.reason,
    controlPlane?.decision?.state,
    controlPlane?.decision?.reason,
  ].map(lower).join(" ");
  const tradingDayWait = bits.includes("pending_not_due")
    || bits.includes("trading_day_wait_source_window")
    || bits.includes("trading_day_after_formal_source_window")
    || bits.includes("trading_day_before_formal_source_window");
  if (tradingDayWait) return false;
  return bits.includes("market_closed");
}
function verifyLiveSchedule(issues) {
  const child = spawnSync(process.execPath, [SCHEDULE_VERIFIER, "--require-live"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 30000,
    windowsHide: true,
  });
  let parsed = null;
  try {
    parsed = JSON.parse(String(child.stdout || "").trim());
  } catch {
    parsed = null;
  }
  const verifierIssues = Array.isArray(parsed?.issues) ? parsed.issues : [];
  const ok = !child.error && child.status === 0 && parsed?.ok === true;
  if (!ok) {
    const reason = verifierIssues.join(",") || child.error?.message || `exit_${child.status ?? "unknown"}`;
    issues.push({
      issue: `live_schedule_gate_failed:${reason}`,
      details: { exitCode: child.status, verifier: parsed, stderr: String(child.stderr || "").trim() },
    });
  }
  return {
    ok,
    exitCode: child.status,
    issues: verifierIssues,
    verifier: parsed,
    stderr: String(child.stderr || "").trim(),
  };
}
function verifyPackageScripts(pkg, issues) {
  const scripts = pkg.scripts || {};
  const rows = [];
  for (const name of REQUIRED_SCRIPTS) {
    const command = scripts[name] || "";
    assert(Boolean(command), issues, `package_script_missing:${name}`);
    rows.push({ name, ok: Boolean(command), command });
  }
  const root = scripts["verify:terminal-unattended-root"] || "";
  for (const required of [
    "ops:predictive-preflight",
    "verify:fugle-websocket-sources",
    "verify:terminal-water-root",
    "verify:terminal-water-root-contract",
    "verify:daytrade-warmup-root",
    "verify:daytrade-warmup-nine-day",
    "daytrade-warmup:root",
    "verify:strategy-scan-formal-gate",
    "verify:strategy-scan-receipt-contract",
    "verify:terminal-control-plane",
    "verify:terminal-state-machine-contract",
    "verify:terminal-reason-code-classifier",
    "verify:terminal-auto-roll-forward",
  "verify:terminal-autonomous-schedule",
  "verify:terminal-autonomous-schedule:live",
  "verify:terminal-active-module-registry",
    "verify:terminal-idempotent-runner",
    "manifest:daily-terminal-run",
    "verify:terminal-canary-publish",
    "verify:terminal-resource-chain:unattended",
    "verify:manifest-publish-wiring",
    "verify:terminal-runid-closure",
    "verify:backend-auth-isolation",
    "verify:backend-service-token-schedule",
    "verify:autonomous-ops-action-matrix",
    "verify:autonomous-ops-notification-policy",
    "verify:terminal-ops-status-api",
    "verify:terminal-autonomous-completion-audit",
    "verify:protected-readback-credential-contract",
    "verify:protected-readback-credential",
    "ops:production-unattended-readiness-report",
    "verify:production-unattended-readiness-report",
  ]) {
    assert(root.includes(required), issues, `root_gate_missing:${required}`, { root });
  }
  return rows;
}

function verifyArtifacts(artifacts, issues) {
  const rows = [];
  rows.push(fileEvidence("predictivePreflight", FILES.predictivePreflight, "terminal-predictive-preflight-v1", artifacts.predictivePreflight, issues));
  rows.push(fileEvidence("fugleWebSocket", FILES.fugleWebSocket, "fugle-websocket-source-readiness-v1", artifacts.fugleWebSocket, issues));
  rows.push(fileEvidence("warmupFinal", FILES.warmupFinal, null, artifacts.warmupFinal, issues));
  rows.push(fileEvidence("warmupSelfHeal", FILES.warmupSelfHeal, "daytrade-warmup-self-heal-runner-v1", artifacts.warmupSelfHeal, issues));
  rows.push(fileEvidence("waterRoot", FILES.waterRoot, null, artifacts.waterRoot, issues));
  rows.push(fileEvidence("orchestrator", FILES.orchestrator, "terminal-orchestrator-state-v1", artifacts.orchestrator, issues));
  rows.push(fileEvidence("rollForward", FILES.rollForward, "terminal-auto-roll-forward-v1", artifacts.rollForward, issues));
  rows.push(fileEvidence("manifest", FILES.manifest, "daily-terminal-run-manifest-v1", artifacts.manifest, issues));
  rows.push(fileEvidence("canary", FILES.canary, "terminal-canary-publish-v1", artifacts.canary, issues));
  rows.push(fileEvidence("controlPlane", FILES.controlPlane, "terminal-control-plane-v1", artifacts.controlPlane, issues));
  rows.push(fileEvidence("policy", FILES.policy, "autonomous-ops-policy-v1", artifacts.policy, issues));
  rows.push(fileEvidence("notificationPlan", FILES.notificationPlan, "autonomous-ops-notification-plan-v1", artifacts.notificationPlan, issues));
  rows.push(fileEvidence("opsStatus", FILES.opsStatus, "terminal-ops-status-v1", artifacts.opsStatus, issues));
  rows.push(fileEvidence("reasonCodeClassifier", FILES.reasonCodeClassifier, "terminal-reason-code-classifier-verifier-v1", artifacts.reasonCodeClassifier, issues));
  rows.push(fileEvidence("protectedReadbackCredential", FILES.protectedReadbackCredential, "protected-readback-credential-v1", artifacts.protectedReadbackCredential, issues));
  return rows;
}

function verifyInvariants(artifacts, issues) {
  const { predictivePreflight, fugleWebSocket, warmupFinal, warmupSelfHeal, waterRoot, orchestrator, rollForward, manifest, canary, controlPlane, policy, notificationPlan, opsStatus, reasonCodeClassifier, protectedReadbackCredential } = artifacts;
  const calendar = marketCalendarRow(artifacts);
  const calendarDate = compactDate(calendar?.marketDate || calendar?.requestedDate || calendar?.displayTradeDate);
  const expectedDate = compactDate(process.env.FUMAN_EXPECTED_DATE || taipeiDateKey());
  const closed = marketClosedMode({ ...artifacts, expectedDate });
  const tradeDate = compactDate(controlPlane?.tradeDate || manifest?.tradeDate || policy?.tradeDate || opsStatus?.tradeDate);
  const displayTradeDate = compactDate(predictivePreflight?.displayTradeDate || waterRoot?.marketCalendar?.row?.displayTradeDate || manifest?.tradeDate);
  const dateFields = {
    market_calendar: calendarDate,
    water_root: compactDate(waterRoot?.expectedDate),
    warmup: compactDate(warmupFinal?.trade_date),
    control_plane: tradeDate,
    manifest: compactDate(manifest?.tradeDate),
    display: displayTradeDate,
  };
  if (calendarDate && calendarDate !== expectedDate) {
    assert(false, issues, "date_hard_gate_mismatch:market_calendar", { expectedDate, actual: calendarDate });
  }
  if (!closed) {
    assert(calendar && (calendar.finalMarketOpen === true || calendar.tradingDayOpen === true || calendar.marketOpen === true || lower(calendar.marketStatus) === "open"), issues, "open_day_missing_explicit_market_calendar_open", { expectedDate, calendar });
  }
  for (const [name, value] of Object.entries(dateFields)) {
    const previousGoodDateAllowed = closed && ["warmup", "display"].includes(name);
    if (!previousGoodDateAllowed && value && value !== expectedDate) assert(false, issues, "date_hard_gate_mismatch:" + name, { expectedDate, actual: value });
  }
  assert(DREAM_LAYERS.length === 21, issues, "dream_layers_incomplete", { layers: DREAM_LAYERS });
  const waterPhaseText = [
    waterRoot?.status,
    waterRoot?.sourceStatus?.row?.payload?.phase,
    waterRoot?.sourceStatus?.row?.message,
    fugleWebSocket?.marketContext?.marketStatus,
    predictivePreflight?.state,
    predictivePreflight?.action,
  ].map(lower).join(" ");
  const afterFormalSourceWindow = !closed && (
    waterPhaseText.includes("after_daytrade_window")
    || waterPhaseText.includes("after_formal_source_window")
    || waterPhaseText.includes("trading_day_after_formal_source_window")
    || waterPhaseText.includes("off_session")
  );
  if (closed || afterFormalSourceWindow) {
    assert(waterRoot?.ok === true, issues, "off_session_water_root_not_ready", { waterRoot });
    assert(waterRoot?.sourceStatus?.row?.payload?.latest_update_allowed !== true, issues, "off_session_latest_update_allowed", { sourceStatus: waterRoot?.sourceStatus });
    assert(waterRoot?.sourceStatus?.row?.payload?.formal_entry_allowed !== true, issues, "off_session_formal_entry_allowed", { sourceStatus: waterRoot?.sourceStatus });
  } else {
    assert(fugleWebSocket?.ok === true, issues, "fugle_websocket_source_layer_not_ready", { fugleWebSocket });
    assert(fugleWebSocket?.stock?.connected === true && fugleWebSocket?.stock?.authenticated === true, issues, "fugle_stock_websocket_not_connected_authenticated", { stock: fugleWebSocket?.stock });
    assert(fugleWebSocket?.futopt?.connected === true && fugleWebSocket?.futopt?.authenticated === true, issues, "fugle_futopt_websocket_not_connected_authenticated", { futopt: fugleWebSocket?.futopt });
  }
  assert(warmupFinal?.summary_type === "daytrade_warmup_unattended_summary_v1", issues, "warmup_final_summary_type_mismatch", { summaryType: warmupFinal?.summary_type });
  assert(warmupFinal?.ops_policy?.self_heal_does_not_count_as_natural === true, issues, "warmup_self_heal_fakes_natural_evidence", { warmupFinal });
  const warmupInvariants = Array.isArray(warmupSelfHeal?.invariants) ? warmupSelfHeal.invariants : [];
  for (const required of [
    "task_missed_never_backfills_natural_evidence",
    "rewater_actions_must_be_idempotent",
    "rewater_must_be_followed_by_verification",
    "self_heal_apply_failure_keeps_unattended_no",
    "success_requires_rewater_verification_not_action_exit_only",
  ]) {
    assert(warmupInvariants.includes(required), issues, `warmup_self_heal_invariant_missing:${required}`, { warmupInvariants });
  }
  const rewaterVerification = Array.isArray(warmupSelfHeal?.rewaterVerification) ? warmupSelfHeal.rewaterVerification : [];
  const rewaterVerificationText = JSON.stringify(rewaterVerification);
  const rewaterJobs = Array.isArray(warmupSelfHeal?.jobs) ? warmupSelfHeal.jobs : [];
  const rewaterVerificationRequired = !closed && (rewaterJobs.length > 0 || warmupSelfHeal?.self_heal_recovered === true || warmupSelfHeal?.natural_success === true);
  if (rewaterVerificationRequired) {
    assert(rewaterVerificationText.includes("verify:daytrade-source-contract-alignment"), issues, "warmup_rewater_source_contract_verification_missing", { rewaterVerification });
    assert(rewaterVerificationText.includes("verify:fugle-websocket-sources"), issues, "warmup_rewater_websocket_verification_missing", { rewaterVerification });
  }
  assert((predictivePreflight?.issues || []).length === 0, issues, "predictive_preflight_has_issues", { issues: predictivePreflight?.issues });
  assert(predictivePreflight?.preservePreviousGood === true || predictivePreflight?.formalScanAllowed === true, issues, "predictive_preflight_no_preserve_or_scan", { predictivePreflight });
  if (closed) {
    assert(predictivePreflight?.formalScanAllowed !== true, issues, "market_closed_formal_scan_allowed", { predictivePreflight });
    assert(predictivePreflight?.publishAllowed !== true, issues, "market_closed_publish_allowed", { predictivePreflight });
    assert(predictivePreflight?.preservePreviousGood === true, issues, "market_closed_not_preserving_previous_good", { predictivePreflight });
    assert(canary?.scorecardPublishAllowed !== true, issues, "market_closed_canary_allows_publish", { canary });
    assert(policy?.decision?.scorecardPublishAllowed !== true, issues, "market_closed_policy_allows_scorecard_publish", { decision: policy?.decision });
  }

  assert(waterRoot && typeof waterRoot.ok === "boolean", issues, "water_root_ok_not_boolean", { waterRootOk: waterRoot?.ok });
  assert(orchestrator?.stateMachineContract?.contract === "terminal-state-machine-v1", issues, "state_machine_contract_missing", { contract: orchestrator?.stateMachineContract });
  const invariants = orchestrator?.stateMachineContract?.invariants || [];
  for (const required of [
    "water_root_must_pass_before_scanner_publish",
    "scanner_receipt_runid_must_equal_supabase_latest_pointer",
    "production_api_desktop_mobile_88_must_share_runid",
    "fallback_or_previous_good_cannot_publish_today_success",
    "auth_blocker_requires_manual_service_token_repair",
    "market_closed_skips_formal_scan_and_preserves_previous_good",
  ]) {
    assert(invariants.includes(required), issues, `state_machine_invariant_missing:${required}`, { invariants });
  }

  const modules = Array.isArray(manifest?.modules) ? manifest.modules : [];
  const moduleKeys = modules.map((row) => row.key).filter(Boolean);
  const manifestActiveModules = Array.isArray(manifest?.activeModules) ? manifest.activeModules : [];
  const registryActiveModules = ACTIVE_MODULE_REGISTRY.active.map((row) => row.key);
  assert(manifest?.moduleRegistryContract === ACTIVE_MODULE_REGISTRY.contract, issues, "manifest_module_registry_contract_mismatch", {
    manifest: manifest?.moduleRegistryContract,
    expected: ACTIVE_MODULE_REGISTRY.contract,
  });
  assert(JSON.stringify([...manifestActiveModules].sort()) === JSON.stringify([...registryActiveModules].sort()), issues, "manifest_active_module_registry_mismatch", {
    manifest: manifestActiveModules,
    expected: registryActiveModules,
  });
  assert(Array.isArray(manifest?.retiredModules), issues, "manifest_retired_modules_missing", {});
  assert(Boolean(manifest?.dailyRunId), issues, "manifest_dailyRunId_missing", {});
  assert(Boolean(manifest?.sourceGrade), issues, "manifest_sourceGrade_missing", {});
  assert(manifest?.moduleStatuses && typeof manifest.moduleStatuses === "object", issues, "manifest_moduleStatuses_missing", {});
  for (const field of ["natural0700", "natural0845", "natural0900", "finalDecision"]) {
    assert(field in (manifest || {}), issues, `manifest_${field}_missing`, {});
  }
  const allowedModuleStatuses = new Set(["complete", "empty", "blocked", "degraded", "0-result", "pending"]);
  for (const row of modules) {
    assert(allowedModuleStatuses.has(String(row.moduleStatus || "")), issues, `manifest_module_status_invalid:${row.key || "unknown"}`, { moduleStatus: row.moduleStatus });
    assert(manifest.moduleStatuses?.[row.key] === row.moduleStatus, issues, `manifest_module_status_mismatch:${row.key || "unknown"}`, { manifest: manifest.moduleStatuses?.[row.key], row: row.moduleStatus });
  }
  assert(manifest?.warmupEvidence && typeof manifest.warmupEvidence === "object", issues, "manifest_warmup_evidence_missing", {});
  assert(manifest?.warmupEvidence?.dateAligned === true || closed, issues, "manifest_warmup_date_not_aligned", { warmupEvidence: manifest?.warmupEvidence });
  for (const phase of ["0700", "0845", "0900"]) {
    assert(manifest?.naturalScheduleEvidenceByPhase?.[phase] === true || closed, issues, `manifest_natural_evidence_missing:${phase}`, { naturalScheduleEvidenceByPhase: manifest?.naturalScheduleEvidenceByPhase });
  }
  for (const key of REQUIRED_ACTIVE_MODULES) {
    assert(moduleKeys.includes(key), issues, `manifest_active_module_missing:${key}`, { moduleKeys });
  }
  const previousGoodHoldClosure = manifestPreviousGoodHoldClosure(manifest, modules);
  const closedDaySafeHold = closedDaySafeHoldManifest(manifest, closed);
  const completionClosed = closed || previousGoodHoldClosure || closedDaySafeHold;
  const protectedReadbackDisplayOnly = protectedReadbackDisplayOnlyBlocker({ protectedReadbackCredential, opsStatus });
  const blockerText = String(manifest?.blocker || controlPlane?.decision?.reason || "").toLowerCase();
  const hardBlockedModules = modules.filter((row) => row.ok !== true && row.pendingNotDue !== true);
  const pendingNotDue = blockerText.includes("pending_not_due") && hardBlockedModules.length === 0;
  if (pendingNotDue) {
    assert(false, issues, "manifest_pending_not_due", { blocker: manifest?.blocker || controlPlane?.decision?.reason || "pending_not_due" });
  } else {
    for (const row of hardBlockedModules) assert(false, issues, `manifest_module_blocked:${row.key}`, { issues: row.issues || [], runId: row.runId || "", tradeDate: row.tradeDate || "", sourceDate: row.sourceDate || "" });
    assert(acceptableCompletionStatus(manifest?.unattendedStatus, completionClosed), issues, "manifest_not_fresh_yes_or_previous_good_hold", { unattendedStatus: manifest?.unattendedStatus, blocker: manifest?.blocker, closed });
    assert(manifest?.ok === true || closedDaySafeHold, issues, "manifest_not_ok", { ok: manifest?.ok, blocker: manifest?.blocker, closedDaySafeHold });
  }
  const jobQueue = Array.isArray(orchestrator?.jobQueue) ? orchestrator.jobQueue : [];
  for (const job of jobQueue) {
    assert(Boolean(job.idempotencyKey), issues, "job_missing_idempotency_key", job);
    assert(Boolean(job.retryPolicy), issues, "job_missing_retry_policy", job);
    if (String(job.state || "").includes("AUTH")) {
      assert(job.retryPolicy?.maxAttempts === 0 && job.retryPolicy?.manualRepairRequired === true, issues, "auth_job_may_auto_retry", job);
    }
  }
  assert(rollForward?.idempotencyContract?.contract === "terminal-idempotent-runner-v1", issues, "idempotency_contract_missing", { idempotencyContract: rollForward?.idempotencyContract });
  assert((rollForward?.idempotencyContract?.invariants || []).includes("scanner_jobs_require_water_root_and_apply_scanners"), issues, "idempotency_scanner_water_gate_missing", { idempotencyContract: rollForward?.idempotencyContract });
  assert((rollForward?.idempotencyContract?.invariants || []).includes("scanner_jobs_require_current_water_root_ok"), issues, "idempotency_scanner_current_water_root_gate_missing", { idempotencyContract: rollForward?.idempotencyContract });
  assert((rollForward?.idempotencyContract?.invariants || []).includes("publish_jobs_require_manifest_canary_gate"), issues, "idempotency_publish_canary_gate_missing", { idempotencyContract: rollForward?.idempotencyContract });

  if (!pendingNotDue && !closed) {
    assert(controlPlane?.runIdClosure?.ok === true, issues, "control_plane_runid_closure_not_ok", { runIdClosure: controlPlane?.runIdClosure });
    assert(acceptableCompletionStatus(controlPlane?.decision?.unattendedStatus, completionClosed), issues, "control_plane_not_fresh_yes_or_previous_good_hold", { decision: controlPlane?.decision, closed });
  }
  assert(policy?.actionMatrix?.contract === "autonomous-ops-action-matrix-v1", issues, "action_matrix_missing", { actionMatrix: policy?.actionMatrix });
  const protectedInvariants = policy?.actionMatrix?.protectedInvariants || [];
  for (const required of [
    "membership_auth_only_gates_display_not_scanner_compute",
    "fallback_or_previous_good_never_counts_as_today_publish_success",
    "scorecard_publish_requires_manifest_green",
    "zero_result_complete_is_success_empty_source_is_not",
  ]) {
    assert(protectedInvariants.includes(required), issues, `action_matrix_invariant_missing:${required}`, { protectedInvariants });
  }

  assert(protectedReadbackCredential?.contract === "protected-readback-credential-v1", issues, "protected_readback_credential_contract_missing", { protectedReadbackCredential });
  if (!closed && !pendingNotDue && !protectedReadbackDisplayOnly) assert(protectedReadbackCredential?.ok === true, issues, "protected_readback_credential_not_ok", { failures: protectedReadbackCredential?.failures || [], auth: protectedReadbackCredential?.auth || {} });

  assert(notificationPlan?.ok === true, issues, "notification_plan_not_ok", { notificationPlan });
  assert(typeof notificationPlan?.notification?.required === "boolean", issues, "notification_required_not_boolean", { notification: notificationPlan?.notification });
  assert(Boolean(notificationPlan?.notification?.dedupeKey), issues, "notification_dedupe_key_missing", { notification: notificationPlan?.notification });

  assert(reasonCodeClassifier?.contract === "terminal-reason-code-classifier-verifier-v1", issues, "reason_code_classifier_contract_missing", { reasonCodeClassifier });
  assert(reasonCodeClassifier?.ok === true, issues, "reason_code_classifier_not_ok", { unknownEntries: reasonCodeClassifier?.unknownEntries, failures: reasonCodeClassifier?.failures || [] });
  assert(Number(reasonCodeClassifier?.unknownEntries || 0) === 0, issues, "reason_code_classifier_unknown_entries", { unknownEntries: reasonCodeClassifier?.unknownEntries });
  assert(opsStatus?.reasonCodeSummary?.contract === "terminal-reason-code-summary-v1", issues, "ops_status_reason_code_summary_missing", { reasonCodeSummary: opsStatus?.reasonCodeSummary });
  assert(opsStatus?.reasonCodeSummary?.ok === true && Number(opsStatus?.reasonCodeSummary?.unknownEntries || 0) === 0, issues, "ops_status_reason_code_summary_not_ok", { reasonCodeSummary: opsStatus?.reasonCodeSummary });
  assert(Object.keys(opsStatus?.reasonCodeSummary?.codes || {}).length > 0, issues, "ops_status_reason_codes_missing", { reasonCodeSummary: opsStatus?.reasonCodeSummary });
  assert(opsStatus?.rootCauseSummary?.contract === "production-readiness-root-cause-summary-v1", issues, "ops_status_root_cause_summary_missing", { rootCauseSummary: opsStatus?.rootCauseSummary });
  assert(opsStatus?.rootCauseSummary?.ok === true && Number(opsStatus?.rootCauseSummary?.unknownBlockers || 0) === 0, issues, "ops_status_root_cause_summary_not_ok", { rootCauseSummary: opsStatus?.rootCauseSummary });
  assert(Array.isArray(opsStatus?.rootCauseSummary?.categories) && opsStatus.rootCauseSummary.categories.length > 0, issues, "ops_status_root_cause_summary_categories_missing", { rootCauseSummary: opsStatus?.rootCauseSummary });
  assert(opsStatus?.rootCauseRecoveryPlan?.contract === "production-readiness-root-cause-recovery-plan-v1", issues, "ops_status_root_cause_recovery_plan_missing", { rootCauseRecoveryPlan: opsStatus?.rootCauseRecoveryPlan });
  assert(Array.isArray(opsStatus?.rootCauseRecoveryPlan?.steps) && opsStatus.rootCauseRecoveryPlan.steps.length > 0, issues, "ops_status_root_cause_recovery_plan_steps_missing", { rootCauseRecoveryPlan: opsStatus?.rootCauseRecoveryPlan });
  const recoveryCategories = new Set((opsStatus?.rootCauseRecoveryPlan?.steps || []).map((row) => row.category));
  for (const row of opsStatus?.rootCauseSummary?.categories || []) assert(recoveryCategories.has(row.category), issues, `ops_status_root_cause_recovery_plan_missing_category:${row.category}`, { rootCauseRecoveryPlan: opsStatus?.rootCauseRecoveryPlan });
  const authRecoveryStep = (opsStatus?.rootCauseRecoveryPlan?.steps || []).find((row) => row.category === "auth_readback");
  if (authRecoveryStep) assert(authRecoveryStep.canAutoExecute === false && authRecoveryStep.canExecuteNow === false && authRecoveryStep.automation === "manual_secret", issues, "ops_status_auth_recovery_must_be_manual", { authRecoveryStep });
  for (const row of opsStatus?.rootCauseRecoveryPlan?.steps || []) {
    assert(typeof row.canExecuteNow === "boolean", issues, "ops_status_root_cause_recovery_execute_now_missing:" + (row.category || "unknown"), { row });
    assert(Array.isArray(row.blockedBy), issues, "ops_status_root_cause_recovery_blocked_by_missing:" + (row.category || "unknown"), { row });
    if (row.canExecuteNow === true) assert(row.canAutoExecute === true, issues, "ops_status_root_cause_recovery_execute_now_without_auto:" + (row.category || "unknown"), { row });
  }

  if (!pendingNotDue) assert(acceptableCompletionStatus(opsStatus?.unattendedStatus, completionClosed), issues, "ops_status_not_fresh_yes_or_previous_good_hold", { unattendedStatus: opsStatus?.unattendedStatus, reason: opsStatus?.reason, closed });
  assert(opsStatus?.gates?.predictivePreflight?.status, issues, "ops_status_predictive_gate_missing", { gates: opsStatus?.gates });
  assert(opsStatus?.gates?.notificationPolicy?.status, issues, "ops_status_notification_gate_missing", { gates: opsStatus?.gates });
  assert((opsStatus?.actionMatrix?.protectedInvariants || []).includes("membership_auth_only_gates_display_not_scanner_compute"), issues, "ops_status_membership_invariant_missing", { actionMatrix: opsStatus?.actionMatrix });
  assert(Array.isArray(opsStatus?.modules) && opsStatus.modules.length >= REQUIRED_ACTIVE_MODULES.length, issues, "ops_status_modules_missing", { modules: opsStatus?.modules?.length || 0 });

  return { closed, tradeDate, displayTradeDate, activeModules: moduleKeys, jobQueueLength: jobQueue.length };
}

function markdown(payload) {
  const lines = [];
  lines.push("# Terminal Autonomous Completion Audit");
  lines.push("");
  lines.push(`- checkedAt: ${payload.checkedAt}`);
  lines.push(`- ok: ${payload.ok}`);
  lines.push(`- tradeDate: ${payload.summary.tradeDate || "--"}`);
  lines.push(`- displayTradeDate: ${payload.summary.displayTradeDate || "--"}`);
  lines.push(`- marketClosedMode: ${payload.summary.closed}`);
  lines.push(`- issues: ${payload.issues.map((row) => row.issue).join("; ") || "none"}`);
  lines.push("");
  lines.push("## Dream Layers");
  lines.push("| layer | artifact / verifier evidence |");
  lines.push("|---|---|");
  for (const layer of payload.layers) lines.push(`| ${layer.layer} | ${layer.evidence} |`);
  lines.push("");
  lines.push("## Artifact Evidence");
  lines.push("| artifact | ok | contract | evidence | file |");
  lines.push("|---|---:|---|---|---|");
  for (const row of payload.artifacts) lines.push(`| ${row.name} | ${row.ok} | ${row.contract || "--"} | ${row.summary.replace(/\|/g, "/")} | ${row.file} |`);
  lines.push("");
  lines.push("## Live Schedule Readback");
  lines.push(`- ok: ${payload.liveSchedule?.ok}`);
  lines.push(`- exitCode: ${payload.liveSchedule?.exitCode ?? "--"}`);
  lines.push(`- issues: ${(payload.liveSchedule?.issues || []).join(",") || "none"}`);
  lines.push("");  lines.push("## Package Wiring");
  lines.push("| script | wired | command |");
  lines.push("|---|---:|---|");
  for (const row of payload.packageScripts) lines.push(`| ${row.name} | ${row.ok} | ${(row.command || "--").replace(/\|/g, "/")} |`);
  return `${lines.join("\n")}\n`;
}

async function main() {
  const issues = [];
  const pkg = readPackage();
  const artifacts = Object.fromEntries(Object.entries(FILES).map(([key, file]) => [key, readJson(file, null)]));
  const packageScripts = verifyPackageScripts(pkg, issues);
  const liveSchedule = verifyLiveSchedule(issues);
  const artifactRows = verifyArtifacts(artifacts, issues);
  const summary = verifyInvariants(artifacts, issues);
  const layers = [
    { layer: "Market Calendar", evidence: "terminal-predictive-preflight + terminal-water-root marketCalendar rows decide trading day/source window" },
    { layer: "Active Module Registry", evidence: "terminal-active-module-registry-v1 defines active modules and retired modules before scan/publish" },
    { layer: "Single Daily Orchestrator Lock", evidence: "terminal-orchestrator-lock-v1 prevents overlapping autonomous controller runs" },
    { layer: "Predictive Preflight", evidence: "terminal-predictive-preflight artifact + package root gate + fail-closed date/market-calendar invariants" },
    { layer: "Fugle WebSocket Source Layer", evidence: "fugle-websocket-source-readiness-v1 stock/futopt connected/authenticated/streaming with conservative speed policy" },
    { layer: "Water Root", evidence: "terminal-water-root artifact + market calendar + Fugle/Supabase/source status probes" },
    { layer: "Warmup Phase State Machine", evidence: "daytrade-warmup-unattended final verdict phases 0700/0845/0900 and schedule self-heal contract" },
    { layer: "0700 / 0845 / 0900 Natural Evidence", evidence: "warmup final verdict requires natural evidence; self-heal cannot backfill natural success" },
    { layer: "Reason Code Classifier", evidence: "terminal-reason-code-classifier-verifier-v1 plus opsStatus.reasonCodeSummary/rootCauseSummary prove every blocker has a stable reason code, root cause, action/layer and unknownEntries=0" },
    { layer: "Self-Heal Job Queue", evidence: "daytrade-warmup-self-heal-runner-v1 and terminal orchestrator jobQueue produce idempotent recovery plans" },
    { layer: "Idempotent Rewater Runner", evidence: "daytrade warmup self-heal plan has no fake natural evidence and uses rewater commands only under apply" },
    { layer: "Re-Water Verification", evidence: "self-heal rewaterVerification plus verify:daytrade-source-contract-alignment / daytrade warmup root" },
    { layer: "Formal Entry Gate", evidence: "strategy-scan-formal-gate contract and run-full-scan warmup/formal guard before scanner publish" },
    { layer: "Strategy Scan State Machine", evidence: "terminal-orchestrator-state lifecycle/failure/invariants" },
    { layer: "Idempotent Scanners", evidence: "terminal-auto-roll-forward idempotencyContract; scanner jobs require current Water Root PASS and --apply-scanners" },
    { layer: "Daily Manifest", evidence: "daily-terminal-run-manifest-v1 active module rows and unattended YES / previous-good hold support" },
    { layer: "Canary Publish", evidence: "terminal-canary-publish-v1 + manifest-publish-wiring-v1; scorecard publish paths require manifest/canary gates" },
    { layer: "RunId Closure", evidence: "terminal-runid-closure-contract-v1 validates scanner/latest/API/Desktop/Mobile/88 runId equality" },
    { layer: "Scorecard / Desktop / Mobile / 88 Closure", evidence: "terminal-resource-chain:unattended + protected-readback-credential-v1 + runIdClosure resource rows including authenticated /88 readback" },
    { layer: "Auto Roll Forward", evidence: "terminal-auto-roll-forward decision and queue plan" },
    { layer: "Control Plane", evidence: "terminal-control-plane-v1 final decision state/action/reason" },
    { layer: "Autonomous Ops Policy", evidence: "autonomous-ops-policy-v1 + action matrix protected invariants" },
    { layer: "Unattended YES / NO Final Audit", evidence: "terminal-autonomous-completion-audit-v1 and production unattended readiness report" },
  ];

  const payload = {
    contract: "terminal-autonomous-completion-audit-v1",
    checkedAt: new Date().toISOString(),
    ok: issues.length === 0,
    operationalOk: issues.length === 0,
    businessUnattendedYes: summary.closed !== true
      && issues.length === 0
      && artifacts.controlPlane?.decision?.unattendedStatus === "YES",
    finalDecision: summary.closed === true
      ? "MARKET_CLOSED_PRESERVE_PREVIOUS_GOOD"
      : (issues.length === 0 && artifacts.controlPlane?.decision?.unattendedStatus === "YES" ? "UNATTENDED_YES" : "FAIL_CLOSED"),
    summary,
    layers,
    artifacts: artifactRows,
    packageScripts,
    issues,
  };
  await fs.promises.mkdir(OUT_DIR, { recursive: true });
  const jsonFile = path.join(OUT_DIR, "terminal-autonomous-completion-audit.json");
  const mdFile = path.join(OUT_DIR, "terminal-autonomous-completion-audit.md");
  await fs.promises.writeFile(jsonFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.promises.writeFile(mdFile, markdown(payload), "utf8");
  console.log(JSON.stringify({
    ok: payload.ok,
    contract: payload.contract,
    tradeDate: summary.tradeDate,
    displayTradeDate: summary.displayTradeDate,
    marketClosedMode: summary.closed,
    operationalOk: payload.operationalOk,
    businessUnattendedYes: payload.businessUnattendedYes,
    finalDecision: payload.finalDecision,
    issues: issues.map((row) => row.issue),
    output: jsonFile,
  }, null, 2));
  if (!payload.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[terminal-autonomous-completion-audit] failed: ${error.stack || error.message || error}`);
  process.exit(1);
});

