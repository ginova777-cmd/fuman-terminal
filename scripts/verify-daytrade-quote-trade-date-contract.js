#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { canonicalRunId, taipeiDateFrom } = require("../lib/daytrade-side-volume-contract");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = String(process.env.SUPABASE_URL || process.env.FUMAN_SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/+$/, "");
const CONTRACT = "daytrade_quote_trade_date_canonical_verifier_v1";
const VERSION = "daytrade-quotes-live-trade-date-v1";
const STATIC_ONLY = process.argv.includes("--static-only");
const WRITE_RECEIPT = process.argv.includes("--write-receipt");

function read(file) { try { return fs.readFileSync(file, "utf8"); } catch { return ""; } }
function secret(name) {
  return read(path.join(RUNTIME, "secrets", name)).trim() || read(path.join(ROOT, "secrets", name)).trim();
}
function tradeDate() { return taipeiDateFrom(new Date()); }

function staticCheck() {
  const sql = read(path.join(ROOT, "ops", "public-slot", "DaytradeQuoteTradeDateContract_20260908.sql"));
  const writer = read(path.join(ROOT, "scripts", "run-daytrade-source-writer.js"));
  const reader = read(path.join(ROOT, "lib", "daytrade-canonical-water-reader.js"));
  const checks = {
    table_trade_date_column: sql.includes("add column if not exists trade_date date"),
    event_time_backfill: sql.includes("coalesce(last_trade_time, quote_seen_at, updated_at)"),
    indexed_trade_date: sql.includes("idx_fugle_daytrade_quotes_live_trade_date_symbol_seen"),
    anon_versioned_view: sql.includes("v_fugle_daytrade_quotes_live_v2") && sql.includes("grant select"),
    version_marker: sql.includes(VERSION),
    writer_derives_trade_date: writer.includes("quoteTradeDateForWrite") && writer.includes("trade_date: quoteTradeDateForWrite(quote)"),
    rest_writer_sets_trade_date: writer.includes("trade_date: taipeiDateFrom(lastTradeTime || quoteTime)"),
    reader_filters_explicit_trade_date: reader.includes("trade_date: `eq.${tradeDate}`") && reader.includes("symbol,trade_date,name,market"),
  };
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  return { ok: failed.length === 0, contract: CONTRACT, contract_version: VERSION, checks, failed_checks: failed, first_blocker: failed[0] || null };
}

async function liveCheck() {
  const fixed = staticCheck();
  const expectedDate = tradeDate();
  const key = process.env.SUPABASE_ANON_KEY || process.env.FUMAN_SUPABASE_ANON_KEY || secret("supabase-anon-key.txt");
  const failed = [...fixed.failed_checks];
  let httpStatus = 0;
  let tableHttpStatus = 0;
  let rows = [];
  if (!key) failed.push("SUPABASE_ANON_KEY_MISSING");
  else {
    const query = new URL(`${SUPABASE_URL}/rest/v1/v_fugle_daytrade_quotes_live_v2`);
    query.searchParams.set("select", "symbol,trade_date,quote_event_at,canonical_run_id,contract_version,quote_trade_date_match");
    query.searchParams.set("trade_date", `eq.${expectedDate}`);
    query.searchParams.set("order", "quote_event_at.desc");
    query.searchParams.set("limit", "1000");
    const response = await fetch(query, { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000) });
    httpStatus = response.status;
    if (!response.ok) failed.push(`ANON_READ_HTTP_${response.status}:${(await response.text()).slice(0, 240)}`);
    else rows = await response.json();

    const tableQuery = new URL(`${SUPABASE_URL}/rest/v1/fugle_daytrade_quotes_live`);
    tableQuery.searchParams.set("select", "symbol,trade_date,quote_seen_at,last_trade_time,updated_at");
    tableQuery.searchParams.set("trade_date", `eq.${expectedDate}`);
    tableQuery.searchParams.set("limit", "1");
    const tableResponse = await fetch(tableQuery, { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000) });
    tableHttpStatus = tableResponse.status;
    if (!tableResponse.ok) failed.push(`DIRECT_TABLE_TRADE_DATE_READ_HTTP_${tableResponse.status}:${(await tableResponse.text()).slice(0, 240)}`);
  }
  const expectedRunId = canonicalRunId(expectedDate);
  const dateMismatchRows = rows.filter((row) => row.trade_date !== expectedDate).length;
  const runMismatchRows = rows.filter((row) => row.canonical_run_id !== expectedRunId).length;
  const contractMismatchRows = rows.filter((row) => row.contract_version !== VERSION).length;
  const eventMismatchRows = rows.filter((row) => row.quote_trade_date_match !== true).length;
  if (!rows.length) failed.push("NATURAL_SAME_DAY_QUOTE_ROWS_MISSING");
  if (dateMismatchRows) failed.push("QUOTE_TRADE_DATE_MISMATCH");
  if (runMismatchRows) failed.push("QUOTE_CANONICAL_RUN_MISMATCH");
  if (contractMismatchRows) failed.push("QUOTE_CONTRACT_VERSION_MISMATCH");
  if (eventMismatchRows) failed.push("QUOTE_EVENT_DATE_MISMATCH");
  const unique = [...new Set(failed)];
  const receipt = {
    contract: CONTRACT,
    contract_version: VERSION,
    status: unique.length ? "partial" : "complete",
    complete: unique.length === 0,
    exitCode: unique.length ? 1 : 0,
    trade_date: expectedDate,
    canonical_run_id: expectedRunId,
    checked_at: new Date().toISOString(),
    credential_role: "anon_read_only",
    source_table: "fugle_daytrade_quotes_live",
    readback_view: "v_fugle_daytrade_quotes_live_v2",
    http_status: httpStatus,
    direct_table_http_status: tableHttpStatus,
    rows: rows.length,
    date_mismatch_rows: dateMismatchRows,
    run_mismatch_rows: runMismatchRows,
    contract_mismatch_rows: contractMismatchRows,
    event_mismatch_rows: eventMismatchRows,
    failed_checks: unique,
    first_blocker: unique[0] || null,
    writes_supabase: false,
  };
  if (WRITE_RECEIPT) {
    const directory = path.join(RUNTIME, "data", "scan-receipts");
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, "daytrade-quote-trade-date-canonical-receipt-latest.json");
    fs.writeFileSync(file, JSON.stringify({ ...receipt, receipt_path: file }, null, 2) + "\n", "utf8");
    receipt.receipt_path = file;
  }
  return receipt;
}

if (STATIC_ONLY) {
  const result = staticCheck();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} else {
  liveCheck().then((result) => {
    console.log(JSON.stringify(result, null, 2));
    if (!result.complete) process.exitCode = 1;
  }).catch((error) => {
    console.error(JSON.stringify({ contract: CONTRACT, status: "failed", complete: false, exitCode: 1, error: error.message || String(error) }, null, 2));
    process.exitCode = 1;
  });
}
