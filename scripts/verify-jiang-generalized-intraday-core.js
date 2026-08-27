"use strict";

const fs = require("fs");
const path = require("path");
const { evaluateJiangCore } = require("../lib/jiang-intraday-signal-core");
const { candidateFromWaterRow } = require("../lib/strategy2-v3-signal");

const ROOT = path.resolve(__dirname, "..");

function check(condition, key, failures) {
  if (!condition) failures.push(key);
}

function candles() {
  const start = Date.now() - 34 * 60 * 1000;
  return Array.from({ length: 35 }, (_, index) => {
    const close = index === 34 ? 121 : 100 + index * 0.55;
    return {
      candle_time: new Date(start + index * 60 * 1000).toISOString(),
      open: index === 34 ? 119 : close - 0.15,
      high: close + 0.25,
      low: close - 0.25,
      close,
      volume: index === 34 ? 1000 : 10,
    };
  });
}

function main() {
  const failures = [];
  const sourcePath = path.join(ROOT, "lib", "jiang-intraday-signal-core.js");
  const integrationPath = path.join(ROOT, "lib", "strategy2-v3-signal.js");
  const source = fs.readFileSync(sourcePath, "utf8");
  const integration = fs.readFileSync(integrationPath, "utf8");
  const requiredRuleIds = ["jiang_three_gate_b", "jiang_three_gate_volume_breakout", "jiang_fib_neckline_breakout", "jiang_fib_support_reclaim", "jiang_kd_golden_cross", "jiang_rsi_golden_cross", "jiang_macd_dif_zero_up", "jiang_oscillator_resonance", "jiang_shotgun", "jiang_w_bottom_breakout", "jiang_pullback_reacceleration", "jiang_ma_pullback_support", "jiang_ppp_bullish", "jiang_bird_beak", "jiang_tweezer_bottom", "jiang_bottom_doji", "jiang_n_large_chase_guard"];
  const allRulesDeclared = requiredRuleIds.every((id) => source.includes(id));
  const fixtureCandles = candles();
  const row = {
    code: "9999",
    symbol: "9999",
    name: "generic-fixture",
    price: 121,
    quoteSeenAt: new Date().toISOString(),
    quoteSource: "fugle_daytrade_source",
    formalQuoteReady: false,
    formalOneMinuteReady: false,
    threeGateLevels: { upper: 120, middle: 115, lower: 110 },
  };
  const direct = evaluateJiangCore(fixtureCandles, row);
  const integrated = candidateFromWaterRow(row, fixtureCandles, { now: new Date(), tradeDate: fixtureCandles.at(-1).candle_time.slice(0, 10) });
  const gap = evaluateJiangCore(fixtureCandles.slice(0, 10), row);

  check(!source.includes("2408") && !source.includes("2301"), "no_symbol_specific_patch", failures);
  check(allRulesDeclared, "all_required_generalized_rules_declared", failures);
  check(integration.includes("evaluateJiangCore"), "live_and_replay_share_jiang_core", failures);
  check(direct.status === "OK", "formal_candle_fixture_evaluated", failures);
  check(direct.primarySignal?.id === "jiang_three_gate_volume_breakout", "generic_three_gate_volume_breakout", failures);
  check(integrated.primarySignal?.id === direct.primarySignal?.id, "candidate_uses_same_primary_signal", failures);
  check(integrated.strategy === "Jiang｜三關放量突破", "primary_signal_not_hidden_by_generic_label", failures);
  check(integrated.state === "觀察｜策略命中", "gate_closed_signal_is_observation", failures);
  check(integrated.formalCandidate === false, "jiang_hit_does_not_bypass_formal_gate", failures);
  check(gap.status === "DATA_GAP" && gap.reasonCode === "jiang_requires_35_formal_1m_candles", "missing_1m_is_data_gap", failures);
  check(Array.isArray(integrated.strategyHits) && Array.isArray(integrated.secondaryLabels), "readback_fields_present", failures);
  check(["fixed", "dynamic"].includes(integrated.threeGate?.mode), "three_gate_mode_present", failures);

  const result = {
    ok: failures.length === 0,
    contract: "jiang_generalized_intraday_core_v1",
    checks: {
      no_symbol_specific_patch: !source.includes("2408") && !source.includes("2301"),
      all_required_generalized_rules_declared: allRulesDeclared,
      live_and_replay_share_jiang_core: integration.includes("evaluateJiangCore"),
      generic_three_gate_volume_breakout: direct.primarySignal?.id === "jiang_three_gate_volume_breakout",
      primary_signal_not_hidden_by_generic_label: integrated.strategy === "Jiang｜三關放量突破",
      jiang_hit_does_not_bypass_formal_gate: integrated.formalCandidate === false,
      missing_1m_is_data_gap: gap.status === "DATA_GAP",
    },
    primary_signal: integrated.primarySignal?.id || null,
    state: integrated.state,
    formal_candidate: integrated.formalCandidate,
    failed_checks: failures,
    first_blocker: failures[0] || null,
    read_only: true,
  };
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}

main();
