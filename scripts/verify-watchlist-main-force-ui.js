"use strict";

const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const shellPath = path.join(ROOT, "terminal-watchlist-shell.js");
const shell = fs.readFileSync(shellPath, "utf8");
const checks = [];
function check(ok, code, detail = {}) {
  checks.push({ ok: Boolean(ok), code, detail });
}
check(shell.includes("watch-card-name-line") && shell.includes("${escapeText(row.name || row.code)}"), "watchlist_left_card_shows_stock_name");
check(shell.includes("/api/main-force-costs?") && shell.includes("mainForceSummaryHtml") && shell.includes("隔日沖") && shell.includes("短沖") && shell.includes("當沖"), "watchlist_chip_card_uses_main_force_costs_and_styles");
check(shell.includes("策略共振") && shell.includes("三關價 上") && shell.includes("threeGateLevels"), "watchlist_risk_card_replaced_by_resonance_three_gate");
check(shell.includes("operationConditionLines") && shell.includes("matchedMainForceLabels") && shell.includes("operationLines"), "watchlist_action_card_lists_strategy_or_chip_conditions");
check(!shell.includes("<article class=\"watch-detail-section-card risk\"><span>風險</span><strong>風險可控</strong>"), "legacy_risk_card_removed");
check(!shell.includes("<article class=\"watch-detail-section-card chip\"><span>籌碼</span><strong>籌碼待確認</strong>"), "legacy_chip_placeholder_removed");
check(!shell.includes('labels.push("籌碼待確認")'), "legacy_chip_fallback_label_removed");
check(shell.includes("watchlistAsOfDate") && shell.includes("latestDailyKlineDate"), "main_force_uses_latest_daily_kline_trade_date");
const failed = checks.filter((row) => !row.ok);
const payload = {
  ok: failed.length === 0,
  contract: "watchlist_main_force_resonance_ui_v1",
  checked_at: new Date().toISOString(),
  file: shellPath,
  checks,
  failed_checks: failed.map((row) => row.code),
  first_blocker: failed[0]?.code || null,
};
console.log(JSON.stringify(payload, null, 2));
if (failed.length) process.exit(1);
