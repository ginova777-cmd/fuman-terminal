"use strict";

const { buildNotificationPlan } = require("./write-autonomous-ops-notification-plan");

function assert(condition, issue, details, issues) {
  if (!condition) issues.push({ issue, details });
}

function policyFor(opsState, notifyRequired, extra = {}) {
  return {
    tradeDate: "20260717",
    decision: {
      opsState,
      unattendedStatus: opsState === "UNATTENDED_YES" ? "YES" : (opsState === "MARKET_CLOSED_PRESERVE_PREVIOUS_GOOD" ? "PREVIOUS_GOOD_HOLD" : "NO"),
      formalScanAllowed: opsState === "UNATTENDED_YES",
      scorecardPublishAllowed: opsState === "UNATTENDED_YES",
      terminalSnapshotAllowed: true,
      autoRecoveryAllowed: !String(opsState).includes("AUTH"),
      action: extra.action || "policy_action",
      reason: extra.reason || opsState.toLowerCase(),
    },
    actionMatrix: {
      opsState,
      severity: extra.severity || (notifyRequired ? "warning" : "info"),
      stopMode: extra.stopMode || "policy_controlled",
      notify: {
        required: notifyRequired,
        channel: "ops_alert",
        kind: notifyRequired ? extra.kind || "terminal_ops_attention" : "none",
        dedupeKey: `${opsState}:20260717:${extra.key || "root"}`,
        reason: extra.reason || opsState.toLowerCase(),
      },
    },
    modules: extra.modules || [],
  };
}

function runCases(issues) {
  const cases = [
    { name: "unattended_yes", policy: policyFor("UNATTENDED_YES", false), expectRequired: false, expectKind: "none" },
    { name: "market_closed", policy: policyFor("MARKET_CLOSED_PRESERVE_PREVIOUS_GOOD", false), expectRequired: false, expectKind: "none" },
    { name: "blocked_auth", policy: policyFor("BLOCKED_AUTH", true, { kind: "backend_auth_blocked", severity: "critical" }), expectRequired: true, expectKind: "backend_auth_blocked" },
    { name: "blocked_source", policy: policyFor("BLOCKED_SOURCE", true, { kind: "water_root_blocked" }), expectRequired: true, expectKind: "water_root_blocked" },
    { name: "degraded_retry", policy: policyFor("DEGRADED_RETRY_QUEUE", true, { kind: "retry_queue_pending", modules: [{ key: "strategy5", blockers: ["scan_failed"] }] }), expectRequired: true, expectKind: "retry_queue_pending" },
  ];

  for (const item of cases) {
    const plan = buildNotificationPlan(item.policy, { send: false });
    assert(plan.contract === "autonomous-ops-notification-plan-v1", `${item.name}_contract_mismatch`, plan, issues);
    assert(plan.notification.required === item.expectRequired, `${item.name}_required_mismatch`, plan.notification, issues);
    assert(plan.notification.kind === item.expectKind, `${item.name}_kind_mismatch`, plan.notification, issues);
    assert(Boolean(plan.notification.dedupeKey), `${item.name}_dedupe_missing`, plan.notification, issues);
    assert(plan.notification.sendAllowed === false && plan.notification.dryRun === true, `${item.name}_must_be_dry_run_without_send`, plan.notification, issues);
    assert(plan.invariants.includes("send_requires_explicit_send_flag"), `${item.name}_send_invariant_missing`, plan.invariants, issues);
  }

  const sendPlan = buildNotificationPlan(policyFor("BLOCKED_SOURCE", true, { kind: "water_root_blocked" }), { send: true });
  assert(sendPlan.notification.sendAllowed === true && sendPlan.notification.dryRun === false, "send_flag_did_not_arm_notification", sendPlan.notification, issues);
}

function main() {
  const issues = [];
  runCases(issues);
  const ok = issues.length === 0;
  console.log(JSON.stringify({ ok, contract: "autonomous-ops-notification-policy-verifier-v1", issues }, null, 2));
  if (!ok) process.exit(1);
}

main();