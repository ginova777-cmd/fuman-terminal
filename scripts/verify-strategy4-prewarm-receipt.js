"use strict";

const fs = require("fs");
const path = require("path");

const RUNTIME = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const RECEIPT = path.join(RUNTIME, "data", "scan-receipts", "strategy4-source-prewarm-latest.json");
const waitArg = process.argv.find((arg) => arg.startsWith("--wait-ms="));
const WAIT_MS = Math.max(0, Number(waitArg?.split("=")[1] ?? 90000) || 0);

function taipeiDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function readReceipt() {
  try { return { value: JSON.parse(fs.readFileSync(RECEIPT, "utf8")), error: null }; }
  catch (error) { return { value: null, error: error.message }; }
}
function evaluate(payload, today) {
  const issues = [];
  if (!payload) return ["prewarm_receipt_missing"];
  if (payload.ok !== true || payload.complete !== true || payload.status !== "complete") issues.push("prewarm_not_complete");
  if (payload.sourceReady !== true || payload.publishAllowed !== true || payload.evidenceStatus !== "complete") issues.push("prewarm_source_not_ready");
  if (payload.tradeDate !== today) issues.push("prewarm_trade_date_not_today");
  if (payload.fallback === true || payload.preservePreviousGood === true) issues.push("prewarm_fallback_or_previous_good_forbidden");
  const finished = Date.parse(payload.finishedAt || "");
  if (!Number.isFinite(finished) || taipeiDate(new Date(finished)) !== today || finished > Date.now() + 60000) issues.push("prewarm_receipt_timestamp_not_today");
  const reason = String(payload.reason || "");
  const rowsMatch = reason.match(/rows_on_(?:latest|selected)_date=(\d+)/);
  const rows = Number(rowsMatch?.[1] || payload?.resourceGate?.Details?.rowsOnLatestDate || 0);
  if (!Number.isFinite(rows) || rows < 1500) issues.push("prewarm_full_universe_rows_below_1500");
  return issues;
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function main() {
  const today = taipeiDate();
  const deadline = Date.now() + WAIT_MS;
  let read = readReceipt();
  let issues = evaluate(read.value, today);
  while (issues.length && Date.now() < deadline) {
    await sleep(Math.min(5000, Math.max(1, deadline - Date.now())));
    read = readReceipt();
    issues = evaluate(read.value, today);
  }
  const payload = read.value;
  const reason = String(payload?.reason || "");
  const rowsMatch = reason.match(/rows_on_(?:latest|selected)_date=(\d+)/);
  const result = {
    contract: "strategy4-prewarm-receipt-verifier-v1", ok: issues.length === 0,
    checkedAt: new Date().toISOString(), tradeDate: today, waitedUpToMs: WAIT_MS,
    receiptFile: RECEIPT, receipt: payload ? {
      status: payload.status || null, complete: payload.complete === true, sourceReady: payload.sourceReady === true,
      tradeDate: payload.tradeDate || null, runId: payload.runId || null, startedAt: payload.startedAt || null,
      finishedAt: payload.finishedAt || null, rowsOnLatestDate: Number(rowsMatch?.[1] || payload?.resourceGate?.Details?.rowsOnLatestDate || 0),
      fallback: payload.fallback === true, preservePreviousGood: payload.preservePreviousGood === true,
    } : null,
    readError: read.error, issues,
    actionsByVerifier: { prewarmStarted: false, strategyExecuted: false, scannerExecuted: false, runIdGenerated: false, dataMutated: false },
    reasonCode: issues[0] || "ok",
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
main().catch((error) => { console.error(JSON.stringify({ ok: false, error: error.message }, null, 2)); process.exitCode = 1; });
