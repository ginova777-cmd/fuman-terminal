"use strict";

const path = require("path");
const { terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");

const ROOT = path.resolve(__dirname, "..");
const SOURCE_NAME = "fugle_daytrade_source";
const APPLY = process.argv.includes("--apply");
const EXPECTED_DATE = (process.argv.find((arg) => arg.startsWith("--trade-date=")) || "").split("=")[1] || taipeiDate();
const MIN_PRIORITY_COVERAGE = Number(process.env.FUMAN_RECOVERY_PRIORITY_COVERAGE || "0.95");
const MAX_QUOTE_AGE_SECONDS = Number(process.env.FUMAN_RECOVERY_QUOTE_AGE_SECONDS || "90");
const MAX_1M_STALE_SECONDS = Number(process.env.FUMAN_RECOVERY_1M_STALE_SECONDS || "120");

function taipeiParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour") || 0), minute: Number(get("minute") || 0), second: Number(get("second") || 0) };
}
function taipeiDate() { return taipeiParts().date; }
function number(value, fallback = 0) { const n = Number(String(value ?? "").replace(/[,%]/g, "")); return Number.isFinite(n) ? n : fallback; }
function bool(value) { return value === true || value === 1 || String(value || "").toLowerCase() === "true"; }
function headers(key) { return { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json", "Content-Type": "application/json" }; }
function sourceConfig(write = false) {
  const runtimeDir = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
  const url = terminalSupabaseUrl({ root: ROOT, runtimeDir }).replace(/\/+$/, "");
  const key = terminalSupabaseKey({ root: ROOT, runtimeDir, write });
  if (!url || !key) throw new Error(write ? "missing_supabase_write_credentials" : "missing_supabase_read_credentials");
  return { url, key };
}
async function restGet(resource, query = "") {
  const { url, key } = sourceConfig(false);
  const response = await fetch(`${url}/rest/v1/${resource}${query ? `?${query}` : ""}`, { headers: headers(key), cache: "no-store", signal: AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined });
  const text = await response.text();
  if (!response.ok) throw new Error(`${resource} HTTP ${response.status}: ${text.slice(0, 240)}`);
  return text ? JSON.parse(text) : [];
}
async function restUpsert(resource, rows, conflict) {
  const { url, key } = sourceConfig(true);
  const response = await fetch(`${url}/rest/v1/${resource}?on_conflict=${encodeURIComponent(conflict)}`, {
    method: "POST",
    headers: { ...headers(key), Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(rows),
    signal: AbortSignal.timeout ? AbortSignal.timeout(12000) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${resource} upsert HTTP ${response.status}: ${text.slice(0, 240)}`);
  return { ok: true, written: rows.length };
}
function formalWindowOpen() {
  const now = taipeiParts();
  const minute = now.hour * 60 + now.minute;
  return now.date === EXPECTED_DATE && minute >= 8 * 60 + 45 && minute <= 13 * 60 + 30;
}
function summarizeSource(row = {}) {
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  return {
    row,
    payload,
    status: String(row.status || payload.status || ""),
    daytradeGateGrade: String(payload.daytrade_gate_grade || payload.gate_grade || "").toUpperCase(),
    gateStatus: String(payload.gate_status || ""),
    formalEntryAllowed: bool(payload.formal_entry_allowed),
    formalEntrySpeedVerdict: String(payload.formal_entry_speed_verdict || "").toUpperCase(),
    priorityFreshQuoteCoverage120s: number(payload.priority_fresh_quote_coverage_120s),
    priorityPoolSymbols: number(payload.priority_pool_symbols),
    quoteAgeSeconds: number(payload.quote_age_seconds, 999999),
    intraday1mStaleSeconds: number(payload.intraday_1m_stale_seconds, 999999),
    dailyVolumeStatus: String(payload.daily_volume_status || "").toLowerCase(),
    scannerCanRunOpening: bool(payload.scanner_can_run_opening),
    websocketFormalReady: bool(payload.websocket_formal_ready),
  };
}
function objectiveReady(source) {
  const failures = [];
  if (!formalWindowOpen()) failures.push("outside_formal_source_window");
  if (source.priorityPoolSymbols <= 0) failures.push("priority_pool_empty");
  if (source.priorityFreshQuoteCoverage120s < MIN_PRIORITY_COVERAGE) failures.push(`priority_coverage_low:${source.priorityFreshQuoteCoverage120s}`);
  if (source.quoteAgeSeconds > MAX_QUOTE_AGE_SECONDS) failures.push(`quote_age_too_old:${source.quoteAgeSeconds}`);
  if (source.intraday1mStaleSeconds > MAX_1M_STALE_SECONDS) failures.push(`intraday_1m_stale:${source.intraday1mStaleSeconds}`);
  if (!["ready", "ok"].includes(source.dailyVolumeStatus)) failures.push(`daily_volume_not_ready:${source.dailyVolumeStatus || "missing"}`);
  if (!source.scannerCanRunOpening) failures.push("scanner_can_run_opening_false");
  if (!source.websocketFormalReady) failures.push("websocket_formal_ready_false");
  return { ok: failures.length === 0, failures };
}
async function main() {
  const [sourceRows, gateRows] = await Promise.all([
    restGet("source_status", `source_name=eq.${encodeURIComponent(SOURCE_NAME)}&select=source_name,status,message,payload,updated_at,trade_date&limit=1`),
    restGet("v_fugle_daytrade_canonical_gate", "select=*&limit=1"),
  ]);
  const source = summarizeSource(sourceRows[0] || {});
  const readiness = objectiveReady(source);
  const currentOk = ["ok", "ready"].includes(source.status) && source.daytradeGateGrade === "A" && source.gateStatus === "ready" && source.formalEntrySpeedVerdict === "YES" && source.formalEntryAllowed;
  const result = { ok: currentOk || readiness.ok, apply: APPLY, expectedDate: EXPECTED_DATE, currentOk, readiness, sourceStatus: { status: source.status, daytradeGateGrade: source.daytradeGateGrade, gateStatus: source.gateStatus, formalEntrySpeedVerdict: source.formalEntrySpeedVerdict, formalEntryAllowed: source.formalEntryAllowed, priorityFreshQuoteCoverage120s: source.priorityFreshQuoteCoverage120s, priorityPoolSymbols: source.priorityPoolSymbols, quoteAgeSeconds: source.quoteAgeSeconds, intraday1mStaleSeconds: source.intraday1mStaleSeconds, dailyVolumeStatus: source.dailyVolumeStatus, scannerCanRunOpening: source.scannerCanRunOpening, websocketFormalReady: source.websocketFormalReady }, canonicalGateBefore: gateRows[0] ? { gateGrade: gateRows[0].canonical_gate_grade || gateRows[0].gate_grade || gateRows[0].gate || "", gateStatus: gateRows[0].canonical_gate_status || gateRows[0].gate_status || gateRows[0].status || "", reason: gateRows[0].reason || "", formalEntrySpeedVerdict: gateRows[0].formal_entry_speed_verdict || "", formalEntryAllowed: gateRows[0].formal_entry_allowed === true } : null };
  if (!currentOk && !readiness.ok) {
    result.verdict = "FAIL_CLOSED_NO_WRITE";
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 1;
    return;
  }
  if (!APPLY || currentOk) {
    result.verdict = currentOk ? "ALREADY_READY" : "DRY_RUN_READY_TO_PROMOTE";
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const now = new Date().toISOString();
  const payload = {
    ...source.payload,
    source_name: SOURCE_NAME,
    daytrade_gate_grade: "A",
    gate_grade: "A",
    gate_status: "ready",
    formal_entry_speed_verdict: "YES",
    formal_entry_allowed: true,
    latest_update_allowed: true,
    preserve_previous_good: false,
    reason_code: "objective_water_recovered_source_status_reconciled",
    recovery_source: "repair-daytrade-source-status-from-objective-water",
    recovery_checked_at: now,
  };
  await restUpsert("source_status", [{ source_name: SOURCE_NAME, trade_date: EXPECTED_DATE, updated_at: now, status: "ok", message: "objective water recovered; source_status reconciled to canonical gate A", stale_seconds: source.quoteAgeSeconds, payload }], "source_name");
  result.verdict = "PROMOTED_SOURCE_STATUS_OK";
  result.written = true;
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error?.message || String(error) }, null, 2));
  process.exitCode = 1;
});
