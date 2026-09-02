const {
  buildOutput,
  strategy4HasActionableSignal,
} = require("./scan-strategy4-cache");

function row(code, signals) {
  return {
    code,
    name: code,
    date: "2026-08-31",
    entryPrice: 100,
    targetPrice: 110,
    stopPrice: 95,
    score: 80,
    zone: "C",
    signals,
  };
}

const fixtures = {
  fullScanOnly: row("1001", [{ id: "full_scan_watch" }]),
  observationAnnotationsOnly: row("1002", [
    { id: "watch_trend" },
    { id: "below_20d_high_8" },
    { id: "lower_half_60d" },
  ]),
  actionable: row("1003", [{ id: "three_inside" }]),
  mixed: row("1004", [{ id: "base_setup" }, { id: "triangle_breakout" }]),
};

const output = buildOutput({
  codes: Object.keys(fixtures),
  scannedThisRun: 4,
  scanned: new Set(Object.keys(fixtures)),
  noDataCodes: new Set(),
  scanErrors: [],
  currentMatches: new Map(Object.values(fixtures).map((item) => [item.code, item])),
  dataSourceCounts: new Map([["fixture", 4]]),
  complete: true,
  runMode: "contract-fixture",
  scanStamp: "2026-08-31",
  volumeFilter: {},
  quoteLiquidityFilter: {},
  supabaseCoverage: null,
});

const checks = {
  full_scan_watch_is_not_actionable: strategy4HasActionableSignal(fixtures.fullScanOnly) === false,
  observation_annotations_are_not_actionable: strategy4HasActionableSignal(fixtures.observationAnnotationsOnly) === false,
  real_pattern_is_actionable: strategy4HasActionableSignal(fixtures.actionable) === true,
  mixed_row_keeps_real_pattern: strategy4HasActionableSignal(fixtures.mixed) === true,
  formal_match_count_is_two: output.count === 2 && output.matchedCount === 2,
  observation_only_count_is_two: output.observationOnlyCount === 2,
  formal_matches_exclude_observation_only: output.matches.every((item) => ["1003", "1004"].includes(item.code)),
  classification_contract_written: output.matchClassificationContract === "strategy4_actionable_patterns_v1",
};

const failedChecks = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
const result = {
  ok: failedChecks.length === 0,
  contract: "strategy4_match_classification_v1",
  checks,
  matched_count: output.matchedCount,
  observation_only_count: output.observationOnlyCount,
  matched_symbols: output.matches.map((item) => item.code),
  failed_checks: failedChecks,
  first_blocker: failedChecks[0] || null,
  read_only: true,
};

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
