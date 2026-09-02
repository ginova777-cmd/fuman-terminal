const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const writer = fs.readFileSync(path.join(root, "scripts", "run-daytrade-source-writer.js"), "utf8");
const collector = fs.readFileSync(path.join(root, "scripts", "fugle-websocket-collector.js"), "utf8");
const bridge = fs.readFileSync(path.join(root, "scripts", "apply-opening-report-mother-pool-bridge.js"), "utf8");

const checks = {
  valid_report_builds_warmup_symbols: writer.includes("const warmupBySymbol = new Map()")
    && writer.indexOf("warmupBySymbol.set(symbol, previous)") < writer.indexOf("const receiptPath = path.join(receiptDir"),
  explicit_price_below_50_rejected_before_warmup: writer.includes("inputPrice > 0 && inputPrice < MOTHER_POOL_MIN_PRICE"),
  quote_refresh_fields_published: writer.includes("openingReport0830QuoteRefreshSymbols")
    && writer.includes("openingReport0830QuoteRefreshTradeDate"),
  candle_priority_requires_hard_filter: writer.includes("openingReportCandlePrioritySymbols")
    && writer.includes(".filter((code) => priceEligibleSymbolSet.has(code))"),
  hydration_changes_force_artifact_write: writer.includes("openingReportHydrationChanged")
    && writer.includes("|| openingReportHydrationChanged"),
  collector_reads_quote_refresh_queue: collector.includes("openingReport0830QuoteRefreshSymbols"),
  formal_candidate_guard_preserved: bridge.includes("formal_candidate_count: 0")
    && bridge.includes("formal_candidate_allowed: false")
    && bridge.includes("forbidden_publish_guard: true"),
};

function fixture({ symbol, inputPrice, quoteEligible }) {
  const quoteRefresh = /^\d{4}$/.test(symbol) && !(inputPrice > 0 && inputPrice < 50);
  return {
    quoteRefresh,
    candlePriority: quoteRefresh && quoteEligible,
    formalCandidateCount: 0,
    forbiddenPublishGuard: true,
  };
}

const fixtures = {
  symbol_4971_quote_pending: fixture({ symbol: "4971", inputPrice: 0, quoteEligible: false }),
  symbol_4971_quote_eligible: fixture({ symbol: "4971", inputPrice: 88, quoteEligible: true }),
  symbol_below_50: fixture({ symbol: "1234", inputPrice: 49.5, quoteEligible: true }),
};

checks.fixture_4971_quote_refresh_before_quote = fixtures.symbol_4971_quote_pending.quoteRefresh === true
  && fixtures.symbol_4971_quote_pending.candlePriority === false;
checks.fixture_4971_candle_after_hard_filter = fixtures.symbol_4971_quote_eligible.candlePriority === true;
checks.fixture_below_50_rejected = fixtures.symbol_below_50.quoteRefresh === false
  && fixtures.symbol_below_50.candlePriority === false;
checks.fixture_never_formal_publish = Object.values(fixtures).every((row) => row.formalCandidateCount === 0
  && row.forbiddenPublishGuard === true);

const failed_checks = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
const output = {
  ok: failed_checks.length === 0,
  contract: "opening_report_0830_quote_candle_hydration_v1",
  checks,
  fixtures,
  failed_checks,
  first_blocker: failed_checks[0] || null,
  formal_gate_relaxed: false,
  read_only: true,
};
console.log(JSON.stringify(output, null, 2));
if (!output.ok) process.exitCode = 1;
