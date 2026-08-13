"use strict";

const fs = require("fs");
const path = require("path");
const { terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SOURCE_FILE = process.env.FUMAN_SCORECARD_TERMINAL_SOURCE || path.join(RUNTIME_DIR, "data", "scorecard-terminal-current.json");
const SUPABASE_URL = terminalSupabaseUrl({ root: ROOT, runtimeDir: RUNTIME_DIR }).replace(/\/+$/, "");
const SUPABASE_KEY = terminalSupabaseKey({ root: ROOT, runtimeDir: RUNTIME_DIR });
const VALID_ENTRY_SOURCES = new Set(["intraday_1m_1300", "intraday_1m_1300_exact", "intraday_1m_entry_window_tolerance", "intraday_1m_tail_volume_confirmed"]);

function taipeiDate() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = (kind) => parts.find((part) => part.type === kind)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}
function dateOf(value) { const match = String(value || "").match(/\d{4}-\d{2}-\d{2}/); return match ? match[0] : ""; }
function number(value) { const parsed = Number(String(value ?? "").replace(/[,％%+]/g, "").trim()); return Number.isFinite(parsed) ? parsed : 0; }

async function latestRun() {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("missing_supabase_credentials");
  const select = encodeURIComponent("run_id,scan_date,status,complete,result_count,expected_total,scanned_count");
  const response = await fetch(`${SUPABASE_URL}/rest/v1/v_strategy3_latest_complete_run?select=${select}&limit=1`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Accept: "application/json" }, cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`latest_run_http_${response.status}:${text.slice(0, 180)}`);
  return JSON.parse(text || "[]")[0] || {};
}

async function main() {
  const expectedDate = taipeiDate();
  const source = JSON.parse(fs.readFileSync(SOURCE_FILE, "utf8"));
  const run = await latestRun();
  const report = (source.sourceReports || []).find((row) => row?.key === "strategy3") || {};
  const records = (source.records || []).filter((row) => row?.strategy === "策略3隔日沖成績單");
  const issues = [];
  if (dateOf(source.latestDate) !== expectedDate) issues.push(`scorecard_latest_date_not_today:${source.latestDate || "missing"}`);
  if (run.complete !== true || run.status !== "complete") issues.push(`strategy3_run_not_complete:${run.status || "missing"}`);
  if (dateOf(run.scan_date) !== expectedDate) issues.push(`strategy3_run_date_not_today:${run.scan_date || "missing"}`);
  if (report.ok !== true) issues.push("strategy3_scorecard_report_not_ok");
  if (dateOf(report.date) !== expectedDate || dateOf(report.expectedDisplayDate) !== expectedDate) issues.push(`strategy3_scorecard_report_date_mismatch:${report.date || "missing"}`);
  if (report.runId !== run.run_id) issues.push(`strategy3_scorecard_report_runId_mismatch:${report.runId || "missing"}`);
  if (number(report.count) !== number(run.result_count) || number(report.emittedRows) !== number(run.result_count)) issues.push(`strategy3_scorecard_report_count_mismatch:${report.emittedRows}/${report.count}/${run.result_count}`);
  if (number(report.suppressedRows) !== 0) issues.push(`strategy3_scorecard_suppressed_rows:${report.suppressedRows}`);
  if (report.publishAllowed !== true || String(report.evidenceStatus || "").toLowerCase() !== "complete") issues.push("strategy3_scorecard_report_not_publishable");
  if (records.length !== number(run.result_count)) issues.push(`strategy3_scorecard_record_count_mismatch:${records.length}/${run.result_count}`);
  const seen = new Set();
  for (const row of records) {
    const code = String(row.ticker || "");
    if (!/^\d{4}$/.test(code)) issues.push(`strategy3_scorecard_invalid_code:${code || "missing"}`);
    if (seen.has(code)) issues.push(`strategy3_scorecard_duplicate_code:${code}`);
    seen.add(code);
    if (dateOf(row.record_date) !== expectedDate || dateOf(row.source_date) !== expectedDate) issues.push(`strategy3_scorecard_record_date_mismatch:${code}`);
    if (!(number(row.entry_price) > 0)) issues.push(`strategy3_scorecard_entry_price_missing:${code}`);
    if (!VALID_ENTRY_SOURCES.has(String(row.entry_price_source || ""))) issues.push(`strategy3_scorecard_entry_source_invalid:${code}:${row.entry_price_source || "missing"}`);
  }
  console.log(JSON.stringify({ ok: issues.length === 0, verifier: "verify-strategy3-scorecard-source", contract: "strategy3-water-scan-desktop-mobile-scorecard-v2", checkedAt: new Date().toISOString(), expectedDate, sourceFile: SOURCE_FILE, runId: run.run_id || "", scanDate: run.scan_date || "", count: number(run.result_count), scorecard: { latestDate: source.latestDate || "", runId: report.runId || "", count: number(report.count), emittedRows: number(report.emittedRows), records: records.length, tailVolumeRows: records.filter((row) => row.entry_price_source === "intraday_1m_tail_volume_confirmed").length }, issues }, null, 2));
  process.exitCode = issues.length ? 1 : 0;
}
main().catch((error) => { console.error(JSON.stringify({ ok: false, verifier: "verify-strategy3-scorecard-source", error: error.message || String(error) }, null, 2)); process.exitCode = 1; });