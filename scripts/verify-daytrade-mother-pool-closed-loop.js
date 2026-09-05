"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { isTwseTradingDay } = require("./twse-trading-day");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const WRITE_RECEIPT = process.argv.includes("--write-receipt");
const STATIC_ONLY = process.argv.includes("--static-only");
const SKELETON_CONTRACT = "daytrade_mother_pool_skeleton_v1";
const SKELETON_BASELINE = "public-terminal-fast-20260714-22";
const SKELETON_BASELINE_COMMIT = "4d6ba88c19c5924093fcbe8afb0566df3c80a921";

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

function verifySkeletonStatic() {
  const issues = [];
  const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8").replace(/\r\n/g, "\n");
  const includes = (file, marker) => { if (!read(file).includes(marker)) issues.push(`${file}: missing ${marker}`); };
  const excludes = (file, marker) => { if (read(file).includes(marker)) issues.push(`${file}: forbidden ${marker}`); };
  const contract = JSON.parse(read("data/contracts/daytrade_mother_pool_skeleton_v1.json"));
  const version = JSON.parse(read("version.json"));
  if (contract.contract !== SKELETON_CONTRACT) issues.push(`contract mismatch ${contract.contract}`);
  if (contract.baseline !== SKELETON_BASELINE) issues.push(`baseline mismatch ${contract.baseline}`);
  if (contract.baselineCommit !== SKELETON_BASELINE_COMMIT) issues.push(`baselineCommit mismatch ${contract.baselineCommit}`);
  if (contract.rules?.oldSupabaseMarketSnapshotsFallbackDisabled !== true) issues.push("old Supabase market_snapshots fallback rule is not hard-enabled");
  if (contract.rules?.top40IsNotLimitGateOrOnlyEntry !== true) issues.push("TOP40 compatibility rule missing");
  if (contract.rules?.dataGapMustNotDisplayAsNoSignal !== true) issues.push("DATA_GAP display guard missing");
  if (contract.rules?.motherPoolTargetMinimumSymbols !== 300) issues.push("Mother Pool target must be 300");
  if (contract.rules?.motherPoolMinimumCountIsHardGate !== false) issues.push("Mother Pool 300 target must not be a hard gate");
  if (contract.rules?.motherPoolMinimumRequiredSymbols !== 1) issues.push("Mother Pool actual minimum must be 1");
  if (version.formalSkeletonContract !== SKELETON_CONTRACT) issues.push("version.json formalSkeletonContract mismatch");
  if (version.formalSkeletonBaseline !== SKELETON_BASELINE) issues.push("version.json formalSkeletonBaseline mismatch");
  includes("terminal-core.js", `const formalSkeletonContract = "${SKELETON_CONTRACT}"`);
  includes("terminal-core.js", `const formalSkeletonBaseline = "${SKELETON_BASELINE}"`);
  includes("terminal-core.js", "window.FUMAN_FORMAL_SKELETON_CONTRACT");
  includes("terminal-core.js", "window.FUMAN_FORMAL_SKELETON_BASELINE");
  includes("api/market-ai-live.js", "old_supabase_market_snapshots_fallback_disabled_by_daytrade_mother_pool_skeleton_v1");
  excludes("api/market-ai-live.js", "allowLatestFallback: !requireTodayLiveSource && (fastCachedPayload || !isMarketAiPostClose(clock))");
  excludes("api/market-ai-live.js", "function snapshotResponsePayload");
  excludes("api/market-ai-live.js", "readSnapshot(\"market_ai_live\"");
  for (const marker of ["cb_bridge_as_formal_source", "warrant_bridge_as_formal_source", "previous_good_as_today", "DATA_GAP_NO_SIGNAL"]) {
    for (const file of ["api/market-ai-live.js", "api/strategy2-latest.js", "api/strategy3-latest.js", "api/institution-latest.js"]) {
      if (fs.existsSync(path.join(ROOT, file))) excludes(file, marker);
    }
  }
  for (const reference of findRetiredMotherPoolVerifierReferences()) issues.push(`retired Mother Pool verifier reference: ${reference}`);
  for (const retired of ["verify-daytrade-mother-pool-contract.js", "verify-daytrade-mother-pool-skeleton.js"]) {
    if (fs.existsSync(path.join(ROOT, "scripts", retired))) issues.push(`retired Mother Pool verifier still exists: scripts/${retired}`);
  }
  return { ok: issues.length === 0, contract: SKELETON_CONTRACT, baseline: SKELETON_BASELINE, issues };
}

