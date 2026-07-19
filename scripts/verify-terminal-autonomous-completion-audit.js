"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "outputs", "terminal-autonomous-completion-audit");
const REQUIRED_ACTIVE_MODULES = ["strategy2", "strategy3", "strategy4", "strategy5", "institution", "cb", "warrant"];

const FILES = {
  predictivePreflight: path.join(ROOT, "outputs", "terminal-predictive-preflight", "terminal-predictive-preflight.json"),
  waterRoot: path.join(ROOT, "outputs", "terminal-water-root", "terminal-water-root.json"),
  orchestrator: path.join(ROOT, "outputs", "terminal-orchestrator", "terminal-orchestrator-state.json"),
  rollForward: path.join(ROOT, "outputs", "terminal-roll-forward", "terminal-auto-roll-forward.json"),
  manifest: path.join(ROOT, "outputs", "daily-terminal-run", "daily-terminal-run-latest.json"),
  canary: path.join(ROOT, "outputs", "terminal-canary-publish", "terminal-canary-publish.json"),
  controlPlane: path.join(ROOT, "outputs", "terminal-control-plane", "terminal-control-plane.json"),
  policy: path.join(ROOT, "outputs", "autonomous-ops-policy", "autonomous-ops-policy.json"),
  notificationPlan: path.join(ROOT, "outputs", "autonomous-ops-notification", "autonomous-ops-notification-plan.json"),
  opsStatus: path.join(ROOT, "data", "terminal-ops-status-latest.json"),
};

const REQUIRED_SCRIPTS = [
  "ops:predictive-preflight",
  "verify:terminal-predictive-preflight",
  "verify:terminal-water-root",
  "verify:terminal-water-root-contract",
  "orchestrator:state",
  "orchestrator:state:from-existing",
  "verify:terminal-state-machine-contract",
  "verify:terminal-auto-roll-forward",
  "verify:terminal-idempotent-runner",
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
  "ops:production-unattended-readiness-report",
  "verify:production-unattended-readiness-report",
];

const DREAM_LAYERS = [
  "Predictive Preflight",
  "Water Root",
  "State Machine",
  "Job Queue",
  "Idempotent Scanners",
  "Daily Manifest",
  "Canary Publish",
  "RunId Closure",
  "Auto Roll Forward",
  "Control Plane",
  "Autonomous Ops Policy",
  "Notification Policy",
  "Ops Status API",
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
  if (name === "waterRoot") return `ok=${payload.ok}; status=${payload.status || payload.waterStatus || payload.reason || "--"}; reason=${payload.reason || "--"}`;
  if (name === "orchestrator") return `overallState=${payload.overallState || "--"}; modules=${Array.isArray(payload.modules) ? payload.modules.length : 0}; jobs=${Array.isArray(payload.jobQueue) ? payload.jobQueue.length : 0}`;
  if (name === "rollForward") return `mode=${payload.mode || "--"}; jobs=${payload.jobs}; decision=${payload.decision?.state || "--"}`;
  if (name === "manifest") return `tradeDate=${payload.tradeDate || "--"}; ok=${payload.ok}; unattended=${payload.unattendedStatus}; modules=${Array.isArray(payload.modules) ? payload.modules.length : 0}`;
  if (name === "canary") return `status=${payload.status || "--"}; scorecardPublishAllowed=${payload.scorecardPublishAllowed}; marketClosedPreviousGood=${payload.marketClosedPreviousGood}`;
  if (name === "controlPlane") return `state=${payload.decision?.state || "--"}; unattended=${payload.decision?.unattendedStatus || "--"}; tradeDate=${payload.tradeDate || "--"}`;
  if (name === "policy") return `opsState=${payload.decision?.opsState || "--"}; unattended=${payload.decision?.unattendedStatus || "--"}; action=${payload.decision?.action || "--"}`;
  if (name === "notificationPlan") return `required=${payload.notification?.required}; sendAllowed=${payload.notification?.sendAllowed}; kind=${payload.notification?.kind || "--"}`;
  if (name === "opsStatus") return `state=${payload.state || "--"}; unattended=${payload.unattendedStatus || "--"}; modules=${Array.isArray(payload.modules) ? payload.modules.length : 0}`;
  return `contract=${payload.contract || "--"}`;
}

function marketClosedMode({ predictivePreflight, policy, manifest, controlPlane }) {
  const bits = [
    predictivePreflight?.state,
    predictivePreflight?.action,
    policy?.decision?.opsState,
    manifest?.waterRoot?.status,
    manifest?.blocker,
    controlPlane?.decision?.state,
  ].map(lower).join(" ");
  return bits.includes("market_closed") || bits.includes("skip_formal_scan");
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
    "verify:terminal-water-root",
    "verify:terminal-water-root-contract",
    "verify:terminal-control-plane",
    "verify:terminal-state-machine-contract",
    "verify:terminal-auto-roll-forward",
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
  rows.push(fileEvidence("waterRoot", FILES.waterRoot, null, artifacts.waterRoot, issues));
  rows.push(fileEvidence("orchestrator", FILES.orchestrator, "terminal-orchestrator-state-v1", artifacts.orchestrator, issues));
  rows.push(fileEvidence("rollForward", FILES.rollForward, "terminal-auto-roll-forward-v1", artifacts.rollForward, issues));
  rows.push(fileEvidence("manifest", FILES.manifest, "daily-terminal-run-manifest-v1", artifacts.manifest, issues));
  rows.push(fileEvidence("canary", FILES.canary, "terminal-canary-publish-v1", artifacts.canary, issues));
  rows.push(fileEvidence("controlPlane", FILES.controlPlane, "terminal-control-plane-v1", artifacts.controlPlane, issues));
  rows.push(fileEvidence("policy", FILES.policy, "autonomous-ops-policy-v1", artifacts.policy, issues));
  rows.push(fileEvidence("notificationPlan", FILES.notificationPlan, "autonomous-ops-notification-plan-v1", artifacts.notificationPlan, issues));
  rows.push(fileEvidence("opsStatus", FILES.opsStatus, "terminal-ops-status-v1", artifacts.opsStatus, issues));
  return rows;
}

