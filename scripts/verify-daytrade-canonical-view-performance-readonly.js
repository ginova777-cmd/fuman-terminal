"use strict";

const fs = require("fs");
const { spawnSync } = require("child_process");
const path = require("path");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const connectionFile = path.join(RUNTIME_DIR, "secrets", "supabase-db-url.txt");
const psql = process.env.PSQL_PATH || "C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe";
const requiredIndexes = [
  "source_status_source_name_updated_at_idx",
  "fugle_daytrade_quotes_live_symbol_updated_at_idx",
  "fugle_daytrade_quotes_live_quote_seen_at_idx",
  "fugle_daytrade_intraday_1m_symbol_candle_time_idx",
  "fugle_daytrade_futopt_quotes_live_updated_at_idx"
];

function runSql(sql) {
  const connection = fs.readFileSync(connectionFile, "utf8").trim();
  const result = spawnSync(psql, [connection, "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", sql], {
    encoding: "utf8",
    timeout: 30000,
    windowsHide: true
  });
  if (result.error || result.status !== 0) {
    throw new Error(String(result.stderr || result.error || "psql read failed").trim().slice(0, 1200));
  }
  return String(result.stdout || "").trim();
}

try {
  if (!fs.existsSync(connectionFile)) throw new Error("missing_supabase_db_url");
  const indexRows = runSql(
    "select indexname from pg_indexes where schemaname = 'public' and indexname in (" +
    requiredIndexes.map((name) => "'" + name + "'").join(",") + ") order by indexname;"
  ).split(/\r?\n/).filter(Boolean);

  const probes = {};
  for (const [name, sql] of Object.entries({
    canonical_gate: "set statement_timeout = '12s'; select count(*) from public.v_fugle_daytrade_canonical_gate;",
    mother_pool: "set statement_timeout = '12s'; select count(*) from public.v_fugle_daytrade_mother_pool;"
  })) {
    const started = Date.now();
    try {
      probes[name] = { ok: true, elapsed_ms: Date.now() - started, result: runSql(sql).split(/\r?\n/).pop() || "" };
    } catch (error) {
      probes[name] = { ok: false, elapsed_ms: Date.now() - started, error: error.message };
    }
  }

  const missing_indexes = requiredIndexes.filter((name) => !indexRows.includes(name));
  const failed_checks = [
    ...missing_indexes.map((name) => "missing_index:" + name),
    ...Object.entries(probes).filter(([, value]) => !value.ok).map(([name]) => "probe_timeout_or_error:" + name)
  ];
  const output = {
    ok: failed_checks.length === 0,
    contract: "daytrade_canonical_view_performance_readonly_v1",
    checked_at: new Date().toISOString(),
    required_indexes: requiredIndexes,
    present_indexes: indexRows,
    probes,
    failed_checks,
    first_blocker: failed_checks[0] || null,
    read_only: true
  };
  console.log(JSON.stringify(output, null, 2));
  process.exitCode = output.ok ? 0 : 1;
} catch (error) {
  console.log(JSON.stringify({
    ok: false,
    contract: "daytrade_canonical_view_performance_readonly_v1",
    checked_at: new Date().toISOString(),
    failed_checks: ["verifier_runtime_error"],
    first_blocker: "verifier_runtime_error",
    error: error.message,
    read_only: true
  }, null, 2));
  process.exitCode = 1;
}
