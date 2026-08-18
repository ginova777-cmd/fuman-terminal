"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(ROOT, "api", "scorecard.js"), "utf8");
const contract = "strategy2-live-v3-fugle-deep-scan-1m";
const api = fs.readFileSync(path.join(ROOT, "api", "strategy2-latest.js"), "utf8");
const generator = fs.readFileSync(path.join(ROOT, "scripts", "generate-terminal-scorecard-source.js"), "utf8");
const ruleLock = fs.readFileSync(path.join(ROOT, "lib", "scorecard-rule-locks.js"), "utf8");
const checks = [
  ["v3_import_contract", source.includes("strategy2_v3_afternoon_scorecard_import_v1")],
  ["v3_formal_source_contract", source.includes(contract)],
  ["v3_run_id_gate", source.includes("/^strategy2-v3-live-/")],
  ["v3_formal_gate", source.includes("isFormalV3")],
  ["scorecard_normalizes_v3_trade_date", source.includes("compactDate(date) === today") && source.includes("&& isToday")],
  ["v3_current_source_report", source.includes("withCurrentStrategy2V3SourceReport")],
  ["scorecard_reads_strict_v3_snapshot", source.includes('readSnapshot("strategy2_live_v3"') && source.includes("allowLatestFallback: false") && source.includes("strategy2_v3_snapshot_unavailable")],
  ["retired_v2_not_used_by_scorecard", !/Strategy2V2|strategy2-live-v2|strategy2_v2/i.test(source)],
  ["api_canonicalizes_formal_authority", api.includes("publishAllowed: replay ? false : true") && api.includes("formalDisplayAllowed: replay ? false : true")],
  ["historical_scorecard_read_is_internal_only", api.includes("function internalScorecardDate") && api.includes("fumanInternalVerify === true")],
  ["historical_scorecard_read_stays_strict_v3", api.includes("allowLatestFallback: false") && api.includes("targetDate.replace")],
  ["generator_passes_explicit_scorecard_date", generator.includes("date: scorecardFallbackDate()")],
  ["generator_has_defined_row_dedupe_key", fs.readFileSync(path.join(ROOT, "scripts", "generate-terminal-scorecard-source.js"), "utf8").includes("const rowKey =")],
  ["generator_has_no_undefined_task", !/arrayKeys: \["rows", "matches", "volumeMatches", "singleSignals"\]/.test(fs.readFileSync(path.join(ROOT, "scripts", "generate-terminal-scorecard-source.js"), "utf8"))],
  ["generator_preserves_symbol_and_name", generator.includes("function codeOf(row, fallback) {\n  return cleanText") && generator.includes("function nameOf(row, code) {\n  return cleanText")],
  ["strategy3_scorecard_time_is_canonical", generator.includes('if (task.key === "strategy3") return "13:00"')],
  ["strategy3_preserves_entry_candle_evidence", generator.includes("entry_candle_time:") && generator.includes("entry_trade_date:")],
  ["strategy3_rule_lock_accepts_formal_tolerance", ruleLock.includes("intraday_1m_entry_window_tolerance") && ruleLock.includes("intraday_1m_tail_volume_confirmed")],
  ["strategy3_canonicalizes_fugle_window_evidence", generator.includes("function strategy3ScorecardEntryEvidence") && generator.includes("fugleFormal") && generator.includes("intraday_1m_1300_exact") && generator.includes("intraday_1m_entry_window_tolerance")],
  ["strategy3_evidence_date_uses_formal_run_date", generator.includes("row._strategy3ScorecardSourceDate || row.scan_date") && generator.includes("payload.scanDate || payload.usedDate || payload.tradeDate")],
];
const issues = checks.filter(([, ok]) => !ok).map(([name]) => name);
console.log(JSON.stringify({
  ok: issues.length === 0,
  verifier: "strategy2-v3-scorecard-contract",
  contract,
  checks: checks.map(([name, ok]) => ({ name, ok })),
  issues,
}, null, 2));
process.exitCode = issues.length ? 1 : 0;
