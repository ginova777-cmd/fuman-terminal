"use strict";

const fs = require("fs");
const { spawnSync } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const PROJECT_URL = process.env.SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co";
const SQL_FILE = path.join(ROOT, "ops", "public-slot", "DaytradeCanonicalViewPerformanceIndexes_20260826.sql");

function secret(name) {
  for (const file of [path.join(RUNTIME_DIR, "secrets", name), path.join(ROOT, "secrets", name)]) {
    try {
      const value = fs.readFileSync(file, "utf8").trim();
      if (value) return value;
    } catch {}
  }
  return "";
}

async function callRpc(key, body) {
  const response = await fetch(PROJECT_URL.replace(/\/$/, "") + "/rest/v1/rpc/exec_sql", {
    method: "POST",
    headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout ? AbortSignal.timeout(60000) : undefined
  });
  const text = await response.text();
  if (!response.ok) {
    const error = new Error("exec_sql HTTP " + response.status + ": " + text.slice(0, 800));
    error.status = response.status;
    throw error;
  }
  return text ? JSON.parse(text) : null;
}

function callPsql() {
  const urlPath = path.join(RUNTIME_DIR, "secrets", "supabase-db-url.txt");
  const url = fs.readFileSync(urlPath, "utf8").trim();
  const psql = process.env.PSQL_PATH || "C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe";
  const result = spawnSync(psql, [url, "-v", "ON_ERROR_STOP=1", "-f", SQL_FILE], { encoding: "utf8", timeout: 120000, windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(String(result.stderr || result.error || "psql failed").slice(0, 800));
  return { stdout: result.stdout || "" };
}

async function main() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.FUMAN_SUPABASE_SERVICE_ROLE_KEY || secret("supabase-service-role-key.txt");
  const sql = fs.readFileSync(SQL_FILE, "utf8");
  let method = "exec_sql.query";
  let result;
  try {
    result = await callRpc(key, { query: sql });
  } catch (first) {
    if (key && (first.status === 400 || first.status === 404)) {
      try {
        method = "exec_sql.sql";
        result = await callRpc(key, { sql });
      } catch (second) {
        method = "psql";
        result = callPsql();
      }
    } else {
      method = "psql";
      result = callPsql();
    }
  }
  console.log(JSON.stringify({
    ok: true,
    contract: "daytrade_canonical_view_performance_indexes_v1",
    sql_file: SQL_FILE,
    method,
    additive_only: true,
    result: result || null
  }, null, 2));
}

main().catch((error) => {
  console.error("[apply-daytrade-canonical-view-performance-indexes] " + (error && error.message ? error.message : String(error)));
  process.exitCode = 1;
});
