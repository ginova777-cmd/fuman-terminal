"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const sql = read("ops/public-slot/DaytradeStarPreopenReadbackContract_20260908.sql");
const producer = read("scripts/run-daytrade-near-one-source.js");
const verifier = read("scripts/verify-daytrade-futopt-star-readback-readonly.js");
const trialHistoryVerifier = read("scripts/verify-star-preopen-trial-history-contract.js");
const evidenceVerifier = read("scripts/verify-daytrade-futopt-preopen-evidence-readonly.js");
const evidenceWrapper = read("ops/Run-DaytradeFutoptPreopenEvidence.ps1");
const taskInstaller = read("scripts/install-daytrade-futopt-preopen-evidence-tasks.ps1");
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
};
const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key);
console.log(JSON.stringify({ ok: failed.length === 0, contract: "daytrade-futopt-star-open-retest-v2", checks, failed, firstBlocker: failed[0] || null }, null, 2));
if (failed.length) process.exitCode = 1;
