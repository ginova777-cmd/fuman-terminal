"use strict";

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

async function call(handler, request) {
  const response = createResponse();
  await handler(request, response);
  return response;
}

function assert(condition, issue, details, issues) {
  if (!condition) issues.push({ issue, details });
}

function isPendingNotDue(payload) {
  return (payload.unattendedStatus === "NO" || payload.unattendedStatus === "PREVIOUS_GOOD_HOLD")
    && payload.state === "PENDING_NOT_DUE"
    && payload.gates?.dailyManifest?.status === "PENDING_NOT_DUE"
    && payload.gates?.runIdClosure?.status === "PENDING_NOT_DUE"
    && payload.actionMatrix?.stopMode === "wait_schedule";
}

function isAcceptableOpsStatus(payload) {
  if (payload.unattendedStatus === "YES") return true;
  if (isPendingNotDue(payload)) return true;
  return payload.unattendedStatus === "PREVIOUS_GOOD_HOLD"
    && payload.state === "MARKET_CLOSED_PRESERVE_PREVIOUS_GOOD"
    && payload.canaryPublish?.scorecardPublishAllowed === false
    && payload.predictivePreflight?.preservePreviousGood === true
    && payload.predictivePreflight?.formalScanAllowed === false;
}

function isProtectedReadbackDisplayOnlyFailure(payload) {
  const credential = payload.protectedReadbackCredential || {};
  if (credential.ok === true) return false;
  if (credential.armed !== true) return false;
  if (payload.ok !== true || payload.state !== "UNATTENDED_YES" || payload.unattendedStatus !== "YES") return false;
  const displayBlockers = Array.isArray(payload.protectedReadbackDisplayBlockers)
    ? payload.protectedReadbackDisplayBlockers.filter(Boolean)
    : [];
  if (displayBlockers.length === 0) return false;
  if (payload.gates?.runIdClosure?.ok !== true) return false;
  if (payload.finalAudit?.ok !== true) return false;
  return displayBlockers.every((row) => /protected_readback_unauthorized|missing_bearer_token|membership_required/i.test(String(row)));
}

