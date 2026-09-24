"use strict";

const fs = require("fs");
const path = require("path");
const { terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const tradeDate = process.argv.find((arg) => arg.startsWith("--trade-date="))?.slice(13)
  || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());

async function get(url, key, table, params) {
  const target = new URL(`${url}/rest/v1/${table}`);
  for (const [name, value] of Object.entries(params)) target.searchParams.set(name, String(value));
  const response = await fetch(target, { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" }, signal: AbortSignal.timeout(30000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`${table}_http_${response.status}:${text.slice(0, 180)}`);
  return JSON.parse(text || "[]");
}

async function main() {
  const url = terminalSupabaseUrl({ runtimeDir: RUNTIME_DIR });
  const key = terminalSupabaseKey({ runtimeDir: RUNTIME_DIR });
  if (!url || !key) throw new Error("supabase_credentials_missing");
  const runs = await get(url, key, "v_strategy3_v2_latest_complete_run", { select: "run_id,trade_date,status,complete,publish_allowed,finished_at", limit: 1 });
  const run = runs[0] || null;
  const results = run ? await get(url, key, "strategy3_v2_scan_results", { select: "code,run_id,trade_date,complete,quality_status", run_id: `eq.${run.run_id}`, order: "rank.asc", limit: 1200 }) : [];
  const writer = fs.readFileSync(path.join(ROOT, "scripts", "run-daytrade-source-writer.js"), "utf8");
  const bridgePath = path.join(RUNTIME_DIR, "cache", "intraday", "fugle-strategy-chip-priority-bridge.json");
  const bridge = JSON.parse(fs.readFileSync(bridgePath, "utf8"));
  const strategy3Bridge = bridge?.groups?.strategy3 || {};
  const checks = {
    latest_complete_run_exists: Boolean(run?.run_id),
    latest_run_is_complete_authority: run?.status === "complete" && run?.complete === true && run?.publish_allowed === true,
    results_match_run_identity: results.every((row) => row.run_id === run?.run_id && row.trade_date === run?.trade_date && row.complete === true),
    writer_reads_database_authority: writer.includes('latestResource: "v_strategy3_v2_latest_complete_run"') && writer.includes('resultsResource: "strategy3_v2_scan_results"'),
    writer_authority_read_bypasses_result_rls: writer.includes('supabaseGet(source.resultsResource, query, { service: true })'),
    writer_does_not_require_protected_frontend_api: !writer.includes('source.key === "strategy3"') && !writer.includes('protected_canonical_api:/api/strategy3-latest'),
    zero_result_complete_is_accepted: writer.includes('allowZeroComplete: true') && writer.includes('symbols.length || source.allowZeroComplete === true ? "ready" : "empty"'),
    actual_writer_bridge_is_ready: strategy3Bridge.status === "ready" && !strategy3Bridge.error,
    actual_writer_bridge_matches_authority: strategy3Bridge.runId === run?.run_id && Number(strategy3Bridge.resultRows || 0) === results.length,
    actual_writer_bridge_matches_today: bridge.tradeDate === tradeDate,
    actual_writer_bridge_uses_today_canonical_run: bridge.canonicalRunId === `fugle_daytrade_source:${tradeDate.replace(/\D/g, "")}:canonical`,
    actual_writer_bridge_accepts_healthy_zero_result: results.length === 0
      ? strategy3Bridge.resultRows === 0 && strategy3Bridge.symbolCount === 0
      : Number(strategy3Bridge.symbolCount || 0) === results.length,
  };
  const failed = Object.entries(checks).filter(([, ok]) => ok !== true).map(([name]) => name);
  const payload = {
    ok: failed.length === 0, status: failed.length ? "failed" : "complete", complete: failed.length === 0,
    contract: "strategy3-mother-pool-warmup-db-authority-v1", checked_at: new Date().toISOString(),
    requested_trade_date: tradeDate, authority_run_id: run?.run_id || "", authority_trade_date: run?.trade_date || "",
    authority_result_count: results.length, source_flag: "source_strategy3", frontend_api_dependency: false,
    writer_bridge_updated_at: bridge.updatedAt || "", writer_bridge_status: strategy3Bridge.status || "",
    writer_bridge_canonical_run_id: bridge.canonicalRunId || "", writer_bridge_result_count: strategy3Bridge.resultRows ?? null,
    checks, failed_checks: failed, first_blocker: failed[0] || null, receipt_written: true,
  };
  const receiptPath = path.join(RUNTIME_DIR, "data", "scan-receipts", `strategy3-mother-pool-warmup-authority-${tradeDate.replace(/\D/g, "")}.json`);
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify({ ...payload, receipt_path: receiptPath }, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ...payload, receipt_path: receiptPath }, null, 2));
  process.exitCode = payload.ok ? 0 : 1;
}

main().catch((error) => { console.error(JSON.stringify({ ok: false, complete: false, first_blocker: String(error?.message || error) }, null, 2)); process.exitCode = 1; });
