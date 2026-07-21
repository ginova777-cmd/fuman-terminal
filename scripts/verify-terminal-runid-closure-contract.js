const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MANIFEST_FILE = path.join(ROOT, "outputs", "daily-terminal-run", "daily-terminal-run-latest.json");
const CONTROL_PLANE_FILE = path.join(ROOT, "outputs", "terminal-control-plane", "terminal-control-plane.json");
const RESOURCE_CHAIN_FILE = path.join(ROOT, "outputs", "terminal-resource-chain-audit", "terminal-resource-chain-audit.json");
const PACKAGE_FILE = path.join(ROOT, "package.json");
const RESOURCE_CHAIN_SCRIPT = path.join(ROOT, "scripts", "verify-terminal-resource-chain.js");
const OUT_DIR = path.join(ROOT, "outputs", "terminal-runid-closure-contract");

const REQUIRED_ENDPOINT_MARKERS = [
  "/api/desktop-route-snapshot",
  "/api/terminal-fast-bundle",
  "/api/mobile-fragment",
  "/api/scorecard",
];

const REQUIRED_RUNID_KEYS = [
  "scanner",
  "supabase",
  "productionApi",
  "desktop",
  "mobile",
  "scorecard88",
];

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function runIdDate(value) {
  const match = String(value || "").match(/(?:^|[-_])(\d{8})(?:[-_]|$)/);
  return match ? match[1] : "";
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function isProtectedMarker(value) {
  return /membership-protected|membership-required|not-read|locked|missing-bearer-token/i.test(String(value || ""));
}

function closureMode(manifest = {}, controlPlane = {}) {
  const text = [
    manifest.waterRoot?.status,
    manifest.waterRoot?.reason,
    manifest.blocker,
    controlPlane.decision?.state,
    controlPlane.decision?.reason,
    controlPlane.canaryPublish?.status,
    manifest.unattendedStatus,
  ].map((value) => String(value || "").toLowerCase()).join(" ");
  const tradingDayWait = text.includes("trading_day") || text.includes("wait_source_window") || controlPlane.decision?.state === "PENDING_NOT_DUE";
  if (text.includes("market_closed") && !tradingDayWait) return "market_closed_previous_good_closure";
  if (tradingDayWait || text.includes("previous_good")) return "trading_day_previous_good_hold_closure";
  return "formal_trading_day_closure";
}

function acceptableManifestStatus(status, previousGoodClosure) {
  return status === "YES" || (previousGoodClosure === true && status === "PREVIOUS_GOOD_HOLD");
}

function validateModule(row, manifest, controlPlane, issues) {
  const key = row.key || row.label || "unknown";
  const tradeDate = String(manifest.tradeDate || "");
  const ids = row.runIds || {};
  const rowIssuesText = Array.isArray(row.issues) ? row.issues.join(" ") : "";
  const pendingNotDue = row.pendingNotDue === true
    || String(row.status || "").toLowerCase() === "pending_not_due"
    || rowIssuesText.toLowerCase().includes("pending_not_due");
  const rawIds = [row.runId, ...REQUIRED_RUNID_KEYS.map((field) => ids[field])]
    .filter((value) => value && !isProtectedMarker(value));
  const uniqueIds = unique(rawIds);
  const primaryRunId = row.runId || uniqueIds[0] || "";
  const runDate = runIdDate(primaryRunId);
  const closureRow = (controlPlane.runIdClosure?.modules || []).find((item) => item.key === row.key);

  if (pendingNotDue) {
    if (!closureRow) issues.push(`${key}:control_plane_runId_closure_row_missing`);
    return {
      key,
      runId: primaryRunId,
      runDate,
      uniqueRunIds: uniqueIds,
      scorecard88Protection: row.scorecard88Protection || "",
      pendingNotDue: true,
      ok: true,
    };
  }

  if (!primaryRunId) issues.push(`${key}:missing_primary_runId`);
  if (uniqueIds.length > 1) issues.push(`${key}:runId_mismatch:${uniqueIds.join(",")}`);
  if (tradeDate && runDate && runDate !== tradeDate) issues.push(`${key}:runDate_mismatch:${runDate}!=${tradeDate}`);
  if (row.ok !== true) issues.push(`${key}:manifest_module_not_ok:${(row.issues || [])[0] || "unknown"}`);
  if (row.complete !== true) issues.push(`${key}:manifest_complete_not_true`);
  if (row.fallback === true) issues.push(`${key}:manifest_fallback_true`);

  const protected88 = row.scorecard88Protection === "membership-protected" || isProtectedMarker(ids.scorecard88);
  if (!protected88 && !ids.scorecard88) issues.push(`${key}:scorecard88_runId_missing_or_unprotected`);

  if (!closureRow) {
    issues.push(`${key}:control_plane_runId_closure_row_missing`);
  } else {
    if (closureRow.ok !== true) issues.push(`${key}:control_plane_runId_closure_not_ok:${closureRow.issue || "unknown"}`);
    if (primaryRunId && closureRow.runId && closureRow.runId !== primaryRunId) {
      issues.push(`${key}:control_plane_runId_differs:${closureRow.runId}!=${primaryRunId}`);
    }
  }

  return {
    key,
    runId: primaryRunId,
    runDate,
    uniqueRunIds: uniqueIds,
    scorecard88Protection: row.scorecard88Protection || "",
    ok: row.ok === true && row.complete === true && row.fallback !== true && uniqueIds.length <= 1,
  };
}

function validateResourceChain(resourceChain, manifest, issues) {
  if (!resourceChain || resourceChain.ok !== true) {
    issues.push(`resource_chain_not_ok:${resourceChain?.results?.find?.((row) => !row.ok)?.key || "missing"}`);
    return [];
  }
  const rows = Array.isArray(resourceChain.results) ? resourceChain.results.filter((row) => row.key !== "market") : [];
  const manifestKeys = new Set((manifest.modules || []).map((row) => row.key));
  for (const key of manifestKeys) {
    const row = rows.find((item) => item.key === key);
    if (!row) {
      issues.push(`${key}:resource_chain_row_missing`);
      continue;
    }
    if (row.ok !== true) issues.push(`${key}:resource_chain_row_not_ok:${(row.issues || [])[0] || "unknown"}`);
  }
  return rows.map((row) => ({
    key: row.key,
    ok: row.ok === true,
    liveRunId: row.live?.runId || "",
    terminalRunId: row.terminalApi?.runId || "",
    desktopRunId: row.desktopSnapshot?.runId || "",
    mobileRunId: row.mobileFragment?.runId || "",
    scorecardRunId: row.scorecard?.runId || row.scorecard?.error || "",
  }));
}

async function main() {
  await fs.promises.mkdir(OUT_DIR, { recursive: true });
  const issues = [];
  const manifest = readJson(MANIFEST_FILE, {});
  const controlPlane = readJson(CONTROL_PLANE_FILE, {});
  const resourceChain = readJson(RESOURCE_CHAIN_FILE, {});
  const pkg = readJson(PACKAGE_FILE, {});
  const resourceChainScript = readText(RESOURCE_CHAIN_SCRIPT);

  if (manifest.contract !== "daily-terminal-run-manifest-v1") issues.push("manifest_contract_missing");
  if (!Array.isArray(manifest.modules) || manifest.modules.length === 0) issues.push("manifest_modules_missing");
  const hardBlockedManifestModules = (manifest.modules || []).filter((row) => row.ok !== true && row.pendingNotDue !== true);
  const manifestPendingNotDue = hardBlockedManifestModules.length === 0
    && (String(manifest.blocker || "").toLowerCase().includes("pending_not_due")
      || (manifest.modules || []).some((row) => row.pendingNotDue === true));
  if (manifest.ok !== true) {
    issues.push(manifestPendingNotDue
      ? `manifest_pending_not_due:${manifest.blocker || "pending_not_due"}`
      : `manifest_not_ok:${manifest.blocker || "unknown"}`);
  }
  const mode = closureMode(manifest, controlPlane);
  const previousGoodClosure = mode === "market_closed_previous_good_closure" || mode === "trading_day_previous_good_hold_closure";
  if (!manifestPendingNotDue && !acceptableManifestStatus(manifest.unattendedStatus, previousGoodClosure)) issues.push(`manifest_not_fresh_yes_or_previous_good_hold:${manifest.unattendedStatus || "missing"}`);

  const controlPlaneAccepted = controlPlane.contract === "terminal-control-plane-v1"
    && controlPlane.dailyManifest?.ok === true
    && controlPlane.runIdClosure?.ok === true
    && (
      controlPlane.decision?.unattendedStatus === "YES"
      || controlPlane.canaryPublish?.status === "NOT_ARMED_MARKET_CLOSED_PREVIOUS_GOOD"
      || controlPlane.canaryPublish?.status === "NOT_ARMED_TRADING_DAY_PREVIOUS_GOOD"
    );
  if (controlPlane.contract !== "terminal-control-plane-v1") issues.push("control_plane_contract_missing");
  if (controlPlane.runIdClosure?.ok !== true && controlPlane.runIdClosure?.status !== "PENDING_NOT_DUE") {
    issues.push(`control_plane_runId_closure_not_ok:${(controlPlane.runIdClosure?.blockers || [])[0] || "unknown"}`);
  }

  if (previousGoodClosure && controlPlane.canaryPublish?.scorecardPublishAllowed === true) {
    issues.push("previous_good_hold_scorecard_publish_allowed_true");
  }

  const moduleRows = (manifest.modules || []).map((row) => validateModule(row, manifest, controlPlane, issues));
  const resourceRows = validateResourceChain(resourceChain, manifest, issues);

  const scripts = pkg.scripts || {};
  if (!scripts["verify:terminal-resource-chain:unattended"]) issues.push("package_missing_verify_terminal_resource_chain_unattended");
  if (!scripts["verify:terminal-runid-closure"]) issues.push("package_missing_verify_terminal_runid_closure");
  const rootScript = String(scripts["verify:terminal-unattended-root"] || "");
  for (const required of ["manifest:daily-terminal-run", "orchestrator:state:from-existing", "verify:terminal-control-plane:from-existing", "verify:terminal-runid-closure"]) {
    if (!rootScript.includes(required)) issues.push(`root_gate_missing_${required}`);
  }
  const manifestCommands = Array.isArray(manifest.commands) ? manifest.commands : [];
  const manifestRanResourceChain = manifestCommands.some((cmd) => cmd.label === "terminal-resource-chain:unattended" && cmd.ok === true);
  if (!manifestRanResourceChain) issues.push("manifest_did_not_run_terminal_resource_chain_unattended");

  for (const marker of REQUIRED_ENDPOINT_MARKERS) {
    if (!resourceChainScript.includes(marker)) issues.push(`resource_chain_script_missing_endpoint_marker:${marker}`);
  }
  if (!resourceChainScript.includes("scorecardSourceReportForConfig")) issues.push("resource_chain_script_missing_scorecard_source_report_lookup");
  if (!resourceChainScript.includes("protectedReadbackAuth")) issues.push("resource_chain_script_missing_membership_readback_split");

  const payload = {
    ok: issues.length === 0,
    contract: "terminal-runid-closure-contract-v1",
    checkedAt: new Date().toISOString(),
    mode,
    tradeDate: manifest.tradeDate || "",
    manifest: {
      ok: manifest.ok === true,
      unattendedStatus: manifest.unattendedStatus || "",
      modules: moduleRows,
    },
    controlPlane: {
      accepted: controlPlaneAccepted,
      dailyManifestOk: controlPlane.dailyManifest?.ok === true,
      runIdClosureStatus: controlPlane.runIdClosure?.status || "",
      canaryStatus: controlPlane.canaryPublish?.status || "",
    },
    resourceChain: {
      ok: resourceChain.ok === true,
      expectedDate: resourceChain.expectedDate || "",
      rows: resourceRows,
    },
    guarantees: [
      "scanner/latest/API/desktop/mobile/88 runId mismatch fails",
      "previous-good hold mode cannot publish a fresh scorecard",
      "membership-protected /88 is display protection, not compute failure",
      "root gate builds manifest from production resource-chain readback exactly once",
    ],
    issues,
  };
  const jsonFile = path.join(OUT_DIR, "terminal-runid-closure-contract.json");
  await fs.promises.writeFile(jsonFile, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify(payload, null, 2));
  if (!payload.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[terminal-runid-closure-contract] failed: ${error.stack || error.message || error}`);
  process.exit(1);
});
