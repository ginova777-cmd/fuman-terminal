"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
// Contract markers span lines in several PowerShell/JavaScript sources. Normalize
// Windows checkouts so CRLF cannot turn a valid production marker into a false
// negative when the same commit is verified on a different platform.
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
const sql = read("ops/public-slot/DaytradeStarPreopenReadbackContract_20260908.sql");
const producer = read("scripts/run-daytrade-near-one-source.js");
const verifier = read("scripts/verify-daytrade-futopt-star-readback-readonly.js");
const trialHistoryVerifier = read("scripts/verify-star-preopen-trial-history-contract.js");
const evidenceVerifier = read("scripts/verify-daytrade-futopt-preopen-evidence-readonly.js");
const evidenceWrapper = read("ops/Run-DaytradeFutoptPreopenEvidence.ps1");
const taskInstaller = read("scripts/install-daytrade-futopt-preopen-evidence-tasks.ps1");
const slotSql = read("ops/public-slot/DaytradeStarSlotSymbolReadback_20260908.sql");
const slotVerifier = read("scripts/verify-star-preopen-slot-symbol-contract.js");
const requiredFields = [
  "future_0845_open_price", "future_preopen_high_price", "future_preopen_low_price",
  "future_0859_last_price", "future_change_percent", "relative_to_txf_percent",
  "future_total_volume", "future_open_retest_ok", "future_open_retest_reason",
  "future_open_near_percent", "source_status",
  "future_0845_source_event_at", "future_0859_source_event_at",
  "trial_event_at", "run_id", "generation_id",
];
const checks = {
  required_readback_fields: requiredFields.every((field) => sql.includes(field)),
  exact_0845_open: sql.includes("capture_slot='0845'"),
  natural_slots_only: sql.includes("natural_schedule_evidence is true") && sql.includes("capture_slot between '0845' and '0859'"),
  no_live_price_fallback: !sql.includes("coalesce(l.futopt_last_price"),
  exact_retest_thresholds: sql.includes("future_open_near_percent") && sql.includes("futopt_last_price>=future_open_price*0.995") && sql.includes("futopt_change_percent>=2") && sql.includes("relative_to_txf_percent>=1") && sql.includes("futopt_total_volume>=50"),
  stock_and_future_star_closed: sql.includes("coalesce(future_pattern='開盤回測守住',false) and preopen_ok") && sql.includes("when future_pattern='開盤回測守住' and preopen_ok then 'STAR'"),
  producer_pins_txf_evidence: producer.includes("txf_change_percent: txfChangePercent") && producer.includes("relative_to_txf_percent:"),
  producer_retry_refreshes_incomplete_same_slot: producer.includes('retryRefreshRows')
    && producer.includes('supabaseUpsert(\n      "fugle_daytrade_preopen_futopt_snapshots"')
    && !producer.includes('supabaseInsertIgnore(\n      "fugle_daytrade_preopen_futopt_snapshots"'),
  producer_complete_row_requires_full_identity: producer.includes("row.payload?.reference_price")
    && producer.includes("row.payload?.websocket_quote_seen_at")
    && producer.includes("row.payload?.trial_event_at")
    && producer.includes("row.payload?.generation_id"),
  verifier_fails_closed: verifier.includes("missing_natural_future_window_must_fail_closed") && verifier.includes("future_open_retest_ok"),
  trial_history_verifier_wired: trialHistoryVerifier.includes("star_preopen_trial_history_canonical_verifier_v2")
    && trialHistoryVerifier.includes("v_fugle_preopen_snapshot_history")
    && trialHistoryVerifier.includes("uses_0900_data: false"),
  universe_live_mapping_fallback: sql.includes("live_mapping as")
    && sql.includes("fugle_daytrade_futopt_quotes_live")
    && sql.includes("lm.underlying_symbol"),
  universe_stock_master_name_fallback: sql.includes("stock_mapping as")
    && sql.includes("left join stock_mapping")
    && sql.includes("public.stock_tickers")
    && sql.includes("sm.symbol"),
  four_natural_slots_required: evidenceVerifier.includes('["0845", "0850", "0855", "0859"]')
    && evidenceVerifier.includes("08:45-08:59 Asia/Taipei")
    && evidenceWrapper.includes('[ValidateSet("0845", "0850", "0855", "0859")]'),
  four_slot_tasks_single_wrapper: ["0845", "0850", "0855", "0859"].every((slot) => taskInstaller.includes(`Slot="${slot}"`))
    && taskInstaller.includes("Disable-ScheduledTask")
    && taskInstaller.includes("Fuman Daytrade Near-One Natural Source"),
  slot_receipt_anon_contract: slotSql.includes("v_fugle_daytrade_star_slot_verification_readback")
    && slotSql.includes("v_fugle_daytrade_star_slot_symbol_readback")
    && slotSql.includes("grant select") && slotSql.includes("to anon,authenticated,service_role"),
  slot_symbol_isolation_contract: slotVerifier.includes('status === "partial"')
    && slotVerifier.includes("source_valid_count")
    && slotVerifier.includes("strategy_evaluation_owner")
    && slotVerifier.includes("BLOCKED_COMMON")
    && slotVerifier.includes("bounded_retry_max: 3"),
  slot_symbol_pattern_inputs_v2: slotVerifier.includes('slot-symbol-isolation-v2')
    && ["future_0845_open_price", "future_preopen_high_price", "future_preopen_low_price", "future_preopen_sample_count"].every((field) => slotVerifier.includes(field))
    && ["future_0845_open_price", "future_preopen_high_price", "future_preopen_low_price", "future_preopen_sample_count"].every((field) => slotSql.includes(field)),
  no_fake_recent_one_minute_history: slotSql.includes("recent_1m_three_sample_supported")
    && slotVerifier.includes("recent_one_minute_three_sample_not_fabricated"),
  slot_v2_mode_enum_fail_closed: slotVerifier.includes("FUTURE_PATTERN_EVIDENCE_MODE_INVALID")
    && slotVerifier.includes("RECENT_1M_THREE_SAMPLE_MODE_MUST_BE_FALSE")
    && slotVerifier.includes("natural_slot_snapshots_0845_through_current_slot"),
  slot_verification_run_immutable: slotSql.includes("IMMUTABLE_VERIFICATION_RUN_ALREADY_FINAL")
    && slotSql.includes("IMMUTABLE_VERIFICATION_SYMBOL_RESULT")
    && slotSql.includes("status in ('complete','partial','failed','pending')"),
  wrapper_runs_canonical_slot_verifier: evidenceWrapper.includes("verify-star-preopen-slot-symbol-contract.js")
    && evidenceWrapper.includes("--publish")
    && evidenceWrapper.includes("v_fugle_daytrade_star_slot_symbol_readback"),
};
const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key);
console.log(JSON.stringify({ ok: failed.length === 0, contract: "daytrade-futopt-star-open-retest-v2", checks, failed, firstBlocker: failed[0] || null }, null, 2));
if (failed.length) process.exitCode = 1;
