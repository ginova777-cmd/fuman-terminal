"use strict";
const fs = require("fs");
const path = require("path");
const c = require("./strategy3-v2-contract");
const runtime = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const date = c.taipeiDate();
const compact = date.replace(/\D/g, "");
const receipts = path.join(runtime, "data", "scan-receipts");
const recoveryReplay = process.argv.includes("--recovery-replay");
let target = path.join(receipts, recoveryReplay ? "strategy3-recovery-replay.json" : "strategy3.json");
const read = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); } catch { return null; } };
const scan = read(path.join(receipts, recoveryReplay ? `strategy3-v2-recovery-replay-${compact}.json` : `strategy3-v2-complete-scan-${compact}.json`));
const daily = read(path.join(receipts, `strategy3-v2-daily-unattended-closure-${compact}.json`));
const water = read(path.join(receipts, `strategy3-v2-water-universe-${compact}${recoveryReplay ? "-recovery-replay" : ""}.json`));
const tri = read(path.join(receipts, "tri-surface-closures", "strategy3.json"));
const recoverySurface = read(path.join(receipts, `strategy3-v2-three-surface-recovery-replay-${compact}.json`));
const surface = daily?.surface || null;
const line = read(path.join(runtime, "data", "line-cards", `strategy3-v2-line-card-${compact}${recoveryReplay ? ".recovery-replay" : ""}.json`));
const recordFailure = process.argv.includes("--record-failure");
const requestedAwaitingScorecard = process.argv.includes("--awaiting-scorecard");
const baseComplete = scan?.ok === true && scan?.status === "COMPLETE" && scan?.apply === true
  && water?.ok === true && water?.status === "STRATEGY3_V2_WATER_UNIVERSE_READY"
  && surface?.ok === true && line?.ok === true && line?.status === "PUSHED"
  && daily?.ok === true && daily?.status === "STRATEGY3_V2_DAILY_UNATTENDED_YES"
  && scan.run_id === water.run_id && scan.run_id === surface?.canonical_api?.runId && scan.run_id === line.run_id && scan.run_id === daily.run_id;
const triComplete = tri?.complete === true && tri?.status === "complete" && tri?.runId === scan?.run_id
  && tri?.desktopRunId === scan?.run_id && tri?.mobileRunId === scan?.run_id && tri?.scorecardRunId === scan?.run_id
  && String(tri?.expectedDate || "").replace(/\D/g, "") === compact;
const recoveryRunId = recoverySurface?.summary?.tabs?.strategy3?.api?.runId || null;
const recoverySurfaceComplete = recoverySurface?.ok === true
  && recoveryRunId === scan?.run_id
  && recoverySurface?.summary?.tabs?.strategy3?.terminal?.runId === scan?.run_id
  && recoverySurface?.summary?.tabs?.strategy3?.mobileFragment?.runId === scan?.run_id;
const recoveryComplete = scan?.ok === true && scan?.status === "RECOVERY_REPLAY_COMPLETE" && scan?.apply === true
  && water?.ok === true && water?.verifier_ok === true && water?.run_id === scan?.run_id
  && water?.recovery_replay === true && recoverySurfaceComplete
  && line?.ok === true && line?.status === "RECOVERY_REPLAY_PUSHED" && line?.run_id === scan?.run_id
  && line?.line_push_personal_ok === true && line?.line_push_group_ok === true;
const { verifyDelivery } = require("../lib/strategy3-delivery-evidence");
const delivery = verifyDelivery({ scan, tri, line, date,
  ui: read(path.join(runtime, "data", "strategy3-ui", "terminal-ui-e2e-report.json")),
  collection: read(path.join(receipts, "scorecard88-collection-" + compact + "-1315.json")),
  current: read(path.join(runtime, "data", "scorecard-terminal-current.json")) });
