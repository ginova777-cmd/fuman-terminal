"use strict";

const fs = require("fs");
const path = require("path");

const terminalDir = process.argv.find((arg) => arg.startsWith("--terminal-dir="))?.slice("--terminal-dir=".length) || "C:/fuman-terminal";
const read = (file) => fs.readFileSync(path.join(terminalDir, file), "utf8");
const candidate = read("scripts/verify-opening-limit-order-candidate-readonly.js");
const preflight = read("ops/Run-OpeningLimitOrder0850PreflightReadonly.ps1");
const engine = read("ops/Run-OpeningLimitOrder0850PreflightReadonly.engine-v2.ps1");
const staticPrefilter = read("scripts/build-opening-limit-order-static-prefilter.js");
const issues = [];

const candidateMarkers = [
  'const REQUIRED_PREOPEN_SLOTS = ["0845", "0850"]',
  'TaiwanStockTradingDailyReport", { data_id: symbol, start_date: signalDate }',
  "preopen_price_eligible",
  "detectWNeckline",
  "w_neckline_two_day_hold_overnight_trader_branches",
  "v_terminal_main_force_latest",
  "overnight_matched",
  "w_neckline:",
  "opening_report_sector_up_1d",
  "overseas_sector_up_1d",
  "opening_report_sector_1d_strength_missing_or_not_positive",
  "creates_order: false",
  "creates_formal_candidate: false",
  "publish_allowed: false",
];
const schedulerMarkers = [
  "check-market-calendar-action.js",
  "SKIP_NON_TRADING_DAY",
  "market_calendar_non_trading_day",
  "Run-OpeningLimitOrder0850PreflightReadonly.engine-v2.ps1",
  "Wait-Until0850",
  "08:55",
];
const engineMarkers = [
  "warm static opening sources",
  "--warmup-static=true",
  "opening_limit_order_0850_static_sources_v1",
  "build-opening-limit-order-static-prefilter.js",
  "static_prefilter_path",
  "static_match_count",
  "conditional_ready_count",
];
const staticMarkers = [
  "detectWNeckline",
  "w_neckline_two_day_hold_overnight_trader_branches",
  "w_neckline:",
  'conditional_rules: ["3", "4", "9", "10"]',
  "price_below_50",
  "confirmOrPendingSector1",
  "opening_report_sector_up_1d",
  "opening_report_sector_up_1d_symbol_count",
];
for (const marker of candidateMarkers) if (!candidate.includes(marker)) issues.push(`candidate_marker_missing:${marker}`);
for (const marker of schedulerMarkers) if (!preflight.includes(marker)) issues.push(`scheduler_marker_missing:${marker}`);
for (const marker of engineMarkers) if (!engine.includes(marker)) issues.push(`engine_marker_missing:${marker}`);
for (const marker of staticMarkers) if (!staticPrefilter.includes(marker)) issues.push(`static_prefilter_marker_missing:${marker}`);
if (candidate.includes("prev_low_above_prior_open_overnight_trader_branches")) issues.push("legacy_rule8_previous_open_condition_present");
if (candidate.includes('const REQUIRED_PREOPEN_SLOTS = ["0845", "0850", "0855", "0859"]')) issues.push("preopen_decision_must_not_require_0859");
if (candidate.includes("us_sector_1d_strength_missing_or_not_positive")) issues.push("legacy_us_only_sector_gap_present");
if (staticPrefilter.includes('required_confirmation: "us_sector_up_1d"')) issues.push("legacy_static_prefilter_us_only_pending_present");
if (staticPrefilter.includes("confirmOrPendingUs1")) issues.push("legacy_static_prefilter_us_only_helper_present");

console.log(JSON.stringify({
  ok: issues.length === 0,
  contract: "opening_limit_order_source_contract_v6",
  checked_at: new Date().toISOString(),
  static_warmup_at: "08:50 Asia/Taipei",
  static_prefilter: {
    confirmed_rules: ["1", "2", "8"],
    conditional_rules: ["3", "4", "9", "10"],
    rule_8: "W-neckline two-day hold + verified overnight trader",
  },
  final_preopen_decision_at: "08:55 Asia/Taipei",
  opening_report_sector_closure: "sector_up_1d = us_sector_up_1d || overseas_sector_up_1d || sector_return_1d_pct > 0",
  decision_preopen_slots: ["0845", "0850"],
  post_open_phase: "09:00 second-confirm only",
  rules: 10,
  failed_checks: issues,
  first_blocker: issues[0] || null,
}, null, 2));
process.exitCode = issues.length ? 1 : 0;
