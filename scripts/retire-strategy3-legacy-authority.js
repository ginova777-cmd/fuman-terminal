"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SQL_FILE = path.join(ROOT, "ops", "public-slot", "Strategy3LegacyAuthorityRetirement_20260908.sql");
const RECEIPT_FILE = path.join(RUNTIME_DIR, "data", "scan-receipts", "strategy3-v2-legacy-retirement-20260908.json");
const PROJECT_URL = String(process.env.SUPABASE_URL || readSecret("supabase-url.txt")).replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || readSecret("supabase-service-role-key.txt");
const APPLY = process.argv.includes("--apply");
const NO_WRITE = process.argv.includes("--no-write");
const RETIRED_RELATIONS = Object.freeze([
  "v_strategy3_latest_complete_run",
  "v_strategy3_quote_ready",
  "v_strategy3_quote_ready_health",
  "v_strategy3_quote_ready_snapshot",
  "v_strategy3_quote_ready_heavy_20260626",
  "v_strategy3_source_speed_profile",
  "v_strategy3_source_gate",
  "v_strategy3_intraday_1m_status",
  "strategy3_intraday_1m_status_latest",
  "strategy3_scan_results",
  "strategy3_scan_runs",
]);
const EMPTY_COMPATIBILITY_TABLES = Object.freeze(["strategy3_ready_snapshot"]);

function readSecret(name) {
  for (const file of [path.join(RUNTIME_DIR, "secrets", name), path.join(ROOT, "secrets", name)]) {
    try {
      const value = fs.readFileSync(file, "utf8").trim();
      if (value) return value;
    } catch {}
  }
  return "";
}

function headers(extra = {}) {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    Accept: "application/json",
    ...extra,
  };
}

async function relationStatus(relation) {
  const response = await fetch(`${PROJECT_URL}/rest/v1/${relation}?select=*&limit=1`, {
    cache: "no-store",
    headers: headers(),
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.text();
  return {
    relation,
    exists: response.ok,
    status: response.status,
    missing: response.status === 404,
    empty: response.ok && /^\s*\[\s*\]\s*$/.test(body),
  };
}

async function inspectRelations() {
  return Promise.all(RETIRED_RELATIONS.map(relationStatus));
}

async function executeSql(sql) {
  let firstError = null;
  for (const body of [{ query: sql }, { sql }]) {
    const response = await fetch(`${PROJECT_URL}/rest/v1/rpc/exec_sql`, {
      method: "POST",
      headers: headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90000),
    });
    const text = await response.text();
    if (response.ok) return { method: Object.keys(body)[0], response: text ? JSON.parse(text) : null };
    const error = new Error(`exec_sql HTTP ${response.status}: ${text.slice(0, 800)}`);
    if (![400, 404].includes(response.status)) throw error;
    firstError ||= error;
  }
  const connection = readSecret("supabase-db-url.txt");
  const psql = process.env.PSQL_PATH || "C:/Program Files/PostgreSQL/17/bin/psql.exe";
  if (!connection || !fs.existsSync(psql)) throw firstError || new Error("exec_sql failed and psql unavailable");
  const result = spawnSync(psql, [connection, "-v", "ON_ERROR_STOP=1", "-f", SQL_FILE], {
    encoding: "utf8",
    timeout: 120000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`psql failed: ${String(result.stderr || result.error || "unknown error").slice(0, 1200)}`);
  }
  return { method: "psql", response: String(result.stdout || "").trim() };
}

function writeReceipt(payload) {
  fs.mkdirSync(path.dirname(RECEIPT_FILE), { recursive: true });
  fs.writeFileSync(RECEIPT_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function main() {
  if (!PROJECT_URL || !SERVICE_KEY) throw new Error("missing Supabase URL or service_role key");
  const before = await inspectRelations();
  const compatibilityBefore = await Promise.all(EMPTY_COMPATIBILITY_TABLES.map(relationStatus));
  let applyResult = null;
  if (APPLY) {
    applyResult = await executeSql(fs.readFileSync(SQL_FILE, "utf8"));
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  const after = await inspectRelations();
  const compatibilityAfter = await Promise.all(EMPTY_COMPATIBILITY_TABLES.map(relationStatus));
  const issues = [
    ...after.filter((item) => item.exists || !item.missing).map((item) => `${item.relation}:http_${item.status}`),
    ...compatibilityAfter.filter((item) => !item.exists || !item.empty).map((item) => `${item.relation}:not_empty`),
  ];
  const receipt = {
    ok: issues.length === 0,
    status: issues.length ? "FAILED" : "COMPLETE",
    complete: issues.length === 0,
    contract: "strategy3-v2-legacy-authority-retirement-v1",
    checked_at: new Date().toISOString(),
    apply: APPLY,
    sql_file: SQL_FILE,
    receipt_path: RECEIPT_FILE,
    preserved: ["strategy3_v2_scan_runs", "strategy3_v2_scan_results", "v_strategy3_v2_latest_complete_run", "terminal_scorecard_*"],
    retired: RETIRED_RELATIONS,
    empty_compatibility_tables: EMPTY_COMPATIBILITY_TABLES,
    before,
    after,
    compatibility_before: compatibilityBefore,
    compatibility_after: compatibilityAfter,
    method: applyResult?.method || "verify_only",
    issues,
  };
  if (!NO_WRITE) writeReceipt(receipt);
  console.log(JSON.stringify(receipt, null, 2));
  if (!receipt.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[retire-strategy3-legacy-authority] ${error?.message || String(error)}`);
  process.exitCode = 1;
});
