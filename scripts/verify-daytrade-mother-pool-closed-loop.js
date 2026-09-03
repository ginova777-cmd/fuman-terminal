"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const WRITE_RECEIPT = process.argv.includes("--write-receipt");

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function taipeiClock(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now).map((part) => [part.type, part.value]));
  return {
    tradeDate: `${parts.year}-${parts.month}-${parts.day}`,
    compact: `${parts.year}${parts.month}${parts.day}`,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function ageSeconds(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? Math.max(0, Math.floor((Date.now() - parsed) / 1000)) : 999999;
}

function runStatic(relativePath) {
  const result = spawnSync(process.execPath, [path.join(ROOT, relativePath)], {
    cwd: ROOT, encoding: "utf8", windowsHide: true,
  });
  return {
    ok: result.status === 0,
    exit_code: result.status,
    output: String(result.stdout || result.stderr || "").trim().slice(0, 1200),
  };
}

function productionSha() {
  const result = spawnSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true });
  return result.status === 0 ? String(result.stdout || "").trim() : "";
}

function identityOf(value) {
  return {
    tradeDate: String(value?.tradeDate || value?.trade_date || value?.date || ""),
    canonicalRunId: String(value?.canonicalRunId || value?.canonical_run_id || value?.run_id || ""),
  };
}

