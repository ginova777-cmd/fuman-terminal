const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.resolve(process.argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length) || "outputs/autonomous-ops-policy");
const REQUIRE_UNATTENDED = process.argv.includes("--require-unattended");

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function lower(value) {
  return String(value || "").toLowerCase();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function isMarketClosedPreviousGood(manifest = {}, orchestrator = {}, waterRoot = {}) {
  const bits = [
    manifest.waterRoot?.status,
    manifest.waterRoot?.reason,
    manifest.blocker,
    orchestrator.blocker,
    orchestrator.overallState,
    waterRoot.status,
    waterRoot.reason,
  ].map(lower).join(" ");
  return bits.includes("market_closed_previous_good")
    || bits.includes("market_closed_formal_scan_skipped_preserve_previous_good");
}

function runIdDate(runId) {
  const match = String(runId || "").match(/(?:^|[-_])(\d{8})(?:[-_]|$)/);
  return match ? match[1] : "";
}

function modulePolicy(row = {}, context = {}) {
  const issues = Array.isArray(row.issues) ? row.issues : [];
  const runIds = row.runIds || {};
  const allRunIds = unique([row.runId, runIds.scanner, runIds.supabase, runIds.productionApi, runIds.desktop, runIds.mobile, runIds.scorecard88]);
  const closed = row.ok === true && row.complete === true && row.fallback !== true && issues.length === 0;
  const zeroResultComplete = closed && Number(row.resultCount || 0) === 0;
  const runDateOk = !row.runId || runIdDate(row.runId) === context.tradeDate;
  const runIdAligned = allRunIds.length <= 1;
  let state = "CLOSED";
  let displayMode = zeroResultComplete ? "today_zero_result_complete" : "today_complete";
  let allowPublish = true;
  let allowTerminalDisplay = true;
  let preservePreviousGood = false;
  const blockers = [];

  if (!closed) {
    allowPublish = false;
    preservePreviousGood = true;
    displayMode = "previous_good_degraded";
    state = row.fallback === true ? "DEGRADED_PREVIOUS_GOOD" : "BLOCKED";
    blockers.push(...issues);
  }
  if (!runIdAligned) {
    allowPublish = false;
    preservePreviousGood = true;
    displayMode = "blocked_runid_mismatch";
    state = "BLOCKED_RUNID_MISMATCH";
    blockers.push(`runId_mismatch:${allRunIds.join(",")}`);
  }
  if (!runDateOk) {
    allowPublish = false;
    preservePreviousGood = true;
    displayMode = "blocked_trade_date_mismatch";
    state = "BLOCKED_DATE_MISMATCH";
    blockers.push(`runId_date_mismatch:${runIdDate(row.runId) || "missing"}!=${context.tradeDate}`);
  }
  if (context.marketClosedPreviousGood && closed) {
    displayMode = "market_closed_previous_good";
    allowPublish = false;
    preservePreviousGood = true;
  }

  return {
    key: row.key,
    label: row.label || row.key,
    state,
    runId: row.runId || "",
    resultCount: Number(row.resultCount || 0),
    zeroResultComplete,
    runIdAligned,
    allowPublish,
    allowTerminalDisplay,
    preservePreviousGood,
    displayMode,
    blockers: unique(blockers),
    requiredClosure: {
      scanner: runIds.scanner || "",
      supabase: runIds.supabase || "",
      productionApi: runIds.productionApi || "",
      desktop: runIds.desktop || "",
      mobile: runIds.mobile || "",
      scorecard88: runIds.scorecard88 || row.scorecard88Protection || "",
    },
  };
}

function decide({ manifest, orchestrator, waterRoot, modules, marketClosedPreviousGood }) {
  const jobQueue = Array.isArray(orchestrator.jobQueue) ? orchestrator.jobQueue : [];
  const waterOk = manifest.waterRoot?.ok === true || waterRoot.ok === true;
  const manifestOk = manifest.ok === true;
  const allModulesClosed = modules.every((row) => row.state === "CLOSED" || (marketClosedPreviousGood && row.displayMode === "market_closed_previous_good"));
  const hasAuthBlock = jobQueue.some((job) => String(job.state || "").includes("AUTH"));
  const hasSourceBlock = jobQueue.some((job) => String(job.state || "").includes("SOURCE"));

  if (hasAuthBlock) {
    return {
      opsState: "BLOCKED_AUTH",
      unattendedStatus: "NO",
      formalScanAllowed: false,
      scorecardPublishAllowed: false,
      terminalSnapshotAllowed: false,
      autoRecoveryAllowed: false,
      action: "fix_service_token_first",
      reason: jobQueue.find((job) => String(job.state || "").includes("AUTH"))?.blocker || "auth_blocker",
    };
  }
  if (marketClosedPreviousGood && manifestOk && allModulesClosed) {
    return {
      opsState: "MARKET_CLOSED_PRESERVE_PREVIOUS_GOOD",
      unattendedStatus: "YES",
      formalScanAllowed: false,
      scorecardPublishAllowed: false,
      terminalSnapshotAllowed: true,
      autoRecoveryAllowed: true,
      action: "preserve_last_trading_day_and_wait_next_open",
      reason: "market_closed_previous_good",
    };
  }
  if (!waterOk || hasSourceBlock) {
    return {
      opsState: "BLOCKED_SOURCE",
      unattendedStatus: "NO",
      formalScanAllowed: false,
      scorecardPublishAllowed: false,
      terminalSnapshotAllowed: true,
      autoRecoveryAllowed: true,
      action: "wait_for_water_root_then_retry_only_blocked_jobs",
      reason: manifest.waterRoot?.reason || waterRoot.reason || jobQueue[0]?.blocker || "water_root_not_ready",
    };
  }
  if (manifestOk && allModulesClosed && jobQueue.length === 0) {
    return {
      opsState: "UNATTENDED_YES",
      unattendedStatus: "YES",
      formalScanAllowed: true,
      scorecardPublishAllowed: true,
      terminalSnapshotAllowed: true,
      autoRecoveryAllowed: true,
      action: "continue_autonomous_monitoring",
      reason: "all_closure_gates_green",
    };
  }
  return {
    opsState: "DEGRADED_RETRY_QUEUE",
    unattendedStatus: "NO",
    formalScanAllowed: false,
    scorecardPublishAllowed: false,
    terminalSnapshotAllowed: true,
    autoRecoveryAllowed: true,
    action: "run_job_queue_until_manifest_green",
    reason: manifest.blocker || jobQueue[0]?.blocker || "manifest_not_green",
  };
}

function buildActionMatrix({ decision = {}, manifest = {}, orchestrator = {}, waterRoot = {}, modules = [], marketClosedPreviousGood = false }) {
  const jobQueue = Array.isArray(orchestrator.jobQueue) ? orchestrator.jobQueue : [];
  const firstJob = jobQueue[0] || {};
  const opsState = decision.opsState || "DEGRADED_RETRY_QUEUE";
  const authBlocked = opsState === "BLOCKED_AUTH";
  const sourceBlocked = opsState === "BLOCKED_SOURCE";
  const marketClosed = opsState === "MARKET_CLOSED_PRESERVE_PREVIOUS_GOOD" || marketClosedPreviousGood;
  const unattended = opsState === "UNATTENDED_YES";
  const degraded = opsState === "DEGRADED_RETRY_QUEUE";
  const tradeDate = manifest.tradeDate || "unknown";

  const base = {
    contract: "autonomous-ops-action-matrix-v1",
    opsState,
    severity: "warning",
    stopMode: "protective_stop",
    formalScan: { allowed: false, mode: "blocked", reason: decision.reason || "not_green" },
    publish: { allowed: false, canaryRequired: true, mode: "blocked", reason: decision.reason || "not_green" },
    terminalDisplay: { allowed: true, mode: "previous_good_degraded", reason: decision.reason || "preserve_previous_good" },
    rollForward: { allowed: decision.autoRecoveryAllowed === true, mode: "dry_run_only", reason: decision.reason || "policy_controlled" },
    notify: { required: true, channel: "ops_alert", kind: "terminal_ops_attention", dedupeKey: `${opsState}:${tradeDate}:${firstJob.key || "root"}`, reason: decision.reason || firstJob.blocker || "ops_attention_required" },
    operatorAction: decision.action || "inspect_blocker_and_retry",
    automationAction: "hold_publish_preserve_previous_good",
    protectedInvariants: [
      "membership_auth_only_gates_display_not_scanner_compute",
      "fallback_or_previous_good_never_counts_as_today_publish_success",
      "scorecard_publish_requires_manifest_green",
      "scanner_run_requires_water_root_ready_or_market_open_gate",
      "auth_blocker_is_never_auto_fixed",
      "runid_trade_date_mismatch_blocks_publish",
      "zero_result_complete_is_success_empty_source_is_not",
    ],
  };

  if (unattended) {
    return {
      ...base,
      severity: "info",
      stopMode: "none",
      formalScan: { allowed: true, mode: "formal_scan_allowed", reason: "all_closure_gates_green" },
      publish: { allowed: true, canaryRequired: true, mode: "manifest_green_publish_allowed", reason: "manifest_and_runid_closure_green" },
      terminalDisplay: { allowed: true, mode: "today_complete", reason: "all_surfaces_same_runid" },
      rollForward: { allowed: true, mode: "idle_no_retry_needed", reason: "no_blocked_jobs" },
      notify: { required: false, channel: "ops_alert", kind: "none", dedupeKey: `UNATTENDED_YES:${tradeDate}`, reason: "no_operator_attention_needed" },
      operatorAction: "continue_autonomous_monitoring",
      automationAction: "monitor_only",
    };
  }

  if (marketClosed) {
    return {
      ...base,
      severity: "info",
      stopMode: "market_closed",
      formalScan: { allowed: false, mode: "skip_formal_scan", reason: "market_closed_preserve_previous_good" },
      publish: { allowed: false, canaryRequired: true, mode: "do_not_publish_new_scorecard", reason: "market_closed_previous_good" },
      terminalDisplay: { allowed: true, mode: "market_closed_previous_good", reason: "show_last_trading_day_with_market_closed_banner" },
      rollForward: { allowed: true, mode: "idle_until_next_trading_day", reason: "resume_automatically_next_open" },
      notify: { required: false, channel: "ops_alert", kind: "none", dedupeKey: `MARKET_CLOSED:${tradeDate}`, reason: "expected_market_closed_state" },
      operatorAction: "no_action_wait_next_open",
      automationAction: "preserve_previous_good_and_resume_next_trading_day",
    };
  }

  if (authBlocked) {
    return {
      ...base,
      severity: "critical",
      stopMode: "auth_protective_stop",
      formalScan: { allowed: false, mode: "blocked_auth", reason: decision.reason || "service_token_or_backend_auth_failed" },
      publish: { allowed: false, canaryRequired: true, mode: "blocked_auth", reason: "backend_auth_must_be_fixed_before_publish" },
      terminalDisplay: { allowed: true, mode: "previous_good_degraded", reason: "show_degraded_not_empty_or_success" },
      rollForward: { allowed: false, mode: "manual_auth_required", reason: "auth_blockers_are_not_auto_fixed" },
      notify: { required: true, channel: "ops_alert", kind: "backend_auth_blocked", dedupeKey: `BLOCKED_AUTH:${tradeDate}:${firstJob.key || "root"}`, reason: decision.reason || firstJob.blocker || "auth_blocker" },
      operatorAction: "fix_service_token_first_then_rerun_blocked_jobs",
      automationAction: "stop_scanners_and_publish_until_auth_fixed",
    };
  }

  if (sourceBlocked) {
    return {
      ...base,
      severity: "warning",
      stopMode: "source_protective_stop",
      formalScan: { allowed: false, mode: "blocked_source", reason: decision.reason || waterRoot.reason || "water_root_not_ready" },
      publish: { allowed: false, canaryRequired: true, mode: "blocked_source", reason: "source_root_not_ready" },
      terminalDisplay: { allowed: true, mode: "previous_good_degraded", reason: "source_blocked_preserve_previous_good" },
      rollForward: { allowed: true, mode: "source_recheck_only", reason: "retry_water_root_before_any_scanner" },
      notify: { required: true, channel: "ops_alert", kind: "water_root_blocked", dedupeKey: `BLOCKED_SOURCE:${tradeDate}:${waterRoot.status || manifest.waterRoot?.status || "source"}`, reason: decision.reason || waterRoot.reason || "water_root_not_ready" },
      operatorAction: "wait_for_water_root_pass_then_retry_only_blocked_jobs",
      automationAction: "retry_water_root_without_scanner_publish",
    };
  }

  if (degraded) {
    return {
      ...base,
      severity: "warning",
      stopMode: "retry_queue_hold_publish",
      formalScan: { allowed: false, mode: "retry_queue_pending", reason: decision.reason || "manifest_not_green" },
      publish: { allowed: false, canaryRequired: true, mode: "blocked_until_retry_queue_green", reason: "manifest_not_green" },
      terminalDisplay: { allowed: true, mode: "previous_good_degraded", reason: "blocked_jobs_pending" },
      rollForward: { allowed: true, mode: "safe_retry_queue", reason: "retry_only_retryable_jobs" },
      notify: { required: true, channel: "ops_alert", kind: "retry_queue_pending", dedupeKey: `DEGRADED:${tradeDate}:${jobQueue.length}`, reason: decision.reason || firstJob.blocker || "retry_queue_pending" },
      operatorAction: "run_rollforward_dry_run_then_apply_safe_jobs",
      automationAction: "retry_queue_until_manifest_green_then_canary_publish",
    };
  }

  return base;
}
function markdown(policy) {
  const lines = [];
  lines.push("# Autonomous Ops Policy");
  lines.push("");
  lines.push(`- checkedAt: ${policy.checkedAt}`);
  lines.push(`- tradeDate: ${policy.tradeDate}`);
  lines.push(`- opsState: ${policy.decision.opsState}`);
  lines.push(`- unattendedStatus: ${policy.decision.unattendedStatus}`);
  lines.push(`- action: ${policy.decision.action}`);
  lines.push(`- reason: ${policy.decision.reason}`);
  lines.push("");
  lines.push("## Policy Gates");
  lines.push("| gate | value |");
  lines.push("|---|---|");
  lines.push(`| formalScanAllowed | ${policy.decision.formalScanAllowed} |`);
  lines.push(`| scorecardPublishAllowed | ${policy.decision.scorecardPublishAllowed} |`);
  lines.push(`| terminalSnapshotAllowed | ${policy.decision.terminalSnapshotAllowed} |`);
  lines.push(`| autoRecoveryAllowed | ${policy.decision.autoRecoveryAllowed} |`);
  lines.push("");
  lines.push("## Action Matrix");
  lines.push("| action | mode | allowed|required | reason |");
  lines.push("|---|---|---:|---|");
  lines.push(`| formalScan | ${policy.actionMatrix.formalScan.mode} | ${policy.actionMatrix.formalScan.allowed} | ${policy.actionMatrix.formalScan.reason} |`);
  lines.push(`| publish | ${policy.actionMatrix.publish.mode} | ${policy.actionMatrix.publish.allowed} | ${policy.actionMatrix.publish.reason} |`);
  lines.push(`| terminalDisplay | ${policy.actionMatrix.terminalDisplay.mode} | ${policy.actionMatrix.terminalDisplay.allowed} | ${policy.actionMatrix.terminalDisplay.reason} |`);
  lines.push(`| rollForward | ${policy.actionMatrix.rollForward.mode} | ${policy.actionMatrix.rollForward.allowed} | ${policy.actionMatrix.rollForward.reason} |`);
  lines.push(`| notify | ${policy.actionMatrix.notify.kind} | ${policy.actionMatrix.notify.required} | ${policy.actionMatrix.notify.reason} |`);
  lines.push("");
  lines.push("## Module Policy");
  lines.push("| module | state | runId | displayMode | allowPublish | preservePreviousGood | blockers |");
  lines.push("|---|---|---|---|---:|---:|---|");
  for (const row of policy.modules) {
    lines.push(`| ${row.label} | ${row.state} | ${row.runId || "--"} | ${row.displayMode} | ${row.allowPublish} | ${row.preservePreviousGood} | ${row.blockers.join("<br>") || "--"} |`);
  }
  lines.push("");
  lines.push("## Job Queue");
  lines.push("| priority | module | state | nextAction | blocker |");
  lines.push("|---:|---|---|---|---|");
  for (const job of policy.jobQueue) {
    lines.push(`| ${job.priority ?? "--"} | ${job.label || job.key} | ${job.state} | ${job.nextAction || job.command || "--"} | ${job.blocker || "--"} |`);
  }
  return lines.join("\n");
}

async function main() {
  await fs.promises.mkdir(OUT_DIR, { recursive: true });
  const manifest = readJson(path.join(ROOT, "outputs", "daily-terminal-run", "daily-terminal-run-latest.json"), {});
  const orchestrator = readJson(path.join(ROOT, "outputs", "terminal-orchestrator", "terminal-orchestrator-state.json"), {});
  const waterRoot = readJson(path.join(ROOT, "outputs", "terminal-water-root", "terminal-water-root.json"), {});
  const tradeDate = manifest.tradeDate || orchestrator.tradeDate || waterRoot.displayTradeDate || waterRoot.expectedDate || "";
  const marketClosedPreviousGood = isMarketClosedPreviousGood(manifest, orchestrator, waterRoot);
  const modules = Array.isArray(manifest.modules)
    ? manifest.modules.map((row) => modulePolicy(row, { tradeDate, marketClosedPreviousGood }))
    : [];
  const decision = decide({ manifest, orchestrator, waterRoot, modules, marketClosedPreviousGood });
  const actionMatrix = buildActionMatrix({ decision, manifest, orchestrator, waterRoot, modules, marketClosedPreviousGood });
  const policy = {
    contract: "autonomous-ops-policy-v1",
    checkedAt: new Date().toISOString(),
    tradeDate,
    marketClosedPreviousGood,
    manifest: {
      ok: manifest.ok === true,
      unattendedStatus: manifest.unattendedStatus || "",
      blocker: manifest.blocker || "",
    },
    waterRoot: {
      ok: manifest.waterRoot?.ok === true || waterRoot.ok === true,
      status: manifest.waterRoot?.status || waterRoot.status || "",
      reason: manifest.waterRoot?.reason || waterRoot.reason || "",
    },
    orchestrator: {
      ok: orchestrator.ok === true,
      overallState: orchestrator.overallState || "",
      blocker: orchestrator.blocker || "",
    },
    decision,
    actionMatrix,
    modules,
    jobQueue: Array.isArray(orchestrator.jobQueue) ? orchestrator.jobQueue : [],
  };
  const jsonFile = path.join(OUT_DIR, "autonomous-ops-policy.json");
  const mdFile = path.join(OUT_DIR, "autonomous-ops-policy.md");
  await fs.promises.writeFile(jsonFile, JSON.stringify(policy, null, 2));
  await fs.promises.writeFile(mdFile, markdown(policy));
  console.log(JSON.stringify({
    ok: decision.unattendedStatus === "YES" || decision.autoRecoveryAllowed === true,
    opsState: decision.opsState,
    unattendedStatus: decision.unattendedStatus,
    tradeDate,
    action: decision.action,
    reason: decision.reason,
    actionMatrix: {
      severity: actionMatrix.severity,
      stopMode: actionMatrix.stopMode,
      formalScan: actionMatrix.formalScan,
      publish: actionMatrix.publish,
      rollForward: actionMatrix.rollForward,
      notify: actionMatrix.notify,
    },
    modules: modules.map((row) => ({ key: row.key, state: row.state, displayMode: row.displayMode, runId: row.runId })),
    output: jsonFile,
  }, null, 2));
  if (REQUIRE_UNATTENDED && decision.unattendedStatus !== "YES") process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[autonomous-ops-policy] failed: ${error.stack || error.message || error}`);
    process.exit(1);
  });
}

module.exports = {
  _private: {
    buildActionMatrix,
    decide,
    modulePolicy,
    isMarketClosedPreviousGood,
    runIdDate,
  },
};
