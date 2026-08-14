"use strict";

const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const RECEIPT = path.join(RUNTIME_DIR, "data", "scan-receipts", "strategy2-v2.json");
const CONTRACT = "strategy2-live-v2-fugle-mother-pool-1m";
const SCORECARD_IMPORT_CONTRACT = "strategy2_v2_afternoon_scorecard_import_v1";

function taipeiDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function taipeiMinute(value) {
  const timestamp = Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp)) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  return Number.isFinite(hour) && Number.isFinite(minute) ? (hour * 60) + minute : null;
}

function taipeiTime(value) {
  const timestamp = Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp)) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).format(new Date(timestamp));
}
function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function callHandler(handler, request) {
  return new Promise((resolve) => {
    const response = {
      statusCode: 200,
      setHeader() {},
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, payload }); },
      send(payload) { resolve({ status: this.statusCode, payload }); },
      end(payload) { resolve({ status: this.statusCode, payload }); },
    };
    Promise.resolve(handler({ ...request, fumanInternalVerify: true }, response))
      .catch((error) => resolve({ status: 500, payload: { error: error?.message || String(error) } }));
  });
}

function callLocalApi() {
  return callHandler(require("../api/strategy2-latest"), {
    method: "GET",
    query: { limit: "500", live: "1", today: "1" },
    headers: {},
    url: "/api/strategy2-latest?limit=500&live=1&today=1",
  });
}

function callMobileFragment() {
  return callHandler(require("../api/mobile-fragment"), {
    method: "GET",
    query: { tab: "strategy2", live: "1", verify: "1" },
    headers: {},
    url: "/api/mobile-fragment?tab=strategy2&live=1&verify=1",
  });
}

function callTerminalFastBundle() {
  return callHandler(require("../api/terminal-fast-bundle"), {
    method: "GET",
    query: { verify: "1" },
    headers: {},
    url: "/api/terminal-fast-bundle?verify=1",
  });
}

function callScorecard() {
  return callHandler(require("../api/scorecard"), {
    method: "GET",
    query: {},
    headers: {},
    url: "/api/scorecard",
  });
}

