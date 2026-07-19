"use strict";

const {
  sourceStatusSummary,
  gateSummary,
  isMarketClosedPreviousGood,
  statusIssues,
} = require("./verify-terminal-water-root");

const CONTRACT = "terminal-water-root-contract-rehearsal-v1";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseRows() {
  const sourcePayload = {
    status: "ok",
    phase: "intraday",
    daytrade_gate_grade: "A",
    formal_entry_allowed: true,
    scanner_can_run_opening: true,
    priority_fresh_quote_coverage_120s: 1,
    quote_age_seconds: 30,
    intraday_1m_stale_seconds: 0,
    daily_volume_status: "ready",
  };
  return {
    sourceRow: {
      status: "ok",
      message: "dedicated daytrade source ready",
      updated_at: "2026-07-20T01:00:00.000Z",
      payload: sourcePayload,
    },
    gateRow: {
      canonical_gate_grade: "A",
      canonical_gate_status: "ready",
      gate: "A",
      status: "ready",
      gate_grade: "A",
      gate_status: "ready",
      reason: "ready",
      phase: "intraday",
      formal_entry_speed_verdict: "YES",
      formal_entry_allowed: true,
      priority_fresh_quote_coverage_120s: 1,
      quote_age_seconds: 30,
      scanner_can_run_opening: true,
    },
  };
}

function buildPayload(mutator = () => {}, options = {}) {
  const rows = baseRows();
  const payload = {
    checkedAt: "2026-07-20T01:00:00.000Z",
    expectedDate: "20260720",
    required: {
      tradingDay: true,
      formalNow: true,
      priorityCoverage: 0.95,
      quoteAgeSeconds: 90,
      intraday1mStaleSeconds: 120,
      dailyVolume: true,
      motherPoolRows: 1,
      priorityTop40Rows: 1,
      ...(options.required || {}),
    },
    marketCalendar: {
      ok: true,
      status: 200,
      elapsedMs: 25,
      row: {
        isTradingDay: true,
        marketOpen: true,
        sourceFreshnessRequired: true,
        formalScanSkipped: false,
        displayMode: "formal_scan",
        tradeDate: "2026-07-20",
        scannerTargetDate: "20260720",
        ...(options.calendar || {}),
      },
    },
    probes: [],
    motherPool: { name: "mother_pool", ok: true, status: 200, elapsedMs: 30, maxElapsedMs: 3000, rowCount: 300, row: { symbol: "2330" } },
    priorityTop40: { name: "priority_top40", ok: true, status: 200, elapsedMs: 30, maxElapsedMs: 3000, rowCount: 40, row: { symbol: "2330" } },
    intraday1m: { name: "intraday_1m_status", ok: true, status: 200, elapsedMs: 30, maxElapsedMs: 3000, rowCount: 1, row: { today_candle_count: 1000 } },
    dailyVolume: { name: "daily_volume", ok: true, status: 200, elapsedMs: 30, maxElapsedMs: 3000, rowCount: 1, row: { status: "ready" } },
  };

  payload.sourceStatus = { name: "source_status", ok: true, status: 200, elapsedMs: 30, maxElapsedMs: 3000, rowCount: 1, row: rows.sourceRow };
  payload.canonicalGate = { name: "canonical_gate", ok: true, status: 200, elapsedMs: 30, maxElapsedMs: 3000, rowCount: 1, row: rows.gateRow };
  payload.probes = [payload.sourceStatus, payload.canonicalGate, payload.motherPool, payload.priorityTop40, payload.intraday1m, payload.dailyVolume];

  mutator(payload);

  payload.sourceStatus.summary = sourceStatusSummary(payload.sourceStatus.row || {});
  payload.canonicalGate.summary = gateSummary(payload.canonicalGate.row || {});
  payload.marketClosedPreviousGood = isMarketClosedPreviousGood(payload);
  payload.issues = statusIssues(payload);
  payload.rawOk = payload.issues.length === 0;
  return payload;
}

function applyPath(target, path, value) {
  const parts = path.split(".");
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    cursor = cursor[part];
  }
  cursor[parts[parts.length - 1]] = value;
}

