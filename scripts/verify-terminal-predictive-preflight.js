"use strict";

const { normalizePredictivePreflight, CONTRACT } = require("./write-terminal-predictive-preflight");

function assert(condition, issue, details, issues) {
  if (!condition) issues.push({ issue, details });
}

function verifyCase(name, raw, expected) {
  const issues = [];
  const payload = normalizePredictivePreflight(raw);
  assert(payload.contract === CONTRACT, `${name}_contract_mismatch`, { contract: payload.contract }, issues);
  assert(payload.state === expected.state, `${name}_state_mismatch`, { actual: payload.state, expected: expected.state, payload }, issues);
  assert(payload.ok === expected.ok, `${name}_ok_mismatch`, { actual: payload.ok, expected: expected.ok, payload }, issues);
  assert(payload.publishAllowed === expected.publishAllowed, `${name}_publish_allowed_mismatch`, { payload }, issues);
  assert(payload.preservePreviousGood === expected.preservePreviousGood, `${name}_preserve_previous_good_mismatch`, { payload }, issues);
  if (expected.issueIncludes) {
    assert(payload.issues.some((item) => item.includes(expected.issueIncludes)), `${name}_missing_expected_issue`, { expected: expected.issueIncludes, issues: payload.issues }, issues);
  }
  return { name, rawOk: payload.ok, state: payload.state, issues, payload };
}

function main() {
  const today = "2026-07-17";
  const cases = [
    verifyCase("ready_formal_scan", {
      ok: true,
      action: "allow_formal_scan",
      status: "ready",
      taipeiToday: today,
      marketOpen: true,
      marketDate: today,
      displayTradeDate: today,
      scannerTargetDate: today,
      sourceFreshnessRequired: true,
      publishAllowed: true,
      preservePreviousGood: false,
      latestPointerUpdated: false,
      emptyResultWritten: false,
      evidenceStatus: "complete",
      unattendedStatus: "YES",
      reason: "date_preflight_ready",
    }, { state: "READY_FOR_FORMAL_SCAN", ok: true, publishAllowed: true, preservePreviousGood: false }),
    verifyCase("market_closed_skip", {
      ok: true,
      action: "skip_formal_scan",
      status: "market_closed",
      taipeiToday: "2026-07-19",
      marketOpen: false,
      marketDate: "2026-07-17",
      displayTradeDate: "2026-07-17",
      scannerTargetDate: "2026-07-17",
      formalScanSkipped: true,
      publishAllowed: false,
      preservePreviousGood: true,
      latestPointerUpdated: false,
      emptyResultWritten: false,
      evidenceStatus: "market_closed",
      unattendedStatus: "SKIPPED_MARKET_CLOSED",
      reason: "weekend",
    }, { state: "MARKET_CLOSED_SKIP_SCAN", ok: true, publishAllowed: false, preservePreviousGood: true }),
    verifyCase("trading_day_wait_source_window", {
      ok: true,
      action: "skip_formal_scan",
      status: "waiting_source_window",
      taipeiToday: today,
      marketOpen: true,
      marketDate: today,
      displayTradeDate: "2026-07-16",
      scannerTargetDate: today,
      formalScanSkipped: true,
      sourceFreshnessRequired: false,
      publishAllowed: false,
      preservePreviousGood: true,
      latestPointerUpdated: false,
      emptyResultWritten: false,
      evidenceStatus: "waiting_source_window",
      unattendedStatus: "WAITING_SOURCE_WINDOW",
      reason: "trading_day_before_formal_source_window",
    }, { state: "TRADING_DAY_WAIT_SOURCE_WINDOW", ok: true, publishAllowed: false, preservePreviousGood: true }),    verifyCase("date_mismatch_fail_closed", {
      ok: false,
      action: "fail_closed",
      status: "failed",
      taipeiToday: today,
      marketOpen: true,
      marketDate: today,
      displayTradeDate: today,
      scannerTargetDate: "2026-07-16",
      publishAllowed: false,
      preservePreviousGood: true,
      latestPointerUpdated: false,
      emptyResultWritten: false,
      evidenceStatus: "insufficient",
      unattendedStatus: "NO",
      reason: "scanner_target_date_not_taipei_today",
    }, { state: "BLOCKED_DATE_PREFLIGHT", ok: true, publishAllowed: false, preservePreviousGood: true }),
    verifyCase("bad_fail_closed_publish", {
      ok: false,
      action: "fail_closed",
      status: "failed",
      taipeiToday: today,
      marketOpen: true,
      marketDate: today,
      displayTradeDate: today,
      scannerTargetDate: "2026-07-16",
      publishAllowed: true,
      preservePreviousGood: false,
      latestPointerUpdated: true,
      emptyResultWritten: true,
      evidenceStatus: "insufficient",
      unattendedStatus: "YES",
      reason: "scanner_target_date_not_taipei_today",
    }, { state: "BLOCKED_DATE_PREFLIGHT", ok: false, publishAllowed: true, preservePreviousGood: false, issueIncludes: "fail_closed_publish_allowed_true" }),
  ];
  const issues = cases.flatMap((item) => item.issues);
  const ok = issues.length === 0;
  console.log(JSON.stringify({
    ok,
    contract: "terminal-predictive-preflight-verifier-v1",
    cases: cases.map((item) => ({ name: item.name, rawOk: item.rawOk, state: item.state })),
    issues,
  }, null, 2));
  if (!ok) process.exit(1);
}

main();
