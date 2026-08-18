"use strict";

// Strategy2 V3 closure verifier. V3 has one source chain only:
// Fugle dynamic deep-scan water -> formal 1m scan -> snapshot/API -> /88.
const fs = require("fs");
const path = require("path");

const ROOT = "C:/fuman-terminal";
const RUNTIME = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const RECEIPT = path.join(RUNTIME, "data", "scan-receipts", "strategy2-v3-live.json");
const CONTRACT = "strategy2-live-v3-fugle-deep-scan-1m";

function taipeiDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const value = (name) => parts.find((part) => part.type === name)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

function add(checks, name, ok, detail = "") {
  checks.push({ name, ok: Boolean(ok), detail });
}

function main() {
  const args = new Set(process.argv.slice(2));
  const expectDate = [...args].find((value) => value.startsWith("--trade-date="))?.split("=")[1] || taipeiDate();
  const requireComplete = args.has("--expect-complete");
  const requireDiagnostic = args.has("--diagnostic");
  const receipt = JSON.parse(fs.readFileSync(RECEIPT, "utf8"));
  const scanner = read("scripts/run-strategy2-v3-live-scan.js");
  const water = read("scripts/run-strategy2-v3-water-scan.js");
  const api = read("api/strategy2-latest.js");
  const mobile = read("api/mobile-fragment.js");
  const bundle = read("api/terminal-fast-bundle.js");
  const scorecard = read("api/scorecard.js");
  const scorecardGenerator = read("scripts/generate-terminal-scorecard-source.js");
  const terminalApp = read("terminal-app.js");
  const desktopShell = read("terminal-desktop-fast-shell.js");
  const writer = fs.readFileSync(path.join(RUNTIME, "ops", "Run-DaytradeSourceWriter.ps1"), "utf8");
  const collector = read("scripts/fugle-websocket-collector.js");
  const collectorWrapper = read("ops/public-slot/Run-DaytradeWebSocketCollector.ps1");
  const checks = [];

  add(checks, "live_scanner_has_v3_contract", scanner.includes(`const CONTRACT = \"${CONTRACT}\"`));
  add(checks, "live_scanner_reuses_v3_water", scanner.includes("readFormalWater") && scanner.includes("strategy2-v3-water-scan"));
  add(checks, "formal_live_requires_fugle_websocket", water.includes("readWebSocketEvidence") && water.includes("fugle-websocket") && water.includes("restDisabled") && scanner.includes("websocketFormalReady"));
  add(checks, "water_reads_direct_fugle_websocket_quote_and_candles", water.includes("readFugleWebSocketQuotes") && water.includes("readFugleWebSocketCandles") && water.includes("fugle_daytrade_websocket_cache"));
  add(checks, "water_scopes_to_dynamic_priority_mother_pool", water.includes('"fugle_daytrade_priority_pool"') && water.includes("deep_scan_pool + basePoolEligible") && water.includes('"top40"'));
  add(checks, "websocket_handover_is_bounded_to_fresh_evidence", water.includes("handoverGrace") && water.includes("reauthGrace") && water.includes("evidenceAgeSeconds <= 45") && water.includes("restDisabled"));
  add(checks, "collector_has_no_top40_default", collector.includes("FUGLE_STREAMING_PINNED_PRIORITY_SYMBOLS || STREAMING_MAX_SYMBOLS") && !collector.includes("FUGLE_STREAMING_PINNED_PRIORITY_SYMBOLS || 40"));
  add(checks, "collector_wrapper_overrides_legacy_top40_environment", !collectorWrapper.includes('PINNED_PRIORITY_SYMBOLS = "40"') && !collectorWrapper.includes('|| 40'));
  add(checks, "live_scanner_uses_v3_signal", scanner.includes("strategy2-v3-signal"));
  add(checks, "live_scanner_writes_only_v3_snapshot", scanner.includes('SNAPSHOT_KEY = "strategy2_live_v3"'));
  add(checks, "diagnostic_replay_is_separate_and_never_formal", scanner.includes('REPLAY_SNAPSHOT_KEY = "strategy2_live_v3_diagnostic_replay"') && scanner.includes("strategy2_v3_diagnostic_replay_visible_not_formal") && scanner.includes("displayReplay && !diagnostic"));
  add(checks, "live_scanner_has_no_legacy_readback", !scanner.includes("v_fugle_daytrade_mother_pool") && !scanner.includes("strategy2_live_v2"));
  add(checks, "api_reads_only_v3_snapshot", api.includes('SNAPSHOT_KEY = "strategy2_live_v3"') && api.includes(CONTRACT) && !/strategy2.*v2|v2.*strategy2/i.test(api));
  add(checks, "api_never_rewrites_empty_v3_to_previous_good", !api.includes("wrapJsonRunTimeSourceEvidence"));
  add(checks, "api_replay_requires_explicit_nonformal_contract", api.includes("isVisibleDiagnosticReplay") && api.includes("REPLAY_SNAPSHOT_KEY") && api.includes("payload?.publishAllowed === false"));
  add(checks, "replay_readback_is_parallel_and_cost_isolated", api.includes("const [snapshot, replaySnapshot] = await Promise.all") && api.includes("skipped: \"diagnostic_replay\"") && mobile.includes("if (!diagnosticReplay) { payload = await attachMainForceCosts"));
  add(checks, "v3_snapshot_reads_retry_without_previous_good", api.includes("readV3SnapshotWithRetry") && api.includes("STRATEGY2_V3_SNAPSHOT_READ_ATTEMPTS") && api.includes("snapshot_read_unavailable_or_missing"));
  add(checks, "v3_terminal_snapshot_is_compressed_and_decoded", scanner.includes("recordsEncoding: \"gzip-base64-json-v1\"") && scanner.includes("gzipSync") && api.includes("decodeTerminalSnapshotRows") && api.includes("gunzipSync"));
  add(checks, "mobile_authority_uses_v3", mobile.includes(CONTRACT) && !/Strategy2V2|strategy2-live-v2|strategy2_v2/i.test(mobile));
  add(checks, "desktop_bundle_uses_v3", bundle.includes(CONTRACT) && !/Strategy2V2|strategy2-live-v2|strategy2_v2/i.test(bundle));
  add(checks, "desktop_shell_requests_active_strategy_bundle", desktopShell.includes("strategyBundleRouteForCanvasRoute") && desktopShell.includes("routeQuery = requestedRoute") && desktopShell.includes('"member-route", strategyBundleRouteForCanvasRoute(key)'));
  add(checks, "terminal_has_no_retired_strategy2_stream", !terminalApp.includes("/api/strategy2-stream"));
  add(checks, "scorecard_accepts_only_v3", scorecard.includes("strategy2_v3_afternoon_scorecard_import_v1") && scorecard.includes(CONTRACT) && !/Strategy2V2|strategy2-live-v2|strategy2_v2/i.test(scorecard));
  add(checks, "scorecard_generator_requires_v3_formal_complete", scorecardGenerator.includes('formalContract: "strategy2-live-v3-fugle-deep-scan-1m"') && scorecardGenerator.includes("strategy2_v3_not_formal_complete"));
  add(checks, "writer_triggers_v3_from_success_event", writer.includes("run-strategy2-v3-live-scan.js") && writer.includes("STRATEGY2_V3_LIVE_HOOK"));
  const retiredLegacyFiles = [
    "run-strategy2-intraday.ps1",
    "run-strategy2-e2e-closure.ps1",
    "run-strategy2-line.ps1",
    "run-strategy2-supabase-coverage-watch.ps1",
    "stop-strategy2-line.ps1",
    "scripts/scan-intraday-signals.js",
    "scripts/patrol-intraday-signals.js",
    "lib/strategy2-ps1-rules.js",
    "scripts/backtest-strategy2-ps1-today.js",
    "api/strategy2-ps1-backtest.js",
    "scripts/local-strategy2-terminal-server.js",
    "scripts/intraday-radar-scorecard.yml",
    "scripts/verify-strategy2-ps1-rules.js",
    "scripts/verify-strategy2-ps1-backtest-surface.js",
    "scripts/verify-strategy2-postclose-five-stage-chain.js",
    "scripts/verify-strategy2-mother-pool-definition.js",
    "scripts/verify-strategy2-live-on.js",
  ];
  const legacyFilesStillPresent = retiredLegacyFiles.filter((relative) => fs.existsSync(path.join(ROOT, relative)));
  add(checks, "legacy_strategy2_collectors_removed", legacyFilesStillPresent.length === 0, legacyFilesStillPresent.join(","));
  const retiredV2Release = "C:/Users/ginov/Documents/Codex/strategy2-v2-production-release-20260814";
  add(checks, "legacy_strategy2_v2_release_removed", !fs.existsSync(retiredV2Release), retiredV2Release);

  add(checks, "receipt_is_v3", receipt.version === "v3" && receipt.strategyContract === CONTRACT, `${receipt.version || ""}/${receipt.strategyContract || ""}`);
  add(checks, "receipt_is_today", receipt.dataDate === expectDate && receipt.tradeDate === expectDate, `${receipt.dataDate || ""}/${receipt.tradeDate || ""}/${expectDate}`);
  add(checks, "receipt_has_run_id", /^strategy2-v3-live-/.test(String(receipt.runId || "")), receipt.runId || "missing");
  add(checks, "receipt_count_matches_scan", Number(receipt.expectedCount) > 0 && Number(receipt.scannedCount) === Number(receipt.expectedCount), `${receipt.scannedCount}/${receipt.expectedCount}`);
  add(checks, "receipt_has_no_fallback", receipt.fallbackUsed === false && receipt.preservePreviousGood === false);
  const coverage = receipt.sourceCoverage || {};
  add(checks, "receipt_uses_direct_fugle_websocket_water", coverage.motherPool === "fugle_daytrade_priority_pool" && coverage.quote === "fugle_daytrade_websocket_cache" && coverage.intraday1m === "fugle_daytrade_websocket_cache", JSON.stringify({ motherPool: coverage.motherPool, quote: coverage.quote, intraday1m: coverage.intraday1m }));
  add(checks, "receipt_websocket_evidence_is_formal", coverage.websocketFormalReady === true && coverage.websocket?.formalReady === true && coverage.websocket?.primarySource === "fugle-websocket" && coverage.websocket?.restDisabled === true && coverage.noLegacyReadbackViews === true && coverage.noTop40Gate === true && coverage.noPreviousGoodFallback === true, JSON.stringify(coverage.websocket || {}));

  if (requireComplete) {
    add(checks, "formal_run_complete", receipt.status === "complete" && receipt.complete === true && receipt.publishAllowed === true && receipt.formalDisplayAllowed === true, receipt.status || "missing");
    add(checks, "formal_run_has_no_data_gap", Number(receipt.dataGapCount) === 0, String(receipt.dataGapCount));
    add(checks, "formal_run_snapshot_written", receipt.snapshot?.ok === true && receipt.snapshot?.skipped !== true, JSON.stringify(receipt.snapshot || {}));
  } else if (requireDiagnostic) {
    add(checks, "diagnostic_never_publishes", receipt.status === "diagnostic" && receipt.publishAllowed === false && receipt.formalDisplayAllowed === false, receipt.status || "missing");
    add(checks, "diagnostic_never_writes_snapshot", receipt.snapshot?.skipped === true, JSON.stringify(receipt.snapshot || {}));
  }

  const failed = checks.filter((check) => !check.ok);
  console.log(JSON.stringify({
    ok: failed.length === 0,
    status: failed.length ? "NO" : "YES",
    strategy: "strategy2",
    version: "v3",
    contract: CONTRACT,
    checkedAt: new Date().toISOString(),
    tradeDate: expectDate,
    runId: receipt.runId || "",
    mode: requireComplete ? "formal_complete" : requireDiagnostic ? "diagnostic" : "static_and_receipt",
    first_blocker: failed[0]?.name || null,
    checks,
  }, null, 2));
  process.exitCode = failed.length ? 1 : 0;
}

main();
