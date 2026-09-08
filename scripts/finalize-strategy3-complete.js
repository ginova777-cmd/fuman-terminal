"use strict";
const fs = require("fs");
const path = require("path");
const c = require("./strategy3-v2-contract");
const runtime = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const date = c.taipeiDate();
const compact = date.replace(/\D/g, "");
const receipts = path.join(runtime, "data", "scan-receipts");
const target = path.join(receipts, "strategy3.json");
const read = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };
const scan = read(path.join(receipts, `strategy3-v2-complete-scan-${compact}.json`));
const daily = read(path.join(receipts, `strategy3-v2-daily-unattended-closure-${compact}.json`));
const water = read(path.join(receipts, `strategy3-v2-water-universe-${compact}.json`));
const tri = read(path.join(receipts, "tri-surface-closures", "strategy3.json"));
const surface = daily?.surface || null;
const line = read(path.join(runtime, "data", "line-cards", `strategy3-v2-line-card-${compact}.json`));
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
const complete = !recordFailure && baseComplete && triComplete;
const awaitingScorecard = !recordFailure && requestedAwaitingScorecard && baseComplete && !triComplete;
const status = complete ? "complete" : awaitingScorecard ? "awaiting_scorecard_1315" : "failed";
const blockingReason = complete ? "" : awaitingScorecard ? "scorecard_collection_pending_1315" : !baseComplete ? "strategy3_base_closure_not_complete" : "strategy3_tri_surface_scorecard_not_complete";
const payload = { contract: "strategy-runner-verifier-receipt-v1", strategy: "strategy3", tradeDate: date,
  checkedAt: new Date().toISOString(), status, complete, exitCode: complete || awaitingScorecard ? 0 : 1,
  blockingReason, fallback: false, warnings: [], triSurfaceStatus: triComplete ? "complete" : "pending",
  desktopRunId: tri?.desktopRunId || null, mobileRunId: tri?.mobileRunId || null, scorecardRunId: tri?.scorecardRunId || null,
  runId: scan?.run_id || null, count: Number(scan?.result_count || 0), matches: Number(scan?.result_count || 0), resultCount: Number(scan?.result_count || 0),
  scannedCount: Number(scan?.scanner_summary?.local_ready_20_candle_symbols || 0), expectedTotal: Number(scan?.scanner_summary?.formal_ready_target || 0), runner: "run-strategy3-v2-complete-scan.ps1",
  verifier: "verify-strategy3-v2-daily-unattended-closure.js", verifiers: ["verify-strategy3-v2-water-universe.js", "verify-strategy3-v2-surface-closure.js", "verify-strategy3-v2-daily-unattended-closure.js"], evidence: {
    scan: scan ? { ok: scan.ok, status: scan.status, apply: scan.apply, runId: scan.run_id, count: scan.result_count } : null,
    water: water ? { ok: water.ok, status: water.status, runId: water.run_id, policy: water?.readback?.cachePolicy, formalCandidateAllowed: water?.readback?.formalCandidateAllowed, publishAllowed: water?.readback?.publishAllowed, firstBlocker: water.first_blocker } : null,
    triSurface: tri ? { complete: tri.complete, status: tri.status, runId: tri.runId, desktopRunId: tri.desktopRunId, mobileRunId: tri.mobileRunId, scorecardRunId: tri.scorecardRunId, expectedDate: tri.expectedDate, reason: tri.reason } : null,
    surface: surface ? { ok: surface.ok, status: surface.status, runId: surface?.canonical_api?.runId } : null,
    line: line ? { ok: line.ok, status: line.status, personal: line.line_push_personal_ok, group: line.line_push_group_ok, runId: line.run_id } : null,
    daily: daily ? { ok: daily.ok, status: daily.status, firstBlocker: daily.first_blocker, runId: daily.run_id } : null } };
if (!process.argv.includes("--status-only") || !fs.existsSync(target)) { fs.mkdirSync(receipts, { recursive: true }); fs.writeFileSync(target, JSON.stringify(payload, null, 2), "utf8"); }
const output = process.argv.includes("--status-only") && fs.existsSync(target) ? read(target) : payload;
console.log(JSON.stringify({ ...output, receiptPath: target }, null, 2));
process.exitCode = output?.complete === true || output?.status === "awaiting_scorecard_1315" ? 0 : 1;
