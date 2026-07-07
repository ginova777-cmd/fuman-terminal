"use strict";

const fs = require("fs");
const path = require("path");
const {
  classifyTaipeiSourcePhase,
  evaluateSharedMarketSource,
  strategySourceLayer,
} = require("../lib/source-layer-contract");

const ROOT = path.resolve(__dirname, "..");
const MAP_FILE = path.join(ROOT, "data", "contracts", "source-layer-strategy-map.json");

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

function readSourceLayerMap() {
  const payload = JSON.parse(fs.readFileSync(MAP_FILE, "utf8"));
  const strategies = Array.isArray(payload.strategies) ? payload.strategies : [];
  return { ...payload, strategies };
}

const sourceLayerMap = readSourceLayerMap();
const mapByKey = new Map(sourceLayerMap.strategies.map((item) => [String(item.key || "").toLowerCase(), item]));
const requiredMapKeys = [
  "strategy1",
  "strategy2",
  "strategy3",
  "seven-strategies",
  "heatmap",
  "market-ai",
  "realtime-radar",
  "strategy4",
  "strategy5",
  "institution",
  "cb",
  "warrant",
];
const allowedLayers = new Set(["daytrade_dedicated", "shared_market", "daily_after_close"]);
const allowedActions = new Set(sourceLayerMap.allowedActions || []);

const liveBlocked = evaluateSharedMarketSource(fixtureCritical, { phase: sessionPhase });
const offSession = evaluateSharedMarketSource(fixtureCritical, { phase: offSessionPhase });
const liveReady = evaluateSharedMarketSource(fixtureReady, { phase: sessionPhase });
const current = classifyTaipeiSourcePhase();

check(strategySourceLayer("strategy2") === "daytrade_dedicated", "strategy2_uses_daytrade_dedicated");
check(strategySourceLayer("heatmap") === "shared_market", "heatmap_uses_shared_market");
check(strategySourceLayer("market-ai") === "shared_market", "market_ai_uses_shared_market");
check(strategySourceLayer("strategy4") === "daily_after_close", "strategy4_uses_daily_after_close");
check(sourceLayerMap.contract === "source-layer-strategy-map-v1", "strategy_map_contract_present", { contract: sourceLayerMap.contract, file: path.relative(ROOT, MAP_FILE) });
check((sourceLayerMap.requiredScorecardFields || []).includes("sourceLayer")
  && (sourceLayerMap.requiredScorecardFields || []).includes("currentPhase")
  && (sourceLayerMap.requiredScorecardFields || []).includes("allowedAction"), "strategy_map_required_scorecard_fields_present", {
    requiredScorecardFields: sourceLayerMap.requiredScorecardFields || [],
  });
for (const key of requiredMapKeys) {
  const entry = mapByKey.get(key);
  check(Boolean(entry), `strategy_map_${key}_present`, { key });
  if (!entry) continue;
  check(strategySourceLayer(key) === entry.sourceLayer, `strategy_map_${key}_layer_matches_code`, {
    key,
    mappedLayer: entry.sourceLayer,
    codeLayer: strategySourceLayer(key),
  });
  check(allowedLayers.has(entry.sourceLayer), `strategy_map_${key}_layer_valid`, { key, sourceLayer: entry.sourceLayer });
  check(allowedActions.has(entry.regularSessionAction) && allowedActions.has(entry.offSessionAction), `strategy_map_${key}_actions_valid`, {
    key,
    regularSessionAction: entry.regularSessionAction,
    offSessionAction: entry.offSessionAction,
    allowedActions: [...allowedActions],
  });
  check(Boolean(entry.formalSource) && Boolean(entry.reason), `strategy_map_${key}_formal_source_and_reason_present`, {
    key,
    formalSource: entry.formalSource || "",
    reason: entry.reason || "",
  });
}
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
  strategyMap: {
    file: path.relative(ROOT, MAP_FILE),
    contract: sourceLayerMap.contract,
    strategyCount: sourceLayerMap.strategies.length,
    requiredScorecardFields: sourceLayerMap.requiredScorecardFields || [],
  },
  checks,
  issues: checks.filter((item) => !item.ok),
};
console.log(JSON.stringify(report, null, 2));
if (!ok) process.exit(1);
