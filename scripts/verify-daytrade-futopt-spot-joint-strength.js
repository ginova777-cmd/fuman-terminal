const fs = require("fs");
const path = require("path");

const root = process.argv.find((arg) => arg.startsWith("--root="))?.slice(7)
  || "C:/Users/ginov/Documents/Codex/futopt-v4-retire-legacy";
const writerPath = path.join(root, "scripts", "run-daytrade-source-writer.js");
const writer = fs.readFileSync(writerPath, "utf8");

const checks = {
  fresh_futopt_rows_not_pre_filtered_by_preopen_threshold: !writer.includes("if (change < 2 || relative < 1 || volume < 50) continue;"),
  live_futopt_row_requires_valid_price: writer.includes("numberValue(row.last_price ?? row.payload?.lastPrice) <= 0"),
  quote_fresh_required: writer.includes("const stockFutureIntradaySpotJointStrength = quoteFresh"),
  futopt_fresh_180s_required: writer.includes("ageSeconds(stockFuture.futoptUpdatedAt) <= 180"),
  futopt_gain_ge_1_required: writer.includes("stockFuture.futoptChangePercent >= 1"),
  spot_gain_ge_1_required: writer.includes("changePercent >= 1"),
  entry_score_boost: writer.includes("entryScore += 240"),
  upgrade_score_boost: writer.includes("upgradeScore += 360"),
  reason_code_present: writer.includes("intraday_futopt_spot_joint_strength"),
  dynamic_union_enabled: writer.includes("futopt_spot_joint_strength: metrics.stockFutureIntradaySpotJointStrength"),
  source_signal_enabled: writer.includes("metrics.stockFutureIntradaySpotJointStrength || metrics.trackedBuyPointActive"),
  deep_scan_enabled: writer.includes("|| futoptSpotJointStrength;"),
  candle_priority_enabled: writer.includes('futoptSpotJointStrength ? "intraday_futopt_spot_joint_strength"'),
};

const failedChecks = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
const result = {
  ok: failedChecks.length === 0,
  contract: "daytrade_futopt_spot_joint_strength_v1",
  checked_at: new Date().toISOString(),
  thresholds: {
    futopt_change_percent_min: 1,
    spot_change_percent_min: 1,
    futopt_fresh_seconds_max: 180,
    entry_score_boost: 240,
    upgrade_score_boost: 360,
  },
  allowed_action: "boost_mother_priority_hot_deep_scan_only",
  formal_candidate_allowed: false,
  checks,
  failed_checks: failedChecks,
  first_blocker: failedChecks[0] || null,
  read_only: true,
};

console.log(JSON.stringify(result, null, 2));
process.exitCode = result.ok ? 0 : 1;
