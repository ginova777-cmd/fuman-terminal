"use strict";

const fs = require("fs");
const path = require("path");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const RECEIPT_DIR = path.join(RUNTIME_DIR, "data", "opening-report-0830");
const STATE_DIR = process.env.FUMAN_OPENING_REPORT_STATE_DIR || path.join(RUNTIME_DIR, "state");

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const item = process.argv.find((value) => value === name || value.startsWith(prefix));
  return item === name ? "1" : (item ? item.slice(prefix.length) : fallback);
}
function hasFlag(name) { return process.argv.includes(name); }
function taipeiDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function compact(value) { return String(value || "").replace(/\D/g, "").slice(0, 8); }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }
function listIndustryInputs(day, runId) {
  try {
    return fs.readdirSync(STATE_DIR)
      .filter((file) => /^opening_report_0830\.industry_bias\..+\.json$/i.test(file))
      .map((file) => ({ file: path.join(STATE_DIR, file), value: readJson(path.join(STATE_DIR, file)) }))
      .filter(({ value }) => compact(value?.trade_date || value?.date) === day)
      .filter(({ value }) => !runId || value?.run_id === runId);
  } catch { return []; }
}
function check(name, ok, reasonCode, details = {}) {
  return { name, ok: Boolean(ok), status: ok ? "PASS" : "FAIL", reason_code: ok ? null : reasonCode, ...details };
}
function main() {
  const tradeDate = argValue("--trade-date", process.env.FUMAN_TRADE_DATE || taipeiDate());
  const day = compact(tradeDate);
  const requireTelegram = hasFlag("--require-telegram");
  const finalPath = path.join(RECEIPT_DIR, `opening-report-0830-final-receipt-${day}.json`);
  const terminalPath = path.join(RECEIPT_DIR, `opening-report-0830-terminal-briefing-verifier-${day}.json`);
  const telegramPath = path.join(RECEIPT_DIR, `opening-report-0830-telegram-receipt-${day}.json`);
  const finalReceipt = readJson(finalPath);
  const terminalReceipt = readJson(terminalPath);
  const telegramReceipt = readJson(telegramPath);
  const runId = String(finalReceipt?.run_id || "");
  const inputs = listIndustryInputs(day, runId);
  const sourceGapCount = Number(finalReceipt?.overseas_source_gap_count ?? finalReceipt?.overseas_partial_source_gaps ?? 0);
  const stalePromotedCount = Number(finalReceipt?.overseas_stale_promoted_count ?? 0);
  const contentHash = String(finalReceipt?.delivery_content_hash || finalReceipt?.content_hash || "");
  const terminalContentHash = String(terminalReceipt?.content_hash || terminalReceipt?.delivery_content_hash || "");
  const checks = [];
  checks.push(check("final_receipt", finalReceipt?.report_status === "REPORT_OK" && compact(finalReceipt?.date || finalReceipt?.trade_date) === day && Boolean(runId) && /^[a-f0-9]{64}$/i.test(contentHash), "opening_report_final_receipt_invalid", { path: finalPath, report_status: finalReceipt?.report_status || null, run_id: runId || null, content_hash: contentHash || null }));
  checks.push(check("industry_bias_19_of_19", inputs.length === 19 && inputs.every(({ value }) => value?.source === "opening_report_0830" && value?.mode === "priority_bias_only" && value?.report_time === "08:30"), "industry_bias_inputs_incomplete_or_invalid", { found: inputs.length, expected: 19, state_dir: STATE_DIR }));
  checks.push(check("asia_stale_isolation", stalePromotedCount === 0, "stale_asia_leader_promoted", { source_gap_count: sourceGapCount, stale_promoted_count: stalePromotedCount }));
  checks.push(check("formal_publish_guard", Number(finalReceipt?.formal_candidates ?? finalReceipt?.formal_candidate_count) === 0 && finalReceipt?.watchlist_only === true, "opening_report_formal_publish_guard_failed", { formal_candidates: finalReceipt?.formal_candidates ?? finalReceipt?.formal_candidate_count ?? null, watchlist_only: finalReceipt?.watchlist_only ?? null }));
  checks.push(check("terminal_readback", terminalReceipt?.briefing_status === "PASS" && compact(terminalReceipt?.date || terminalReceipt?.trade_date) === day && terminalReceipt?.run_id === runId && terminalContentHash === contentHash, "terminal_briefing_readback_not_closed", { path: terminalPath, briefing_status: terminalReceipt?.briefing_status || null, terminal_run_id: terminalReceipt?.run_id || null, terminal_content_hash: terminalContentHash || null }));
  if (telegramReceipt) {
    const telegramOk = telegramReceipt?.ok === true && compact(telegramReceipt?.trade_date || telegramReceipt?.date) === day && telegramReceipt?.run_id === runId && (!contentHash || telegramReceipt?.content_hash === contentHash);
    checks.push(check("telegram_delivery", telegramOk, "telegram_delivery_or_identity_not_closed", { path: telegramPath, telegram_status: telegramReceipt?.reason_code || null, delivered_count: telegramReceipt?.delivered_count ?? null, target_count: telegramReceipt?.target_count ?? null }));
  } else if (requireTelegram) {
    checks.push(check("telegram_delivery", false, "telegram_receipt_missing", { path: telegramPath }));
  } else {
    checks.push({ name: "telegram_delivery", ok: true, status: "SKIP", reason_code: "telegram_not_required_for_canonical_report", path: telegramPath });
  }
  const failedChecks = checks.filter((item) => item.status === "FAIL");
  const output = {
    ok: failedChecks.length === 0, contract: "opening_report_0830_closure_readonly_v1", trade_date: tradeDate, run_id: runId || null, industry_count: inputs.length, source_gap_count: sourceGapCount, stale_asia_promoted_count: stalePromotedCount, content_hash: contentHash || null, telegram_required: requireTelegram, checks, failed_checks: failedChecks.map((item) => `${item.name}:${item.reason_code}`), first_blocker: failedChecks[0] ? `${failedChecks[0].name}:${failedChecks[0].reason_code}` : null, read_only: true,
  };
  console.log(JSON.stringify(output, null, 2));
  if (!output.ok) process.exitCode = 1;
}
main();
