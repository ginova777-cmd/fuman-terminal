"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = terminalSupabaseUrl({ root: ROOT, runtimeDir: RUNTIME_DIR }).replace(/\/+$/, "");
const SUPABASE_KEY = terminalSupabaseKey({ root: ROOT, runtimeDir: RUNTIME_DIR });
const RESULTS_TABLE = process.env.STRATEGY4_SUPABASE_RESULTS_TABLE || "strategy4_scan_results";
const RUNS_TABLE = process.env.STRATEGY4_SUPABASE_RUNS_TABLE || "strategy4_scan_runs";
const OUT_DIR = path.join(RUNTIME_DIR, "data", "scan-receipts");
const DISPLAY_LIMIT = Math.max(1, Number(process.env.STRATEGY4_CANONICAL_DISPLAY_LIMIT || 70));

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,%%+]/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}
function normalizeCode(value) { return String(value || "").replace(/\D/g, "").slice(0, 4); }
function taipeiDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}${get("month")}${get("day")}`;
}
function compactDate(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 8 ? digits.slice(0, 8) : "";
}
function dateFromRunId(runId) { return String(runId || "").match(/strategy4-(\d{8})-/)?.[1] || ""; }
function priceNumber(value) { return Math.round(cleanNumber(value) * 1000) / 1000; }
function pctNumber(value) { return Math.round(cleanNumber(value) * 100) / 100; }
function rowName(row = {}) { return String(row.name || row.displayName || row.rawName || row.code || "").replace(/🔥/g, "").trim(); }
function rowEntry(row = {}) { return priceNumber(row.entryPrice ?? row.entry_price ?? row.mutakiV17?.entryPrice ?? row.payload?.entryPrice ?? row.payload?.mutakiV17?.entryPrice ?? row.price ?? row.close); }
function rowTarget(row = {}) { return priceNumber(row.targetPrice ?? row.target_price ?? row.mutakiV17?.targetPrice ?? row.payload?.targetPrice ?? row.payload?.mutakiV17?.targetPrice ?? row.triangleBreakout?.resistance ?? row.payload?.triangleBreakout?.resistance ?? row.priceTarget); }
function rowStop(row = {}) { return priceNumber(row.stopPrice ?? row.stop_price ?? row.mutakiV17?.stopPrice ?? row.payload?.stopPrice ?? row.payload?.mutakiV17?.stopPrice); }
function rowPrice(row = {}) { return priceNumber(row.price ?? row.close ?? row.entryPrice ?? row.payload?.price ?? row.payload?.close); }
function rowScore(row = {}) { return priceNumber(row.score ?? row.swingScore ?? row.payload?.score ?? row.payload?.swingScore); }
function rowPct(row = {}) { return pctNumber(row.changePercent ?? row.percent ?? row.change_percent ?? row.changePct ?? row.payload?.changePercent ?? row.payload?.percent); }
function rowZone(row = {}) { return String(row.zone || row.swingZone || row.zone_label || row.zoneLabel || row.swingZoneLabel || row.payload?.zone || row.payload?.swingZone || row.payload?.zone_label || row.payload?.zoneLabel || row.payload?.swingZoneLabel || "").trim(); }
function canonicalRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row, index) => ({
    rank: cleanNumber(row.rank || index + 1),
    code: normalizeCode(row.code || row.symbol || row.stock_id),
    name: rowName(row),
    price: rowPrice(row),
    entryPrice: rowEntry(row),
    targetPrice: rowTarget(row),
    stopPrice: rowStop(row),
    changePercent: rowPct(row),
    score: rowScore(row),
    zone: rowZone(row),
  })).filter((row) => /^\d{4}$/.test(row.code));
}
function compareRows(label, expected, actual) {
  const issues = [];
  const ec = expected.map((row) => row.code);
  const ac = actual.map((row) => row.code);
  if (ec.join(",") !== ac.join(",")) issues.push(`${label}_symbols_mismatch expected=${ec.join(",")} actual=${ac.join(",")}`);
  const byCode = new Map(actual.map((row) => [row.code, row]));
  for (const row of expected) {
    const other = byCode.get(row.code);
    if (!other) continue;
    for (const field of ["price", "entryPrice", "targetPrice", "stopPrice", "score"]) {
      if (Math.abs(cleanNumber(row[field]) - cleanNumber(other[field])) > 0.001) issues.push(`${label}_${field}_mismatch:${row.code} expected=${row[field]} actual=${other[field]}`);
    }
    if (Math.abs(cleanNumber(row.changePercent) - cleanNumber(other.changePercent)) > 0.01) issues.push(`${label}_changePercent_mismatch:${row.code} expected=${row.changePercent} actual=${other.changePercent}`);
    if (String(row.zone || "") !== String(other.zone || "")) issues.push(`${label}_zone_mismatch:${row.code} expected=${row.zone || "blank"} actual=${other.zone || "blank"}`);
  }
  return issues;
}function compareDisplayedRowsAgainstPublished(label, displayed, published) {
  const issues = [];
  const publishedCodes = published.map((row) => row.code);
  const byCode = new Map(published.map((row, index) => [row.code, { row, index }]));
  let previousIndex = -1;
  for (const row of displayed) {
    const found = byCode.get(row.code);
    if (!found) {
      issues.push(`${label}_code_missing_in_published:${row.code}`);
      continue;
    }
    if (found.index < previousIndex) issues.push(`${label}_order_not_published_subsequence:${row.code}`);
    previousIndex = Math.max(previousIndex, found.index);
    const other = found.row;
    for (const field of ["price", "entryPrice", "targetPrice", "stopPrice", "score"]) {
      if (Math.abs(cleanNumber(row[field]) - cleanNumber(other[field])) > 0.001) issues.push(`${label}_${field}_mismatch:${row.code} expected=${other[field]} actual=${row[field]}`);
    }
    if (Math.abs(cleanNumber(row.changePercent) - cleanNumber(other.changePercent)) > 0.01) issues.push(`${label}_changePercent_mismatch:${row.code} expected=${other.changePercent} actual=${row.changePercent}`);
    if (String(row.zone || "") !== String(other.zone || "")) issues.push(`${label}_zone_mismatch:${row.code} expected=${other.zone || "blank"} actual=${row.zone || "blank"}`);
  }
  if (!displayed.length && publishedCodes.length) issues.push(`${label}_display_empty`);
  return issues;
}
function makeResponse() {
  let statusCode = 200;
  let body = null;
  return { setHeader(){}, getHeader(){}, status(code){ statusCode = code; return this; }, json(payload){ body = payload; return this; }, send(payload){ body = payload; return this; }, end(payload){ if (payload !== undefined) body = payload; return this; }, result(){ return { statusCode, body }; } };
}
async function readApiPayload() {
  const handler = require("../api/strategy4-latest");
  const request = { method: "GET", url: `http://localhost/api/strategy4-latest?canvas=1&compact=1&shell=1&limit=70&live=1&fresh=${Date.now()}`, headers: {}, query: {}, fumanInternalVerify: true };
  const response = makeResponse();
  await handler(request, response);
  const result = response.result();
  if (!result.body || typeof result.body !== "object") throw new Error(`api_no_json_body status=${result.statusCode}`);
  return { ...result.body, httpStatusCode: result.statusCode };
}
async function supabaseRows(pathname) {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("missing_supabase_credentials");
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Accept: "application/json" }, cache: "no-store" });
  const text = await response.text();
  if (!response.ok) throw new Error(`${pathname} HTTP ${response.status} ${text.slice(0, 240)}`.trim());
  return text ? JSON.parse(text) : [];
}
async function readPublishedRun() {
  const selectRun = encodeURIComponent("run_id,scan_date,status,complete,expected_total,scanned_count,result_count,no_data_count,error_count,quality_status,finished_at");
  const runs = await supabaseRows(`${RUNS_TABLE}?select=${selectRun}&strategy=eq.strategy4&status=eq.complete&complete=eq.true&order=finished_at.desc&limit=1`);
  const run = Array.isArray(runs) ? runs[0] : null;
  if (!run?.run_id) throw new Error("strategy4_latest_complete_run_missing");
  const selectRows = encodeURIComponent("run_id,scan_date,code,name,price,change_percent,score,zone,zone_label,rank,price_source,payload");
  const rows = await supabaseRows(`${RESULTS_TABLE}?select=${selectRows}&run_id=eq.${encodeURIComponent(run.run_id)}&strategy=eq.strategy4&order=rank.asc&limit=500`);
  return {
    runId: run.run_id,
    scanDate: run.scan_date,
    status: run.status,
    complete: run.complete === true,
    expectedTotal: cleanNumber(run.expected_total),
    scannedCount: cleanNumber(run.scanned_count),
    count: cleanNumber(run.result_count),
    noDataCount: cleanNumber(run.no_data_count),
    errorCount: cleanNumber(run.error_count),
    qualityStatus: String(run.quality_status || ""),
    rows: canonicalRows(rows.map((row) => ({ ...row, ...(row.payload || {}) }))),
  };
}
function readScanReceipt() {
  try { return JSON.parse(fs.readFileSync(path.join(OUT_DIR, "strategy4.json"), "utf8")); } catch { return {}; }
}
function runLineDryRun() {
  const output = execFileSync(process.execPath, [path.join(ROOT, "scripts", "send-strategy-line-card.js"), "--strategy=strategy4", "--dry-run"], { cwd: ROOT, encoding: "utf8", windowsHide: true, timeout: 60000 });
  const match = output.match(/\{[\s\S]*\}\s*$/);
  const summary = match ? JSON.parse(match[0]) : {};
  const receiptPath = summary.receipt_path || path.join(RUNTIME_DIR, "data", "line-cards", `strategy4-line-card-${taipeiDateKey()}.json`);
  const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  return { summary, receipt, receiptPath };
}
async function main() {
  const expectedDate = compactDate(process.argv.find((arg) => arg.startsWith("--date="))?.slice("--date=".length)) || taipeiDateKey();
  const issues = [];
  const warnings = [];
  const api = await readApiPayload();
  const published = await readPublishedRun();
  const scanReceipt = readScanReceipt();
  const line = runLineDryRun();
  const apiRows = canonicalRows(api.matches || api.rows || []);
  const publishedRows = published.rows;
  const displayRows = publishedRows.slice(0, Math.min(DISPLAY_LIMIT, publishedRows.length));
  const lineRows = canonicalRows(line.receipt.accepted_rows || []);
  const apiRunId = String(api.runId || api.run_id || "");
  const lineRunId = String(line.receipt.runId || line.summary.runId || "");
  const scanRunId = String(scanReceipt.runId || "");
  if (api.httpStatusCode !== 200) issues.push(`api_http_${api.httpStatusCode}`);
  if (api.ok !== true) issues.push(`api_ok_false:${api.blockedReason || api.scanner_block_reason || api.error || ""}`);
  if (!published.complete || published.status !== "complete") issues.push(`published_run_not_complete:${published.status || "missing"}`);
  if (published.qualityStatus !== "complete") issues.push(`published_quality_not_complete:${published.qualityStatus || "missing"}`);
  if (published.expectedTotal <= 1500) issues.push(`published_expected_total_too_low:${published.expectedTotal}`);
  if (published.scannedCount !== published.expectedTotal) issues.push(`published_scanned_not_full:${published.scannedCount}/${published.expectedTotal}`);
  if (published.noDataCount !== 0) warnings.push(`published_no_data_disclosed:${published.noDataCount}`);
  if (published.errorCount !== 0) issues.push(`published_error_not_zero:${published.errorCount}`);
  if (line.receipt.status !== "ready" || line.receipt.ok !== true) issues.push(`line_dry_run_not_ready:${line.receipt.status || "missing"}:${line.receipt.blockedReason || ""}`);
  if (dateFromRunId(published.runId) !== expectedDate) issues.push(`published_date_mismatch:${published.runId}:expected=${expectedDate}`);
  if (!apiRunId || apiRunId !== published.runId) issues.push(`api_runId_mismatch api=${apiRunId || "missing"} published=${published.runId || "missing"}`);
  if (!lineRunId || lineRunId !== published.runId) issues.push(`line_runId_mismatch line=${lineRunId || "missing"} published=${published.runId || "missing"}`);
  if (scanRunId && scanRunId !== published.runId) issues.push(`scan_receipt_runId_mismatch scan=${scanRunId} published=${published.runId}`);
  if (cleanNumber(scanReceipt.matches) && cleanNumber(scanReceipt.matches) !== published.count) issues.push(`scan_receipt_match_count_mismatch scan=${scanReceipt.matches} published=${published.count}`);
  if (apiRows.length !== displayRows.length) issues.push(`api_display_count_mismatch apiRows=${apiRows.length} displayCount=${displayRows.length} publishedCount=${published.count}`);
  if (lineRows.length !== displayRows.length) issues.push(`line_display_count_mismatch lineRows=${lineRows.length} displayCount=${displayRows.length} publishedCount=${published.count}`);
  if (apiRows.length !== lineRows.length) issues.push(`api_line_display_count_mismatch apiRows=${apiRows.length} lineRows=${lineRows.length}`);
  issues.push(...compareDisplayedRowsAgainstPublished("api_vs_published_display", apiRows, publishedRows));
  issues.push(...compareRows("line_vs_api_display", apiRows, lineRows));
  issues.push(...compareDisplayedRowsAgainstPublished("line_vs_published_display", lineRows, publishedRows));
  const missingTargets = publishedRows.filter((row) => row.entryPrice <= 0 || row.targetPrice <= 0 || row.stopPrice <= 0 || row.score <= 0 || !row.zone).map((row) => row.code);
  if (missingTargets.length) issues.push(`published_strategy4_required_display_fields_missing:${missingTargets.join(",")}`);
  const payload = {
    ok: issues.length === 0,
    verifier: "verify-strategy4-canonical-closure",
    checked_at: new Date().toISOString(),
    expectedDate,
    runId: published.runId,
    scanDate: published.scanDate,
    expectedTotal: published.expectedTotal,
    scannedCount: published.scannedCount,
    count: published.count,
    displayLimit: DISPLAY_LIMIT,
    displayCount: displayRows.length,
    api: { runId: apiRunId, count: apiRows.length, ok: api.ok === true, status: api.httpStatusCode },
    published: { runId: published.runId, count: publishedRows.length, status: published.status, complete: published.complete, qualityStatus: published.qualityStatus },
    scanReceipt: { runId: scanRunId, matches: cleanNumber(scanReceipt.matches), complete: scanReceipt.complete === true, qualityStatus: scanReceipt.qualityStatus || "" },
    line: { runId: lineRunId, count: lineRows.length, status: line.receipt.status, dryRun: true, receiptPath: line.receiptPath },
    sample: publishedRows.slice(0, 8).map((row) => ({ rank: row.rank, code: row.code, name: row.name, entryPrice: row.entryPrice, targetPrice: row.targetPrice, stopPrice: row.stopPrice, score: row.score, zone: row.zone })),
    warnings,
    issues,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const latestFile = path.join(OUT_DIR, "strategy4-canonical-closure-latest.json");
  const datedFile = path.join(OUT_DIR, `strategy4-canonical-closure-${expectedDate}.json`);
  fs.writeFileSync(latestFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.writeFileSync(datedFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(payload, null, 2));
  if (issues.length) process.exit(1);
}
main().catch((error) => {
  console.error(JSON.stringify({ ok: false, verifier: "verify-strategy4-canonical-closure", error: error?.message || String(error) }, null, 2));
  process.exit(1);
});


