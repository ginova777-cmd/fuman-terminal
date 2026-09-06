const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

const FILES = {
  scanner: path.join(ROOT, "scripts", "run-strategy3-v2-complete-scan.js"),
  api: path.join(ROOT, "api", "strategy3-v2-latest.js"),
  sourceContract: path.join(ROOT, "scripts", "strategy3-v2-contract.js"),
  daytradeWriter: path.join(ROOT, "scripts", "run-daytrade-source-writer.js"),
};

const REQUIRED_MARKERS = {
  scanner: [
    "motherPoolPath",
    "daytradeMotherPoolSymbols",
    "quoteCachePath",
    "candleCachePath",
    "MIN_LOCAL_COVERAGE_RATIO",
    "entry_price_source",
    "local_fugle_daytrade_ws_candles_1259_1302",
    "publish_allowed",
    "status: \"COMPLETE\"",
    "failClosed",
  ],
  api: [
    "CONTRACT_VERSION",
    "RESULTS_TABLE",
    "RUNS_TABLE",
    "payloadFromComplete",
    "strategy3_v2_complete_run",
    "publishAllowed",
    "formalDisplayAllowed",
    "preservePreviousGood",
    "evidenceStatus",
    "unattendedStatus",
  ],
  sourceContract: [
    "strategy3-v2-clean-chain-v1",
    "RESULTS_TABLE",
    "RUNS_TABLE",
    "LATEST_VIEW",
    "scanReceiptPath",
    "lineReceiptPath",
  ],
  daytradeWriter: [
    "fugle-daytrade-ws-priority-symbols.json",
    "daytradeMotherPoolSymbols",
    "activeUniverseSymbols",
    "fugle_daytrade_priority_pool",
  ],
};

const SOURCE_DEPENDENCIES = [
  {
    sourceName: "Strategy3 V2 dynamic Mother Pool",
    tableViewRpc: "fugle_daytrade_priority_pool -> local fugle-daytrade-ws-priority-symbols.json",
    requiredColumns: ["tradeDate", "daytradeMotherPoolSymbols"],
    freshnessThreshold: "tradeDate must equal requested trade date",
    coverageThreshold: "dynamic pool non-empty; no fixed 300-symbol hard gate",
    gradeA: "all requested pool symbols are evaluated by the V2 scanner",
    degradedOk: "none for formal publish",
    unacceptable: "missing, wrong-date, or empty Mother Pool",
  },
  {
    sourceName: "Strategy3 V2 local Fugle quote and 1m water",
    tableViewRpc: "fugle-daytrade-ws-quotes-v2.json + fugle-daytrade-ws-candles-v2.json",
    requiredColumns: ["code", "tradeDate", "candleTime", "open", "high", "low", "close", "volume"],
    freshnessThreshold: "same trade date with 12:59-13:02 entry-window candle",
    coverageThreshold: "local coverage ratio >= 0.90 of the dynamic Mother Pool",
    gradeA: "same-run local quote/candle coverage and entry-window evidence complete",
    degradedOk: "off-session read-only verification may use the same-day complete receipt",
    unacceptable: "Strategy2 verifier status, cross-strategy gate, fallback, or previous-good as current",
  },
];

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function main() {
  const issues = [];
  const checks = [];
  for (const [label, file] of Object.entries(FILES)) {
    const text = read(file);
    for (const marker of REQUIRED_MARKERS[label] || []) {
      const ok = text.includes(marker);
      checks.push({ label, marker, ok });
      if (!ok) issues.push(`${label} missing ${marker}`);
    }
  }

  const fixtureDir = path.join(ROOT, "fixtures", "strategy3-prewater");
  const fixtures = fs.existsSync(fixtureDir)
    ? fs.readdirSync(fixtureDir).filter((name) => name.endsWith(".json")).sort()
    : [];
  if (fixtures.length < 11) issues.push(`fixture count ${fixtures.length} below 11`);

  const result = {
    ok: issues.length === 0,
    checkedAt: new Date().toISOString(),
    mode: "local-static-no-supabase",
    dependencies: SOURCE_DEPENDENCIES,
    fixtures,
    checks,
    issues,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(`[strategy3-prewater-static] failed: ${error.message || String(error)}`);
  process.exitCode = 1;
}
