"use strict";

const fs = require("fs");
const path = require("path");
const { CONTRACT, buildScorecardPerformanceEvaluation } = require("../lib/scorecard-performance-evaluation");

const ROOT = path.resolve(__dirname, "..");
const issues = [];
function add(condition, code) { if (!condition) issues.push(code); }

const fixture = [
  { record_date: "2026-09-01", strategy: "策略2成績單", ticker: "1111", entry_price: 100, high_price: 106, exit_price: 103, total_cost_pct: 0.5 },
  { record_date: "2026-09-02", strategy: "策略2成績單", ticker: "2222", entry_price: 100, high_price: 102, exit_price: 98, total_cost_pct: 0.5 },
  { record_date: "2026-09-02", strategy: "策略3隔日沖成績單", ticker: "3333", entry_price: 50, high_price: 55 },
];
const report = buildScorecardPerformanceEvaluation(fixture, { selectedDate: "2026-09-02" });
const strategy2 = report.byStrategy.find((row) => row.strategy === "策略2成績單");
const strategy3 = report.byStrategy.find((row) => row.strategy === "策略3隔日沖成績單");
const apiText = fs.readFileSync(path.join(ROOT, "api", "scorecard.js"), "utf8");
const html = fs.readFileSync(path.join(ROOT, "88.html"), "utf8");

add(report.contract === CONTRACT, "performance_contract_mismatch");
add(report.status === "PARTIAL", "mixed_fixture_must_be_partial");
add(strategy2?.status === "COMPLETE", "realized_strategy_not_complete");
add(strategy2?.realizedSamples === 2, "realized_sample_count_wrong");
add(strategy2?.backtest?.averageNetReturnPct === 0, "net_return_cost_math_wrong");
add(strategy2?.backtest?.wins === 1 && strategy2?.backtest?.losses === 1, "net_win_loss_math_wrong");
add(strategy3?.status === "NOT_EVALUABLE", "missing_exit_must_not_be_evaluable");
add(strategy3?.tracking?.averageMfePct === 10, "mfe_math_wrong");
add(strategy3?.backtest?.averageNetReturnPct === null, "missing_exit_must_not_invent_net_return");
add(apiText.includes("buildScorecardPerformanceEvaluation(allRecords"), "scorecard_api_performance_not_connected");
add(html.includes('data-testid="scorecard-performance-evaluation"'), "scorecard_performance_panel_missing");
add(html.includes("MFE 是進場後觀察到的最高有利幅度，不是實際賣出獲利"), "mfe_warning_missing");
add(html.includes("NOT_EVALUABLE"), "not_evaluable_ui_missing");

const output = {
  ok: issues.length === 0,
  status: issues.length === 0 ? "SCORECARD_PERFORMANCE_EVALUATION_READY" : "SCORECARD_PERFORMANCE_EVALUATION_NOT_READY",
  contract: CONTRACT,
  fixture: report,
  issues,
};
console.log(JSON.stringify(output, null, 2));
process.exitCode = output.ok ? 0 : 1;
