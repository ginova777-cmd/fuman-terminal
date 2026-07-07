"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function exists(file) {
  return fs.existsSync(path.join(ROOT, file));
}

const issues = [];

function requireMarkers(file, markers, label = file) {
  if (!exists(file)) {
    issues.push(`${label} is missing`);
    return "";
  }
  const text = read(file);
  for (const marker of markers) {
    if (!text.includes(marker)) issues.push(`${label} missing unified source gate marker ${marker}`);
  }
  return text;
}

function requireAnyMarker(file, markers, label = file) {
  if (!exists(file)) {
    issues.push(`${label} is missing`);
    return "";
  }
  const text = read(file);
  if (!markers.some((marker) => text.includes(marker))) {
    issues.push(`${label} missing one of unified source gate markers: ${markers.join(", ")}`);
  }
  return text;
}

function requireOrder(file, before, after, label = file) {
  const text = exists(file) ? read(file) : "";
  const beforeIndex = text.indexOf(before);
  const afterIndex = text.indexOf(after);
  if (beforeIndex < 0 || afterIndex < 0 || beforeIndex > afterIndex) {
    issues.push(`${label} must run/check ${before} before ${after}`);
  }
}

const packageJson = JSON.parse(read("package.json"));
const unifiedScript = packageJson.scripts?.["verify:unified-source-gate"] || "";
if (!unifiedScript.includes("scripts/verify-unified-source-gate-contract.js")) {
  issues.push("package.json missing scripts.verify:unified-source-gate");
}

requireMarkers("scripts/prepare-deploy.js", [
  "verify:unified-source-gate",
  "verify:publish-gate",
]);
requireOrder("scripts/prepare-deploy.js", "verify:unified-source-gate", "verify:publish-gate");

requireMarkers("scripts/verify-publish-gate.js", [
  "verify-unified-source-gate-contract.js",
  "verify:unified-source-gate",
]);


requireMarkers("lib/source-layer-contract.js", [
  "classifyTaipeiSourcePhase",
  "evaluateSharedMarketSource",
  "strategySourceLayer",
  "daytrade_dedicated",
  "shared_market",
  "daily_after_close",
  "off_session_not_required",
]);

requireMarkers("scripts/verify-source-layer-contract.js", [
  "source-layer-contract-v1",
  "shared_market_off_session_does_not_fake_live_a_but_allows_display_readback",
  "shared_market_live_session_blocks_bad_freshness",
  "strategy2_uses_daytrade_dedicated",
]);

requireMarkers("ops/public-slot/Test-PublicSlotSharedSourceReadOnly.ps1", [
  "shared_market",
  "strictLiveQuoteRequired",
  "displayReadbackAllowed",
  "off_session_not_required",
  "shared_market_live_blocked",
]);
requireMarkers("UNIFIED-SOURCE-GATE-CONTRACT.md", [
  "唯一水源總閘",
  "not ready",
  "不准寫 latest",
  "preserve previous good",
  "source_snapshot_captured_at",
  "scanner_block_reason",
  "view/RPC 500",
]);

requireMarkers("ops/public-slot/FugleSourceResourceContract.sql", [
  "source_status",
  "fugle_source_coverage",
  "v_fuman_shared_source_readonly_scorecard",
  "v_fugle_source_contract_health",
  "fresh_quote_coverage_120s",
  "scanner_can_run_quote_only",
  "scanner_can_run_opening",
  "scanner_can_run_ma20",
  "scanner_can_run_ma35",
  "scanner_can_run_full_intraday",
  "intraday_1m_stale_seconds",
  "daily_volume_status",
  "preopen_status",
  "futopt_status",
  "permission_status",
  "scanner_block_reason",
  "ready_ma20_continuous",
  "ready_ma35_continuous",
]);

requireMarkers("ops/public-slot/SharedSourceReadOnlyScorecardPatch_20260701.sql", [
  "v_fuman_shared_source_readonly_scorecard",
  "fresh_quote_coverage_120s",
  "scanner_can_run_quote_only",
  "scanner_can_run_opening",
  "scanner_can_run_ma20",
  "scanner_can_run_ma35",
  "scanner_can_run_full_intraday",
  "scanner_block_reason",
]);

