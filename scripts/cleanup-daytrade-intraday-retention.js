"use strict";

const fs = require("fs");
const path = require("path");
const { serverSupabaseKey, serverSupabaseUrl } = require("../lib/server-supabase-key");

const RUNTIME = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const KEEP_DAYS = 15;
const MAX_BATCH_SIZE = 5000;
const apply = process.argv.includes("--apply");
const json = process.argv.includes("--json");

function numberArg(name, fallback) {
  const prefix = `${name}=`;
  const raw = process.argv.find((value) => value.startsWith(prefix));
  const parsed = Number(raw ? raw.slice(prefix.length) : fallback);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

const requestedMaxBatches = Math.min(Math.max(numberArg("--max-batches", 60), 1), 60);

function dateId() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date()).replaceAll("-", "");
}

function headers() {
  const key = serverSupabaseKey();
  if (!key) throw new Error("missing Supabase service role key");
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" };
}

async function rpc(name, body) {
  const response = await fetch(`${serverSupabaseUrl().replace(/\/$/, "")}/rest/v1/rpc/${name}`, {
    method: "POST", headers: headers(), body: JSON.stringify(body), signal: AbortSignal.timeout(90000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${name} HTTP ${response.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

function assertProtectedWindow(status, phase) {
  if (status?.table !== "fugle_daytrade_intraday_1m") throw new Error(`${phase}: formal table mismatch`);
  if (Number(status?.keepDays) !== KEEP_DAYS) throw new Error(`${phase}: keepDays mismatch`);
  if (!status?.latestTradeDate || Number(status?.protectedRows || 0) <= 0) throw new Error(`${phase}: protected latest trade date missing`);
}

async function main() {
  const before = await rpc("fuman_daytrade_intraday_retention_status", { p_keep_days: KEEP_DAYS });
  assertProtectedWindow(before, "before");

  const batches = [];
  let deletedRows = 0;
  for (let batch = 1; batch <= requestedMaxBatches; batch += 1) {
    const result = await rpc("fuman_cleanup_daytrade_intraday_1m_15d_once", {
      p_apply: apply, p_batch_size: MAX_BATCH_SIZE,
    });
    batches.push(result);
    const deleted = Number(result?.deletedRows || 0);
    deletedRows += deleted;
    if (!apply || result?.hasCandidateRowsBefore === false || result?.remainingCandidateRowsEstimate === 0 || deleted === 0) break;
  }

  const after = await rpc("fuman_daytrade_intraday_retention_status", { p_keep_days: KEEP_DAYS });
  assertProtectedWindow(after, "after");
  const oldRowsRemain = after?.hasOldRows === true;
  const ok = before?.ok === true && after?.ok === true && (!apply || !oldRowsRemain);
  const payload = {
    ok,
    applied: apply,
    dryRun: !apply,
    checkedAt: new Date().toISOString(),
    contract: "daytrade-intraday-retention-15d-v1",
    formalTable: "fugle_daytrade_intraday_1m",
    keepDays: KEEP_DAYS,
    maxBatchSize: MAX_BATCH_SIZE,
    requestedMaxBatches,
    executedBatches: batches.length,
    deletedRows,
    protectedLatestTradeDateRequired: true,
    before,
    batches,
    after,
    reasonCode: ok ? "ok" : (oldRowsRemain ? "old_rows_remaining_after_bounded_cleanup" : "retention_check_failed"),
    allowedAction: ok ? "retention_complete" : "fail_closed_investigate",
  };
  const dir = path.join(RUNTIME, "status");
  fs.mkdirSync(dir, { recursive: true });
  payload.receiptFile = path.join(dir, `daytrade-intraday-retention-${dateId()}.json`);
  fs.writeFileSync(payload.receiptFile, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(json ? JSON.stringify(payload, null, 2) : `${payload.reasonCode}: ${deletedRows}`);
  if (!ok) process.exitCode = 1;
}

main().catch((error) => {
  const dir = path.join(RUNTIME, "status");
  fs.mkdirSync(dir, { recursive: true });
  const payload = {
    ok: false, applied: apply, dryRun: !apply, checkedAt: new Date().toISOString(),
    contract: "daytrade-intraday-retention-15d-v1", formalTable: "fugle_daytrade_intraday_1m",
    keepDays: KEEP_DAYS, maxBatchSize: MAX_BATCH_SIZE, requestedMaxBatches,
    protectedLatestTradeDateRequired: true, reasonCode: "retention_cleanup_failed",
    allowedAction: "fail_closed_investigate", error: error.message,
  };
  payload.receiptFile = path.join(dir, `daytrade-intraday-retention-${dateId()}.json`);
  fs.writeFileSync(payload.receiptFile, `${JSON.stringify(payload, null, 2)}\n`);
  console.error(JSON.stringify(payload, null, 2));
  process.exitCode = 1;
});
