const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { buildMarketCalendarContract } = require("../lib/market-calendar-contract");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.resolve(process.argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length) || "outputs/terminal-orchestrator");
let EXPECTED_DATE = (process.argv.find((arg) => arg.startsWith("--expected-date="))?.slice("--expected-date=".length) || "").replace(/\D/g, "").slice(0, 8);
const FROM_EXISTING = process.argv.includes("--from-existing");
const SELF_TEST = process.argv.includes("--self-test");
const LIFECYCLE_STATES = ["PENDING", "WATER_OK", "RUNNING", "SCANNED", "PUBLISHED", "DISPLAY_VERIFIED", "CLOSED"];
const FAILURE_STATES = ["BLOCKED_SOURCE", "BLOCKED_AUTH", "FAILED_SCAN", "FAILED_PUBLISH", "FAILED_DISPLAY", "DEGRADED_PREVIOUS_GOOD", "BLOCKED_RUNID_MISMATCH", "BLOCKED_DATE_MISMATCH"];
const STATE_MACHINE_CONTRACT = {
  contract: "terminal-state-machine-v1",
  lifecycle: LIFECYCLE_STATES,
  failureStates: FAILURE_STATES,
  terminalStates: ["CLOSED", "DEGRADED_PREVIOUS_GOOD", "BLOCKED_SOURCE", "BLOCKED_AUTH", "FAILED_SCAN", "FAILED_PUBLISH", "FAILED_DISPLAY"],
  invariants: [
    "water_root_must_pass_before_scanner_publish",
    "scanner_receipt_runid_must_equal_supabase_latest_pointer",
    "production_api_desktop_mobile_88_must_share_runid",
    "fallback_or_previous_good_cannot_publish_today_success",
    "auth_blocker_requires_manual_service_token_repair",
    "market_closed_skips_formal_scan_and_preserves_previous_good",
  ],
};

function taipeiDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date).replace(/\D/g, "");
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function runNode(args, label) {
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env },
  });
  return {
    label,
    command: `node ${args.join(" ")}`,
    exitCode: result.status ?? 1,
    ok: result.status === 0,
    stdout: String(result.stdout || "").slice(-3000),
    stderr: String(result.stderr || "").slice(-3000),
  };
}

function issueText(row = {}) {
  return Array.isArray(row.issues) ? row.issues.join(" | ").toLowerCase() : "";
}

function has(text, ...needles) {
  return needles.some((needle) => text.includes(needle));
}

function isMarketClosedPreviousGood(manifest = {}, marketCalendar = null) {
  const reason = String(manifest.waterRoot?.reason || manifest.blocker || "").toLowerCase();
  const sourceStatus = String(manifest.waterRoot?.sourceStatus?.status || "").toLowerCase();
  const message = String(manifest.waterRoot?.sourceStatus?.message || "").toLowerCase();
  const status = String(manifest.waterRoot?.status || manifest.unattendedStatus || "").toLowerCase();
  return Boolean(
    manifest.previousGoodHold === true
    || manifest.waterRoot?.previousGoodHold === true
    || status.includes("previous_good")
    || status.includes("wait_source_window")
    || reason.includes("previous_good")
    || reason.includes("wait_source_window")
    || (marketCalendar?.marketOpen === false
      && (sourceStatus === "stopped" || reason.includes("stopped") || message.includes("off-session")))
  );
}

