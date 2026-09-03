"use strict";

const fs = require("fs");
const path = require("path");
const { candidateFromWaterRow } = require("../lib/strategy2-v3-signal");

const ROOT = path.resolve(__dirname, "..");
const signalSource = fs.readFileSync(path.join(ROOT, "lib", "strategy2-v3-signal.js"), "utf8");
const waterSource = fs.readFileSync(path.join(ROOT, "scripts", "run-strategy2-v3-water-scan.js"), "utf8");
const liveSource = fs.readFileSync(path.join(ROOT, "scripts", "run-strategy2-v3-live-scan.js"), "utf8");
const contract = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "contracts", "strategy2_seven_strategy_scanner_v1.json"), "utf8"));
const checks = [];
function check(code, ok, evidence = "") { checks.push({ code, ok: ok === true, evidence }); }

function candles({ flat = false, startMinute = 570 } = {}) {
  const output = [];
  for (let index = 0; index < 60; index += 1) {
    const close = flat ? 100 : 100 + index * 0.005;
    const minute = startMinute + index;
    const hour = Math.floor(minute / 60);
    const mm = minute % 60;
    output.push({
      candle_time: `2026-09-03T${String(hour).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+08:00`,
      open: flat ? close : close - 0.01, high: close + 0.02, low: close - 0.02, close,
      volume: index === 59 ? 300 : 100,
    });
  }
  return output;
}
function row(overrides = {}) {
  return {
    symbol: "2330", code: "2330", name: "contract-fixture", market: "TWSE", price: 100.3,
    quoteSeenAt: "2026-09-03T10:29:30+08:00", basePoolEligible: true, deepScanEligible: true,
    commonStockDaytradeEligible: true, formalQuoteReady: true, formalOneMinuteReady: true,
    estimatedVolumeRatio: 2, sourceRunId: "fugle_daytrade_source:20260903:canonical",
    canonicalRunMatches: true, gateGrade: "A", formalEntryAllowed: true,
    threeGateLevels: { upper: 99, middle: 98, lower: 97 }, openingWindowReady: true,
    openingReferencePrice: 99, changePercent: 2, stockFutureSync: false, starPreopen: false,
    ...overrides,
  };
}

const formal = candidateFromWaterRow(row(), candles(), { now: new Date("2026-09-03T10:30:00+08:00"), tradeDate: "2026-09-03" });
const gateD = candidateFromWaterRow(row({ gateGrade: "D", formalEntryAllowed: false }), candles(), { now: new Date("2026-09-03T10:30:00+08:00"), tradeDate: "2026-09-03" });
const afterCutoff = candidateFromWaterRow(row({ quoteSeenAt: "2026-09-03T12:04:30+08:00" }), candles({ startMinute: 666 }), { now: new Date("2026-09-03T12:05:00+08:00"), tradeDate: "2026-09-03" });
const futureOnly = candidateFromWaterRow(row({ stockFutureSync: true, changePercent: 0 }), candles({ flat: true }), { now: new Date("2026-09-03T10:30:00+08:00"), tradeDate: "2026-09-03" });
const wrongRun = candidateFromWaterRow(row({ canonicalRunMatches: false }), candles(), { now: new Date("2026-09-03T10:30:00+08:00"), tradeDate: "2026-09-03" });
const chase = candidateFromWaterRow(row(), candles().map((candle, index) => ({ ...candle, open: 100 + index * 0.2 - 0.1, high: 100 + index * 0.2 + 0.1, low: 100 + index * 0.2 - 0.1, close: 100 + index * 0.2 })), { now: new Date("2026-09-03T10:30:00+08:00"), tradeDate: "2026-09-03" });

check("contract_authority", contract.contract === "strategy2-scanner-v1");
check("legacy_v3_authority_removed", !signalSource.includes("s2_v3_1m_trend_volume_breakout") && !signalSource.includes("evaluateJiangCore"));
for (const marker of contract.formalRules) check(`formal_rule_${marker}`, signalSource.includes(`"${marker}"`));
for (const marker of ["stock_future_txf_sync", "star_preopen"]) check(`observation_rule_${marker}`, signalSource.includes(`"${marker}"`));
for (const marker of ["fugle_daytrade_priority_pool", "fugle_daytrade_quotes_live", "fugle_daytrade_intraday_1m", "fugle_daytrade_daily_volume_avg", "strategy4_daily_ohlcv_view", "v_stock_future_live_contract", "fugle_preopen_snapshot", "v_fugle_daytrade_canonical_gate", "source_status"]) check(`water_source_${marker}`, waterSource.includes(`"${marker}"`));
check("cross_machine_no_local_market_cache", !waterSource.includes("readFugleWebSocketQuotes") && !waterSource.includes("readFugleWebSocketCandles") && !waterSource.includes("WEBSOCKET_STATUS_FILE"));
check("canonical_run_exact_match", waterSource.includes("canonicalRunMatches") && waterSource.includes("expectedCanonicalRunId"));
check("formal_fixture_passes", formal.formalCandidate === true, formal.reason);
check("gate_d_observation_only", gateD.formalCandidate === false && gateD.observation === true, gateD.state);
check("after_1200_not_formal", afterCutoff.formalCandidate === false && afterCutoff.hardGate.complete === true && afterCutoff.gateEvidence.beforeFormalCutoff === false, afterCutoff.state);
check("future_alone_not_formal", futureOnly.formalCandidate === false && futureOnly.strategyHits.some((hit) => hit.id === "stock_future_txf_sync"));
check("wrong_run_data_gap", wrongRun.formalCandidate === false && wrongRun.hardGate.canonicalRun === false);
check("dynamic_middle_chase_not_formal", chase.formalCandidate === false && chase.gateEvidence.chaseWarning === true);
check("coverage_grades_wired", liveSource.includes('coverageGrade = formalWaterCoverageRatio >= 0.9 ? "A"') && liveSource.includes('formalWaterCoverageRatio >= 0.7 ? "B"'));
check("degraded_never_formal", liveSource.includes("degradedObservationAllowed") && liveSource.includes("observationCandidates"));
check("same_strategy_twenty_minute_cooldown", liveSource.includes("20 * 60 * 1000") && liveSource.includes("cooldownHit"));

const issues = checks.filter((item) => !item.ok).map((item) => item.code);
const report = { ok: issues.length === 0, verifier: "verify-strategy2-contract", contract: contract.contract, checkedAt: new Date().toISOString(), checks, issues };
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
