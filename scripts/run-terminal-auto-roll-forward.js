const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { classifyReason } = require("../lib/terminal-reason-code-classifier");
const { visibleCredentialState } = require("../lib/protected-readback-credential");
const { FORMAL_SCAN_MODULES, evaluateFormalEntryGate } = require("../lib/terminal-formal-entry-gate");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.resolve(process.argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length) || "outputs/terminal-roll-forward");
const RECEIPT_DIR = path.join(OUT_DIR, "receipts");
const PROTECTED_READBACK_CREDENTIAL_FILE = path.join(ROOT, "outputs", "protected-readback-credential", "protected-readback-credential.json");
const WATER_ROOT_FILE = path.join(ROOT, "outputs", "terminal-water-root", "terminal-water-root.json");
const IDEMPOTENCY_CONTRACT = {
  contract: "terminal-idempotent-runner-v1",
  invariants: [
    "every_job_has_idempotency_key",
    "every_job_has_receipt_file",
    "every_job_has_retry_ledger",
    "retry_attempts_are_bounded",
    "failed_action_requires_reverification",
    "dead_letter_stops_auto_execution",
    "auth_jobs_never_auto_execute",
    "scanner_jobs_require_water_root_and_apply_scanners",
    "scanner_jobs_require_current_water_root_ok",
    "scanner_jobs_require_policy_formal_scan_allowed",
    "completed_action_receipts_skip_reexecution",
    "publish_jobs_require_manifest_canary_gate",
    "deferred_publish_jobs_never_auto_execute",
  ],
};
const APPLY = process.argv.includes("--apply");
const APPLY_SCANNERS = process.argv.includes("--apply-scanners");
const SELF_TEST = process.argv.includes("--self-test");
const ALLOW_DEGRADED_PUBLISH = process.argv.includes("--allow-degraded-publish");
const EXPECTED_DATE = String(process.argv.find((arg) => arg.startsWith("--expected-date=")) || "").slice(16).replace(/\D/g, "").slice(0, 8);
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";


function compactReasonClassification(input = {}) {
  const classification = classifyReason(input);
  const codes = Array.isArray(classification.codes) ? classification.codes : [];
  return {
    reasonCodes: codes.map((row) => row.code).filter(Boolean),
    primaryReasonCode: classification.primaryCode || codes[0]?.code || "",
    reasonActions: [...new Set(codes.map((row) => row.action).filter(Boolean))],
    reasonLayers: [...new Set(codes.map((row) => row.layer).filter(Boolean))],
    reasonSeverity: codes.some((row) => row.severity === "critical") ? "critical" : codes[0]?.severity || "",
    reasonUnknown: classification.unknown === true,
  };
}

function buildReasonCodeSummary(actions = []) {
  return {
    contract: "terminal-roll-forward-reason-code-summary-v1",
    ok: actions.every((row) => row.reasonUnknown !== true),
    actions: actions.length,
    unknownActions: actions.filter((row) => row.reasonUnknown === true).length,
    criticalActions: actions.filter((row) => row.reasonSeverity === "critical").length,
    codes: [...new Set(actions.flatMap((row) => row.reasonCodes || []))].sort(),
  };
}
function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function runCommand(step) {
  const command = String(step.command || "");
  const result = spawnSync(command, step.args || [], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...(step.env || {}) },
    shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(command),
    timeout: Number(step.timeoutMs || 60000),
  });
  return {
    label: step.label,
    command: printable(step),
    exitCode: result.status ?? 1,
    ok: result.status === 0,
    allowedFailure: step.allowFailure === true,
    stdout: String(result.stdout || "").slice(-3000),
    stderr: String(result.stderr || "").slice(-3000),
  };
}

function printable(step) {
  return [step.command, ...(step.args || [])].join(" ");
}

function npmRun(script, extraArgs = []) {
  return {
    command: npmBin,
    args: ["run", script, ...extraArgs],
    label: `npm:${script}`,
  };
}

function scorecardTerminalSourceRun() {
  const date = currentTradeDate();
  return {
    ...npmRun("scorecard:terminal-source"),
    env: {
      FUMAN_SCORECARD_EXPECTED_DATE: date,
      FUMAN_SCANNER_TARGET_DATE: date,
      FUMAN_SCANNER_TARGET_TRADE_DATE: date,
    },
  };
}
function nodeRun(script, args = [], label = script) {
  return {
    command: process.execPath,
    args: ["--use-system-ca", script, ...args],
    label,
  };
}

function refreshOrchestratorInputs() {
  const args = EXPECTED_DATE ? [`--expected-date=${EXPECTED_DATE}`] : [];
  const manifestArgs = [
    "--from-existing",
    ...args,
    "--allow-non-green-exit-zero",
    "--scorecard-candidate-file=C:\\fuman-runtime\\data\\scorecard-terminal-current.json",
  ];
  const manifest = runCommand({
    ...nodeRun("scripts/write-daily-terminal-run-manifest.js", manifestArgs, "refresh-daily-manifest"),
    allowFailure: true,
    timeoutMs: 120000,
  });
  const orchestrator = runCommand({
    ...nodeRun("scripts/write-terminal-orchestrator-state.js", ["--from-existing", ...args], "refresh-orchestrator-state"),
    allowFailure: true,
    timeoutMs: 120000,
  });
  return [manifest, orchestrator];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function protectedReadbackCredentialArmed(override) {
  if (typeof override === "boolean") return override;
  try {
    const state = visibleCredentialState();
    if (state.tokenArmed === true) return true;
    if (state.emailArmed === true && state.passwordArmed === true) return true;
  } catch {
    // Fall back to the verifier artifact below.
  }
  const credential = readJson(PROTECTED_READBACK_CREDENTIAL_FILE, {});
  return credential?.ok === true && credential?.armed === true;
}

function waterRootFormalEntryAllowed(waterRoot = {}) {
  return evaluateFormalEntryGate(waterRoot, EXPECTED_DATE).ok;
}

function scannerRequiresFormalEntry(job = {}, key = "") {
  if (job.requiresFormalEntry === true) return true;
  if (job.requiresFormalEntry === false) return false;
  // Only the intraday daytrade scanner needs the opening formal-entry gate.
  // Other due-time complete scans still require Water Root PASS, but must not be
  // blocked by Strategy2's rolling/live formal-entry window.
  return String(key || "").toLowerCase() === "strategy2";
}

function nextWeekdayYmd(yyyymmdd = "") {
  const raw = String(yyyymmdd || "").replace(/\D/g, "").slice(0, 8);
  if (!/^\d{8}$/.test(raw)) return raw;
  const date = new Date(Date.UTC(Number(raw.slice(0, 4)), Number(raw.slice(4, 6)) - 1, Number(raw.slice(6, 8))));
  for (let i = 0; i < 7; i += 1) {
    date.setUTCDate(date.getUTCDate() + 1);
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) {
      return String(date.getUTCFullYear()) + String(date.getUTCMonth() + 1).padStart(2, "0") + String(date.getUTCDate()).padStart(2, "0");
    }
  }
  return raw;
}

function nextFormalWindowResume(waterRoot = null) {
  const artifact = waterRoot || readJson(WATER_ROOT_FILE, null) || {};
  const calendar = artifact.marketCalendar?.row || artifact.marketCalendar || artifact.calendar?.row || artifact.calendar || {};
  const formalWindow = calendar.formalSourceWindow || artifact.formalSourceWindow || {};
  const start = formalWindow.start || "08:30";
  const baseDate = String(calendar.marketDate || artifact.tradeDate || artifact.expectedDate || currentTradeDate()).replace(/\D/g, "").slice(0, 8);
  const afterWindow = calendar.marketStatus === "after_formal_source_window"
    || calendar.formalSourceWindow?.phase === "after_formal_source_window"
    || Number(calendar.formalSourceWindow?.currentMinute ?? -1) > Number(calendar.formalSourceWindow?.endMinute ?? 99999);
  const targetDate = afterWindow ? nextWeekdayYmd(baseDate) : baseDate;
  return {
    deferred: true,
    resumePolicy: "auto_resume_next_formal_source_window",
    resumeTradeDate: targetDate || currentTradeDate(),
    resumeAfterLocalTime: start,
    reason: "formal_entry_not_allowed_now_preserve_previous_good",
  };
}

function scannerWaterRootGate(waterRoot = null, options = {}) {
  const artifact = waterRoot || readJson(WATER_ROOT_FILE, null);
  if (!artifact) {
    return { ok: false, guard: "water_root_artifact_missing_scanner_blocked", reason: "water_root_artifact_missing" };
  }
  if (artifact.ok !== true) {
    return { ok: false, guard: "water_root_not_ok_scanner_blocked", reason: artifact.reason || artifact.status || "water_root_not_ok" };
  }
  if (options.requiresFormalEntry === true && !waterRootFormalEntryAllowed(artifact)) {
    return { ok: false, guard: "formal_entry_not_allowed_by_water_root", reason: artifact.reason || artifact.status || "formal_entry_not_allowed" };
  }
  return {
    ok: true,
    guard: options.requiresFormalEntry === true ? "water_root_ok_formal_entry_allowed" : "water_root_ok_strategy_scan_allowed",
    reason: "ok",
  };
}
function requiresProtectedReadbackCredential(action = {}) {
  const codes = Array.isArray(action.reasonCodes) ? action.reasonCodes : [];
  const text = `${action.blocker || ""} ${action.nextAction || ""} ${(action.notes || []).join(" ")}`.toLowerCase();
  return codes.includes("AUTH_PROTECTED_READBACK_NOT_ARMED")
    || text.includes("protected_surface_needs_authenticated_readback_token")
    || text.includes("authenticated_readback")
    || text.includes("membership");
}

function safeId(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 180);
}

function actionIdempotencyKey(job = {}, key = "unknown", state = "PENDING") {
  return String(job.idempotencyKey || job.jobId || job.id || [currentTradeDate(), key, state, job.blocker || "none"].join(":")).slice(0, 180);
}

function receiptFileFor(action = {}) {
  return path.join(RECEIPT_DIR, `${safeId(action.idempotencyKey || action.key || action.label)}.json`);
}

function readActionReceipt(action = {}) {
  if (!action.receiptFile) return null;
  const receipt = readJson(action.receiptFile, null);
  if (!receipt || receipt.contract !== "terminal-auto-roll-forward-action-receipt-v1") return null;
  if (receipt.idempotencyKey !== action.idempotencyKey) return null;
  return receipt;
}

