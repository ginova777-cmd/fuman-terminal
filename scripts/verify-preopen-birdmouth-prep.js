"use strict";

const fs = require("fs");
const path = require("path");

function value(name, fallback = "") { const p = `${name}=`; const a = process.argv.find((x) => x === name || x.startsWith(p)); return a === name ? "1" : a ? a.slice(p.length) : fallback; }
function compact(v) { return String(v).replace(/\D/g, "").slice(0, 8); }
function main() {
  const date = value("--date");
  const outputDir = path.resolve(value("--output-dir", path.resolve(__dirname, "..", "outputs")));
  const runnerReceiptPath = path.resolve(value("--receipt", path.join(outputDir, `preopen-birdmouth-prep-receipt-${compact(date)}.json`)));
  const runner = JSON.parse(fs.readFileSync(runnerReceiptPath, "utf8"));
  const required = ["trade_date","started_at","finished_at","mode","preopen_history_source_table","preopen_history_rows","preopen_history_latest_time","preopen_history_trade_date","preopen_snapshot_source_table","preopen_snapshot_rows","preopen_snapshot_latest_time","preopen_snapshot_trade_date","preopen_snapshot_used","futopt_source_table","futopt_rows","futopt_latest_time","futopt_trade_date","quote_source_table","quote_rows","quote_latest_time","quote_trade_date","warmup_1m_source_table","warmup_1m_rows","warmup_1m_latest_time","warmup_1m_cutoff_time","checked_symbols","candidate_symbols","passed_count","datagap_count","failed_count","uses_0900_data","formal_candidate","order_allowed","writes_supabase","calls_fugle","replay_limitation","txt_path","csv_path","json_path"];
  const checks = [
    { name: "runner_contract", ok: runner.contract === "preopen-birdmouth-prep-readonly-v2" },
    { name: "runner_complete", ok: runner.status === "complete" && runner.ok === true },
    ...required.map((key) => ({ name: `field_present:${key}`, ok: Object.prototype.hasOwnProperty.call(runner, key) })),
    { name: "no_0900_data", ok: runner.uses_0900_data === false && (runner.rows || []).every((row) => row.uses_0900_data === false) },
    { name: "no_formal_candidate", ok: runner.formal_candidate === false && (runner.rows || []).every((row) => row.formal_candidate === false) },
    { name: "no_order", ok: runner.order_allowed === false && (runner.rows || []).every((row) => row.order_allowed === false) },
    { name: "txt_exists", ok: Boolean(runner.txt_path) && fs.existsSync(runner.txt_path) },
    { name: "csv_exists", ok: Boolean(runner.csv_path) && fs.existsSync(runner.csv_path) },
    { name: "json_exists", ok: Boolean(runner.json_path) && fs.existsSync(runner.json_path) },
    { name: "full_market_has_checked_symbols", ok: runner.mode !== "full_market" || Number(runner.checked_symbols) > 0 },
    { name: "zero_history_has_limitation", ok: Number(runner.preopen_history_rows) > 0 || ["無完整 08:45-08:59 preopen history replay", "盤後只能 snapshot 回看，不是完整 08:45-08:59 replay"].includes(runner.replay_limitation) },
    { name: "snapshot_flag_consistent", ok: Number(runner.preopen_snapshot_rows) <= 0 || runner.preopen_snapshot_used === true },
  ];
  const failed = checks.filter((check) => !check.ok);
  const receipt = { contract: "preopen-birdmouth-prep-canonical-verifier-v2", ok: failed.length === 0, status: failed.length ? "failed" : "complete", trade_date: runner.trade_date, runner_receipt: runnerReceiptPath, checked_at: new Date().toISOString(), checks, first_blocker: failed[0]?.name || null };
  const receiptPath = path.join(outputDir, `preopen-birdmouth-prep-canonical-verifier-receipt-${compact(runner.trade_date)}.json`);
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ ...receipt, receipt_path: receiptPath }, null, 2));
  process.exit(receipt.ok ? 0 : 1);
}
try { main(); } catch (error) { console.error(JSON.stringify({ ok: false, status: "failed", error: error.message }, null, 2)); process.exit(1); }
