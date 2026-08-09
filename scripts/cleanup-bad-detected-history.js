#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.FUMAN_SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/+$/, "");
const APPLY = process.argv.includes("--apply");
const TRADE_DATE = process.argv.find((arg) => arg.startsWith("--trade-date="))?.slice("--trade-date=".length) || process.env.FUMAN_CLEANUP_TRADE_DATE || "";
const TABLE = "seven_strategy_daily_history";

function text(value) { return String(value ?? "").trim(); }
function readSecret(name) {
  for (const file of [path.join(RUNTIME_DIR, "secrets", name), path.join(ROOT, "secrets", name)]) {
    try { const value = fs.readFileSync(file, "utf8").trim(); if (value) return value; } catch {}
  }
  return "";
}
function parse(value) {
  if (value && typeof value === "object") return value;
  try { return JSON.parse(value || "{}"); } catch { return {}; }
}
function badReasons(row) {
  const evidence = parse(row.evidence);
  const status = text(evidence.source_status ?? evidence.sourceStatus).toLowerCase();
  const grade = text(evidence.gate_grade ?? evidence.gateGrade ?? evidence.canonical_gate_grade ?? evidence.canonicalGateGrade).toUpperCase();
  const gateStatus = text(evidence.gate_status ?? evidence.gateStatus ?? evidence.canonical_gate_status ?? evidence.canonicalGateStatus).toLowerCase();
  const verdict = text(evidence.formal_entry_speed_verdict ?? evidence.formalEntrySpeedVerdict).toUpperCase();
  const allowed = evidence.formal_entry_allowed ?? evidence.formalEntryAllowed;
  const formalAllowed = allowed === true || /^(true|yes|1)$/i.test(text(allowed));
  const reasons = [];
  if (!["ok", "ready"].includes(status)) reasons.push(`source_status:${status || "missing"}`);
  if (grade !== "A") reasons.push(`gate_grade:${grade || "missing"}`);
  if (gateStatus !== "ready") reasons.push(`gate_status:${gateStatus || "missing"}`);
  if (verdict !== "YES") reasons.push(`formal_entry_speed_verdict:${verdict || "missing"}`);
  if (!formalAllowed) reasons.push("formal_entry_allowed:false");
  return reasons;
}
async function main() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || readSecret("supabase-service-role-key.txt");
  if (APPLY && !TRADE_DATE) throw new Error("apply_requires_trade_date:pass --trade-date=YYYY-MM-DD");
  if (!key) throw new Error("missing_supabase_service_role_key");
  const dateFilter = TRADE_DATE ? `&trade_date=eq.${encodeURIComponent(TRADE_DATE)}` : "";
  const endpoint = `${SUPABASE_URL}/rest/v1/${TABLE}?select=id,trade_date,detect_time,symbol,name,strategy,signal_type,source,evidence,run_id&signal_type=eq.detected${dateFilter}&order=id.asc&limit=5000`;
  const response = await fetch(endpoint, { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json", "Cache-Control": "no-store" }, signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined });
  const raw = await response.text();
  if (!response.ok) throw new Error(`history_read_failed:${response.status}:${raw.slice(0, 240)}`);
  const rows = (raw ? JSON.parse(raw) : []).map((row) => ({ ...row, badReasons: badReasons(row) })).filter((row) => row.badReasons.length);
  const result = { ok: true, mode: APPLY ? "apply" : "dry_run", table: TABLE, tradeDate: TRADE_DATE || "all", candidates: rows.length, rows: rows.map(({ evidence, ...row }) => row) };
  if (APPLY && rows.length) {
    const deleted = [];
    for (const row of rows) {
      const del = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?id=eq.${encodeURIComponent(row.id)}`, { method: "DELETE", headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: "return=minimal" }, signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined });
      if (!del.ok) throw new Error(`history_delete_failed:${row.id}:${del.status}:${(await del.text()).slice(0, 180)}`);
      deleted.push(row.id);
    }
    result.deleted = deleted.length;
  } else result.deleted = 0;
  console.log(JSON.stringify(result, null, 2));
}
main().catch((error) => { console.error(JSON.stringify({ ok: false, error: error.message || String(error) }, null, 2)); process.exitCode = 2; });