function main() {
  const clock = taipeiClock();
  const canonicalRunId = `fugle_daytrade_source:${clock.compact}:canonical`;
  const paths = {
    websocket: path.join(RUNTIME, "state", "fugle-daytrade-websocket-status-v2.json"),
    priority: path.join(RUNTIME, "cache", "intraday", "fugle-daytrade-ws-priority-symbols.json"),
    motherPool: path.join(RUNTIME, "state", "daytrade-mother-pool-delta.json"),
    openingReport: path.join(RUNTIME, "data", "scan-receipts", "opening-report-0830-priority-bias-bridge-latest.json"),
    futopt0845: path.join(RUNTIME, "data", "scan-receipts", `daytrade-futopt-preopen-evidence-0845-${clock.compact}.json`),
    futopt0850: path.join(RUNTIME, "data", "scan-receipts", `daytrade-futopt-preopen-evidence-0850-${clock.compact}.json`),
  };
  const websocket = readJson(paths.websocket);
  const priority = readJson(paths.priority);
  const motherPool = readJson(paths.motherPool);
  const openingReport = readJson(paths.openingReport);
  const futopt0845 = readJson(paths.futopt0845);
  const futopt0850 = readJson(paths.futopt0850);
  const failures = [];
  const warnings = [];
  const checks = {};
  const check = (name, ok, blocker = name) => {
    checks[name] = Boolean(ok);
    if (!ok) failures.push(blocker);
  };

  const websocketIdentity = identityOf(websocket);
  const priorityIdentity = identityOf(priority);
  const motherIdentity = identityOf(motherPool);
  check("websocket_readable", Boolean(websocket), "websocket_status_missing");
  check("websocket_same_day", websocketIdentity.tradeDate === clock.tradeDate, "websocket_trade_date_mismatch");
  check("websocket_canonical", websocketIdentity.canonicalRunId === canonicalRunId, "websocket_canonical_run_mismatch");
  check("websocket_healthy", websocket?.ok === true && websocket?.websocketConnected === true && websocket?.websocketAuthenticated === true, "websocket_not_healthy");
  check("websocket_fresh", ageSeconds(websocket?.updatedAt) <= 180, "websocket_status_stale");

  check("priority_readable", Boolean(priority), "priority_manifest_missing");
  check("priority_same_day", priorityIdentity.tradeDate === clock.tradeDate, "priority_trade_date_mismatch");
  check("priority_canonical", priorityIdentity.canonicalRunId === canonicalRunId, "priority_canonical_run_mismatch");
  check("priority_fresh", ageSeconds(priority?.updatedAt) <= 300, "priority_manifest_stale");
  check("priority_not_hard_limited_to_40", Array.isArray(priority?.daytradePrioritySymbols) && priority.daytradePrioritySymbols.length > 40, "priority_pool_hard_limited_to_40");

  const motherRows = Array.isArray(motherPool?.rows) ? motherPool.rows : [];
  const priceBySymbol = priority?.daytradePoolPriceBySymbol && typeof priority.daytradePoolPriceBySymbol === "object"
    ? priority.daytradePoolPriceBySymbol : {};
  const motherPrices = motherRows.map((row) => Number(row?.price ?? priceBySymbol[String(row?.symbol || "")])).filter(Number.isFinite);
  check("mother_pool_readable", Boolean(motherPool), "mother_pool_receipt_missing");
  check("mother_pool_same_day", motherIdentity.tradeDate === clock.tradeDate, "mother_pool_trade_date_mismatch");
  check("mother_pool_canonical", motherIdentity.canonicalRunId === canonicalRunId, "mother_pool_canonical_run_mismatch");
  check("mother_pool_fresh", ageSeconds(motherPool?.updated_at) <= 300, "mother_pool_receipt_stale");
  check("mother_pool_dynamic_size", motherRows.length >= 300 && motherRows.length <= 800, `mother_pool_dynamic_size_out_of_range:${motherRows.length}`);
  check("mother_pool_price_readback_complete", motherRows.length > 0 && motherPrices.length === motherRows.length, "mother_pool_price_readback_incomplete");
  check("mother_pool_price_floor", motherPrices.length === motherRows.length && motherPrices.every((price) => price >= 50), "mother_pool_contains_price_below_50");

  const staticChecks = {
    skeleton: runStatic("scripts/verify-daytrade-mother-pool-skeleton.js"),
    dailyIdentity: runStatic("scripts/verify-daytrade-priority-daily-rollover-contract.js"),
    futoptLockRetry: runStatic("scripts/verify-daytrade-futopt-lock-retry-contract.js"),
  };
  check("static_skeleton_contract", staticChecks.skeleton.ok, "static_skeleton_contract_failed");
  check("static_daily_identity_contract", staticChecks.dailyIdentity.ok, "static_daily_identity_contract_failed");
  check("static_futopt_lock_retry_contract", staticChecks.futoptLockRetry.ok, "static_futopt_lock_retry_contract_failed");

  const openingRequired = clock.minute >= 8 * 60 + 36;
  const openingOk = !openingRequired || (
    identityOf(openingReport).tradeDate === clock.tradeDate
    && openingReport?.status === "BRIDGE_OK"
    && Number(openingReport?.bridge_handoff_industry_count) === 3
    && openingReport?.forbidden_publish_guard === true
    && Number(openingReport?.formal_candidate_count) === 0
    && openingReport?.formal_candidate_allowed === false
  );
  check("opening_report_bridge_closed", openingOk, "opening_report_bridge_not_closed");

  const futoptRequired = clock.minute >= 8 * 60 + 50;
  const futoptGuardsSafe = [futopt0845, futopt0850].every((receipt) => !receipt || (
    receipt.formal_candidate_count === 0
    && receipt.formal_candidate_allowed === false
    && receipt.publish_allowed === false
  ));
  check("futopt_formal_guards_safe", futoptGuardsSafe, "futopt_formal_guard_invalid");
  const futoptClosed = !futoptRequired || [futopt0845, futopt0850].every((receipt, index) => (
    receipt?.ok === true
    && receipt?.trade_date === clock.tradeDate
    && receipt?.natural_schedule_evidence === true
    && String(receipt?.capture_slot) === (index === 0 ? "0845" : "0850")
  ));
  if (!futoptClosed) warnings.push("futopt_preopen_evidence_fail_closed_rank_without_futopt_weight");

  const result = {
    ok: failures.length === 0,
    closed_loop_ok: failures.length === 0,
    contract: "daytrade_mother_pool_closed_loop_v1",
    trade_date: clock.tradeDate,
    canonical_run_id: canonicalRunId,
    checked_at: new Date().toISOString(),
    production_sha: process.env.FUMAN_PRODUCTION_SHA || productionSha(),
    runner_ok: true,
    receipt_written: WRITE_RECEIPT,
    verifier_ok: failures.length === 0,
    same_trade_date: checks.websocket_same_day && checks.priority_same_day && checks.mother_pool_same_day,
    canonical_run_closed: checks.websocket_canonical && checks.priority_canonical && checks.mother_pool_canonical,
    components: {
      websocket: { ok: checks.websocket_healthy && checks.websocket_fresh, path: paths.websocket, age_seconds: ageSeconds(websocket?.updatedAt) },
      mother_pool: { ok: checks.mother_pool_dynamic_size && checks.mother_pool_fresh, path: paths.motherPool, rows: motherRows.length },
      opening_report: { ok: openingOk, required: openingRequired, path: paths.openingReport },
      futopt_preopen: { ok: futoptClosed, required: futoptRequired, fail_closed_isolated: !futoptClosed, allowed_action: futoptClosed ? "apply_futopt_observation_weight" : "rank_without_futopt_trial_weight", paths: [paths.futopt0845, paths.futopt0850] },
    },
    checks,
    static_checks: staticChecks,
    failed_checks: failures,
    warnings,
    first_blocker: failures[0] || null,
    formal_candidate_allowed_by_observation_sources: false,
    publish_allowed_by_observation_sources: false,
    read_only: !WRITE_RECEIPT,
  };

  if (WRITE_RECEIPT) {
    const receipt = path.join(RUNTIME, "data", "scan-receipts", `daytrade-mother-pool-closed-loop-${clock.compact}.json`);
    fs.mkdirSync(path.dirname(receipt), { recursive: true });
    fs.writeFileSync(receipt, JSON.stringify({ ...result, receipt_path: receipt }, null, 2) + "\n", "utf8");
    result.receipt_path = receipt;
  }
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

main();
