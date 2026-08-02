const DEDICATED_SOURCE = "fugle_daytrade_source";

const FORMAL_SCAN_MODULES = new Set([
  "strategy2",
  "strategy3",
  "strategy4",
  "strategy5",
  "institution",
  "cb",
  "warrant",
]);

function objectsIn(payload = {}) {
  const sourceStatus = payload.sourceStatus || payload.source_status || {};
  const sourceRow = sourceStatus.row || sourceStatus;
  const sourcePayload = sourceRow.payload || sourceStatus.payload || {};
  const marketCalendar = payload.marketCalendar || payload.market_calendar || {};
  return [
    payload,
    payload.canonicalGate || payload.canonical_gate,
    payload.unattendedGate || payload.unattended_gate,
    sourceStatus,
    sourceRow,
    sourcePayload,
    payload.waterRoot,
    payload.manifest,
    payload.orchestrator,
    marketCalendar,
    marketCalendar.row,
  ].filter((row) => row && typeof row === "object");
}

function values(objects, names) {
  return objects.flatMap((row) => names.map((name) => row[name]).filter((value) => value !== undefined && value !== null && value !== ""));
}

function first(objects, names, fallback) {
  const found = values(objects, names)[0];
  return found === undefined ? fallback : found;
}

function bool(value) {
  return value === true || String(value).toLowerCase() === "true";
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateKey(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function allEqual(valuesToCheck) {
  const present = valuesToCheck.map(dateKey).filter(Boolean);
  return present.length > 0 && present.every((value) => value === present[0]);
}

function channelsReady(objects) {
  const raw = values(objects, ["channels", "websocketChannels", "websocket_channels"]);
  const channels = raw.flatMap((value) => Array.isArray(value) ? value : String(value).split(/[,\s]+/));
  return ["trades", "aggregates", "candles"].every((name) => channels.includes(name));
}

function evaluateFormalEntryGate(payload = {}, expectedDate = "") {
  const objects = objectsIn(payload);
  const failures = [];
  const sourceNames = values(objects, ["sourceName", "source_name", "source"]);
  if (!sourceNames.some((value) => String(value) === DEDICATED_SOURCE)) failures.push("DEDICATED_DAYTRADE_SOURCE_REQUIRED");

  const grades = values(objects, [
    "gateGrade", "gate_grade",
    "canonicalGateGrade", "canonical_gate_grade",
    "unattendedGateGrade", "unattended_gate_grade",
    "daytradeGateGrade", "daytrade_gate_grade",
    "priorityGateGrade", "priority_gate_grade",
    "sourceStatusGrade", "source_status_grade",
  ]);
  if (!grades.length || grades.some((value) => String(value).toUpperCase() !== "A")) failures.push("GATE_GRADE_NOT_A");
  const statuses = values(objects, ["gateStatus", "gate_status", "canonicalGateStatus", "canonical_gate_status", "unattendedGateStatus", "unattended_gate_status"]);
  if (!statuses.length || statuses.some((value) => !["ready", "ok"].includes(String(value).toLowerCase()))) failures.push("GATE_STATUS_NOT_READY");

  if (String(first(objects, ["formalEntrySpeedVerdict", "formal_entry_speed_verdict"], "NO")).toUpperCase() !== "YES") failures.push("FORMAL_ENTRY_SPEED_NOT_YES");
  for (const [label, names] of [
    ["formal_entry_allowed", ["formalEntryAllowed", "formal_entry_allowed"]],
    ["scanner_can_run_opening", ["scannerCanRunOpening", "scanner_can_run_opening"]],
    ["websocket_formal_ready", ["websocketFormalReady", "websocket_formal_ready"]],
    ["websocket_connected", ["websocketConnected", "websocket_connected", "connected"]],
    ["websocket_authenticated", ["websocketAuthenticated", "websocket_authenticated", "authenticated"]],
    ["websocket_streaming", ["websocketStreaming", "websocket_streaming", "streaming"]],
    ["websocket_rest_disabled", ["websocketRestDisabled", "websocket_rest_disabled"]],
    ["formal_source_alignment", ["formalSourceAlignmentOk", "formal_source_alignment_ok", "sourceAlignmentOk", "source_alignment_ok"]],
  ]) {
    const fieldValues = values(objects, names);
    if (!fieldValues.length || fieldValues.some((value) => !bool(value))) failures.push(label.toUpperCase());
  }
  if (!channelsReady(objects)) failures.push("WEBSOCKET_CHANNELS_INCOMPLETE");

  const ordinaryUniverseReady = values(objects, ["ordinaryStockUniverseReady", "ordinary_stock_universe_ready", "fullMarketUniverseReady", "full_market_universe_ready"]);
  if (!ordinaryUniverseReady.length || ordinaryUniverseReady.some((value) => !bool(value))) failures.push("ORDINARY_STOCK_UNIVERSE_NOT_READY");
  const activeSymbols = number(first(objects, ["activeSymbols", "active_symbols"], null));
  if (activeSymbols === null || activeSymbols <= 0) failures.push("ACTIVE_SYMBOLS_EMPTY");

  const priorityPool = number(first(objects, ["priorityPoolSymbols", "priority_pool_symbols", "priorityPoolSize", "priority_pool_size"], null));
  const priorityFresh = number(first(objects, ["priorityFreshQuotes120s", "priority_fresh_quotes_120s"], null));
  const priorityCoverage = number(first(objects, ["priorityFreshQuoteCoverage120s", "priority_fresh_quote_coverage_120s"], null));
  const motherPool = number(first(objects, ["motherPoolSymbols", "mother_pool_symbols", "motherPoolSize", "mother_pool_size"], null));
  if (priorityPool !== 40) failures.push("PRIORITY_POOL_NOT_40");
  if (priorityCoverage === null || priorityCoverage < 0.95) failures.push("PRIORITY_COVERAGE_LT_095");
  if (priorityFresh === null || priorityFresh < 40) failures.push("PRIORITY_FRESH_QUOTES_LT_40");
  if (motherPool === null || motherPool < 300 || motherPool > 600) failures.push("MOTHER_POOL_OUT_OF_RANGE");

  const quoteAge = number(first(objects, ["quoteAgeSeconds", "quote_age_seconds"], null));
  const intradayStale = number(first(objects, ["intraday1mStaleSeconds", "intraday_1m_stale_seconds"], null));
  if (quoteAge === null || quoteAge > 90) failures.push("QUOTE_AGE_GT_90");
  if (intradayStale === null || intradayStale > 120) failures.push("INTRADAY_1M_STALE_GT_120");
  for (const [label, names] of [
    ["MA20_NOT_READY", ["readyMa20", "ready_ma20", "ma20Ready", "ma20_ready"]],
    ["MA35_NOT_READY", ["readyMa35", "ready_ma35", "ma35Ready", "ma35_ready"]],
  ]) {
    const fieldValues = values(objects, names);
    if (!fieldValues.length || fieldValues.some((value) => !bool(value))) failures.push(label);
  }
  if (String(first(objects, ["dailyVolumeStatus", "daily_volume_status"], "")).toLowerCase() !== "ready") failures.push("DAILY_VOLUME_NOT_READY");
  if (String(first(objects, ["futoptGateStatus", "futopt_gate_status"], "")).toLowerCase() !== "ready") failures.push("FUTOPT_NOT_READY");
  const futoptMapped = number(first(objects, ["futoptStockMapped", "futopt_stock_mapped"], null));
  const futoptUniverse = number(first(objects, ["futoptStockQuoteUniverse", "futopt_stock_quote_universe"], null));
  const futoptLoop = number(first(objects, ["futoptStockQuotesThisLoop", "futopt_stock_quotes_this_loop"], null));
  if (futoptMapped === null || futoptMapped <= 0) failures.push("FUTOPT_STOCK_MAPPING_EMPTY");
  if (futoptUniverse === null || futoptUniverse <= 0) failures.push("FUTOPT_STOCK_UNIVERSE_EMPTY");
  if (futoptLoop === null || futoptLoop <= 0) failures.push("FUTOPT_STOCK_QUOTES_LOOP_EMPTY");

  const failedChecks = values(objects, ["failedChecks", "failed_checks"]).flatMap((value) => Array.isArray(value) ? value : [value]).filter(Boolean);
  if (failedChecks.length) failures.push("FAILED_CHECKS_PRESENT");
  const dates = values(objects, ["marketDate", "market_date", "displayTradeDate", "display_trade_date", "requestedDate", "requested_date", "tradeDate", "trade_date", "sourceTradeDate", "source_trade_date", "scannerTargetDate", "scanner_target_date", "scorecardTargetDate", "scorecard_target_date", "manifestTradeDate", "manifest_trade_date"]);
  const requiredDateFields = [
    ["market_date", ["marketDate", "market_date"]],
    ["display_trade_date", ["displayTradeDate", "display_trade_date"]],
    ["requested_date", ["requestedDate", "requested_date"]],
    ["trade_date", ["tradeDate", "trade_date"]],
    ["source_trade_date", ["sourceTradeDate", "source_trade_date"]],
    ["scanner_target_date", ["scannerTargetDate", "scanner_target_date"]],
    ["scorecard_target_date", ["scorecardTargetDate", "scorecard_target_date"]],
    ["manifest_trade_date", ["manifestTradeDate", "manifest_trade_date"]],
  ];
  for (const [label, names] of requiredDateFields) {
    if (!values(objects, names).length) failures.push("DATE_FIELD_MISSING_" + label.toUpperCase());
  }
  const expected = dateKey(expectedDate);
  if (!allEqual(dates) || (expected && dates.some((value) => dateKey(value) !== expected))) failures.push("DATE_HARD_GATE_MISMATCH");

  return {
    contract: "terminal-formal-entry-gate-v1",
    ok: failures.length === 0,
    sourceName: DEDICATED_SOURCE,
    expectedDate: expected,
    failedChecks: [...new Set(failures)],
    formalEntryAllowed: failures.length === 0,
  };
}

module.exports = { DEDICATED_SOURCE, FORMAL_SCAN_MODULES, evaluateFormalEntryGate };
