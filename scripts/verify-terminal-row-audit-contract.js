"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const mobile = read("api/mobile-fragment.js");
const collector = read("scripts/collect-terminal-scorecard-88.js");
const verifier = read("scripts/verify-terminal-row-audit-consistency.js");
const failed = [];
const requireMarkers = (file, text, markers) => {
  for (const marker of markers) if (!text.includes(marker)) failed.push(`${file}:missing:${marker}`);
};

requireMarkers("api/mobile-fragment.js", mobile, ["data-row-symbol", "data-row-price", "data-row-score", "data-row-rank"]);
requireMarkers("scripts/collect-terminal-scorecard-88.js", collector, [
  "callInternalApi", "rowAuditSignatures", "rowAuditSignatureComplete", "canonical_${key}_api_readonly",
  "strategy2", "strategy3", "strategy4", "strategy5", "institution",
  "row_audit_run_id_mismatch", "row_audit_count_mismatch", "row_audit_fields_incomplete",
]);
requireMarkers("scripts/verify-terminal-row-audit-consistency.js", verifier, [
  "terminal-four-surface-row-audit-v1", "canonical_api_row_count_matches_result_count",
  "desktop_rows_match_canonical", "mobile_rows_match_canonical", "scorecard88_rows_match_canonical",
  "source_reports_rows_match_canonical", "page88_canonical_scorecard_hook_present", "strategyRunStarted: false",
]);
if (/Start-ScheduledTask|schtasks\s+\/Run|run-strategy|complete-scan/i.test(verifier)) failed.push("row_audit_verifier_must_not_start_strategy");

const report = {
  ok: failed.length === 0,
  contract: "terminal-four-surface-row-audit-contract-v1",
  readOnly: true,
  strategies: ["strategy2", "strategy3", "strategy4", "strategy5", "institution"],
  fields: ["runId", "tradeDate", "resultCount", "symbol", "price", "score", "rank"],
  failed_checks: failed,
  first_blocker: failed[0] || null,
};
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);
