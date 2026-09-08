#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SQL_FILE = path.join(ROOT, "ops", "public-slot", "DaytradeStarSideVolumeVerificationReceipts_20260908.sql");
const URL = String(process.env.SUPABASE_URL || process.env.FUMAN_SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/+$/, "");

function secret(name) {
  for (const file of [path.join(RUNTIME, "secrets", name), path.join(ROOT, "secrets", name)]) {
    try { const value = fs.readFileSync(file, "utf8").trim(); if (value) return value; } catch {}
  }
  return "";
}

async function anonReadback(view, select) {
  const anonKey = process.env.SUPABASE_ANON_KEY
    || process.env.FUMAN_SUPABASE_ANON_KEY
    || secret("supabase-anon-key.txt");
  if (!anonKey) throw new Error("SUPABASE_ANON_KEY is required for post-apply schema readback");
  const query = new URLSearchParams({ select, limit: "1" });
  const response = await fetch(`${URL}/rest/v1/${view}?${query}`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    signal: AbortSignal.timeout(30000),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`anon schema readback ${view} HTTP ${response.status}: ${body.slice(0, 600)}`);
  let rows;
  try { rows = JSON.parse(body); } catch { throw new Error(`anon schema readback ${view} returned invalid JSON`); }
  if (!Array.isArray(rows)) throw new Error(`anon schema readback ${view} did not return an array`);
  return { view, ok: true, row_count: rows.length };
}

async function main() {
  const guard = spawnSync(process.execPath, [path.join(ROOT, "scripts", "supabase-incident-guard.js"), "check", "--class=writer", "--action=apply-daytrade-star-side-volume-receipts"], { cwd: ROOT, stdio: "inherit", windowsHide: true });
  if (guard.status !== 0) throw new Error("supabase_incident_guard_blocked");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || secret("supabase-service-role-key.txt");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
  const sql = fs.readFileSync(SQL_FILE, "utf8");
  let method = "exec_sql.query";
  async function rpc(body) {
    const response = await fetch(`${URL}/rest/v1/rpc/exec_sql`, { method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
    const text = await response.text();
    if (!response.ok) throw new Error(`exec_sql HTTP ${response.status}: ${text.slice(0, 600)}`);
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
  const schemaReadback = await Promise.all([
    anonReadback(
      "v_fugle_daytrade_side_volume_verification_readback",
      "verification_run_id,symbol_result_rows,mother_pool_rows,diagnostic_extra_rows,ready_rows,below_threshold_rows,data_gap_rows,blocked_common_rows,symbol_result_view",
    ),
    anonReadback(
      "v_fugle_daytrade_side_volume_symbol_readback",
      "verification_run_id,verified_at,threshold_status,source_event_age_seconds_at_verification,source_fresh_120s_at_verification",
    ),
  ]);
  console.log(JSON.stringify({ ok: true, status: "complete", contract: "star_side_volume_receipt_schema_apply_v2", applied_at: new Date().toISOString(), sql_file: SQL_FILE, method, views: ["v_fugle_daytrade_side_volume_verification_readback", "v_fugle_daytrade_side_volume_symbol_readback"], schema_readback: schemaReadback, natural_evidence_mutated: false }, null, 2));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
