"use strict";

const { serverSupabaseKey, serverSupabaseUrl } = require("../lib/server-supabase-key");
const ACTIVE_PROTECTED_TABLES = new Set([
  "fugle_daytrade_source_scorecard",
  "fugle_daytrade_source_speed_scorecard",
  "fugle_daytrade_gate_scorecard",
]);
const RETIRED_OBSERVATION_TABLES = new Set(["fugle_source_coverage"]);
function headers() { const key = serverSupabaseKey(); if (!key) throw new Error("missing Supabase service role key"); return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }; }
async function main() {
  const response = await fetch(`${serverSupabaseUrl().replace(/\/$/, "")}/rest/v1/rpc/fuman_source_observability_retention_status`, { method: "POST", headers: headers(), body: JSON.stringify({ p_keep_days: 15 }), signal: AbortSignal.timeout(60000) });
  const text = await response.text(); if (!response.ok) throw new Error(`status HTTP ${response.status}: ${text.slice(0, 280)}`);
  const status = JSON.parse(text);
  const tables = status.tables || [];
  const old = tables.filter((row) => row.hasOldRows).map((row) => row.table);
  const missingProtected = tables.filter((row) => ACTIVE_PROTECTED_TABLES.has(row.table) && !row.hasProtectedRows).map((row) => row.table);
  const retiredObservedTables = tables.filter((row) => RETIRED_OBSERVATION_TABLES.has(row.table)).map((row) => ({ table: row.table, hasProtectedRows: row.hasProtectedRows === true, latestTradeDate: row.latestTradeDate || null }));
  const missingDefinitions = [...ACTIVE_PROTECTED_TABLES].filter((table) => !tables.some((row) => row.table === table));
  const missing = [...missingProtected, ...missingDefinitions];
  const payload = {
    ok: status.ok === true && old.length === 0 && missing.length === 0,
    contract: "source-observability-retention-15d-v2",
    status,
    activeProtectedTables: [...ACTIVE_PROTECTED_TABLES],
    retiredObservedTables,
    oldTables: old,
    missingProtectedTables: missing,
    reasonCode: old.length ? "source_observability_retention_draining" : (missing.length ? "source_observability_protected_window_missing" : "ok"),
  };
  console.log(JSON.stringify(payload, null, 2)); if (!payload.ok) process.exitCode = 1;
}
main().catch((error) => { console.error(JSON.stringify({ ok: false, error: error.message }, null, 2)); process.exitCode = 1; });