(async () => {
  const diagnostic = process.argv.includes("--diagnostic");
  // The 13:30 scanner closes the live surfaces; /88 is imported once at 14:00.
  const scorecardDeferred = !diagnostic && process.argv.includes("--scorecard-deferred");
  const requireScorecard = !diagnostic && !scorecardDeferred;
  const issues = [];
  const scanner = read("scripts/run-strategy2-live-v2.js");
  const realtimeObserver = read("scripts/run-strategy2-realtime-observer.js");
  const sourceWriter = read("scripts/run-daytrade-source-writer.js");
  const api = read("api/strategy2-latest.js");
  const desktop = read("terminal-desktop-fast-shell.js");
  const mobile = read("api/mobile-fragment.js");
  const scorecard = read("api/scorecard.js");
  const genericLatest = read("api/latest-strategy.js");
  const oldStream = read("api/strategy2-stream.js");
  const runner = read("run-strategy2-live-v2.ps1");
  const retiredBacktest = read("api/strategy2-ps1-backtest.js");

  for (const marker of [
    "v_fugle_daytrade_mother_pool",
    "fugle_daytrade_intraday_1m",
    "strategy2_live_v2",
    "noTop40Gate: true",
    "noPreviousGoodFallback: true",
    "offset: String(offset)",
    "scanTimelineSignals",
    "indicatorSeries",
    "terminalSnapshotPayload",
    "13 * 60 + 30",
  ]) {
    if (!scanner.includes(marker)) issues.push(`scanner_missing:${marker}`);
  }
  if (!scanner.includes(SCORECARD_IMPORT_CONTRACT)) issues.push("scanner_missing_afternoon_scorecard_import_contract");
  if (scanner.includes("SCORECARD_SNAPSHOT_KEY")) issues.push("scanner_must_not_write_intraday_scorecard_snapshot");
  for (const forbidden of ["priority_top40", "previous_good", "runtime-session-history", "fugle_shared_source", "strategy2-ps1"]) {
    if (scanner.includes(forbidden)) issues.push(`scanner_forbidden:${forbidden}`);
    if (api.includes(forbidden)) issues.push(`api_forbidden:${forbidden}`);
  }
  for (const forbidden of ["v_strategy2_intraday_ready", "v_strategy2_latest_complete_run", "strategy2_scan_results", "priority_top40", "top40"]) {
    if (sourceWriter.includes(forbidden)) issues.push(`source_writer_legacy_reference:${forbidden}`);
  }
  if (!sourceWriter.includes("fugle_websocket_candles_full_dynamic_mother_pool")) issues.push("source_writer_missing_full_mother_pool_mirror");
  if (!runner.includes("check-market-calendar-action.js") || !runner.includes("--label=strategy2-live-v2")) issues.push("runner_missing_market_calendar_guard");
  if (!runner.includes("run-strategy2-realtime-observer.js") || !runner.includes("cadence=3s") || !runner.includes("08:45-13:30")) issues.push("runner_missing_realtime_observer_or_ps1_window");
  if (!runner.includes("--scorecard-deferred")) issues.push("runner_must_defer_scorecard_until_1400");
  for (const marker of [
    "fugle_daytrade_quotes_live",
    "fugle_daytrade_futopt_quotes_live",
    "futopt_tickers",
    "fugle_preopen_snapshot",
    "v_strategy12_stock_future_contract_health",
    "pollIntervalSeconds: 3",
    "strategy2-v2-realtime-quote-observation-v1",
  ]) {
    if (!realtimeObserver.includes(marker)) issues.push("realtime_observer_missing:" + marker);
  }
  if (!desktop.includes("/api/strategy2-latest")) issues.push("desktop_missing_v2_strategy2_endpoint");
  if (!desktop.includes("strategy2TaipeiTime") || !desktop.includes("timeZone: \"Asia/Taipei\"")) issues.push("desktop_missing_taipei_time_display");
  if (!api.includes("REALTIME_SNAPSHOT_KEY") || !api.includes("formalEvents") || !api.includes("observations")) issues.push("api_missing_realtime_observation_merge");
  if (!desktop.includes("strategy2_(realtime_quote|preopen_futopt)") || !desktop.includes("策略命中觀察")) issues.push("desktop_missing_realtime_observation_label_guard");
  if (desktop.includes("strategy2-ps1-backtest")) issues.push("desktop_legacy_backtest_route_present");
  if (!mobile.includes('tab === "strategy2"') || !mobile.includes("fetchStrategy2Internal")) issues.push("mobile_missing_v2_direct_read");
  if (!mobile.includes('tab !== "ai" && tab !== "strategy2"')) issues.push("mobile_strategy2_html_snapshot_not_bypassed");
  if (!scorecard.includes("strategy2_v2_not_formal_or_not_today_no_scorecard_records")) issues.push("scorecard_missing_v2_formal_gate");
  if (!scorecard.includes("strategy2_v2_formal_scorecard_source")) issues.push("scorecard_missing_v2_formal_source_contract");
  if (!scorecard.includes("strategy2_v2_scorecard_import_pending_1400") || !scorecard.includes(SCORECARD_IMPORT_CONTRACT)) issues.push("scorecard_missing_afternoon_import_gate");
  if (!genericLatest.includes("if (!DIRECT_AUTHORITATIVE_KEYS.has(key))")) issues.push("generic_api_may_read_legacy_strategy2_status");
  if (!oldStream.includes("strategy2_stream_retired") || !oldStream.includes(CONTRACT)) issues.push("legacy_strategy2_stream_not_retired");
  if (!retiredBacktest.includes("strategy2_ps1_backtest_retired") || !retiredBacktest.includes(CONTRACT)) issues.push("legacy_strategy2_backtest_not_retired");

  const receipt = readJson(RECEIPT);
  const realtimeReceipt = readJson(path.join(RUNTIME_DIR, "data", "scan-receipts", "strategy2-v2-realtime.json"));
  if (!realtimeReceipt) issues.push("realtime_observer_receipt_missing");
  if (realtimeReceipt && realtimeReceipt.strategyContract !== "strategy2-v2-realtime-quote-observation-v1") issues.push("realtime_observer_contract_mismatch");
  if (realtimeReceipt && realtimeReceipt.dataDate !== taipeiDate()) issues.push("realtime_observer_date_not_today");
  if (!receipt) issues.push("v2_receipt_missing");
  if (receipt) {
    if (receipt.strategyContract !== CONTRACT) issues.push("receipt_contract_mismatch");
    if (receipt.dataDate !== taipeiDate()) issues.push("receipt_date_not_today");
    if (!String(receipt.runId || "").startsWith("strategy2-v2-")) issues.push("receipt_runid_invalid");
    if (receipt.fallbackUsed === true || receipt.previousGoodRunId) issues.push("receipt_old_fallback_detected");
    if (Number(receipt.scannedCount || 0) + Number(receipt.dataGapCount || 0) !== Number(receipt.expectedCount || 0)) issues.push("receipt_full_scan_accounting_mismatch");
    if (!diagnostic && receipt.status !== "complete") issues.push(`receipt_not_complete:${receipt.status || "missing"}`);
    if (diagnostic && receipt.status !== "diagnostic_replay") issues.push(`receipt_not_diagnostic:${receipt.status || "missing"}`);
    if (diagnostic && receipt.scorecardImport?.status !== "not_eligible") issues.push("diagnostic_must_not_stage_scorecard_import");
    if (!diagnostic && receipt.scorecardImport?.contract !== SCORECARD_IMPORT_CONTRACT) issues.push("receipt_scorecard_import_contract_mismatch");
    if (!diagnostic && receipt.scorecardImport?.scheduledAt !== "14:00") issues.push("receipt_scorecard_import_time_not_1400");
    if (scorecardDeferred && receipt.scorecardImport?.status !== "pending_daily_scorecard_import") issues.push("receipt_scorecard_import_not_pending_after_live_close");
    if (Number(receipt.sourceCoverage?.eligibleMotherPoolRows || 0) !== Number(receipt.expectedCount || 0)) issues.push("eligible_mother_pool_count_mismatch");
    if (Number(receipt.sourceCoverage?.intraday1mReadySymbols || 0) !== Number(receipt.scannedCount || 0)) issues.push("ready_1m_count_mismatch");
  }

  const endpoint = await callLocalApi();
  if (endpoint.status !== 200) issues.push(`api_http_${endpoint.status}`);
  const payload = endpoint.payload || {};
  if (receipt?.runId && payload.runId !== receipt.runId) issues.push("api_runid_mismatch");
  if (receipt?.dataDate && payload.dataDate !== receipt.dataDate) issues.push("api_date_mismatch");
  if (payload.fallbackUsed === true || payload.previousGoodRunId) issues.push("api_old_fallback_detected");
  if (payload.strategyContract !== CONTRACT) issues.push("api_contract_mismatch");
  if (Number(payload.scannedCount || 0) + Number(payload.dataGapCount || 0) !== Number(payload.expectedCount || 0)) issues.push("api_full_scan_accounting_mismatch");
  const apiEvents = Array.isArray(payload.formalEvents) ? payload.formalEvents : (Array.isArray(payload.events) ? payload.events : []);
  const timelineEvents = apiEvents.map((row) => ({
    code: String(row?.code || row?.symbol || ""),
    at: row?.entryAt || row?.entryCandleTime || row?.timestamp || "",
  })).filter((row) => row.code || row.at);
  const invalidTimeline = timelineEvents.filter((row) => !row.code || taipeiMinute(row.at) === null);
  const outsideStrategy2Window = timelineEvents.filter((row) => {
    const minute = taipeiMinute(row.at);
    return minute !== null && (minute < 540 || minute > 810);
  });
  if (Number(payload.count || 0) !== timelineEvents.length) issues.push("api_timeline_count_mismatch");
  if (invalidTimeline.length) issues.push("api_timeline_invalid_timestamp:" + invalidTimeline.length);
  if (outsideStrategy2Window.length) issues.push("api_timeline_outside_0900_1330:" + outsideStrategy2Window.length);
  if (new Set(timelineEvents.map((row) => row.code)).size !== timelineEvents.length) issues.push("api_timeline_duplicate_symbol_detected");
  const terminalBundle = await callTerminalFastBundle();
  const desktopPayload = Object.entries(terminalBundle.payload?.endpoints || {})
    .find(([endpoint]) => String(endpoint).startsWith("/api/strategy2-latest"))?.[1] || null;
  if (terminalBundle.status !== 200) issues.push(`desktop_fast_bundle_http_${terminalBundle.status}`);
  if (!desktopPayload) issues.push("desktop_fast_bundle_strategy2_missing");
  if (desktopPayload?.strategyContract !== CONTRACT) issues.push("desktop_fast_bundle_contract_mismatch");
  if (receipt?.runId && desktopPayload?.runId !== receipt.runId) issues.push("desktop_fast_bundle_runid_mismatch");
  if (receipt?.dataDate && desktopPayload?.dataDate !== receipt.dataDate) issues.push("desktop_fast_bundle_date_mismatch");
  if (desktopPayload?.fallbackUsed === true || desktopPayload?.previousGoodRunId) issues.push("desktop_fast_bundle_old_fallback_detected");
  if (receipt?.runId && desktopPayload?.terminalAuthority?.runId !== receipt.runId) issues.push("desktop_terminal_authority_runid_mismatch");
  if (desktopPayload?.terminalAuthority?.fallback === true) issues.push("desktop_terminal_authority_old_fallback_detected");
  if (String(desktopPayload?.terminalAuthority?.displayMode || "").includes("PREVIOUS_GOOD")) issues.push("desktop_terminal_authority_previous_good_mode_detected");
  const mobileFragment = await callMobileFragment();
  const mobileHtml = String(mobileFragment.payload || "");
  if (mobileFragment.status !== 200) issues.push(`mobile_http_${mobileFragment.status}`);
  if (receipt?.runId && !mobileHtml.includes(receipt.runId)) issues.push("mobile_runid_mismatch");
  if (mobileHtml.includes("blocked_preserved") || mobileHtml.includes("strategy2-20260812-")) issues.push("mobile_old_strategy2_state_detected");
  if (receipt?.status === "diagnostic_replay" && !mobileHtml.includes("V2_DIAGNOSTIC_VISIBLE_NOT_FORMAL")) issues.push("mobile_v2_diagnostic_authority_missing");

  const scorecardResponse = await callScorecard();
  const scorecardPayload = scorecardResponse.payload && typeof scorecardResponse.payload === "object" ? scorecardResponse.payload : {};
  const scorecardReport = (Array.isArray(scorecardPayload.sourceReports) ? scorecardPayload.sourceReports : [])
    .find((report) => String(report?.key || "").toLowerCase() === "strategy2") || null;
  const visibleStrategy2Rows = (Array.isArray(scorecardPayload.records) ? scorecardPayload.records : [])
    .filter((row) => String(row?.strategy || "") === "策略2成績單");
  const visibleStrategy2TodayRows = visibleStrategy2Rows.filter((row) => {
    const recordDate = String(row?.record_date || row?.recordDate || row?.date || "");
    return !receipt?.dataDate || recordDate === receipt.dataDate;
  });
  if (scorecardResponse.status !== 200) issues.push(`scorecard_http_${scorecardResponse.status}`);
  if (!scorecardReport) issues.push("scorecard_strategy2_report_missing");
  if (receipt?.runId && scorecardReport?.runId !== receipt.runId) issues.push("scorecard_runid_mismatch");
  if (receipt?.dataDate && scorecardReport?.date !== receipt.dataDate) issues.push("scorecard_date_mismatch");
  if (diagnostic && visibleStrategy2Rows.length) issues.push("diagnostic_old_strategy2_scorecard_rows_visible");
  if (diagnostic && scorecardReport?.reason !== "strategy2_v2_not_formal_or_not_today_no_scorecard_records") issues.push("diagnostic_scorecard_reason_mismatch");
  if (scorecardDeferred) {
    if (scorecardReport?.ok === true || scorecardReport?.publishAllowed === true) issues.push("scorecard_import_visible_before_1400");
    if (scorecardReport?.reason !== "strategy2_v2_scorecard_import_pending_1400") issues.push("scorecard_pending_reason_mismatch");
    if (visibleStrategy2TodayRows.length) issues.push("scorecard_today_rows_visible_before_1400");
  }
  if (requireScorecard) {
    if (scorecardReport?.ok !== true) issues.push("formal_scorecard_report_not_complete");
    if (scorecardReport?.reason !== "strategy2_v2_formal_scorecard_source") issues.push("formal_scorecard_reason_mismatch");
    if (Number(scorecardReport?.count || 0) !== Number(receipt?.resultCount || 0)) issues.push("scorecard_result_count_mismatch");
    if (visibleStrategy2TodayRows.length !== Number(receipt?.resultCount || 0)) issues.push("scorecard_today_rows_mismatch");
  }
  const backfill = readJson(path.join(RUNTIME_DIR, "data", "scan-receipts", `strategy2-v2-fugle-backfill-${taipeiDate().replace(/-/g, "")}.json`));
  if (diagnostic && backfill?.apply === true) {
    if (Number(backfill.motherPoolSymbols || 0) !== Number(receipt?.expectedCount || 0)) issues.push("backfill_mother_pool_count_mismatch");
    if (Number(backfill.readySymbols || 0) < Number(receipt?.scannedCount || 0)) issues.push("backfill_ready_coverage_below_scanned");
    if (backfill.formalCandidateCreated || backfill.scorecardWritten) issues.push("backfill_must_remain_diagnostic_only");
  }

  const output = {
    ok: issues.length === 0,
    verifier: "verify-strategy2-live-v2-closure",
    mode: diagnostic ? "diagnostic" : scorecardDeferred ? "live-surfaces-scorecard-pending" : "full-closure-after-scorecard",
    scorecardImportPhase: diagnostic ? "not_applicable" : scorecardDeferred ? "pending_until_1400" : "verified_after_1400",
    fullClosure: !diagnostic && requireScorecard && issues.length === 0,
    checkedAt: new Date().toISOString(),
    receipt: receipt ? {
      status: receipt.status,
      dataDate: receipt.dataDate,
      runId: receipt.runId,
      expectedCount: receipt.expectedCount,
      scannedCount: receipt.scannedCount,
      resultCount: receipt.resultCount,
      dataGapCount: receipt.dataGapCount,
      formalDisplayAllowed: receipt.formalDisplayAllowed,
    } : null,
    water: backfill ? {
      diagnosticOnly: backfill.diagnosticOnly,
      motherPoolSymbols: backfill.motherPoolSymbols,
      readySymbols: backfill.readySymbols,
      dataGapCount: backfill.dataGapCount,
      rowsWritten: backfill.rowsWritten,
    } : null,
    realtime: realtimeReceipt ? {
      phase: realtimeReceipt.phase || "",
      status: realtimeReceipt.status || "",
      pollIntervalSeconds: realtimeReceipt.pollIntervalSeconds || 0,
      observationCount: realtimeReceipt.observationCount || 0,
      sourceHealth: realtimeReceipt.sourceHealth || {},
    } : null,
    surfaces: {
      desktop: {
        status: terminalBundle.status,
        runId: desktopPayload?.runId || "",
        dataDate: desktopPayload?.dataDate || "",
        count: desktopPayload?.count || 0,
        observationCount: desktopPayload?.observationCount || 0,
      },
      mobile: {
        status: mobileFragment.status,
        matchedRunId: receipt?.runId ? mobileHtml.includes(receipt.runId) : false,
      },
      scorecard: {
        status: scorecardResponse.status,
        runId: scorecardReport?.runId || "",
        date: scorecardReport?.date || "",
        visibleStrategy2Rows: visibleStrategy2Rows.length,
        visibleStrategy2TodayRows: visibleStrategy2TodayRows.length,
        reason: scorecardReport?.reason || "",
      },
    },
    api: {
      status: endpoint.status,
      runId: payload.runId || "",
      dataDate: payload.dataDate || "",
      count: payload.count || 0,
      formalReturnedCount: payload.formalReturnedCount || 0,
      observationCount: payload.observationCount || 0,
      statusText: payload.status || "",
    },
    timeline: {
      eventCount: timelineEvents.length,
      distinctCodes: new Set(timelineEvents.map((row) => row.code)).size,
      firstTaipeiTime: timelineEvents.length ? taipeiTime(timelineEvents.map((row) => row.at).sort((a, b) => Date.parse(a) - Date.parse(b))[0]) : "",
      lastTaipeiTime: timelineEvents.length ? taipeiTime(timelineEvents.map((row) => row.at).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1)) : "",
    },
    issues,
  };
  console.log(JSON.stringify(output, null, 2));
  if (issues.length) process.exit(1);
})().catch((error) => {
  console.error(JSON.stringify({ ok: false, verifier: "verify-strategy2-live-v2-closure", error: error?.message || String(error) }, null, 2));
  process.exit(1);
});