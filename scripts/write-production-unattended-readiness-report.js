"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "outputs", "production-unattended-readiness");

const FILES = {
  waterRoot: path.join(ROOT, "outputs", "terminal-water-root", "terminal-water-root.json"),
  resourceChain: path.join(ROOT, "outputs", "terminal-resource-chain-audit", "terminal-resource-chain-audit.json"),
  manifest: path.join(ROOT, "outputs", "daily-terminal-run", "daily-terminal-run-latest.json"),
  productionLive: path.join(ROOT, "outputs", "terminal-ops-production-live", "terminal-ops-production-live-readback.json"),
  protectedReadbackCredential: path.join(ROOT, "outputs", "protected-readback-credential", "protected-readback-credential.json"),
  serviceTokenSchedule: path.join(ROOT, "outputs", "backend-service-token-schedule-contract", "backend-service-token-schedule-contract.json"),
  rollForward: path.join(ROOT, "outputs", "terminal-roll-forward", "terminal-auto-roll-forward.json"),
  predictivePreflight: path.join(ROOT, "outputs", "terminal-predictive-preflight", "terminal-predictive-preflight.json"),
  orchestrator: path.join(ROOT, "outputs", "terminal-orchestrator", "terminal-orchestrator-state.json"),
  controlPlane: path.join(ROOT, "outputs", "terminal-control-plane", "terminal-control-plane.json"),
  policy: path.join(ROOT, "outputs", "autonomous-ops-policy", "autonomous-ops-policy.json"),
  finalAudit: path.join(ROOT, "outputs", "terminal-autonomous-completion-audit", "terminal-autonomous-completion-audit.json"),
  reasonCodeClassifier: path.join(ROOT, "outputs", "terminal-reason-code-classifier", "terminal-reason-code-classifier.json"),
};