function classifyModule(row = {}, manifest = {}, marketCalendar = null) {
  const text = issueText(row);
  const waterBlocked = manifest.waterRoot?.ok === false && !isMarketClosedPreviousGood(manifest, marketCalendar);
  const runIds = row.runIds || {};
  const layer = [];
  let state = "PENDING";
  let blocker = "";

  if (row.ok === true && row.complete === true && row.fallback !== true) {
    return {
      state: "CLOSED",
      layer: ["closed"],
      blocker: "",
      nextAction: "none",
      retryable: false,
      priority: 90,
    };
  }

  if (has(text, "401", "unauthorized")) {
    state = "BLOCKED_AUTH";
    layer.push("auth");
    blocker = "backend_service_token_missing_or_invalid";
  } else if (has(text, "scanner receipt", "scanner_not_complete", "failed exit")) {
    state = "FAILED_SCAN";
    layer.push("scanner");
    blocker = row.issues?.[0] || "scanner_not_complete";
  } else if (has(text, "scorecard", "publish")) {
    state = "FAILED_PUBLISH";
    layer.push("publish", "scorecard88");
    blocker = row.issues?.[0] || "scorecard_publish_not_closed";
  } else if (waterBlocked || has(text, "source", "water", "not_ready", "stale", "coverage", "date mismatch", "tradedate_mismatch", "sourcedate_mismatch")) {
    state = "BLOCKED_SOURCE";
    layer.push("source");
    blocker = manifest.waterRoot?.reason || row.issues?.[0] || "source_not_ready";
  } else if (has(text, "authenticated readback", "membership")) {
    state = "FAILED_DISPLAY";
    layer.push("display", "auth_readback");
    blocker = "protected_surface_needs_authenticated_readback_token";
  } else if (row.fallback === true || has(text, "fallback", "previous", "old", "mismatch")) {
    state = "DEGRADED_PREVIOUS_GOOD";
    layer.push("display", "previous_good");
    blocker = row.issues?.[0] || "previous_good_or_fallback";
  } else {
    state = "FAILED_DISPLAY";
    layer.push("display");
    blocker = row.issues?.[0] || "terminal_display_not_closed";
  }
  const missingRunId = !row.runId || !runIds.scanner || !runIds.productionApi || !runIds.desktop || !runIds.mobile || !runIds.scorecard88;
  if (missingRunId && !layer.includes("display")) layer.push("display");

  return {
    state,
    layer: [...new Set(layer)],
    blocker,
    nextAction: nextActionForState(state, row),
    retryable: state !== "BLOCKED_AUTH" || has(text, "authenticated readback"),
    priority: priorityForState(state),
  };
}

function priorityForState(state) {
  return {
    BLOCKED_AUTH: 10,
    BLOCKED_SOURCE: 20,
    FAILED_SCAN: 30,
    FAILED_PUBLISH: 40,
    DEGRADED_PREVIOUS_GOOD: 50,
    FAILED_DISPLAY: 60,
    PENDING: 70,
    CLOSED: 90,
  }[state] || 80;
}

function nextActionForState(state, row = {}) {
  if (state === "BLOCKED_AUTH") return "fix_service_token_or_authenticated_readback_then_rerun_module";
  if (state === "BLOCKED_SOURCE") return "wait_or_fix_water_root_then_rerun_only_affected_module";
  if (state === "FAILED_SCAN") return "rerun_strategy_scanner_after_water_ok";
  if (state === "FAILED_PUBLISH") return "rerun_scorecard_source_sync_and_manifest_publish_gate";
  if (state === "DEGRADED_PREVIOUS_GOOD") return "rebuild_today_snapshot_and_verify_no_old_runid";
  if (state === "FAILED_DISPLAY") return "refresh_terminal_snapshot_bundle_mobile_88_readback";
  return "none";
}

function lifecycleStageForRow(row = {}, classification = {}, manifest = {}, marketCalendar = null) {
  if (classification.state && classification.state !== "CLOSED") return classification.state;
  const runIds = row.runIds || {};
  const waterClosed = isMarketClosedPreviousGood(manifest, marketCalendar);
  if (row.ok === true && row.complete === true && row.fallback !== true) return "CLOSED";
  if (runIds.desktop || runIds.mobile || runIds.scorecard88) return "DISPLAY_VERIFIED";
  if (runIds.productionApi || runIds.supabase || row.publishAllowed === true) return "PUBLISHED";
  if (runIds.scanner || row.runId) return "SCANNED";
  if (manifest.waterRoot?.ok === true || waterClosed) return "WATER_OK";
  return "PENDING";
}

function retryPolicyForState(state) {
  const policies = {
    BLOCKED_AUTH: { maxAttempts: 0, backoffSeconds: 0, fuseAfterAttempts: 0, autoRetry: false, manualRepairRequired: true },
    BLOCKED_SOURCE: { maxAttempts: 12, backoffSeconds: 60, fuseAfterAttempts: 12, autoRetry: true, manualRepairRequired: false },
    FAILED_SCAN: { maxAttempts: 2, backoffSeconds: 180, fuseAfterAttempts: 2, autoRetry: false, manualRepairRequired: false },
    FAILED_PUBLISH: { maxAttempts: 2, backoffSeconds: 120, fuseAfterAttempts: 2, autoRetry: true, manualRepairRequired: false },
    DEGRADED_PREVIOUS_GOOD: { maxAttempts: 3, backoffSeconds: 60, fuseAfterAttempts: 3, autoRetry: true, manualRepairRequired: false },
    FAILED_DISPLAY: { maxAttempts: 3, backoffSeconds: 60, fuseAfterAttempts: 3, autoRetry: true, manualRepairRequired: false },
  };
  return policies[state] || { maxAttempts: 1, backoffSeconds: 120, fuseAfterAttempts: 1, autoRetry: false, manualRepairRequired: false };
}

