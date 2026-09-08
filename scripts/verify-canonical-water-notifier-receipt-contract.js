"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fuman-water-receipt-"));
process.env.FUMAN_RUNTIME_DIR = runtimeRoot;
process.env.FUMAN_STATE_DIR = path.join(runtimeRoot, "state");
process.env.FUMAN_DATA_DIR = path.join(runtimeRoot, "data");
process.env.FUMAN_CACHE_DIR = path.join(runtimeRoot, "cache");
process.env.TELEGRAM_BOT_TOKEN = "contract-test-token";
process.env.TELEGRAM_CHAT_ID = "contract-test-target";

const { notifyFromOutbox } = require("./notify-daytrade-intraday-burst-telegram");
const { canonicalRunId, taipeiDate } = require("../lib/daytrade-canonical-water-reader");

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
}

async function main() {
  const tradeDate = taipeiDate();
  const runId = canonicalRunId(tradeDate);
  writeJson(path.join(runtimeRoot, "state", "daytrade-intraday-burst-telegram-outbox.json"), {
    contract: "daytrade_intraday_burst_telegram_outbox_v1",
    source: "fugle_formal_1m",
    alert_scope: "daytrade_mother_pool_only_0900_1230_with_same_day_fugle_1m_coverage_and_industry_heatmap",
    trade_date: tradeDate,
    run_id: runId,
    canonical_run_id: runId,
    industry_heatmap_status: "ready",
    industry_heatmap: [{ industry: "測試產業", flow_rank: 1 }],
    events: [],
  });
  const waterReceipt = {
    contract: "daytrade_canonical_water_reader_v1",
    checked_at: new Date().toISOString(),
    trade_date: tradeDate,
    canonical_run_id: runId,
    source_name: "fugle_daytrade_source",
    reader_policy: "supabase_read_only_no_writer_no_fugle_fallback",
    credential_role: "anon_or_authenticated_reader",
    writes_supabase: false,
    mother_pool_capacity_is_hard_gate: false,
    mother_pool_read_rows: 1,
    quote_fresh_coverage_120s: 1,
    source_status_at_run: { grade: "A", status: "ready", updated_at: new Date().toISOString() },
    canonical_gate_at_run: { grade: "A", status: "ready" },
    unattended_gate_at_run: { grade: "A", status: "ready" },
    latest_quote_time: new Date().toISOString(),
    latest_1m_time: new Date().toISOString(),
    data_gap_count: 0,
    event_evidence: [],
    sources: {
      source_status: "source_status",
      canonical_gate: "v_fugle_daytrade_canonical_gate",
      unattended_gate: "v_fugle_daytrade_unattended_gate_status",
      mother_pool: "v_fugle_daytrade_mother_pool",
      quote: "fugle_daytrade_quotes_live",
      intraday_1m_rpc: "get_fugle_daytrade_intraday_1m_latest_n",
    },
    failed_checks: [],
    first_blocker: null,
    status: "complete",
    complete: true,
  };
  const canonicalWaterResult = {
    ok: true,
    firstBlocker: null,
    failedChecks: [],
    receipt: waterReceipt,
    evidenceBySymbol: new Map(),
  };
  const result = await notifyFromOutbox({ tradeDate, canonicalWaterResult, tradingWindowOverride: true });
  const receiptFile = path.join(runtimeRoot, "data", "scan-receipts", `daytrade-intraday-burst-telegram-${tradeDate.replace(/\D/g, "")}.json`);
  const saved = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
  const outsideResult = await notifyFromOutbox({ tradeDate, now: new Date(`${tradeDate}T05:00:00+08:00`) });
  const outsideSaved = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
  const checks = {
    complete_zero_result_is_success: result.ok === true && result.complete === true && result.status === "complete" && result.detected_events === 0,
    canonical_water_receipt_saved: saved?.canonical_water?.contract === "daytrade_canonical_water_reader_v1" && saved?.canonical_water?.complete === true,
    handoff_evidence_saved: saved?.source_name === "fugle_daytrade_source"
      && saved?.canonical_run_id === runId
      && saved?.mother_pool_read_rows === 1
      && saved?.requested_symbols === 1
      && saved?.evaluated_symbols === 0
      && saved?.data_gap_count === 0
      && Array.isArray(saved?.failed_checks)
      && saved.failed_checks.length === 0,
    no_notification_sent_for_zero_events: saved?.sent_event_count === 0 && saved?.last_attempt?.sent_events === 0,
    outside_window_completes_without_live_water_read: outsideResult.ok === true
      && outsideResult.complete === true
      && outsideResult.status === "complete"
      && outsideResult.first_blocker === "outside_trading_window"
      && outsideSaved?.canonical_water === undefined
      && outsideSaved?.last_complete_canonical_water?.contract === "daytrade_canonical_water_reader_v1"
      && outsideSaved?.last_complete_canonical_water?.trade_date === tradeDate
      && outsideSaved?.last_complete_canonical_water?.complete === true
      && outsideSaved?.last_attempt?.sent_events === 0,
  };
  const failedChecks = Object.entries(checks).filter(([, value]) => value !== true).map(([name]) => name);
  console.log(JSON.stringify({ ok: failedChecks.length === 0, contract: "canonical_water_notifier_receipt_verifier_v1", checks, failed_checks: failedChecks, first_blocker: failedChecks[0] || null }, null, 2));
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
  process.exitCode = failedChecks.length ? 1 : 0;
}

main().catch((error) => {
  try { fs.rmSync(runtimeRoot, { recursive: true, force: true }); } catch {}
  console.error(JSON.stringify({ ok: false, first_blocker: "notifier_receipt_contract_exception", error: error?.stack || error?.message || String(error) }, null, 2));
  process.exitCode = 1;
});