const REQUIRED_SECTIONS = [
  "releaseIdentity",
  "waterRoot",
  "resourceChain",
  "dailyManifest",
  "productionLiveOpsReadback",
  "windowsTaskAndServiceTokenAudit",
  "autoRollForward",
  "reasonCodeClassifier",
  "finalAudit",
  "blockers",
  "rootCauseSummary",
  "rootCauseRecoveryPlan",
  "productionLivePasses",
  "nonProductionOrPreviousGoodPasses",
  "nextTradingDayRunbook",
  "remainingConditionsBeforeFreshUnattendedYes",
];

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function sh(args, fallback = "") {
  try {
    return execFileSync(args[0], args.slice(1), { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return fallback;
  }
}

function runNodeScript(script, args = []) {
  execFileSync(process.execPath, ["--use-system-ca", script, ...args], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
}

function runNodeScriptBestEffort(script, args = [], step = script) {
  try {
    runNodeScript(script, args);
    return null;
  } catch (error) {
    return {
      step,
      command: `node --use-system-ca ${script}${args.length ? ` ${args.join(" ")}` : ""}`,
      message: String(error.message || error).slice(0, 500),
    };
  }
}

function compactDate(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function safe(value, fallback = "") {
  return value === undefined || value === null ? fallback : value;
}

function fileExists(file) {
  return fs.existsSync(file);
}

function issue(issues, code, details = {}) {
  issues.push({ code, details });
}

function formatIssue(row) {
  if (typeof row === "string") return row;
  if (!row || typeof row !== "object") return String(row || "");
  const code = row.issue || row.code || row.name || row.reason || row.error || "unknown_issue";
  const details = row.details && typeof row.details === "object" ? JSON.stringify(row.details) : (row.details || "");
  return details ? `${code}:${details}` : String(code);
}
function summarizeEndpoint(row = {}) {
  return {
    name: row.name || "",
    path: row.path || "",
    status: safe(row.status, ""),
    mode: row.mode || "",
    protected: row.protected === true,
    ok: row.ok === true,
    artifactVersion: row.artifactVersion || "",
    error: row.error || "",
    reason: row.reason || "",
  };
}

function buildReleaseIdentity(productionLive) {
  const branch = sh(["git", "branch", "--show-current"]);
  const headSha = sh(["git", "rev-parse", "HEAD"]);
  const originSha = sh(["git", "rev-parse", "origin/main"]);
  const status = sh(["git", "status", "--short"]);
  const release = productionLive?.release || {};
  return {
    branch,
    headSha,
    originMainSha: originSha,
    worktreeClean: status.length === 0,
    deploymentUrl: productionLive?.baseUrl || "https://fuman-terminal.vercel.app",
    releaseSha: productionLive?.releaseSha || release.gitSha || "",
    deployId: release.deployId || "",
    deploymentPreviewUrl: release.deploymentUrl || "",
    releaseBranch: release.branch || "",
  };
}

function buildWaterRoot(waterRoot) {
  const sourceProbe = (waterRoot?.sourceStatus && typeof waterRoot.sourceStatus === "object")
    ? waterRoot.sourceStatus
    : (waterRoot?.probes || []).find((probe) => probe?.name === "source_status") || {};
  const sourceRow = sourceProbe?.row || sourceProbe;
  const sourcePayload = sourceRow?.payload || {};
  const canonicalProbe = (waterRoot?.canonicalGate && typeof waterRoot.canonicalGate === "object")
    ? waterRoot.canonicalGate
    : (waterRoot?.probes || []).find((probe) => probe?.name === "canonical_gate") || {};
  const canonicalRow = canonicalProbe?.row || canonicalProbe;
  return {
    command: "npm run verify:terminal-water-root",
    artifact: FILES.waterRoot,
    exists: fileExists(FILES.waterRoot),
    ok: waterRoot?.ok === true,
    status: waterRoot?.status || "",
    reason: waterRoot?.reason || "",
    expectedDate: waterRoot?.expectedDate || "",
    marketOpen: waterRoot?.marketCalendar?.row?.marketOpen === true,
    marketStatus: waterRoot?.marketCalendar?.row?.marketStatus || "",
    displayTradeDate: waterRoot?.marketCalendar?.row?.displayTradeDate || "",
    formalScanSkipped: waterRoot?.marketCalendar?.row?.formalScanSkipped === true,
    preservePreviousGood: waterRoot?.marketCalendar?.row?.preservePreviousGood === true,
    sourceStatus: sourceRow?.status || (typeof waterRoot?.sourceStatus === "string" ? waterRoot.sourceStatus : ""),
    sourceMessage: sourceRow?.message || "",
    sourceGate: waterRoot?.gate || canonicalRow?.canonical_gate_grade || canonicalRow?.gate || sourcePayload?.daytrade_gate_grade || "",
    sourcePhase: sourcePayload?.phase || canonicalRow?.phase || "",
    formalEntryAllowed: sourcePayload?.formal_entry_allowed === true || canonicalRow?.formal_entry_allowed === true,
    scannerCanRunOpening: sourcePayload?.scanner_can_run_opening === true || canonicalRow?.scanner_can_run_opening === true,
    priorityFreshQuoteCoverage120s: waterRoot?.priorityFreshQuoteCoverage120s ?? sourcePayload?.priority_fresh_quote_coverage_120s ?? canonicalRow?.priority_fresh_quote_coverage_120s ?? "",
    quoteAgeSeconds: waterRoot?.quoteAgeSeconds ?? sourcePayload?.quote_age_seconds ?? canonicalRow?.quote_age_seconds ?? "",
    intraday1mStaleSeconds: waterRoot?.intraday1mStaleSeconds ?? sourcePayload?.intraday_1m_stale_seconds ?? "",
    dailyVolumeStatus: sourcePayload?.daily_volume_status || "",
    priorityPoolSymbols: sourcePayload?.priority_pool_symbols ?? "",
    motherPoolSymbols: sourcePayload?.mother_pool_symbols ?? "",
  };
}

function endpointRunId(row = {}, ...paths) {
  for (const path of paths) {
    const value = path.split(".").reduce((current, key) => current?.[key], row);
    if (value) return value;
  }
  return "";
}

function endpointStatus(row = {}, ...paths) {
  for (const path of paths) {
    const value = path.split(".").reduce((current, key) => current?.[key], row);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

function buildResourceChain(resourceChain) {
  const rows = Array.isArray(resourceChain?.rows)
    ? resourceChain.rows
    : (Array.isArray(resourceChain?.results) ? resourceChain.results.filter((row) => row.key !== "market") : []);
  return {
    command: "npm run verify:terminal-resource-chain:unattended",
    artifact: FILES.resourceChain,
    exists: fileExists(FILES.resourceChain),
    ok: resourceChain?.ok === true,
    expectedDate: resourceChain?.expectedDate || "",
    rowCount: rows.length,
    rows: rows.map((row) => ({
      key: row.key,
      label: row.label || row.key || "",
      ok: row.ok === true,
      receiptRunId: endpointRunId(row, "receipt.runId"),
      supabaseRunId: endpointRunId(row, "supabase.runId"),
      liveRunId: endpointRunId(row, "live.runId", "terminalApi.runId", "liveRunId"),
      desktopRunId: endpointRunId(row, "desktopSnapshot.runId", "terminalApi.runId", "desktopRunId"),
      mobileRunId: endpointRunId(row, "mobileFragment.runId", "mobileRunId"),
      scorecardRunId: endpointRunId(row, "scorecard.runId", "scorecardRunId"),
      scorecardStatus: endpointStatus(row, "scorecard.status", "scorecard.error", "scorecardRunId"),
      membershipProtected: row.scorecard?.membershipProtected === true || /membership|required|bearer/i.test(String(row.scorecard?.error || row.scorecardRunId || "")),
      issues: row.issues || [],
    })),
    membershipProtectedSummary: resourceChain?.protectedReadbackAuth || resourceChain?.membershipProtectedSummary || null,
  };
}
function buildManifest(manifest) {
  const modules = Array.isArray(manifest?.modules) ? manifest.modules : [];
  return {
    command: "npm run manifest:daily-terminal-run",
    artifact: FILES.manifest,
    exists: fileExists(FILES.manifest),
    contract: manifest?.contract || "",
    ok: manifest?.ok === true,
    unattendedStatus: manifest?.unattendedStatus || "",
    requestedDate: manifest?.requestedDate || "",
    tradeDate: manifest?.tradeDate || "",
    blocker: manifest?.blocker || "",
    waterRootStatus: manifest?.waterRoot?.status || "",
    modules: modules.map((row) => ({
      key: row.key,
      runId: row.runId || "",
      tradeDate: row.tradeDate || "",
      sourceDate: row.sourceDate || "",
      complete: row.complete === true,
      fallback: row.fallback === true,
      rawFallback: row.rawFallback === true,
      pendingNotDue: row.pendingNotDue === true,
      evidenceStatus: row.evidenceStatus || "",
      publishAllowed: row.publishAllowed === true,
      resultCount: row.resultCount ?? "",
      readbackCount: row.readbackCount ?? "",
      scorecard88Protection: row.scorecard88Protection || "",
      ok: row.ok === true,
      issues: row.issues || [],
    })),
  };
}

function isPendingNotDueManifest(payload = {}) {
  const manifest = payload.dailyManifest || payload;
  const blocker = String(manifest.blocker || "").toLowerCase();
  return manifest.ok !== true && blocker.startsWith("pending_not_due:");
}
function normalizeAuthenticatedReadback(auth = {}) {
  const mode = auth.mode || "legacy-missing";
  const endpoints = Array.isArray(auth.endpoints) ? auth.endpoints : [];
  const enabled = auth.enabled === true;
  const ok = enabled && auth.ok === true && mode !== "not_armed" && endpoints.length > 0;
  return {
    ...auth,
    mode,
    enabled,
    endpoints,
    ok,
    reportOk: ok,
    rawOk: auth.ok === true,
  };
}
function buildProductionLive(productionLive) {
  const authenticatedReadback = normalizeAuthenticatedReadback(productionLive?.authenticatedReadback || { mode: "legacy-missing", ok: false, enabled: false, endpoints: [] });
  return {
    command: "npm run verify:terminal-ops-production-live",
    artifact: FILES.productionLive,
    exists: fileExists(FILES.productionLive),
    ok: productionLive?.ok === true,
    contract: productionLive?.contract || "",
    baseUrl: productionLive?.baseUrl || "",
    releaseSha: productionLive?.releaseSha || "",
    releaseManifest: {
      status: productionLive?.release?.status ?? "",
      gitSha: productionLive?.release?.gitSha || "",
      deployId: productionLive?.release?.deployId || "",
      deploymentUrl: productionLive?.release?.deploymentUrl || "",
      version: productionLive?.release?.version || "",
    },
    terminalOpsStatus: summarizeEndpoint((productionLive?.protectedEndpoints || []).find((row) => row.name === "terminal_ops_status")),
    scorecard: summarizeEndpoint((productionLive?.protectedEndpoints || []).find((row) => row.name === "scorecard")),
    sourceReports: summarizeEndpoint((productionLive?.protectedEndpoints || []).find((row) => row.name === "source_reports")),
    terminalFastBundle: summarizeEndpoint((productionLive?.protectedEndpoints || []).find((row) => row.name === "terminal_fast_bundle")),
    mobileBoot: summarizeEndpoint((productionLive?.protectedEndpoints || []).find((row) => row.name === "mobile_boot")),
    shell88: (productionLive?.shells || []).find((row) => row.path === "/88") || null,
    desktopArtifactVersion: productionLive?.desktopArtifactVersion || "",
    mobileArtifactVersion: productionLive?.mobileArtifactVersion || "",
    scorecardShellVersion: productionLive?.scorecardShellVersion || "",
    authenticatedReadback,
    issues: productionLive?.issues || [],
  };
}

function buildProtectedReadbackCredential(credential) {
  return {
    command: "npm run verify:protected-readback-credential",
    artifact: FILES.protectedReadbackCredential,
    exists: fileExists(FILES.protectedReadbackCredential),
    contract: credential?.contract || "",
    ok: credential?.ok === true,
    armed: credential?.armed === true,
    source: credential?.source || "none",
    auth: credential?.auth || {},
    env: credential?.env || {},
    endpoints: Array.isArray(credential?.endpoints) ? credential.endpoints : [],
    failures: Array.isArray(credential?.failures) ? credential.failures : [],
    diagnostics: credential?.diagnostics || {},
    nextActions: Array.isArray(credential?.nextActions) ? credential.nextActions : [],
  };
}
function buildServiceToken(serviceTokenSchedule) {
  return {
    command: "npm run verify:backend-service-token-schedule",
    artifact: FILES.serviceTokenSchedule,
    exists: fileExists(FILES.serviceTokenSchedule),
    ok: serviceTokenSchedule?.ok === true,
    activeTaskCount: serviceTokenSchedule?.scheduleRegistry?.activeTaskCount ?? "",
    requiredActiveTasks: serviceTokenSchedule?.scheduleRegistry?.requiredActiveTasks || [],
    scannerServiceKeys: serviceTokenSchedule?.scannerServiceKeys || [],
    scorecardRunner: serviceTokenSchedule?.scorecardRunner || {},
    strategyWrappers: serviceTokenSchedule?.strategyWrappers || {},
    membershipLayering: serviceTokenSchedule?.membershipLayering || {},
    guarantees: serviceTokenSchedule?.guarantees || [],
    issues: serviceTokenSchedule?.issues || [],
  };
}

function buildRollForward(rollForward) {
  const ok = rollForward?.ok === true || rollForward?.decision?.ok === true;
  return {
    command: "npm run verify:terminal-auto-roll-forward",
    artifact: FILES.rollForward,
    exists: fileExists(FILES.rollForward),
    ok,
    mode: rollForward?.mode || "",
    tradeDate: rollForward?.tradeDate || "",
    policyState: rollForward?.policyState || "",
    autoRecoveryAllowed: rollForward?.autoRecoveryAllowed === true,
    jobs: rollForward?.jobs ?? "",
    executableJobs: rollForward?.executableJobs ?? "",
    blockedJobs: rollForward?.blockedJobs ?? "",
    decision: rollForward?.decision || {},
    idempotencyContract: rollForward?.idempotencyContract || {},
    safeRecoveryPreview: rollForward?.safeRecoveryPreview || {},
    actions: rollForward?.actions || [],
    executed: rollForward?.executed || [],
  };
}

function buildReasonCodeClassifier(reasonCodeClassifier, opsStatus = {}) {
  const summary = reasonCodeClassifier?.summary || {};
  const opsSummary = opsStatus?.reasonCodeSummary || {};
  const codeList = Array.isArray(summary.codes) ? summary.codes : Object.keys(summary.codes || {});
  return {
    command: "npm run verify:terminal-reason-code-classifier",
    artifact: FILES.reasonCodeClassifier,
    exists: fileExists(FILES.reasonCodeClassifier),
    contract: reasonCodeClassifier?.contract || "",
    ok: reasonCodeClassifier?.ok === true,
    entries: summary.entries ?? (Array.isArray(reasonCodeClassifier?.entries) ? reasonCodeClassifier.entries.length : ""),
    unknownEntries: summary.unknownEntries ?? reasonCodeClassifier?.unknownEntries ?? "",
    codes: codeList,
    failures: Array.isArray(reasonCodeClassifier?.failures) ? reasonCodeClassifier.failures : [],
    opsStatusSummary: {
      contract: opsSummary.contract || "",
      ok: opsSummary.ok === true,
      entries: opsSummary.entries ?? "",
      unknownEntries: opsSummary.unknownEntries ?? "",
      primaryCode: opsSummary.primaryCode || "",
      codes: opsSummary.codes || {},
      actions: opsSummary.actions || {},
    },
  };
}

function buildFinalAudit(finalAudit) {
  return {
    command: "npm run verify:terminal-autonomous-completion-audit",
    artifact: FILES.finalAudit,
    exists: fileExists(FILES.finalAudit),
    contract: finalAudit?.contract || "",
    ok: finalAudit?.ok === true,
    tradeDate: compactDate(finalAudit?.summary?.tradeDate),
    layers: Array.isArray(finalAudit?.layers) ? finalAudit.layers.length : 0,
    marketClosedMode: finalAudit?.summary?.closed === true,
    issues: Array.isArray(finalAudit?.issues) ? finalAudit.issues.map((row) => row.issue || row.code || String(row)) : [],
  };
}

function severityRank(value = "") {
  const rank = { critical: 4, high: 3, warning: 2, info: 1 };
  return rank[String(value || "").toLowerCase()] || 0;
}

function classifyRootCause(blocker = "") {
  const text = String(blocker || "").toLowerCase();
  if (/pending_not_due|pending not due|PENDING_NOT_DUE/i.test(blocker)) return "schedule_pending";
  if (/protectedreadbackcredential|protected_readback|authenticated readback|authenticated_readback|\/88|membership|required \(token not armed\)|bearer/.test(text)) return "auth_readback";
  if (/waterroot|water_root|canonical_gate|source_water|formal_entry|source_status|fugle|websocket|priority|quote|1m|futopt|txf/.test(text)) return "source_water_root";
  if (/release_sha|production_release|deploy|sha_mismatch/.test(text)) return "release_deploy";
  if (/production_live|productionliveopsreadback|release_manifest|terminal-fast|mobile-boot/.test(text)) return "production_live_readback";
  if (/resourcechain|resource_chain/.test(text)) return "resource_chain";
  if (/runid|run_id|closure/.test(text)) return "runid_closure";
  if (/manifest|scorecard|publish_not_allowed|raw_fallback|evidence|previous_good|fallback/.test(text)) return "daily_manifest_publish";
  if (/service_token|windows task|schedule/.test(text)) return "schedule_service_token";
  if (/auto_roll_forward|autorollforward|roll_forward/.test(text)) return "auto_roll_forward";
  if (/final_audit|finalaudit/.test(text)) return "final_audit";
  if (/root_cause_summary|reason_code|classifier/.test(text)) return "reason_code_classifier";
  return "unknown";
}

function rootCauseAction(category) {
  return {
    auth_readback: "Install and verify protected readback runtime credential, then rerun protected readback / resource-chain / runId closure gates.",
    schedule_pending: "Wait until each module due time, keep previous-good visible, and do not run formal publish early.",
    source_water_root: "Recheck or rewater source root; scanner reruns stay blocked until current Water Root PASS and formal entry is allowed.",
    release_deploy: "Align production release SHA with current audited HEAD before claiming production readiness.",
    production_live_readback: "Rerun production live readback after deploy and protected credential are ready.",
    resource_chain: "Rerun terminal resource-chain unattended verifier and inspect per-module runId closure rows.",
    runid_closure: "Verify production API, desktop, mobile and /88 all expose the same module runId after authentication.",
    daily_manifest_publish: "Inspect Daily Manifest modules; only manifest-green modules may pass canary publish, otherwise preserve previous good/degraded.",
    schedule_service_token: "Repair Windows Task/service-token schedule contract and rerun strict schedule verifier.",
    auto_roll_forward: "Inspect auto roll-forward queue; apply only safe idempotent jobs after their pre-gates pass.",
    final_audit: "Rerun final audit after upstream blockers clear.",
    reason_code_classifier: "Fix unmapped reason codes so blockers always have stable reason/action/layer.",
    unknown: "Classify this blocker with a stable reason code before unattended YES is allowed.",
  }[category] || "Inspect blocker category.";
}

function buildRootCauseSummary(blockers = []) {
  const map = new Map();
  for (const row of Array.isArray(blockers) ? blockers : []) {
    const blocker = row?.blocker || String(row || "");
    const severity = row?.severity || "unknown";
    const category = classifyRootCause(blocker);
    const current = map.get(category) || { category, severity, count: 0, blockers: [], action: rootCauseAction(category) };
    current.count += 1;
    if (severityRank(severity) > severityRank(current.severity)) current.severity = severity;
    if (current.blockers.length < 8) current.blockers.push(blocker);
    map.set(category, current);
  }
  const categories = [...map.values()].sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.count - a.count || a.category.localeCompare(b.category));
  return {
    contract: "production-readiness-root-cause-summary-v1",
    ok: categories.every((row) => row.category !== "unknown"),
    totalBlockers: Array.isArray(blockers) ? blockers.length : 0,
    rootCauseCount: categories.length,
    criticalRootCauseCount: categories.filter((row) => row.severity === "critical").length,
    unknownBlockers: categories.filter((row) => row.category === "unknown").reduce((sum, row) => sum + row.count, 0),
    categories,
  };
}

const RECOVERY_ORDER = {
  auth_readback: 10,
  schedule_pending: 15,
  source_water_root: 20,
  schedule_service_token: 25,
  release_deploy: 30,
  production_live_readback: 40,
  resource_chain: 50,
  daily_manifest_publish: 60,
  runid_closure: 70,
  auto_roll_forward: 80,
  final_audit: 90,
  reason_code_classifier: 95,
  unknown: 999,
};

function rootCauseRecoveryStep(row = {}) {
  const category = row.category || "unknown";
  const order = RECOVERY_ORDER[category] || RECOVERY_ORDER.unknown;
  const base = {
    category,
    order,
    severity: row.severity || "unknown",
    blockerCount: Number(row.count || 0),
    canAutoExecute: false,
    automation: "manual_review",
    requires: [],
    commands: [],
    reason: row.action || rootCauseAction(category),
    stopMode: "fail_closed",
  };
  const command = (value) => ({ command: value });
  const plans = {
    auth_readback: {
      automation: "manual_secret",
      requires: ["operator_installs_runtime_credential", "no_secret_in_repo_or_chat"],
      commands: [
        command('powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\\fuman-terminal\\scripts\\setup-protected-readback-credential.ps1 -Email "<member-email>" -Force'),
        command("cd C:\\fuman-terminal; npm run verify:protected-readback-credential"),
      ],
      reason: "Protected desktop/mobile/88 readback needs a runtime member credential; this can never be auto-created or stored in source.",
      stopMode: "manual_repair_required",
    },
    schedule_pending: {
      automation: "wait_until_due_time",
      requires: ["module_due_time_reached", "water_root_still_ok_or_previous_good_hold"],
      commands: [command("cd C:\\fuman-terminal; npm run manifest:daily-terminal-run")],
      reason: "Module schedule has not reached its formal run time yet; previous-good hold is expected and must stay explicit.",
      stopMode: "pending_not_due",
    },
    source_water_root: {
      automation: "wait_or_rewater",
      requires: ["market_window_or_previous_good_hold", "water_root_reason_code", "formal_entry_gate"],
      commands: [
        command("cd C:\\fuman-terminal; npm run verify:terminal-water-root"),
        command("cd C:\\fuman-terminal; npm run daytrade-warmup:self-heal"),
      ],
      reason: "Scanners stay blocked until Water Root is current-ok and formal entry is allowed; self-heal must be re-verified and cannot fake natural evidence.",
      stopMode: "source_root_not_ready",
    },
    schedule_service_token: {
      automation: "manual_service_token_repair",
      requires: ["windows_task_present", "machine_service_token", "strict_schedule_logs"],
      commands: [command("cd C:\\fuman-terminal; npm run schedule:check -- -StrictLogs")],
      reason: "Backend schedules must run with machine/service credentials, not member login state.",
      stopMode: "manual_repair_required",
    },
    release_deploy: {
      automation: "deploy_required",
      requires: ["release_owner_approval", "current_head_audited", "no_unrelated_dirty_release"],
      commands: [command("cd C:\\fuman-terminal; npm run verify:terminal-ops-production-live")],
      reason: "Production SHA must match the audited HEAD before production readiness can be claimed.",
      stopMode: "deploy_required",
    },
    production_live_readback: {
      automation: "readback_after_auth_deploy",
      requires: ["protected_readback_credential_ok", "production_sha_aligned"],
      commands: [command("cd C:\\fuman-terminal; npm run verify:terminal-ops-production-live -- --require-protected-readback")],
      reason: "Production protected surfaces can only be closed after credential and deployed release are aligned.",
      stopMode: "readback_required",
    },
    resource_chain: {
      automation: "rerun_verifier",
      canAutoExecute: true,
      requires: ["protected_readback_credential_ok", "water_root_ok_or_previous_good_hold"],
      commands: [command("cd C:\\fuman-terminal; npm run verify:terminal-resource-chain:unattended")],
      reason: "Resource chain is evidence-only and may rerun after auth/water prerequisites are ready.",
      stopMode: "verification_required",
    },
    daily_manifest_publish: {
      automation: "manifest_repair",
      requires: ["water_root_ok", "resource_chain_ok", "module_evidence_complete", "no_raw_fallback"],
      commands: [
        command("cd C:\\fuman-terminal; npm run manifest:daily-terminal-run"),
        command("cd C:\\fuman-terminal; npm run verify:daily-terminal-run-manifest"),
      ],
      reason: "Daily Manifest must be green before publish; previous-good/degraded must remain explicit.",
      stopMode: "preserve_previous_good",
    },
    runid_closure: {
      automation: "runid_readback_after_publish",
      requires: ["production_api_ready", "desktop_ready", "mobile_ready", "scorecard88_ready", "same_runid"],
      commands: [command("cd C:\\fuman-terminal; npm run verify:terminal-resource-chain:unattended")],
      reason: "Production API, desktop, mobile and /88 must expose the same module runId.",
      stopMode: "runid_closure_required",
    },
    auto_roll_forward: {
      automation: "roll_forward_guarded",
      requires: ["all_job_pre_gates_ok", "idempotency_key", "safe_recovery_preview_ok"],
      commands: [command("cd C:\\fuman-terminal; npm run rollforward:terminal")],
      reason: "Roll-forward may only execute idempotent jobs whose pre-gates pass; auth jobs remain manual.",
      stopMode: "guarded_roll_forward",
    },
    final_audit: {
      automation: "final_audit_after_upstream",
      canAutoExecute: true,
      requires: ["upstream_recovery_plan_green", "all_21_layers_evidence_readable"],
      commands: [command("cd C:\\fuman-terminal; npm run verify:terminal-autonomous-completion-audit")],
      reason: "Final audit is the last evidence readback after upstream gates clear.",
      stopMode: "final_audit_required",
    },
    reason_code_classifier: {
      automation: "reason_code_mapping_required",
      requires: ["unknown_entries_zero"],
      commands: [command("cd C:\\fuman-terminal; npm run verify:terminal-reason-code-classifier")],
      reason: "Every blocker must have stable reason/action/layer before unattended YES.",
      stopMode: "classifier_required",
    },
    unknown: {
      automation: "manual_classification_required",
      requires: ["stable_reason_code_mapping"],
      commands: [command("cd C:\\fuman-terminal; npm run verify:terminal-reason-code-classifier")],
      reason: "Unknown blockers are not allowed in unattended mode.",
      stopMode: "manual_repair_required",
    },
  };
  return { ...base, ...(plans[category] || plans.unknown) };
}

function hasRawFallback(payload = {}) {
  return (payload.dailyManifest?.modules || []).some((row) => row.rawFallback === true);
}

function allModuleEvidenceComplete(payload = {}) {
  const modules = payload.dailyManifest?.modules || [];
  return modules.length > 0 && modules.every((row) => row.evidenceStatus === "complete");
}

function autoRollForwardBlockedBy(payload = {}) {
  const failures = [];
  const add = (code) => {
    if (code && !failures.includes(code)) failures.push(code);
  };
  const preview = payload.autoRollForward?.safeRecoveryPreview || {};
  if (preview.reason) add(preview.reason);
  if (Number(preview.executableJobs || 0) === 0 && Number(preview.blockedJobs || 0) > 0) add("safe_recovery_no_executable_jobs");
  for (const action of payload.autoRollForward?.actions || []) {
    if (action.executionGuard) add("action_guard:" + action.key + ":" + action.executionGuard);
    else if (action.executable !== true) add("action_blocked:" + (action.key || "unknown"));
  }
  return failures;
}

function recoveryPrerequisiteFailures(step = {}, payload = {}, steps = []) {
  const failures = [];
  const add = (code) => {
    if (code && !failures.includes(code)) failures.push(code);
  };
  const releaseAligned = Boolean(payload.releaseIdentity?.releaseSha)
    && Boolean(payload.releaseIdentity?.headSha)
    && payload.releaseIdentity.releaseSha === payload.releaseIdentity.headSha;
  const credentialOk = payload.protectedReadbackCredential?.ok === true && payload.protectedReadbackCredential?.armed === true;
  const waterRootOk = payload.waterRoot?.ok === true;
  const resourceChainOk = payload.resourceChain?.ok === true;
  const manifestOk = payload.dailyManifest?.ok === true;
  const productionLiveOk = payload.productionLiveOpsReadback?.ok === true;
  const scheduleOk = payload.windowsTaskAndServiceTokenAudit?.ok === true;
  const safeRecoveryOk = payload.autoRollForward?.safeRecoveryPreview?.contract === "terminal-safe-recovery-preview-v1"
    && payload.autoRollForward?.safeRecoveryPreview?.ok === true;
  const finalAuditLayersOk = payload.finalAudit?.layers === 21;
  const reasonCodesOk = payload.reasonCodeClassifier?.ok === true && Number(payload.reasonCodeClassifier?.unknownEntries || 0) === 0;
  const priorUnresolved = steps
    .filter((row) => Number(row.order || 0) < Number(step.order || 0))
    .filter((row) => row.category !== "unknown")
    .map((row) => row.category);

  for (const requirement of step.requires || []) {
    if (requirement === "operator_installs_runtime_credential") add("manual_secret_install_required");
    else if (requirement === "no_secret_in_repo_or_chat") add("secret_must_remain_manual_runtime_only");
    else if (requirement === "protected_readback_credential_ok" && !credentialOk) add("protected_readback_credential_not_ok");
    else if (requirement === "market_window_or_previous_good_hold" && !waterRootOk) add("water_root_not_ok");
    else if (requirement === "water_root_reason_code" && !payload.waterRoot?.reason) add("water_root_reason_code_missing");
    else if (requirement === "formal_entry_gate" && !/^A$/i.test(String(payload.waterRoot?.sourceGate || payload.waterRoot?.gate || ""))) add("formal_entry_gate_not_A");
    else if (requirement === "water_root_ok_or_previous_good_hold" && !waterRootOk) add("water_root_not_ok");
    else if (requirement === "water_root_ok" && !waterRootOk) add("water_root_not_ok");
    else if (requirement === "resource_chain_ok" && !resourceChainOk) add("resource_chain_not_ok");
    else if (requirement === "module_evidence_complete" && !allModuleEvidenceComplete(payload)) add("module_evidence_not_complete");
    else if (requirement === "no_raw_fallback" && hasRawFallback(payload)) add("raw_fallback_present");
    else if (requirement === "release_owner_approval") add("release_owner_approval_required");
    else if (requirement === "current_head_audited" && !releaseAligned) add("production_sha_not_aligned_to_head");
    else if (requirement === "no_unrelated_dirty_release") add("release_dirty_state_requires_owner_review");
    else if (requirement === "production_sha_aligned" && !releaseAligned) add("production_sha_not_aligned");
    else if (["production_api_ready", "desktop_ready", "mobile_ready", "scorecard88_ready"].includes(requirement) && !productionLiveOk) add("production_live_readback_not_ok");
    else if (requirement === "same_runid" && (!resourceChainOk || !manifestOk)) add("runid_closure_not_verified");
    else if (requirement === "all_job_pre_gates_ok" && payload.autoRollForward?.ok !== true) {
      const rollForwardFailures = autoRollForwardBlockedBy(payload);
      if (rollForwardFailures.length) rollForwardFailures.forEach(add);
      else add("auto_roll_forward_not_ok");
    }
    else if (requirement === "safe_recovery_preview_ok" && !safeRecoveryOk) {
      const rollForwardFailures = autoRollForwardBlockedBy(payload);
      if (rollForwardFailures.length) rollForwardFailures.forEach(add);
      else add("safe_recovery_preview_not_ok");
    }
    else if (requirement === "idempotency_key" && !payload.autoRollForward?.idempotencyContract?.contract) add("idempotency_contract_missing");
    else if (requirement === "upstream_recovery_plan_green" && priorUnresolved.length > 0) add("upstream_recovery_unresolved:" + priorUnresolved.join(","));
    else if (requirement === "all_21_layers_evidence_readable" && !finalAuditLayersOk) add("final_audit_layers_not_21");
    else if (requirement === "unknown_entries_zero" && !reasonCodesOk) add("reason_code_unknown_entries");
    else if (["windows_task_present", "machine_service_token", "strict_schedule_logs"].includes(requirement) && !scheduleOk) add("service_token_schedule_not_ok");
    else if (requirement === "stable_reason_code_mapping" && !reasonCodesOk) add("reason_code_classifier_not_ok");
  }
  return failures;
}

function buildRootCauseRecoveryPlan(rootCauseSummary = {}, payload = {}) {
  const categories = Array.isArray(rootCauseSummary.categories) ? rootCauseSummary.categories : [];
  const baseSteps = categories.map(rootCauseRecoveryStep).sort((a, b) => a.order - b.order || a.category.localeCompare(b.category));
  const steps = baseSteps.map((step) => {
    const blockedBy = recoveryPrerequisiteFailures(step, payload, baseSteps);
    return {
      ...step,
      canExecuteNow: step.canAutoExecute === true && blockedBy.length === 0,
      blockedBy,
    };
  });
  return {
    contract: "production-readiness-root-cause-recovery-plan-v1",
    ok: steps.every((row) => row.category !== "unknown" && Array.isArray(row.requires) && row.requires.length > 0 && Array.isArray(row.commands) && Array.isArray(row.blockedBy) && typeof row.canExecuteNow === "boolean"),
    stepCount: steps.length,
    autoExecutableSteps: steps.filter((row) => row.canAutoExecute === true).length,
    autoExecutableNow: steps.filter((row) => row.canExecuteNow === true).length,
    blockedAutoExecutableSteps: steps.filter((row) => row.canAutoExecute === true && row.canExecuteNow !== true).length,
    manualSteps: steps.filter((row) => row.canAutoExecute !== true).length,
    firstManualStep: steps.find((row) => row.canAutoExecute !== true)?.category || "",
    firstExecutableStep: steps.find((row) => row.canExecuteNow === true)?.category || "",
    firstBlockedStep: steps.find((row) => (row.blockedBy || []).length > 0)?.category || "",
    steps,
  };
}

function collectBlockers(payload, issues) {
  const blockers = [];
  if (payload.releaseIdentity.releaseSha && payload.releaseIdentity.headSha && payload.releaseIdentity.releaseSha !== payload.releaseIdentity.headSha) {
    blockers.push({ blocker: "production_release_sha_mismatch", severity: "critical" });
  }
  for (const [key, section] of Object.entries({
    waterRoot: payload.waterRoot,
    resourceChain: payload.resourceChain,
    dailyManifest: payload.dailyManifest,
    productionLiveOpsReadback: payload.productionLiveOpsReadback,
    protectedReadbackCredential: payload.protectedReadbackCredential,
    windowsTaskAndServiceTokenAudit: payload.windowsTaskAndServiceTokenAudit,
    autoRollForward: payload.autoRollForward,
    reasonCodeClassifier: payload.reasonCodeClassifier,
    finalAudit: payload.finalAudit,
  })) {
    if (section.ok !== true) {
      if (key === "dailyManifest" && isPendingNotDueManifest(payload)) blockers.push({ blocker: section.blocker || "pending_not_due", severity: "info" });
      else if (key === "finalAudit" && isPendingNotDueManifest(payload) && (section.issues || []).every((row) => row === "manifest_pending_not_due")) blockers.push({ blocker: "final_audit_pending_not_due", severity: "info" });
      else blockers.push({ blocker: `${key}_not_ok`, severity: "critical" });
    }
  }
  if (payload.resourceChain.ok === true && Number(payload.resourceChain.rowCount || 0) === 0) {
    blockers.push({ blocker: "resource_chain_rows_missing_in_report", severity: "critical" });
  }
  for (const row of payload.dailyManifest.modules || []) {
    if (row.ok !== true) {
      blockers.push({ blocker: `manifest_module_not_ok:${row.key}`, severity: "critical", issues: row.issues });
      for (const moduleIssue of row.issues || []) {
        blockers.push({ blocker: `manifest_module_issue:${row.key}:${moduleIssue}`, severity: "critical" });
      }
    }
    if (row.pendingNotDue !== true) {
      if (row.fallback === true) blockers.push({ blocker: `manifest_module_fallback:${row.key}`, severity: "high" });
      if (row.rawFallback === true) blockers.push({ blocker: `manifest_module_raw_fallback:${row.key}`, severity: "critical" });
      if (row.evidenceStatus && row.evidenceStatus !== "complete") blockers.push({ blocker: `manifest_module_evidence:${row.key}:${row.evidenceStatus}`, severity: "critical" });
      if (row.publishAllowed !== true) blockers.push({ blocker: `manifest_module_publish_not_allowed:${row.key}`, severity: "critical" });
    }
  }
  for (const row of payload.productionLiveOpsReadback.issues || []) {
    blockers.push({ blocker: `production_live_issue:${formatIssue(row)}`, severity: "critical" });
  }
  for (const row of payload.protectedReadbackCredential.failures || []) {
    blockers.push({ blocker: `protected_readback_credential:${row}`, severity: "critical" });
  }
  for (const row of payload.windowsTaskAndServiceTokenAudit.issues || []) {
    blockers.push({ blocker: `service_token_schedule_issue:${formatIssue(row)}`, severity: "critical" });
  }
  if (payload.reasonCodeClassifier.ok !== true) {
    blockers.push({ blocker: "reason_code_classifier_not_ok", severity: "critical", failures: payload.reasonCodeClassifier.failures || [] });
  }
  if (Number(payload.reasonCodeClassifier.unknownEntries || 0) > 0) {
    blockers.push({ blocker: "reason_code_classifier_unknown_entries", severity: "critical", unknownEntries: payload.reasonCodeClassifier.unknownEntries });
  }
  if (payload.reasonCodeClassifier.opsStatusSummary?.ok !== true) {
    blockers.push({ blocker: "ops_status_reason_code_summary_not_ok", severity: "critical", reasonCodeSummary: payload.reasonCodeClassifier.opsStatusSummary });
  }
  for (const row of payload.finalAudit.issues || []) {
    blockers.push({ blocker: `final_audit_issue:${row}`, severity: row === "manifest_pending_not_due" ? "info" : "critical" });
  }
  for (const row of issues) {
    if (String(row.code || "").startsWith("root_cause_summary_")) continue;
    blockers.push({ blocker: row.code, severity: "critical", details: row.details });
  }
  return blockers;
}

function isPreviousGoodWaterRoot(payload = {}) {
  const text = `${payload.waterRoot?.status || ""} ${payload.waterRoot?.reason || ""}`.toLowerCase();
  return text.includes("previous_good") || text.includes("wait_source_window") || text.includes("formal_scan_skipped");
}

function authenticatedReadbackOk(payload = {}) {
  const auth = payload.productionLiveOpsReadback?.authenticatedReadback || {};
  return auth.enabled === true
    && auth.ok === true
    && Array.isArray(auth.endpoints)
    && auth.endpoints.length > 0
    && auth.endpoints.every((row) => row?.ok === true && Number(row?.status) === 200);
}

function requiresAuthenticatedReadbackForReady(payload = {}) {
  return !isPreviousGoodWaterRoot(payload);
}

function resourceChainProtectedReadbackOk(payload = {}) {
  const auth = payload.resourceChain?.membershipProtectedSummary || {};
  return auth.enabled === true && !auth.error;
}

function classifyPasses(payload) {
  const productionLivePasses = [];
  const nonProductionOrPreviousGoodPasses = [];
  if (payload.productionLiveOpsReadback.ok) productionLivePasses.push("Production live ops readback PASS: /api/release-manifest SHA/deploy, protected endpoints, desktop shell, mobile shell, /88 shell.");
  if (payload.productionLiveOpsReadback.releaseManifest.gitSha === payload.releaseIdentity.headSha) productionLivePasses.push("Production release SHA equals current HEAD.");
  if (payload.productionLiveOpsReadback.terminalOpsStatus.ok) productionLivePasses.push("/api/terminal-ops-status protected by membership_required without being treated as compute failure.");
  if (payload.productionLiveOpsReadback.scorecard.ok) productionLivePasses.push("/api/scorecard protected by membership_required without leaking formal data.");
  if (payload.productionLiveOpsReadback.sourceReports.ok) productionLivePasses.push("/api/source-reports protected by membership_required without leaking formal data.");
  if (payload.productionLiveOpsReadback.terminalFastBundle.ok) productionLivePasses.push("Desktop fast bundle returns redacted locked shell for unauthenticated users.");
  if (payload.productionLiveOpsReadback.mobileBoot.ok) productionLivePasses.push("Mobile boot returns redacted locked shell for unauthenticated users.");
  if (payload.productionLiveOpsReadback.shell88?.ok) productionLivePasses.push("/88 shell loads and contains membership lock hook.");
  const authReadback = payload.productionLiveOpsReadback.authenticatedReadback || {};
  if (authReadback.enabled && authReadback.ok) productionLivePasses.push(`Authenticated protected readback PASS: ${(authReadback.endpoints || []).map((row) => `${row.name}:${row.status}:${row.runIdCount}`).join(" / ")}.`);
  if (payload.protectedReadbackCredential?.ok) productionLivePasses.push(`Protected readback credential hard gate PASS via ${payload.protectedReadbackCredential.source}.`);

  if (payload.waterRoot.ok) nonProductionOrPreviousGoodPasses.push(`Water Root local/live artifact PASS in ${payload.waterRoot.status || "unknown"} mode.`);
  if (payload.dailyManifest.ok) nonProductionOrPreviousGoodPasses.push(`Daily Manifest PASS for tradeDate ${payload.dailyManifest.tradeDate}.`);
  if (payload.resourceChain.ok) nonProductionOrPreviousGoodPasses.push("Resource-chain unattended verifier PASS; protected production surfaces are classified separately.");
  if (payload.autoRollForward.ok) nonProductionOrPreviousGoodPasses.push(`Auto Roll Forward ${payload.autoRollForward.mode || "dry-run"} PASS with ${payload.autoRollForward.jobs} queued jobs.`);
  if (payload.reasonCodeClassifier.ok) nonProductionOrPreviousGoodPasses.push(`Reason Code Classifier PASS: entries=${payload.reasonCodeClassifier.entries}; unknownEntries=${payload.reasonCodeClassifier.unknownEntries}; primary=${payload.reasonCodeClassifier.opsStatusSummary?.primaryCode || "--"}.`);
  if (payload.finalAudit.layers === 21) nonProductionOrPreviousGoodPasses.push(`Terminal Final Audit covers ${payload.finalAudit.layers} dream layers; current issues=${payload.finalAudit.issues.join(",") || "none"}.`);
  if (payload.windowsTaskAndServiceTokenAudit.ok) nonProductionOrPreviousGoodPasses.push("Windows Task / service-token schedule contract PASS.");
  if (isPreviousGoodWaterRoot(payload)) nonProductionOrPreviousGoodPasses.push("Current YES is previous-good hold readiness, not proof of a new trading-day fresh scan.");
  if (!authReadback.enabled) nonProductionOrPreviousGoodPasses.push(`Authenticated protected readback is ${authReadback.mode || "not_armed"}; run with member token/email to prove protected API runId display after login.`);
  if (!payload.protectedReadbackCredential?.ok) nonProductionOrPreviousGoodPasses.push(`Protected readback credential gate is not ready: ${(payload.protectedReadbackCredential?.failures || []).join(",") || "missing"}.`);
  return { productionLivePasses, nonProductionOrPreviousGoodPasses };
}

function nextRunbook(payload) {
  return [
    "06:50-07:00 run Predictive Preflight and verify today's Taipei trading date.",
    "07:00 run Water Root; require Supabase REST 1-3s, Fugle websocket writer healthy, priority pool present, daily volume ready.",
    "08:30 check daytrade warmup: priority pool / mother pool / 1m warmup / daily volume / futopt readiness.",
    "08:45-09:00 allow only sources whose strategy water gates pass; blocked modules preserve previous good.",
    "Run strategy scanners through service token / machine context only; member token must not be required.",
    "After each scanner, write receipt and latest pointer, then refresh Daily Manifest.",
    "Run Canary Publish; publish scorecard only when manifest and canary are green.",
    "Verify RunId Closure: production API, desktop, mobile, /88 sourceReports must match the same runId per module.",
    "Run Auto Roll Forward for queued repair jobs; auth jobs require manual service-token repair and never auto-execute as fake success.",
    "Export Control Plane and Ops Status; notify only when Autonomous Ops Policy says notification is required.",
  ];
}

function remainingConditions(payload) {
  const conditions = [];
  if (payload.waterRoot.status === "market_closed_previous_good") {
    conditions.push("Next trading-day fresh scan is not proven yet because current state is market_closed_previous_good.");
  }
  conditions.push("On the next trading day, Water Root must pass in formal trading mode, not only market-closed preserve mode.");
  conditions.push("Each active module must produce a same-day scanner receipt and runId or a formal zero-result complete receipt.");
  conditions.push("Daily Manifest must remain green with fallback=false for all publishable modules.");
  conditions.push("Canary Publish must allow scorecard publish only after manifest is green.");
  if (!authenticatedReadbackOk(payload)) conditions.push("Authenticated protected readback must PASS with a member token/email before claiming protected display closure.");
  conditions.push("Production API / desktop / mobile / /88 readback must show the same module runId after authentication.");
  conditions.push("Any source/auth/scan/publish/display blocker must create a job queue item or explicit preserve-previous-good state.");
  return conditions;
}

function markdown(payload) {
  const lines = [];
  lines.push("# Production Unattended Readiness Report");
  lines.push("");
  lines.push(`checkedAt: ${payload.checkedAt}`);
  lines.push(`status: ${payload.status}`);
  lines.push(`ok: ${payload.ok}`);
  lines.push("");
  lines.push("## 1. Release Identity");
  for (const [key, value] of Object.entries(payload.releaseIdentity)) lines.push(`- ${key}: ${value}`);
  lines.push("");
  lines.push("## 2. Water Root");
  lines.push(`- command: ${payload.waterRoot.command}`);
  lines.push(`- ok/status/reason: ${payload.waterRoot.ok} / ${payload.waterRoot.status} / ${payload.waterRoot.reason}`);
  lines.push(`- expectedDate/displayTradeDate: ${payload.waterRoot.expectedDate} / ${payload.waterRoot.displayTradeDate}`);
  lines.push(`- source/gate/priorityCoverage/quoteAge/1mStale: ${payload.waterRoot.sourceStatus} / ${payload.waterRoot.sourceGate} / ${payload.waterRoot.priorityFreshQuoteCoverage120s} / ${payload.waterRoot.quoteAgeSeconds} / ${payload.waterRoot.intraday1mStaleSeconds}`);
  lines.push("");
  lines.push("## 3. Resource Chain");
  lines.push(`- command: ${payload.resourceChain.command}`);
  lines.push(`- ok/expectedDate/rowCount: ${payload.resourceChain.ok} / ${payload.resourceChain.expectedDate} / ${payload.resourceChain.rowCount}`);
  const chainAuth = payload.resourceChain.membershipProtectedSummary || {};
  lines.push(`- protected readback auth: source=${chainAuth.source || "--"}; attempted=${chainAuth.attempted === true}; enabled=${chainAuth.enabled === true}; status=${chainAuth.status || 0}; error=${chainAuth.error || ""}`);
  for (const row of payload.resourceChain.rows) lines.push(`- ${row.key}: ok=${row.ok}; receipt=${row.receiptRunId || "--"}; supabase=${row.supabaseRunId || "--"}; live=${row.liveRunId || "--"}; desktop=${row.desktopRunId || "--"}; mobile=${row.mobileRunId || "--"}; scorecard=${row.scorecardRunId || row.scorecardStatus || "--"}; protected=${row.membershipProtected}; issues=${(row.issues || []).join(",") || "none"}`);
  lines.push("");
  lines.push("## 4. Daily Manifest");
  lines.push(`- command: ${payload.dailyManifest.command}`);
  lines.push(`- ok/unattended/tradeDate/waterRoot: ${payload.dailyManifest.ok} / ${payload.dailyManifest.unattendedStatus} / ${payload.dailyManifest.tradeDate} / ${payload.dailyManifest.waterRootStatus}`);
  for (const row of payload.dailyManifest.modules) lines.push(`- ${row.key}: runId=${row.runId}; complete=${row.complete}; fallback=${row.fallback}; scorecard88=${row.scorecard88Protection}; ok=${row.ok}`);
  lines.push("");
  lines.push("## 5. Production Live Ops Readback");
  lines.push(`- command: ${payload.productionLiveOpsReadback.command}`);
  lines.push(`- release: status=${payload.productionLiveOpsReadback.releaseManifest.status}; sha=${payload.productionLiveOpsReadback.releaseManifest.gitSha}; deployId=${payload.productionLiveOpsReadback.releaseManifest.deployId}`);
  for (const key of ["terminalOpsStatus", "scorecard", "sourceReports", "terminalFastBundle", "mobileBoot"]) {
    const row = payload.productionLiveOpsReadback[key];
    lines.push(`- ${key}: status=${row.status}; mode=${row.mode}; protected=${row.protected}; ok=${row.ok}; artifact=${row.artifactVersion || "--"}`);
  }
  lines.push(`- /88 shell: status=${payload.productionLiveOpsReadback.shell88?.status || "--"}; ok=${payload.productionLiveOpsReadback.shell88?.ok || false}; shellVersion=${payload.productionLiveOpsReadback.scorecardShellVersion || "--"}`);
  lines.push(`- desktop artifact version: ${payload.productionLiveOpsReadback.desktopArtifactVersion}`);
  lines.push(`- mobile artifact version: ${payload.productionLiveOpsReadback.mobileArtifactVersion}`);
  const authReadback = payload.productionLiveOpsReadback.authenticatedReadback || {};
  lines.push(`- authenticated protected readback: mode=${authReadback.mode || "--"}; enabled=${authReadback.enabled === true}; ok=${authReadback.ok === true}; endpoints=${(authReadback.endpoints || []).map((row) => `${row.name}:${row.status}:${row.runIdCount}`).join(" / ") || "--"}`);
  lines.push("");
  lines.push("## 6. Protected Readback Credential");
  lines.push(`- command: ${payload.protectedReadbackCredential.command}`);
  lines.push(`- ok/armed/source: ${payload.protectedReadbackCredential.ok} / ${payload.protectedReadbackCredential.armed} / ${payload.protectedReadbackCredential.source}`);
  lines.push(`- auth: enabled=${payload.protectedReadbackCredential.auth?.enabled === true}; status=${payload.protectedReadbackCredential.auth?.status || 0}; reason=${payload.protectedReadbackCredential.auth?.reason || "--"}`);
  lines.push(`- failures: ${(payload.protectedReadbackCredential.failures || []).join(",") || "none"}`);
  const credentialRuntime = payload.protectedReadbackCredential.diagnostics?.runtimeFile || {};
  const credentialEnvRows = payload.protectedReadbackCredential.diagnostics?.windowsEnvironment?.rows || [];
  const presentEnvRows = credentialEnvRows.filter((row) => row.present === true).map((row) => `${row.target}:${row.name}:${row.length}`);
  lines.push(`- runtime file: path=${credentialRuntime.path || "--"}; exists=${credentialRuntime.exists === true}; loaded=${credentialRuntime.loaded === true}; hasToken=${credentialRuntime.hasToken === true}; hasEmail=${credentialRuntime.hasEmail === true}; hasPassword=${credentialRuntime.hasPassword === true}`);
  lines.push(`- env presence: ${presentEnvRows.join(", ") || "none"}`);
  for (const action of payload.protectedReadbackCredential.nextActions || []) lines.push(`- credential next action: ${action.code || "unknown"}; command=${action.command || "--"}; expected=${action.expected || action.expectedFile || "--"}`);
  lines.push("");
  lines.push("## 7. Windows Task / Service Token Audit");
  lines.push(`- command: ${payload.windowsTaskAndServiceTokenAudit.command}`);
  lines.push(`- ok/activeTaskCount: ${payload.windowsTaskAndServiceTokenAudit.ok} / ${payload.windowsTaskAndServiceTokenAudit.activeTaskCount}`);
  lines.push(`- required tasks: ${payload.windowsTaskAndServiceTokenAudit.requiredActiveTasks.join(", ")}`);
  lines.push(`- scanner service files: ${payload.windowsTaskAndServiceTokenAudit.scannerServiceKeys.map((row) => `${row.file}:${row.ok}`).join(", ")}`);
  lines.push("");
  lines.push("## 8. Auto Roll Forward");
  lines.push(`- command: ${payload.autoRollForward.command}`);
  lines.push(`- ok/mode/state/jobs/executable/blocked: ${payload.autoRollForward.ok} / ${payload.autoRollForward.mode} / ${payload.autoRollForward.decision?.state || "--"} / ${payload.autoRollForward.jobs} / ${payload.autoRollForward.executableJobs} / ${payload.autoRollForward.blockedJobs}`);
  const safePreview = payload.autoRollForward.safeRecoveryPreview || {};
  const idempotency = payload.autoRollForward.idempotencyContract || {};
  lines.push(`- idempotencyContract: contract=${idempotency.contract || "--"}; invariants=${(idempotency.invariants || []).join(",") || "none"}`);
  lines.push(`- safeRecoveryPreview: contract=${safePreview.contract || "--"}; state=${safePreview.state || "--"}; executable=${(safePreview.executableKeys || []).join(",") || "none"}; blocked=${(safePreview.blockedKeys || []).join(",") || "none"}`);
  if (safePreview.commandHint) lines.push(`- safe recovery command hint: ${safePreview.commandHint}`);
  lines.push("");
  lines.push("## 9. Reason Code Classifier");
  lines.push(`- command: ${payload.reasonCodeClassifier.command}`);
  lines.push(`- ok/entries/unknown: ${payload.reasonCodeClassifier.ok} / ${payload.reasonCodeClassifier.entries} / ${payload.reasonCodeClassifier.unknownEntries}`);
  lines.push(`- ops summary: ok=${payload.reasonCodeClassifier.opsStatusSummary?.ok === true}; primary=${payload.reasonCodeClassifier.opsStatusSummary?.primaryCode || "--"}; unknown=${payload.reasonCodeClassifier.opsStatusSummary?.unknownEntries ?? "--"}`);
  const reasonCodes = Array.isArray(payload.reasonCodeClassifier.codes) ? payload.reasonCodeClassifier.codes : Object.keys(payload.reasonCodeClassifier.codes || {});
  lines.push(`- codes: ${reasonCodes.join(",") || "none"}`);
  lines.push("");
  lines.push("## 10. Final Audit");
  lines.push(`- command: ${payload.finalAudit.command}`);
  lines.push(`- ok/layers/issues: ${payload.finalAudit.ok} / ${payload.finalAudit.layers} / ${payload.finalAudit.issues.join(",") || "none"}`);
  lines.push("");
  lines.push("## 11. Root Cause Summary");
  lines.push(`- contract: ${payload.rootCauseSummary?.contract || "--"}`);
  lines.push(`- ok/total/rootCauses/critical/unknown: ${payload.rootCauseSummary?.ok === true} / ${payload.rootCauseSummary?.totalBlockers ?? 0} / ${payload.rootCauseSummary?.rootCauseCount ?? 0} / ${payload.rootCauseSummary?.criticalRootCauseCount ?? 0} / ${payload.rootCauseSummary?.unknownBlockers ?? 0}`);
  for (const row of payload.rootCauseSummary?.categories || []) lines.push(`- ${row.severity || "unknown"}: ${row.category} (${row.count}) -> ${row.action}`);
  lines.push("");
  lines.push("");
  lines.push("## 12. Root Cause Recovery Plan");
  lines.push(`- contract: ${payload.rootCauseRecoveryPlan?.contract || "--"}`);
  lines.push(`- ok/steps/auto/autoNow/blockedAuto/manual/firstManual/firstExecutable/firstBlocked: ${payload.rootCauseRecoveryPlan?.ok === true} / ${payload.rootCauseRecoveryPlan?.stepCount ?? 0} / ${payload.rootCauseRecoveryPlan?.autoExecutableSteps ?? 0} / ${payload.rootCauseRecoveryPlan?.autoExecutableNow ?? 0} / ${payload.rootCauseRecoveryPlan?.blockedAutoExecutableSteps ?? 0} / ${payload.rootCauseRecoveryPlan?.manualSteps ?? 0} / ${payload.rootCauseRecoveryPlan?.firstManualStep || "--"} / ${payload.rootCauseRecoveryPlan?.firstExecutableStep || "--"} / ${payload.rootCauseRecoveryPlan?.firstBlockedStep || "--"}`);
  for (const row of payload.rootCauseRecoveryPlan?.steps || []) lines.push(`- #${row.order} ${row.category}: auto=${row.canAutoExecute === true}; now=${row.canExecuteNow === true}; mode=${row.automation}; stop=${row.stopMode}; blockedBy=${(row.blockedBy || []).join(",") || "none"}; requires=${(row.requires || []).join(",")}`);
  lines.push("");
  lines.push("## 13. Blockers");
  if (payload.blockers.length === 0) lines.push("- none");
  for (const row of payload.blockers) lines.push(`- ${row.severity || "unknown"}: ${row.blocker}`);
  lines.push("");
  lines.push("## 14. Production Live PASS");
  for (const row of payload.productionLivePasses) lines.push(`- ${row}`);
  lines.push("");
  lines.push("## 15. Local / Dry-Run / Previous-Good PASS");
  for (const row of payload.nonProductionOrPreviousGoodPasses) lines.push(`- ${row}`);
  lines.push("");
  lines.push("## 16. Next Trading Day Runbook");
  payload.nextTradingDayRunbook.forEach((row, index) => lines.push(`${index + 1}. ${row}`));
  lines.push("");
  lines.push("## 17. Remaining Conditions Before Fresh Unattended YES");
  payload.remainingConditionsBeforeFreshUnattendedYes.forEach((row) => lines.push(`- ${row}`));
  return `${lines.join("\n")}\n`;
}

function verifyPayload(payload, issues) {
  for (const section of REQUIRED_SECTIONS) {
    if (!(section in payload)) issue(issues, `missing_section:${section}`);
  }
  if (payload.releaseIdentity.releaseSha !== payload.releaseIdentity.headSha) issue(issues, "release_sha_not_current_head");
  if (payload.waterRoot.ok !== true) issue(issues, "water_root_not_ok");
  if (payload.resourceChain.ok !== true) issue(issues, "resource_chain_not_ok");
  if (payload.resourceChain.ok === true && Number(payload.resourceChain.rowCount || 0) === 0) issue(issues, "resource_chain_rows_missing_in_report");
  if (payload.productionLiveOpsReadback?.authenticatedReadback?.enabled === true && !resourceChainProtectedReadbackOk(payload)) issue(issues, "resource_chain_authenticated_readback_missing_or_not_armed", { membershipProtectedSummary: payload.resourceChain.membershipProtectedSummary });
  if (payload.dailyManifest.ok !== true && !isPendingNotDueManifest(payload)) issue(issues, "manifest_not_ok");
  if (payload.productionLiveOpsReadback.ok !== true) issue(issues, "production_live_not_ok");
  if (!("authenticatedReadback" in payload.productionLiveOpsReadback)) issue(issues, "production_live_authenticated_readback_missing");
  if (requiresAuthenticatedReadbackForReady(payload) && !authenticatedReadbackOk(payload)) issue(issues, "production_live_authenticated_readback_required_for_ready", { authenticatedReadback: payload.productionLiveOpsReadback.authenticatedReadback });
  if (requiresAuthenticatedReadbackForReady(payload) && payload.protectedReadbackCredential?.ok !== true) issue(issues, "protected_readback_credential_not_ok", { failures: payload.protectedReadbackCredential?.failures || [] });
  if (payload.protectedReadbackCredential?.ok !== true) {
    const credentialActions = Array.isArray(payload.protectedReadbackCredential?.nextActions) ? payload.protectedReadbackCredential.nextActions : [];
    const hasInstallAction = credentialActions.some((row) => row?.code === "install_runtime_credential" || row?.code === "setup_runtime_credential_from_any_directory");
    const hasVerifyAction = credentialActions.some((row) => row?.code === "verify_credential");
    if (!hasInstallAction || !hasVerifyAction) issue(issues, "protected_readback_credential_next_actions_missing", { nextActions: credentialActions });
  }
  if (payload.windowsTaskAndServiceTokenAudit.ok !== true) issue(issues, "service_token_schedule_not_ok");
  if (payload.autoRollForward.ok !== true) issue(issues, "auto_roll_forward_not_ok");
  if (payload.autoRollForward.idempotencyContract?.contract !== "terminal-idempotent-runner-v1") issue(issues, "auto_roll_forward_idempotency_contract_missing", { idempotencyContract: payload.autoRollForward.idempotencyContract });
  const idempotencyInvariants = payload.autoRollForward.idempotencyContract?.invariants || [];
  for (const required of ["every_job_has_idempotency_key", "scanner_jobs_require_current_water_root_ok", "publish_jobs_require_manifest_canary_gate"]) {
    if (!idempotencyInvariants.includes(required)) issue(issues, "auto_roll_forward_idempotency_invariant_missing:" + required, { idempotencyInvariants });
  }
  if (payload.autoRollForward.safeRecoveryPreview?.contract !== "terminal-safe-recovery-preview-v1") issue(issues, "safe_recovery_preview_contract_missing", { safeRecoveryPreview: payload.autoRollForward.safeRecoveryPreview });
  if (payload.autoRollForward.safeRecoveryPreview?.reasonCodeSummary?.ok === false) issue(issues, "safe_recovery_preview_reason_codes_not_ok", { safeRecoveryPreview: payload.autoRollForward.safeRecoveryPreview });
  if (payload.reasonCodeClassifier?.contract !== "terminal-reason-code-classifier-verifier-v1") issue(issues, "reason_code_classifier_contract_missing");
  if (payload.reasonCodeClassifier?.ok !== true) issue(issues, "reason_code_classifier_not_ok", { failures: payload.reasonCodeClassifier?.failures || [] });
  if (Number(payload.reasonCodeClassifier?.unknownEntries || 0) !== 0) issue(issues, "reason_code_classifier_unknown_entries", { unknownEntries: payload.reasonCodeClassifier?.unknownEntries });
  if (payload.reasonCodeClassifier?.opsStatusSummary?.contract !== "terminal-reason-code-summary-v1") issue(issues, "ops_status_reason_code_summary_missing");
  if (payload.reasonCodeClassifier?.opsStatusSummary?.ok !== true || Number(payload.reasonCodeClassifier?.opsStatusSummary?.unknownEntries || 0) !== 0) issue(issues, "ops_status_reason_code_summary_not_ok", { reasonCodeSummary: payload.reasonCodeClassifier?.opsStatusSummary });
  const reasonCodeList = Array.isArray(payload.reasonCodeClassifier?.codes) ? payload.reasonCodeClassifier.codes : Object.keys(payload.reasonCodeClassifier?.codes || {});
  if (reasonCodeList.length === 0) issue(issues, "reason_code_classifier_codes_missing");
  if (payload.finalAudit.layers !== 21) issue(issues, "final_audit_layers_not_21");
  if (payload.finalAudit.ok !== true && !isPendingNotDueManifest(payload)) issue(issues, "final_audit_not_ok");
  if (!payload.productionLivePasses.length) issue(issues, "production_live_passes_missing");
  if (!payload.nonProductionOrPreviousGoodPasses.length) issue(issues, "nonproduction_passes_missing");
  if (payload.nextTradingDayRunbook.length < 8) issue(issues, "runbook_too_short");
  if (payload.remainingConditionsBeforeFreshUnattendedYes.length < 5) issue(issues, "remaining_conditions_too_short");
  if (payload.rootCauseSummary?.contract !== "production-readiness-root-cause-summary-v1") issue(issues, "root_cause_summary_contract_missing", { rootCauseSummary: payload.rootCauseSummary });
  if (!Array.isArray(payload.rootCauseSummary?.categories)) issue(issues, "root_cause_summary_categories_missing", { rootCauseSummary: payload.rootCauseSummary });
  if (payload.rootCauseRecoveryPlan?.contract !== "production-readiness-root-cause-recovery-plan-v1") issue(issues, "root_cause_recovery_plan_contract_missing", { rootCauseRecoveryPlan: payload.rootCauseRecoveryPlan });
  const recoverySteps = Array.isArray(payload.rootCauseRecoveryPlan?.steps) ? payload.rootCauseRecoveryPlan.steps : [];
  if (!Array.isArray(payload.rootCauseRecoveryPlan?.steps)) issue(issues, "root_cause_recovery_plan_steps_missing", { rootCauseRecoveryPlan: payload.rootCauseRecoveryPlan });
  const recoveryCategories = new Set(recoverySteps.map((row) => row?.category).filter(Boolean));
  for (const row of payload.rootCauseSummary?.categories || []) {
    if (!recoveryCategories.has(row.category)) issue(issues, `root_cause_recovery_plan_missing_category:${row.category}`, { rootCauseRecoveryPlan: payload.rootCauseRecoveryPlan });
  }
  for (const row of recoverySteps) {
    if (typeof row.canAutoExecute !== "boolean") issue(issues, `root_cause_recovery_plan_auto_flag_missing:${row.category || "unknown"}`, { step: row });
    if (!row.automation || !row.stopMode) issue(issues, `root_cause_recovery_plan_action_missing:${row.category || "unknown"}`, { step: row });
    if (!Array.isArray(row.requires) || row.requires.length === 0) issue(issues, `root_cause_recovery_plan_requires_missing:${row.category || "unknown"}`, { step: row });
    if (typeof row.canExecuteNow !== "boolean") issue(issues, "root_cause_recovery_plan_execute_now_flag_missing:" + (row.category || "unknown"), { step: row });
    if (!Array.isArray(row.blockedBy)) issue(issues, "root_cause_recovery_plan_blocked_by_missing:" + (row.category || "unknown"), { step: row });
    if (row.canExecuteNow === true && row.canAutoExecute !== true) issue(issues, "root_cause_recovery_plan_execute_now_without_auto:" + (row.category || "unknown"), { step: row });
  }
  const authStep = recoverySteps.find((row) => row.category === "auth_readback");
  const autoExecutableNow = recoverySteps.filter((row) => row.canExecuteNow === true).length;
  if (Number(payload.rootCauseRecoveryPlan?.autoExecutableNow || 0) !== autoExecutableNow) issue(issues, "root_cause_recovery_plan_auto_now_count_mismatch", { rootCauseRecoveryPlan: payload.rootCauseRecoveryPlan, autoExecutableNow });
  if (authStep && authStep.canAutoExecute !== false) issue(issues, "root_cause_recovery_plan_auth_must_be_manual", { authStep });
  if (authStep && authStep.canExecuteNow !== false) issue(issues, "root_cause_recovery_plan_auth_must_not_execute_now", { authStep });
  if (Array.isArray(payload.blockers) && payload.blockers.length > 0) {
    if (Number(payload.rootCauseSummary?.totalBlockers || 0) !== payload.blockers.length) issue(issues, "root_cause_summary_total_mismatch", { totalBlockers: payload.rootCauseSummary?.totalBlockers, blockers: payload.blockers.length });
    if (Number(payload.rootCauseSummary?.rootCauseCount || 0) === 0) issue(issues, "root_cause_summary_empty_for_blockers", { rootCauseSummary: payload.rootCauseSummary });
    if (Number(payload.rootCauseSummary?.unknownBlockers || 0) > 0) issue(issues, "root_cause_summary_unknown_blockers", { rootCauseSummary: payload.rootCauseSummary });
  }
  for (const phrase of ["Water Root", "Daily Manifest", "Canary Publish", "RunId Closure"]) {
    if (!payload.nextTradingDayRunbook.join(" ").includes(phrase)) issue(issues, `runbook_missing:${phrase}`);
  }
}

async function main() {
  const verifyOnly = process.argv.includes("--verify-only");
  const refreshProductionLive = process.argv.includes("--refresh-production-live") || process.argv.includes("--refresh-live");
  const requireProtectedReadback = process.argv.includes("--require-protected-readback") || /^(1|true|yes)$/i.test(String(process.env.FUMAN_REQUIRE_PROTECTED_READBACK || ""));
  const refreshResourceChain = process.argv.includes("--refresh-resource-chain") || requireProtectedReadback;
  const reportFile = path.join(OUT_DIR, "production-unattended-readiness-report.json");
  if (verifyOnly) {
    const payload = readJson(reportFile, null);
    const issues = [];
    if (!payload) issue(issues, "report_missing", { reportFile });
    else verifyPayload(payload, issues);
    console.log(JSON.stringify({ ok: issues.length === 0, contract: payload?.contract || "", issues, reportFile }, null, 2));
    if (issues.length) process.exitCode = 1;
    return;
  }

  await fs.promises.mkdir(OUT_DIR, { recursive: true });
  const refreshFailures = [];
  if (refreshProductionLive) {
    const args = requireProtectedReadback ? ["--require-protected-readback"] : [];
    const failure = runNodeScriptBestEffort(path.join("scripts", "verify-terminal-ops-production-live.js"), args, "production_live_readback");
    if (failure) refreshFailures.push(failure);
  }
  if (refreshResourceChain) {
    const preWaterRoot = readJson(FILES.waterRoot, {});
    const preManifest = readJson(FILES.manifest, {});
    const refreshExpectedDate = compactDate(
      preWaterRoot?.expectedDate
      || preWaterRoot?.marketCalendar?.row?.displayTradeDate
      || preWaterRoot?.marketCalendar?.displayTradeDate
      || preWaterRoot?.displayTradeDate
      || preManifest?.tradeDate
    );
    const resourceArgs = ["--require-unattended"];
    if (refreshExpectedDate) resourceArgs.push(`--expected-date=${refreshExpectedDate}`);
    const failure = runNodeScriptBestEffort(path.join("scripts", "verify-terminal-resource-chain.js"), resourceArgs, "resource_chain_readback");
    if (failure) refreshFailures.push(failure);
  }
  const issues = [];
  const waterRoot = readJson(FILES.waterRoot, {});
  const resourceChain = readJson(FILES.resourceChain, {});
  const manifest = readJson(FILES.manifest, {});
  const productionLive = readJson(FILES.productionLive, {});
  const protectedReadbackCredential = readJson(FILES.protectedReadbackCredential, {});
  const serviceTokenSchedule = readJson(FILES.serviceTokenSchedule, {});
  const rollForward = readJson(FILES.rollForward, {});
  const finalAudit = readJson(FILES.finalAudit, {});
  const reasonCodeClassifier = readJson(FILES.reasonCodeClassifier, {});
  const opsStatus = readJson(path.join(ROOT, "data", "terminal-ops-status-latest.json"), {});

  const payload = {
    contract: "production-unattended-readiness-report-v1",
    checkedAt: new Date().toISOString(),
    releaseIdentity: buildReleaseIdentity(productionLive),
    waterRoot: buildWaterRoot(waterRoot),
    resourceChain: buildResourceChain(resourceChain),
    dailyManifest: buildManifest(manifest),
    productionLiveOpsReadback: buildProductionLive(productionLive),
    protectedReadbackCredential: buildProtectedReadbackCredential(protectedReadbackCredential),
    windowsTaskAndServiceTokenAudit: buildServiceToken(serviceTokenSchedule),
    autoRollForward: buildRollForward(rollForward),
    reasonCodeClassifier: buildReasonCodeClassifier(reasonCodeClassifier, opsStatus),
    finalAudit: buildFinalAudit(finalAudit),
    blockers: [],
    rootCauseSummary: buildRootCauseSummary([]),
    rootCauseRecoveryPlan: buildRootCauseRecoveryPlan(buildRootCauseSummary([]), {}),
    productionLivePasses: [],
    nonProductionOrPreviousGoodPasses: [],
    nextTradingDayRunbook: [],
    remainingConditionsBeforeFreshUnattendedYes: [],
    status: "UNKNOWN",
    ok: false,
    issues: [],
    refreshFailures,
  };

  for (const failure of refreshFailures) issue(issues, `refresh_failed:${failure.step}`, failure);
  verifyPayload(payload, issues);
  payload.blockers = collectBlockers(payload, issues);
  payload.rootCauseSummary = buildRootCauseSummary(payload.blockers);
  payload.rootCauseRecoveryPlan = buildRootCauseRecoveryPlan(payload.rootCauseSummary, payload);
  if (Number(payload.rootCauseSummary?.unknownBlockers || 0) === 0) {
    payload.issues = payload.issues.filter((row) => (row.code || row.issue) !== "root_cause_summary_unknown_blockers");
  }
  const passBuckets = classifyPasses(payload);
  payload.productionLivePasses = passBuckets.productionLivePasses;
  payload.nonProductionOrPreviousGoodPasses = passBuckets.nonProductionOrPreviousGoodPasses;
  payload.nextTradingDayRunbook = nextRunbook(payload);
  payload.remainingConditionsBeforeFreshUnattendedYes = remainingConditions(payload);
  const finalIssues = [];
  for (const failure of refreshFailures) issue(finalIssues, `refresh_failed:${failure.step}`, failure);
  verifyPayload(payload, finalIssues);
  payload.issues = finalIssues;
  payload.blockers = collectBlockers(payload, finalIssues);
  payload.rootCauseSummary = buildRootCauseSummary(payload.blockers);
  payload.rootCauseRecoveryPlan = buildRootCauseRecoveryPlan(payload.rootCauseSummary, payload);
  if (Number(payload.rootCauseSummary?.unknownBlockers || 0) === 0) {
    payload.issues = payload.issues.filter((row) => (row.code || row.issue) !== "root_cause_summary_unknown_blockers");
  }
  payload.ok = payload.issues.length === 0;
  payload.status = isPendingNotDueManifest(payload)
    ? "PENDING_NOT_DUE"
    : (payload.ok
      ? (isPreviousGoodWaterRoot(payload) ? "PREVIOUS_GOOD_HOLD_READY" : "PRODUCTION_READY")
      : "NOT_READY");

  await fs.promises.writeFile(reportFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.promises.writeFile(path.join(OUT_DIR, "production-unattended-readiness-report.md"), markdown(payload), "utf8");
  console.log(JSON.stringify({
    ok: payload.ok,
    contract: payload.contract,
    status: payload.status,
    releaseSha: payload.releaseIdentity.releaseSha,
    tradeDate: payload.dailyManifest.tradeDate,
    waterRootStatus: payload.waterRoot.status,
    blockers: payload.blockers.map((row) => row.blocker),
    rootCauseSummary: payload.rootCauseSummary,
    rootCauseRecoveryPlan: payload.rootCauseRecoveryPlan,
    reportFile,
  }, null, 2));
  if (!payload.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[production-unattended-readiness-report] failed: ${error.stack || error.message || error}`);
  process.exit(1);
});
