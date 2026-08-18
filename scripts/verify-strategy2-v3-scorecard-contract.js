"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(ROOT, "api", "scorecard.js"), "utf8");
const contract = "strategy2-live-v3-fugle-deep-scan-1m";
const api = fs.readFileSync(path.join(ROOT, "api", "strategy2-latest.js"), "utf8");
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
