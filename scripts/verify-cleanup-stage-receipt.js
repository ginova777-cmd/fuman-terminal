"use strict";

const fs = require("fs");
const path = require("path");

const RUNTIME = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const STATUS = path.join(RUNTIME, "status");
const stageArg = process.argv.find((arg) => arg.startsWith("--stage="));
const stage = Number(stageArg?.split("=")[1]);

function taipeiDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(value);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function readJson(file) {
  try { return { value: JSON.parse(fs.readFileSync(file, "utf8")), error: null }; }
  catch (error) { return { value: null, error: error.message }; }
}
function timestampOnToday(value, today) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) && taipeiDate(new Date(parsed)) === today && parsed <= Date.now() + 60_000;
}

const contracts = {
  1: {
    name: "api_only_retired_artifact_cleanup",
    file: path.join(STATUS, "api-only-retired-cleanup-status.json"),
    timeFields: ["finishedAt", "checkedAt"],
    validate(payload, issues) {
      if (payload?.ok !== true) issues.push("stage1_receipt_not_ok");
      if (payload?.dryRun !== false) issues.push("stage1_not_applied_run");
      if (!Number.isInteger(payload?.deletedCount) || payload.deletedCount < 0) issues.push("stage1_deleted_count_invalid");
      if (!payload?.runtime || typeof payload.runtime !== "object") issues.push("stage1_runtime_evidence_missing");
    },
  },
  2: {
    name: "supabase_vercel_history_retention",
    file: path.join(STATUS, "supabase-vercel-history-cleanup-status.json"),
    timeFields: ["checkedAt", "finishedAt"],
    validate(payload, issues, details) {
      if (payload?.ok !== true || payload?.supabase?.ok !== true) issues.push("stage2_receipt_not_ok");
      if (payload?.applied !== true || payload?.dryRun !== false) issues.push("stage2_not_applied_run");
      const sections = Array.isArray(payload?.supabase?.sections) ? payload.supabase.sections : [];
      const expected = new Map([
        ["mobile_update_events", 14], ["market_snapshots_fuman_history", 60],
        ["daytrade_entry_history_37d", 37], ["seven_strategy_daily_history_37d", 37],
        ["strategy1", 45], ["strategy2", 14], ["strategy3", 45], ["strategy4", 45],
        ["strategy5", 45], ["institution", 45], ["cb", 45], ["warrant", 45],
      ]);
      const allowedTables = new Set([
        "mobile_update_events", "market_snapshots", "fugle_daytrade_entry_history", "seven_strategy_daily_history",
        "strategy1_open_buy_runs", "strategy2_scan_runs", "strategy3_scan_runs", "strategy4_scan_runs",
        "strategy5_scan_runs", "institution_scan_runs", "cb_detect_scan_runs", "warrant_flow_scan_runs",
      ]);
      for (const [key, retentionDays] of expected) {
        const section = sections.find((item) => item?.key === key);
        if (!section) { issues.push(`stage2_section_missing:${key}`); continue; }
        if (Number(section.retentionDays) !== retentionDays) issues.push(`stage2_retention_days_mismatch:${key}`);
        const table = section.table || section.runsTable;
        if (!allowedTables.has(table)) issues.push(`stage2_table_outside_contract:${key}`);
        if (section.dryRun !== false) issues.push(`stage2_section_not_applied:${key}`);
        if (section.error || section.ok === false) issues.push(`stage2_section_failed:${key}`);
      }
      details.sections = sections.map((item) => ({
        key: item?.key || null, table: item?.table || item?.runsTable || null,
        retentionDays: item?.retentionDays ?? null, candidates: item?.candidates ?? item?.candidateRuns ?? null,
        deleted: item?.deleted ?? item?.deletedRuns ?? null, dryRun: item?.dryRun ?? null,
      }));
    },
  },
};

function main() {
  const contract = contracts[stage];
  if (!contract) {
    console.error(JSON.stringify({ ok: false, issues: ["unsupported_cleanup_stage"], stage }, null, 2));
    process.exitCode = 2;
    return;
  }
  const today = taipeiDate();
  const receipt = readJson(contract.file);
  const payload = receipt.value;
  const issues = [];
  const details = {};
  if (!payload) issues.push("cleanup_stage_receipt_missing_or_invalid");
  const timestampField = contract.timeFields.find((field) => payload?.[field]);
  const timestamp = timestampField ? payload[timestampField] : null;
  if (!timestampOnToday(timestamp, today)) issues.push("cleanup_stage_receipt_not_today");
  if (payload) contract.validate(payload, issues, details);
  const result = {
    contract: "cleanup-stage-receipt-verifier-v1", ok: issues.length === 0,
    checkedAt: new Date().toISOString(), tradeDate: today, stage, name: contract.name,
    receiptFile: contract.file, receiptTimestampField: timestampField || null, receiptTimestamp: timestamp,
    readError: receipt.error, details, issues,
    actionsByVerifier: { cleanupExecuted: false, mutationExecuted: false, strategyExecuted: false, scannerExecuted: false, runIdGenerated: false },
    reasonCode: issues[0] || "ok",
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
main();
