"use strict";

const fs = require("fs");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const file = process.env.FUMAN_PRIORITY_ARTIFACT || process.env.FUGLE_DAYTRADE_PRIORITY_SYMBOLS_FILE || RUNTIME_DIR + "\\cache\\intraday\\fugle-daytrade-ws-priority-symbols.json";
const REQUIRED_GROUPS = ["strategy2", "strategy3", "strategy4", "strategy5", "institution", "warrant", "cb"];
const expectedDateArg = process.argv.find((arg) => arg.startsWith("--expected-date="));
const expectedDate = expectedDateArg ? expectedDateArg.slice("--expected-date=".length) : "";

function text(value) { return String(value ?? "").trim(); }
function number(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function issue(issues, code, detail) { issues.push({ code, detail }); }

function main() {
  const issues = [];
  let payload = {};
  try { payload = JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) {
    issue(issues, "runtime_priority_artifact_unreadable", error.message || String(error));
  }
  const artifact = payload.formalPriorityStrategyChip;
  if (!artifact || typeof artifact !== "object") {
    issue(issues, "formal_priority_strategy_chip_missing", "next natural writer run must emit formalPriorityStrategyChip");
  } else {
    if (artifact.schemaVersion !== "daytrade-formal-priority-strategy-chip-v1") issue(issues, "formal_priority_schema_invalid", artifact.schemaVersion);
    if (text(artifact.status).toLowerCase() !== "ready") issue(issues, "formal_priority_artifact_not_ready", artifact.status);
    if (artifact.completeLatestRunEvidence !== true) issue(issues, "formal_priority_complete_latest_run_evidence_missing", artifact.completeLatestRunReason || "completeLatestRunEvidence must be true");
    if (number(artifact.formalPriorityLimit) !== 40) issue(issues, "formal_priority_limit_not_40", artifact.formalPriorityLimit);
    const formalSymbols = Array.isArray(artifact.formalPrioritySymbols) ? artifact.formalPrioritySymbols : [];
    if (formalSymbols.length !== 40) issue(issues, "formal_priority_symbols_not_40", formalSymbols.length);
    if (expectedDate && text(artifact.tradeDate) !== expectedDate && text(artifact.tradeDate) !== expectedDate.replace(/-/g, "")) issue(issues, "formal_priority_trade_date_mismatch", String(artifact.tradeDate) + " != " + String(expectedDate));
    const groups = artifact.groups && typeof artifact.groups === "object" ? artifact.groups : {};
    for (const key of REQUIRED_GROUPS) {
      const group = groups[key];
      if (!group || typeof group !== "object") {
        issue(issues, "formal_priority_group_missing_" + key, "group evidence is required even when blocked or empty");
        continue;
      }
      if (!["ready", "blocked", "empty", "error", "missing"].includes(text(group.status).toLowerCase())) issue(issues, "formal_priority_group_status_invalid_" + key, group.status);
      if (!Array.isArray(group.top40Symbols)) issue(issues, "formal_priority_group_top40_symbols_missing_" + key, "top40Symbols must be an array");
      if (number(group.top40SymbolCount) !== (Array.isArray(group.top40Symbols) ? group.top40Symbols.length : -1)) issue(issues, "formal_priority_group_count_mismatch_" + key, String(group.top40SymbolCount) + " != " + String(Array.isArray(group.top40Symbols) ? group.top40Symbols.length : "missing"));
      const status = text(group.status).toLowerCase();
      if (status === "ready") {
        for (const field of ["runId", "scanDate", "finishedAt", "qualityStatus"]) if (!text(group[field])) issue(issues, "formal_priority_ready_evidence_missing_" + key, field);
      }
      if (["blocked", "error", "missing"].includes(status) && !text(group.reason)) issue(issues, "formal_priority_nonready_reason_missing_" + key, status);
    }
  }
  const result = {
    ok: issues.length === 0,
    mode: "runtime-readonly",
    checkedAt: new Date().toISOString(),
    file,
    formalPriorityStrategyChip: artifact || null,
    issues,
  };
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = issues.length ? 1 : 0;
}

main();
