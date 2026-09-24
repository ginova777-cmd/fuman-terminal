"use strict";

const fs = require("fs");
const path = require("path");
const { runtimePath } = require("./runtime-paths");

const CONTRACT = "daytrade_industry_top3_runner_verifier_receipt_v1";

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
  if (!receipt) failedChecks.push("industry_top3_receipt_missing");
  if (receipt?.contract !== CONTRACT) failedChecks.push("industry_top3_contract_mismatch");
  if (receipt?.trade_date !== clock.tradeDate) failedChecks.push("industry_top3_trade_date_mismatch");
  if (receipt?.scan_executed !== true) failedChecks.push("industry_top3_scan_not_executed");
  if (!Number.isFinite(Number(receipt?.source_rows)) || Number(receipt.source_rows) <= 0) failedChecks.push("industry_top3_source_rows_empty");
  if (!Array.isArray(receipt?.rows) || receipt.rows.length === 0) failedChecks.push("industry_top3_rows_empty");
  for (const row of Array.isArray(receipt?.rows) ? receipt.rows : []) {
    if (!Number.isFinite(Number(row.industry_rank))) failedChecks.push("industry_top3_rank_missing");
    if (!String(row.industry_name || "").trim()) failedChecks.push("industry_top3_name_missing");
    if (!Number.isFinite(Number(row.industry_member_count))) failedChecks.push(`industry_top3_member_count_missing:${row.industry_name || ""}`);
  }
  return {
    ok: failedChecks.length === 0,
    complete: failedChecks.length === 0,
    contract: "daytrade_industry_top3_canonical_verifier_v1",
    runner_contract: receipt?.contract || "",
    trade_date: clock.tradeDate,
    checked_at: new Date().toISOString(),
    source_receipt_path: receipt?.receipt_path || "",
    top3_count: Array.isArray(receipt?.rows) ? receipt.rows.length : 0,
    source_rows: Number(receipt?.source_rows || 0),
    industries: Array.isArray(receipt?.industries) ? receipt.industries : [],
    failed_checks: failedChecks,
    first_blocker: failedChecks[0] || null,
  };
}

const clock = taipeiClock();
const receiptPath = runtimePath("data", "scan-receipts", `daytrade-industry-top3-${clock.compact}.json`);
const result = verify(readJson(receiptPath, null));
if (process.argv.includes("--write-receipt")) {
  const out = runtimePath("data", "scan-receipts", `daytrade-industry-top3-verifier-${clock.compact}.json`);
  writeJson(out, { ...result, receipt_path: out });
}
console.log(JSON.stringify(result, null, 2));
if (!result.complete) process.exitCode = 1;