function findRetiredMotherPoolVerifierReferences() {
  const retired = ["verify-daytrade-mother-pool-contract.js", "verify-daytrade-mother-pool-skeleton.js"];
  const references = [];
  const visit = (relative) => {
    const absolute = path.join(ROOT, relative);
    if (!fs.existsSync(absolute)) return;
    const stat = fs.statSync(absolute);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(absolute)) visit(path.join(relative, name));
      return;
    }
    const normalized = relative.replace(/\\/g, "/");
    if (normalized === "scripts/verify-daytrade-mother-pool-closed-loop.js" || normalized.endsWith(".bak")) return;
    const text = fs.readFileSync(absolute, "utf8");
    for (const name of retired) if (text.includes(name)) references.push(`${normalized}:${name}`);
  };
  for (const root of ["package.json", "scripts", "docs", "ops", "lib"]) visit(root);
  return references;
}

function identityOf(value) {
  return {
    tradeDate: String(value?.tradeDate || value?.trade_date || value?.date || ""),
    canonicalRunId: String(value?.canonicalRunId || value?.canonical_run_id || value?.run_id || ""),
  };
}

async function main() {
  const clock = taipeiClock();
  const tradingDay = await isTwseTradingDay(new Date(`${clock.tradeDate}T04:00:00.000Z`), { stateDir: path.join(RUNTIME, "state") });
  if (!tradingDay.isTradingDay) {
    const result = {
      ok: true,
      closed_loop_ok: false,
      status: "skipped",
      complete: false,
      contract: "daytrade_mother_pool_closed_loop_v1",
      trade_date: clock.tradeDate,
      checked_at: new Date().toISOString(),
      market_open: false,
      formal_scan_skipped: true,
      preserve_previous_good: true,
      latest_pointer_updated: false,
      reason_code: "market_calendar_non_trading_day",
      closed_reason: tradingDay.reason || "market_closed",
      allowed_action: "skip_formal_scan_preserve_previous_good",
      failed_checks: [],
      warnings: [],
      first_blocker: null,
      formal_candidate_allowed_by_observation_sources: false,
      publish_allowed_by_observation_sources: false,
      read_only: !WRITE_RECEIPT,
    };
    if (WRITE_RECEIPT) {
      const receipt = path.join(RUNTIME, "data", "scan-receipts", `daytrade-mother-pool-closed-loop-market-closed-${clock.compact}.json`);
      fs.mkdirSync(path.dirname(receipt), { recursive: true });
      fs.writeFileSync(receipt, JSON.stringify({ ...result, receipt_path: receipt }, null, 2) + "\n", "utf8");
      result.receipt_path = receipt;
    }
    console.log(JSON.stringify(result, null, 2));
    return;
  }
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
  check("priority_pool_nonempty_without_40_minimum", Array.isArray(priority?.daytradePrioritySymbols) && priority.daytradePrioritySymbols.length > 0, "priority_pool_empty");

  const motherRows = Array.isArray(motherPool?.rows) ? motherPool.rows : [];
  const priceBySymbol = priority?.daytradePoolPriceBySymbol && typeof priority.daytradePoolPriceBySymbol === "object"
    ? priority.daytradePoolPriceBySymbol : {};
  const motherPrices = motherRows.map((row) => Number(row?.price ?? priceBySymbol[String(row?.symbol || "")])).filter(Number.isFinite);
  const avg3PassRows = motherRows.filter((row) => row?.avg3_volume_gate_status === "pass");
  const avg3PendingRows = motherRows.filter((row) => row?.avg3_volume_gate_status === "history_pending");
  const avg3ReceiptRowsValid = motherRows.every((row) => {
    const status = String(row?.avg3_volume_gate_status || "");
    const volume = Number(row?.avg3_volume);
    const sampleDays = Number(row?.avg3_volume_sample_days);
    if (status === "pass") return Number.isFinite(volume) && volume >= 3000 && sampleDays >= 3;
    if (status === "history_pending") return sampleDays < 3;
    if (status === "below_3000_lots") return Number.isFinite(volume) && volume >= 0 && volume < 3000 && sampleDays >= 3;
    return false;
  });
  check("mother_pool_readable", Boolean(motherPool), "mother_pool_receipt_missing");
  check("mother_pool_same_day", motherIdentity.tradeDate === clock.tradeDate, "mother_pool_trade_date_mismatch");
  check("mother_pool_canonical", motherIdentity.canonicalRunId === canonicalRunId, "mother_pool_canonical_run_mismatch");
  check("mother_pool_fresh", ageSeconds(motherPool?.updated_at) <= 300, "mother_pool_receipt_stale");
  check("mother_pool_dynamic_size", motherRows.length > 0 && motherRows.length <= 800, `mother_pool_dynamic_size_out_of_range:${motherRows.length}`);
  check("mother_pool_runner_receipt_contract", motherPool?.contract === "daytrade-mother-pool-runner-receipt-v2", "mother_pool_runner_receipt_contract_invalid");
  check("mother_pool_300_is_target", Number(motherPool?.mother_pool_target_min_symbols) === 300, "mother_pool_target_min_symbols_invalid");
  check("mother_pool_300_not_hard_gate", motherPool?.mother_pool_minimum_count_is_hard_gate === false, "mother_pool_minimum_count_hard_gate_must_be_false");
  check("mother_pool_minimum_required_is_one", Number(motherPool?.minimum_required_mother_pool_symbols) === 1, "mother_pool_minimum_required_symbols_invalid");
  check("mother_pool_price_readback_complete", motherRows.length > 0 && motherPrices.length === motherRows.length, "mother_pool_price_readback_incomplete");
  check("mother_pool_price_floor", motherPrices.length === motherRows.length && motherPrices.every((price) => price >= 50), "mother_pool_contains_price_below_50");
  check("mother_pool_avg3_receipt_fields_valid", avg3ReceiptRowsValid, "mother_pool_avg3_receipt_fields_invalid");
  check("mother_pool_avg3_receipt_not_all_pending", avg3PassRows.length > 0 && avg3PendingRows.length < motherRows.length, "mother_pool_avg3_receipt_all_history_pending");

  const staticChecks = {
    skeleton: verifySkeletonStatic(),
    dailyIdentity: runStatic("scripts/verify-daytrade-priority-daily-rollover-contract.js"),
    futoptLockRetry: runStatic("scripts/verify-daytrade-futopt-lock-retry-contract.js"),
    legacyVerifierRetired: {
      ok: !fs.existsSync(path.join(ROOT, "scripts", "verify-daytrade-mother-pool-contract.js"))
        && !fs.existsSync(path.join(ROOT, "scripts", "verify-daytrade-mother-pool-skeleton.js"))
        && findRetiredMotherPoolVerifierReferences().length === 0,
      retired_paths: ["scripts/verify-daytrade-mother-pool-contract.js", "scripts/verify-daytrade-mother-pool-skeleton.js"],
      stale_references: findRetiredMotherPoolVerifierReferences(),
      replacement: "scripts/verify-daytrade-mother-pool-closed-loop.js",
    },
  };
  check("static_skeleton_contract", staticChecks.skeleton.ok, "static_skeleton_contract_failed");
  check("static_daily_identity_contract", staticChecks.dailyIdentity.ok, "static_daily_identity_contract_failed");
  check("static_futopt_lock_retry_contract", staticChecks.futoptLockRetry.ok, "static_futopt_lock_retry_contract_failed");
  check("legacy_mother_pool_verifier_retired", staticChecks.legacyVerifierRetired.ok, "legacy_mother_pool_verifier_still_present");

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
      mother_pool: {
        ok: checks.mother_pool_dynamic_size && checks.mother_pool_fresh && checks.mother_pool_300_not_hard_gate,
        path: paths.motherPool,
        rows: motherRows.length,
        target_min_symbols: Number(motherPool?.mother_pool_target_min_symbols),
        minimum_count_is_hard_gate: motherPool?.mother_pool_minimum_count_is_hard_gate,
        target_shortfall: Number(motherPool?.mother_pool_target_shortfall),
        minimum_required_symbols: Number(motherPool?.minimum_required_mother_pool_symbols),
        avg3_pass_rows: avg3PassRows.length,
        avg3_history_pending_rows: avg3PendingRows.length,
      },
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

if (STATIC_ONLY) {
  const result = verifySkeletonStatic();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} else {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, contract: "daytrade_mother_pool_closed_loop_v1", error: error?.message || String(error) }, null, 2));
    process.exitCode = 1;
  });
}