async function main() {
  const api = require("../api/terminal-ops-status");
  const issues = [];
  const internal = await call(api, {
    method: "GET",
    headers: { host: "localhost" },
    query: {},
    fumanInternalVerify: true,
  });
  const unauth = await call(api, {
    method: "GET",
    headers: { host: "localhost" },
    query: {},
  });
  const payload = internal.body || {};

  assert(internal.statusCode === 200, "internal_status_not_200", { statusCode: internal.statusCode, body: payload }, issues);
  assert(payload.contract === "terminal-ops-status-v1", "contract_mismatch", { contract: payload.contract }, issues);
  assert(isAcceptableOpsStatus(payload), "ops_status_not_fresh_yes_or_previous_good_hold", { unattendedStatus: payload.unattendedStatus, state: payload.state, reason: payload.reason }, issues);
  assert(Array.isArray(payload.modules) && payload.modules.length >= 7, "modules_missing", { modules: payload.modules?.length }, issues);
  assert(payload.reasonCodeSummary?.contract === "terminal-reason-code-summary-v1", "reason_code_summary_missing", { reasonCodeSummary: payload.reasonCodeSummary }, issues);
  assert(payload.reasonCodeSummary?.ok === true && payload.reasonCodeSummary?.unknownEntries === 0, "reason_code_summary_not_ok", { reasonCodeSummary: payload.reasonCodeSummary }, issues);
  assert(Array.isArray(payload.reasonCodeSummary?.codes) && payload.reasonCodeSummary.codes.length > 0, "reason_code_summary_codes_missing", { reasonCodeSummary: payload.reasonCodeSummary }, issues);
  assert(payload.rootCauseSummary?.contract === "production-readiness-root-cause-summary-v1", "root_cause_summary_missing", { rootCauseSummary: payload.rootCauseSummary }, issues);
  assert(payload.rootCauseSummary?.ok === true && Number(payload.rootCauseSummary?.unknownBlockers || 0) === 0, "root_cause_summary_not_ok", { rootCauseSummary: payload.rootCauseSummary }, issues);
  const rootCauseTotalBlockers = Number(payload.rootCauseSummary?.totalBlockers || 0);
  assert(rootCauseTotalBlockers === 0 || (Array.isArray(payload.rootCauseSummary?.categories) && payload.rootCauseSummary.categories.length > 0), "root_cause_summary_categories_missing", { rootCauseSummary: payload.rootCauseSummary }, issues);
  assert(payload.rootCauseRecoveryPlan?.contract === "production-readiness-root-cause-recovery-plan-v1", "root_cause_recovery_plan_missing", { rootCauseRecoveryPlan: payload.rootCauseRecoveryPlan }, issues);
  assert(rootCauseTotalBlockers === 0 || (Array.isArray(payload.rootCauseRecoveryPlan?.steps) && payload.rootCauseRecoveryPlan.steps.length > 0), "root_cause_recovery_plan_steps_missing", { rootCauseRecoveryPlan: payload.rootCauseRecoveryPlan }, issues);
  const recoveryCategories = new Set((payload.rootCauseRecoveryPlan?.steps || []).map((row) => row.category));
  for (const row of payload.rootCauseSummary?.categories || []) assert(recoveryCategories.has(row.category), `root_cause_recovery_plan_missing_category:${row.category}`, { rootCauseRecoveryPlan: payload.rootCauseRecoveryPlan }, issues);
  const authStep = (payload.rootCauseRecoveryPlan?.steps || []).find((row) => row.category === "auth_readback");
  if (authStep) assert(authStep.canAutoExecute === false && authStep.canExecuteNow === false && authStep.automation === "manual_secret", "root_cause_recovery_plan_auth_not_manual", { authStep }, issues);
  for (const row of payload.rootCauseRecoveryPlan?.steps || []) {
    assert(typeof row.canExecuteNow === "boolean", "root_cause_recovery_plan_execute_now_missing:" + (row.category || "unknown"), { row }, issues);
    assert(Array.isArray(row.blockedBy), "root_cause_recovery_plan_blocked_by_missing:" + (row.category || "unknown"), { row }, issues);
    if (row.canExecuteNow === true) assert(row.canAutoExecute === true, "root_cause_recovery_plan_execute_now_without_auto:" + (row.category || "unknown"), { row }, issues);
  }
  assert(payload.readinessReport?.contract === "production-unattended-readiness-report-v1", "readiness_report_summary_missing", { readinessReport: payload.readinessReport }, issues);
  assert(Array.isArray(payload.gates?.waterRoot?.reasonCodes) && payload.gates.waterRoot.reasonCodes.includes("SOURCE_WATER_ROOT_NOT_READY") || payload.gates?.waterRoot?.ok === true, "water_root_reason_code_missing", { gate: payload.gates?.waterRoot }, issues);
  assert(payload.modules.every((row) => Array.isArray(row.reasonCodes) && row.reasonCodes.length > 0 && row.reasonUnknown !== true), "module_reason_codes_missing_or_unknown", { modules: payload.modules }, issues);
  assert((payload.jobQueue || []).every((row) => Array.isArray(row.reasonCodes) && row.reasonCodes.length > 0 && row.reasonUnknown !== true), "job_queue_reason_codes_missing_or_unknown", { jobQueue: payload.jobQueue }, issues);
  assert(payload.modules.every((row) => row.runId && row.ok === true), "module_runid_or_ok_missing", { modules: payload.modules }, issues);
  assert(payload.gates?.runIdClosure?.ok === true || isPendingNotDue(payload), "runid_closure_gate_not_ok", { gate: payload.gates?.runIdClosure }, issues);
  const safeRecoveryPreview = payload.rollForward?.safeRecoveryPreview || {};
  assert(safeRecoveryPreview.contract === "terminal-safe-recovery-preview-v1", "safe_recovery_preview_contract_missing", { rollForward: payload.rollForward }, issues);
  assert(safeRecoveryPreview.reasonCodeSummary?.ok !== false, "safe_recovery_preview_reason_codes_not_ok", { safeRecoveryPreview }, issues);
  if (payload.state === "BLOCKED_AUTH_MANUAL_REPAIR_REQUIRED") {
    assert(Array.isArray(safeRecoveryPreview.blockedKeys) && safeRecoveryPreview.blockedKeys.length > 0, "safe_recovery_preview_blocked_keys_missing", { safeRecoveryPreview }, issues);
  }

  assert(payload.gates?.finalAudit?.status || payload.finalAudit?.contract === "terminal-autonomous-completion-audit-v1", "final_audit_gate_missing", { gate: payload.gates?.finalAudit, finalAudit: payload.finalAudit }, issues);
  assert(payload.finalAudit?.layers === 21, "final_audit_layers_not_21", { finalAudit: payload.finalAudit }, issues);
  assert(payload.finalAudit?.ok === true || isPendingNotDue(payload), "final_audit_not_ok", { finalAudit: payload.finalAudit, state: payload.state }, issues);
  assert(payload.gates?.predictivePreflight?.status, "predictive_preflight_gate_missing", { gate: payload.gates?.predictivePreflight }, issues);
  assert(payload.predictivePreflight?.contract === "terminal-predictive-preflight-v1", "predictive_preflight_contract_missing", { predictivePreflight: payload.predictivePreflight }, issues);
  assert(payload.predictivePreflight?.scannerTargetDate, "predictive_preflight_scanner_target_missing", { predictivePreflight: payload.predictivePreflight }, issues);
  assert(payload.gates?.dailyManifest?.ok === true || isPendingNotDue(payload), "daily_manifest_gate_not_ok", { gate: payload.gates?.dailyManifest }, issues);
  assert(payload.gates?.canaryPublish?.status, "canary_publish_gate_missing", { gate: payload.gates?.canaryPublish }, issues);
  assert(payload.canaryPublish?.contract === "terminal-canary-publish-v1", "canary_publish_contract_missing", { canaryPublish: payload.canaryPublish }, issues);
  assert(payload.gates?.notificationPolicy?.status, "notification_policy_gate_missing", { gate: payload.gates?.notificationPolicy }, issues);
  assert(payload.gates?.protectedReadbackCredential, "protected_readback_credential_gate_missing", { gate: payload.gates?.protectedReadbackCredential }, issues);
  assert(payload.protectedReadbackCredential?.contract === "protected-readback-credential-v1", "protected_readback_credential_contract_missing", { protectedReadbackCredential: payload.protectedReadbackCredential }, issues);
  const protectedReadbackDisplayOnly = isProtectedReadbackDisplayOnlyFailure(payload);
  assert((payload.gates?.protectedReadbackCredential?.ok === true && payload.protectedReadbackCredential?.ok === true && payload.protectedReadbackCredential?.armed === true) || protectedReadbackDisplayOnly, "protected_readback_credential_not_ok", { gate: payload.gates?.protectedReadbackCredential, protectedReadbackCredential: payload.protectedReadbackCredential, protectedReadbackDisplayBlockers: payload.protectedReadbackDisplayBlockers }, issues);
  if (payload.protectedReadbackCredential?.ok !== true && !protectedReadbackDisplayOnly) {
    const credentialActions = Array.isArray(payload.protectedReadbackCredential?.nextActions) ? payload.protectedReadbackCredential.nextActions : [];
    assert((credentialActions.some((row) => row?.code === "install_runtime_credential" || row?.code === "setup_runtime_credential_from_any_directory")) && credentialActions.some((row) => row?.code === "verify_credential"), "protected_readback_credential_next_actions_missing", { protectedReadbackCredential: payload.protectedReadbackCredential }, issues);
  }
  assert(payload.notificationPlan?.contract === "autonomous-ops-notification-plan-v1", "notification_plan_contract_missing", { notificationPlan: payload.notificationPlan }, issues);
  assert(typeof payload.notificationPlan?.required === "boolean", "notification_plan_required_not_boolean", { notificationPlan: payload.notificationPlan }, issues);
  assert(payload.notificationPlan?.dedupeKey, "notification_plan_dedupe_key_missing", { notificationPlan: payload.notificationPlan }, issues);
  assert(payload.stateMachineContract?.contract === "terminal-state-machine-v1", "state_machine_contract_missing", { stateMachineContract: payload.stateMachineContract }, issues);
  assert(Array.isArray(payload.stateMachineContract?.lifecycle) && payload.stateMachineContract.lifecycle.includes("DISPLAY_VERIFIED"), "state_machine_lifecycle_incomplete", { stateMachineContract: payload.stateMachineContract }, issues);
  assert(payload.actionMatrix?.contract === "autonomous-ops-action-matrix-v1", "action_matrix_missing", { actionMatrix: payload.actionMatrix }, issues);
  assert(payload.actionMatrix?.terminalDisplay?.allowed === true, "action_matrix_terminal_display_not_allowed", { actionMatrix: payload.actionMatrix }, issues);
  assert(Array.isArray(payload.actionMatrix?.protectedInvariants) && payload.actionMatrix.protectedInvariants.includes("membership_auth_only_gates_display_not_scanner_compute"), "action_matrix_membership_invariant_missing", { actionMatrix: payload.actionMatrix }, issues);
  assert(unauth.statusCode === 401 && unauth.body?.error === "membership_required", "unauth_not_membership_protected", { statusCode: unauth.statusCode, body: unauth.body }, issues);
  assert(/no-store/i.test(String(internal.headers["cache-control"] || "")), "missing_no_store_header", { headers: internal.headers }, issues);

  const ok = issues.length === 0;
  console.log(JSON.stringify({
    ok,
    internalStatus: internal.statusCode,
    unauthStatus: unauth.statusCode,
    state: payload.state,
    unattendedStatus: payload.unattendedStatus,
    tradeDate: payload.tradeDate,
    modules: payload.modules?.length || 0,
    issues,
  }, null, 2));
  if (!ok) process.exit(1);
}

main().catch((error) => {
  console.error(`[terminal-ops-status-api] failed: ${error.stack || error.message || error}`);
  process.exit(1);
});
