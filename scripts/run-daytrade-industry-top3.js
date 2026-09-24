"use strict";

const fs = require("fs");
const path = require("path");
const { runtimePath, statePath } = require("./runtime-paths");

const CONTRACT = "daytrade_industry_top3_runner_verifier_receipt_v1";
const OUTBOX_FILE = statePath("daytrade-intraday-burst-telegram-outbox.json");

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

function numberValue(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function buildReceipt() {
  const clock = taipeiClock();
  const checkedAt = new Date().toISOString();
  const outbox = readJson(OUTBOX_FILE, {});
  const heatmap = Array.isArray(outbox.industry_heatmap) ? outbox.industry_heatmap : [];
  const sameTradeDate = String(outbox.trade_date || outbox.tradeDate || "") === clock.tradeDate;
  const rows = heatmap
    .filter((row) => row && String(row.industry || "").trim())
    .sort((a, b) => numberValue(a.flow_rank, 999999) - numberValue(b.flow_rank, 999999)
      || numberValue(b.net_flow_proxy) - numberValue(a.net_flow_proxy)
      || String(a.industry).localeCompare(String(b.industry), "zh-Hant"));
  const top3 = rows.slice(0, 3).map((row, index) => ({
    industry_rank: numberValue(row.flow_rank, index + 1),
    industry_name: String(row.industry || ""),
    industry_parent: String(row.industry_parent || ""),
    flow_direction: String(row.flow_direction || ""),
    net_flow_proxy: numberValue(row.net_flow_proxy),
    industry_member_count: numberValue(row.symbol_count),
    industry_up_count: numberValue(row.advancers),
    industry_down_count: numberValue(row.decliners),
    industry_trade_value_delta: numberValue(row.flow_delta_proxy),
    industry_avg_change_pct: numberValue(row.average_change_percent),
    industry_breadth_pct: numberValue(row.breadth_percent),
    persistent_large_inflow: row.persistent_large_inflow === true,
    sudden_large_inflow: row.sudden_large_inflow === true,
    industry_trigger_reason: String(row.industry_trigger_reason || "not_qualified"),
  }));
  const failedChecks = [];
  if (!outbox || Object.keys(outbox).length === 0) failedChecks.push("industry_top3_source_outbox_missing");
  if (!sameTradeDate) failedChecks.push("industry_top3_trade_date_mismatch");
  if (heatmap.length === 0) failedChecks.push("industry_top3_source_rows_empty");
  if (top3.length === 0) failedChecks.push("industry_top3_rows_empty");
  return {
    ok: failedChecks.length === 0,
    complete: failedChecks.length === 0,
    contract: CONTRACT,
    source_contract: outbox.contract || "",
    trade_date: clock.tradeDate,
    canonical_run_id: outbox.canonical_run_id || outbox.run_id || `fugle_daytrade_source:${clock.compact}:canonical`,
    checked_at: checkedAt,
    source_path: OUTBOX_FILE,
    scan_executed: Boolean(outbox && Object.keys(outbox).length > 0),
    same_trade_date: sameTradeDate,
    source_rows: heatmap.length,
    top3_count: top3.length,
    industries: top3.map((row) => row.industry_name),
    rows: top3,
    zero_event: false,
    failed_checks: failedChecks,
    first_blocker: failedChecks[0] || null,
    formal_candidate: false,
    order_allowed: false,
  };
}

const receipt = buildReceipt();
const clock = taipeiClock();
const receiptPath = runtimePath("data", "scan-receipts", `daytrade-industry-top3-${clock.compact}.json`);
writeJson(receiptPath, { ...receipt, receipt_path: receiptPath });
console.log(JSON.stringify({ ...receipt, receipt_path: receiptPath }, null, 2));
if (!receipt.complete) process.exitCode = 1;