const deliveryVerifier = read(path.join(receipts, "strategy3-delivery-verifier-" + compact + (recoveryReplay ? "-recovery" : "") + ".json"));
if (deliveryVerifier?.ok !== true || deliveryVerifier?.runId !== scan?.run_id || deliveryVerifier?.tradeDate !== date) {
  delivery.ok = false; delivery.issues.push("delivery_verifier_missing_or_mismatched");
  delivery.firstBlocker ||= "delivery_verifier_missing_or_mismatched";
}
const failureReason = process.argv.find(x => x.startsWith("--failure-reason="))?.slice(17) || "";
const complete = !recordFailure && delivery.ok && (recoveryReplay ? recoveryComplete : (baseComplete && triComplete));
const awaitingScorecard = !recordFailure && requestedAwaitingScorecard && baseComplete && !triComplete;
const status = complete ? "complete" : awaitingScorecard ? "awaiting_scorecard_1315" : "failed";
const blockingReason = complete ? "" : failureReason || delivery.firstBlocker || (recoveryReplay ? "strategy3_recovery_replay_closure_not_complete" : awaitingScorecard ? "scorecard_collection_pending_1315" : !baseComplete ? "strategy3_base_closure_not_complete" : "strategy3_tri_surface_scorecard_not_complete");
const payload = { contract: "strategy-runner-verifier-receipt-v1", strategy: "strategy3", tradeDate: date,
  checkedAt: new Date().toISOString(), status, complete, exitCode: complete || awaitingScorecard ? 0 : 1,
  blockingReason, fallback: false, recoveryReplay, completionKind: recoveryReplay ? "recovery_replay" : "natural_slot", naturalSlotComplete: !recoveryReplay && complete, warnings: [], triSurfaceStatus: triComplete && delivery.ok ? "complete" : "pending", failed_checks: delivery.issues, first_blocker: blockingReason || null,
  desktopRunId: tri?.desktopRunId || null, mobileRunId: tri?.mobileRunId || null, scorecardRunId: tri?.scorecardRunId || null,
  runId: scan?.run_id || null, count: Number(scan?.result_count || 0), matches: Number(scan?.result_count || 0), resultCount: Number(scan?.result_count || 0),
  scannedCount: Number(scan?.scanner_summary?.ready_20_candle_symbols || 0), expectedTotal: Number(scan?.scanner_summary?.formal_ready_target || 0), runner: "run-strategy3-v2-complete-scan.ps1",
  consumerName: "strategy3_v2", sourceContractVersion: scan?.source_contract_version || "4.1.0", canonicalRunId: scan?.canonical_run_id || null,
  motherPoolRows: Number(scan?.mother_pool_rows || 0), motherPoolPages: Number(scan?.mother_pool_pages || 0), uniqueSymbols: Number(scan?.unique_symbols || 0),
  quoteValidRows: Number(scan?.quote_valid_rows || 0), intraday1mValidRows: Number(scan?.intraday_1m_valid_rows || 0), symbolDataGapRows: Number(scan?.symbol_data_gap_rows || 0),
  globalFormalGateBlocked: scan?.global_formal_gate_blocked === true, receiptIncomplete: scan?.receipt_incomplete === true,
  runnerStatus: scan?.runner_status || scan?.status || null, verifierOk: water?.verifier_ok === true && delivery.ok, receiptWritten: true,
  verifier: "verify-strategy3-delivery.js", verifiers: ["verify-strategy3-v2-water-universe.js", "verify-strategy3-v2-surface-closure.js", "verify-strategy3-v2-daily-unattended-closure.js", "verify-strategy3-delivery.js"], evidence: {
    scan: scan ? { ok: scan.ok, status: scan.status, apply: scan.apply, runId: scan.run_id, count: scan.result_count } : null,
    water: water ? { ok: water.ok, status: water.status, runId: water.run_id, canonicalRunId: water.canonical_run_id, source: water?.sources?.motherPool, motherPoolRows: water.mother_pool_rows, quoteValidRows: water.quote_valid_rows, intraday1mValidRows: water.intraday_1m_valid_rows, symbolDataGapRows: water.symbol_data_gap_rows, verifierOk: water.verifier_ok, firstBlocker: water.first_blocker } : null,
    triSurface: recoveryReplay ? (recoverySurface ? { ok: recoverySurface.ok, runId: recoveryRunId, terminalRunId: recoverySurface?.summary?.tabs?.strategy3?.terminal?.runId, mobileRunId: recoverySurface?.summary?.tabs?.strategy3?.mobileFragment?.runId, issues: recoverySurface.issues } : null) : (tri ? { complete: tri.complete, status: tri.status, runId: tri.runId, desktopRunId: tri.desktopRunId, mobileRunId: tri.mobileRunId, scorecardRunId: tri.scorecardRunId, expectedDate: tri.expectedDate, reason: tri.reason } : null),
    surface: recoveryReplay ? { ok: recoverySurface?.ok === true, runId: recoveryRunId } : surface ? { ok: surface.ok, status: surface.status, runId: surface?.canonical_api?.runId } : null,
    line: line ? { ok: line.ok, status: line.status, personal: line.line_push_personal_ok, group: line.line_push_group_ok, runId: line.run_id } : null,
    daily: !recoveryReplay && daily ? { ok: daily.ok, status: daily.status, firstBlocker: daily.first_blocker, runId: daily.run_id } : null } };
if (!process.argv.includes("--status-only")) {
  fs.mkdirSync(receipts, { recursive: true });
  const prior = read(target);
  if (!complete && prior?.complete === true) target = path.join(receipts, "strategy3-" + (recoveryReplay ? "recovery-" : "") + "blocked-attempt-" + Date.now() + ".json");
  const temporary = target + "." + process.pid + ".tmp";
  fs.writeFileSync(temporary, JSON.stringify(payload, null, 2), "utf8");
  fs.renameSync(temporary, target);
  const persisted = read(target);
  if (persisted?.runId !== payload.runId || persisted?.complete !== payload.complete) throw new Error("strategy3_receipt_readback_mismatch");
}
// Status re-evaluates today's evidence; an old complete file is not today's proof.
const output = payload;
console.log(JSON.stringify({ ...output, receiptPath: target }, null, 2));
process.exitCode = output?.complete === true || output?.status === "awaiting_scorecard_1315" ? 0 : 1;