function idempotencyKeyFor(row = {}, classification = {}) {
  const raw = [EXPECTED_DATE || "latest", row.key || "unknown", classification.state || "PENDING", classification.blocker || "none"].join(":");
  return raw.replace(/[^a-zA-Z0-9:_-]+/g, "_").slice(0, 180);
}
function jobForRow(row, classification) {
  if (classification.state === "CLOSED") return null;
  const command = commandFor(row.key, classification.state);
  return {
    key: row.key,
    label: row.label || row.key,
    state: classification.state,
    layer: classification.layer,
    priority: classification.priority,
    retryable: classification.retryable,
    blocker: classification.blocker,
    nextAction: classification.nextAction,
    command,
    idempotencyKey: idempotencyKeyFor(row, classification),
    retryPolicy: retryPolicyForState(classification.state),
    requiresWaterRootOk: ["FAILED_SCAN", "FAILED_PUBLISH", "DEGRADED_PREVIOUS_GOOD", "FAILED_DISPLAY"].includes(classification.state),
    expectedDate: EXPECTED_DATE,
    runId: row.runId || "",
    runIds: row.runIds || {},
    issues: row.issues || [],
  };
}

function commandFor(key, state) {
  if (state === "BLOCKED_AUTH") return "verify service token env, then rerun scanner/readback with machine token";
  if (state === "BLOCKED_SOURCE") return "npm run verify:terminal-water-root";
  if (state === "FAILED_PUBLISH") return "npm run manifest:daily-terminal-run && npm run scorecard:publish";
  if (state === "FAILED_DISPLAY") return "npm run verify:terminal-resource-chain:unattended";
  const map = {
    strategy2: `npm run verify:strategy2-e2e-closure -- --expected-date=${EXPECTED_DATE}`,
    strategy3: "npm run verify:daytrade-strategy3-closure-live",
    strategy4: "pwsh -NoProfile -ExecutionPolicy Bypass -File .\\run-strategy4.ps1",
    strategy5: "pwsh -NoProfile -ExecutionPolicy Bypass -File .\\run-strategy5.ps1",
    institution: "npm run verify:institution-live-closure",
    cb: "npm run verify:cb-live-readback",
    warrant: "npm run verify:warrant-live-closure",
  };
  return map[key] || "rerun module scanner and terminal readback";
}

function overallState(manifest, moduleStates, marketCalendar = null) {
  if (manifest.ok === true && moduleStates.every((row) => row.state === "CLOSED")) return "CLOSED";
  if ((manifest.waterRoot?.ok === false && !isMarketClosedPreviousGood(manifest, marketCalendar)) || moduleStates.some((row) => row.state === "BLOCKED_SOURCE")) return "BLOCKED_SOURCE";
  if (moduleStates.some((row) => row.state === "BLOCKED_AUTH")) return "BLOCKED_AUTH";
  if (moduleStates.some((row) => row.state === "FAILED_SCAN")) return "FAILED_SCAN";
  if (moduleStates.some((row) => row.state === "FAILED_PUBLISH")) return "FAILED_PUBLISH";
  return "DEGRADED_PREVIOUS_GOOD";
}