const cases = [
  {
    name: "formal_ready_allows_water_root",
    expectOk: true,
    expectIssues: [],
    mutate: () => {},
  },
  {
    name: "market_closed_preserves_previous_good",
    expectOk: true,
    expectClosed: true,
    expectIssues: [],
    mutate: (payload) => {
      payload.required.tradingDay = false;
      payload.required.formalNow = false;
      payload.marketCalendar.row.isTradingDay = false;
      payload.marketCalendar.row.marketOpen = false;
      payload.marketCalendar.row.sourceFreshnessRequired = false;
      payload.marketCalendar.row.formalScanSkipped = true;
      payload.marketCalendar.row.displayMode = "market_closed_previous_good";
      payload.sourceStatus.row.status = "stopped";
      payload.sourceStatus.row.payload.status = "stopped";
      payload.sourceStatus.row.payload.phase = "after_daytrade_window";
      payload.canonicalGate.row.phase = "after_daytrade_window";
      payload.canonicalGate.row.formal_entry_allowed = false;
      payload.canonicalGate.row.formal_entry_speed_verdict = "NO";
    },
  },
  {
    name: "formal_blocks_low_priority_quote_coverage",
    expectOk: false,
    expectIssues: ["priority_quote_coverage_low"],
    mutate: (payload) => applyPath(payload, "sourceStatus.row.payload.priority_fresh_quote_coverage_120s", 0.94),
  },
  {
    name: "formal_blocks_stale_quote_age",
    expectOk: false,
    expectIssues: ["quote_age_too_old"],
    mutate: (payload) => applyPath(payload, "sourceStatus.row.payload.quote_age_seconds", 91),
  },
  {
    name: "formal_blocks_stale_intraday_1m",
    expectOk: false,
    expectIssues: ["intraday_1m_stale"],
    mutate: (payload) => applyPath(payload, "sourceStatus.row.payload.intraday_1m_stale_seconds", 121),
  },
  {
    name: "formal_blocks_daily_volume_missing",
    expectOk: false,
    expectIssues: ["daily_volume_not_ready"],
    mutate: (payload) => applyPath(payload, "sourceStatus.row.payload.daily_volume_status", "missing"),
  },
  {
    name: "formal_blocks_missing_mother_pool",
    expectOk: false,
    expectIssues: ["mother_pool_rows_low"],
    mutate: (payload) => { payload.motherPool.rowCount = 0; },
  },
  {
    name: "formal_blocks_missing_priority_top40",
    expectOk: false,
    expectIssues: ["priority_top40_rows_low"],
    mutate: (payload) => { payload.priorityTop40.rowCount = 0; },
  },
  {
    name: "formal_blocks_canonical_gate_not_A",
    expectOk: false,
    expectIssues: ["canonical_gate_not_A"],
    mutate: (payload) => { payload.canonicalGate.row.canonical_gate_grade = "B"; },
  },
  {
    name: "formal_blocks_speed_verdict_not_yes",
    expectOk: false,
    expectIssues: ["formal_entry_speed_not_yes"],
    mutate: (payload) => { payload.canonicalGate.row.formal_entry_speed_verdict = "NO"; },
  },
  {
    name: "formal_blocks_entry_allowed_false",
    expectOk: false,
    expectIssues: ["formal_entry_allowed_false"],
    mutate: (payload) => { payload.canonicalGate.row.formal_entry_allowed = false; },
  },
  {
    name: "formal_blocks_scanner_can_run_opening_false",
    expectOk: false,
    expectIssues: ["scanner_can_run_opening_false"],
    mutate: (payload) => { payload.canonicalGate.row.scanner_can_run_opening = false; },
  },
  {
    name: "formal_blocks_unreadable_source_status",
    expectOk: false,
    expectIssues: ["source_status_not_readable"],
    mutate: (payload) => {
      payload.sourceStatus.ok = false;
      payload.sourceStatus.status = 522;
      payload.sourceStatus.error = "timeout";
    },
  },
  {
    name: "formal_blocks_intraday_today_candle_zero",
    expectOk: false,
    expectIssues: ["intraday_1m_today_candle_count_zero"],
    mutate: (payload) => { payload.intraday1m.row.today_candle_count = 0; },
  },
  {
    name: "market_closed_forced_formal_blocks",
    expectOk: false,
    expectClosed: true,
    expectIssues: ["market_calendar_not_trading_day", "formal_entry_allowed_false"],
    mutate: (payload) => {
      payload.required.formalNow = true;
      payload.required.tradingDay = true;
      payload.marketCalendar.row.isTradingDay = false;
      payload.marketCalendar.row.marketOpen = false;
      payload.marketCalendar.row.sourceFreshnessRequired = false;
      payload.marketCalendar.row.formalScanSkipped = true;
      payload.marketCalendar.row.displayMode = "market_closed_previous_good";
      payload.sourceStatus.row.status = "stopped";
      payload.sourceStatus.row.payload.status = "stopped";
      payload.sourceStatus.row.payload.phase = "after_daytrade_window";
      payload.canonicalGate.row.phase = "after_daytrade_window";
      payload.canonicalGate.row.formal_entry_allowed = false;
      payload.canonicalGate.row.formal_entry_speed_verdict = "NO";
    },
  },
];

const results = cases.map((testCase) => {
  const payload = buildPayload(testCase.mutate);
  const missingIssues = (testCase.expectIssues || []).filter((expected) => !payload.issues.some((issue) => issue.startsWith(expected)));
  const okMatch = payload.rawOk === testCase.expectOk;
  const closedMatch = testCase.expectClosed === undefined || payload.marketClosedPreviousGood === testCase.expectClosed;
  return {
    name: testCase.name,
    ok: okMatch && closedMatch && missingIssues.length === 0,
    rawOk: payload.rawOk,
    marketClosedPreviousGood: payload.marketClosedPreviousGood,
    issues: payload.issues,
    expectedOk: testCase.expectOk,
    expectedIssues: testCase.expectIssues || [],
    missingIssues,
  };
});

const failures = results.filter((result) => !result.ok);
const output = {
  ok: failures.length === 0,
  contract: CONTRACT,
  caseCount: results.length,
  failures,
  results,
};

console.log(JSON.stringify(output, null, 2));
if (!output.ok) process.exitCode = 1;

