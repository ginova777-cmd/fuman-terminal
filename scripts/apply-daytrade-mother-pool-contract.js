const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const PROJECT_URL = process.env.SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co";
const SQL_FILE = path.join(ROOT, "ops", "public-slot", "DaytradeMotherPoolContractViews_20260709.sql");

function readSecret(name) {
  for (const file of [
    path.join(RUNTIME_DIR, "secrets", name),
    path.join(ROOT, "secrets", name),
  ]) {
    try {
      if (!fs.existsSync(file)) continue;
      const value = fs.readFileSync(file, "utf8").trim();
      if (value) return value;
    } catch {
      // optional secret
    }
  }
  return "";
}

async function callExecSql(key, body) {
  const response = await fetch(`${PROJECT_URL.replace(/\/$/, "")}/rest/v1/rpc/exec_sql`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout ? AbortSignal.timeout(30000) : undefined,
  });
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`exec_sql HTTP ${response.status}: ${text.slice(0, 500)}`);
    error.status = response.status;
    error.body = text;
    throw error;
  }
  return text ? JSON.parse(text) : null;
}

async function main() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.FUMAN_SUPABASE_SERVICE_ROLE_KEY
    || readSecret("supabase-service-role-key.txt");
  if (!key) throw new Error("missing Supabase service_role key");
  const sql = fs.readFileSync(SQL_FILE, "utf8");
  let result;
  try {
    result = await callExecSql(key, { query: sql });
  } catch (firstError) {
    if (firstError.status !== 400 && firstError.status !== 404) throw firstError;
    result = await callExecSql(key, { sql });
  }
  console.log(JSON.stringify({
    ok: true,
    sqlFile: SQL_FILE,
    views: [
      "v_fugle_daytrade_mother_pool",
      "v_fugle_daytrade_formal_priority_top40",
      "v_fugle_daytrade_mother_pool_contract_health",
    ],
    result: result || null,
  }, null, 2));
}

main().catch((error) => {
  console.error(`[apply-daytrade-mother-pool-contract] ${error.message}`);
  process.exitCode = 1;
});