function selfTest() {
  const closedMarket = { marketOpen: false };
  const waterBlockedManifest = { waterRoot: { ok: false, reason: "source_root_not_ready" } };
  const cases = [
    {
      name: "closed_module_has_no_job",
      row: { key: "strategy2", label: "Strategy2", ok: true, complete: true, fallback: false, runId: "strategy2-20260717-good", runIds: { scanner: "x", productionApi: "x", desktop: "x", mobile: "x", scorecard88: "x" }, issues: [] },
      manifest: { waterRoot: { ok: true } },
      expectedState: "CLOSED",
      expectedJob: false,
    },
    {
      name: "auth_401_becomes_manual_job",
      row: { key: "strategy4", label: "Strategy4", ok: false, complete: false, issues: ["401 Unauthorized while syncing scorecard"] },
      manifest: { waterRoot: { ok: true } },
      expectedState: "BLOCKED_AUTH",
      expectedJob: true,
      expectedRetry: { maxAttempts: 0, manualRepairRequired: true },
    },
    {
      name: "source_not_ready_becomes_water_recheck_only",
      row: { key: "strategy2", label: "Strategy2", ok: false, complete: false, issues: ["source not_ready coverage low"] },
      manifest: waterBlockedManifest,
      expectedState: "BLOCKED_SOURCE",
      expectedJob: true,
      expectedCommand: "npm run verify:terminal-water-root",
    },
    {
      name: "scanner_failure_requires_water_root",
      row: { key: "strategy3", label: "Strategy3", ok: false, complete: false, issues: ["scanner receipt failed exit=1"] },
      manifest: { waterRoot: { ok: true } },
      expectedState: "FAILED_SCAN",
      expectedJob: true,
      requiresWaterRootOk: true,
    },
    {
      name: "scorecard_missing_becomes_publish_job",
      row: { key: "warrant", label: "Warrant", ok: false, complete: false, issues: ["scorecard sourceReport missing row"] },
      manifest: { waterRoot: { ok: true } },
      expectedState: "FAILED_PUBLISH",
      expectedJob: true,
      requiresWaterRootOk: true,
    },
    {
      name: "display_auth_readback_not_backend_auth",
      row: { key: "cb", label: "CB", ok: false, complete: false, issues: ["authenticated readback token not armed"] },
      manifest: { waterRoot: { ok: true } },
      expectedState: "FAILED_DISPLAY",
      expectedJob: true,
    },
    {
      name: "fallback_previous_good_is_degraded_job",
      row: { key: "strategy5", label: "Strategy5", ok: false, complete: true, fallback: true, issues: ["previous good fallback used"] },
      manifest: { waterRoot: { ok: true } },
      expectedState: "DEGRADED_PREVIOUS_GOOD",
      expectedJob: true,
    },
    {
      name: "market_closed_previous_good_does_not_become_source_block",
      row: { key: "institution", label: "Institution", ok: true, complete: true, fallback: false, runId: "institution-20260717-good", issues: [] },
      manifest: { previousGoodHold: true, waterRoot: { ok: false, reason: "market_closed_previous_good", sourceStatus: { status: "stopped", message: "off-session" } } },
      marketCalendar: closedMarket,
      expectedState: "CLOSED",
      expectedJob: false,
    },
  ];
  const failures = [];
  const results = cases.map((item) => {
    const classification = classifyModule(item.row, item.manifest || {}, item.marketCalendar || null);
    const lifecycleStage = lifecycleStageForRow(item.row, classification, item.manifest || {}, item.marketCalendar || null);
    const stateRow = { ...item.row, ...classification, lifecycleStage };
    const job = jobForRow(stateRow, stateRow);
    if (classification.state !== item.expectedState) failures.push(`${item.name}: state ${classification.state} != ${item.expectedState}`);
    if (Boolean(job) !== item.expectedJob) failures.push(`${item.name}: job ${Boolean(job)} != ${item.expectedJob}`);
    if (item.expectedRetry && job) {
      for (const [key, value] of Object.entries(item.expectedRetry)) {
        if (job.retryPolicy?.[key] !== value) failures.push(`${item.name}: retryPolicy.${key} ${job.retryPolicy?.[key]} != ${value}`);
      }
    }
    if (item.expectedCommand && job?.command !== item.expectedCommand) failures.push(`${item.name}: command ${job?.command} != ${item.expectedCommand}`);
    if (item.requiresWaterRootOk !== undefined && job?.requiresWaterRootOk !== item.requiresWaterRootOk) failures.push(`${item.name}: requiresWaterRootOk ${job?.requiresWaterRootOk} != ${item.requiresWaterRootOk}`);
    return {
      name: item.name,
      state: classification.state,
      lifecycleStage,
      jobState: job?.state || "none",
      command: job?.command || "",
      retryPolicy: job?.retryPolicy || null,
      blocker: job?.blocker || classification.blocker || "",
    };
  });
  return { ok: failures.length === 0, contract: "terminal-orchestrator-state-self-test-v1", caseCount: cases.length, failures, results };
}
function markdown(state) {
  const lines = [];
  lines.push("# Terminal Orchestrator State");
  lines.push("");
  lines.push(`- checkedAt: ${state.checkedAt}`);
  lines.push(`- tradeDate: ${state.tradeDate}`);
  lines.push(`- overallState: ${state.overallState}`);
  lines.push(`- unattendedStatus: ${state.unattendedStatus}`);
  lines.push(`- blocker: ${state.blocker || "--"}`);
  lines.push("");
  lines.push("## Module State");
  lines.push("| module | state | layer | runId | next action | blocker | issues |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const row of state.modules) {
    lines.push(`| ${row.label} | ${row.state} | ${row.layer.join(", ") || "--"} | ${row.runId || "--"} | ${row.nextAction} | ${row.blocker || "--"} | ${(row.issues || []).join("<br>") || "--"} |`);
  }
  lines.push("");
  lines.push("## Job Queue");
  lines.push("| priority | module | state | command | blocker |");
  lines.push("|---:|---|---|---|---|");
  for (const job of state.jobQueue) {
    lines.push(`| ${job.priority} | ${job.label} | ${job.state} | ${job.command} | ${job.blocker} |`);
  }
  return lines.join("\n");
}

