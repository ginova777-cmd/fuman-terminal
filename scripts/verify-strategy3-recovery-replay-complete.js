"use strict";

const fs = require("fs");
const path = require("path");
const { terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const tradeDate = process.argv.find((arg) => arg.startsWith("--trade-date="))?.slice(13)
  || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
const compact = tradeDate.replace(/\D/g, "");
const runnerPath = path.join(RUNTIME_DIR, "data", "scan-receipts", `strategy3-v2-recovery-replay-${compact}.json`);
const surfacePath = path.join(RUNTIME_DIR, "data", "scan-receipts", `strategy3-v2-three-surface-recovery-replay-${compact}.json`);
const bridgeReceiptPath = path.join(RUNTIME_DIR, "data", "scan-receipts", `strategy3-mother-pool-warmup-authority-${compact}.json`);
const receiptPath = path.join(RUNTIME_DIR, "data", "scan-receipts", `strategy3-v2-recovery-closure-${compact}.json`);

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }
function add(failed, condition, code) { if (!condition) failed.push(code); }

async function rest(url, key, table, params) {
  const target = new URL(`${url}/rest/v1/${table}`);
  for (const [name, value] of Object.entries(params)) target.searchParams.set(name, String(value));
  const response = await fetch(target, { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" }, signal: AbortSignal.timeout(30000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`${table}_http_${response.status}:${text.slice(0, 180)}`);
  return JSON.parse(text || "[]");
}

async function main() {
  const runner = readJson(runnerPath);
  const surface = readJson(surfacePath);
  const bridge = readJson(bridgeReceiptPath);
  const failed = [];
  add(failed, runner?.ok === true && runner?.status === "RECOVERY_REPLAY_COMPLETE", "runner_not_recovery_complete");
  add(failed, runner?.apply === true && runner?.supabase_apply?.ok === true, "runner_database_apply_not_complete");
  add(failed, runner?.contract === "strategy3-v2-clean-chain-v1", "runner_contract_mismatch");
  add(failed, runner?.contract_version === "4.1.0" && runner?.source_contract_version === "4.1.0", "mother_pool_contract_mismatch");
  add(failed, runner?.trade_date === tradeDate, "runner_trade_date_mismatch");
  add(failed, runner?.canonical_run_id === `fugle_daytrade_source:${compact}:canonical`, "canonical_run_id_mismatch");
  add(failed, Number(runner?.scanner_summary?.mother_pool_coverage_ratio || 0) >= 0.9, "mother_pool_1m_coverage_below_090");
  add(failed, runner?.scanner_summary?.technical_trend_gate?.required === true, "technical_trend_gate_missing");
  add(failed, Number(runner?.scanner_summary?.technical_trend_gate?.source_gap_count || 0) === 0, "technical_trend_source_gap");
  add(failed, runner?.scanner_summary?.atr_rvol_gate?.required === true, "atr_rvol_gate_missing");
  add(failed, String(runner?.scanner_summary?.atr_rvol_gate?.rule || "").includes("minimum_two_comparable_sessions"), "atr_rvol_minimum_history_policy_mismatch");
  add(failed, Array.isArray(runner?.results) && runner.results.every((row) => row?.atr_rvol_confirmation?.ok === true), "result_missing_atr_rvol_confirmation");
  const surfaceTab = surface?.summary?.tabs?.strategy3 || {};
  add(failed, surface?.ok === true && Array.isArray(surface?.issues) && surface.issues.length === 0, "three_surface_verifier_not_complete");
  add(failed, surfaceTab?.api?.runId === runner?.run_id && Number(surfaceTab?.api?.count || 0) === Number(runner?.result_count || 0), "canonical_api_run_or_count_mismatch");
  add(failed, surfaceTab?.terminal?.runId === runner?.run_id && Number(surfaceTab?.terminal?.count || 0) === Number(runner?.result_count || 0), "desktop_terminal_run_or_count_mismatch");
  add(failed, surfaceTab?.mobileFragment?.runId === runner?.run_id && Number(surfaceTab?.mobileFragment?.count || 0) === Number(runner?.result_count || 0), "mobile_fragment_run_or_count_mismatch");
  add(failed, bridge?.complete === true && bridge?.authority_run_id === runner?.run_id && Number(bridge?.authority_result_count || 0) === Number(runner?.result_count || 0), "mother_pool_bridge_receipt_mismatch");
  add(failed, Array.isArray(runner?.failed_checks) && runner.failed_checks.length === 0, "runner_failed_checks_not_empty");
  const url = terminalSupabaseUrl({ runtimeDir: RUNTIME_DIR });
  const key = terminalSupabaseKey({ runtimeDir: RUNTIME_DIR });
  let runRows = [];
  let resultRows = [];
  if (!url || !key) failed.push("supabase_credentials_missing");
  else if (runner?.run_id) {
    try {
      [runRows, resultRows] = await Promise.all([
        rest(url, key, "strategy3_v2_scan_runs", { select: "run_id,trade_date,status,complete,publish_allowed,finished_at,coverage", run_id: `eq.${runner.run_id}`, limit: 1 }),
        rest(url, key, "strategy3_v2_scan_results", { select: "run_id,trade_date,code,complete,quality_status", run_id: `eq.${runner.run_id}`, limit: 1200 }),
      ]);
    } catch (error) { failed.push(`supabase_readback_failed:${String(error?.message || error)}`); }
  }
  const run = runRows[0] || null;
  add(failed, run?.run_id === runner?.run_id && run?.trade_date === tradeDate, "database_run_identity_mismatch");
  add(failed, run?.status === "complete" && run?.complete === true && run?.publish_allowed === true, "database_run_not_complete");
  add(failed, resultRows.length === Number(runner?.result_count || 0), "database_result_count_mismatch");
  add(failed, resultRows.every((row) => row.run_id === runner.run_id && row.trade_date === tradeDate && row.complete === true), "database_result_identity_mismatch");
  const payload = {
    ok: failed.length === 0,
    status: failed.length === 0 ? "complete" : "failed",
    complete: failed.length === 0,
    contract: "strategy3-v2-recovery-runner-verifier-receipt-v1",
    trade_date: tradeDate,
    run_id: runner?.run_id || "",
    canonical_run_id: runner?.canonical_run_id || "",
    runner_status: runner?.runner_status || "",
    runner_complete: runner?.ok === true,
    verifier_ok: failed.length === 0,
    receipt_written: true,
    mother_pool_rows: runner?.mother_pool_rows || 0,
    accepted_symbol_count: runner?.scanner_summary?.ready_20_candle_symbols || 0,
    coverage_ratio: runner?.scanner_summary?.mother_pool_coverage_ratio || 0,
    result_count: runner?.result_count || 0,
    zero_result_complete: Number(runner?.result_count || 0) === 0,
    database_readback: { run_rows: runRows.length, result_rows: resultRows.length },
    three_surface_readback: {
      api: surfaceTab?.api || null,
      desktop_terminal: surfaceTab?.terminal || null,
      mobile_fragment: surfaceTab?.mobileFragment || null,
    },
    mother_pool_bridge: bridge ? { complete: bridge.complete, run_id: bridge.authority_run_id, result_count: bridge.authority_result_count } : null,
    failed_checks: failed,
    first_blocker: failed[0] || null,
    runner_receipt: runnerPath,
    three_surface_receipt: surfacePath,
    mother_pool_bridge_receipt: bridgeReceiptPath,
  };
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify({ ...payload, receipt_path: receiptPath }, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ...payload, receipt_path: receiptPath }, null, 2));
  process.exitCode = payload.ok ? 0 : 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, status: "failed", complete: false, first_blocker: String(error?.message || error) }, null, 2));
  process.exitCode = 1;
});
