"use strict";

const fs = require("fs");
const path = require("path");
const { runtimePath, statePath } = require("./runtime-paths");

const CONTRACT = "daytrade_industry_fast_inject_runner_verifier_receipt_v1";
const SOURCE_FILE = statePath("daytrade-industry-signal-fast-inject.json");

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

function buildReceipt() {
  const clock = taipeiClock();
  const checkedAt = new Date().toISOString();
  const source = readJson(SOURCE_FILE, {});
  const rows = Array.isArray(source.rows) ? source.rows : [];
  const industries = Array.isArray(source.industries) ? source.industries.filter(Boolean) : [];
  const symbols = Array.isArray(source.symbols) ? source.symbols.map(String).filter((symbol) => /^\d{4}$/.test(symbol)) : [];
  const sameTradeDate = String(source.trade_date || source.tradeDate || "") === clock.tradeDate;
  const scanExecuted = Boolean(source.contract === "daytrade_industry_signal_fast_inject_v1" && source.updated_at);
  const zeroEvent = scanExecuted && rows.length === 0 && symbols.length === 0;
  const failedChecks = [];
  if (!scanExecuted) failedChecks.push("industry_fast_inject_scan_not_executed");
  if (!sameTradeDate) failedChecks.push("industry_fast_inject_trade_date_mismatch");
  if (Number(source.injection_count || 0) !== rows.length) failedChecks.push("industry_fast_inject_count_mismatch");
  return {
    ok: failedChecks.length === 0,
    complete: failedChecks.length === 0,
    contract: CONTRACT,
    source_contract: source.contract || "",
    trade_date: clock.tradeDate,
    canonical_run_id: source.canonical_run_id || source.run_id || `fugle_daytrade_source:${clock.compact}:canonical`,
    checked_at: checkedAt,
    source_path: SOURCE_FILE,
    scan_executed: scanExecuted,
    same_trade_date: sameTradeDate,
    source_rows: Number(source.source_rows ?? rows.length),
    industries,
    symbols,
    rows,
    injection_count: rows.length,
    zero_event: zeroEvent,
    zero_event_reason: zeroEvent ? "no_industry_met_fast_inject_threshold" : null,
    failed_checks: failedChecks,
    first_blocker: failedChecks[0] || null,
    formal_candidate: false,
    order_allowed: false,
  };
}

const receipt = buildReceipt();
const clock = taipeiClock();
const receiptPath = runtimePath("data", "scan-receipts", `daytrade-industry-fast-inject-${clock.compact}.json`);
writeJson(receiptPath, { ...receipt, receipt_path: receiptPath });
console.log(JSON.stringify({ ...receipt, receipt_path: receiptPath }, null, 2));
if (!receipt.complete) process.exitCode = 1;
