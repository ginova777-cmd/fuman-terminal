"use strict";
const fs = require("fs");
const path = require("path");
const RUNTIME = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
function arg(name, fallback = "") { const prefix = `--${name}=`; return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length) || fallback; }
function taipeiDate() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); } catch { return null; } }
function guardOk(value) { return value?.creates_order === false && value?.creates_formal_candidate === false && value?.publish_allowed === false && value?.requires_second_confirm_before_action === true; }
const tradeDate = arg("trade-date", taipeiDate());
const compact = tradeDate.replace(/\D/g, "");
const file = path.join(RUNTIME, "data", "opening-limit-order", `opening-limit-order-0840-pre-candidates-${compact}.json`);
const receipt = readJson(file);
const failures = [];
if (!receipt) failures.push("pre_candidates_receipt_missing");
else {
  if (receipt.trade_date !== tradeDate) failures.push("pre_candidates_trade_date_mismatch");
  if (!new RegExp(`^opening-limit-order-${compact}-`).test(String(receipt.run_id || ""))) failures.push("pre_candidates_run_id_invalid");
  if (receipt.uses_0900_data !== false) failures.push("pre_candidates_uses_0900_data");
  if (!guardOk(receipt.action_guard)) failures.push("pre_candidates_action_guard_invalid");
  if (Number(receipt.formal_candidate_count || 0) !== 0 || receipt.formal_candidate_allowed !== false || receipt.publish_allowed !== false) failures.push("pre_candidates_formal_guard_invalid");
  if (!receipt.source_paths?.preflight || !receipt.source_paths?.watchlist) failures.push("pre_candidates_source_paths_missing");
  if (!Array.isArray(receipt.preflight_attempts) || receipt.preflight_attempts.length < 1) failures.push("pre_candidates_preflight_evidence_missing");
  if (receipt.ok !== true) failures.push(`pre_candidates_not_ok:${receipt.first_blocker || "unknown"}`);
}
const output = {
  ok: failures.length === 0,
  contract: "opening_limit_order_0840_checkpoint_readonly_v1",
  trade_date: tradeDate,
  checked_at: new Date().toISOString(),
  read_only: true,
  strategy_started: false,
  receipt_path: file,
  run_id: receipt?.run_id || null,
  symbol_count: receipt?.symbol_count ?? null,
  preflight_attempt_count: Array.isArray(receipt?.preflight_attempts) ? receipt.preflight_attempts.length : null,
  source_paths: receipt?.source_paths || null,
  action_guard: receipt?.action_guard || null,
  failed_checks: failures,
  first_blocker: failures[0] || null,
};
console.log(JSON.stringify(output, null, 2));
process.exitCode = output.ok ? 0 : 1;
