const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { classifyReason } = require("../lib/terminal-reason-code-classifier");
const { visibleCredentialState } = require("../lib/protected-readback-credential");

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
  });
  const exitCode = result.status ?? 1;
  const allowedNonZero = exitCode !== 0 && Array.isArray(step.allowExitCodes) && step.allowExitCodes.includes(Number(exitCode));
  return {
    label: step.label,
    command: printable(step),
    exitCode,
    ok: exitCode === 0 || allowedNonZero,
    allowedNonZero,
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

function alwaysRun(step) {
  step.alwaysRun = true;
  return step;
}

function nodeScriptStep(label, script, args = [], env = {}) {
  return {
    command: process.execPath,
    args: ["--use-system-ca", path.join("scripts", script), ...args],
    label,
    env,
  };
}

function degradedDisplayPublishSteps(tradeDate = currentTradeDate()) {
  const candidate = scorecardCandidateFile();
  return [
    alwaysRun(allowBlockedVerifier(nodeScriptStep("terminal-canary-publish:degraded-display", "verify-terminal-canary-publish.js", ["--scorecard=" + candidate]))),
    alwaysRun(nodeScriptStep("scorecard-publish-guard:degraded-display", "guard-daily-manifest-before-scorecard-publish.js", ["--allow-degraded", "--expected-date=" + tradeDate])),
    alwaysRun(nodeScriptStep("scorecard-publish-raw:degraded-display", "publish-scorecard-snapshot.js", ["--file=" + candidate, "--expected-date=" + tradeDate], {
      FUMAN_SCORECARD_MIN_ROWS: "1",
      FUMAN_SCORECARD_MIN_ROW_RATIO: "0",
    })),
  ];
}

function allowBlockedVerifier(step) {
  step.allowExitCodes = [1];
  step.blockerEvidenceAllowed = true;
  return step;
}
function scorecardCandidateFile() {
  return process.env.FUMAN_SCORECARD_SOURCE_FILE || "C:\\fuman-runtime\\data\\scorecard-terminal-current.json";
}

function manifestFromExistingStep(tradeDate = currentTradeDate()) {
  const step = npmRun("manifest:daily-terminal-run", ["--", "--from-existing", "--expected-date=" + tradeDate, "--scorecard-candidate-file=" + scorecardCandidateFile()]);
  step.allowExitCodes = [1];
  return alwaysRun(step);
}

function manifestFromExistingStrictStep(tradeDate = currentTradeDate()) {
  return npmRun("manifest:daily-terminal-run", ["--", "--from-existing", "--expected-date=" + tradeDate, "--scorecard-candidate-file=" + scorecardCandidateFile()]);
}

function manifestGatedScorecardPublishStep(tradeDate = currentTradeDate()) {
  return npmRun("scorecard:publish:manifest-gated", ["--", "--expected-date=" + tradeDate]);
}
function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function protectedReadbackCredentialArmed() {
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
  const canonical = waterRoot.canonicalGate || {};
  const sourcePayload = waterRoot.sourceStatus?.row?.payload || waterRoot.sourceStatus?.payload || {};
  const sourceRow = waterRoot.sourceStatus?.row || waterRoot.sourceStatus || {};
  return canonical.formalEntryAllowed === true
    || canonical.formal_entry_allowed === true
    || sourcePayload.formal_entry_allowed === true
    || sourceRow.formalEntryAllowed === true
    || sourceRow.formal_entry_allowed === true;
}

function sourceMetric(artifact = {}, camelName, snakeName = camelName) {
  const sourceStatus = artifact.sourceStatus || {};
  const row = sourceStatus.row || sourceStatus;
  const payload = row.payload || sourceStatus.payload || {};
  return payload[camelName]
    ?? payload[snakeName]
    ?? row[camelName]
    ?? row[snakeName]
    ?? sourceStatus[camelName]
    ?? sourceStatus[snakeName];
}

function sourceMetricNumber(artifact = {}, camelName, snakeName = camelName) {
  const value = Number(sourceMetric(artifact, camelName, snakeName));
  return Number.isFinite(value) ? value : null;
}

function scannerProfileForKey(key) {
  const profiles = {
    strategy2: {
      formalEntryRequired: true,
      sourceWindow: "intraday_formal_entry",
      minToday1mSymbols: 1,
      maxIntraday1mStaleSeconds: 120,
    },
    strategy3: {
      formalEntryRequired: false,
      sourceWindow: "post_intraday_1m_complete_scan",
      minToday1mSymbols: 1000,
      maxIntraday1mStaleSeconds: 120,
      dailyVolumeRequired: true,
    },
  };
  return profiles[key] || { formalEntryRequired: true, sourceWindow: "formal_entry" };
}

function strategySourceReadinessGate(key, artifact = {}) {
  const profile = scannerProfileForKey(key);
  if (profile.formalEntryRequired && !waterRootFormalEntryAllowed(artifact)) {
    return { ok: false, guard: "formal_entry_not_allowed_by_water_root", reason: artifact.reason || artifact.status || "formal_entry_not_allowed" };
  }
  if (!profile.formalEntryRequired) {
    const today1mSymbols = sourceMetricNumber(artifact, "today_1m_symbols", "today1mSymbols");
    const staleSeconds = sourceMetricNumber(artifact, "intraday_1m_stale_seconds", "intraday1mStaleSeconds");
    const dailyVolumeStatus = String(sourceMetric(artifact, "daily_volume_status", "dailyVolumeStatus") || "").toLowerCase();
    if (profile.minToday1mSymbols && (today1mSymbols === null || today1mSymbols < profile.minToday1mSymbols)) {
      return { ok: false, guard: "strategy_source_1m_symbols_not_ready", reason: `${key}:today_1m_symbols ${today1mSymbols ?? "missing"} < ${profile.minToday1mSymbols}` };
    }
    if (profile.maxIntraday1mStaleSeconds !== undefined && (staleSeconds === null || staleSeconds > profile.maxIntraday1mStaleSeconds)) {
      return { ok: false, guard: "strategy_source_1m_stale", reason: `${key}:intraday_1m_stale_seconds ${staleSeconds ?? "missing"} > ${profile.maxIntraday1mStaleSeconds}` };
    }
    if (profile.dailyVolumeRequired && dailyVolumeStatus !== "ready") {
      return { ok: false, guard: "strategy_source_daily_volume_not_ready", reason: `${key}:daily_volume_status ${dailyVolumeStatus || "missing"} != ready` };
    }
    return { ok: true, guard: "strategy_source_profile_ready", reason: `${key}:${profile.sourceWindow}_ready` };
  }
  return { ok: true, guard: "water_root_ok_formal_entry_allowed", reason: "ok" };
}

function scannerWaterRootGate(key, waterRoot = null) {
  const artifact = waterRoot || readJson(WATER_ROOT_FILE, null);
  if (!artifact) {
    return { ok: false, guard: "water_root_artifact_missing_scanner_blocked", reason: "water_root_artifact_missing" };
  }
  if (artifact.ok !== true) {
    return { ok: false, guard: "water_root_not_ok_scanner_blocked", reason: artifact.reason || artifact.status || "water_root_not_ok" };
  }
  return strategySourceReadinessGate(key, artifact);
}
function policyAllowsScannerRetryForStrategy(key, policy = {}) {
  const profile = scannerProfileForKey(key);
  const decision = policy.decision || {};
  if (decision.formalScanAllowed === true || policy.actionMatrix?.formalScan?.allowed === true) {
    return { ok: true, guard: "formal_scan_allowed_by_policy", reason: "policy_formal_scan_allowed" };
  }
  if (profile.formalEntryRequired === true) {
    return { ok: false, guard: "formal_scan_not_allowed_by_policy", reason: "formal_entry_strategy_requires_policy_formal_scan_allowed" };
  }
  if (decision.autoRecoveryAllowed === true && policy.actionMatrix?.rollForward?.allowed !== false) {
    return { ok: true, guard: "strategy_source_profile_retry_allowed", reason: `non_intraday_formal_strategy_retry_allowed:${profile.sourceWindow || "strategy_source_profile"}` };
  }
  return { ok: false, guard: "strategy_scan_not_allowed_by_policy", reason: decision.reason || "policy_disallows_strategy_retry" };
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

function actionIdempotencyKey(job = {}, key = "unknown", state = "PENDING", tradeDate = currentTradeDate()) {
  return safeId(job.idempotencyKey || [tradeDate, key, state, job.blocker || "none"].join(":"));
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

function completedReceipt(action = {}) {
  const receipt = readActionReceipt(action);
  const results = Array.isArray(receipt?.results) ? receipt.results : [];
  const hasSyntheticSuccess = results.some((row) => row?.skipped === true || row?.allowedNonZero === true);
  return receipt?.ok === true && receipt?.status === "complete" && !hasSyntheticSuccess ? receipt : null;
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
    ok: status === "complete",
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

function isDisplayClosureState(state = "") {
  const value = String(state || "");
  return value.includes("DISPLAY") || value.includes("DEGRADED") || value.includes("PREVIOUS") || value.includes("RUNID");
}function displayRepairTradeDateForJobs(jobs = [], fallback = currentTradeDate()) {
  const dates = unique((Array.isArray(jobs) ? jobs : [])
    .map((job) => normalizeTradeDate(job.repairTradeDate))
    .filter(Boolean));
  if (dates.length === 1) return dates[0];
  return normalizeTradeDate(fallback) || currentTradeDate();
}

function coalesceDisplayClosureJobs(jobs = [], displayTradeDate = currentTradeDate()) {
  const list = Array.isArray(jobs) ? jobs : [];
  const displayJobs = list.filter((job) => isDisplayClosureState(job.state));
  if (displayJobs.length <= 1) return list;
  const others = list.filter((job) => !isDisplayClosureState(job.state));
  const priority = Math.min(...displayJobs.map((job) => Number(job.priority ?? 80)));
  const affectedKeys = displayJobs.map((job) => job.key).filter(Boolean);
  const blockers = unique(displayJobs.map((job) => job.blocker || "").filter(Boolean));
  const issues = unique(displayJobs.flatMap((job) => Array.isArray(job.issues) ? job.issues : []));
  const repairTradeDate = displayRepairTradeDateForJobs(displayJobs, displayTradeDate);
  const coalesced = {
    key: "terminal-display-closure",
    label: "Terminal Display Closure",
    state: displayJobs.some((job) => String(job.state || "").includes("RUNID")) ? "BLOCKED_RUNID_MISMATCH" : "FAILED_DISPLAY",
    priority,
    retryable: true,
    repairTradeDate,
    blocker: blockers[0] || "terminal_display_closure_required",
    nextAction: "refresh_terminal_snapshot_bundle_mobile_88_readback",
    idempotencyKey: safeId([repairTradeDate, "terminal-display-closure", affectedKeys.join("+"), blockers[0] || "closure"].join(":")),
    receiptRequired: true,
    affectedKeys,
    coalescedJobCount: displayJobs.length,
    issues,
    executionGuard: "coalesced_display_snapshot_readback_only",
  };
  return [coalesced, ...others];
}

function manifestDerivedJobs(displayTradeDate = currentTradeDate()) {
  const manifest = readJson(path.join(ROOT, "outputs", "daily-terminal-run", "daily-terminal-run-latest.json"), {});
  const tradeDate = normalizeTradeDate(manifest.tradeDate || manifest.requestedDate || displayTradeDate);
  const rows = Array.isArray(manifest.modules) ? manifest.modules : [];
  const jobs = [];
  for (const row of rows) {
    const key = String(row.key || "").trim();
    if (!key || key === "market") continue;
    const issues = Array.isArray(row.issues) ? row.issues.map((issue) => String(issue || "")) : [];
    const pending = row.pendingNotDue === true || issues.some((issue) => /^pending_not_due(?::|$)/.test(issue));
    const staleDate = normalizeTradeDate(row.tradeDate) && tradeDate && normalizeTradeDate(row.tradeDate) !== tradeDate;
    const staleSource = normalizeTradeDate(row.sourceDate) && tradeDate && normalizeTradeDate(row.sourceDate) !== tradeDate;
    const fallback = row.fallback === true || row.rawFallback === true || issues.some((issue) => /fallback|previous_good|evidence_not_complete|sourceDate_mismatch|tradeDate_mismatch/i.test(issue));
    if (pending) continue;
    if (row.ok === true && row.complete === true && !staleDate && !staleSource && !fallback) continue;
    const state = staleDate || staleSource || fallback || row.complete !== true ? "FAILED_SCAN" : "FAILED_DISPLAY";
    const blocker = issues[0] || (staleDate ? `manifest_tradeDate_mismatch:${row.tradeDate}!=${tradeDate}` : "manifest_module_not_green");
    jobs.push({
      key,
      label: row.label || key,
      state,
      layer: state === "FAILED_SCAN" ? ["scanner", "manifest"] : ["display", "manifest"],
      priority: state === "FAILED_SCAN" ? 35 : 55,
      retryable: true,
      repairTradeDate: tradeDate || displayTradeDate,
      blocker,
      nextAction: state === "FAILED_SCAN" ? "rerun_idempotent_scanner_then_reverify_manifest_closure" : "refresh_terminal_snapshot_bundle_mobile_88_readback",
      idempotencyKey: safeId([tradeDate || displayTradeDate, key, state, blocker].join(":")),
      receiptRequired: true,
      issues,
      runId: row.runId || "",
      runIds: row.runIds || {},
      generatedFrom: "daily-terminal-run-manifest",
    });
  }
  if (manifest.ok !== true && rows.length) {
    jobs.push({
      key: "scorecard",
      label: "Scorecard Manifest Gate",
      state: "PUBLISH_DEFERRED_MANIFEST_PENDING",
      layer: ["scorecard", "manifest"],
      priority: 90,
      retryable: true,
      repairTradeDate: tradeDate || displayTradeDate,
      blocker: manifest.blocker || "manifest_not_green",
      nextAction: "wait_for_manifest_green_before_scorecard_publish",
      idempotencyKey: safeId([tradeDate || displayTradeDate, "scorecard", "PUBLISH_DEFERRED_MANIFEST_PENDING", manifest.blocker || "manifest"].join(":")),
      receiptRequired: true,
      issues: [manifest.blocker || "manifest_not_green"].filter(Boolean),
      generatedFrom: "daily-terminal-run-manifest",
    });
  }
  return jobs;
}

function normalizeJobs(orchestrator = {}, queue = [], displayTradeDate = currentTradeDate()) {
  const jobs = Array.isArray(queue) && queue.length ? queue : Array.isArray(orchestrator.jobQueue) ? orchestrator.jobQueue : [];
  const seen = new Set();
  const merged = [...manifestDerivedJobs(displayTradeDate), ...jobs].filter((job) => {
    const id = safeId([job.repairTradeDate || displayTradeDate, job.key, job.state].join(":"));
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return coalesceDisplayClosureJobs(merged, displayTradeDate);
}
function planForJob(job = {}, policy = {}, options = {}) {
  const state = String(job.state || "PENDING");
  const key = String(job.key || "unknown");
  const policyDecision = policy.decision || {};
  const base = {
    key,
    label: job.label || key,
    state,
    priority: Number(job.priority ?? 80),
    blocker: job.blocker || "",
    nextAction: job.nextAction || "",
    executable: false,
    executionGuard: "not_classified",
    commands: [],
    notes: [],
    idempotencyKey: actionIdempotencyKey(job, key, state, job.repairTradeDate || options.displayTradeDate || options.tradeDate || currentTradeDate()),
    receiptFile: "",
    receiptRequired: true,
    ...compactReasonClassification({ key, label: job.label || key, state, blocker: job.blocker || "", nextAction: job.nextAction || "" }),
  };
  if (isDisplayClosureState(state)) {
    base.idempotencyKey = safeId([normalizeTradeDate(job.repairTradeDate) || options.displayTradeDate || options.tradeDate || currentTradeDate(), key, state, job.blocker || "none"].join(":"));
  }
  base.receiptFile = receiptFileFor(base);

  if (state.includes("AUTH")) {
    base.executionGuard = "blocked_auth_requires_service_token_repair";
    base.notes.push("Auth failures are never auto-executed; membership display auth must not be confused with backend service token auth.");
    return base;
  }
  const issueList = Array.isArray(job.issues) ? job.issues.map((issue) => String(issue || "")) : [];
  const pendingNotDueIssue = issueList.find((issue) => /^pending_not_due(?::|$)/.test(issue));
  if ((state.includes("PENDING_NOT_DUE") || pendingNotDueIssue) && state.includes("SCAN")) {
    base.executable = false;
    base.executionGuard = "schedule_not_due_no_auto_repair";
    base.commands.push(manifestFromExistingStep(options.tradeDate || currentTradeDate()));
    base.notes.push(`Module is not due yet (${pendingNotDueIssue || state}); do not scan, publish, or rebuild snapshots until its schedule window arrives.`);
    return base;
  }


  if (state.includes("SOURCE")) {
    base.executable = true;
    base.executionGuard = "source_rewater_then_verify_no_scanner_publish";
    base.commands.push(npmRun(APPLY ? "daytrade-warmup:self-heal:apply" : "daytrade-warmup:self-heal"));
    base.commands.push(npmRun("verify:terminal-water-root"));
    base.notes.push("Source recovery runs idempotent daytrade rewater/self-heal, then rechecks root water; scanner/publish waits for Water Root PASS.");
    return base;
  }

  if (state.includes("SCAN")) {
    const policyGate = policyAllowsScannerRetryForStrategy(key, policy);
    const scannerApply = options.applyScanners === true || APPLY_SCANNERS;
    const waterGate = scannerWaterRootGate(key, options.waterRoot || null);
    const repairTradeDate = normalizeTradeDate(job.repairTradeDate) || options.tradeDate || currentTradeDate();
    base.repairTradeDate = repairTradeDate;
    const scannerCommand = scannerStepForKey(key, job.command, repairTradeDate);
    const recoveryCommands = [];
    if (scannerCommand) recoveryCommands.push(scannerCommand);
    recoveryCommands.push(...scannerPostRunSteps(key, repairTradeDate));

    base.commands.push(npmRun("verify:terminal-water-root"));
    base.commands.push(...recoveryCommands);

    if (!waterGate.ok) {
      base.executionGuard = waterGate.guard;
      base.executable = false;
      base.notes.push(`Scanner reruns are blocked until current Water Root PASS and the strategy source profile is ready: ${waterGate.reason}`);
      base.notes.push("Recovery chain is listed for transparency but will not execute until the gate passes; this prevents silent stale latest and makes the next roll-forward deterministic.");
      return base;
    }
    if (!policyGate.ok) {
      base.executionGuard = policyGate.guard;
      base.executable = false;
      base.notes.push(`Scanner reruns are blocked by Autonomous Ops Policy: ${policyGate.reason}`);
      base.notes.push("Recovery chain is listed for transparency but will not execute until policy allows the scanner retry.");
      return base;
    }
    base.executionGuard = scannerApply ? "scanner_apply_enabled" : "scanner_requires_apply_scanners";
    base.executable = scannerApply;
    base.notes.push(`Scanner reruns are idempotent-only, require current Water Root PASS, strategy-specific source readiness, --apply --apply-scanners, and policy gate: ${policyGate.reason}.`);
    base.notes.push("After the real scanner, strategy closure, manifest refresh, desktop snapshot, and runId closure are verified in the same idempotent action.");
    return base;
  }
  if (state === "PUBLISH_DEFERRED_MANIFEST_PENDING") {
    base.executionGuard = "manifest_pending_publish_deferred";
    base.executable = false;
    base.commands.push(npmRun("manifest:daily-terminal-run"));
    base.commands.push(npmRun("verify:daily-terminal-run-manifest"));
    base.notes.push("Scorecard publish waits until every due module reaches full Manifest green; no publish is executed while later modules are pending/not-due.");
    return base;
  }

  if (state.includes("PUBLISH")) {
    const publishAllowed = policyDecision.scorecardPublishAllowed === true || ALLOW_DEGRADED_PUBLISH;
    base.executable = publishAllowed;
    base.executionGuard = publishAllowed ? "manifest_gated_publish" : "manifest_not_green_publish_blocked";
    base.commands.push(npmRun("manifest:daily-terminal-run"));
    base.commands.push(npmRun("verify:daily-terminal-run-manifest"));
    if (publishAllowed) base.commands.push(npmRun("scorecard:publish"));
    base.notes.push("Scorecard publish is manifest-gated; previous good preserve is not a successful new publish.");
    return base;
  }

  if (state.includes("DISPLAY") || state.includes("DEGRADED") || state.includes("PREVIOUS") || state.includes("RUNID")) {
    if (requiresProtectedReadbackCredential(base) && !protectedReadbackCredentialArmed()) {
      base.executable = false;
      base.executionGuard = "protected_readback_credential_not_armed";
      base.commands.push(npmRun("verify:protected-readback-credential"));
      base.notes.push("Protected display readback cannot auto-execute until the member readback credential is armed; this is a manual secret repair, not a scanner retry.");
      return base;
    }
    const tradeDate = normalizeTradeDate(job.repairTradeDate) || options.displayTradeDate || options.tradeDate || currentTradeDate();
    base.repairTradeDate = tradeDate;
    base.executable = true;
    base.executionGuard = "display_snapshot_readback_only";
    base.commands.push(alwaysRun(npmRun("scorecard:terminal-source")));
    base.commands.push(manifestFromExistingStep(tradeDate));
    base.commands.push(alwaysRun(allowBlockedVerifier(npmRun("verify:daily-terminal-run-manifest", ["--", "--expected-date=" + tradeDate]))));
    base.commands.push(...degradedDisplayPublishSteps(tradeDate));
    base.commands.push(alwaysRun(npmRun("snapshot:desktop")));
    base.commands.push(alwaysRun(allowBlockedVerifier(npmRun("verify:terminal-resource-chain:unattended", ["--", `--expected-date=${tradeDate}`]))));
    base.commands.push(alwaysRun(allowBlockedVerifier(npmRun("verify:terminal-runid-closure", ["--", `--expected-date=${tradeDate}`]))));
    base.notes.push("Display repair rebuilds the same-day scorecard candidate, refreshes Manifest with that candidate, publishes scorecard_latest only through the Manifest gate, rebuilds terminal snapshots, and verifies desktop/mobile/88 runId closure.");
    return base;
  }

  base.executionGuard = "unhandled_state_plan_only";
  base.notes.push("Unknown state is planned only until a safe executor mapping exists.");
  return base;
}

function powershellScannerStep(key, scriptName) {
  return {
    command: process.platform === "win32" ? "pwsh.exe" : "pwsh",
    args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(".", scriptName)],
    label: "scanner:" + key,
  };
}

function scannerStepForKey(key, fallbackCommand = "", tradeDate = "") {
  // Scanner recovery must invoke the idempotent scan runner. Readback verifiers
  // are executed only after the runner publishes and must never replace it.
  const map = {
    strategy2: powershellScannerStep("strategy2", "run-strategy2-intraday.ps1", tradeDate),
    strategy3: powershellScannerStep("strategy3", "run-strategy3-complete-scan.ps1", tradeDate),
    strategy4: powershellScannerStep("strategy4", "run-strategy4.ps1", tradeDate),
    strategy5: powershellScannerStep("strategy5", "run-strategy5.ps1", tradeDate),
    institution: powershellScannerStep("institution", "run-institution.ps1", tradeDate),
    cb: powershellScannerStep("cb", "run-cb-detect.ps1", tradeDate),
    warrant: powershellScannerStep("warrant", "run-warrant-flow.ps1", tradeDate),
  };
  if (map[key]) return map[key];
  if (String(fallbackCommand) && !/\bnpm run verify:/.test(String(fallbackCommand))) {
    const parts = String(fallbackCommand).split(/\s+/).filter(Boolean);
    return { command: parts.shift(), args: parts, label: "scanner:" + key + ":fallback" };
  }
  return null;
}
function scannerClosureStepsForKey(key, tradeDate = "") {
  const map = {
    strategy2: "verify:strategy2-e2e-closure",
    strategy3: "verify:daytrade-strategy3-closure-live",
    strategy4: "verify:strategy4-postscan-closure",
    strategy5: "verify:strategy5-e2e-closure",
    institution: "verify:institution-e2e-closure",
    cb: "verify:cb-e2e-closure",
    warrant: "verify:warrant-e2e-closure",
  };
  const script = map[key];
  const expected = normalizeTradeDate(tradeDate);
  const args = expected ? ["--", "--expected-date=" + expected] : [];
  return script ? [npmRun(script, args)] : [];
}

function scannerPostRunSteps(key, tradeDate = currentTradeDate()) {
  return [
    ...scannerClosureStepsForKey(key, tradeDate),
    alwaysRun(npmRun("scorecard:terminal-source")),
    manifestFromExistingStep(tradeDate),
    alwaysRun(allowBlockedVerifier(npmRun("verify:daily-terminal-run-manifest", ["--", "--expected-date=" + tradeDate]))),
    ...degradedDisplayPublishSteps(tradeDate),
    alwaysRun(npmRun("snapshot:desktop")),
    alwaysRun(allowBlockedVerifier(npmRun("verify:terminal-resource-chain:unattended", ["--", "--expected-date=" + tradeDate]))),
    alwaysRun(allowBlockedVerifier(npmRun("verify:terminal-runid-closure", ["--", "--expected-date=" + tradeDate]))),
  ];
}
function currentTradeDate() {
  const manifest = readJson(path.join(ROOT, "outputs", "daily-terminal-run", "daily-terminal-run-latest.json"), {});
  return String(manifest.tradeDate || "").replace(/\D/g, "").slice(0, 8) || "latest";
}

function normalizeTradeDate(value = "") {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function displayClosureTargetTradeDate(orchestrator = {}) {
  const calendar = orchestrator.marketCalendar || orchestrator.market || {};
  const displayDate = normalizeTradeDate(
    calendar.displayTradeDate
    || calendar.lastCompleteTradeDate
    || calendar.lastTradingDate
    || calendar.lastOpenTradeDate
    || orchestrator.displayTradeDate
  );
  const current = normalizeTradeDate(orchestrator.tradeDate || currentTradeDate()) || currentTradeDate();
  const modeText = [
    calendar.displayMode,
    calendar.marketStatus,
    calendar.skipReason,
    calendar.reason,
    orchestrator.state,
    orchestrator.overallState,
  ].map((value) => String(value || "").toLowerCase()).join(" ");
  const formalSkipped = calendar.formalScanSkipped === true
    || calendar.formalSourceWindowOpen === false
    || calendar.marketOpen === false
    || calendar.isTradingDay === false
    || modeText.includes("previous_good")
    || modeText.includes("wait_source_window")
    || modeText.includes("before_formal_source_window")
    || modeText.includes("market_closed")
    || modeText.includes("holiday");
  return formalSkipped && displayDate ? displayDate : current;
}

function buildSafeRecoveryPreview(jobs = [], policy = {}, tradeDate = currentTradeDate(), displayTradeDate = tradeDate) {
  const actions = jobs.map((job) => planForJob(job, policy, { applyScanners: true, tradeDate, displayTradeDate }));
  const blocked = actions.filter((action) => !action.executable && action.state !== "CLOSED");
  const executable = actions.filter((action) => action.executable);
  const decision = decide(actions, policy);
  return {
    contract: "terminal-safe-recovery-preview-v1",
    ok: decision.ok === true,
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
function buildPlan({ orchestrator, policy, queue }) {
  const tradeDate = String(orchestrator.tradeDate || currentTradeDate());
  const displayTradeDate = displayClosureTargetTradeDate(orchestrator);
  const jobs = normalizeJobs(orchestrator, queue, displayTradeDate).sort((a, b) => Number(a.priority ?? 80) - Number(b.priority ?? 80));
  const actions = jobs.map((job) => planForJob(job, policy, { tradeDate, displayTradeDate }));
  const blocked = actions.filter((action) => !action.executable && action.state !== "CLOSED");
  const executable = actions.filter((action) => action.executable);
  return {
    contract: "terminal-auto-roll-forward-v1",
    checkedAt: new Date().toISOString(),
    mode: APPLY ? "apply" : "dry-run",
    applyScanners: APPLY_SCANNERS,
    tradeDate,
    displayTradeDate,
    policyState: policy.decision?.opsState || "",
    autoRecoveryAllowed: policy.decision?.autoRecoveryAllowed === true,
    jobs: jobs.length,
    executableJobs: executable.length,
    blockedJobs: blocked.length,
    actions,
    idempotencyContract: IDEMPOTENCY_CONTRACT,
    reasonCodeSummary: buildReasonCodeSummary(actions),
    safeRecoveryPreview: buildSafeRecoveryPreview(jobs, policy, tradeDate, displayTradeDate),
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
  const authBlocked = blocked.filter((action) => action.state.includes("AUTH") || requiresProtectedReadbackCredential(action));
  const nonAuthBlocked = blocked.filter((action) => !authBlocked.includes(action));

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
  return {
    ok: true,
    state: APPLY ? "AUTO_ROLL_FORWARD_APPLY_ARMED" : "AUTO_ROLL_FORWARD_DRY_RUN_READY",
    reason: APPLY ? "executing_safe_recovery_commands" : "dry_run_plan_only",
    applyAllowed: true,
  };
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
  lines.push(`- displayTradeDate: ${plan.displayTradeDate || plan.tradeDate}`);
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
  const waterOkFixture = { ok: true, canonicalGate: { formalEntryAllowed: true }, sourceStatus: { payload: { today_1m_symbols: 1200, intraday_1m_stale_seconds: 0, daily_volume_status: "ready" } } };
  const waterBlockedFixture = { ok: false, status: "blocked", reason: "canonical_gate_not_A:D" };
  const waterFormalEntryBlockedFixture = { ok: true, canonicalGate: { formalEntryAllowed: false }, reason: "formal_entry_allowed_false", sourceStatus: { payload: { today_1m_symbols: 1200, intraday_1m_stale_seconds: 0, daily_volume_status: "ready" } } };
  const cases = [
    { name: "auth-block", job: { key: "strategy4", state: "BLOCKED_AUTH", blocker: "401" }, expectedExecutable: false, expectedGuard: "blocked_auth" },
    { name: "source-check", job: { key: "strategy2", state: "BLOCKED_SOURCE" }, expectedExecutable: true, expectedGuard: "source_rewater" },
    { name: "scan-dry", job: { key: "strategy3", state: "FAILED_SCAN" }, options: { waterRoot: waterOkFixture }, expectedExecutable: APPLY_SCANNERS, expectedGuard: APPLY_SCANNERS ? "scanner_apply" : "scanner_requires" },
    { name: "scan-water-block", job: { key: "strategy3", state: "FAILED_SCAN" }, options: { waterRoot: waterBlockedFixture, applyScanners: true }, expectedExecutable: false, expectedGuard: "water_root_not_ok_scanner_blocked" },
    { name: "strategy2-formal-entry-block", job: { key: "strategy2", state: "FAILED_SCAN" }, options: { waterRoot: waterFormalEntryBlockedFixture, applyScanners: true }, expectedExecutable: false, expectedGuard: "formal_entry_not_allowed_by_water_root" },
    { name: "scan-policy-block", policy: { decision: { autoRecoveryAllowed: true, scorecardPublishAllowed: false, formalScanAllowed: false } }, job: { key: "strategy2", state: "FAILED_SCAN" }, options: { waterRoot: waterOkFixture, applyScanners: true }, expectedExecutable: false, expectedGuard: "formal_scan_not_allowed" },
    { name: "strategy3-post-intraday-source-ready", job: { key: "strategy3", state: "FAILED_SCAN" }, options: { waterRoot: waterFormalEntryBlockedFixture, applyScanners: true }, expectedExecutable: true, expectedGuard: "scanner_apply" },
    { name: "display", job: { key: "strategy5", state: "FAILED_DISPLAY" }, expectedExecutable: true, expectedGuard: "display_snapshot" },
    { name: "display-date-from-market-calendar", job: { key: "terminal-display-closure", state: "BLOCKED_RUNID_MISMATCH" }, options: { displayTradeDate: "20260730", tradeDate: "20260731" }, expectedExecutable: true, expectedGuard: "display_snapshot", expectedCommandDate: "20260730" },
    { name: "display-date-from-job-repair", job: { key: "terminal-display-closure", state: "BLOCKED_RUNID_MISMATCH", repairTradeDate: "20260730" }, options: { displayTradeDate: "20260731", tradeDate: "20260731" }, expectedExecutable: true, expectedGuard: "display_snapshot", expectedCommandDate: "20260730" },
    { name: "runid-mismatch-display-repair", job: { key: "institution", state: "BLOCKED_RUNID_MISMATCH", blocker: "scorecard /88 row/sourceReport runId != latest pointer" }, expectedExecutable: true, expectedGuard: "display_snapshot" },
    { name: "display-auth-unarmed", job: { key: "strategy2", state: "FAILED_DISPLAY", blocker: "protected_surface_needs_authenticated_readback_token", nextAction: "refresh_terminal_snapshot_bundle_mobile_88_readback" }, expectedExecutable: protectedReadbackCredentialArmed(), expectedGuard: protectedReadbackCredentialArmed() ? "display_snapshot" : "protected_readback_credential_not_armed" },
    { name: "publish-blocked", job: { key: "scorecard", state: "FAILED_PUBLISH" }, expectedExecutable: false, expectedGuard: "manifest_not_green" },
    { name: "publish-deferred", job: { key: "scorecard", state: "PUBLISH_DEFERRED_MANIFEST_PENDING" }, expectedExecutable: false, expectedGuard: "manifest_pending_publish_deferred" },
  ];
  const failures = [];
  for (const item of cases) {
    const action = planForJob(item.job, item.policy || policy, item.options || {});
    if (action.executable !== item.expectedExecutable) failures.push(`${item.name}: executable ${action.executable} != ${item.expectedExecutable}`);
    if (!action.executionGuard.includes(item.expectedGuard)) failures.push(`${item.name}: guard ${action.executionGuard} missing ${item.expectedGuard}`);
    if (item.expectedCommandDate && !action.commands.some((command) => printable(command).includes(`--expected-date=${item.expectedCommandDate}`))) failures.push(`${item.name}: commands missing expected display date ${item.expectedCommandDate}`);
    if (!Array.isArray(action.reasonCodes) || action.reasonCodes.length === 0 || action.reasonUnknown === true) failures.push(`${item.name}: reason codes missing or unknown`);
  }
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
  fs.rmSync(fakeAction.receiptFile, { force: true });
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
  const orchestrator = readJson(path.join(ROOT, "outputs", "terminal-orchestrator", "terminal-orchestrator-state.json"), {});
  const queue = readJson(path.join(ROOT, "outputs", "terminal-orchestrator", "terminal-job-queue.json"), []);
  const policy = readJson(path.join(ROOT, "outputs", "autonomous-ops-policy", "autonomous-ops-policy.json"), {});
  const plan = buildPlan({ orchestrator, policy, queue });
  const executed = [];

  if (APPLY) {
    if (!plan.decision.applyAllowed) {
      await writeOutputs(plan, executed);
      console.error(`[auto-roll-forward] apply blocked: ${plan.decision.state}: ${plan.decision.reason}`);
      process.exit(1);
    }
    for (const action of plan.actions.filter((item) => item.executable)) {
      const previousReceipt = readActionReceipt(action);
      const doneReceipt = completedReceipt(action);
      if (doneReceipt) {
        executed.push({
          label: `idempotent-skip:${action.key}`,
          command: "receipt-skip",
          exitCode: 0,
          ok: true,
          skipped: true,
          key: action.key,
          idempotencyKey: action.idempotencyKey,
          receiptFile: action.receiptFile,
          previousCheckedAt: doneReceipt.checkedAt || "",
        });
        continue;
      }
      const actionResults = [];
      for (const command of action.commands) {
        const previousResult = command.alwaysRun === true
          ? null
          : previousReceipt?.status === "failed"
            ? (previousReceipt.results || []).find((row) => row.command === printable(command) && row.ok === true)
            : null;
        if (previousResult) {
          const skipped = {
            label: "idempotent-skip-after-partial:" + action.key,
            command: "receipt-skip:" + printable(command),
            exitCode: 0,
            ok: true,
            skipped: true,
            key: action.key,
            idempotencyKey: action.idempotencyKey,
            receiptFile: action.receiptFile,
            previousCheckedAt: previousReceipt.checkedAt || "",
          };
          actionResults.push(skipped);
          executed.push(skipped);
          continue;
        }
        const result = { ...runCommand(command), alwaysRun: command.alwaysRun === true, key: action.key, idempotencyKey: action.idempotencyKey, receiptFile: action.receiptFile };
        actionResults.push(result);
        executed.push(result);
        if (!result.ok) {
          await writeActionReceipt(action, "failed", actionResults, { failedCommand: result.command });
          await writeOutputs(plan, executed);
          console.error(`[auto-roll-forward] command failed: ${result.command}`);
          process.exit(1);
        }
      }
      const actionFailed = actionResults.some((result) => result.ok === false);
      const actionPartial = !actionFailed && actionResults.some((result) => result.allowedNonZero === true || result.skipped === true);
      const receiptStatus = actionFailed ? "failed" : actionPartial ? "partial_with_blockers" : "complete";
      await writeActionReceipt(action, receiptStatus, actionResults, actionFailed ? { failedCommand: actionResults.find((result) => result.ok === false)?.command || "unknown" } : actionPartial ? { partialReason: "blocker evidence or synthetic skip was recorded; do not use as completed idempotency receipt" } : {});
      if (actionFailed) {
        await writeOutputs(plan, executed);
        process.exit(1);
      }
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
