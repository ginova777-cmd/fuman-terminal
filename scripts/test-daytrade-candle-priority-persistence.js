const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { mergeCurrentDayCandlePrioritySymbols } = require("../lib/daytrade-candle-priority-persistence");

const writerSource = fs.readFileSync(path.join(__dirname, "run-daytrade-source-writer.js"), "utf8");
assert.match(writerSource, /mergeCurrentDayCandlePrioritySymbols\(\{[\s\S]*?manifest:\s*currentExisting[\s\S]*?canonicalRunId/s,
  "canonical Writer must call the persistence contract with its identity-filtered manifest");
assert.match(writerSource, /candlePriorityArtifactChanged[\s\S]*?if \(!sameDailyIdentity[\s\S]*?candlePriorityArtifactChanged/s,
  "manifest rewrite condition must observe priority-list changes");

const target = {
  tradeDate: "2026-09-16",
  canonicalRunId: "fugle_daytrade_source:20260916:canonical",
};
const baseline = [
  ...Array.from({ length: 224 }, (_, index) => String(1000 + index)),
  "3000", "3001", "3002",
];
const handoffSymbols = Array.from({ length: 22 }, (_, index) => String(3000 + index));
const existing = {
  tradeDate: target.tradeDate,
  canonicalRunId: target.canonicalRunId,
  openingPrioritySymbols: [...baseline, ...handoffSymbols],
  daytradeCandlePrioritySymbols: baseline,
};

const mergedCurrent = mergeCurrentDayCandlePrioritySymbols({
  manifest: existing,
  ...target,
  computedSymbols: baseline,
});
assert.equal(mergedCurrent.length, 246, "same-day handoff additions are included without duplicate overlap");
assert.ok(handoffSymbols.every((symbol) => mergedCurrent.includes(symbol)), "all 22 handoff symbols are in the next candle-priority generation");

assert.deepEqual(
  mergeCurrentDayCandlePrioritySymbols({
    manifest: { ...existing, tradeDate: "2026-09-15" },
    ...target,
    computedSymbols: baseline,
  }),
  baseline,
  "yesterday manifest cannot carry candle priorities into today",
);

assert.deepEqual(
  mergeCurrentDayCandlePrioritySymbols({
    manifest: { ...existing, canonicalRunId: "fugle_daytrade_source:20260915:canonical" },
    ...target,
    computedSymbols: baseline,
  }),
  baseline,
  "same-date but wrong canonical run cannot carry candle priorities",
);

assert.deepEqual(
  mergeCurrentDayCandlePrioritySymbols({
    manifest: {
      trade_date: target.tradeDate,
      canonical_run_id: target.canonicalRunId,
      daytradeCandlePrioritySymbols: [{ symbol: "2305" }],
    },
    ...target,
    computedSymbols: [],
  }),
  ["2305"],
  "snake-case identity remains supported for compatible manifests",
);

console.log("PASS same-day candle priority retention, stale identity rejection, and de-duplication");