function compactDate(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function actionRequiresCurrentDateReceipt(action = {}) {
  const text = [
    action.state,
    action.blocker,
    action.nextAction,
    action.executionGuard,
    ...(Array.isArray(action.reasonCodes) ? action.reasonCodes : []),
    ...(Array.isArray(action.notes) ? action.notes : []),
  ].join(" ").toLowerCase();
  return String(action.state || "").includes("SCAN")
    || text.includes("date_mismatch")
    || text.includes("latest date")
    || text.includes("sourcedate")
    || text.includes("tradedate")
    || text.includes("scanner_receipt_date")
    || text.includes("scanner evidence");
}

function receiptHasCurrentDateProof(action = {}, receipt = {}) {
  const expected = currentTradeDate();
  if (!/^20\d{6}$/.test(expected)) return true;
  if (!actionRequiresCurrentDateReceipt(action)) return true;
  const key = String(action.key || action.module || "").replace(/[^a-z0-9_-]/gi, "");
  const body = JSON.stringify(receipt);
  const expectedDashed = expected.slice(0, 4) + "-" + expected.slice(4, 6) + "-" + expected.slice(6, 8);
  const runIdPrefix = key ? safeId(key) + "-" + expected : "";
  const hasCurrentRunId = runIdPrefix ? body.includes(runIdPrefix) : false;
  const hasCurrentTradeDate = body.includes("\"tradeDate\":\"" + expected + "\"")
    || body.includes("\"tradeDate\":\"" + expectedDashed + "\"")
    || body.includes("tradeDate=" + expected)
    || body.includes("tradeDate " + expected)
    || body.includes("scanDate\":\"" + expectedDashed + "\"")
    || body.includes("sourceDate " + expected)
    || body.includes("sourceDate=" + expected);
  const hasPreservePreviousGood = /preservePreviousGood[\"' :=]+true/i.test(body)
    || /preserved runId=/i.test(body)
    || /source not ready; preserving/i.test(body)
    || /evidenceStatus[\"' :=]+insufficient/i.test(body);
  return (hasCurrentRunId || hasCurrentTradeDate) && !hasPreservePreviousGood;
}

function receiptCommandSignatureMatches(action = {}, receipt = {}) {
  const expected = Array.isArray(action.commands) ? action.commands.map(printable) : [];
  const actual = Array.isArray(receipt.commands) ? receipt.commands.map((value) => String(value || "")) : [];
  if (!expected.length || !actual.length) return true;
  return expected.length === actual.length && expected.every((value, index) => value === actual[index]);
}

function completedReceipt(action = {}) {
  const receipt = readActionReceipt(action);
  if (!(receipt?.ok === true && receipt?.status === "complete")) return null;
  if (!receiptCommandSignatureMatches(action, receipt)) return null;
  const results = Array.isArray(receipt.results) ? receipt.results : [];
  if (results.length && !results.every((row) => row?.ok === true)) return null;
  return receiptHasCurrentDateProof(action, receipt) ? receipt : null;
}

function receiptHasOnlyAllowedFailures(receipt = {}) {
  const results = Array.isArray(receipt.results) ? receipt.results : [];
  return results.length > 0 && results.every((row) => row?.ok === true || row?.allowedFailure === true);
}

async function writeActionReceipt(action = {}, status = "complete", results = [], extra = {}) {
  if (!action.receiptFile) return null;
  const payload = {
    contract: "terminal-auto-roll-forward-action-receipt-v1",
    checkedAt: new Date().toISOString(),
    key: action.key || "",
    label: action.label || action.key || "",
    state: action.state || "",
    executionGuard: action.executionGuard || "",
    idempotencyKey: action.idempotencyKey || "",
    status,
    ok: ["complete", "deferred"].includes(status),
    skipped: extra.skipped === true,
    blocker: action.blocker || "",
    commands: action.commands.map(printable),
    results,
    ...extra,
  };
  await fs.promises.mkdir(path.dirname(action.receiptFile), { recursive: true });
  await fs.promises.writeFile(action.receiptFile, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return payload;
}

async function writeDeferredActionReceipts(actions = []) {
  const deferredActions = actions.filter((action) => action?.receiptRequired === true && action?.deferredUntilNextTradingDay === true);
  for (const action of deferredActions) {
    const existing = readActionReceipt(action);
    if (existing && existing.ok === true && existing.status === "deferred" && existing.idempotencyKey === action.idempotencyKey) continue;
    await writeActionReceipt(action, "deferred", [], {
      skipped: true,
      attempts: Number(action.attempts || 0),
      maxAttempts: action.maxAttempts,
      nextRetryAt: action.retryPolicy?.deferredUntil || "next_trading_day_market_open",
      terminalReason: "next_trading_day_repair_deferred",
      deadLetter: false,
      selfHealEvidence: [
        {
          jobId: action.jobId,
          module: action.module || action.key,
          reasonCode: action.reasonCode,
          status: "deferred_until_next_trading_day",
          idempotencyKey: action.idempotencyKey,
          verificationRequired: true,
        },
      ],
    });
  }
}

function rowIssues(row = {}) {
  return Array.isArray(row.issues) ? row.issues.map((issue) => String(issue || "")) : [];
}

function rowEvidenceText(row = {}) {
  return [
    row.issue,
    row.blocker,
    row.reason,
    row.state,
    row.status,
    row.displayMode,
    ...rowIssues(row),
  ].map((value) => String(value || "")).join(" | ").toLowerCase();
}

function manifestRunIds(row = {}) {
  const source = row.runIds && typeof row.runIds === "object" ? row.runIds : {};
  return {
    scanner: source.scanner || row.scannerRunId || row.scanner_run_id || "",
    supabase: source.supabase || row.supabaseRunId || row.latestPointerRunId || row.latestRunId || "",
    productionApi: source.productionApi || source.api || row.apiRunId || row.productionApiRunId || "",
    desktop: source.desktop || row.desktopRunId || row.desktopBundleRunId || "",
    mobile: source.mobile || row.mobileRunId || row.mobileFragmentRunId || "",
    scorecard88: source.scorecard88 || source.scorecard || row.scorecard88RunId || row.scorecardRunId || "",
    sourceReports: source.sourceReports || row.sourceReportsRunId || "",
  };
}

function nonEmptyRunIds(values = []) {
  return values.map((value) => String(value || "").trim()).filter(Boolean);
}

function runIdClosureMismatch(row = {}) {
  const text = rowEvidenceText(row);
  if (text.includes("scorecard /88 row/sourcereport runid != latest pointer")) return true;
  if (text.includes("scorecard88_live_readback_failed")) return true;
  if (text.includes("manifest_runid_mismatch")) return true;
  if (text.includes("sourcereport") && text.includes("runid") && text.includes("mismatch")) return true;
  if (text.includes("scorecard") && text.includes("runid") && text.includes("mismatch")) return true;

  const ids = manifestRunIds(row);
  const expected = String(row.runId || row.expectedRunId || ids.supabase || ids.productionApi || ids.desktop || ids.mobile || "").trim();
  if (!expected) return false;
  const upstream = nonEmptyRunIds([ids.scanner, ids.supabase, ids.productionApi, ids.desktop, ids.mobile]);
  const downstream = nonEmptyRunIds([ids.scorecard88, ids.sourceReports]);
  const upstreamAligned = upstream.length >= 2 && upstream.every((value) => value === expected);
  const downstreamDrift = downstream.some((value) => value !== expected);
  return upstreamAligned && downstreamDrift;
}

function manifestBlockerForRow(row = {}, fallback = false, dateMismatch = false) {
  const firstIssue = rowIssues(row)[0] || "";
  return row.issue
    || row.blocker
    || row.reason
    || firstIssue
    || (fallback ? "manifest_fallback_true" : dateMismatch ? "manifest_date_mismatch" : "manifest_module_not_complete");
}

function manifestStateForRow(row = {}, key = "", fallback = false, dateMismatch = false, scanKeys = new Set()) {
  if (runIdClosureMismatch(row)) return "BLOCKED_RUNID_MISMATCH";
  const text = rowEvidenceText(row);
  if (text.includes("sourcereport") || text.includes("scorecard88") || text.includes("desktop") || text.includes("mobile") || text.includes("display")) {
    return "FAILED_DISPLAY";
  }
  return scanKeys.has(key) ? "FAILED_SCAN" : "FAILED_DISPLAY";
}

function manifestNextActionForState(state = "", key = "", scanKeys = new Set()) {
  if (state === "BLOCKED_RUNID_MISMATCH") return "refresh_terminal_snapshot_bundle_mobile_88_readback";
  return scanKeys.has(key) ? "rerun_idempotent_scanner_then_reverify_manifest_closure" : "refresh_terminal_snapshot_bundle_mobile_88_readback";
}

function mergeJobs(primary = [], derived = []) {
  const merged = [];
  const seenKeys = new Set();
  const seenExact = new Set();
  for (const job of [...(Array.isArray(primary) ? primary : []), ...(Array.isArray(derived) ? derived : [])]) {
    if (!job || !job.key) continue;
    const key = String(job.key || "").toLowerCase();
    const exact = [key, job.state || "", job.idempotencyKey || job.blocker || ""].join("\u0000");
    if (seenExact.has(exact)) continue;
    if (seenKeys.has(key)) continue;
    seenExact.add(exact);
    seenKeys.add(key);
    merged.push(job);
  }
  return merged;
}

function manifestDerivedJobs(displayTradeDate = currentTradeDate()) {
  const manifest = readJson(path.join(ROOT, "outputs", "daily-terminal-run", "daily-terminal-run-latest.json"), {});
  const modules = Array.isArray(manifest.modules) ? manifest.modules : Array.isArray(manifest.moduleResults) ? manifest.moduleResults : [];
  const jobs = [];
  const blockedKeys = [];
  for (const row of modules) {
    const key = String(row.key || row.module || row.strategy || "").toLowerCase();
    if (!key || key === "scorecard") continue;
    const stateText = String(row.state || row.status || row.evidenceStatus || "").toUpperCase();
    const rowIssues = Array.isArray(row.issues) ? row.issues.map((issue) => String(issue || "")) : [];
    const marketClosedPreviousGood = manifest.previousGoodHold === true
      && (stateText.includes("MARKET_CLOSED_PREVIOUS_GOOD")
        || rowIssues.length > 0 && rowIssues.every((issue) => issue === "market_closed_previous_good_hold"));
    if (marketClosedPreviousGood) continue;
    const ok = row.ok === true || row.complete === true || stateText === "COMPLETE" || stateText === "CLOSED";
    const pending = stateText.includes("PENDING") || stateText.includes("NOT_DUE") || row.notDue === true || row.pendingNotDue === true;
    const fallback = row.fallback === true || row.rawFallback === true || row.preservePreviousGood === true;
    const candidateDate = compactDate(row.tradeDate || row.sourceDate || row.displayTradeDate || "");
    const dateMismatch = Boolean(candidateDate && candidateDate !== compactDate(displayTradeDate));
    if (ok && !fallback && !dateMismatch) continue;
    if (pending) continue;
    const state = manifestStateForRow(row, key, fallback, dateMismatch, scanKeys);
    blockedKeys.push(key);
    jobs.push({
      key,
      label: row.label || key,
      state,
      priority: Number(row.priority ?? (state === "BLOCKED_RUNID_MISMATCH" ? 88 : 70)),
      blocker: manifestBlockerForRow(row, fallback, dateMismatch),
      nextAction: manifestNextActionForState(state, key, scanKeys),
      idempotencyKey: row.idempotencyKey || [displayTradeDate, key, state === "BLOCKED_RUNID_MISMATCH" ? "runid-closure" : scanKeys.has(key) ? "scanner" : "display"].join(":"),
    });
  }
  if ((manifest.ok === false || blockedKeys.length > 0) && !jobs.some((row) => row.key === "scorecard")) {
    jobs.push({
      key: "scorecard",
      label: "Scorecard /88 Manifest Gate",
      state: "PUBLISH_DEFERRED_MANIFEST_PENDING",
      priority: 95,
      blocker: ["publish_deferred_manifest_pending", "manifest_not_green", ...blockedKeys.map((key) => "blocked_module:" + key)].join(";"),
      nextAction: "wait_until_daily_manifest_green_then_publish_scorecard",
      idempotencyKey: [currentTradeDate(), "scorecard", "manifest-deferred-publish"].join(":"),
    });
  }
  return jobs;
}

function resourceChainRowAsManifestRow(row = {}) {
  const runIds = {
    scanner: row.receipt?.runId || "",
    supabase: row.supabase?.runId || "",
    productionApi: row.live?.runId || row.endpoint?.runId || "",
    desktop: row.desktopSnapshot?.runId || "",
    mobile: row.mobileFragment?.runId || "",
    scorecard88: row.scorecard?.runId || "",
    sourceReports: row.scorecard?.runId || "",
  };
  return {
    key: row.key || "",
    label: row.label || row.key || "",
    ok: row.ok === true,
    issues: Array.isArray(row.issues) ? row.issues : [],
    runId: runIds.supabase || runIds.productionApi || runIds.desktop || runIds.mobile || runIds.scanner || "",
    runIds,
  };
}

function resourceChainAuditDerivedJobs(displayTradeDate = currentTradeDate()) {
  const audit = readJson(path.join(ROOT, "outputs", "terminal-resource-chain-audit", "terminal-resource-chain-audit.json"), {});
  const expected = compactDate(audit.expectedDate || "");
  if (expected && expected !== compactDate(displayTradeDate)) return [];
  const rows = Array.isArray(audit.results) ? audit.results : [];
  const jobs = [];
  const blockedKeys = [];
  for (const auditRow of rows) {
    const key = String(auditRow.key || "").toLowerCase();
    if (!key || key === "scorecard" || auditRow.ok === true) continue;
    const row = resourceChainRowAsManifestRow(auditRow);
    const fallback = false;
    const dateMismatch = false;
    const state = manifestStateForRow(row, key, fallback, dateMismatch, scanKeys);
    blockedKeys.push(key);
    jobs.push({
      key,
      label: row.label || key,
      state,
      priority: Number(auditRow.priority ?? (state === "BLOCKED_RUNID_MISMATCH" ? 87 : 72)),
      blocker: manifestBlockerForRow(row, fallback, dateMismatch),
      nextAction: manifestNextActionForState(state, key, scanKeys),
      idempotencyKey: [displayTradeDate, key, state === "BLOCKED_RUNID_MISMATCH" ? "live-resource-chain-runid-closure" : "live-resource-chain"].join(":"),
    });
  }
  if ((audit.ok === false || blockedKeys.length > 0) && !jobs.some((row) => row.key === "scorecard")) {
    jobs.push({
      key: "scorecard",
      label: "Scorecard /88 Live Resource Chain Gate",
      state: "PUBLISH_DEFERRED_MANIFEST_PENDING",
      priority: 96,
      blocker: ["publish_deferred_live_resource_chain_pending", "resource_chain_not_green", ...blockedKeys.map((key) => "blocked_module:" + key)].join(";"),
      nextAction: "wait_until_daily_manifest_green_then_publish_scorecard",
      idempotencyKey: [currentTradeDate(), "scorecard", "live-resource-chain-deferred-publish"].join(":"),
    });
  }
  return jobs;
}

function normalizeJobs(orchestrator = {}, queue = [], displayTradeDate = currentTradeDate()) {
  const primary = Array.isArray(queue) && queue.length
    ? queue
    : Array.isArray(orchestrator.jobQueue) && orchestrator.jobQueue.length
      ? orchestrator.jobQueue
      : [];
  return mergeJobs(primary, mergeJobs(manifestDerivedJobs(displayTradeDate), resourceChainAuditDerivedJobs(displayTradeDate)));
}

function deferredActionsFromCanonicalQueue(queue = [], policy = {}, options = {}) {
  if (!Array.isArray(queue)) return [];
  return queue
    .filter((job) => String(job?.state || "") === "NEXT_TRADING_DAY_REPAIR_DEFERRED" && job?.receiptRequired === true)
    .map((job) => {
      const action = planForJob(job, policy, options);
      const canonicalReceiptFile = job.receiptFile
        ? (path.isAbsolute(String(job.receiptFile)) ? String(job.receiptFile) : path.resolve(ROOT, String(job.receiptFile)))
        : action.receiptFile;
      return {
        ...action,
        idempotencyKey: job.idempotencyKey || action.idempotencyKey,
        receiptFile: canonicalReceiptFile,
      };
    });
}

function taipeiNow() {
  if (process.env.FUMAN_ROLL_FORWARD_NOW) {
    const fixed = new Date(process.env.FUMAN_ROLL_FORWARD_NOW);
    if (Number.isFinite(fixed.getTime())) return fixed;
  }
  return new Date();
}

function parseResumeWindowAt(deferral = {}) {
  const date = String(deferral.resumeTradeDate || "").replace(/\D/g, "").slice(0, 8);
  const time = String(deferral.resumeAfterLocalTime || "08:30");
  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!/^\d{8}$/.test(date) || !match) return null;
  const iso = date.slice(0, 4) + "-" + date.slice(4, 6) + "-" + date.slice(6, 8) + "T" + String(match[1]).padStart(2, "0") + ":" + match[2] + ":00+08:00";
  const parsed = new Date(iso);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function resumeWindowDue(deferral = {}) {
  const at = parseResumeWindowAt(deferral);
  if (!at) return { due: false, at: "", reason: "resume_window_invalid" };
  const now = taipeiNow();
  return { due: now.getTime() >= at.getTime(), at: at.toISOString(), now: now.toISOString(), reason: now.getTime() >= at.getTime() ? "resume_window_due" : "resume_window_not_due" };
}

function finalizeAction(action = {}) {
  const receipt = readActionReceipt(action);
  const receiptValid = Boolean(receipt);
  const softPartialReceipt = receiptValid && receipt.status === "partial" && receipt.deadLetter !== true && receiptHasOnlyAllowedFailures(receipt); // idempotent-skip-after-partial: partial receipts never close an action; they must reverify.
  const priorAttempts = receiptValid && !softPartialReceipt ? Math.max(0, Number(receipt.attempts || 0)) : 0;
  const configuredMaxAttempts = Number(action.retryPolicy?.maxAttempts ?? action.maxAttempts ?? 3);
  const maxAttempts = Number.isFinite(configuredMaxAttempts) && configuredMaxAttempts >= 0 ? Math.floor(configuredMaxAttempts) : 3
  const priorCompleted = Boolean(completedReceipt(action));
  const staleCompletedReceipt = receiptValid && receipt.ok === true && receipt.status === "complete" && !priorCompleted;
  const priorDeadLetter = receiptValid && receipt.deadLetter === true && !softPartialReceipt;
  const nextRetryAt = receiptValid ? (receipt.nextRetryAt || null) : null;
  const retryDue = !nextRetryAt || !Number.isFinite(Date.parse(nextRetryAt)) || Date.parse(nextRetryAt) <= Date.now();
  const deadLetter = priorDeadLetter || priorAttempts >= maxAttempts;
  action.jobId = action.jobId || action.key || "unknown";
  action.module = action.module || action.key || "unknown";
  action.reasonCode = action.reasonCode || action.primaryReasonCode || action.reasonCodes?.[0] || action.blocker || "UNKNOWN";
  action.attempts = priorAttempts;
  action.maxAttempts = maxAttempts;
  action.timeoutMs = action.commands.some((step) => step.writesSource === true) || String(action.state || "").includes("SCAN") || String(action.executionGuard || "").includes("scanner") ? 240000 : 60000;
  action.timeout = action.timeoutMs;
  action.nextRetryAt = nextRetryAt;
  action.terminalReason = receiptValid ? (receipt.terminalReason || null) : null;
  action.deadLetter = deadLetter;
  action.selfHealEvidence = receiptValid && Array.isArray(receipt.selfHealEvidence) ? receipt.selfHealEvidence : [];
  if (softPartialReceipt) {
    action.selfHealEvidence = [
      ...action.selfHealEvidence,
      {
        status: "soft_partial_receipt_ignored",
        reason: "receipt_only_contains_allowed_failures",
        checkedAt: new Date().toISOString(),
      },
    ];
  }
  if (staleCompletedReceipt) {
    action.selfHealEvidence = [
      ...action.selfHealEvidence,
      {
        status: "stale_completed_receipt_ignored",
        expectedDate: currentTradeDate(),
        receiptFile: action.receiptFile || "",
        reason: "complete receipt did not prove current-date run and cannot close a date-mismatch scanner action",
      },
    ];
  }
  action.retryable = !String(action.executionGuard || "").includes("auth");
  if (action.deferredUntilNextFormalWindow) {
    const resume = resumeWindowDue(action.deferredUntilNextFormalWindow);
    action.resumeWindow = resume;
    if (!resume.due) {
      action.state = "WAITING_FORMAL_WINDOW";
      action.executable = false;
      action.terminalReason = resume.reason;
      action.nextRetryAt = resume.at || action.nextRetryAt;
    }
  }
  if (priorCompleted) {
    action.state = "CLOSED";
    action.executable = false;
    action.executionGuard = "completed_receipt_skip";
    action.terminalReason = action.terminalReason || "completed_receipt_already_satisfied";
  } else if (deadLetter && action.executable) {
    action.state = "DEAD_LETTER";
    action.executable = false;
    action.terminalReason = action.terminalReason || "max_attempts_exceeded";
  } else if (!retryDue && action.executable) {
    action.state = "WAITING_RETRY";
    action.executable = false;
    action.terminalReason = action.terminalReason || "retry_window_not_due";
  }
  return action;
}
function explicitReasonCodesForJob(job = {}, base = {}) {
  return unique([
    job.reasonCode,
    ...(Array.isArray(job.reasonCodes) ? job.reasonCodes : []),
    ...(Array.isArray(base.reasonCodes) ? base.reasonCodes : []),
  ]);
}

function finalAuditStep() {
  return npmRun("final-audit:terminal", ["--", `--expected-date=${currentTradeDate()}`]);
}

function sourceRecoveryPlanForJob(job = {}, base = {}) {
  const codes = explicitReasonCodesForJob(job, base).map((code) => String(code || "").toLowerCase());
  const has = (needle) => codes.some((code) => code === needle || code.includes(needle));
  const commands = [];
  const notes = [];
  const pushNpm = (script, args = []) => {
    if (!commands.some((step) => step.label === `npm:${script}` && JSON.stringify(step.args || []) === JSON.stringify(["run", script, ...args]))) {
      commands.push(npmRun(script, args));
    }
  };

  if (has("outside_formal_source_window_previous_good_hold") && codes.length === 1) {
    pushNpm("verify:terminal-water-root");
    commands.push(finalAuditStep());
    notes.push("Outside formal source window: do not run scanners or publish; only recheck Water Root and Final Audit so previous good remains explicit.");
    return { executionGuard: "source_formal_window_recheck_no_publish", commands, notes };
  }

  if (has("websocket") || has("quote_freshness") || has("priority_quote") || has("priority_fresh")) {
    pushNpm("daytrade-warmup:self-heal");
    pushNpm("verify:fugle-websocket-sources");
    pushNpm("verify:terminal-water-root");
    commands.push(finalAuditStep());
    notes.push("WebSocket/quote freshness recovery: self-heal warmup, verify Fugle WebSocket sources, then Water Root and Final Audit. No publish is allowed in this source stage.");
    return { executionGuard: "source_websocket_quote_recovery_no_publish", commands, notes };
  }

  if (has("daytrade_source") || has("latest_candle") || has("intraday") || has("ma35") || has("ma20") || has("source_water_root_not_ready")) {
    pushNpm("daytrade-warmup:self-heal");
    pushNpm("strategy2:daytrade-1m-chain");
    pushNpm("verify:terminal-water-root");
    commands.push(finalAuditStep());
    notes.push("Daytrade source/1m/MA recovery: self-heal warmup, verify Strategy2 daytrade 1m chain, then Water Root and Final Audit. Latest publish remains blocked until evidence is complete.");
    return { executionGuard: "source_daytrade_rewater_reverify_no_publish", commands, notes };
  }

  pushNpm("daytrade-warmup:self-heal");
  pushNpm("verify:terminal-water-root");
  commands.push(finalAuditStep());
  notes.push("Generic source recovery: run safe warmup self-heal and reverify Water Root/Final Audit only; scanner and publish remain gated.");
  return { executionGuard: "source_generic_recovery_no_publish", commands, notes };
}

function planForJob(job = {}, policy = {}, options = {}) {
  // options.tradeDate || currentTradeDate(): scanner actions must use explicit/current trade date only.
  const state = String(job.state || "PENDING");
  const key = String(job.key || "unknown");
  const policyDecision = policy.decision || {};
  const base = {
    key,
    jobId: job.jobId || job.id || key,
    module: job.module || key,
    label: job.label || key,
    state,
    priority: Number(job.priority ?? 80),
    blocker: job.blocker || "",
    nextAction: job.nextAction || "",
    retryPolicy: job.retryPolicy || null,
    executable: false,
    executionGuard: "not_classified",
    commands: [],
    notes: [],
    idempotencyKey: actionIdempotencyKey(job, key, state),
    receiptFile: "",
    receiptRequired: true,
    ...compactReasonClassification({ key, label: job.label || key, state, blocker: job.blocker || "", nextAction: job.nextAction || "" }),
  };
  const explicitReasonCodes = explicitReasonCodesForJob(job, base);
  base.reasonCodes = explicitReasonCodes;
  base.primaryReasonCode = job.reasonCode || base.primaryReasonCode || explicitReasonCodes[0] || "";
  base.reasonCode = base.primaryReasonCode;
  base.receiptFile = job.receiptFile ? path.resolve(ROOT, String(job.receiptFile)) : receiptFileFor(base);

  if (state.includes("AUTH")) {
    base.executionGuard = "blocked_auth_requires_service_token_repair";
    base.notes.push("Auth failures are never auto-executed; membership display auth must not be confused with backend service token auth.");
    return finalizeAction(base);
  }

  if (state.includes("SOURCE")) {
    const recovery = sourceRecoveryPlanForJob(job, base);
    base.executable = true;
    base.executionGuard = recovery.executionGuard;
    base.commands.push(...recovery.commands);
    base.notes.push(...recovery.notes);
    return finalizeAction(base);
  }

  if (state.includes("SCAN")) {
    const formalScanAllowed = policyDecision.formalScanAllowed === true || policy.actionMatrix?.formalScan?.allowed === true;
    const scannerApply = options.applyScanners === true || APPLY_SCANNERS;
    const requiresFormalEntry = scannerRequiresFormalEntry(job, key);
    const waterGate = scannerWaterRootGate(options.waterRoot || null, { requiresFormalEntry });
    base.commands.push(npmRun("verify:terminal-water-root"));
    if (!waterGate.ok) {
      base.executionGuard = waterGate.guard;
      base.executable = false;
      if (waterGate.guard === "formal_entry_not_allowed_by_water_root") {
        base.deferredUntilNextFormalWindow = nextFormalWindowResume(options.waterRoot || null);
        base.nextAction = "auto_resume_recheck_water_root_then_rerun_scanner";
      }
      base.notes.push(`Scanner reruns are blocked until current Water Root PASS${requiresFormalEntry ? " and formal entry is allowed" : ""}: ${waterGate.reason}`);
      if (base.deferredUntilNextFormalWindow) base.notes.push(`Deferred safely until ${base.deferredUntilNextFormalWindow.resumeTradeDate} ${base.deferredUntilNextFormalWindow.resumeAfterLocalTime}; no stale data may publish as today's success.`);
      return finalizeAction(base);
    }
    if (!formalScanAllowed) {
      base.executionGuard = "formal_scan_not_allowed_by_policy";
      base.executable = false;
      base.notes.push("Scanner reruns are blocked unless Autonomous Ops Policy explicitly allows formalScan.");
      return finalizeAction(base);
    }
    base.executionGuard = scannerApply ? "scanner_apply_enabled" : "scanner_requires_apply_scanners";
    base.executable = scannerApply;
    const scannerCommands = scannerStepsForKey(key, job.command);
    for (const scannerCommand of scannerCommands) base.commands.push(scannerCommand);
    base.notes.push(`Scanner reruns are idempotent-only, require current Water Root PASS${requiresFormalEntry ? ", formal entry allowed" : ""}, --apply --apply-scanners, and policy formalScanAllowed=true.`);
    return finalizeAction(base);
  }

  if (state === "PUBLISH_DEFERRED_MANIFEST_PENDING") {
    base.executionGuard = "manifest_pending_publish_deferred";
    base.executable = false;
    base.commands.push(npmRun("manifest:daily-terminal-run", ["--", `--expected-date=${currentTradeDate()}`]));
    base.commands.push(npmRun("verify:daily-terminal-run-manifest", ["--", `--expected-date=${currentTradeDate()}`]));
    base.notes.push("Scorecard publish waits until every due module reaches full Manifest green; no publish is executed while later modules are pending/not-due.");
    return finalizeAction(base);
  }

  if (state === "NEXT_TRADING_DAY_REPAIR_DEFERRED") {
    base.executionGuard = "next_trading_day_repair_deferred";
    base.executable = false;
    base.deferredUntilNextTradingDay = true;
    base.terminalReason = "wait_until_next_trading_day_market_open";
    base.commands.push(npmRun("verify:terminal-water-root"));
    for (const scannerCommand of scannerStepsForKey(key, job.command)) base.commands.push(scannerCommand);
    base.commands.push(npmRun("manifest:daily-terminal-run", ["--", "--from-existing", `--expected-date=${currentTradeDate()}`]));
    base.commands.push(npmRun("final-audit:terminal", ["--", `--expected-date=${currentTradeDate()}`]));
    base.notes.push("Market-closed previous-good hold keeps this module in the deferred repair queue; scanner execution waits until the next trading day and current Water Root/Formal Gate pass.");
    return finalizeAction(base);
  }
  if (state.includes("PUBLISH") && key !== "scorecard") {
    const publishAllowed = policyDecision.scorecardPublishAllowed === true || ALLOW_DEGRADED_PUBLISH;
    base.executable = true;
    base.executionGuard = publishAllowed ? "manifest_gated_module_publish_closure" : "module_candidate_rebuild_only_manifest_not_green";
    base.commands.push(scorecardTerminalSourceRun());
    base.commands.push(npmRun("manifest:daily-terminal-run", ["--", "--from-existing", `--expected-date=${currentTradeDate()}`, "--allow-non-green-exit-zero", "--scorecard-candidate-file=C:\\fuman-runtime\\data\\scorecard-terminal-current.json"]));
    base.commands.push(npmRun("snapshot:desktop"));
    const verifyClosure = npmRun("verify:terminal-resource-chain:unattended", ["--", `--expected-date=${currentTradeDate()}`]);
    if (!publishAllowed) verifyClosure.allowFailure = true;
    base.commands.push(verifyClosure);
    base.notes.push(publishAllowed
      ? "Module publish-stage blocker may rebuild candidate/snapshot and verify closure while Manifest is green."
      : "Module publish-stage blocker may rebuild local candidate/snapshot only; scorecard publish remains blocked until Manifest is green.");
    return finalizeAction(base);
  }

  if (state.includes("PUBLISH")) {
    const publishAllowed = policyDecision.scorecardPublishAllowed === true || ALLOW_DEGRADED_PUBLISH;
    base.executable = publishAllowed;
    base.executionGuard = publishAllowed ? "manifest_gated_publish" : "manifest_not_green_publish_blocked";
    base.commands.push(npmRun("manifest:daily-terminal-run", ["--", `--expected-date=${currentTradeDate()}`]));
    base.commands.push(npmRun("verify:daily-terminal-run-manifest", ["--", `--expected-date=${currentTradeDate()}`]));
    if (publishAllowed) base.commands.push(npmRun("scorecard:publish"));
    base.notes.push("Scorecard publish is manifest-gated; previous good preserve is not a successful new publish.");
    return finalizeAction(base);
  }

  const isRunIdClosureState = state.includes("RUNID_MISMATCH");
  if (isRunIdClosureState) {
    if (requiresProtectedReadbackCredential(base) && !protectedReadbackCredentialArmed(options.protectedReadbackArmed)) {
      base.executable = false;
      base.executionGuard = "protected_readback_credential_not_armed";
      base.commands.push(npmRun("verify:protected-readback-credential"));
      base.notes.push("Protected runId closure readback cannot auto-execute until the member readback credential is armed; this is a manual secret repair, not a scanner retry.");
      return finalizeAction(base);
    }
    const publishAllowed = policyDecision.scorecardPublishAllowed === true || ALLOW_DEGRADED_PUBLISH;
    base.executable = true;
    base.executionGuard = publishAllowed ? "manifest_gated_scorecard_closure_publish" : "scorecard_candidate_rebuild_only_manifest_not_green";
    base.commands.push(scorecardTerminalSourceRun());
    base.commands.push(npmRun("manifest:daily-terminal-run", ["--", "--from-existing", `--expected-date=${currentTradeDate()}`, "--allow-non-green-exit-zero", "--scorecard-candidate-file=C:\\fuman-runtime\\data\\scorecard-terminal-current.json"]));
    base.commands.push(npmRun("snapshot:desktop"));
    const verifyClosure = npmRun("verify:terminal-resource-chain:unattended", ["--", `--expected-date=${currentTradeDate()}`]);
    if (!publishAllowed) verifyClosure.allowFailure = true;
    base.commands.push(verifyClosure);
    if (publishAllowed) {
      base.commands.push(npmRun("scorecard:publish"));
      base.commands.push(npmRun("verify:terminal-resource-chain:unattended", ["--", `--expected-date=${currentTradeDate()}`]));
    }
    base.notes.push(publishAllowed
      ? "RunId closure mismatch is manifest-green; publish scorecard and verify /88 closure."
      : "RunId closure mismatch may rebuild local scorecard candidate and desktop snapshot, but scorecard publish remains blocked until Manifest is green; old /88 rows cannot be treated as success.");
    return finalizeAction(base);
  }

  if (state.includes("DISPLAY") || state.includes("DEGRADED") || state.includes("PREVIOUS")) {
    if (requiresProtectedReadbackCredential(base) && !protectedReadbackCredentialArmed(options.protectedReadbackArmed)) {
      base.executable = false;
      base.executionGuard = "protected_readback_credential_not_armed";
      base.commands.push(npmRun("verify:protected-readback-credential"));
      base.notes.push("Protected display readback cannot auto-execute until the member readback credential is armed; this is a manual secret repair, not a scanner retry.");
      return finalizeAction(base);
    }
    base.executable = true;
    base.executionGuard = "display_snapshot_readback_only";
    base.commands.push(npmRun("snapshot:desktop"));
    const verifyClosure = npmRun("verify:terminal-resource-chain:unattended", ["--", `--expected-date=${currentTradeDate()}`]);
    base.commands.push(verifyClosure);
    base.notes.push("Display repair rebuilds terminal snapshots and verifies desktop/mobile/88 runId closure.");
    return finalizeAction(base);
  }

  base.executionGuard = "unhandled_state_plan_only";
  base.notes.push("Unknown state is planned only until a safe executor mapping exists.");
  return finalizeAction(base);
}

function scannerRunnerForKey(key = "", fallbackCommand = "") {
  const pwsh = process.platform === "win32" ? "pwsh.exe" : "pwsh";
  const map = {
    strategy2: "run-strategy2-intraday.ps1",
    strategy3: "run-strategy3-complete-scan.ps1",
    strategy4: "run-strategy4.ps1",
    strategy5: "run-strategy5.ps1",
    institution: "run-institution.ps1",
  };
  const scriptName = map[String(key || "").toLowerCase()];
  if (scriptName) {
    return {
      command: pwsh,
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ".\\" + scriptName],
      label: "scanner:" + key,
      writesSource: true,
    };
  }
  if (String(fallbackCommand).trim()) {
    return {
      command: pwsh,
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", String(fallbackCommand)],
      label: "scanner:" + key + ":fallback-command",
      writesSource: true,
    };
  }
  return null;
}

function scannerClosureStepsForKey(key = "") {
  const map = {
    strategy2: ["verify:strategy2-e2e-closure"],
    strategy3: ["verify:daytrade-strategy3-closure-live"],
    strategy4: ["verify:strategy4-postscan-closure"],
    strategy5: ["verify:strategy5-e2e-closure"],
    institution: ["verify:institution-e2e-closure"],
    cb: ["verify:cb-e2e-closure"],
  };
  return (map[String(key || "").toLowerCase()] || []).map((script) => npmRun(script));
}

function scannerPostRunSteps(key = "") {
  // rerun_idempotent_scanner_then_reverify_manifest_closure
  return [
    npmRun("scan-receipts:normalize"),
    npmRun("verify:strategy-scan-receipt-contract"),
    npmRun("manifest:daily-terminal-run", ["--", "--from-existing", "--expected-date=" + currentTradeDate(), "--allow-non-green-exit-zero", "--scorecard-candidate-file=C:\\fuman-runtime\\data\\scorecard-terminal-current.json"]),
    npmRun("verify:daily-terminal-run-manifest", ["--", "--expected-date=" + currentTradeDate()]),
    ...scannerClosureStepsForKey(key),
    npmRun("verify:terminal-runid-closure", ["--", "--expected-date=" + currentTradeDate()]),
  ];
}

function scannerStepsForKey(key, fallbackCommand = "") {
  const runner = scannerRunnerForKey(key, fallbackCommand);
  if (!runner) return [];
  return [runner, ...scannerPostRunSteps(key)];
}
function currentTradeDate() {
  if (EXPECTED_DATE) return EXPECTED_DATE;
  const manifest = readJson(path.join(ROOT, "outputs", "daily-terminal-run", "daily-terminal-run-latest.json"), {});
  return String(manifest.tradeDate || "").replace(/\D/g, "").slice(0, 8) || "latest";
}

function compactJob(row = {}) {
  return {
    key: row.key || "",
    label: row.label || row.key || "",
    state: row.state || "",
    priority: Number(row.priority ?? 80),
    blocker: row.blocker || "",
    nextAction: row.nextAction || "",
    runId: row.runId || "",
  };
}

function blockerRank(action = {}) {
  const waitingRank = action.state === "WAITING_FORMAL_WINDOW" || action.deferredUntilNextFormalWindow || action.deferredUntilNextTradingDay ? 1 : 0;
  const severityRank = action.reasonSeverity === "critical" ? 0 : 1;
  return [waitingRank, severityRank, Number(action.priority ?? 80), keyRank[action.key] ?? 50, String(action.key || "")];
}

function sortBlockedActions(rows = []) {
  return [...rows].sort((a, b) => {
    const ar = blockerRank(a);
    const br = blockerRank(b);
    for (let i = 0; i < ar.length; i += 1) {
      if (ar[i] < br[i]) return -1;
      if (ar[i] > br[i]) return 1;
    }
    return 0;
  });
}

// buildSafeRecoveryPreview(jobs, policy, tradeDate, displayTradeDate): safe preview must be date-aware.
function buildSafeRecoveryPreview(jobs = [], policy = {}, tradeDate = currentTradeDate(), displayTradeDate = tradeDate) {
  const actions = jobs.map((job) => planForJob({ ...job, tradeDate, displayTradeDate }, policy, { applyScanners: true, tradeDate }));
  const blocked = actions.filter((action) => !action.executable && action.state !== "CLOSED");
  const executable = actions.filter((action) => action.executable);
  const decision = decide(actions, policy);
  return {
    contract: "terminal-safe-recovery-preview-v1",
    ok: decision.ok === true,
    tradeDate,
    displayTradeDate,
    state: decision.state || "",
    reason: decision.reason || "",
    executableJobs: executable.length,
    blockedJobs: blocked.length,
    executableKeys: executable.map((row) => row.key),
    blockedKeys: blocked.map((row) => row.key),
    commandHint: executable.length ? "node --use-system-ca scripts/run-terminal-auto-roll-forward.js --apply --apply-scanners" : "",
    reasonCodeSummary: buildReasonCodeSummary(actions),
  };
}
function dedupeActions(actions = []) {
  const seen = new Set();
  const rows = [];
  for (const action of actions) {
    const key = action.idempotencyKey || `${action.key}:${action.state}:${action.executionGuard}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(action);
  }
  return rows;
}

function buildPlan({ orchestrator, policy, queue }) {
  const tradeDate = orchestrator.tradeDate || currentTradeDate();
  const displayTradeDate = orchestrator.displayTradeDate || orchestrator.tradeDate || currentTradeDate();
  const jobs = normalizeJobs(orchestrator, queue, displayTradeDate);
  const manifest = readJson(path.join(ROOT, "outputs", "daily-terminal-run", "daily-terminal-run-latest.json"), {});
  const manifestModules = Array.isArray(manifest.modules) ? manifest.modules : Array.isArray(manifest.moduleResults) ? manifest.moduleResults : [];
  const blockedManifestKeys = manifestModules
    .filter((row) => row && row.ok !== true && row.pendingNotDue !== true && row.notDue !== true)
    .map((row) => String(row.key || row.module || row.strategy || "").toLowerCase())
    .filter(Boolean);
  if ((manifest.ok === false || blockedManifestKeys.length > 0) && !jobs.some((row) => row.key === "scorecard")) {
    jobs.push({
      key: "scorecard",
      label: "Scorecard /88 Manifest Gate",
      state: "PUBLISH_DEFERRED_MANIFEST_PENDING",
      priority: 95,
      blocker: ["publish_deferred_manifest_pending", "manifest_not_green", ...blockedManifestKeys.map((key) => `blocked_module:${key}`)].join(";"),
      nextAction: "wait_until_daily_manifest_green_then_publish_scorecard",
      idempotencyKey: [tradeDate, "scorecard", "manifest-deferred-publish"].join(":"),
    });
  }
  jobs.sort((a, b) => Number(a.priority ?? 80) - Number(b.priority ?? 80));
  const actions = dedupeActions(jobs.map((job) => planForJob(job, policy, { tradeDate, displayTradeDate })));
  const blocked = actions.filter((action) => !action.executable && action.state !== "CLOSED");
  const executable = actions.filter((action) => action.executable);
  return {
    contract: "terminal-auto-roll-forward-v1",
    checkedAt: new Date().toISOString(),
    mode: APPLY ? "apply" : "dry-run",
    applyScanners: APPLY_SCANNERS,
    tradeDate: currentTradeDate(),
    policyState: policy.decision?.opsState || "",
    autoRecoveryAllowed: policy.decision?.autoRecoveryAllowed === true,
    jobs: jobs.length,
    jobList: jobs.map(compactJob),
    topBlocker: sortBlockedActions(blocked)[0] || null,
    executableJobs: executable.length,
    blockedJobs: blocked.length,
    actions,
    idempotencyContract: IDEMPOTENCY_CONTRACT,
    reasonCodeSummary: buildReasonCodeSummary(actions),
    safeRecoveryPreview: buildSafeRecoveryPreview(jobs, policy),
    decision: decide(actions, policy),
  };
}

function decide(actions, policy) {
  if (!actions.length) {
    return {
      ok: true,
      state: "IDLE_NO_RETRY_NEEDED",
      reason: "job_queue_empty",
      applyAllowed: false,
    };
  }
  if (policy.decision?.autoRecoveryAllowed !== true) {
    return {
      ok: false,
      state: "AUTO_RECOVERY_DISABLED",
      reason: policy.decision?.reason || "policy_disallows_auto_recovery",
      applyAllowed: false,
    };
  }

  const executable = actions.filter((action) => action.executable === true);
  const blocked = actions.filter((action) => action.executable !== true && action.state !== "CLOSED");
  const authBlocked = sortBlockedActions(blocked.filter((action) => action.state.includes("AUTH") || requiresProtectedReadbackCredential(action)));
  const waitingFormalWindow = sortBlockedActions(blocked.filter((action) => action.state === "WAITING_FORMAL_WINDOW" || action.deferredUntilNextFormalWindow));
  const deferredNextTradingDay = sortBlockedActions(blocked.filter((action) => action.state === "NEXT_TRADING_DAY_REPAIR_DEFERRED" || action.deferredUntilNextTradingDay));
  const nonAuthBlocked = sortBlockedActions(blocked.filter((action) => !authBlocked.includes(action) && !waitingFormalWindow.includes(action) && !deferredNextTradingDay.includes(action)));

  if (executable.length && authBlocked.length) {
    return {
      ok: true,
      state: APPLY ? "PARTIAL_AUTO_ROLL_FORWARD_APPLY_ARMED_WITH_AUTH_BLOCKERS" : "PARTIAL_AUTO_ROLL_FORWARD_DRY_RUN_READY_WITH_AUTH_BLOCKERS",
      reason: "safe_jobs_ready_auth_jobs_manual",
      applyAllowed: true,
      partial: true,
      executableJobs: executable.length,
      blockedJobs: blocked.length,
    };
  }
  if (executable.length && nonAuthBlocked.length) {
    return {
      ok: true,
      state: APPLY ? "PARTIAL_AUTO_ROLL_FORWARD_APPLY_ARMED_WITH_BLOCKERS" : "PARTIAL_AUTO_ROLL_FORWARD_DRY_RUN_READY_WITH_BLOCKERS",
      reason: `safe_jobs_ready_blocked:${nonAuthBlocked[0].key}:${nonAuthBlocked[0].executionGuard}`,
      applyAllowed: true,
      partial: true,
      executableJobs: executable.length,
      blockedJobs: blocked.length,
    };
  }
  if (executable.length && waitingFormalWindow.length) {
    return {
      ok: true,
      state: APPLY ? "PARTIAL_AUTO_ROLL_FORWARD_APPLY_ARMED_WAITING_FORMAL_WINDOW" : "PARTIAL_AUTO_ROLL_FORWARD_DRY_RUN_READY_WAITING_FORMAL_WINDOW",
      reason: `safe_jobs_ready_waiting_formal_window:${waitingFormalWindow[0].key}:${waitingFormalWindow[0].executionGuard}`,
      applyAllowed: true,
      partial: true,
      executableJobs: executable.length,
      blockedJobs: blocked.length,
      waitingJobs: waitingFormalWindow.length,
    };
  }

  const auth = authBlocked[0];
  if (auth) {
    return {
      ok: false,
      state: "BLOCKED_AUTH_MANUAL_REPAIR_REQUIRED",
      reason: auth.blocker || "auth_blocker",
      applyAllowed: false,
    };
  }
  const unhandled = nonAuthBlocked[0];
  if (unhandled) {
    return {
      ok: false,
      state: "PLAN_HAS_NON_EXECUTABLE_JOB",
      reason: `${unhandled.key}:${unhandled.executionGuard}`,
      applyAllowed: false,
    };
  }
  const waiting = waitingFormalWindow[0];
  if (waiting) {
    return {
      ok: false,
      state: "WAITING_FORMAL_WINDOW",
      reason: waiting.resumeWindow?.reason || waiting.terminalReason || "resume_window_not_due",
      applyAllowed: false,
      nextRetryAt: waiting.nextRetryAt || waiting.resumeWindow?.at || null,
      waitingJobs: waitingFormalWindow.length,
    };
  }
  const deferredRepair = deferredNextTradingDay[0];
  if (deferredRepair) {
    return {
      ok: true,
      state: "IDLE_WAITING_NEXT_TRADING_DAY_REPAIR",
      reason: `deferred_until_next_trading_day:${deferredRepair.key}`,
      applyAllowed: false,
      executableJobs: executable.length,
      blockedJobs: blocked.length,
      waitingJobs: deferredNextTradingDay.length,
    };
  }  return {
    ok: true,
    state: APPLY ? "AUTO_ROLL_FORWARD_APPLY_ARMED" : "AUTO_ROLL_FORWARD_DRY_RUN_READY",
    reason: APPLY ? "executing_safe_recovery_commands" : "dry_run_plan_only",
    applyAllowed: true,
  };
}
function commandIdentity(command = {}) {
  const args = Array.isArray(command.args) ? command.args : [];
  return `${command.command || ""}\u0000${args.join("\u0000")}`;
}

function actionReceiptStatusForResults(actionResults = []) {
  return actionResults.every((row) => row.ok === true) ? "complete" : "partial";
}

async function writeOutputs(plan, executed = []) {
  await fs.promises.mkdir(OUT_DIR, { recursive: true });
  await fs.promises.mkdir(RECEIPT_DIR, { recursive: true });
  const payload = { ...plan, executed };
  const jsonFile = path.join(OUT_DIR, "terminal-auto-roll-forward.json");
  const mdFile = path.join(OUT_DIR, "terminal-auto-roll-forward.md");
  await fs.promises.writeFile(jsonFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.promises.writeFile(mdFile, markdown(payload), "utf8");
  return { jsonFile, mdFile };
}

function markdown(plan) {
  const lines = [];
  lines.push("# Terminal Auto Roll Forward");
  lines.push("");
  lines.push(`- checkedAt: ${plan.checkedAt}`);
  lines.push(`- tradeDate: ${plan.tradeDate}`);
  lines.push(`- mode: ${plan.mode}`);
  lines.push(`- decision: ${plan.decision.state}`);
  lines.push(`- reason: ${plan.decision.reason}`);
  lines.push("");
  lines.push("## Actions");
  lines.push("| priority | module | state | executable | guard | idempotencyKey | receipt | commands | blocker |");
  lines.push("|---:|---|---|---:|---|---|---|---|---|");
  for (const action of plan.actions) {
    lines.push(`| ${action.priority} | ${action.label} | ${action.state} | ${action.executable} | ${action.executionGuard} | ${action.idempotencyKey || "--"} | ${action.receiptFile || "--"} | ${action.commands.map(printable).join("<br>") || "--"} | ${action.blocker || "--"} |`);
  }
  lines.push("");
  lines.push("## Executed");
  lines.push("| command | exitCode | ok |");
  lines.push("|---|---:|---:|");
  for (const result of plan.executed || []) {
    lines.push(`| ${result.command} | ${result.exitCode} | ${result.ok} |`);
  }
  return `${lines.join("\n")}\n`;
}

function selfTest() {
  const policy = { decision: { autoRecoveryAllowed: true, scorecardPublishAllowed: false, formalScanAllowed: true } };
  const waterOkFixture = {
    ok: true,
    sourceName: "fugle_daytrade_source",
    marketDate: "20260731",
    displayTradeDate: "20260731",
    requestedDate: "20260731",
    tradeDate: "20260731",
    sourceTradeDate: "20260731",
    scannerTargetDate: "20260731",
    scorecardTargetDate: "20260731",
    manifestTradeDate: "20260731",
    gateGrade: "A",
    gateStatus: "ready",
    formalEntrySpeedVerdict: "YES",
    formalEntryAllowed: true,
    scannerCanRunOpening: true,
    websocketFormalReady: true,
    websocketConnected: true,
    websocketAuthenticated: true,
    websocketStreaming: true,
    websocketRestDisabled: true,
    channels: ["trades", "aggregates", "candles"],
    formalSourceAlignmentOk: true,
    ordinaryStockUniverseReady: true,
    activeSymbols: 1664,
    priorityPoolSymbols: 40,
    priorityFreshQuotes120s: 40,
    priorityFreshQuoteCoverage120s: 1,
    motherPoolSymbols: 300,
    quoteAgeSeconds: 5,
    intraday1mStaleSeconds: 0,
    readyMa20: true,
    readyMa35: true,
    dailyVolumeStatus: "ready",
    futoptGateStatus: "ready",
    futoptStockMapped: 1,
    futoptStockQuoteUniverse: 1,
    futoptStockQuotesThisLoop: 1,
    failedChecks: [],
  };
  const waterBlockedFixture = { ok: false, status: "blocked", reason: "canonical_gate_not_A:D" };
  const waterFormalEntryBlockedFixture = { ok: true, canonicalGate: { formalEntryAllowed: false }, reason: "formal_entry_allowed_false" };
  const waterFormalEntryFutureFixture = { ok: true, reason: "formal_entry_allowed_false", marketCalendar: { row: { marketDate: "2099-01-02", marketStatus: "after_formal_source_window", formalSourceWindow: { start: "08:30", endMinute: 815, currentMinute: 900, phase: "after_formal_source_window" } } }, canonicalGate: { formalEntryAllowed: false } };
  const cases = [
    { name: "auth-block", job: { key: "strategy4", state: "BLOCKED_AUTH", blocker: "401" }, expectedExecutable: false, expectedGuard: "blocked_auth" },
    { name: "source-check", job: { key: "strategy2", state: "BLOCKED_SOURCE" }, expectedExecutable: true, expectedGuard: "source_daytrade_rewater_reverify" },
    { name: "source-daytrade-rewater", job: { key: "strategy2", state: "BLOCKED_SOURCE", reasonCode: "strategy2_intraday_latest_candle_missing_after_0901", reasonCodes: ["strategy2_intraday_latest_candle_missing_after_0901", "strategy2_intraday_ma35_readiness_below_threshold"] }, expectedExecutable: true, expectedGuard: "source_daytrade_rewater_reverify" },
    { name: "scan-dry", job: { key: "strategy3", state: "FAILED_SCAN" }, options: { waterRoot: waterOkFixture }, expectedExecutable: APPLY_SCANNERS, expectedGuard: APPLY_SCANNERS ? "scanner_apply" : "scanner_requires" },
    { name: "scan-water-block", job: { key: "strategy3", state: "FAILED_SCAN" }, options: { waterRoot: waterBlockedFixture, applyScanners: true }, expectedExecutable: false, expectedGuard: "water_root_not_ok_scanner_blocked" },
    { name: "scan-formal-entry-block", job: { key: "strategy2", state: "FAILED_SCAN", requiresFormalEntry: true }, options: { waterRoot: waterFormalEntryBlockedFixture, applyScanners: true }, expectedExecutable: false, expectedGuard: "formal_entry_not_allowed_by_water_root", expectedDeferred: true },
    { name: "scan-formal-entry-waiting-window", job: { key: "strategy2", state: "FAILED_SCAN", requiresFormalEntry: true }, options: { waterRoot: waterFormalEntryFutureFixture, applyScanners: true }, expectedExecutable: false, expectedGuard: "formal_entry_not_allowed_by_water_root", expectedDeferred: true, expectedState: "WAITING_FORMAL_WINDOW" },
    { name: "scan-policy-block", policy: { decision: { autoRecoveryAllowed: true, scorecardPublishAllowed: false, formalScanAllowed: false } }, job: { key: "strategy3", state: "FAILED_SCAN" }, options: { waterRoot: waterOkFixture, applyScanners: true }, expectedExecutable: false, expectedGuard: "formal_scan_not_allowed" },
    { name: "display", job: { key: "strategy5", state: "FAILED_DISPLAY" }, expectedExecutable: true, expectedGuard: "display_snapshot" },
    { name: "display-auth-unarmed", job: { key: "strategy2", state: "FAILED_DISPLAY", blocker: "protected_surface_needs_authenticated_readback_token", nextAction: "refresh_terminal_snapshot_bundle_mobile_88_readback" }, options: { protectedReadbackArmed: false }, expectedExecutable: false, expectedGuard: "protected_readback_credential_not_armed" },
    { name: "publish-blocked", job: { key: "scorecard", state: "FAILED_PUBLISH" }, expectedExecutable: false, expectedGuard: "manifest_not_green" },
    { name: "publish-deferred", job: { key: "scorecard", state: "PUBLISH_DEFERRED_MANIFEST_PENDING" }, expectedExecutable: false, expectedGuard: "manifest_pending_publish_deferred" },
    { name: "next-trading-day-repair-deferred", job: { key: "strategy5", state: "NEXT_TRADING_DAY_REPAIR_DEFERRED", blocker: "market_closed_previous_good_hold" }, expectedExecutable: false, expectedGuard: "next_trading_day_repair_deferred" },
    { name: "runid-mismatch-deferred", job: { key: "strategy4", state: "BLOCKED_RUNID_MISMATCH", nextAction: "refresh_terminal_snapshot_bundle_mobile_88_readback", blocker: "runid_mismatch:scorecard88=old" }, expectedExecutable: true, expectedGuard: "scorecard_candidate_rebuild_only_manifest_not_green" },
  ];
  const failures = [];
  for (const item of cases) {
    const action = planForJob(item.job, item.policy || policy, item.options || {});
    if (action.executable !== item.expectedExecutable) failures.push(`${item.name}: executable ${action.executable} != ${item.expectedExecutable}`);
    if (!action.executionGuard.includes(item.expectedGuard)) failures.push(`${item.name}: guard ${action.executionGuard} missing ${item.expectedGuard}`);
    if (item.expectedDeferred === true && action.deferredUntilNextFormalWindow?.resumePolicy !== "auto_resume_next_formal_source_window") failures.push(`${item.name}: missing next formal window deferral`);
    if (item.expectedState && action.state !== item.expectedState) failures.push(`${item.name}: state ${action.state} != ${item.expectedState}`);
    if (!Array.isArray(action.reasonCodes) || action.reasonCodes.length === 0 || action.reasonUnknown === true) failures.push(`${item.name}: reason codes missing or unknown`);
  }
  const strategy3ApplyAction = planForJob({ key: "strategy3", state: "FAILED_SCAN" }, policy, { waterRoot: waterOkFixture, applyScanners: true });
  const strategy3CommandLabels = strategy3ApplyAction.commands.map((command) => command.label || command.command || "");
  for (const expectedLabel of ["scanner:strategy3", "npm:verify:daytrade-strategy3-closure-live", "npm:scan-receipts:normalize", "npm:verify:strategy-scan-receipt-contract"]) {
    if (!strategy3CommandLabels.includes(expectedLabel)) failures.push(`strategy3 apply chain missing ${expectedLabel}`);
  }
  const strategy3Scanner = strategy3ApplyAction.commands.find((command) => command.label === "scanner:strategy3");
  if (strategy3Scanner?.writesSource !== true) failures.push("strategy3 scanner action must be marked writesSource");

  const ledgerAction = planForJob({ key: "ledger-self-test", state: "FAILED_SCAN" }, policy, { waterRoot: waterOkFixture, applyScanners: true });
  for (const field of ["jobId", "module", "reasonCode", "attempts", "maxAttempts", "timeout", "nextRetryAt", "terminalReason", "deadLetter", "selfHealEvidence"]) {
    if (!(field in ledgerAction)) failures.push("action retry ledger missing " + field);
  }
  if (ledgerAction.maxAttempts !== 3 || ledgerAction.retryable !== true) failures.push("action retry ledger is not bounded/retryable");
  if (ledgerAction.timeout !== 240000) failures.push("scanner timeout budget is not 240000ms");
  const partialDecision = decide([
    { key: "strategy4", state: "FAILED_SCAN", executable: true, blocker: "manifest_raw_fallback_true", executionGuard: "scanner_apply_enabled" },
    { key: "strategy2", state: "FAILED_DISPLAY", executable: false, blocker: "protected_surface_needs_authenticated_readback_token", executionGuard: "protected_readback_credential_not_armed", reasonCodes: ["AUTH_PROTECTED_READBACK_NOT_ARMED"] },
  ], policy);
  if (partialDecision.ok !== true || !String(partialDecision.state || "").includes("PARTIAL_AUTO_ROLL_FORWARD")) {
    failures.push(`partial decision did not allow safe recovery beside auth blocker: ${partialDecision.state}`);
  }
  const authOnlyDecision = decide([
    { key: "strategy2", state: "FAILED_DISPLAY", executable: false, blocker: "protected_surface_needs_authenticated_readback_token", executionGuard: "protected_readback_credential_not_armed", reasonCodes: ["AUTH_PROTECTED_READBACK_NOT_ARMED"] },
  ], policy);
  if (authOnlyDecision.ok !== false || authOnlyDecision.state !== "BLOCKED_AUTH_MANUAL_REPAIR_REQUIRED") {
    failures.push(`auth-only decision did not fail closed: ${authOnlyDecision.state}`);
  }
  const waitingOnlyDecision = decide([
    { key: "strategy2", state: "WAITING_FORMAL_WINDOW", executable: false, blocker: "formal_entry_not_allowed", executionGuard: "formal_entry_not_allowed_by_water_root", terminalReason: "resume_window_not_due", reasonCodes: ["SOURCE_FORMAL_ENTRY_NOT_ALLOWED"] },
  ], policy);
  if (waitingOnlyDecision.ok !== false || waitingOnlyDecision.state !== "WAITING_FORMAL_WINDOW") {
    failures.push(`waiting-only decision did not preserve formal window wait state: ${waitingOnlyDecision.state}`);
  }
  const deferredOnlyDecision = decide([
    { key: "strategy5", state: "NEXT_TRADING_DAY_REPAIR_DEFERRED", executable: false, blocker: "market_closed_previous_good_hold", executionGuard: "next_trading_day_repair_deferred", deferredUntilNextTradingDay: true, reasonCodes: ["next_trading_day_repair_deferred"] },
  ], policy);
  if (deferredOnlyDecision.ok !== true || deferredOnlyDecision.state !== "IDLE_WAITING_NEXT_TRADING_DAY_REPAIR") {
    failures.push(`deferred-only decision did not wait safely: ${deferredOnlyDecision.state}`);
  }
  const mixedWaitingDecision = decide([
    { key: "strategy2", state: "WAITING_FORMAL_WINDOW", executable: false, blocker: "formal_entry_not_allowed", executionGuard: "formal_entry_not_allowed_by_water_root", terminalReason: "resume_window_not_due", reasonCodes: ["SOURCE_FORMAL_ENTRY_NOT_ALLOWED"] },
    { key: "strategy3", state: "FAILED_SCAN", executable: false, blocker: "scanner_requires_apply_scanners", executionGuard: "scanner_requires_apply_scanners", reasonCodes: ["SCAN_FAILED"] },
  ], policy);
  if (mixedWaitingDecision.state !== "PLAN_HAS_NON_EXECUTABLE_JOB" || !String(mixedWaitingDecision.reason || "").startsWith("strategy3:")) {
    failures.push(`mixed waiting decision hid the actionable blocker: ${mixedWaitingDecision.state} ${mixedWaitingDecision.reason}`);
  }
  const duplicatePlan = buildPlan({
    orchestrator: {},
    policy,
    queue: [
      { key: "cb", state: "BLOCKED_RUNID_MISMATCH", blocker: "scorecard88=old", idempotencyKey: "same-display-repair" },
      { key: "cb", state: "BLOCKED_RUNID_MISMATCH", blocker: "scorecard88=old", idempotencyKey: "same-display-repair" },
    ],
  });
  const duplicateCbActions = duplicatePlan.actions.filter((action) => action.key === "cb");
  if (duplicateCbActions.length !== 1) failures.push(`duplicate idempotency actions were not deduped for cb: ${duplicateCbActions.length}`);
  const allowedFailureOnly = [
    { ok: true },
    { ok: false, allowedFailure: true },
  ];
  if (actionReceiptStatusForResults(allowedFailureOnly) !== "partial") failures.push("allowed failure should keep action receipt partial until closure verifies cleanly");
  if (actionReceiptStatusForResults([{ ok: false, allowedFailure: false }]) !== "partial") failures.push("hard failure should downgrade action receipt");
  const fakeAction = {
    key: "self-test",
    label: "self-test",
    state: "FAILED_DISPLAY",
    executionGuard: "display_snapshot_readback_only",
    commands: [],
    idempotencyKey: "self-test-key",
    receiptFile: path.join(OUT_DIR, "self-test-receipt.json"),
  };
  const fakeReceipt = {
    contract: "terminal-auto-roll-forward-action-receipt-v1",
    idempotencyKey: "self-test-key",
    ok: true,
    status: "complete",
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(fakeAction.receiptFile, JSON.stringify(fakeReceipt) + "\n", "utf8");
  if (!completedReceipt(fakeAction)) failures.push("completedReceipt did not accept matching complete receipt");
  const completedAction = finalizeAction({ ...fakeAction, state: "FAILED_DISPLAY", executable: true, commands: [npmRun("verify:terminal-water-root")] });
  if (completedAction.state !== "CLOSED" || completedAction.executionGuard !== "completed_receipt_skip" || completedAction.executable !== false) {
    failures.push(`completed receipt did not close action safely: ${completedAction.state} ${completedAction.executionGuard} ${completedAction.executable}`);
  }
  fs.rmSync(fakeAction.receiptFile, { force: true });
  const staleScannerAction = {
    key: "strategy3",
    label: "strategy3",
    state: "FAILED_SCAN",
    blocker: "scanner_date_mismatch:tradeDate 20260724 != " + currentTradeDate(),
    executionGuard: "scanner_apply_enabled",
    commands: [npmRun("verify:terminal-water-root")],
    idempotencyKey: "self-test-stale-scanner-key",
    receiptFile: path.join(OUT_DIR, "self-test-stale-scanner-receipt.json"),
  };
  const staleScannerReceipt = {
    contract: "terminal-auto-roll-forward-action-receipt-v1",
    idempotencyKey: "self-test-stale-scanner-key",
    ok: true,
    status: "complete",
    results: [{ ok: true, stdout: "Strategy3 source not ready; preserving latest complete run instead of poisoning receipt. preserved runId=strategy3-20260724-20260725174936 usedDate=20260724" }],
  };
  fs.writeFileSync(staleScannerAction.receiptFile, JSON.stringify(staleScannerReceipt) + "\n", "utf8");
  if (completedReceipt(staleScannerAction)) failures.push("stale scanner receipt was accepted as current-date complete");
  const staleFinalized = finalizeAction({ ...staleScannerAction, executable: true });
  if (staleFinalized.state === "CLOSED" || staleFinalized.executionGuard === "completed_receipt_skip") {
    failures.push("stale scanner receipt closed a date-mismatch action");
  }
  fs.rmSync(staleScannerAction.receiptFile, { force: true });
  return { ok: failures.length === 0, failures };
}

async function main() {
  if (SELF_TEST) {
    const result = selfTest();
    console.log(JSON.stringify({
      ok: result.ok,
      contract: "terminal-auto-roll-forward-self-test-v1",
      failures: result.failures,
    }, null, 2));
    if (!result.ok) process.exit(1);
    return;
  }
  const preflightResults = refreshOrchestratorInputs();
  const orchestrator = readJson(path.join(ROOT, "outputs", "terminal-orchestrator", "terminal-orchestrator-state.json"), {});
  const queue = readJson(path.join(ROOT, "outputs", "terminal-orchestrator", "terminal-job-queue.json"), []);
  const policy = readJson(path.join(ROOT, "outputs", "autonomous-ops-policy", "autonomous-ops-policy.json"), {});
  const plan = buildPlan({ orchestrator, policy, queue });
  const executed = [...preflightResults];
  const commandResultCache = new Map();
    await writeDeferredActionReceipts([
    ...plan.actions,
    ...deferredActionsFromCanonicalQueue(queue, policy),
  ]);

  if (APPLY) {
    if (!plan.decision.applyAllowed) {
      await writeOutputs(plan, executed);
      console.error(`[auto-roll-forward] apply blocked: ${plan.decision.state}: ${plan.decision.reason}`);
      process.exit(1);
    }
    const executableActions = plan.actions.filter((item) => item.executable);
    for (let actionIndex = 0; actionIndex < executableActions.length; actionIndex += 1) {
      const action = executableActions[actionIndex];
      const previousReceipt = completedReceipt(action);
      if (previousReceipt) {
        executed.push({
          label: `idempotent-skip:${action.key}`,
          command: "receipt-skip",
          exitCode: 0,
          ok: true,
          skipped: true,
          key: action.key,
          idempotencyKey: action.idempotencyKey,
          receiptFile: action.receiptFile,
          previousCheckedAt: previousReceipt.checkedAt || "",
        });
        continue;
      }
      const actionResults = [];
      const attempt = Math.max(1, Number(action.attempts || 0) + 1);
      await writeActionReceipt(action, "running", [], {
        attempts: attempt,
        maxAttempts: action.maxAttempts,
        nextRetryAt: null,
        terminalReason: null,
        deadLetter: false,
        selfHealEvidence: [
          {
            jobId: action.jobId,
            module: action.module,
            reasonCode: action.reasonCode,
            status: "action_started",
            idempotencyKey: action.idempotencyKey,
            verificationRequired: true,
          },
        ],
      });
      for (const command of action.commands) {
        const commandKey = commandIdentity(command);
        const cached = commandResultCache.get(commandKey);
        const result = cached
          ? { ...cached, cached: true, key: action.key, idempotencyKey: action.idempotencyKey, receiptFile: action.receiptFile }
          : { ...runCommand({ ...command, timeoutMs: action.timeoutMs }), key: action.key, idempotencyKey: action.idempotencyKey, receiptFile: action.receiptFile };
        if (!cached) commandResultCache.set(commandKey, { ...result, key: undefined, idempotencyKey: undefined, receiptFile: undefined });
        actionResults.push(result);
        executed.push(result);
        if (!result.ok && result.allowedFailure !== true) {
          const exhausted = attempt >= action.maxAttempts;
          const retryAt = exhausted
            ? null
            : new Date(Date.now() + Math.min(30 * 60 * 1000, 60 * 1000 * (2 ** Math.max(0, attempt - 1)))).toISOString();
          await writeActionReceipt(action, "failed", actionResults, {
            failedCommand: result.command,
            attempts: attempt,
            maxAttempts: action.maxAttempts,
            nextRetryAt: retryAt,
            terminalReason: exhausted ? "max_attempts_exceeded" : "retry_scheduled",
            deadLetter: exhausted,
            selfHealEvidence: [
              {
                jobId: action.jobId,
                module: action.module,
                reasonCode: action.reasonCode,
                status: "action_failed",
                idempotencyKey: action.idempotencyKey,
                failedCommand: result.command,
                verificationRequired: true,
              },
            ],
          });
          for (const remainingAction of executableActions.slice(actionIndex + 1)) {
            const existingReceipt = readActionReceipt(remainingAction);
            if (existingReceipt) continue;
            await writeActionReceipt(remainingAction, "blocked", [], {
              skipped: true,
              attempts: 0,
              maxAttempts: remainingAction.maxAttempts,
              nextRetryAt: retryAt,
              terminalReason: "upstream_action_failed",
              upstreamFailedAction: action.key,
              upstreamFailedCommand: result.command,
              deadLetter: false,
              selfHealEvidence: [
                {
                  jobId: remainingAction.jobId,
                  module: remainingAction.module,
                  reasonCode: remainingAction.reasonCode,
                  status: "not_attempted_due_to_prior_failure",
                  idempotencyKey: remainingAction.idempotencyKey,
                  upstreamFailedAction: action.key,
                  upstreamFailedCommand: result.command,
                  verificationRequired: true,
                },
              ],
            });
          }
          await writeOutputs(plan, executed);
          console.error(`[auto-roll-forward] command failed: ${result.command}`);
          process.exit(1);
        }
      }
      const receiptStatus = actionReceiptStatusForResults(actionResults);
      await writeActionReceipt(action, receiptStatus, actionResults, {
        attempts: attempt,
        maxAttempts: action.maxAttempts,
        nextRetryAt: null,
        terminalReason: null,
        deadLetter: false,
        selfHealEvidence: [
          {
            jobId: action.jobId,
            module: action.module,
            reasonCode: action.reasonCode,
            status: "action_complete",
            idempotencyKey: action.idempotencyKey,
            verificationRequired: true,
          },
        ],
      });
    }
  }

  const files = await writeOutputs(plan, executed);
  console.log(JSON.stringify({
    ok: plan.decision.ok,
    mode: plan.mode,
    state: plan.decision.state,
    reason: plan.decision.reason,
    jobs: plan.jobs,
    executableJobs: plan.executableJobs,
    blockedJobs: plan.blockedJobs,
    output: files.jsonFile,
  }, null, 2));
  if (!plan.decision.ok && !APPLY) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[auto-roll-forward] failed: ${error.stack || error.message || error}`);
  process.exit(1);
});







