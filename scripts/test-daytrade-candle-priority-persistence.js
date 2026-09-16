const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { mergeCurrentDayCandlePrioritySymbols } = require("../lib/daytrade-candle-priority-persistence");
const { buildDaytradeIndustryPrewarm } = require("../lib/daytrade-industry-prewarm");
const industryConfig = require("../data/daytrade-industry-prewarm-v1.json");

const writerSource = fs.readFileSync(path.join(__dirname, "run-daytrade-source-writer.js"), "utf8");
assert.ok(/mergeCurrentDayCandlePrioritySymbols\(\{[\s\S]*?manifest:\s*currentExisting[\s\S]*?canonicalRunId/s.test(writerSource),
  "canonical Writer must call the persistence contract with its identity-filtered manifest");
assert.ok(/candlePriorityArtifactChanged[\s\S]*?if \(!sameDailyIdentity[\s\S]*?candlePriorityArtifactChanged/s.test(writerSource),
  "manifest rewrite condition must observe priority-list changes");
assert.ok(/\.\.\.industryPrewarm\.symbols/.test(writerSource),
  "industry watchlist must enter the warmup priority union");
assert.ok(/symbols: prependUnique\(\[\.\.\.industryPrewarm\.symbols, \.\.\.daytradeMotherPoolSymbols\], activeUniverseSymbols\)/.test(writerSource),
  "eligible prewarm symbols must be made available to the WebSocket subscription input");
assert.ok(/const daytradeMotherPoolSymbols = priceEligiblePriorityRows[\s\S]{0,300}?\.map\(/.test(writerSource),
  "industry prewarm inputs must not be injected as formal Mother Pool members");

const suppliedSymbols = industryConfig.industries.flatMap((industry) => industry.members.map((member) => member.symbol));
const industryPrewarm = buildDaytradeIndustryPrewarm(industryConfig, suppliedSymbols);
assert.equal(industryPrewarm.status, "ready");
assert.equal(industryPrewarm.symbols.length, 27, "all provided symbols should be included once after cross-industry de-duplication");
assert.ok(industryPrewarm.bySymbol[industryPrewarm.symbols[0]].tiers.includes("A"), "A tier is prioritized before B tier");
assert.deepEqual(industryPrewarm.bySymbol["3081"].tiers, ["A"]);
assert.equal(industryPrewarm.formalCandidateAllowed, false);
assert.equal(industryPrewarm.publishAllowed, false);
assert.deepEqual(industryPrewarm.bySymbol["3081"].industries.map((entry) => entry.name), ["III-V 材料／光通訊", "光通訊／CPO／矽光子"]);
assert.deepEqual(industryPrewarm.bySymbol["4991"].industries.map((entry) => entry.name), ["III-V 材料／光通訊", "光通訊／CPO／矽光子"]);
const missingIndustrySymbol = buildDaytradeIndustryPrewarm(industryConfig, suppliedSymbols.filter((symbol) => symbol !== "8086"));
assert.equal(missingIndustrySymbol.status, "degraded");
assert.deepEqual(missingIndustrySymbol.missingSymbols, ["8086"]);

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
