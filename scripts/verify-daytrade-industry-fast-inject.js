"use strict";

const fs = require("fs");
const path = require("path");
const { runtimePath } = require("./runtime-paths");

const CONTRACT = "daytrade_industry_fast_inject_runner_verifier_receipt_v1";

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function taipeiClock(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now).map((part) => [part.type, part.value]));
  const tradeDate = `${parts.year}-${parts.month}-${parts.day}`;
  return { tradeDate, compact: tradeDate.replace(/-/g, "") };
}

function verify(receipt) {
  const clock = taipeiClock();
  const failedChecks = [];
  if (!receipt) failedChecks.push("industry_fast_inject_receipt_missing");
  if (receipt?.contract !== CONTRACT) failedChecks.push("industry_fast_inject_contract_mismatch");
  if (receipt?.trade_date !== clock.tradeDate) failedChecks.push("industry_fast_inject_trade_date_mismatch");
  if (receipt?.scan_executed !== true) failedChecks.push("industry_fast_inject_scan_not_executed");
  if (!Array.isArray(receipt?.rows)) failedChecks.push("industry_fast_inject_rows_not_array");
  if (Number(receipt?.injection_count || 0) !== (Array.isArray(receipt?.rows) ? receipt.rows.length : -1)) failedChecks.push("industry_fast_inject_count_mismatch");
  if (Number(receipt?.injection_count || 0) === 0 && receipt?.zero_event !== true) failedChecks.push("industry_fast_inject_zero_event_reason_missing");
  for (const row of Array.isArray(receipt?.rows) ? receipt.rows : []) {
    if (!/^\d{4}$/.test(String(row.symbol || ""))) failedChecks.push("industry_fast_inject_symbol_invalid");
    if (!String(row.industry || "").trim()) failedChecks.push(`industry_fast_inject_industry_missing:${row.symbol || ""}`);
    if (!String(row.source || "").includes("industry_signal_fast_inject")) failedChecks.push(`industry_fast_inject_source_missing:${row.symbol || ""}`);
  }
  return {
    ok: failedChecks.length === 0,
    complete: failedChecks.length === 0,
    contract: "daytrade_industry_fast_inject_canonical_verifier_v1",
    runner_contract: receipt?.contract || "",
    trade_date: clock.tradeDate,
    checked_at: new Date().toISOString(),
    source_receipt_path: receipt?.receipt_path || "",
    injection_count: Number(receipt?.injection_count || 0),
    zero_event: receipt?.zero_event === true,
    zero_event_reason: receipt?.zero_event_reason || null,
    symbols: Array.isArray(receipt?.symbols) ? receipt.symbols : [],
    industries: Array.isArray(receipt?.industries) ? receipt.industries : [],
    failed_checks: failedChecks,
    first_blocker: failedChecks[0] || null,
  };
}

const clock = taipeiClock();
const receiptPath = runtimePath("data", "scan-receipts", `daytrade-industry-fast-inject-${clock.compact}.json`);
const result = verify(readJson(receiptPath, null));
if (process.argv.includes("--write-receipt")) {
  const out = runtimePath("data", "scan-receipts", `daytrade-industry-fast-inject-verifier-${clock.compact}.json`);
  writeJson(out, { ...result, receipt_path: out });
}
console.log(JSON.stringify(result, null, 2));
if (!result.complete) process.exitCode = 1;
