"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { hasTelegramConfig, sendTelegramText, telegramTargets } = require("./telegram-push");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const RECEIPT_DIR = path.join(RUNTIME_DIR, "data", "opening-report-0830");

function taipeiDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
function taipeiMinutes(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).map((part) => [part.type, part.value]));
  return Number(parts.hour) * 60 + Number(parts.minute);
}
function compact(value) { return String(value || "").replace(/\D/g, "").slice(0, 8); }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function hash(value) { return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex"); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function waitUntil0836() {
  while (taipeiMinutes() < 8 * 60 + 36) await sleep(Math.min(15000, (8 * 60 + 36 - taipeiMinutes()) * 60000));
}

async function main() {
  const tradeDate = taipeiDate();
  const day = compact(tradeDate);
  const finalFile = path.join(RECEIPT_DIR, `opening-report-0830-final-receipt-${day}.json`);
  const receiptFile = path.join(RECEIPT_DIR, `opening-report-0830-telegram-receipt-${day}.json`);
  const final = readJson(finalFile);
  const blockers = [];
  if (!final) blockers.push("opening_report_final_receipt_missing");
  if (compact(final?.date) !== day) blockers.push("opening_report_trade_date_mismatch");
  if (!String(final?.run_id || "").startsWith(`opening-report-0830-${day}-`)) blockers.push("opening_report_run_id_invalid");
  if (final?.mother_pool_bridge_attempted !== true || final?.mother_pool_bridge_ok !== true) blockers.push("mother_pool_bridge_not_complete");
  if (final?.formal_candidates !== 0 || final?.watchlist_only !== true) blockers.push("formal_publish_guard_failed");
  if (!final?.report_path || !fs.existsSync(final.report_path)) blockers.push("opening_report_file_missing");
  if (!hasTelegramConfig()) blockers.push("telegram_config_missing");
  const targetCount = hasTelegramConfig() ? telegramTargets().length : 0;
  if (targetCount < 2) blockers.push("telegram_personal_and_group_targets_missing");
  const text = final?.report_path && fs.existsSync(final.report_path) ? fs.readFileSync(final.report_path, "utf8") : "";
  const contentHash = hash(text);
  const previous = readJson(receiptFile);
  if (!blockers.length && previous?.ok === true && previous?.run_id === final.run_id && previous?.content_hash === contentHash && previous?.delivered_count === previous?.target_count) {
    console.log(JSON.stringify({ ...previous, duplicate_suppressed: true }, null, 2));
    return;
  }
  if (!blockers.length) {
    const minutes = taipeiMinutes();
    if (minutes < 8 * 60 + 30 || minutes > 9 * 60) blockers.push("outside_opening_report_delivery_window");
  }
  let results = [];
  if (!blockers.length) {
    await waitUntil0836();
    results = await sendTelegramText(text, {
      openingReport0830Telegram: true,
      dataConfirmed: true,
      idempotencyKey: `opening-report-0830:${day}:${final.run_id}:${contentHash}`,
      dedupeScope: `opening-report-0830:${day}`,
    });
    if (results.length !== targetCount || results.some((row) => row.sent !== true)) blockers.push("telegram_delivery_incomplete");
  }
  const output = {
    ok: blockers.length === 0,
    contract: "opening-report-0830-telegram-delivery-v1",
    trade_date: tradeDate,
    run_id: String(final?.run_id || ""),
    content_hash: contentHash,
    checked_at: new Date().toISOString(),
    channel: "telegram_only",
    target_count: targetCount,
    delivered_count: results.filter((row) => row.sent === true).length,
    token_logged: false,
    target_logged: false,
    first_blocker: blockers[0] || "",
    reason_code: blockers[0] || "opening_report_0830_telegram_delivered",
    blockers,
  };
  writeJson(receiptFile, output);
  console.log(JSON.stringify({ ...output, receipt: receiptFile }, null, 2));
  if (!output.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, reason_code: "opening_report_0830_telegram_exception", error: error?.message || String(error) }, null, 2));
  process.exitCode = 1;
});
