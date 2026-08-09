const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const repairFile = path.join(ROOT, "scripts", "repair-strategy3-1300-entry-candles.js");
const source = fs.readFileSync(repairFile, "utf8");

const checks = {
  existingRealReadback: source.includes("existingRealIntradayCandles")
    && source.includes('"synthetic=eq.false"')
    && source.includes('"close=gt.0"'),
  historicalOneMinuteFallback: source.includes("fugleHistoricalCandles")
    && source.includes('timeframe: "1"')
    && source.includes("from: tradeDate")
    && source.includes("to: tradeDate"),
  historical404IsMissing: source.includes("/^HTTP 404\\b/") && source.includes("return []"),
  realOnlyRepairRows: source.includes("synthetic: false") && !source.includes("synthetic_flat"),
  applyIsExplicit: source.includes('const APPLY = args.has("--apply")')
    && source.includes("const written = APPLY ?"),
  sourceCountsReadback: source.includes("sourceCounts")
    && source.includes("fugle_historical_rest"),
  missingFailsClosed: source.includes("missing.length === 0")
    && source.includes("if (!receipt.ok) process.exit(2)"),
};

const issues = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => `${name}_missing`);
const result = {
  ok: issues.length === 0,
  contract: "strategy3-1300-gap-repair-contract-v1",
  file: repairFile,
  checks,
  issues,
};
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