async function main() {
  if (SELF_TEST) {
    const result = selfTest();
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exit(1);
    return;
  }
  await fs.promises.mkdir(OUT_DIR, { recursive: true });
  const marketCalendar = await buildMarketCalendarContract().catch(() => null);
  if (!EXPECTED_DATE) {
    const calendarExpected = String(marketCalendar?.displayTradeDate || taipeiDateKey()).replace(/\D/g, "").slice(0, 8);
    EXPECTED_DATE = calendarExpected || taipeiDateKey();
  }
  const commands = [];
  if (!FROM_EXISTING) {
    commands.push(runNode(["--use-system-ca", "scripts/write-daily-terminal-run-manifest.js", `--expected-date=${EXPECTED_DATE}`], "daily-terminal-run-manifest"));
  }
  const manifest = readJson(path.join(ROOT, "outputs", "daily-terminal-run", "daily-terminal-run-latest.json"), {});
  const modules = Array.isArray(manifest.modules) ? manifest.modules : [];
  const moduleStates = modules.map((row) => {
    const classification = classifyModule(row, manifest, marketCalendar);
    return {
      ...row,
      ...classification,
      lifecycleStage: lifecycleStageForRow(row, classification, manifest, marketCalendar),
    };
  });
  const jobQueue = moduleStates
    .map((row) => jobForRow(row, row))
    .filter(Boolean)
    .sort((a, b) => a.priority - b.priority || String(a.key).localeCompare(String(b.key)));
  const state = {
    contract: "terminal-orchestrator-state-v1",
    checkedAt: new Date().toISOString(),
    tradeDate: EXPECTED_DATE,
    manifestPath: path.join(ROOT, "outputs", "daily-terminal-run", "daily-terminal-run-latest.json"),
    manifestOk: manifest.ok === true,
    waterRoot: manifest.waterRoot || null,
    commands,
    marketCalendar,
    stateMachineContract: STATE_MACHINE_CONTRACT,
    marketClosedPreviousGood: isMarketClosedPreviousGood(manifest, marketCalendar),
    overallState: overallState(manifest, moduleStates, marketCalendar),
    unattendedStatus: manifest.ok === true && jobQueue.length === 0 ? (isMarketClosedPreviousGood(manifest, marketCalendar) ? "PREVIOUS_GOOD_HOLD" : "YES") : "NO",
    blocker: isMarketClosedPreviousGood(manifest, marketCalendar) ? (jobQueue[0]?.blocker || "market_closed_previous_good") : (manifest.blocker || jobQueue[0]?.blocker || ""),
    modules: moduleStates,
    jobQueue,
  };
  const stateFile = path.join(OUT_DIR, "terminal-orchestrator-state.json");
  const queueFile = path.join(OUT_DIR, "terminal-job-queue.json");
  const mdFile = path.join(OUT_DIR, "terminal-orchestrator-state.md");
  await fs.promises.writeFile(stateFile, JSON.stringify(state, null, 2));
  await fs.promises.writeFile(queueFile, JSON.stringify(jobQueue, null, 2));
  await fs.promises.writeFile(mdFile, markdown(state));
  console.log(JSON.stringify({
    ok: state.unattendedStatus === "YES" || state.unattendedStatus === "PREVIOUS_GOOD_HOLD",
    unattendedStatus: state.unattendedStatus,
    overallState: state.overallState,
    tradeDate: state.tradeDate,
    blocker: state.blocker,
    jobs: jobQueue.map((job) => ({ key: job.key, state: job.state, action: job.nextAction })),
    output: stateFile,
    queue: queueFile,
  }, null, 2));
  if (state.unattendedStatus !== "YES" && state.unattendedStatus !== "PREVIOUS_GOOD_HOLD") process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[terminal-orchestrator-state] failed: ${error.stack || error.message || error}`);
  process.exit(1);
});









