#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SQL_FILE = path.join(ROOT, "ops", "public-slot", "DaytradeQuoteTradeDateContract_20260908.sql");
const URL = String(process.env.SUPABASE_URL || process.env.FUMAN_SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/+$/, "");

function secret(name) {
  for (const file of [path.join(RUNTIME, "secrets", name), path.join(ROOT, "secrets", name)]) {
    try { const value = fs.readFileSync(file, "utf8").trim(); if (value) return value; } catch {}
  }
  return "";
}

async function main() {
  const guard = spawnSync(process.execPath, [path.join(ROOT, "scripts", "supabase-incident-guard.js"), "check", "--class=writer", "--action=apply-daytrade-quote-trade-date-contract"], { cwd: ROOT, stdio: "inherit", windowsHide: true });
  if (guard.status !== 0) throw new Error("supabase_incident_guard_blocked");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || secret("supabase-service-role-key.txt");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
  const sql = fs.readFileSync(SQL_FILE, "utf8");
  let method = "exec_sql.query";
  async function rpc(body) {
    const response = await fetch(`${URL}/rest/v1/rpc/exec_sql`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });
    const responseText = await response.text();
    if (!response.ok) throw new Error(`exec_sql HTTP ${response.status}: ${responseText.slice(0, 600)}`);
  }
  try {
    await rpc({ query: sql });
  } catch (first) {
    try {
      method = "exec_sql.sql";
      await rpc({ sql });
    } catch (second) {
      method = "psql";
      const db = secret("supabase-db-url.txt");
      if (!db) throw second;
      const psql = process.env.PSQL_PATH || "C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe";
      const result = spawnSync(psql, [db, "-v", "ON_ERROR_STOP=1", "-f", SQL_FILE], { encoding: "utf8", timeout: 120000, windowsHide: true });
      if (result.error || result.status !== 0) throw new Error(String(result.stderr || result.error || "psql failed").slice(0, 1000));
    }
  }
  console.log(JSON.stringify({
    ok: true,
    status: "complete",
    contract: "daytrade_quote_trade_date_schema_apply_v1",
    applied_at: new Date().toISOString(),
    sql_file: SQL_FILE,
    method,
    table: "fugle_daytrade_quotes_live",
    column: "trade_date",
    view: "v_fugle_daytrade_quotes_live_v2",
    natural_quote_values_mutated: false,
    existing_trade_dates_derived_from_quote_event: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
