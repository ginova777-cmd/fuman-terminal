"use strict";

const fs = require("fs");
const { spawnSync } = require("child_process");
const path = require("path");

const runtime = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const sqlFile = path.join(__dirname, "..", "ops", "public-slot", "DaytradeMotherPoolViewTimeoutRepair_20260826.sql");
const connectionFile = path.join(runtime, "secrets", "supabase-db-url.txt");
const psql = process.env.PSQL_PATH || "C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe";

try {
  const connection = fs.readFileSync(connectionFile, "utf8").trim();
  const result = spawnSync(psql, [connection, "-v", "ON_ERROR_STOP=1", "-f", sqlFile], {
    encoding: "utf8",
    timeout: 120000,
    windowsHide: true
  });
  if (result.error || result.status !== 0) {
    throw new Error(String(result.stderr || result.error || "psql failed").slice(0, 1200));
  }
  console.log(JSON.stringify({
    ok: true,
    contract: "daytrade_mother_pool_view_timeout_repair_v1",
    sql_file: sqlFile,
    additive_indexes: true,
    removed_unused_source_status_join: true,
    result: String(result.stdout || "").trim()
  }, null, 2));
} catch (error) {
  console.error("[apply-daytrade-mother-pool-view-timeout-repair] " + (error && error.message ? error.message : String(error)));
  process.exitCode = 1;
}
