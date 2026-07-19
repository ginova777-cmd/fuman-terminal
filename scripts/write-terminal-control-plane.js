const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { buildPreflight } = require("./check-full-scan-date-preflight");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.resolve(process.argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length) || "outputs/terminal-control-plane");
const FROM_EXISTING = process.argv.includes("--from-existing");
const REQUIRE_UNATTENDED = process.argv.includes("--require-unattended");
let EXPECTED_DATE = (process.argv.find((arg) => arg.startsWith("--expected-date="))?.slice("--expected-date=".length) || "").replace(/\D/g, "").slice(0, 8);

function taipeiDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date).replace(/\D/g, "");
}

function compactDate(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function readJson(file, fallback = {}) {
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
    stdout: String(result.stdout || "").slice(-5000),
    stderr: String(result.stderr || "").slice(-5000),
  };
}

function runIdDate(value) {
  const match = String(value || "").match(/(?:^|[-_])(\d{8})(?:[-_]|$)/);
  return match ? match[1] : "";
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function marketClosedPreviousGood(manifest = {}, policy = {}, preflight = {}) {
  const bits = [
    manifest.waterRoot?.status,
    manifest.waterRoot?.reason,
    manifest.blocker,
    policy.decision?.opsState,
    policy.decision?.reason,
    preflight.action,
    preflight.status,
  ].map((item) => String(item || "").toLowerCase()).join(" ");
  return bits.includes("market_closed") || policy.marketClosedPreviousGood === true;
}

function preflightGate(preflight = {}, expectedDate = "") {
  const marketClosed = String(preflight.action || "") === "skip_formal_scan" || String(preflight.status || "") === "market_closed";
  const ready = preflight.ok === true && (preflight.status === "ready" || marketClosed);
  return {
    ok: ready,
    status: marketClosed ? "MARKET_CLOSED_SKIP_SCAN" : (ready ? "READY" : "BLOCKED"),
    expectedDate,
    scannerTargetDate: compactDate(preflight.scannerTargetDate || preflight.scannerTargetTradeDate),
    displayTradeDate: compactDate(preflight.displayTradeDate || preflight.marketCalendar?.displayTradeDate),
    action: preflight.action || "",
    reason: preflight.reason || "",
    publishAllowed: preflight.publishAllowed === true,
    preservePreviousGood: preflight.preservePreviousGood === true,
    evidenceStatus: preflight.evidenceStatus || "",
  };
}

function canaryPublishGate(manifest = {}, policy = {}) {
  const decision = policy.decision || {};
  const closed = policy.marketClosedPreviousGood === true || decision.opsState === "MARKET_CLOSED_PRESERVE_PREVIOUS_GOOD";
  if (closed) {
    return {
      ok: true,
      status: "NOT_ARMED_MARKET_CLOSED_PREVIOUS_GOOD",
      scorecardPublishAllowed: false,
      reason: "market_closed_preserve_previous_good_do_not_publish_new_scorecard",
    };
  }
  const ok = manifest.ok === true
    && manifest.unattendedStatus === "YES"
    && decision.scorecardPublishAllowed === true
    && Array.isArray(manifest.modules)
    && manifest.modules.every((row) => row.ok === true && row.complete === true && row.fallback !== true);
  return {
    ok,
    status: ok ? "CANARY_READY" : "BLOCKED",
    scorecardPublishAllowed: ok,
    reason: ok ? "manifest_green_and_policy_allows_scorecard_publish" : (manifest.blocker || decision.reason || "manifest_or_policy_not_green"),
  };
}

function runIdClosureGate(manifest = {}, expectedDate = "") {
  const modules = Array.isArray(manifest.modules) ? manifest.modules : [];
  const rows = modules.map((row) => {
    const ids = row.runIds || {};
    const raw = [row.runId, ids.scanner, ids.supabase, ids.productionApi, ids.desktop, ids.mobile, ids.scorecard88]
      .filter((value) => value && !String(value).includes("membership-protected") && !String(value).includes("not-read"));
    const uniqueIds = unique(raw);
    const runDate = runIdDate(row.runId || uniqueIds[0] || "");
    const ok = row.ok === true && uniqueIds.length <= 1 && (!expectedDate || runDate === expectedDate);
    return {
      key: row.key,
      label: row.label || row.key,
      ok,
      runId: row.runId || uniqueIds[0] || "",
      runDate,
      uniqueRunIds: uniqueIds,
      expectedDate,
      issue: ok ? "" : (uniqueIds.length > 1 ? `runId_mismatch:${uniqueIds.join(",")}` : `runDate_mismatch:${runDate || "missing"}!=${expectedDate}`),
    };
  });
  const bad = rows.filter((row) => !row.ok);
  return {
    ok: bad.length === 0 && rows.length > 0,
    status: bad.length === 0 && rows.length > 0 ? "CLOSED" : "BLOCKED_RUNID_CLOSURE",
    modules: rows,
    blockers: bad.map((row) => `${row.key}:${row.issue}`),
  };
}

function autoRollForwardGate(orchestrator = {}, policy = {}) {
  const jobs = Array.isArray(orchestrator.jobQueue) ? orchestrator.jobQueue : [];
  const decision = policy.decision || {};
  if (jobs.length === 0) {
    return {
      ok: true,
      status: "IDLE_NO_RETRY_NEEDED",
      autoRecoveryAllowed: decision.autoRecoveryAllowed === true,
      jobs: [],
      nextAction: decision.action || "continue_autonomous_monitoring",
    };
  }
  const retryable = jobs.every((job) => job.retryable !== false && !String(job.state || "").includes("AUTH"));
  return {
    ok: retryable && decision.autoRecoveryAllowed === true,
    status: retryable ? "ROLL_FORWARD_QUEUE_ARMED" : "MANUAL_INTERVENTION_REQUIRED",
    autoRecoveryAllowed: decision.autoRecoveryAllowed === true,
    jobs: jobs.map((job) => ({ key: job.key, state: job.state, priority: job.priority, command: job.command, blocker: job.blocker })),
    nextAction: retryable ? "run_retry_queue_until_manifest_green" : "fix_non_retryable_blocker_first",
  };
}

function decide({ preflight, manifest, orchestrator, policy, canary, closure, rollForward }) {
  const decision = policy.decision || {};
  if (decision.opsState === "BLOCKED_AUTH") {
    return { state: "BLOCKED_AUTH", unattendedStatus: "NO", reason: decision.reason || "auth_blocker", action: "fix_service_token_or_membership_layer" };
  }
  if (decision.opsState === "BLOCKED_SOURCE") {
    return { state: "BLOCKED_SOURCE", unattendedStatus: "NO", reason: decision.reason || "water_root_not_ready", action: "wait_water_root_then_auto_retry" };
  }
  if (marketClosedPreviousGood(manifest, policy, preflight) && manifest.ok === true && closure.ok === true) {
    return { state: "MARKET_CLOSED_PRESERVE_PREVIOUS_GOOD", unattendedStatus: "YES", reason: "market_closed_previous_good", action: "preserve_last_good_and_resume_next_trading_day" };
  }
  if (manifest.ok === true && closure.ok === true && canary.ok === true && decision.unattendedStatus === "YES") {
    return { state: "UNATTENDED_YES", unattendedStatus: "YES", reason: "all_layers_green", action: "continue_autonomous_monitoring" };
  }
  if (rollForward.ok === true) {
    return { state: "AUTO_ROLL_FORWARD_ARMED", unattendedStatus: "NO", reason: decision.reason || manifest.blocker || "retry_queue_armed", action: rollForward.nextAction };
  }
  return { state: "DEGRADED_MANUAL_REVIEW", unattendedStatus: "NO", reason: decision.reason || manifest.blocker || "control_plane_not_green", action: "inspect_blocker_and_retry" };
}

function markdown(payload) {
  const lines = [];
  lines.push("# Terminal Control Plane");
  lines.push("");
  lines.push(`- checkedAt: ${payload.checkedAt}`);
  lines.push(`- tradeDate: ${payload.tradeDate}`);
  lines.push(`- state: ${payload.decision.state}`);
  lines.push(`- unattendedStatus: ${payload.decision.unattendedStatus}`);
  lines.push(`- action: ${payload.decision.action}`);
  lines.push(`- reason: ${payload.decision.reason}`);
  lines.push("");
  lines.push("## Layer Gates");
  lines.push("| layer | status | ok | reason |");
  lines.push("|---|---|---:|---|");
  lines.push(`| Predictive Preflight | ${payload.predictivePreflight.status} | ${payload.predictivePreflight.ok} | ${payload.predictivePreflight.reason || "--"} |`);
  lines.push(`| Water Root | ${payload.waterRoot.status || "--"} | ${payload.waterRoot.ok} | ${payload.waterRoot.reason || "--"} |`);
  lines.push(`| State Machine | ${payload.stateMachine.overallState || "--"} | ${payload.stateMachine.ok} | ${payload.stateMachine.blocker || "--"} |`);
  lines.push(`| Daily Manifest | ${payload.dailyManifest.status} | ${payload.dailyManifest.ok} | ${payload.dailyManifest.blocker || "--"} |`);
  lines.push(`| Canary Publish | ${payload.canaryPublish.status} | ${payload.canaryPublish.ok} | ${payload.canaryPublish.reason || "--"} |`);
  lines.push(`| RunId Closure | ${payload.runIdClosure.status} | ${payload.runIdClosure.ok} | ${payload.runIdClosure.blockers.join("<br>") || "--"} |`);
  lines.push(`| Auto Roll Forward | ${payload.autoRollForward.status} | ${payload.autoRollForward.ok} | ${payload.autoRollForward.nextAction || "--"} |`);
  lines.push(`| Autonomous Ops Policy | ${payload.autonomousOpsPolicy.opsState || "--"} | ${payload.autonomousOpsPolicy.ok} | ${payload.autonomousOpsPolicy.reason || "--"} |`);
  lines.push("");
  lines.push("## Module RunId Closure");
  lines.push("| module | ok | runId | runDate | issue |");
  lines.push("|---|---:|---|---:|---|");
  for (const row of payload.runIdClosure.modules) {
    lines.push(`| ${row.label} | ${row.ok} | ${row.runId || "--"} | ${row.runDate || "--"} | ${row.issue || "--"} |`);
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  await fs.promises.mkdir(OUT_DIR, { recursive: true });
  const preflight = await buildPreflight({});
  if (!EXPECTED_DATE) {
    EXPECTED_DATE = compactDate(preflight.marketCalendar?.displayTradeDate || preflight.displayTradeDate || preflight.scannerTargetDate || taipeiDateKey());
  }
  const commands = [];
  if (!FROM_EXISTING) {
    commands.push(runNode(["--use-system-ca", "scripts/write-daily-terminal-run-manifest.js", `--expected-date=${EXPECTED_DATE}`], "daily-terminal-run-manifest"));
    commands.push(runNode(["--use-system-ca", "scripts/write-terminal-orchestrator-state.js", "--from-existing", `--expected-date=${EXPECTED_DATE}`], "terminal-orchestrator-state"));
    commands.push(runNode(["--use-system-ca", "scripts/write-autonomous-ops-policy.js"], "autonomous-ops-policy"));
  }
  const manifest = readJson(path.join(ROOT, "outputs", "daily-terminal-run", "daily-terminal-run-latest.json"), {});
  const orchestrator = readJson(path.join(ROOT, "outputs", "terminal-orchestrator", "terminal-orchestrator-state.json"), {});
  const policy = readJson(path.join(ROOT, "outputs", "autonomous-ops-policy", "autonomous-ops-policy.json"), {});
  const waterRoot = readJson(path.join(ROOT, "outputs", "terminal-water-root", "terminal-water-root.json"), {});
  const canary = canaryPublishGate(manifest, policy);
  const closure = runIdClosureGate(manifest, EXPECTED_DATE);
  const rollForward = autoRollForwardGate(orchestrator, policy);
  const decision = decide({ preflight, manifest, orchestrator, policy, canary, closure, rollForward });
  const payload = {
    contract: "terminal-control-plane-v1",
    checkedAt: new Date().toISOString(),
    tradeDate: EXPECTED_DATE,
    commands,
    predictivePreflight: preflightGate(preflight, EXPECTED_DATE),
    waterRoot: {
      ok: waterRoot.ok === true || manifest.waterRoot?.ok === true,
      status: waterRoot.status || manifest.waterRoot?.status || "",
      reason: waterRoot.reason || manifest.waterRoot?.reason || "",
    },
    stateMachine: {
      ok: orchestrator.unattendedStatus === "YES" || orchestrator.overallState === "CLOSED",
      overallState: orchestrator.overallState || "",
      blocker: orchestrator.blocker || "",
      jobs: Array.isArray(orchestrator.jobQueue) ? orchestrator.jobQueue.length : 0,
    },
    dailyManifest: {
      ok: manifest.ok === true,
      status: manifest.ok === true ? "GREEN" : "BLOCKED",
      unattendedStatus: manifest.unattendedStatus || "",
      blocker: manifest.blocker || "",
      modules: Array.isArray(manifest.modules) ? manifest.modules.length : 0,
    },
    canaryPublish: canary,
    runIdClosure: closure,
    autoRollForward: rollForward,
    autonomousOpsPolicy: {
      ok: policy.decision?.unattendedStatus === "YES" || policy.decision?.autoRecoveryAllowed === true,
      opsState: policy.decision?.opsState || "",
      unattendedStatus: policy.decision?.unattendedStatus || "",
      reason: policy.decision?.reason || "",
      action: policy.decision?.action || "",
      actionMatrix: policy.actionMatrix || null,
    },
    decision,
  };
  const jsonFile = path.join(OUT_DIR, "terminal-control-plane.json");
  const mdFile = path.join(OUT_DIR, "terminal-control-plane.md");
  await fs.promises.writeFile(jsonFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.promises.writeFile(mdFile, markdown(payload), "utf8");
  console.log(JSON.stringify({
    ok: decision.unattendedStatus === "YES" || rollForward.ok === true,
    state: decision.state,
    unattendedStatus: decision.unattendedStatus,
    tradeDate: EXPECTED_DATE,
    action: decision.action,
    reason: decision.reason,
    output: jsonFile,
  }, null, 2));
  if (REQUIRE_UNATTENDED && decision.unattendedStatus !== "YES") process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[terminal-control-plane] failed: ${error.stack || error.message || error}`);
  process.exit(1);
});