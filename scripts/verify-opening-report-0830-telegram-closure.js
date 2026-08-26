"use strict";

const fs = require("fs");
const path = require("path");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const RECEIPT_DIR = path.join(RUNTIME_DIR, "data", "opening-report-0830");
function taipeiDate(date = new Date()) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(date); }
function compact(value) { return String(value || "").replace(/\D/g, "").slice(0, 8); }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }
function main() {
  const tradeDate = taipeiDate();
  const day = compact(tradeDate);
  const finalFile = path.join(RECEIPT_DIR, `opening-report-0830-final-receipt-${day}.json`);
  const telegramFile = path.join(RECEIPT_DIR, `opening-report-0830-telegram-receipt-${day}.json`);
  const terminalFile = path.join(RECEIPT_DIR, `opening-report-0830-terminal-briefing-verifier-${day}.json`);
  const outputFile = path.join(RECEIPT_DIR, `opening-report-0830-telegram-closure-${day}.json`);
  const final = readJson(finalFile);
  const telegram = readJson(telegramFile);
  const terminal = readJson(terminalFile);
  const issues = [];
  if (!final || compact(final.date) !== day || !final.run_id) issues.push("opening_report_final_receipt_invalid");
  if (final?.formal_candidates !== 0 || final?.watchlist_only !== true) issues.push("formal_publish_guard_failed");
  if (final?.mother_pool_bridge_attempted !== true || final?.mother_pool_bridge_ok !== true) issues.push("mother_pool_bridge_not_complete");
  if (terminal?.ok !== true || (terminal?.run_id && terminal.run_id !== final?.run_id)) issues.push("terminal_briefing_not_closed");
  if (telegram?.ok !== true || telegram?.channel !== "telegram_only") issues.push("telegram_delivery_not_complete");
  if (telegram?.run_id !== final?.run_id || compact(telegram?.trade_date) !== day) issues.push("telegram_identity_mismatch");
  if (!/^[a-f0-9]{64}$/.test(String(telegram?.content_hash || ""))) issues.push("telegram_content_hash_missing");
  if (Number(telegram?.target_count || 0) < 2 || telegram?.delivered_count !== telegram?.target_count) issues.push("telegram_personal_group_delivery_not_proven");
  if (telegram?.token_logged !== false || telegram?.target_logged !== false) issues.push("telegram_secret_logging_guard_failed");
  const output = { ok: issues.length === 0, contract: "opening-report-0830-telegram-closure-v1", trade_date: tradeDate, run_id: final?.run_id || "", checked_at: new Date().toISOString(), chain: "08:30_report -> 08:35_mother_pool_bridge -> 08:36_telegram -> terminal_readback", first_blocker: issues[0] || "", reason_code: issues[0] || "opening_report_0830_telegram_closure_ok", issues };
  fs.writeFileSync(outputFile, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ...output, receipt: outputFile }, null, 2));
  if (!output.ok) process.exitCode = 1;
}
main();