const publishSourceGate = requireMarkers("scripts/check-publish-source-gate.js", [
  "publish-source-gate-v1",
  "freshQuoteCoverage120s",
  "intraday1mStaleSeconds",
  "mustPreserveLatest",
  "publishAllowed",
  "allowLatestWrite",
  "allowCompleteRunWrite",
  "preservePreviousCompleteRun",
  "suggestedScannerBehavior",
  "preserve latest complete run; do not publish; do not overwrite latest; surface degraded reason",
  "scripts/check-scanner-resource-health.js",
]);
for (const strategy of ["strategy1", "strategy2", "strategy3", "strategy4", "strategy5", "institution", "cb", "warrant"]) {
  if (!publishSourceGate.includes(`"${strategy}"`)) {
    issues.push(`scripts/check-publish-source-gate.js must include ${strategy} in the unified publish source gate`);
  }
}

requireMarkers("scripts/check-scanner-resource-health.js", [
  "source_status",
  "scanner_block_reason",
  "suggestedScannerBehavior",
  "publishAllowed",
]);

requireMarkers("lib/run-time-source-snapshot-contract.js", [
  "REQUIRED_RUN_TIME_SOURCE_SNAPSHOT_FIELDS",
  "source_snapshot_captured_at",
  "source_status_at_run",
  "quote_coverage_at_run",
  "intraday_1m_readiness_at_run",
  "ma_readiness_at_run",
  "preopen_futopt_daily_readiness_at_run",
  "run_quality_at_publish",
  "evidenceStatus",
  "unattendedStatus",
  "run_time_source_snapshot_missing_or_incomplete",
  "degradedBlocksLatest",
  "preservePreviousGood",
]);

const apiFiles = [
  "api/open-buy-latest.js",
  "api/strategy2-latest.js",
  "api/strategy3-latest.js",
  "api/strategy4-latest.js",
  "api/strategy5-latest.js",
  "api/institution-latest.js",
  "api/warrant-flow-latest.js",
  "api/cb-detect-latest.js",
  "api/realtime-radar-latest.js",
];
for (const file of apiFiles) {
  requireMarkers(file, [
    "run-time-source-snapshot-contract",
    "wrapJsonRunTimeSourceEvidence",
  ]);
}

for (const file of ["api/heatmap.js", "api/market-ai-live.js", "api/latest-strategy.js"]) {
  requireAnyMarker(file, [
    "wrapJsonRunTimeSourceEvidence",
    "attachRunTimeSourceEvidence",
  ]);
  requireMarkers(file, ["run-time-source-snapshot-contract"]);
}

const writerFiles = [
  "scripts/scan-open-buy-cache.js",
  "scripts/publish-strategy2-complete-run.js",
  "scripts/scan-strategy3-cache.js",
  "scripts/scan-strategy4-cache.js",
  "scripts/scan-strategy5-cache.js",
  "scripts/scan-institution-cache.js",
  "scripts/scan-warrant-flow-cache.js",
  "scripts/generate-cb-detect.js",
  "scripts/scan-realtime-radar-cache.js",
  "lib/watchlist-match-index-builder.js",
];
for (const file of writerFiles) {
  if (!exists(file)) continue;
  if (file === "lib/watchlist-match-index-builder.js") {
    requireMarkers(file, [
      "source_snapshot_captured_at",
      "source_status_at_run",
      "quote_coverage_at_run",
      "run_quality_at_publish",
      "unattendedStatus",
      "evidenceStatus",
    ]);
  } else {
    requireMarkers(file, [
      "run-time-source-snapshot-contract",
      "buildRunTimeSourceSnapshotFields",
    ]);
  }
}

requireMarkers("scripts/verify-production-api-freshness-contract.js", [
  "run-time source snapshot",
  "runtime_source_snapshot_missing",
  "fallback disclosure",
  "retired static JSON 410",
]);

requireMarkers("scripts/verify-api-unattended-scorecard.js", [
  "source_snapshot_captured_at",
  "source_status_at_run",
  "quote_coverage_at_run",
  "run_quality_at_publish",
  "evidenceStatus",
  "unattendedStatus",
]);

if (issues.length > 0) {
  console.error(JSON.stringify({
    ok: false,
    status: "blocked",
    contract: "unified-source-gate-contract-v1",
    issues,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  status: "ready",
  contract: "unified-source-gate-contract-v1",
  checkedAt: new Date().toISOString(),
  message: "all strategies are pinned to the unified source gate and run-time evidence contract",
}, null, 2));

