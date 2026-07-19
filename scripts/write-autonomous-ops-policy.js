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
    modules: modules.map((row) => ({ key: row.key, state: row.state, displayMode: row.displayMode, runId: row.runId })),
    output: jsonFile,
  }, null, 2));
  if (REQUIRE_UNATTENDED && decision.unattendedStatus !== "YES") process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[autonomous-ops-policy] failed: ${error.stack || error.message || error}`);
  process.exit(1);
});
