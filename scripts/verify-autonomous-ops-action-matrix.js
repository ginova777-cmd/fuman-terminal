"use strict";

const { _private } = require("./write-autonomous-ops-policy");

function assert(condition, issue, details, issues) {
  if (!condition) issues.push({ issue, details });
}

function matrixFor(decision, extra = {}) {
  return _private.buildActionMatrix({
    decision,
    manifest: { tradeDate: "20260717", ok: decision.unattendedStatus === "YES", ...(extra.manifest || {}) },
    orchestrator: extra.orchestrator || {},
    waterRoot: extra.waterRoot || {},
    modules: extra.modules || [],
    marketClosedPreviousGood: extra.marketClosedPreviousGood === true,
  });
}

function runMutationChecks(issues) {
  const cases = [
    {
      name: "unattended_yes",
      decision: { opsState: "UNATTENDED_YES", unattendedStatus: "YES", formalScanAllowed: true, scorecardPublishAllowed: true, terminalSnapshotAllowed: true, autoRecoveryAllowed: true, action: "continue", reason: "green" },
      expect: (m) => m.formalScan.allowed === true && m.publish.allowed === true && m.notify.required === false && m.stopMode === "none",
    },
    {
      name: "market_closed",
      decision: { opsState: "MARKET_CLOSED_PRESERVE_PREVIOUS_GOOD", unattendedStatus: "YES", formalScanAllowed: false, scorecardPublishAllowed: false, terminalSnapshotAllowed: true, autoRecoveryAllowed: true, action: "preserve", reason: "market_closed_previous_good" },
      extra: { marketClosedPreviousGood: true },
      expect: (m) => m.formalScan.allowed === false && m.publish.allowed === false && m.terminalDisplay.mode === "market_closed_previous_good" && m.notify.required === false,
    },
    {
      name: "blocked_auth",
      decision: { opsState: "BLOCKED_AUTH", unattendedStatus: "NO", formalScanAllowed: false, scorecardPublishAllowed: false, terminalSnapshotAllowed: false, autoRecoveryAllowed: false, action: "fix_service_token_first", reason: "401" },
      extra: { orchestrator: { jobQueue: [{ key: "strategy4", state: "BLOCKED_AUTH", blocker: "401" }] } },
      expect: (m) => m.formalScan.allowed === false && m.publish.allowed === false && m.rollForward.allowed === false && m.notify.required === true && m.notify.kind === "backend_auth_blocked",
    },
    {
      name: "blocked_source",
      decision: { opsState: "BLOCKED_SOURCE", unattendedStatus: "NO", formalScanAllowed: false, scorecardPublishAllowed: false, terminalSnapshotAllowed: true, autoRecoveryAllowed: true, action: "wait_water", reason: "quote_not_ready" },
      extra: { waterRoot: { status: "BLOCKED", reason: "quote_not_ready" } },
      expect: (m) => m.formalScan.allowed === false && m.publish.allowed === false && m.rollForward.mode === "source_recheck_only" && m.terminalDisplay.mode === "previous_good_degraded",
    },
    {
      name: "degraded_retry",
      decision: { opsState: "DEGRADED_RETRY_QUEUE", unattendedStatus: "NO", formalScanAllowed: false, scorecardPublishAllowed: false, terminalSnapshotAllowed: true, autoRecoveryAllowed: true, action: "retry", reason: "manifest_not_green" },
      extra: { orchestrator: { jobQueue: [{ key: "strategy5", state: "FAILED_SCAN", blocker: "scan_failed" }] } },
      expect: (m) => m.publish.allowed === false && m.rollForward.mode === "safe_retry_queue" && m.notify.kind === "retry_queue_pending",
    },
  ];

  for (const item of cases) {
    const matrix = matrixFor(item.decision, item.extra || {});
    assert(matrix.contract === "autonomous-ops-action-matrix-v1", `${item.name}_contract_mismatch`, matrix, issues);
    assert(item.expect(matrix), `${item.name}_expectation_failed`, matrix, issues);
    assert(matrix.protectedInvariants.includes("membership_auth_only_gates_display_not_scanner_compute"), `${item.name}_missing_membership_invariant`, matrix.protectedInvariants, issues);
    assert(matrix.protectedInvariants.includes("fallback_or_previous_good_never_counts_as_today_publish_success"), `${item.name}_missing_fallback_invariant`, matrix.protectedInvariants, issues);
  }
}

function main() {
  const issues = [];
  runMutationChecks(issues);
  const ok = issues.length === 0;
  console.log(JSON.stringify({ ok, contract: "autonomous-ops-action-matrix-verifier-v1", issues }, null, 2));
  if (!ok) process.exit(1);
}

main();