function verifyInvariants(artifacts, issues) {
  const { predictivePreflight, waterRoot, orchestrator, rollForward, manifest, canary, controlPlane, policy, notificationPlan, opsStatus } = artifacts;
  const closed = marketClosedMode(artifacts);
  const tradeDate = compactDate(controlPlane?.tradeDate || manifest?.tradeDate || policy?.tradeDate || opsStatus?.tradeDate);
  const displayTradeDate = compactDate(predictivePreflight?.displayTradeDate || waterRoot?.marketCalendar?.row?.displayTradeDate || manifest?.tradeDate);

  assert(DREAM_LAYERS.length >= 11, issues, "dream_layers_incomplete", { layers: DREAM_LAYERS });
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
  for (const key of REQUIRED_ACTIVE_MODULES) {
    assert(moduleKeys.includes(key), issues, `manifest_active_module_missing:${key}`, { moduleKeys });
  }
  assert(acceptableCompletionStatus(manifest?.unattendedStatus, closed), issues, "manifest_not_fresh_yes_or_previous_good_hold", { unattendedStatus: manifest?.unattendedStatus, blocker: manifest?.blocker, closed });
  assert(manifest?.ok === true, issues, "manifest_not_ok", { ok: manifest?.ok, blocker: manifest?.blocker });

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
  assert((rollForward?.idempotencyContract?.invariants || []).includes("publish_jobs_require_manifest_canary_gate"), issues, "idempotency_publish_canary_gate_missing", { idempotencyContract: rollForward?.idempotencyContract });

  assert(controlPlane?.runIdClosure?.ok === true, issues, "control_plane_runid_closure_not_ok", { runIdClosure: controlPlane?.runIdClosure });
  assert(acceptableCompletionStatus(controlPlane?.decision?.unattendedStatus, closed), issues, "control_plane_not_fresh_yes_or_previous_good_hold", { decision: controlPlane?.decision, closed });
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

  assert(notificationPlan?.ok === true, issues, "notification_plan_not_ok", { notificationPlan });
  assert(typeof notificationPlan?.notification?.required === "boolean", issues, "notification_required_not_boolean", { notification: notificationPlan?.notification });
  assert(Boolean(notificationPlan?.notification?.dedupeKey), issues, "notification_dedupe_key_missing", { notification: notificationPlan?.notification });

  assert(acceptableCompletionStatus(opsStatus?.unattendedStatus, closed), issues, "ops_status_not_fresh_yes_or_previous_good_hold", { unattendedStatus: opsStatus?.unattendedStatus, reason: opsStatus?.reason, closed });
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
  lines.push("## Package Wiring");
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
  const artifactRows = verifyArtifacts(artifacts, issues);
  const summary = verifyInvariants(artifacts, issues);
  const layers = [
    { layer: "Predictive Preflight", evidence: "terminal-predictive-preflight artifact + package root gate + fail-closed date/market-calendar invariants" },
    { layer: "Water Root", evidence: "terminal-water-root artifact + market calendar + Fugle/Supabase/source status probes" },
    { layer: "State Machine", evidence: "terminal-orchestrator-state stateMachineContract lifecycle/failure/invariants" },
    { layer: "Job Queue", evidence: "terminal-job-queue / orchestrator jobQueue with idempotency keys and retry policies" },
    { layer: "Idempotent Scanners", evidence: "terminal-auto-roll-forward idempotencyContract; scanner jobs require water root and --apply-scanners" },
    { layer: "Daily Manifest", evidence: "daily-terminal-run-manifest-v1 active module rows and unattended YES / market-closed previous-good support" },
    { layer: "Canary Publish", evidence: "terminal-canary-publish-v1 + manifest-publish-wiring-v1; scorecard publish paths require manifest/canary gates and block market-closed publish" },
    { layer: "RunId Closure", evidence: "terminal-control-plane runIdClosure requires API/Desktop/Mobile/88 same runId" },
    { layer: "Auto Roll Forward", evidence: "terminal-auto-roll-forward decision and queue plan" },
    { layer: "Control Plane", evidence: "terminal-control-plane-v1 final decision state/action/reason" },
    { layer: "Autonomous Ops Policy", evidence: "autonomous-ops-policy-v1 + action matrix protected invariants" },
    { layer: "Notification Policy", evidence: "autonomous-ops-notification-plan-v1 with dedupeKey and required/sendAllowed contract" },
    { layer: "Ops Status API", evidence: "terminal-ops-status-latest + API verifier membership protection invariant" },
  ];

  const payload = {
    contract: "terminal-autonomous-completion-audit-v1",
    checkedAt: new Date().toISOString(),
    ok: issues.length === 0,
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
    issues: issues.map((row) => row.issue),
    output: jsonFile,
  }, null, 2));
  if (!payload.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[terminal-autonomous-completion-audit] failed: ${error.stack || error.message || error}`);
  process.exit(1);
});

