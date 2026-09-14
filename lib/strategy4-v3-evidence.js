"use strict";
const RESULT_CONTRACT = "strategy4_actionable_patterns_avg5_3000_daily_kd_rsi_trend_gate_v3";
const GATE_CONTRACT = "strategy4_daily_kd_rsi_trend_gate_v2";
const NUMBERS = ["kdK", "kdD", "kdPrevK", "kdPrevD", "rsi3", "rsi3Prev", "rsi6", "rsi6Prev"];
const FLAGS = ["kdTrendUp", "rsiTrendUp", "kdGoldenCross", "rsiGoldenCross"];
const ACTIONABLE = new Set(["bull_attack","n_base","buy_neckline","buy_pullback_break","saucer","triangle_breakout","elliott_wave","breakaway_gap","runaway_gap","v_fast","v_reversal","v_reversal_runaway","deep_fall_fib","three_inside","golden_cross","wallet_strong_buy","wallet_volume_cross"]);
function dailyTechnicalGateValid(row = {}) {
  const p = row.payload || row, g = p.dailyTechnicalGate || {}, m = p.mutakiV17 || {};
  return g.contract === GATE_CONTRACT && g.ok === true && m.dailyTechnicalGateOk === true
    && g.kdTrendUp === true && g.rsiTrendUp === true
    && FLAGS.every(k => typeof g[k] === "boolean" && m[k] === g[k])
    && NUMBERS.every(k => typeof g[k] === "number" && Number.isFinite(g[k]) && m[k] === g[k])
    && g.kdK > g.kdPrevK && g.kdD > g.kdPrevD && g.rsi6 > g.rsi6Prev && g.rsi3 > g.rsi3Prev;
}
function strategy4V3Issues(runPayload = {}, rows = []) {
  const issues = [];
  if (runPayload.resultContract !== RESULT_CONTRACT) issues.push("strategy4_result_contract_not_v3");
  for (const row of rows) {
    const p = row.payload || row, code = String(row.code || p.code || "unknown");
    if (!dailyTechnicalGateValid(p)) issues.push(`strategy4_daily_technical_gate_invalid:${code}`);
    if (p.actionable !== true || p.resultClass !== "formal_actionable"
      || !Array.isArray(p.actionableSignals) || !p.actionableSignals.some(s => ACTIONABLE.has(s?.id || s)))
      issues.push(`strategy4_actionable_pattern_missing:${code}`);
  }
  return issues;
}
module.exports = { RESULT_CONTRACT, GATE_CONTRACT, dailyTechnicalGateValid, strategy4V3Issues };
