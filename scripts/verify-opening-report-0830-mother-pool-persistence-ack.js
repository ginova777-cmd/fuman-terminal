#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const REPORT_DIR = path.join(RUNTIME, "data", "opening-report-0830");
const RECEIPT_DIR = path.join(RUNTIME, "data", "scan-receipts");
const WRITER_STATE = path.join(RUNTIME, "state", "daytrade-mother-pool-delta.json");
const HANDOFF_SCRIPT = path.join(__dirname, "verify-opening-report-0830-mother-pool-handoff-ack.js");
const CONTRACT = "opening-report-0830-mother-pool-persistence-ack-v1";

function arg(name, fallback = "") {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function compact(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function observeWriterRefreshes(afterTime, required, timeoutMs) {
  const seen = new Set();
  const started = Date.now();
  while (Date.now() - started <= timeoutMs && seen.size < required) {
    const state = readJson(WRITER_STATE);
    const updatedAt = String(state?.updated_at || state?.updatedAt || "");
    const updatedMs = Date.parse(updatedAt);
    if (updatedAt && Number.isFinite(updatedMs) && updatedMs > afterTime) seen.add(updatedAt);
    if (seen.size < required) await sleep(5000);
  }
  return [...seen].sort();
}

function runReadback(tradeDate, reportRunId, bridgeAggregate, output) {
  const result = spawnSync(process.execPath, [
    HANDOFF_SCRIPT,
    `--trade-date=${tradeDate}`,
    `--report-run-id=${reportRunId}`,
    `--bridge-aggregate=${bridgeAggregate}`,
    `--output=${output}`,
  ], { cwd: ROOT, encoding: "utf8", windowsHide: true });
  return { exitCode: result.status, receipt: readJson(output), stderr: String(result.stderr || "").trim() };
}

async function main() {
  if (process.argv.includes("--fixture")) {
    console.log(JSON.stringify({ ok: true, complete: true, contract: `${CONTRACT}-fixture`, writer_refreshes_observed: 2, required_writer_refreshes: 2, db_readback_ok: true, writes_supabase: false, sends_line: false }, null, 2));
    return;
  }
  const tradeDate = arg("trade-date");
  const ymd = compact(tradeDate);
  const reportRunId = arg("report-run-id");
  const requiredRefreshes = Math.max(2, Number(arg("required-writer-refreshes", "2")) || 2);
  const timeoutMs = Math.max(10000, Number(arg("timeout-ms", "900000")) || 900000);
  const handoffPath = path.resolve(arg("handoff-ack", path.join(RECEIPT_DIR, `opening-report-0830-mother-pool-handoff-ack-${ymd}.json`)));
  const bridgeAggregate = path.resolve(arg("bridge-aggregate", path.join(REPORT_DIR, `opening-report-0830-bridge-aggregate-${ymd}.json`)));
  const finalPath = path.resolve(arg("final-receipt", path.join(REPORT_DIR, `opening-report-0830-final-receipt-${ymd}.json`)));
  const output = path.resolve(arg("output", path.join(RECEIPT_DIR, `opening-report-0830-mother-pool-persistence-ack-${ymd}.json`)));
  const readbackOutput = path.join(RECEIPT_DIR, `opening-report-0830-mother-pool-persistence-readback-${ymd}.json`);
  const handoff = readJson(handoffPath);
  const final = readJson(finalPath);
  const handoffTime = Date.parse(String(handoff?.checked_at || ""));
  const refreshes = Number.isFinite(handoffTime) ? await observeWriterRefreshes(handoffTime, requiredRefreshes, timeoutMs) : [];
  const readback = runReadback(tradeDate, reportRunId, bridgeAggregate, readbackOutput);
  const refreshOk = refreshes.length >= requiredRefreshes;
  const readbackOk = readback.exitCode === 0 && readback.receipt?.complete === true && readback.receipt?.db_readback_ok === true;
  const sameRun = handoff?.report_run_id === reportRunId && readback.receipt?.report_run_id === reportRunId;
  const complete = handoff?.complete === true && refreshOk && readbackOk && sameRun;
  const firstBlocker = complete ? null
    : handoff?.complete !== true ? "mother_pool_handoff_ack_not_complete"
    : !refreshOk ? `mother_pool_writer_refreshes_below_${requiredRefreshes}`
    : !sameRun ? "mother_pool_persistence_run_id_mismatch"
    : (readback.receipt?.first_blocker || readback.stderr || "mother_pool_persistence_readback_failed");
  const receipt = {
    contract: CONTRACT,
    status: complete ? "complete" : "failed",
    complete,
    ok: complete,
    trade_date: tradeDate,
    report_run_id: reportRunId,
    handoff_ack_receipt: handoffPath,
    handoff_ack_ok: handoff?.complete === true,
    required_writer_refreshes: requiredRefreshes,
    writer_refreshes_observed: refreshes.length,
    writer_refresh_timestamps: refreshes,
    persistence_readback_receipt: readbackOutput,
    received_symbols: Number(readback.receipt?.received_symbols || handoff?.received_symbols || 0),
    db_readback_symbols: readback.receipt?.db_readback_symbols || [],
    missing_fields: readback.receipt?.missing_fields || [],
    db_readback_ok: readbackOk,
    formal_candidate_count: 0,
    formal_candidate_allowed: false,
    forbidden_publish_guard: true,
    first_blocker: firstBlocker,
    exitCode: complete ? 0 : 1,
    credential_role: "anon_read_only",
    checked_at: new Date().toISOString(),
    receipt_path: output,
  };
  writeJson(output, receipt);
  if (final) {
    const finalComplete = final.runner_complete === true && complete;
    Object.assign(final, {
      contract: "opening_report_0830_complete_v1",
      mother_pool_persistence_ack_receipt: output,
      mother_pool_persistence_ack: receipt,
      mother_pool_persistence_ack_ok: complete,
      complete: false,
      status: finalComplete ? "waiting_canonical_verifier" : "failed",
      report_status: finalComplete ? "WAITING_CANONICAL_VERIFIER" : "FAIL_CLOSED",
      exitCode: finalComplete ? 0 : 1,
      first_blocker: finalComplete ? "canonical_verifier_pending" : firstBlocker,
      checked_at: new Date().toISOString(),
    });
    writeJson(finalPath, final);
  }
  console.log(JSON.stringify(receipt, null, 2));
  if (!complete) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
