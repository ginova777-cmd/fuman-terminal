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
  serviceTokenSchedule: path.join(ROOT, "outputs", "backend-service-token-schedule-contract", "backend-service-token-schedule-contract.json"),
  rollForward: path.join(ROOT, "outputs", "terminal-roll-forward", "terminal-auto-roll-forward.json"),
  predictivePreflight: path.join(ROOT, "outputs", "terminal-predictive-preflight", "terminal-predictive-preflight.json"),
  orchestrator: path.join(ROOT, "outputs", "terminal-orchestrator", "terminal-orchestrator-state.json"),
  controlPlane: path.join(ROOT, "outputs", "terminal-control-plane", "terminal-control-plane.json"),
  policy: path.join(ROOT, "outputs", "autonomous-ops-policy", "autonomous-ops-policy.json"),
};

const REQUIRED_SECTIONS = [
  "releaseIdentity",
  "waterRoot",
  "resourceChain",
  "dailyManifest",
  "productionLiveOpsReadback",
  "windowsTaskAndServiceTokenAudit",
  "autoRollForward",
  "blockers",
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

function buildProductionLive(productionLive) {
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
    authenticatedReadback: productionLive?.authenticatedReadback || { mode: "legacy-missing", ok: false, enabled: false, endpoints: [] },
    issues: productionLive?.issues || [],
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
    actions: rollForward?.actions || [],
    executed: rollForward?.executed || [],
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
    windowsTaskAndServiceTokenAudit: payload.windowsTaskAndServiceTokenAudit,
    autoRollForward: payload.autoRollForward,
  })) {
    if (section.ok !== true) blockers.push({ blocker: `${key}_not_ok`, severity: "critical" });
  }
  if (payload.resourceChain.ok === true && Number(payload.resourceChain.rowCount || 0) === 0) {
    blockers.push({ blocker: "resource_chain_rows_missing_in_report", severity: "critical" });
  }
  for (const row of payload.dailyManifest.modules || []) {
    if (row.ok !== true) blockers.push({ blocker: `manifest_module_not_ok:${row.key}`, severity: "critical", issues: row.issues });
    if (row.fallback === true) blockers.push({ blocker: `manifest_module_fallback:${row.key}`, severity: "high" });
  }
  for (const row of payload.productionLiveOpsReadback.issues || []) {
    blockers.push({ blocker: `production_live_issue:${row}`, severity: "critical" });
  }
  for (const row of payload.windowsTaskAndServiceTokenAudit.issues || []) {
    blockers.push({ blocker: `service_token_schedule_issue:${row.issue || row}`, severity: "critical" });
  }
  for (const row of issues) blockers.push({ blocker: row.code, severity: "critical", details: row.details });
  return blockers;
}

