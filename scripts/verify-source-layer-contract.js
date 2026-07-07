"use strict";

const {
  classifyTaipeiSourcePhase,
  evaluateSharedMarketSource,
  strategySourceLayer,
} = require("../lib/source-layer-contract");

const fixtureCritical = {
  fresh_quote_coverage_120s: 0.2587,
  fresh_quotes_120s: 430,
  active_symbols: 1662,
  quote_age_seconds: 2401,
  intraday_1m_stale_seconds: 2401,
  ready_ma35_continuous: 1019,
  scanner_can_run_quote_only: false,
  scanner_can_run_opening: false,
};
const fixtureReady = {
  fresh_quote_coverage_120s: 0.96,
  fresh_quotes_120s: 1596,
  active_symbols: 1662,
  quote_age_seconds: 30,
  intraday_1m_stale_seconds: 20,
  ready_ma35_continuous: 1550,
  scanner_can_run_quote_only: true,
  scanner_can_run_opening: true,
};

const sessionPhase = { phase: "regular_session", strictLiveQuoteRequired: true, formalScannerWindow: true, displayReadbackAllowed: true, ymd: "2026-07-07", minuteOfDay: 570 };
const offSessionPhase = { phase: "off_session", strictLiveQuoteRequired: false, formalScannerWindow: false, displayReadbackAllowed: true, ymd: "2026-07-07", minuteOfDay: 920 };

const checks = [];
function check(ok, code, evidence = {}) {
  checks.push({ ok: Boolean(ok), code, evidence });
}

const liveBlocked = evaluateSharedMarketSource(fixtureCritical, { phase: sessionPhase });
const offSession = evaluateSharedMarketSource(fixtureCritical, { phase: offSessionPhase });
const liveReady = evaluateSharedMarketSource(fixtureReady, { phase: sessionPhase });
const current = classifyTaipeiSourcePhase();

check(strategySourceLayer("strategy2") === "daytrade_dedicated", "strategy2_uses_daytrade_dedicated");
check(strategySourceLayer("heatmap") === "shared_market", "heatmap_uses_shared_market");
check(strategySourceLayer("market-ai") === "shared_market", "market_ai_uses_shared_market");
check(strategySourceLayer("strategy4") === "daily_after_close", "strategy4_uses_daily_after_close");
check(liveBlocked.ok === false && liveBlocked.status === "critical" && liveBlocked.liveScannerAllowed === false, "shared_market_live_session_blocks_bad_freshness", liveBlocked);
check(offSession.ok === true && offSession.status === "off_session_not_required" && offSession.liveScannerAllowed === false && offSession.displayReadbackAllowed === true, "shared_market_off_session_does_not_fake_live_a_but_allows_display_readback", offSession);
check(liveReady.ok === true && liveReady.status === "ready" && liveReady.liveScannerAllowed === true, "shared_market_live_session_allows_ready_source", liveReady);

const ok = checks.every((item) => item.ok);
const report = {
  ok,
  contract: "source-layer-contract-v1",
  checkedAt: new Date().toISOString(),
  currentPhase: current,
  sourceLayers: {
    daytrade_dedicated: "formal daytrade entry only; cannot be upgraded by shared source",
    shared_market: "full-market quote/1m/MA; strict freshness only during live session; off-session display/readback uses latest snapshot evidence",
    daily_after_close: "daily/chip/CB/warrant/after-close strategies; no 120s quote freshness hard gate unless explicitly required",
  },
  checks,
  issues: checks.filter((item) => !item.ok),
};
console.log(JSON.stringify(report, null, 2));
if (!ok) process.exit(1);
