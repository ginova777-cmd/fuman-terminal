"use strict";
const fs = require("fs");
const path = require("path");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const CONTRACT = "opening_limit_order_0850_freeze_verifier_v1";
function arg(name, fallback = "") { const prefix = `--${name}=`; return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || fallback; }
function compact(value) { return String(value || "").replace(/\D/g, "").slice(0, 8); }
function dash(value) { const c = compact(value); return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4, 6)}-${c.slice(6, 8)}` : ""; }
function read(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }
function guardOk(payload) { const g = payload?.action_guard; return g?.creates_order === false && g?.creates_formal_candidate === false && g?.publish_allowed === false; }
function normalizedPredictions(payload) {
  return (Array.isArray(payload?.predictions) ? payload.predictions : []).map((row) => ({
    symbol: String(row?.symbol || ""), direction: String(row?.prediction || ""),
    reason: String(row?.tomorrow_prediction_reason || ""), pattern: String(row?.tomorrow_prediction_pattern || "")
  })).sort((a, b) => a.symbol.localeCompare(b.symbol));
}
function main() {
  const tradeDate = dash(arg("trade-date")); const expectedRunId = arg("run-id"); const c = compact(tradeDate);
  const dir = path.join(RUNTIME_DIR, "data", "opening-limit-order");
  const paths = {
    preCandidates: path.join(dir, `opening-limit-order-0840-pre-candidates-${c}.json`),
    futoptReadback: path.join(dir, `opening-limit-order-0845-futopt-readback-${c}.json`),
    predictionFreeze: path.join(dir, `opening-limit-order-0850-predictions-${c}.json`),
    rankedWatchlist: path.join(dir, `opening-limit-order-0855-ranked-watchlist-${c}.json`),
    summary: path.join(dir, `opening-limit-order-0855-summary-${c}.json`)
  };
  const receipts = Object.fromEntries(Object.entries(paths).map(([key, file]) => [key, read(file)]));
  const failures = [];
  if (!tradeDate) failures.push("trade_date_invalid");
  for (const [key, payload] of Object.entries(receipts)) if (!payload) failures.push(`${key}_missing_or_invalid`);
  const freeze = receipts.predictionFreeze; const ranked = receipts.rankedWatchlist; const summary = receipts.summary;
  for (const [key, payload] of Object.entries(receipts)) {
    if (!payload) continue;
    if (dash(payload.trade_date) !== tradeDate) failures.push(`${key}_trade_date_mismatch`);
    if (expectedRunId && payload.run_id !== expectedRunId) failures.push(`${key}_run_id_mismatch`);
  }
  if (freeze?.contract !== "opening_limit_order_0850_prediction_freeze_v1") failures.push("prediction_freeze_contract_invalid");
  if (freeze?.ok !== true) failures.push("prediction_freeze_not_ok");
  if (freeze?.publish_deadline !== "08:50 Asia/Taipei") failures.push("prediction_publish_deadline_invalid");
  if (freeze?.immutable_after_publish !== true) failures.push("prediction_not_immutable");
  if (freeze?.allowed_after_0850 !== "monitor_and_rank_only") failures.push("post_0850_action_invalid");
  const frozenPredictions = normalizedPredictions(freeze);
  if (frozenPredictions.length !== Number(freeze?.prediction_count || 0)) failures.push("prediction_count_mismatch");
  if (frozenPredictions.some((row) => !/^\d{4,6}$/.test(row.symbol) || !["多", "空", "不交易"].includes(row.direction) || (row.direction !== "不交易" && (!row.reason || !row.pattern)))) failures.push("prediction_row_contract_invalid");
  if (!guardOk(summary) || !guardOk(ranked)) failures.push("readonly_action_guard_invalid");
  if (ranked?.prediction_immutable_after_publish !== true) failures.push("ranked_watchlist_does_not_preserve_freeze");
  if (path.resolve(String(ranked?.prediction_freeze_path || "")) !== path.resolve(paths.predictionFreeze)) failures.push("ranked_prediction_freeze_path_mismatch");
  if (JSON.stringify(normalizedPredictions(ranked)) !== JSON.stringify(frozenPredictions)) failures.push("ranked_predictions_drifted_from_0850");
  if (JSON.stringify(normalizedPredictions(summary)) !== JSON.stringify(frozenPredictions)) failures.push("summary_predictions_drifted_from_0850");
  const output = { ok: failures.length === 0, contract: CONTRACT, trade_date: tradeDate, run_id: expectedRunId || freeze?.run_id || null, checked_at: new Date().toISOString(), canonical_verifier: true, prediction_count: frozenPredictions.length, paths, failed_checks: failures, first_blocker: failures[0] || null, action_guard: { creates_order: false, creates_formal_candidate: false, publish_allowed: false } };
  console.log(JSON.stringify(output, null, 2)); process.exitCode = output.ok ? 0 : 1;
}
main();