function isPreviousGoodWaterRoot(payload = {}) {
  const text = `${payload.waterRoot?.status || ""} ${payload.waterRoot?.reason || ""}`.toLowerCase();
  return text.includes("previous_good") || text.includes("wait_source_window") || text.includes("formal_scan_skipped");
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

  if (payload.waterRoot.ok) nonProductionOrPreviousGoodPasses.push(`Water Root local/live artifact PASS in ${payload.waterRoot.status || "unknown"} mode.`);
  if (payload.dailyManifest.ok) nonProductionOrPreviousGoodPasses.push(`Daily Manifest PASS for tradeDate ${payload.dailyManifest.tradeDate}.`);
  if (payload.resourceChain.ok) nonProductionOrPreviousGoodPasses.push("Resource-chain unattended verifier PASS; protected production surfaces are classified separately.");
  if (payload.autoRollForward.ok) nonProductionOrPreviousGoodPasses.push(`Auto Roll Forward ${payload.autoRollForward.mode || "dry-run"} PASS with ${payload.autoRollForward.jobs} queued jobs.`);
  if (payload.windowsTaskAndServiceTokenAudit.ok) nonProductionOrPreviousGoodPasses.push("Windows Task / service-token schedule contract PASS.");
  if (isPreviousGoodWaterRoot(payload)) nonProductionOrPreviousGoodPasses.push("Current YES is previous-good hold readiness, not proof of a new trading-day fresh scan.");
  if (!authReadback.enabled) nonProductionOrPreviousGoodPasses.push(`Authenticated protected readback is ${authReadback.mode || "not_armed"}; run with member token/email to prove protected API runId display after login.`);
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
  if (!payload.productionLiveOpsReadback.authenticatedReadback?.enabled) conditions.push("Authenticated protected readback must be armed with a member token/email before claiming protected display closure.");
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
  lines.push("## 6. Windows Task / Service Token Audit");
  lines.push(`- command: ${payload.windowsTaskAndServiceTokenAudit.command}`);
  lines.push(`- ok/activeTaskCount: ${payload.windowsTaskAndServiceTokenAudit.ok} / ${payload.windowsTaskAndServiceTokenAudit.activeTaskCount}`);
  lines.push(`- required tasks: ${payload.windowsTaskAndServiceTokenAudit.requiredActiveTasks.join(", ")}`);
  lines.push(`- scanner service files: ${payload.windowsTaskAndServiceTokenAudit.scannerServiceKeys.map((row) => `${row.file}:${row.ok}`).join(", ")}`);
  lines.push("");
  lines.push("## 7. Auto Roll Forward");
  lines.push(`- command: ${payload.autoRollForward.command}`);
  lines.push(`- ok/mode/state/jobs/executable/blocked: ${payload.autoRollForward.ok} / ${payload.autoRollForward.mode} / ${payload.autoRollForward.decision?.state || "--"} / ${payload.autoRollForward.jobs} / ${payload.autoRollForward.executableJobs} / ${payload.autoRollForward.blockedJobs}`);
  lines.push("");
  lines.push("## 8. Blockers");
  if (payload.blockers.length === 0) lines.push("- none");
  for (const row of payload.blockers) lines.push(`- ${row.severity || "unknown"}: ${row.blocker}`);
  lines.push("");
  lines.push("## 9. Production Live PASS");
  for (const row of payload.productionLivePasses) lines.push(`- ${row}`);
  lines.push("");
  lines.push("## 10. Local / Dry-Run / Previous-Good PASS");
  for (const row of payload.nonProductionOrPreviousGoodPasses) lines.push(`- ${row}`);
  lines.push("");
  lines.push("## 11. Next Trading Day Runbook");
  payload.nextTradingDayRunbook.forEach((row, index) => lines.push(`${index + 1}. ${row}`));
  lines.push("");
  lines.push("## 12. Remaining Conditions Before Fresh Unattended YES");
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
  if (payload.dailyManifest.ok !== true) issue(issues, "manifest_not_ok");
  if (payload.productionLiveOpsReadback.ok !== true) issue(issues, "production_live_not_ok");
  if (!("authenticatedReadback" in payload.productionLiveOpsReadback)) issue(issues, "production_live_authenticated_readback_missing");
  if (payload.windowsTaskAndServiceTokenAudit.ok !== true) issue(issues, "service_token_schedule_not_ok");
  if (payload.autoRollForward.ok !== true) issue(issues, "auto_roll_forward_not_ok");
  if (!payload.productionLivePasses.length) issue(issues, "production_live_passes_missing");
  if (!payload.nonProductionOrPreviousGoodPasses.length) issue(issues, "nonproduction_passes_missing");
  if (payload.nextTradingDayRunbook.length < 8) issue(issues, "runbook_too_short");
  if (payload.remainingConditionsBeforeFreshUnattendedYes.length < 5) issue(issues, "remaining_conditions_too_short");
  for (const phrase of ["Water Root", "Daily Manifest", "Canary Publish", "RunId Closure"]) {
    if (!payload.nextTradingDayRunbook.join(" ").includes(phrase)) issue(issues, `runbook_missing:${phrase}`);
  }
}

async function main() {
  const verifyOnly = process.argv.includes("--verify-only");
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
  const issues = [];
  const waterRoot = readJson(FILES.waterRoot, {});
  const resourceChain = readJson(FILES.resourceChain, {});
  const manifest = readJson(FILES.manifest, {});
  const productionLive = readJson(FILES.productionLive, {});
  const serviceTokenSchedule = readJson(FILES.serviceTokenSchedule, {});
  const rollForward = readJson(FILES.rollForward, {});

  const payload = {
    contract: "production-unattended-readiness-report-v1",
    checkedAt: new Date().toISOString(),
    releaseIdentity: buildReleaseIdentity(productionLive),
    waterRoot: buildWaterRoot(waterRoot),
    resourceChain: buildResourceChain(resourceChain),
    dailyManifest: buildManifest(manifest),
    productionLiveOpsReadback: buildProductionLive(productionLive),
    windowsTaskAndServiceTokenAudit: buildServiceToken(serviceTokenSchedule),
    autoRollForward: buildRollForward(rollForward),
    blockers: [],
    productionLivePasses: [],
    nonProductionOrPreviousGoodPasses: [],
    nextTradingDayRunbook: [],
    remainingConditionsBeforeFreshUnattendedYes: [],
    status: "UNKNOWN",
    ok: false,
    issues: [],
  };

  verifyPayload(payload, issues);
  payload.blockers = collectBlockers(payload, issues);
  const passBuckets = classifyPasses(payload);
  payload.productionLivePasses = passBuckets.productionLivePasses;
  payload.nonProductionOrPreviousGoodPasses = passBuckets.nonProductionOrPreviousGoodPasses;
  payload.nextTradingDayRunbook = nextRunbook(payload);
  payload.remainingConditionsBeforeFreshUnattendedYes = remainingConditions(payload);
  const finalIssues = [];
  verifyPayload(payload, finalIssues);
  payload.issues = finalIssues;
  payload.blockers = collectBlockers(payload, finalIssues);
  payload.ok = finalIssues.length === 0;
  payload.status = payload.ok
    ? (isPreviousGoodWaterRoot(payload) ? "PREVIOUS_GOOD_HOLD_READY" : "PRODUCTION_READY")
    : "NOT_READY";

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
    reportFile,
  }, null, 2));
  if (!payload.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[production-unattended-readiness-report] failed: ${error.stack || error.message || error}`);
  process.exit(1);
});
