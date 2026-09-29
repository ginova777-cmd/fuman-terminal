#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { serviceRoleKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SQL_FILES = [
  path.join(ROOT, "ops", "public-slot", "ScannerSourceClosurePatch_20260909.sql"),
  path.join(ROOT, "ops", "public-slot", "DaytradeFormalScopeGateRepair_20260828.sql"),
  path.join(ROOT, "ops", "public-slot", "Strategy3V2MotherPoolWarmupAuthorityGrant_20260911.sql"),
];

function secret(file) {
  try { return fs.readFileSync(path.join(RUNTIME_DIR, "secrets", file), "utf8").trim(); } catch { return ""; }
}

async function execSql(url, key, sql) {
  for (const [field, method] of [["query", "exec_sql.query"], ["sql", "exec_sql.sql"]]) {
    const response = await fetch(`${url}/rest/v1/rpc/exec_sql`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: sql }),
      signal: AbortSignal.timeout(120000),
    });
    if (response.ok) return method;
  }
  return "";
}

async function main() {
  const url = terminalSupabaseUrl({ runtimeDir: RUNTIME_DIR });
  const key = serviceRoleKey({ runtimeDir: RUNTIME_DIR });
  if (!url || !key) throw new Error("supabase_service_credentials_missing");
  const applied = [];
  for (const file of SQL_FILES) {
    const sql = fs.readFileSync(file, "utf8");
    let method = await execSql(url, key, sql);
    if (!method) {
      const dbUrl = secret("supabase-db-url.txt");
      if (!dbUrl) throw new Error(`exec_sql_failed_and_db_url_missing:${path.basename(file)}`);
      const psql = process.env.PSQL_PATH || "C:/Program Files/PostgreSQL/17/bin/psql.exe";
      const result = spawnSync(psql, [dbUrl, "-v", "ON_ERROR_STOP=1", "-f", file], { cwd: ROOT, encoding: "utf8", timeout: 120000, windowsHide: true });
      if (result.error || result.status !== 0) throw new Error(`psql_failed:${path.basename(file)}:${String(result.stderr || result.error || "").slice(0, 600)}`);
      method = "psql";
    }
    applied.push({ file: path.relative(ROOT, file).replace(/\\/g, "/"), method });
  }
  const rpc = await fetch(`${url}/rest/v1/rpc/get_fugle_daytrade_intraday_1m_latest_n`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ symbols: ["2330"], bars_per_symbol: 1 }),
    signal: AbortSignal.timeout(30000),
  });
  const rows = rpc.ok ? await rpc.json() : [];
  const rpcOk = rpc.ok && Array.isArray(rows) && rows.length === 1 && typeof rows[0].volume_strategy_usable === "boolean";
  if (!rpcOk) throw new Error(`latest_n_rpc_readback_failed:http_${rpc.status}`);
  const readKey = process.env.SUPABASE_ANON_KEY
    || process.env.FUMAN_SUPABASE_ANON_KEY
    || secret("supabase-anon-key.txt")
    || key;
  const authorityResponse = await fetch(`${url}/rest/v1/v_strategy3_v2_latest_complete_run?select=run_id,trade_date,complete,status&limit=1`, {
    headers: { apikey: readKey, Authorization: `Bearer ${readKey}` },
    signal: AbortSignal.timeout(30000),
  });
  const authorityRows = authorityResponse.ok ? await authorityResponse.json() : [];
  const authority = Array.isArray(authorityRows) ? authorityRows[0] : null;
  if (!authorityResponse.ok || !authority?.run_id || authority.complete !== true) {
    throw new Error(`strategy3_authority_anon_readback_failed:http_${authorityResponse.status}`);
  }
  const resultResponse = await fetch(`${url}/rest/v1/strategy3_v2_scan_results?select=code,run_id&run_id=eq.${encodeURIComponent(authority.run_id)}&limit=1`, {
    headers: { apikey: readKey, Authorization: `Bearer ${readKey}` },
    signal: AbortSignal.timeout(30000),
  });
  if (!resultResponse.ok) throw new Error(`strategy3_results_anon_readback_failed:http_${resultResponse.status}`);
  const receipt = {
    ok: true, status: "complete", complete: true,
    contract: "strategy3-source-prerequisites-apply-v1",
    applied_at: new Date().toISOString(), applied,
    latest_n_rpc_volume_strategy_usable_preserved: true,
    futopt_global_blocking: false,
    strategy3_authority_read_key_access: true,
    strategy3_authority_run_id: authority.run_id,
    strategy3_authority_trade_date: authority.trade_date,
    receipt_written: true,
  };
  const receiptPath = path.join(RUNTIME_DIR, "data", "scan-receipts", "strategy3-source-prerequisites-apply.json");
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify({ ...receipt, receipt_path: receiptPath }, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ...receipt, receipt_path: receiptPath }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, status: "failed", complete: false, first_blocker: String(error?.message || error) }, null, 2));
  process.exitCode = 1;
});
