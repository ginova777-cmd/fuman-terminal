"use strict";

const { serverSupabaseKey, serverSupabaseUrl } = require("../lib/server-supabase-key");
function headers() { const key = serverSupabaseKey(); if (!key) throw new Error("missing Supabase service role key"); return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }; }
async function main() {
  const response = await fetch(`${serverSupabaseUrl().replace(/\/$/, "")}/rest/v1/rpc/fuman_source_observability_retention_status`, { method: "POST", headers: headers(), body: JSON.stringify({ p_keep_days: 15 }), signal: AbortSignal.timeout(60000) });
  const text = await response.text(); if (!response.ok) throw new Error(`status HTTP ${response.status}: ${text.slice(0, 280)}`);
  const status = JSON.parse(text); const old = (status.tables || []).filter((row) => row.hasOldRows).map((row) => row.table);
  const missingProtected = (status.tables || []).filter((row) => !row.hasProtectedRows).map((row) => row.table);
  const payload = { ok: status.ok === true && old.length === 0 && missingProtected.length === 0, contract: "source-observability-retention-15d-v1", status, oldTables: old, missingProtectedTables: missingProtected, reasonCode: old.length ? "source_observability_retention_draining" : (missingProtected.length ? "source_observability_protected_window_missing" : "ok") };
  console.log(JSON.stringify(payload, null, 2)); if (!payload.ok) process.exitCode = 1;
}
main().catch((error) => { console.error(JSON.stringify({ ok: false, error: error.message }, null, 2)); process.exitCode = 1; });
