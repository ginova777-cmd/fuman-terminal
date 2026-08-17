"use strict";

const fs = require("fs");
const path = require("path");
const {
  ROOT,
  CONTRACT_VERSION,
  RESULTS_TABLE,
  RUNS_TABLE,
  LATEST_VIEW,
} = require("./strategy3-v2-contract");

const schemaPath = path.join(ROOT, "ops", "public-slot", "Strategy3V2CleanChainSchema_20260817.sql");
const issues = [];

function add(condition, code, details = {}) {
  if (!condition) issues.push({ code, ...details });
}

function main() {
  const exists = fs.existsSync(schemaPath);
  const sql = exists ? fs.readFileSync(schemaPath, "utf8") : "";

  add(exists, "strategy3_v2_schema_file_missing", { schemaPath });
  add(sql.includes(CONTRACT_VERSION), "strategy3_v2_schema_contract_version_missing");
  add(new RegExp(`create\\s+table\\s+if\\s+not\\s+exists\\s+public\\.${RUNS_TABLE}`, "i").test(sql), "strategy3_v2_runs_table_ddl_missing");
  add(new RegExp(`create\\s+table\\s+if\\s+not\\s+exists\\s+public\\.${RESULTS_TABLE}`, "i").test(sql), "strategy3_v2_results_table_ddl_missing");
  add(new RegExp(`create\\s+or\\s+replace\\s+view\\s+public\\.${LATEST_VIEW}`, "i").test(sql), "strategy3_v2_latest_view_ddl_missing");

  for (const column of [
    "run_id",
    "trade_date",
    "status",
    "complete",
    "formal_allowed",
    "publish_allowed",
    "line_allowed",
    "source_chain",
    "readiness",
    "coverage",
    "issues",
    "entry_price",
    "entry_price_source",
    "entry_window_start",
    "entry_window_end",
    "change_percent",
    "volume_ratio",
    "score",
    "quality_status",
  ]) {
    add(new RegExp(`\\b${column}\\b`, "i").test(sql), "strategy3_v2_schema_required_column_missing", { column });
  }

  add(!/\bstrategy3_scan_results\b/i.test(sql), "strategy3_v2_schema_mentions_legacy_results_table");
  add(!/\bstrategy3_scan_runs\b/i.test(sql), "strategy3_v2_schema_mentions_legacy_runs_table");
  add(!/strategy2-v2-production-release-20260814|Documents[\\/]+Codex[\\/]+strategy2-v2/i.test(sql), "strategy3_v2_schema_mentions_legacy_workspace");

  const payload = {
    ok: issues.length === 0,
    status: issues.length === 0 ? "STRATEGY3_V2_SCHEMA_CONTRACT_READY" : "STRATEGY3_V2_SCHEMA_CONTRACT_NOT_READY",
    contract: CONTRACT_VERSION,
    schemaPath,
    tables: {
      runs: RUNS_TABLE,
      results: RESULTS_TABLE,
      latestView: LATEST_VIEW,
    },
    issues,
  };

  console.log(JSON.stringify(payload, null, 2));
  process.exitCode = payload.ok ? 0 : 1;
}

main();