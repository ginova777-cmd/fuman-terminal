"use strict";

const fs = require("fs");
const path = require("path");

const runtimeRoot = process.env.FUMAN_RUNTIME_ROOT || process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const receiptDir = path.join(runtimeRoot, "data", "scan-receipts");
const requestedSlot = String(process.argv.find((arg) => arg.startsWith("--slot=")) || "").slice(7);
const slots = {
  "12:40": ["strategy2"],
  "13:15": ["strategy3"],
  "17:00": ["strategy4"],
  "21:40": ["strategy5", "institution", "battle"],
};

function taipeiDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}
function compact(value) { return String(value || "").replace(/\D/g, "").slice(0, 8); }

const today = taipeiDate();
const todayKey = compact(today);
const selected = requestedSlot ? [requestedSlot] : Object.keys(slots);
const issues = [];
const evidence = [];

for (const slot of selected) {
  if (!slots[slot]) {
    issues.push(`invalid_slot:${slot}`);
    continue;
  }
  const file = path.join(receiptDir, `scorecard88-collection-${todayKey}-${slot.replace(":", "")}.json`);
  const receipt = readJson(file);
  if (!receipt) {
    issues.push(`collection_receipt_missing:${slot}`);
    evidence.push({ slot, file, exists: false });
    continue;
  }
  const reports = Array.isArray(receipt.reports) ? receipt.reports : [];
  const slotIssues = [];
  if (receipt.slot !== slot) slotIssues.push("slot_mismatch");
  if (compact(receipt.tradeDate) !== todayKey) slotIssues.push("trade_date_not_today");
  for (const key of slots[slot]) {
    const row = reports.find((item) => String(item.key || item.strategy || "").toLowerCase() === key);
    if (!row) { slotIssues.push(`report_missing:${key}`); continue; }
    if (row.querySupabase !== false) slotIssues.push(`supabase_query_not_false:${key}`);
    if (row.recalculated !== false) slotIssues.push(`recalculated_not_false:${key}`);
    if (row.generatedRunId !== false) slotIssues.push(`generated_run_id_not_false:${key}`);
    if (row.complete === true && (!row.runId || compact(row.tradeDate || row.date) !== todayKey)) slotIssues.push(`complete_without_today_canonical:${key}`);
    if (row.complete !== true) {
      const blockedStatuses = new Set(["今日尚未閉環", "FAIL_CLOSED", "BLOCKED"]);
      if (!blockedStatuses.has(row.status) || !row.blocking_reason) slotIssues.push(`blocked_contract_invalid:${key}`);
      if (row.status === "FAIL_CLOSED" && (!row.runId || compact(row.tradeDate || row.date) !== todayKey)) slotIssues.push(`fail_closed_without_today_canonical:${key}`);
      if (row.status === "FAIL_CLOSED" && row.publishAllowed !== false) slotIssues.push(`fail_closed_publish_allowed_not_false:${key}`);
      if (row.status === "FAIL_CLOSED" && row.formalDisplayAllowed !== false) slotIssues.push(`fail_closed_formal_display_not_false:${key}`);
    }
  }
  if (slotIssues.length) issues.push(...slotIssues.map((issue) => `${slot}:${issue}`));
  evidence.push({ slot, file, exists: true, receiptStatus: receipt.status || "", receiptOk: receipt.ok === true, reportCount: reports.length, issues: slotIssues });
}

const result = {
  ok: issues.length === 0,
  contract: "scorecard88-fixed-slot-receipt-verifier-v1",
  checkedAt: new Date().toISOString(),
  tradeDate: today,
  selectedSlots: selected,
  invariants: { scans: false, supabaseQueries: false, recalculation: false, runIdGeneration: false },
  evidence,
  issues,
};
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
